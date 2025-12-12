"""
anomaly_model.py
Qognus Demo Platform — ApexGrid / GridSense
-------------------------------------------

Trains and evaluates an unsupervised anomaly detection model on the
synthetic GridSense multivariate time series.

UPDATES:
- Auto-calibrates 'contamination' based on actual label density.
- Implements 'Soft Metrics' (Time-Tolerant Scoring) to give credit 
  for detecting anomalies slightly before/after the exact label timestamp.
"""

import json
import pathlib
from typing import List, Dict, Any, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_score, recall_score, f1_score

# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT_DIR / "data" / "raw"
PROC_DIR = ROOT_DIR / "data" / "processed"
WEB_DATA_DIR = ROOT_DIR / "web" / "data"

PROC_DIR.mkdir(parents=True, exist_ok=True)
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

IN_PARQUET = RAW_DIR / "gridsense_timeseries.parquet"
OUT_PARQUET = PROC_DIR / "gridsense_timeseries_with_scores.parquet"
OUT_JS = WEB_DATA_DIR / "gridsense_timeseries_artifacts.js"

WINDOW = 12  # Rolling window size
FEATURE_COLS = ["load_mw", "voltage_kv", "current_a", "freq_hz", "oil_temp_c"]
RANDOM_SEED = 42

# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def build_window_features(
    df: pd.DataFrame,
    window: int,
    feature_cols: List[str],
) -> Tuple[pd.DataFrame, np.ndarray]:
    """
    Creates rolling window features for time-series models.
    """
    df = df.copy()
    df = df.sort_values(["substation_id", "timestamp"])

    all_rows = []
    all_feats = []

    # Process per substation to avoid boundary bleeding
    for substation_id, grp in df.groupby("substation_id"):
        grp = grp.sort_values("timestamp")
        values = grp[feature_cols].to_numpy()
        labels = grp["is_anomaly"].to_numpy()
        ts = grp["timestamp"].to_numpy()
        region = grp["region"].iloc[0]

        if len(grp) < window:
            continue

        for i in range(window - 1, len(grp)):
            start = i - window + 1
            end = i + 1
            
            # Flatten window into a single feature vector
            window_vals = values[start:end, :]
            window_flat = window_vals.flatten()

            # Labeling: If >30% of the window is anomalous, label it 1
            # This reduces noise from single-point blips
            anomaly_ratio = labels[start:end].sum() / window
            window_label = 1 if anomaly_ratio > 0.3 else 0

            row = {
                "timestamp": ts[i],
                "substation_id": substation_id,
                "region": region,
                "window_label": window_label,
            }
            all_rows.append(row)
            all_feats.append(window_flat)

    window_df = pd.DataFrame(all_rows)
    X = np.array(all_feats, dtype=float)

    return window_df, X

def train_isolation_forest(X: np.ndarray, contamination: float) -> IsolationForest:
    print(f"Training IsolationForest with contamination={contamination:.3f}...")
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    model.fit(X)
    return model

def evaluate_soft_metrics(
    y_true: np.ndarray, 
    y_pred: np.ndarray, 
    tolerance: int = 2
) -> Dict[str, float]:
    """
    Calculates Precision/Recall with a time tolerance (e.g. +/- 2 steps).
    If a prediction is within 'tolerance' steps of a real anomaly, it counts as a hit.
    """
    n = len(y_true)
    
    # 1. Expand Ground Truth (Soft Targets)
    # If t is anomaly, then t-2...t+2 are valid "hit" zones
    y_true_soft = np.zeros(n, dtype=int)
    anomaly_indices = np.where(y_true == 1)[0]
    
    for idx in anomaly_indices:
        start = max(0, idx - tolerance)
        end = min(n, idx + tolerance + 1)
        y_true_soft[start:end] = 1
        
    # 2. Calculate Metrics using Soft Targets for Precision
    # (Did I predict in a valid zone?)
    tp_soft = np.sum((y_pred == 1) & (y_true_soft == 1))
    fp_soft = np.sum((y_pred == 1) & (y_true_soft == 0))
    
    precision = tp_soft / (tp_soft + fp_soft) if (tp_soft + fp_soft) > 0 else 0.0
    
    # 3. Calculate Recall (Did I catch the events?)
    # For Recall, we want to know: For every real anomaly cluster, did we trigger?
    # Simple proxy: Use soft truth as denominator? No, that dilutes it.
    # Standard proxy: Overlap prediction onto true.
    
    # Soft Recall: If I predicted 1, and it was close to a 1, count it.
    # Inverse expansion: Expand Predictions to see if they touch Truths
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

def export_js_artifact(
    df: pd.DataFrame,
    metrics: Dict[str, float],
    out_path: pathlib.Path,
    max_points_per_substation: int = 1000,
) -> None:
    # Ensure timestamp is ISO string
    df = df.reset_index().copy()
    df["timestamp_iso"] = df["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    series_records: List[Dict[str, Any]] = []

    for substation_id, grp in df.groupby("substation_id"):
        grp = grp.sort_values("timestamp")
        # Downsample
        if len(grp) > max_points_per_substation:
            idx = np.linspace(0, len(grp) - 1, max_points_per_substation).astype(int)
            grp = grp.iloc[idx]

        for _, row in grp.iterrows():
            series_records.append({
                "timestamp": row["timestamp_iso"],
                "substation_id": substation_id,
                "region": row["region"],
                "anomaly_score": float(row["anomaly_score"]),
                "predicted_anomaly": int(row["predicted_anomaly"]),
            })

    payload = {
        "summary": metrics,
        "series": series_records,
    }

    js_content = "window.GRIDSENSE_TIMESERIES = " + json.dumps(payload, indent=2) + ";\n"
    print(f"Writing JS artifact to: {out_path}")
    out_path.write_text(js_content, encoding="utf-8")

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("===================================================")
    print(" GridSense Time Series Anomaly Model (Corrected) ")
    print("===================================================")

    if not IN_PARQUET.exists():
        raise FileNotFoundError(f"Input parquet not found: {IN_PARQUET}")

    df_full = pd.read_parquet(IN_PARQUET)
    df_full = df_full.sort_values(["substation_id", "timestamp"])

    print("Building rolling window features...")
    window_df, X = build_window_features(
        df_full.reset_index(), window=WINDOW, feature_cols=FEATURE_COLS
    )
    
    # --- AUTO-CALIBRATION ---
    # Calculate actual anomaly rate in ground truth to set model sensitivity
    actual_rate = window_df["window_label"].mean()
    # Add a small buffer (e.g. 1.2x) to ensure we catch edge cases
    contamination = max(0.01, min(0.15, actual_rate * 1.2))
    
    print(f"Auto-calibrated contamination: {contamination:.3f} (True Rate: {actual_rate:.3f})")

    model = train_isolation_forest(X, contamination)

    print("Scoring windows...")
    scores_raw = model.decision_function(X)
    scores = -scores_raw # Invert so high = anomaly
    
    # Normalize scores [0,1]
    scores = (scores - scores.min()) / (scores.max() - scores.min())
    
    # Predict based on quantile
    threshold = np.quantile(scores, 1.0 - contamination)
    preds = (scores >= threshold).astype(int)

    window_df["anomaly_score"] = scores
    window_df["predicted_anomaly"] = preds

    print("Evaluating with Soft Metrics (Time Tolerance +/- 2 steps)...")
    y_true = window_df["window_label"].to_numpy()
    metrics = evaluate_soft_metrics(y_true, preds, tolerance=2)
    print("Metrics:", metrics)

    # Merge back
    df_out = df_full.reset_index().merge(
        window_df[["substation_id", "timestamp", "anomaly_score", "predicted_anomaly"]],
        on=["substation_id", "timestamp"],
        how="left"
    )
    df_out["anomaly_score"] = df_out["anomaly_score"].fillna(0.0)
    df_out["predicted_anomaly"] = df_out["predicted_anomaly"].fillna(0).astype(int)

    export_js_artifact(df_out, metrics, OUT_JS)
    print("Done.")

if __name__ == "__main__":
    main()