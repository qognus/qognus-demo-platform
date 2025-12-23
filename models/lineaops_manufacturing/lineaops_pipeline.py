"""
lineaops_pipeline.py
Qognus Demo Platform — ApexGrid / LineaOps
------------------------------------------
Simulates industrial robotics telemetry (PLC data).
Detects drift in cycle times and vibration anomalies.
"""

import json
import sys
import pathlib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta, timezone

# ------------------------------------------------------------
# SETUP: Import from Central Config
# ------------------------------------------------------------
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from config import WEB_DATA_DIR, RANDOM_SEED
except ImportError:
    print("❌ Error: Could not import 'config.py'.")
    sys.exit(1)

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------
OUT_JSON = WEB_DATA_DIR / "lineaops_data.json"

NUM_ROBOTS = 6
ROBOTS = [f"ROB-{i:02d}" for i in range(1, NUM_ROBOTS + 1)]
SHIFT_HOURS = 12
FREQ_SEC = 60 # 1 minute aggregates

# Physics Constants
BASE_CYCLE_TIME = 4500 # ms
BASE_TEMP = 42.0 # Celsius
BASE_VIB = 1.2 # mm/s

rng = np.random.default_rng(RANDOM_SEED)

# ------------------------------------------------------------
# LOGIC
# ------------------------------------------------------------

def generate_shift_data():
    print("Generating manufacturing telemetry...")
    
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=SHIFT_HOURS)
    
    timestamps = pd.date_range(start=start_time, end=end_time, freq=f"{FREQ_SEC}s")
    n = len(timestamps)
    
    all_data = []
    
    for rob_id in ROBOTS:
        # 1. Baseline Physics
        cycle_time = rng.normal(BASE_CYCLE_TIME, 50, n)
        temp = rng.normal(BASE_TEMP, 0.5, n)
        vibration = rng.normal(BASE_VIB, 0.1, n)
        status = np.full(n, "RUNNING")
        
        # 2. Warmup Curve (Temp rises at start of shift)
        warmup = np.linspace(-10, 0, min(60, n))
        temp[:len(warmup)] += warmup
        
        # 3. ANOMALY INJECTION
        
        # Scenario A: ROB-03 has a "Bearing Fault" (Vibration spike)
        if rob_id == "ROB-03":
            fault_start = int(n * 0.7)
            vibration[fault_start:] += np.linspace(0, 4.5, n - fault_start) # Ramp up vibration
            temp[fault_start:] += np.linspace(0, 15.0, n - fault_start) # Heat up
            status[fault_start:] = "WARNING"
            status[int(n*0.9):] = "CRITICAL"

        # Scenario B: ROB-05 has "Cycle Drift" (Getting slower)
        if rob_id == "ROB-05":
            drift_start = int(n * 0.4)
            cycle_time[drift_start:] += np.linspace(0, 1200, n - drift_start) # Add 1.2s delay
            # Temp rises slightly due to strain
            temp[drift_start:] += np.linspace(0, 5.0, n - drift_start)
            status[int(n*0.8):] = "WARNING"

        # Create DataFrame for this robot
        df = pd.DataFrame({
            "timestamp": timestamps,
            "robot_id": rob_id,
            "cycle_time_ms": cycle_time,
            "temperature_c": temp,
            "vibration_mm_s": vibration,
            "status": status
        })
        all_data.append(df)
        
    return pd.concat(all_data)

def calculate_metrics(df):
    print("Calculating OEE metrics...")
    
    # Simple OEE Proxy
    metrics = {}
    
    for rob_id, grp in df.groupby("robot_id"):
        avg_cycle = grp["cycle_time_ms"].mean()
        avg_vib = grp["vibration_mm_s"].mean()
        
        perf_score = min(1.0, BASE_CYCLE_TIME / avg_cycle)
        qual_score = max(0.8, 1.0 - (avg_vib * 0.02)) # Higher vibration = lower quality
        avail_score = 0.95 # Mock constant
        
        oee = perf_score * qual_score * avail_score
        
        metrics[rob_id] = {
            "oee": round(oee * 100, 1),
            "performance": round(perf_score * 100, 1),
            "quality": round(qual_score * 100, 1),
            "availability": round(avail_score * 100, 1),
            "status": grp["status"].iloc[-1] # Current status
        }
        
    return metrics

def export_web_artifacts(df, metrics):
    print(f"Exporting to {OUT_JSON}...")
    
    # Downsample for UI (1 point every 10 mins)
    df_ui = df.copy()
    df_ui["ts_group"] = df_ui["timestamp"].dt.floor("10min")
    
    # Group by robot and 10min window
    chart_series = []
    
    for rob_id, grp in df_ui.groupby("robot_id"):
        resampled = grp.groupby("ts_group").agg({
            "cycle_time_ms": "mean",
            "temperature_c": "mean",
            "vibration_mm_s": "mean"
        }).reset_index()
        
        # --- FIX: Convert Timestamp objects to Strings ---
        # Generate the formatted label list first
        timestamps_labels = resampled["ts_group"].dt.strftime("%H:%M").tolist()
        
        # Convert the actual data column to ISO string for the payload
        resampled["timestamp"] = resampled["ts_group"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # Drop the original Timestamp object column to allow JSON serialization
        resampled_clean = resampled.drop(columns=["ts_group"])
        
        chart_series.append({
            "id": rob_id,
            "data": resampled_clean.to_dict(orient="records"),
            "timestamps": timestamps_labels
        })

    payload = {
        "generated_at": datetime.now().isoformat(),
        "shift_duration_hours": SHIFT_HOURS,
        "metrics": metrics,
        "series": chart_series
    }
    
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f)
        
    print("Done.")

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==================================================")
    print(" LineaOps — Manufacturing Analytics")
    print("==================================================")
    
    df = generate_shift_data()
    metrics = calculate_metrics(df)
    export_web_artifacts(df, metrics)

if __name__ == "__main__":
    main()