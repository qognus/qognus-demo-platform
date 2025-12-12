"""
anomaly_model.py
Qognus Demo Platform — ApexGrid / GridSense
-------------------------------------------

Trains and evaluates an unsupervised anomaly detection model on the
synthetic GridSense multivariate time series.

UPDATES:
- Implements Strict Temporal Splitting (Train on Past, Eval on Future).
- Auto-calibrates 'contamination' based on Training set density.
- Implements 'Soft Metrics' (Time-Tolerant Scoring).
"""

import json
import pathlib
from typing import List, Dict, Any, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

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
    if n == 0:
        return {"precision": 0.0, "recall": 0.0, "contamination": 0.0}
    
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
    print(" GridSense Time Series Anomaly Model (Temporal Split) ")
    print("===================================================")

    if not IN_PARQUET.exists():
        raise FileNotFoundError(f"Input parquet not found: {IN_PARQUET}")

    df_full = pd.read_parquet(IN_PARQUET)
    df_full = df_full.sort_values(["substation_id", "timestamp"])

    print("Building rolling window features...")
    window_df, X = build_window_features(
        df_full.reset_index(), window=WINDOW, feature_cols=FEATURE_COLS
    )

    # --- 1. PREPARE TEMPORAL SPLIT ---
    # We must sort window_df and X strictly by time to ensure "Past" vs "Future"
    # Get indices that sort the DataFrame by timestamp
    sort_idxs = np.argsort(window_df["timestamp"].values)
    
    # Reorder both X and window_df using these indices
    window_df = window_df.iloc[sort_idxs].reset_index(drop=True)
    X = X[sort_idxs]
    
    # Split point: 80% Train (Past), 20% Test (Future)
    split_idx = int(len(window_df) * 0.8)
    
    X_train = X[:split_idx]
    y_train = window_df["window_label"].iloc[:split_idx]
    
    X_test = X[split_idx:]
    y_test = window_df["window_label"].iloc[split_idx:].to_numpy()

    print(f"Temporal Split: Train on first {split_idx} samples, Eval on last {len(X_test)} samples.")

    # --- 2. AUTO-CALIBRATION (Using ONLY Train Set) ---
    actual_rate = y_train.mean()
    # Add a small buffer (1.2x)
    contamination = max(0.01, min(0.15, actual_rate * 1.2))
    
    print(f"Auto-calibrated contamination: {contamination:.3f} (Train Rate: {actual_rate:.3f})")

    # --- 3. TRAIN (On Past Data Only) ---
    model = train_isolation_forest(X_train, contamination)

    # --- 4. SCORE (Full Dataset) ---
    # We score everything so the UI has a complete timeline, but metrics rely only on Test
    print("Scoring full timeline...")
    scores_raw = model.decision_function(X)
    scores = -scores_raw # Invert so high = anomaly
    
    # Normalize scores [0,1]
    scores = (scores - scores.min()) / (scores.max() - scores.min())
    
    # --- 5. PREDICT ---
    # Determine threshold based on TRAINING distribution 
    train_scores = scores[:split_idx]
    threshold = np.quantile(train_scores, 1.0 - contamination)
    
    preds = (scores >= threshold).astype(int)

    window_df["anomaly_score"] = scores
    window_df["predicted_anomaly"] = preds

    # --- 6. EVALUATE (On Future Data Only) ---
    print("\nEvaluating Performance on Held-Out Future Data (Last 20%)...")
    metrics = evaluate_soft_metrics(
        y_true=y_test, 
        y_pred=preds[split_idx:], 
        tolerance=2
    )
    print("Test Set Metrics:", metrics)

    # Merge back for export
    # Note: df_full needs to be merged with our time-sorted window_df
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