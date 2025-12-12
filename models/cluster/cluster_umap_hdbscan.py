"""
cluster_umap_hdbscan.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Takes precomputed embeddings for synthetic ApexGrid support tickets and:
1. Loads ticket metadata + embeddings
2. Computes a 3D manifold projection using UMAP
3. Runs HDBSCAN clustering on the 3D manifold
4. Generates lightweight cluster summaries
5. Saves artifacts for the web UI.

NOTE: The first run may take 1-3 minutes to compile Numba functions.
"""

import json
import pathlib
import time
from collections import Counter

import numpy as np
import pandas as pd
from tqdm import tqdm

# Print immediately so user knows script is alive
print("Importing libraries... (This may pause for Numba compilation)")
import umap
import hdbscan
from sklearn.feature_extraction.text import TfidfVectorizer


# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
PROCESSED_DIR = DATA_DIR / "processed"

TICKETS_PARQUET = PROCESSED_DIR / "tickets.parquet"
EMBED_NPY = PROCESSED_DIR / "embeddings.npy"

OUT_MANIFOLD = PROCESSED_DIR / "manifold_3d.npy"
OUT_LABELS = PROCESSED_DIR / "cluster_labels.npy"
OUT_CLUSTER_SUMMARY = PROCESSED_DIR / "cluster_summary.json"

# UMAP parameters
UMAP_N_COMPONENTS = 3
UMAP_N_NEIGHBORS = 30
UMAP_MIN_DIST = 0.1
UMAP_METRIC = "cosine"
UMAP_RANDOM_STATE = 42

# HDBSCAN parameters
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
        raise FileNotFoundError(f"Missing {TICKETS_PARQUET}")
    if not EMBED_NPY.exists():
        raise FileNotFoundError(f"Missing {EMBED_NPY}")

    print(f"Loading data...")
    df = pd.read_parquet(TICKETS_PARQUET)
    embeddings = np.load(EMBED_NPY)
    
    # Validation
    if len(df) != embeddings.shape[0]:
        raise ValueError(f"Mismatch: {len(df)} tickets vs {embeddings.shape[0]} embeddings")
    
    print(f" -> Loaded {len(df)} records.")
    return df, embeddings


def compute_umap_3d(embeddings: np.ndarray) -> np.ndarray:
    """Compute a 3D UMAP projection."""
    print("\n--- UMAP PROJECTION ---")
    print("Initializing UMAP reducer...")
    
    reducer = umap.UMAP(
        n_components=UMAP_N_COMPONENTS,
        n_neighbors=UMAP_N_NEIGHBORS,
        min_dist=UMAP_MIN_DIST,
        metric=UMAP_METRIC,
        random_state=UMAP_RANDOM_STATE,
        verbose=True # Shows internal UMAP progress
    )
    
    print("Fitting UMAP (First run may take 1-3 mins to compile Numba)...")
    start_time = time.time()
    
    # The fit_transform is the heavy blocking call
    coords_3d = reducer.fit_transform(embeddings)
    
    duration = time.time() - start_time
    print(f"UMAP completed in {duration:.1f} seconds.")

    # Normalize to a reasonable cube for WebGL (approx [-3, 3]^3)
    max_abs = max(abs(coords_3d).max(), 1e-6)
    coords_norm = coords_3d / max_abs * 3.0

    return coords_norm


def run_hdbscan(coords_3d: np.ndarray) -> np.ndarray:
    """Run HDBSCAN clustering on 3D coordinates."""
    print("\n--- HDBSCAN CLUSTERING ---")
    print("Clustering 3D points...")
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE,
        min_samples=HDBSCAN_MIN_SAMPLES,
        metric=HDBSCAN_METRIC,
        cluster_selection_epsilon=HDBSCAN_SELECTION_EPS,
    )
    labels = clusterer.fit_predict(coords_3d)

    num_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_fraction = float((labels == -1).sum()) / len(labels)

    print(f" -> Found {num_clusters} clusters.")
    print(f" -> Noise fraction: {noise_fraction:.1%}")

    return labels


def summarize_clusters(df: pd.DataFrame, labels: np.ndarray, max_terms: int = 8):
    """
    Build a simple summary for each cluster:
    - size, dominant product/category, top TF-IDF keywords
    """
    print("\n--- TOPIC EXTRACTION ---")
    print("Generating cluster summaries...")

    # Attach labels to DataFrame
    df = df.copy()
    df["clusterId"] = labels

    # Prepare text for TF-IDF
    texts = df["text"].fillna("").tolist()
    
    print("Vectorizing text (TF-IDF)...")
    vectorizer = TfidfVectorizer(
        max_features=5000,
        ngram_range=(1, 2),
        stop_words="english"
    )
    tfidf = vectorizer.fit_transform(texts)
    vocab = np.array(vectorizer.get_feature_names_out())

    cluster_ids = sorted(set(labels))
    summaries = {}

    for cid in tqdm(cluster_ids, desc="Summarizing Clusters"):
        if cid == -1: continue # Skip noise summary for now

        mask = df["clusterId"] == cid
        idx = np.where(mask.values)[0]
        if len(idx) == 0: continue

        cluster_df = df.loc[mask]
        size = int(mask.sum())

        # Metadata stats
        prod_counts = Counter(cluster_df["product"])
        cat_counts = Counter(cluster_df["category"])
        top_prod = prod_counts.most_common(1)[0]
        top_cat = cat_counts.most_common(1)[0]

        # Top keywords
        sub_tfidf = tfidf[idx]
        col_sum = np.asarray(sub_tfidf.sum(axis=0)).ravel()
        top_term_idx = col_sum.argsort()[::-1][:max_terms]
        top_terms = vocab[top_term_idx].tolist()

        summaries[str(cid)] = {
            "size": size,
            "topProduct": top_prod[0],
            "topProductFraction": top_prod[1] / size,
            "topCategory": top_cat[0],
            "topCategoryFraction": top_cat[1] / size,
            "topTerms": top_terms,
        }

    return summaries


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — UMAP + HDBSCAN")
    print("==============================================")

    try:
        df, embeddings = load_data()

        # UMAP 3D projection
        coords_3d = compute_umap_3d(embeddings)
        OUT_MANIFOLD.parent.mkdir(parents=True, exist_ok=True)
        np.save(OUT_MANIFOLD, coords_3d)
        print(f" -> Saved manifold: {OUT_MANIFOLD}")

        # HDBSCAN clustering
        labels = run_hdbscan(coords_3d)
        np.save(OUT_LABELS, labels.astype(np.int32))
        print(f" -> Saved labels: {OUT_LABELS}")

        # Cluster summaries
        cluster_summary = summarize_clusters(df, labels)
        with OUT_CLUSTER_SUMMARY.open("w", encoding="utf-8") as f:
            json.dump(cluster_summary, f, indent=2)
        print(f" -> Saved summaries: {OUT_CLUSTER_SUMMARY}")

        print("\nDone! Next steps:")
        print("1. python models/eval/embedding_health.py")
        print("2. python models/eval/export_web_artifacts.py")
        print("\n")

    except KeyboardInterrupt:
        print("\n[!] Script interrupted by user.")
    except Exception as e:
        print(f"\n[!] Error: {e}")

if __name__ == "__main__":
    main()