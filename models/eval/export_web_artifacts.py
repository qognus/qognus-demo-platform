"""
export_web_artifacts.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Loads processed ApexGrid ML artifacts and exports them as
web-ready JSON/JS payloads.

UPDATED: Now exports pure JSON for Web Components.
"""

import json
import sys
import pathlib
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score

# ------------------------------------------------------------
# SETUP: Import from Central Config
# ------------------------------------------------------------

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from config import PROCESSED_DIR, WEB_DATA_DIR
except ImportError:
    print("❌ Error: Could not import 'config.py'.")
    sys.exit(1)


# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

# Inputs
TICKETS_PARQUET = PROCESSED_DIR / "tickets.parquet"
MANIFOLD_3D_NPY = PROCESSED_DIR / "manifold_3d.npy"
CLUSTER_LABELS_NPY = PROCESSED_DIR / "cluster_labels.npy"
MODEL_HEALTH_JSON = PROCESSED_DIR / "model_health.json"

# Outputs
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

# 1. Legacy JS (Global window vars) - kept for compatibility if needed
OUT_POINTS_JS = WEB_DATA_DIR / "ticket_points.js"
OUT_SUMMARY_JS = WEB_DATA_DIR / "ticket_summary.js"

# 2. Modern JSON (For Web Components)
OUT_POINTS_JSON = WEB_DATA_DIR / "ticket_points.json"
OUT_HEALTH_JSON = WEB_DATA_DIR / "model_health.json"  # <--- The file your UI is missing!


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def load_core_artifacts():
    """Load tickets DataFrame, 3D manifold coordinates, and cluster labels."""
    if not TICKETS_PARQUET.exists():
        raise FileNotFoundError(f"Missing {TICKETS_PARQUET}")
    
    df = pd.read_parquet(TICKETS_PARQUET)
    coords_3d = np.load(MANIFOLD_3D_NPY)
    labels = np.load(CLUSTER_LABELS_NPY)
    return df, coords_3d, labels


def maybe_load_model_health(manifold_3d, labels):
    if MODEL_HEALTH_JSON.exists():
        print(f"Loading model health from: {MODEL_HEALTH_JSON}")
        with MODEL_HEALTH_JSON.open("r", encoding="utf-8") as f:
            return json.load(f)

    # Fallback calculation if file is missing
    print("⚠️  model_health.json not found; computing inline...")
    noise_mask = labels == -1
    noise_fraction = float(noise_mask.sum()) / len(labels)
    cluster_sizes = Counter(l for l in labels if l != -1)
    
    return {
        "numTickets": len(labels),
        "numClusters": len(cluster_sizes),
        "noiseFraction": noise_fraction,
        "avgSilhouette": None, 
        "largestClusterSize": max(cluster_sizes.values()) if cluster_sizes else 0,
    }


def export_ticket_points(df: pd.DataFrame, coords_3d: np.ndarray, labels: np.ndarray):
    print(f"Exporting Points -> {OUT_POINTS_JSON}")

    points = []
    for i, row in df.iterrows():
        x, y, z = coords_3d[i].tolist()
        severity = row.get("severity", "")
        points.append({
            "id": row.get("ticket_id", f"TCK-{i:06d}"),
            "x": float(x), "y": float(y), "z": float(z),
            "product": row.get("product", ""),
            "category": row.get("category", ""),
            "severity": severity,
            "clusterId": int(labels[i]),
            "isP1": bool(severity == "Sev1"),
        })

    payload = {"points": points}

    # Save as JSON (Modern)
    with OUT_POINTS_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f)

    # Save as JS (Legacy)
    with OUT_POINTS_JS.open("w", encoding="utf-8") as f:
        f.write("window.TICKET_POINTS = ")
        json.dump(payload, f)
        f.write(";\n")


def export_ticket_summary(df: pd.DataFrame, labels: np.ndarray, health: dict):
    print(f"Exporting Summary -> {OUT_HEALTH_JSON}")

    n = len(df)
    sev_counts = Counter(df["severity"].fillna("unknown"))
    cat_counts = Counter(df["category"].fillna("unknown"))
    prod_counts = Counter(df["product"].fillna("unknown"))

    cluster_stats = {
        "numClusters": int(health.get("numClusters", 0)),
        "avgSilhouette": health.get("avgSilhouette", None),
        "noiseFraction": float(health.get("noiseFraction", 0.0)),
        "largestClusterSize": int(health.get("largestClusterSize", 0)),
    }

    summary = {
        "numTickets": int(n),
        "severityDistribution": {k: v/n for k,v in sev_counts.items()},
        "categoryCounts": dict(cat_counts),
        "productCounts": dict(prod_counts),
        "clusterStats": cluster_stats,
    }

    # Save as JSON (Modern - matches your HTML data-url)
    with OUT_HEALTH_JSON.open("w", encoding="utf-8") as f:
        json.dump(summary, f)

    # Save as JS (Legacy)
    with OUT_SUMMARY_JS.open("w", encoding="utf-8") as f:
        f.write("window.TICKET_SUMMARY = ")
        json.dump(summary, f)
        f.write(";\n")


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Exporting Web Artifacts (JSON + JS)")
    print("==============================================")
    
    try:
        df, coords_3d, labels = load_core_artifacts()
        health = maybe_load_model_health(coords_3d, labels)

        export_ticket_points(df, coords_3d, labels)
        export_ticket_summary(df, labels, health)

        print("\n✅ Success. Artifacts ready in web/data/")

    except Exception as e:
        print(f"\n[!] Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()