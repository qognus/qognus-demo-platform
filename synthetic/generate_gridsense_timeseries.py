"""
generate_gridsense_timeseries.py
Qognus Demo Platform — ApexGrid Systems / GridSense
---------------------------------------------------

UPDATED: "Clean & Simple"
-------------------------
We simplified the physics to make "Normal" data extremely predictable 
(smooth sine waves) and "Anomalies" visually dramatic.

- Normal: Smooth daily cycles, low noise.
- Anomalies: Massive spikes, flatlines, and drifts.
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
DT_HOURS = 5 / 60.0 

NUM_SUBSTATIONS = 16
SUBSTATIONS = [f"GS-{i:03d}" for i in range(1, NUM_SUBSTATIONS + 1)]
REGIONS = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]

RANDOM_SEED = 42

# ------------------------------------------------------------
# GENERATORS
# ------------------------------------------------------------

def generate_substation_data(sub_id, region, t_index, rng):
    n = len(t_index)
    
    # 1. Simple Seasonality (Sine Wave)
    # Hour of day (0-24)
    hours = t_index.hour + t_index.minute / 60.0
    
    # Smooth daily sine wave for Load (0.0 to 1.0)
    # Peak at 14:00 (2pm)
    daily_cycle = 0.5 + 0.4 * np.sin((hours - 8) * (2 * np.pi / 24))
    
    # Tiny noise (so PCA fits perfectly)
    noise = rng.normal(0, 0.02, n)
    load_factor = np.clip(daily_cycle + noise, 0.1, 1.0)
    
    # 2. Physics (Simple & Deterministic)
    nominal_mw = 50.0
    nominal_volt = 132.0
    
    load_mw = load_factor * nominal_mw
    
    # Voltage dips slightly when load is high (Inverse relationship)
    voltage_kv = nominal_volt * (1.0 - 0.02 * load_factor) + rng.normal(0, 0.01, n)
    
    # Current follows Load perfectly
    current_a = (load_mw * 1000) / (np.sqrt(3) * voltage_kv * 0.95)
    
    # Temp is just a lagged, smoothed version of Load
    temp_base = 35.0
    # Simple exponential moving average for lag
    temp_c = pd.Series(load_factor * 40 + temp_base).ewm(span=24).mean().values
    
    # Frequency is basically flat
    freq_hz = np.full(n, 60.0) + rng.normal(0, 0.005, n)

    df = pd.DataFrame({
        "timestamp": t_index,
        "substation_id": sub_id,
        "region": region,
        "load_mw": load_mw.round(2),
        "voltage_kv": voltage_kv.round(2),
        "current_a": current_a.round(2),
        "oil_temp_c": temp_c.round(2),
        "freq_hz": freq_hz.round(3),
        "is_anomaly": 0,
        "anomaly_type": None
    })
    return df

# ------------------------------------------------------------
# ANOMALY INJECTION (CARTOONISH)
# ------------------------------------------------------------

def inject_anomalies(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    df = df.copy()
    n_points = len(df)
    
    idx_load = df.columns.get_loc("load_mw")
    idx_curr = df.columns.get_loc("current_a")
    idx_temp = df.columns.get_loc("oil_temp_c")
    idx_volt = df.columns.get_loc("voltage_kv")
    idx_freq = df.columns.get_loc("freq_hz")
    idx_anom = df.columns.get_loc("is_anomaly")
    idx_type = df.columns.get_loc("anomaly_type")

    # 1. SQUARE WAVE SURGE (Massive Spike)
    # Voltage jumps 20% instantly and stays there for 2 hours
    if rng.random() < 0.7:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = 24 # 2 hours
        end = min(start + duration, n_points)
        
        df.iloc[start:end, idx_volt] *= 1.25 # +25% Surge
        df.iloc[start:end, idx_anom] = 1
        df.iloc[start:end, idx_type] = "surge"

    # 2. FLATLINE FAILURE (Dead Zero)
    # Load drops to near zero instantly
    if rng.random() < 0.7:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = 36 # 3 hours
        end = min(start + duration, n_points)
        
        df.iloc[start:end, idx_load] = 0.5 # Nearly dead
        df.iloc[start:end, idx_curr] = 0.0 # No current
        df.iloc[start:end, idx_anom] = 1
        df.iloc[start:end, idx_type] = "flatline"

    # 3. FREQUENCY NOISE (Wobble)
    if rng.random() < 0.7:
        start = rng.integers(int(n_points * 0.1), int(n_points * 0.9))
        duration = 48
        end = min(start + duration, n_points)
        
        noise = rng.normal(0, 0.4, end-start) # Huge 0.4Hz noise
        df.iloc[start:end, idx_freq] += noise
        df.iloc[start:end, idx_anom] = 1
        df.iloc[start:end, idx_type] = "freq_noise"
        
    return df

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" GridSense — Simple Data (Clean vs Broken)")
    print("==============================================")
    
    rng = np.random.default_rng(RANDOM_SEED)
    end_time = datetime.datetime.now(datetime.timezone.utc)
    start_time = end_time - datetime.timedelta(days=DAYS)
    t_index = pd.date_range(start=start_time, end=end_time, freq=FREQ)
    
    all_subs = []
    for i, sub in enumerate(SUBSTATIONS):
        region = REGIONS[i % len(REGIONS)]
        print(f"Generating {sub} ({region})...")
        df_sub = generate_substation_data(sub, region, t_index, rng)
        df_sub = inject_anomalies(df_sub, rng)
        all_subs.append(df_sub)
        
    df_final = pd.concat(all_subs)
    df_final.sort_values(["substation_id", "timestamp"], inplace=True)
    
    print(f"Saving {len(df_final)} rows to {OUT_PARQUET}...")
    df_final.to_parquet(OUT_PARQUET, index=False)
    print("Done.")

if __name__ == "__main__":
    main()