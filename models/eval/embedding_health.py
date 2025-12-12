"""
embedding_health.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Evaluates the quality and behavior of the embedding + clustering pipeline.

Loads:
- data/processed/tickets.parquet
- data/processed/embeddings.npy
- data/processed/manifold_3d.npy
- data/processed/cluster_labels.npy

Computes:
- overall silhouette score (on non-noise points)
- noise fraction
- cluster size distribution
- per-cluster product & category purity
- global severity distribution

Writes:
- data/processed/model_health.json

This script matches the design described in:
- docs/ml_pipeline_design.md
- docs/architecture.md
"""

import json
import pathlib
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from sklearn.metrics import silhouette_score

# ------------------------------------------------------------
# PATHS
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
PROCESSED_DIR = DATA_DIR / "processed"

TICKETS_PARQUET = PROCESSED_DIR / "tickets.parquet"
EMBED_NPY = PROCESSED_DIR / "embeddings.npy"
MANIFOLD_3D_NPY = PROCESSED_DIR / "manifold_3d.npy"
CLUSTER_LABELS_NPY = PROCESSED_DIR / "cluster_labels.npy"

OUT_MODEL_HEALTH = PROCESSED_DIR / "model_health.json"


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def load_artifacts():
    """Load tickets, embeddings, 3D manifold, and cluster labels."""
    if not TICKETS_PARQUET.exists():
        raise FileNotFoundError(
            f"Missing {TICKETS_PARQUET}. Run compute_embeddings.py first."
        )
    if not EMBED_NPY.exists():
        raise FileNotFoundError(
            f"Missing {EMBED_NPY}. Run compute_embeddings.py first."
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

    print(f"Loading embeddings from: {EMBED_NPY}")
    embeddings = np.load(EMBED_NPY)

    print(f"Loading manifold 3D from: {MANIFOLD_3D_NPY}")
    coords_3d = np.load(MANIFOLD_3D_NPY)

    print(f"Loading cluster labels from: {CLUSTER_LABELS_NPY}")
    labels = np.load(CLUSTER_LABELS_NPY)

    if len(df) != embeddings.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs embeddings={embeddings.shape[0]}"
        )
    if len(df) != coords_3d.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs coords={coords_3d.shape[0]}"
        )
    if len(df) != labels.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs labels={labels.shape[0]}"
        )

    return df, embeddings, coords_3d, labels


def compute_silhouette(coords_3d: np.ndarray, labels: np.ndarray) -> float | None:
    """
    Compute silhouette score on non-noise points.
    Returns None if not enough clusters.
    """
    unique_labels = set(labels) - {-1}
    if len(unique_labels) < 2:
        print("Not enough non-noise clusters for silhouette score.")
        return None

    valid_mask = labels != -1
    if valid_mask.sum() < 2:
        print("Too few valid points for silhouette score.")
        return None

    try:
        score = silhouette_score(coords_3d[valid_mask], labels[valid_mask])
        return float(score)
    except Exception as e:
        print(f"Silhouette score computation failed: {e}")
        return None


def compute_cluster_stats(df: pd.DataFrame, labels: np.ndarray):
    """
    Compute cluster-level stats:
    - size
    - product purity
    - category purity
    """
    df = df.copy()
    df["clusterId"] = labels

    cluster_ids = sorted(set(labels))
    cluster_sizes = {}
    product_purity = {}
    category_purity = {}

    for cid in cluster_ids:
        mask = df["clusterId"] == cid
        size = int(mask.sum())
        cluster_sizes[str(cid)] = size

        if size == 0:
            product_purity[str(cid)] = {}
            category_purity[str(cid)] = {}
            continue

        sub = df.loc[mask]
        prod_counts = Counter(sub["product"].fillna("unknown"))
        cat_counts = Counter(sub["category"].fillna("unknown"))

        # Convert to fractions
        product_purity[str(cid)] = {
            prod: count / size for prod, count in prod_counts.items()
        }
        category_purity[str(cid)] = {
            cat: count / size for cat, count in cat_counts.items()
        }

    return cluster_sizes, product_purity, category_purity


def compute_severity_distribution(df: pd.DataFrame):
    """Compute global severity distribution across all tickets."""
    sev_counts = Counter(df["severity"].fillna("unknown"))
    n = len(df)
    return {sev: count / n for sev, count in sev_counts.items()}


def compute_label_counts(labels: np.ndarray):
    """Compute counts and noise fraction for cluster labels."""
    n = len(labels)
    noise_mask = labels == -1
    noise_fraction = float(noise_mask.sum()) / float(n)

    cluster_counts = Counter(l for l in labels if l != -1)
    num_clusters = len(cluster_counts)
    largest_cluster_size = max(cluster_counts.values()) if cluster_counts else 0

    return {
        "numClusters": int(num_clusters),
        "noiseFraction": noise_fraction,
        "largestClusterSize": int(largest_cluster_size),
        "clusterCounts": {str(cid): int(sz) for cid, sz in cluster_counts.items()},
    }


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — Embedding Health")
    print("==============================================")

    df, embeddings, coords_3d, labels = load_artifacts()
    n_tickets = len(df)

    print("Computing silhouette score...")
    avg_silhouette = compute_silhouette(coords_3d, labels)
    if avg_silhouette is not None:
        print(f"Average silhouette: {avg_silhouette:.3f}")
    else:
        print("Average silhouette: None")

    print("Computing cluster stats...")
    cluster_sizes, product_purity, category_purity = compute_cluster_stats(df, labels)

    print("Computing label distribution...")
    label_stats = compute_label_counts(labels)

    print("Computing severity distribution...")
    severity_distribution = compute_severity_distribution(df)

    # Assemble health dict
    health = {
        "numTickets": int(n_tickets),
        "avgSilhouette": avg_silhouette,
        "noiseFraction": label_stats["noiseFraction"],
        "numClusters": label_stats["numClusters"],
        "largestClusterSize": label_stats["largestClusterSize"],
        "clusterSizes": cluster_sizes,
        "severityDistribution": severity_distribution,
        "productPurityByCluster": product_purity,
        "categoryPurityByCluster": category_purity,
    }

    OUT_MODEL_HEALTH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_MODEL_HEALTH.open("w", encoding="utf-8") as f:
        json.dump(health, f, indent=2)

    print(f"\nSaved model health → {OUT_MODEL_HEALTH}")
    print("Done.\n")


if __name__ == "__main__":
    main()
