"""
generate_gridsense_timeseries.py
Qognus Demo Platform — ApexGrid Systems / GridSense
---------------------------------------------------

Generates synthetic multivariate SCADA-like time series data for GridSense
using stochastic processes and physics-based relationships.

Improvements over basic version:
1. Load Modeling: Uses an Ornstein-Uhlenbeck (mean-reverting) process 
   superimposed on a daily/weekly seasonality curve.
2. Physics: 
   - Voltage drops (sag) are proportional to Load squared (I^2*R losses).
   - Oil Temperature follows a first-order differential equation (thermal lag).
3. Realistic Anomalies:
   - "sensor_freeze": Values stick to a constant.
   - "calibration_drift": Gradual linear divergence.
   - "voltage_sag": Sudden drop due to reactive power events.

Output:
- data/raw/gridsense_timeseries.parquet
"""

import numpy as np
import pandas as pd
import pathlib
import datetime
from typing import List, Tuple

# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_DIR = DATA_DIR / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

OUT_PARQUET = RAW_DIR / "gridsense_timeseries.parquet"

# Simulation Settings
DAYS = 14
FREQ = "5min"
DT_HOURS = 5 / 60.0  # Time step in hours

NUM_SUBSTATIONS = 16
SUBSTATIONS = [f"GS-{i:03d}" for i in range(1, NUM_SUBSTATIONS + 1)]
REGIONS = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]

RANDOM_SEED = 42

# ------------------------------------------------------------
# PHYSICS & STOCHASTIC HELPERS
# ------------------------------------------------------------

def get_seasonality(t_index: pd.DatetimeIndex) -> np.ndarray:
    """
    Returns a baseline load curve (0.0 to 1.0) based on hour of day and day of week.
    Double-hump pattern typical of residential/industrial mix.
    """
    hour = t_index.hour + t_index.minute / 60.0
    day_of_week = t_index.dayofweek
    
    # Primary daily cycle (Peak at 9AM and 7PM)
    # Using a mix of sin waves to create a non-perfect shape
    morning_peak = np.exp(-((hour - 9)**2) / 8)
    evening_peak = np.exp(-((hour - 19)**2) / 10)
    base_load = 0.3
    
    daily_shape = base_load + 0.4 * morning_peak + 0.5 * evening_peak
    
    # Weekend reduction factor (0.8x on Sat/Sun)
    weekend_factor = np.where(day_of_week >= 5, 0.8, 1.0)
    
    return daily_shape * weekend_factor

def generate_ou_process(
    length: int, 
    target_series: np.ndarray, 
    theta: float = 0.15, 
    sigma: float = 0.05, 
    rng: np.random.Generator = None
) -> np.ndarray:
    """
    Ornstein-Uhlenbeck process: dX = theta*(mu - X)*dt + sigma*dW
    Creates realistic 'wandering' around the target seasonality.
    """
    if rng is None:
        rng = np.random.default_rng()
        
    x = np.zeros(length)
    x[0] = target_series[0]
    
    noise = rng.normal(0, 1, length)
    
    for t in range(1, length):
        dx = theta * (target_series[t] - x[t-1]) * DT_HOURS + sigma * np.sqrt(DT_HOURS) * noise[t]
        x[t] = x[t-1] + dx
        
    # Clamp to physical realism (cannot have negative load)
    return np.maximum(x, 0.05)

def thermal_model(
    load_series: np.ndarray, 
    ambient_temp: np.ndarray, 
    thermal_resistance: float = 15.0, 
    tau: float = 4.0
) -> np.ndarray:
    """
    Simple thermal model for transformer oil.
    dT/dt = (1/tau) * (T_target - T_current)
    where T_target = Ambient + (Load_Factor^2 * Thermal_Resistance)
    """
    n = len(load_series)
    temp = np.zeros(n)
    temp[0] = ambient_temp[0] + (load_series[0]**2 * thermal_resistance)
    
    # Precompute decay factor for discrete step
    alpha = 1 - np.exp(-DT_HOURS / tau)
    
    for t in range(1, n):
        # I^2 R heating relationship
        heat_rise = (load_series[t]**2) * thermal_resistance
        target = ambient_temp[t] + heat_rise
        
        # Exponential smoothing (low-pass filter effect of thermal mass)
        temp[t] = temp[t-1] + alpha * (target - temp[t-1])
        
    return temp

# ------------------------------------------------------------
# SUBSTATION GENERATOR
# ------------------------------------------------------------

def generate_substation_data(
    sub_id: str, 
    region: str, 
    t_index: pd.DatetimeIndex, 
    rng: np.random.Generator
) -> pd.DataFrame:
    
    n = len(t_index)
    
    # 1. Nominal Parameters
    capacity_mw = rng.uniform(40, 120)
    nominal_voltage = 132.0 # kV
    
    # 2. Load Generation (MW)
    # Seasonal baseline + Stochastic variation
    seasonality = get_seasonality(t_index)
    load_factor = generate_ou_process(n, seasonality, theta=2.0, sigma=0.2, rng=rng)
    load_mw = load_factor * capacity_mw
    
    # 3. Ambient Temp (Daily cycle + random weather fronts)
    hour = t_index.hour + t_index.minute / 60.0
    day_temp_cycle = 20 + 5 * np.sin((hour - 10) * np.pi / 12)
    weather_fronts = generate_ou_process(n, np.zeros(n), theta=0.1, sigma=1.0, rng=rng)
    ambient_c = day_temp_cycle + weather_fronts

    # 4. Physics Derivations
    
    # Transformer Oil Temp (Lagging indicator)
    oil_temp_c = thermal_model(load_factor, ambient_c, thermal_resistance=25.0, tau=3.0)
    
    # Voltage (kV) - drops as load increases (Line Impedance)
    # V = V_nom - (Load * Impedance_Factor) + Grid_Noise
    impedance_noise = rng.normal(0, 0.05, n)
    voltage_kv = nominal_voltage * (1 - 0.02 * load_factor) + impedance_noise
    
    # Current (Amps) - P = sqrt(3) * V * I * PF
    # I = P / (sqrt(3) * V * PF)
    pf = 0.95 # Power Factor
    current_a = (load_mw * 1e3) / (np.sqrt(3) * voltage_kv * pf)
    
    # Frequency (Hz) - 50Hz or 60Hz base
    base_freq = 60.0 if "us" in region else 50.0
    freq_hz = base_freq + rng.normal(0, 0.02, n)

    df = pd.DataFrame({
        "timestamp": t_index,
        "substation_id": sub_id,
        "region": region,
        "load_mw": load_mw.round(2),
        "voltage_kv": voltage_kv.round(2),
        "current_a": current_a.round(2),
        "oil_temp_c": oil_temp_c.round(2),
        "freq_hz": freq_hz.round(3),
        "is_anomaly": 0,
        "anomaly_type": None
    })
    
    return df

# ------------------------------------------------------------
# ANOMALY INJECTION
# ------------------------------------------------------------

def inject_anomalies(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Injects specific, realistic fault signatures.
    Uses .iloc to avoid off-by-one errors with inclusive slicing.
    """
    df = df.copy()
    n_points = len(df)
    
    # Indices for columns to modify
    idx_load = df.columns.get_loc("load_mw")
    idx_curr = df.columns.get_loc("current_a")
    idx_temp = df.columns.get_loc("oil_temp_c")
    idx_volt = df.columns.get_loc("voltage_kv")
    idx_anom = df.columns.get_loc("is_anomaly")
    idx_type = df.columns.get_loc("anomaly_type")

    # 1. SENSOR FREEZE (Data flatlines)
    if rng.random() < 0.3:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = rng.integers(12, 48) # 1-4 hours
        end = min(start + duration, n_points)
        
        # Use .iloc (exclusive end)
        if end > start:
            # Freeze Load and Current at the start value
            freeze_load = df.iloc[start, idx_load]
            freeze_curr = df.iloc[start, idx_curr]
            
            df.iloc[start:end, idx_load] = freeze_load
            df.iloc[start:end, idx_curr] = freeze_curr
            
            # Mark labels
            df.iloc[start:end, idx_anom] = 1
            df.iloc[start:end, idx_type] = "sensor_freeze"

    # 2. THERMAL RUNAWAY (Cooling failure)
    if rng.random() < 0.3:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = rng.integers(24, 72) # 2-6 hours
        end = min(start + duration, n_points)
        
        if end > start:
            # Add a linear ramp to temperature
            # shape matches (end - start)
            ramp = np.linspace(0, 15, end - start)
            
            df.iloc[start:end, idx_temp] += ramp
            
            df.iloc[start:end, idx_anom] = 1
            df.iloc[start:end, idx_type] = "thermal_runaway"

    # 3. VOLTAGE SAG (Grid fault)
    if rng.random() < 0.3:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = rng.integers(2, 6) # Short duration (10-30 mins)
        end = min(start + duration, n_points)
        
        if end > start:
            df.iloc[start:end, idx_volt] *= 0.85 # 15% drop
            df.iloc[start:end, idx_curr] *= 1.15 # Current rises
            
            df.iloc[start:end, idx_anom] = 1
            df.iloc[start:end, idx_type] = "voltage_sag"
        
    return df

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" GridSense — Physics-based Data Generator")
    print("==============================================")
    
    rng = np.random.default_rng(RANDOM_SEED)
    
    # 1. Create Time Index
    end_time = datetime.datetime.now(datetime.timezone.utc)
    start_time = end_time - datetime.timedelta(days=DAYS)
    t_index = pd.date_range(start=start_time, end=end_time, freq=FREQ)
    
    all_subs = []
    
    # 2. Generate Data for each Substation
    for i, sub in enumerate(SUBSTATIONS):
        region = REGIONS[i % len(REGIONS)]
        print(f"Generating {sub} ({region})...")
        
        df_sub = generate_substation_data(sub, region, t_index, rng)
        df_sub = inject_anomalies(df_sub, rng)
        
        all_subs.append(df_sub)
        
    # 3. Combine and Save
    df_final = pd.concat(all_subs)
    df_final.sort_values(["substation_id", "timestamp"], inplace=True)
    
    # Save to Parquet (efficient storage)
    print(f"Saving {len(df_final)} rows to {OUT_PARQUET}...")
    df_final.to_parquet(OUT_PARQUET, index=False)
    
    print("Done. Run 'python models/gridsense_timeseries/anomaly_model.py' next to generate web artifacts.")

if __name__ == "__main__":
    main()