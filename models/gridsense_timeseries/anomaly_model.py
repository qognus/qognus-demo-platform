"""
anomaly_model.py
Qognus Demo Platform — ApexGrid / GridSense
-------------------------------------------

Trains and evaluates an unsupervised anomaly detection model on the
synthetic GridSense multivariate time series.

Steps:
1. Load data/raw/gridsense_timeseries.parquet
2. Create rolling-window feature vectors per substation.
3. Train IsolationForest on all windows.
4. Compute anomaly scores and derive predicted anomalies.
5. Evaluate against injected labels (is_anomaly).
6. Export a JS artifact DIRECTLY to the web/data folder:
   - web/data/gridsense_timeseries_artifacts.js

Outputs:
- data/processed/gridsense_timeseries_with_scores.parquet
- web/data/gridsense_timeseries_artifacts.js
"""

import json
import pathlib
from typing import List, Dict, Any, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_recall_fscore_support


# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

# Project Root
ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent.parent

# Input / Output Paths
RAW_DIR = ROOT_DIR / "data" / "raw"
PROC_DIR = ROOT_DIR / "data" / "processed"
WEB_DATA_DIR = ROOT_DIR / "web" / "data"

# Ensure directories exist
PROC_DIR.mkdir(parents=True, exist_ok=True)
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

IN_PARQUET = RAW_DIR / "gridsense_timeseries.parquet"
OUT_PARQUET = PROC_DIR / "gridsense_timeseries_with_scores.parquet"

# DIRECT OUTPUT to WEB FOLDER
OUT_JS = WEB_DATA_DIR / "gridsense_timeseries_artifacts.js"

# Rolling window length (in timesteps)
WINDOW = 12  # e.g., 12 * 5min = 60 minutes

# Metrics to use in feature vector
FEATURE_COLS = ["load_mw", "voltage_kv", "current_a", "freq_hz", "oil_temp_c"]

# Contamination (expected fraction of anomalies for IsolationForest)
CONTAMINATION = 0.02

RANDOM_SEED = 42


# ------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------

def build_window_features(
    df: pd.DataFrame,
    window: int,
    feature_cols: List[str],
) -> Tuple[pd.DataFrame, np.ndarray]:
    """
    For each substation, create rolling window features.
    """
    df = df.copy()
    df = df.sort_values(["substation_id", "timestamp"])

    all_rows = []
    all_feats = []

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
            window_vals = values[start:end, :]
            window_flat = window_vals.flatten()

            # Window label: 1 if ANY point in window is anomalous
            window_label = int(labels[start:end].max())

            row = {
                "timestamp": ts[i],  # last point
                "substation_id": substation_id,
                "region": region,
                "window_label": window_label,
            }
            all_rows.append(row)
            all_feats.append(window_flat)

    window_df = pd.DataFrame(all_rows)
    X = np.array(all_feats, dtype=float)

    return window_df, X


def train_isolation_forest(X: np.ndarray) -> IsolationForest:
    model = IsolationForest(
        n_estimators=200,
        contamination=CONTAMINATION,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    model.fit(X)
    return model


def compute_scores_and_labels(
    model: IsolationForest,
    X: np.ndarray,
    window_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Add anomaly scores and predicted labels to window_df.
    IsolationForest gives negative scores for anomalies, so we invert & normalize.
    """
    # decision_function: higher = more normal
    scores_raw = model.decision_function(X)  # array shape [n_windows]
    # Convert so that higher = more anomalous
    scores = -scores_raw

    # Normalize to [0, 1]
    s_min, s_max = scores.min(), scores.max()
    if s_max > s_min:
        scores_norm = (scores - s_min) / (s_max - s_min)
    else:
        scores_norm = np.zeros_like(scores)

    # Threshold at percentile (e.g., top 2% anomalies)
    threshold = np.quantile(scores_norm, 1.0 - CONTAMINATION)
    preds = (scores_norm >= threshold).astype(int)

    df = window_df.copy()
    df["anomaly_score"] = scores_norm
    df["predicted_anomaly"] = preds

    return df


def evaluate_detection(
    df_window: pd.DataFrame,
) -> Dict[str, float]:
    """
    Compute precision / recall / F1 vs window_label.
    """
    y_true = df_window["window_label"].to_numpy()
    y_pred = df_window["predicted_anomaly"].to_numpy()

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )

    return {
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "contamination": CONTAMINATION,
    }


def merge_window_scores_back(
    df_full: pd.DataFrame,
    df_window: pd.DataFrame,
    window: int,
) -> pd.DataFrame:
    """
    Map window-level scores to the underlying timestamps.
    """
    df = df_full.reset_index().copy()  # ensure timestamp column
    df = df.sort_values(["substation_id", "timestamp"])

    # Prepare merge
    df_window = df_window.copy()
    df_window = df_window.sort_values(["substation_id", "timestamp"])

    # Merge on (substation_id, timestamp)
    df = df.merge(
        df_window[
            ["substation_id", "timestamp", "anomaly_score", "predicted_anomaly"]
        ],
        on=["substation_id", "timestamp"],
        how="left",
        suffixes=("", "_win"),
    )

    # Fill NaNs for initial window period
    df["anomaly_score"] = df["anomaly_score"].fillna(0.0)
    df["predicted_anomaly"] = df["predicted_anomaly"].fillna(0).astype(int)

    df.set_index("timestamp", inplace=True)
    df.sort_values(["substation_id", "timestamp"], inplace=True)

    return df


def export_js_artifact(
    df: pd.DataFrame,
    metrics: Dict[str, float],
    out_path: pathlib.Path,
    max_points_per_substation: int = 1000,
) -> None:
    """
    Export a JS file declaring a const GRIDSENSE_TIMESERIES object.
    We downsample per substation to avoid massive payloads.
    """
    # Ensure timestamp is ISO string
    df = df.reset_index().copy()
    df["timestamp_iso"] = df["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    series_records: List[Dict[str, Any]] = []

    for substation_id, grp in df.groupby("substation_id"):
        grp = grp.sort_values("timestamp")
        if len(grp) > max_points_per_substation:
            # simple uniform downsampling
            idx = np.linspace(0, len(grp) - 1, max_points_per_substation).astype(int)
            grp = grp.iloc[idx]

        for _, row in grp.iterrows():
            series_records.append(
                {
                    "timestamp": row["timestamp_iso"],
                    "substation_id": substation_id,
                    "region": row["region"],
                    "load_mw": float(row["load_mw"]),
                    "voltage_kv": float(row["voltage_kv"]),
                    "current_a": float(row["current_a"]),
                    "freq_hz": float(row["freq_hz"]),
                    "oil_temp_c": float(row["oil_temp_c"]),
                    "is_anomaly": int(row["is_anomaly"]),
                    "anomaly_type": row["anomaly_type"],
                    "anomaly_score": float(row["anomaly_score"]),
                    "predicted_anomaly": int(row["predicted_anomaly"]),
                }
            )

    payload = {
        "summary": metrics,
        "series": series_records,
    }

    js_content = "window.GRIDSENSE_TIMESERIES = " + json.dumps(
        payload, indent=2
    ) + ";\n"

    print(f"Writing JS artifact to: {out_path}")
    out_path.write_text(js_content, encoding="utf-8")


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("===================================================")
    print(" GridSense Time Series Anomaly Model (Synthetic) ")
    print("===================================================")
    print(f"Input:  {IN_PARQUET}")
    print(f"Output (JS artifact):         {OUT_JS}")

    if not IN_PARQUET.exists():
        raise FileNotFoundError(
            f"Input parquet not found: {IN_PARQUET}. "
            f"Run synthetic/generate_gridsense_timeseries.py first."
        )

    df_full = pd.read_parquet(IN_PARQUET)
    df_full = df_full.sort_values(["substation_id", "timestamp"])

    print("Building rolling window features...")
    window_df, X = build_window_features(
        df_full.reset_index(), window=WINDOW, feature_cols=FEATURE_COLS
    )
    print(f"Number of windows: {len(window_df)}, feature dim: {X.shape[1]}")

    print("Training IsolationForest...")
    model = train_isolation_forest(X)

    print("Scoring windows...")
    df_window_scores = compute_scores_and_labels(model, X, window_df)

    print("Evaluating detection performance on window labels...")
    metrics = evaluate_detection(df_window_scores)
    print("Metrics:", metrics)

    print("Merging window scores back to full time series...")
    df_with_scores = merge_window_scores_back(df_full, df_window_scores, WINDOW)

    print(f"Saving full series with scores to: {OUT_PARQUET}")
    df_with_scores.to_parquet(OUT_PARQUET)

    print("Exporting JS artifact for frontend...")
    export_js_artifact(df_with_scores, metrics, OUT_JS)

    print("Done.")


if __name__ == "__main__":
    main()