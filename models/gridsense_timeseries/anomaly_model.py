"""
anomaly_model.py
Qognus Demo Platform — ApexGrid / GridSense
-------------------------------------------
Refactored to use central config and export JSON.
"""

import json
import sys
import pathlib
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

# ------------------------------------------------------------
# SETUP: Import from Central Config
# ------------------------------------------------------------
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from config import RAW_DIR, PROCESSED_DIR, WEB_DATA_DIR, RANDOM_SEED
except ImportError:
    print("❌ Error: Could not import 'config.py'.")
    sys.exit(1)

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------
IN_PARQUET = RAW_DIR / "gridsense_timeseries.parquet"
OUT_JSON = WEB_DATA_DIR / "gridsense_timeseries.json" # <--- JSON Output

WINDOW = 6  
FEATURE_COLS = ["load_mw", "voltage_kv", "current_a", "freq_hz", "oil_temp_c"]

# ------------------------------------------------------------
# LOGIC
# ------------------------------------------------------------

def build_features_and_scale(df, window, feature_cols):
    """Builds windows AND scales each substation individually."""
    df = df.copy().sort_values(["substation_id", "timestamp"])
    
    all_rows = []
    all_feats = []

    for substation_id, grp in df.groupby("substation_id"):
        grp = grp.sort_values("timestamp")
        values = grp[feature_cols].to_numpy()
        labels = grp["is_anomaly"].to_numpy()
        ts = grp["timestamp"].to_numpy()
        region = grp["region"].iloc[0]

        if len(grp) < window: continue

        sub_feats = []
        sub_rows = []

        for i in range(window - 1, len(grp)):
            start = i - window + 1
            end = i + 1
            window_vals = values[start:end, :]

            # Features: Current Value + Volatility + Trend
            current = window_vals[-1]              
            std = np.std(window_vals, axis=0)      
            delta = window_vals[-1] - window_vals[0]
            
            feat_vector = np.concatenate([current, std, delta]) 
            sub_feats.append(feat_vector)

            # Metadata
            anomaly_ratio = labels[start:end].sum() / window
            window_label = 1 if anomaly_ratio > 0.3 else 0

            row = {
                "timestamp": ts[i],
                "substation_id": substation_id,
                "region": region,
                "window_label": window_label,
            }
            sub_rows.append(row)

        if not sub_feats: continue

        # Per-substation Z-Score Scaling
        scaler = StandardScaler()
        sub_feats_scaled = scaler.fit_transform(np.array(sub_feats))
        
        all_feats.append(sub_feats_scaled)
        all_rows.extend(sub_rows)

    window_df = pd.DataFrame(all_rows)
    X_scaled = np.vstack(all_feats) if all_feats else np.empty((0, len(FEATURE_COLS)*3))
    
    return window_df, X_scaled

def evaluate_soft_metrics(y_true, y_pred, tolerance=3):
    n = len(y_true)
    if n == 0: return {"precision": 0.0, "recall": 0.0, "contamination": 0.0}
    
    y_true_soft = np.zeros(n, dtype=int)
    anomaly_indices = np.where(y_true == 1)[0]
    for idx in anomaly_indices:
        start = max(0, idx - tolerance)
        end = min(n, idx + tolerance + 1)
        y_true_soft[start:end] = 1
        
    tp_soft = np.sum((y_pred == 1) & (y_true_soft == 1))
    fp_soft = np.sum((y_pred == 1) & (y_true_soft == 0))
    precision = tp_soft / (tp_soft + fp_soft) if (tp_soft + fp_soft) > 0 else 0.0
    
    y_pred_expanded = np.zeros(n, dtype=int)
    pred_indices = np.where(y_pred == 1)[0]
    for idx in pred_indices:
        start = max(0, idx - tolerance)
        end = min(n, idx + tolerance + 1)
        y_pred_expanded[start:end] = 1
        
    tp_recall = np.sum((y_pred_expanded == 1) & (y_true == 1))
    fn_recall = np.sum((y_pred_expanded == 0) & (y_true == 1))
    recall = tp_recall / (tp_recall + fn_recall) if (tp_recall + fn_recall) > 0 else 0.0
    
    return {
        "precision": float(round(precision, 3)),
        "recall": float(round(recall, 3)),
        "contamination": float(round(np.mean(y_pred), 3))
    }

def export_json_artifact(df, metrics, out_path, max_points=1000):
    """Exports pure JSON for the frontend component."""
    df = df.reset_index().copy()
    df["timestamp_iso"] = df["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    series_records = []
    
    for substation_id, grp in df.groupby("substation_id"):
        grp = grp.sort_values("timestamp")
        # Downsample for web performance if needed
        if len(grp) > max_points:
            idx = np.linspace(0, len(grp) - 1, max_points).astype(int)
            grp = grp.iloc[idx]

        for _, row in grp.iterrows():
            series_records.append({
                "timestamp": row["timestamp_iso"],
                "substation_id": substation_id,
                "region": row["region"],
                "anomaly_score": float(row["anomaly_score"]),
                "predicted_anomaly": int(row["predicted_anomaly"]),
            })

    payload = {"summary": metrics, "series": series_records}
    
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(f" -> Saved artifact: {out_path}")

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("===================================================")
    print(" GridSense PCA (Per-Substation Scaling) ")
    print("===================================================")
    print(f"Config Source: {PROJECT_ROOT}/config.py")

    if not IN_PARQUET.exists():
        print(f"⚠️  Input {IN_PARQUET} not found. Running generator...")
        # Optional: Call generator if missing (requires import)
        import subprocess
        gen_script = PROJECT_ROOT / "synthetic" / "generate_gridsense_timeseries.py"
        subprocess.run([sys.executable, str(gen_script)], check=True)

    df_full = pd.read_parquet(IN_PARQUET)
    df_full = df_full.sort_values(["substation_id", "timestamp"])

    print("Building and scaling features per substation...")
    window_df, X_scaled = build_features_and_scale(df_full.reset_index(), WINDOW, FEATURE_COLS)

    print("Training Global PCA...")
    pca = PCA(n_components=0.85) 
    pca.fit(X_scaled)
    
    print("Scoring...")
    X_recon = pca.inverse_transform(pca.transform(X_scaled))
    diff = X_scaled - X_recon
    mse = np.mean(diff ** 2, axis=1)
    
    # Thresholding (2 Sigma)
    mu = np.mean(mse)
    sigma = np.std(mse)
    threshold = mu + (2.0 * sigma)
    
    preds = (mse > threshold).astype(int)
    scores_viz = np.clip(mse / (threshold * 2.0), 0, 1.0) # Normalize for UI

    # Smoothing
    preds_smooth = pd.Series(preds).rolling(window=3, center=False).max().fillna(0).astype(int).values

    window_df["anomaly_score"] = scores_viz
    window_df["predicted_anomaly"] = preds_smooth

    # Evaluate
    split_idx = int(len(window_df) * 0.8)
    metrics = evaluate_soft_metrics(
        window_df["window_label"].iloc[split_idx:].to_numpy(), 
        preds_smooth[split_idx:], 
        tolerance=3
    )
    print("Metrics:", metrics)

    # Merge results back to timestamps
    df_out = df_full.reset_index().merge(
        window_df[["substation_id", "timestamp", "anomaly_score", "predicted_anomaly"]],
        on=["substation_id", "timestamp"],
        how="left"
    ).fillna(0)

    export_json_artifact(df_out, metrics, OUT_JSON)
    print("Done.")

if __name__ == "__main__":
    main()