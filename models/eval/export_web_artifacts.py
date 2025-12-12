"""
export_web_artifacts.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Loads processed ApexGrid ML artifacts and exports them as
web-ready JavaScript payloads:

- web/data/ticket_points.js
    window.TICKET_POINTS = { points: [...] }

- web/data/ticket_summary.js
    window.TICKET_SUMMARY = { ... }

These are consumed directly by the static web front-end
(index.html, embedding_viz.js, charts.js, etc.).
"""

import json
import pathlib
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score

# ------------------------------------------------------------
# PATHS
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
PROCESSED_DIR = DATA_DIR / "processed"

TICKETS_PARQUET = PROCESSED_DIR / "tickets.parquet"
MANIFOLD_3D_NPY = PROCESSED_DIR / "manifold_3d.npy"
CLUSTER_LABELS_NPY = PROCESSED_DIR / "cluster_labels.npy"
MODEL_HEALTH_JSON = PROCESSED_DIR / "model_health.json"  # optional

WEB_DIR = pathlib.Path("web")
WEB_DATA_DIR = WEB_DIR / "data"
WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

OUT_POINTS_JS = WEB_DATA_DIR / "ticket_points.js"
OUT_SUMMARY_JS = WEB_DATA_DIR / "ticket_summary.js"


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def load_core_artifacts():
    """Load tickets DataFrame, 3D manifold coordinates, and cluster labels."""
    if not TICKETS_PARQUET.exists():
        raise FileNotFoundError(
            f"Missing {TICKETS_PARQUET}. Run compute_embeddings.py first."
        )
    if not MANIFOLD_3D_NPY.exists():
        raise FileNotFoundError(
            f"Missing {MANIFOLD_3D_NPY}. Run cluster_umap_hdbscan.py first."
        )
    if not CLUSTER_LABELS_NPY.exists():
        raise FileNotFoundError(
            f"Missing {CLUSTER_LABELS_NPY}. Run cluster_umap_hdbscan.py first."
        )

    print(f"Loading tickets from: {TICKETS_PARQUET}")
    df = pd.read_parquet(TICKETS_PARQUET)

    print(f"Loading manifold 3D from: {MANIFOLD_3D_NPY}")
    coords_3d = np.load(MANIFOLD_3D_NPY)

    print(f"Loading cluster labels from: {CLUSTER_LABELS_NPY}")
    labels = np.load(CLUSTER_LABELS_NPY)

    if len(df) != coords_3d.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs coords={coords_3d.shape[0]}"
        )
    if len(df) != labels.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs labels={labels.shape[0]}"
        )

    return df, coords_3d, labels


def maybe_load_model_health(manifold_3d, labels):
    """
    Try to load precomputed model_health.json.
    If not found, compute a minimal set of metrics inline.
    """
    if MODEL_HEALTH_JSON.exists():
        print(f"Loading model health from: {MODEL_HEALTH_JSON}")
        with MODEL_HEALTH_JSON.open("r", encoding="utf-8") as f:
            return json.load(f)

    print("model_health.json not found; computing basic metrics inline...")

    n = len(labels)
    noise_mask = labels == -1
    noise_fraction = float(noise_mask.sum()) / float(n)

    # Compute silhouette only on non-noise labels, if possible
    unique_labels = set(labels) - {-1}
    if len(unique_labels) >= 2:
        valid_mask = labels != -1
        try:
            avg_silhouette = float(
                silhouette_score(manifold_3d[valid_mask], labels[valid_mask])
            )
        except Exception as e:
            print(f"Silhouette computation failed: {e}")
            avg_silhouette = None
    else:
        avg_silhouette = None

    # Cluster sizes (excluding noise)
    cluster_sizes = Counter(l for l in labels if l != -1)
    largest_cluster_size = max(cluster_sizes.values()) if cluster_sizes else 0
    num_clusters = len(cluster_sizes)

    return {
        "numTickets": int(n),
        "numClusters": int(num_clusters),
        "noiseFraction": float(noise_fraction),
        "avgSilhouette": avg_silhouette,
        "largestClusterSize": int(largest_cluster_size),
    }


def export_ticket_points(df: pd.DataFrame, coords_3d: np.ndarray, labels: np.ndarray):
    """
    Export a JS file with point coordinates + metadata for WebGL rendering.

    Structure:
    window.TICKET_POINTS = {
      points: [
        { id, x, y, z, product, category, severity, clusterId, isP1, ... },
        ...
      ]
    }
    """
    print(f"Exporting ticket_points.js → {OUT_POINTS_JS}")

    points = []
    for i, row in df.iterrows():
        x, y, z = coords_3d[i].tolist()
        severity = row.get("severity", "")
        point = {
            "id": row.get("ticket_id", f"TCK-{i:06d}"),
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "product": row.get("product", ""),
            "category": row.get("category", ""),
            "subcategory": row.get("subcategory", ""),
            "severity": severity,
            "customerTier": row.get("customer_tier", ""),
            "region": row.get("region", ""),
            "environment": row.get("environment", ""),
            "clusterId": int(labels[i]),
            "isP1": bool(severity == "Sev1"),
        }
        points.append(point)

    payload = {"points": points}

    with OUT_POINTS_JS.open("w", encoding="utf-8") as f:
        f.write("window.TICKET_POINTS = ")
        json.dump(payload, f)
        f.write(";\n")


def export_ticket_summary(df: pd.DataFrame, labels: np.ndarray, health: dict):
    """
    Export high-level summary metrics and distributions for Chart.js.

    Structure:
    window.TICKET_SUMMARY = {
      numTickets,
      severityDistribution,
      categoryCounts,
      productCounts,
      clusterStats: { numClusters, avgSilhouette, noiseFraction, largestClusterSize }
    }
    """
    print(f"Exporting ticket_summary.js → {OUT_SUMMARY_JS}")

    n = len(df)

    # Severity distribution
    sev_counts = Counter(df["severity"].fillna("unknown"))
    severity_distribution = {
        sev: count / n for sev, count in sev_counts.items()
    }

    # Category & product counts (absolute)
    cat_counts = Counter(df["category"].fillna("unknown"))
    product_counts = Counter(df["product"].fillna("unknown"))

    # Cluster stats from model health (precomputed or inline)
    cluster_stats = {
        "numClusters": int(health.get("numClusters", 0)),
        "avgSilhouette": health.get("avgSilhouette", None),
        "noiseFraction": float(health.get("noiseFraction", 0.0)),
        "largestClusterSize": int(health.get("largestClusterSize", 0)),
    }

    summary = {
        "numTickets": int(n),
        "severityDistribution": severity_distribution,
        "categoryCounts": dict(cat_counts),
        "productCounts": dict(product_counts),
        "clusterStats": cluster_stats,
    }

    with OUT_SUMMARY_JS.open("w", encoding="utf-8") as f:
        f.write("window.TICKET_SUMMARY = ")
        json.dump(summary, f)
        f.write(";\n")


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — Export Web Artifacts")
    print("==============================================")

    df, coords_3d, labels = load_core_artifacts()
    health = maybe_load_model_health(coords_3d, labels)

    export_ticket_points(df, coords_3d, labels)
    export_ticket_summary(df, labels, health)

    print("Web artifacts exported successfully.")
    print("You can now open the web app (e.g. `cd web && python -m http.server 3000`).")
    print()


if __name__ == "__main__":
    main()
