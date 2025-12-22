"""
compute_embeddings.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

UPDATED: Resumable Version (JSONL Cache)
----------------------------------------
This script maintains an append-only JSONL cache (`embeddings_cache.jsonl`).

1. Startup: Reads `embeddings_cache.jsonl` into memory to know what's done.
2. Processing: Appends new embeddings to the file immediately (safe & fast).
3. Finish: Exports the final aligned `embeddings.npy` and `tickets.parquet`.

Interruption (Ctrl+C) is perfectly safe.
"""

import json
import time
import sys
import pathlib
import requests
import numpy as np
import pandas as pd
from tqdm import tqdm

# ------------------------------------------------------------
# SETUP: Import from Central Config
# ------------------------------------------------------------

# Add project root to sys.path so we can import config.py
# (We assume this script is located at: models/embed/compute_embeddings.py)
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from config import RAW_DIR, PROCESSED_DIR, OLLAMA_HOST, MODELS
except ImportError:
    print("❌ Error: Could not import 'config.py'.")
    print(f"   Make sure 'config.py' exists in the project root: {PROJECT_ROOT}")
    sys.exit(1)

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

RAW_TICKETS = RAW_DIR / "apexgrid_tickets.jsonl"

# Ensure processed directory exists
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# Final Artifacts
OUT_PARQUET = PROCESSED_DIR / "tickets.parquet"
OUT_META = PROCESSED_DIR / "ticket_meta.json"
OUT_EMBED = PROCESSED_DIR / "embeddings.npy"
OUT_IDS = PROCESSED_DIR / "embedding_ids.json"

# Intermediate Cache (Append-only JSONL)
CACHE_FILE = PROCESSED_DIR / "embeddings_cache.jsonl"

# Ollama Settings
OLLAMA_URL = f"{OLLAMA_HOST}/api/embeddings"
EMBED_MODEL = MODELS["embed"]


# ------------------------------------------------------------
# UTILS
# ------------------------------------------------------------

def load_jsonl(path: pathlib.Path) -> list[dict]:
    """Load JSON lines file."""
    items = []
    if not path.exists():
        return []
    
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                items.append(obj)
            except json.JSONDecodeError:
                continue
    return items


def normalize_ticket(t: dict) -> dict:
    """Normalize one ticket’s fields."""
    required = [
        "ticket_id", "timestamp", "product", "category", "subcategory",
        "severity", "customer_tier", "region", "environment", "channel",
        "summary", "description"
    ]
    for field in required:
        if field not in t:
            t[field] = ""

    # Canonical severity
    sev = t["severity"].strip()
    if not sev.startswith("Sev"):
        digits = "".join(c for c in sev if c.isdigit())
        sev = f"Sev{digits}" if digits else "Sev4"
    t["severity"] = sev

    # Canonical region
    t["region"] = t["region"].strip().lower()

    # Combine text fields
    summary = t["summary"] or ""
    description = t["description"] or ""
    t["text"] = (summary + " " + description).strip()

    return t


def get_embedding_ollama(text: str, model: str = EMBED_MODEL) -> list[float]:
    """Call Ollama embedding endpoint."""
    payload = {"model": model, "prompt": text}
    
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as e:
        print(f"[WARN] Embedding failed: {e}. Retrying in 2 seconds...")
        time.sleep(2)
        resp = requests.post(OLLAMA_URL, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()["embedding"]


# ------------------------------------------------------------
# CACHE MANAGEMENT
# ------------------------------------------------------------

def load_cache_to_dict() -> dict:
    """
    Reads the JSONL cache and returns a dict: { ticket_id: embedding_list }
    If duplicates exist (rare), the last one wins.
    """
    cache = {}
    if not CACHE_FILE.exists():
        return cache
    
    print(f"Reading cache index from {CACHE_FILE}...")
    with CACHE_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                record = json.loads(line)
                cache[record["ticket_id"]] = record["embedding"]
            except Exception:
                continue
    return cache

def append_to_cache(file_handle, ticket_id, vector):
    """
    Appends a single record to the open file handle.
    """
    record = {"ticket_id": ticket_id, "embedding": vector}
    file_handle.write(json.dumps(record) + "\n")
    file_handle.flush() # Ensure it hits disk immediately


# ------------------------------------------------------------
# MAIN PIPELINE
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — Resumable Embeddings")
    print("==============================================")
    print(f"Model: {EMBED_MODEL}")
    print(f"Config Source: {PROJECT_ROOT}/config.py")
    
    if not RAW_TICKETS.exists():
        raise FileNotFoundError(f"Missing {RAW_TICKETS}")

    # 1. Load Raw Tickets
    raw_items = load_jsonl(RAW_TICKETS)
    if not raw_items:
        raise RuntimeError("No raw tickets found.")
    
    print(f"Loaded {len(raw_items)} raw tickets.")
    
    # 2. Normalize
    print("Normalizing...")
    normed = [normalize_ticket(t) for t in raw_items]
    df = pd.DataFrame(normed)

    # 3. Load Existing Progress
    embedding_cache = load_cache_to_dict()
    print(f"Cache contains {len(embedding_cache)} completed embeddings.")

    # 4. Open Cache File for Appending
    # 'a' mode creates the file if it doesn't exist, and appends if it does.
    print("\nStarting embedding loop (Ctrl+C to pause safely)...")
    
    new_count = 0
    
    try:
        with CACHE_FILE.open("a", encoding="utf-8") as f_cache:
            
            for idx, row in tqdm(df.iterrows(), total=len(df), desc="Embeddings"):
                tid = row["ticket_id"]
                
                # SKIP if already done
                if tid in embedding_cache:
                    continue 

                # COMPUTE
                vec = get_embedding_ollama(row["text"])
                
                # SAVE immediately
                append_to_cache(f_cache, tid, vec)
                
                # Update memory cache too (so we don't re-do it if logic loops)
                embedding_cache[tid] = vec
                new_count += 1
                
    except KeyboardInterrupt:
        print("\n\n[!] Stopped by user. Progress is saved.")
        print(f"You can resume later. ({new_count} new items saved this run)")
        return

    print(f"\nEmbedding complete. ({new_count} new items added)")

    # ---------------------------------------------------------
    # 5. Final Export
    # ---------------------------------------------------------
    # We must ensure the output files align exactly with the DataFrame order
    
    # Verify completeness
    missing = [t for t in df["ticket_id"] if t not in embedding_cache]
    if missing:
        print(f"WARNING: {len(missing)} tickets are still missing. Run script again.")
        return

    print("Generating aligned artifacts...")
    
    ordered_embeddings = []
    ordered_ids = []
    
    for _, row in df.iterrows():
        tid = row["ticket_id"]
        vec = embedding_cache[tid]
        ordered_embeddings.append(vec)
        ordered_ids.append(tid)

    emb_matrix = np.array(ordered_embeddings, dtype=np.float32)

    # Save Parquet
    df.to_parquet(OUT_PARQUET, index=False)
    
    # Save Metadata
    meta_dict = {}
    for _, row in df.iterrows():
        meta_dict[row["ticket_id"]] = {
            "product": row["product"],
            "category": row["category"],
            "subcategory": row["subcategory"],
            "severity": row["severity"],
            "customer_tier": row["customer_tier"],
            "region": row["region"],
            "environment": row["environment"],
            "channel": row["channel"],
            "timestamp": row["timestamp"]
        }
    with OUT_META.open("w", encoding="utf-8") as f:
        json.dump(meta_dict, f, indent=2)

    # Save Embeddings & IDs
    np.save(OUT_EMBED, emb_matrix)
    with OUT_IDS.open("w", encoding="utf-8") as f:
        json.dump(ordered_ids, f, indent=2)

    print(f"\nSUCCESS:")
    print(f"- Tickets:    {OUT_PARQUET}")
    print(f"- Embeddings: {OUT_EMBED} (Shape: {emb_matrix.shape})")
    print("\nYou can now run: python models/cluster/cluster_umap_hdbscan.py")


if __name__ == "__main__":
    main()