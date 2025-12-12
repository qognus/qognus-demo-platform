"""
compute_embeddings.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Loads synthetic ApexGrid support tickets, normalizes fields, computes text
embeddings via a local Ollama model, and stores:
- tickets.parquet
- ticket_meta.json
- embeddings.npy
- embedding_ids.json

This script is designed to match the pipeline defined in:
docs/ml_pipeline_design.md
docs/support_taxonomy.md
docs/data_generation_design.md
"""

import json
import time
import pathlib
import requests
import numpy as np
import pandas as pd
from tqdm import tqdm

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_TICKETS = DATA_DIR / "raw" / "apexgrid_tickets.jsonl"

PROCESSED_DIR = DATA_DIR / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

OUT_PARQUET = PROCESSED_DIR / "tickets.parquet"
OUT_META = PROCESSED_DIR / "ticket_meta.json"
OUT_EMBED = PROCESSED_DIR / "embeddings.npy"
OUT_IDS = PROCESSED_DIR / "embedding_ids.json"

OLLAMA_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "mxbai-embed-large"    # or "nomic-embed-text"


# ------------------------------------------------------------
# UTILS
# ------------------------------------------------------------

def load_jsonl(path: pathlib.Path) -> list[dict]:
    """Load JSON lines file."""
    items = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                items.append(obj)
            except json.JSONDecodeError:
                print(f"Skipping malformed JSON line: {line[:120]}...")
    return items


def normalize_ticket(t: dict) -> dict:
    """Normalize one ticket’s fields based on defined data model."""
    # Ensure required fields exist
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
        # try capitalizing existing numeric field
        digits = "".join(c for c in sev if c.isdigit())
        sev = f"Sev{digits}" if digits else "Sev4"
    t["severity"] = sev

    # Canonical region (fallback)
    t["region"] = t["region"].strip().lower()

    # Combine text fields
    summary = t["summary"] or ""
    description = t["description"] or ""
    t["text"] = (summary + " " + description).strip()

    return t


def get_embedding_ollama(text: str, model: str = EMBED_MODEL) -> list[float]:
    """Call Ollama embedding endpoint. Returns vector."""
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": text},
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        return data["embedding"]
    except Exception as e:
        print(f"[ERROR] Embedding failed: {e}. Retrying in 2 seconds.")
        time.sleep(2)
        # single retry
        resp = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": text},
            timeout=30
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


# ------------------------------------------------------------
# MAIN PIPELINE
# ------------------------------------------------------------

def main():
    print("==============================================")
    print(" Qognus Demo Platform — Compute Embeddings")
    print("==============================================")
    print(f"Loading tickets from: {RAW_TICKETS}")

    if not RAW_TICKETS.exists():
        raise FileNotFoundError(
            f"Cannot find synthetic ticket file at {RAW_TICKETS}. "
            f"Ensure you ran generate_tickets_ollama.py first."
        )

    raw_items = load_jsonl(RAW_TICKETS)
    if not raw_items:
        raise RuntimeError("No valid tickets found. Aborting.")

    print(f"Loaded {len(raw_items)} tickets.")

    # Normalize
    print("Normalizing...")
    normed = [normalize_ticket(t) for t in raw_items]
    df = pd.DataFrame(normed)

    # Save metadata (ticket_id -> metadata)
    print("Saving metadata...")
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

    # Save parquet
    df.to_parquet(OUT_PARQUET, index=False)
    print(f"Saved tickets.parquet → {OUT_PARQUET}")

    # ---------------------------------------------------------
    # Compute embeddings
    # ---------------------------------------------------------
    print("\nComputing embeddings from Ollama …")
    texts = df["text"].tolist()
    ticket_ids = df["ticket_id"].tolist()

    all_embeddings = []
    for text in tqdm(texts, desc="Embedding"):
        vec = get_embedding_ollama(text)
        all_embeddings.append(vec)

    emb_matrix = np.array(all_embeddings, dtype=np.float32)

    # Save embeddings & id alignment
    np.save(OUT_EMBED, emb_matrix)
    with OUT_IDS.open("w", encoding="utf-8") as f:
        json.dump(ticket_ids, f, indent=2)

    print(f"\nSaved embeddings → {OUT_EMBED}")
    print(f"Saved embedding_ids → {OUT_IDS}")

    print("\nDone.\n")


# ------------------------------------------------------------
# ENTRYPOINT
# ------------------------------------------------------------

if __name__ == "__main__":
    main()
