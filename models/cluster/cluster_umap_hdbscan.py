"""
cluster_umap_hdbscan.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Takes precomputed embeddings for synthetic ApexGrid support tickets and:

1. Loads ticket metadata + embeddings
2. Computes a 3D manifold projection using UMAP
3. Runs HDBSCAN clustering on the 3D manifold
4. Generates lightweight cluster summaries
5. Saves:
   - manifold_3d.npy
   - cluster_labels.npy
   - cluster_summary.json

This script is designed to match the pipeline defined in:
- docs/ml_pipeline_design.md
- docs/architecture.md
"""

import json
import pathlib
from collections import Counter

import numpy as np
import pandas as pd

import umap
import hdbscan
from sklearn.feature_extraction.text import TfidfVectorizer


# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
PROCESSED_DIR = DATA_DIR / "processed"

TICKETS_PARQUET = PROCESSED_DIR / "tickets.parquet"
EMBED_NPY = PROCESSED_DIR / "embeddings.npy"

OUT_MANIFOLD = PROCESSED_DIR / "manifold_3d.npy"
OUT_LABELS = PROCESSED_DIR / "cluster_labels.npy"
OUT_CLUSTER_SUMMARY = PROCESSED_DIR / "cluster_summary.json"

# UMAP parameters — tweak for aesthetics vs. structure
UMAP_N_COMPONENTS = 3
UMAP_N_NEIGHBORS = 30
UMAP_MIN_DIST = 0.1
UMAP_METRIC = "cosine"
UMAP_RANDOM_STATE = 42

# HDBSCAN parameters — tweak for cluster granularity
HDBSCAN_MIN_CLUSTER_SIZE = 30
HDBSCAN_MIN_SAMPLES = 10
HDBSCAN_METRIC = "euclidean"
HDBSCAN_SELECTION_EPS = 0.05


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def load_data():
    """Load tickets DataFrame and embeddings matrix."""
    if not TICKETS_PARQUET.exists():
        raise FileNotFoundError(
            f"Missing {TICKETS_PARQUET}. Run compute_embeddings.py first."
        )
    if not EMBED_NPY.exists():
        raise FileNotFoundError(
            f"Missing {EMBED_NPY}. Run compute_embeddings.py first."
        )

    print(f"Loading tickets from: {TICKETS_PARQUET}")
    df = pd.read_parquet(TICKETS_PARQUET)

    print(f"Loading embeddings from: {EMBED_NPY}")
    embeddings = np.load(EMBED_NPY)

    if len(df) != embeddings.shape[0]:
        raise ValueError(
            f"Row count mismatch: tickets={len(df)} vs embeddings={embeddings.shape[0]}"
        )

    return df, embeddings


def compute_umap_3d(embeddings: np.ndarray) -> np.ndarray:
    """Compute a 3D UMAP projection."""
    print("Computing UMAP 3D projection...")
    reducer = umap.UMAP(
        n_components=UMAP_N_COMPONENTS,
        n_neighbors=UMAP_N_NEIGHBORS,
        min_dist=UMAP_MIN_DIST,
        metric=UMAP_METRIC,
        random_state=UMAP_RANDOM_STATE,
    )
    coords_3d = reducer.fit_transform(embeddings)
    print("UMAP completed.")

    # Normalize to a reasonable cube for WebGL (approx [-3, 3]^3)
    max_abs = max(abs(coords_3d).max(), 1e-6)
    coords_norm = coords_3d / max_abs * 3.0

    return coords_norm


def run_hdbscan(coords_3d: np.ndarray) -> np.ndarray:
    """Run HDBSCAN clustering on 3D coordinates."""
    print("Running HDBSCAN clustering...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE,
        min_samples=HDBSCAN_MIN_SAMPLES,
        metric=HDBSCAN_METRIC,
        cluster_selection_epsilon=HDBSCAN_SELECTION_EPS,
    )
    labels = clusterer.fit_predict(coords_3d)

    num_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_fraction = float((labels == -1).sum()) / len(labels)

    print(f"HDBSCAN found {num_clusters} clusters.")
    print(f"Noise fraction: {noise_fraction:.3f}")

    return labels


def summarize_clusters(df: pd.DataFrame, labels: np.ndarray, max_terms: int = 8):
    """
    Build a simple summary for each cluster:
    - size
    - dominant product
    - dominant category
    - top keywords from TF-IDF
    """
    print("Building cluster summaries...")

    # Attach labels to DataFrame
    df = df.copy()
    df["clusterId"] = labels

    # Prepare text for TF-IDF (summary + description already in df["text"])
    texts = df["text"].fillna("").tolist()
    vectorizer = TfidfVectorizer(
        max_features=5000,
        ngram_range=(1, 2),
        stop_words="english"
    )
    tfidf = vectorizer.fit_transform(texts)
    vocab = np.array(vectorizer.get_feature_names_out())

    cluster_ids = sorted(set(labels))
    summaries = {}

    for cid in cluster_ids:
        if cid == -1:
            # treat -1 as noise; optionally summarise or skip
            continue

        mask = df["clusterId"] == cid
        idx = np.where(mask.values)[0]
        if len(idx) == 0:
            continue

        cluster_df = df.loc[mask]

        # Basic stats
        size = int(mask.sum())
        product_counts = Counter(cluster_df["product"])
        category_counts = Counter(cluster_df["category"])

        top_product, top_product_count = product_counts.most_common(1)[0]
        top_category, top_category_count = category_counts.most_common(1)[0]

        # Top terms via column-summed TF-IDF
        sub_tfidf = tfidf[idx]
        # sum across documents
        col_sum = np.asarray(sub_tfidf.sum(axis=0)).ravel()
        top_term_idx = col_sum.argsort()[::-1][:max_terms]
        top_terms = vocab[top_term_idx].tolist()

        summaries[str(cid)] = {
            "size": size,
            "topProduct": top_product,
            "topProductFraction": top_product_count / size,
            "topCategory": top_category,
            "topCategoryFraction": top_category_count / size,
            "topTerms": top_terms,
        }

    # Noise summary (optional)
    noise_mask = df["clusterId"] == -1
    noise_size = int(noise_mask.sum())
    if noise_size > 0:
        summaries["-1"] = {
            "size": noise_size,
            "topProduct": None,
            "topProductFraction": None,
            "topCategory": None,
            "topCategoryFraction": None,
            "topTerms": [],
        }

    return summaries


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — UMAP + HDBSCAN")
    print("==============================================")

    df, embeddings = load_data()

    # UMAP 3D projection
    coords_3d = compute_umap_3d(embeddings)
    OUT_MANIFOLD.parent.mkdir(parents=True, exist_ok=True)
    np.save(OUT_MANIFOLD, coords_3d)
    print(f"Saved 3D manifold → {OUT_MANIFOLD}")

    # HDBSCAN clustering
    labels = run_hdbscan(coords_3d)
    np.save(OUT_LABELS, labels.astype(np.int32))
    print(f"Saved cluster labels → {OUT_LABELS}")

    # Cluster summaries
    cluster_summary = summarize_clusters(df, labels)
    with OUT_CLUSTER_SUMMARY.open("w", encoding="utf-8") as f:
        json.dump(cluster_summary, f, indent=2)
    print(f"Saved cluster summary → {OUT_CLUSTER_SUMMARY}")

    print("\nDone.\n")


if __name__ == "__main__":
    main()
