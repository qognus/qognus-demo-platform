# **ML Pipeline Design — Qognus Demo Platform**

*Embedding, clustering, evaluation, and visualization for ApexGrid synthetic data*

---

## 1. Purpose & Scope

This document describes the **end-to-end machine learning pipeline** used in the Qognus Demo Platform for the fictional hybrid enterprise **ApexGrid Systems**.

The pipeline supports:

* LLM-based **synthetic support ticket generation**
* **Text embeddings** for semantic understanding and search
* **Dimensionality reduction** and **clustering** for 2D/3D visualization
* **Model health metrics** and cluster-quality evaluation
* **Web-ready artifacts** (JavaScript payloads) for 3D WebGL and charts
* Optional **agentic workflows** (routing, triage, summarization)

The design prioritizes:

* reproducibility
* explainability
* modular components
* fully synthetic, non-sensitive data
* compatibility with local models via **Ollama**

---

## 2. High-Level Architecture

### 2.1 Pipeline Stages

The ML pipeline is organized into the following stages:

1. **Synthetic Ticket Generation** (LLM via Ollama)
2. **Preprocessing & Normalization**
3. **Embedding Computation**
4. **Manifold Projection (2D/3D)**
5. **Clustering & Topic Extraction**
6. **Model Health & Evaluation Metrics**
7. **Artifact Export (for Web UI)**
8. **Agentic & Triage Workflows** (optional extension)

Visually:

```text
[LLM Synthetic Tickets]
        │
        ▼
[Preprocess & Normalize]
        │
        ▼
[Text Embeddings]
        │
        ├────► [Semantic Search / Duplicate Detection]
        │
        ▼
[Dimensionality Reduction (UMAP/TSNE)]
        │
        ▼
[Clustering (HDBSCAN) & Topics]
        │
        ▼
[Model Health Metrics]
        │
        ▼
[Web Artifacts: JS payloads + charts]
        │
        ▼
[3D WebGL Viz + Dashboards + Agents]
```

---

## 3. Data Inputs & Outputs

### 3.1 Input: Synthetic Tickets

**Source:** `data/raw/apexgrid_tickets.jsonl` (or similar)

Each line contains a JSON object matching the **ApexGrid Support Ticket Schema**:

* `ticket_id`
* `timestamp`
* `product` (HelioCloud, GridSense, LineaOps, VaultShield)
* `category`, `subcategory`
* `severity` (Sev1–Sev4)
* `customer_tier`, `region`, `environment`
* `channel`
* `summary`, `description`
* optional `topics`

Tickets are generated via local models using **Ollama** (see `data_generation_design.md`).

### 3.2 Intermediate Outputs

* `data/processed/tickets.parquet` — normalized DataFrame
* `data/processed/embeddings.npy` — dense embedding matrix `[N x D]`
* `data/processed/ticket_meta.json` — metadata per ticket id
* `data/processed/manifold_3d.npy` — 3D projection `[N x 3]`
* `data/processed/cluster_labels.npy` — cluster ID per ticket
* `data/processed/model_health.json` — evaluation metrics

### 3.3 Web Artifacts

Under `web/data/`:

* `ticket_points.js`

  ```js
  window.TICKET_POINTS = {
    points: [
      {
        id: "TCK-000123",
        x: 0.23,
        y: -1.02,
        z: 1.84,
        product: "HelioCloud",
        category: "observability",
        severity: "Sev2",
        isP1: false,
        clusterId: 5
      },
      ...
    ]
  };
  ```

* `ticket_summary.js`

  ```js
  window.TICKET_SUMMARY = {
    numTickets: 10000,
    severityDistribution: { "Sev1": 0.03, "Sev2": 0.12, ... },
    categoryCounts: { "telemetry_drop": 1200, ... },
    clusterStats: {
      numClusters: 18,
      avgSilhouette: 0.42,
      largestClusterSize: 980,
      noiseFraction: 0.08
    }
  };
  ```

These are directly consumed by `index.html` and associated JS modules.

---

## 4. Synthetic Ticket Generation (Stage 1)

> Detailed prompting lives in `data_generation_design.md`; here we focus on pipeline integration.

**Implementation:** `synthetic/generate_tickets_ollama.py`

### 4.1 Responsibilities

* Call Ollama’s `/api/chat` with:

  * system prompt describing the schema and domain vocabulary
  * user prompt containing fixed metadata (product, severity, etc.)
* Decode and validate the JSON response
* Enforce compliance with taxonomy and schema
* Write tickets to JSONL, e.g.:

```json
{"ticket_id": "TCK-000001", "product": "HelioCloud", "category": "observability", ...}
```

### 4.2 Design Considerations

* Run in **batches** (e.g., 10–50 tickets at a time) for stability
* Validate `category`/`subcategory` against `support_taxonomy.md`
* Ensure no real companies or people are mentioned (prompt-level constraints)
* Keep `description` length manageable (3–8 sentences) to reduce embedding cost

---

## 5. Preprocessing & Normalization (Stage 2)

**Implementation:** `models/embed/compute_embeddings.py` (first half)

### 5.1 Steps

1. Read JSONL → `pandas.DataFrame`

2. Enforce schema:

   * missing fields filled with defaults
   * invalid categories dropped or mapped

3. Combine `summary` + `description` into a `text` field:

   ```python
   df["text"] = df["summary"].fillna("") + " " + df["description"].fillna("")
   ```

4. Normalize metadata values:

   * severity → `Sev1`, `Sev2`, …
   * region → canonical codes (`us-west-2`, etc.)
   * product → one of four known products

5. Optionally filter out extremely short or malformed tickets.

### 5.2 Outputs

* `tickets.parquet`
* `ticket_meta.json` containing ticket id → metadata mapping

---

## 6. Embedding Computation (Stage 3)

**Implementation:** `models/embed/compute_embeddings.py` (second half)
**Embedding models:** local via Ollama, e.g.:

* `mxbai-embed-large`
* `nomic-embed-text`

### 6.1 API Call Pattern

Embedding is done by hitting:

```python
def get_embedding(text: str) -> list[float]:
    resp = requests.post(
        "http://localhost:11434/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text}
    )
    resp.raise_for_status()
    return resp.json()["embedding"]
```

### 6.2 Batch Strategy

* Iterate over `df["text"]`
* For each ticket:

  * compute embedding vector
  * append to an array
* Optionally checkpoint every N tickets

### 6.3 Post-processing

* Store embeddings as `numpy.ndarray` of shape `[N, D]`
* Save to `data/processed/embeddings.npy`
* Verify no NaNs; apply standardization (optional):

  ```python
  from sklearn.preprocessing import StandardScaler
  scaler = StandardScaler()
  embeddings_scaled = scaler.fit_transform(embeddings)
  ```

---

## 7. Manifold Projection (Stage 4)

**Implementation:** `models/cluster/cluster_umap_hdbscan.py` (first part)

The goal here is to map high-dimensional embeddings into a **3D space** for WebGL, and optionally a 2D space for charts.

### 7.1 Algorithms

* Primary: **UMAP** (`umap-learn`)
* Alternative: **t-SNE** or PaCMAP for experimentation

Example (UMAP 3D):

```python
import umap
reducer = umap.UMAP(
    n_components=3,
    n_neighbors=30,
    min_dist=0.1,
    metric="cosine",
    random_state=42,
)
manifold_3d = reducer.fit_transform(embeddings_scaled)
```

### 7.2 Normalization for WebGL

After projection:

```python
max_abs = max(abs(manifold_3d).max(), 1e-6)
manifold_3d_norm = manifold_3d / max_abs * 3.0  # roughly within cube [-3, 3]^3
```

Save:

* `data/processed/manifold_3d.npy`

---

## 8. Clustering & Topic Extraction (Stage 5)

**Implementation:** `models/cluster/cluster_umap_hdbscan.py` (second part)

### 8.1 Clustering

Primary algorithm: **HDBSCAN**

```python
import hdbscan

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=30,
    min_samples=10,
    metric="euclidean",
    cluster_selection_epsilon=0.05,
)
labels = clusterer.fit_predict(manifold_3d)
```

Characteristics:

* `labels[i] == -1` → noise / unassigned
* Remaining labels cluster tickets into semantically related groups

Save:

* `cluster_labels.npy`

### 8.2 Cluster Summaries & Topic Hints

For each cluster:

1. Collect all tickets with that label
2. Extract top keywords using TF–IDF or a simple term-frequency approach
3. Store representative words + counts

Optional: use an LLM to give each cluster a human-readable label:

```text
Cluster 5: "SCADA time synchronization drift across multiple substations."
Cluster 9: "VaultShield MFA false positives and throttling complaints."
```

Summaries stored into:

* `data/processed/cluster_summary.json`

---

## 9. Model Health & Evaluation Metrics (Stage 6)

**Implementation:** `models/eval/embedding_health.py`

The goal is to quantify the quality and behavior of the embedding + clustering.

### 9.1 Core Metrics

* **Silhouette Score**

  ```python
  from sklearn.metrics import silhouette_score
  valid_mask = labels != -1
  if valid_mask.sum() > 1:
      sil = silhouette_score(manifold_3d[valid_mask], labels[valid_mask])
  else:
      sil = None
  ```

* **Cluster Size Distribution**

  * Histogram of size per cluster
  * Fraction of points in noise

* **Category & Product Purity**

  * For each cluster, compute the distribution of:

    * `product`
    * `category`

* **Severity Distribution**

  * Weighted distribution across clusters
  * Fraction of Sev1 concentrated in particular clusters

### 9.2 Optional Retrieval Metrics

For duplicate or near-duplicate detection:

* Build approximate nearest neighbor index (e.g. FAISS or sklearn NearestNeighbors)
* Evaluate **precision@k** for retrieving tickets with identical (or similar) `category` + `subcategory`

Example:

```python
from sklearn.neighbors import NearestNeighbors

nn = NearestNeighbors(n_neighbors=6, metric="cosine").fit(embeddings_scaled)
distances, indices = nn.kneighbors(embeddings_scaled)
# For each ticket, ignore itself (index 0), inspect neighbors 1..5
```

### 9.3 Output Structure

Write results as `model_health.json`:

```json
{
  "numTickets": 10000,
  "numClusters": 18,
  "noiseFraction": 0.08,
  "avgSilhouette": 0.42,
  "largestClusterSize": 980,
  "categoryPurityByCluster": {
    "0": {"telemetry_drop": 0.74, "data_quality": 0.12, "other": 0.14},
    "1": {"observability": 0.89, "latency": 0.07, "other": 0.04}
  },
  "severityDistribution": {
    "Sev1": 0.03,
    "Sev2": 0.12,
    "Sev3": 0.40,
    "Sev4": 0.45
  }
}
```

---

## 10. Artifact Export for Web UI (Stage 7)

**Implementation:** usually part of clustering/eval scripts or a dedicated exporter, e.g. `models/eval/export_web_artifacts.py`.

### 10.1 ticket_points.js

Combine:

* `ticket_id`
* normalized 3D coordinates
* cluster label
* selected metadata fields

Example snippet:

```python
import json
import numpy as np
from pathlib import Path

def export_ticket_points(df, coords_3d, labels, out_path):
    points = []
    for i, row in df.iterrows():
        x, y, z = coords_3d[i].tolist()
        points.append({
            "id": row["ticket_id"],
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "product": row["product"],
            "category": row["category"],
            "severity": row["severity"],
            "clusterId": int(labels[i]),
            "isP1": row["severity"] == "Sev1"
        })

    out = {
        "points": points
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        f.write("window.TICKET_POINTS = ")
        json.dump(out, f)
        f.write(";\n")
```

### 10.2 ticket_summary.js

Aggregate high-level metrics + distributions for charts:

```python
summary = {
  "numTickets": int(len(df)),
  "severityDistribution": severity_dist,
  "categoryCounts": category_counts,
  "productCounts": product_counts,
  "clusterStats": {
    "numClusters": num_clusters,
    "avgSilhouette": sil,
    "noiseFraction": noise_fraction
  }
}
```

Write:

```python
with open("web/data/ticket_summary.js", "w", encoding="utf-8") as f:
    f.write("window.TICKET_SUMMARY = ")
    json.dump(summary, f)
    f.write(";\n")
```

---

## 11. Agentic & Triage Workflows (Stage 8 – Optional)

Beyond visualization, the same embedding + clustering setup can power **agent-style workflows**:

### 11.1 Triage Agent

* Inputs: new ticket text
* Steps:

  1. Embed the ticket
  2. Find nearest neighbors
  3. Infer likely category, severity, and product
  4. Propose:

     * suggested category/subcategory
     * similar past tickets
     * recommended resolution steps
  5. Optionally call an LLM to generate a triage summary

### 11.2 Incident Signature Detection

* Monitor cluster sizes over time
* Identify clusters whose ticket count spikes over a window (e.g., last 24/72 hours)
* Trigger a “potential incident” alert for that cluster

### 11.3 Integration with Web UI

* Provide an API or local endpoint that:

  * takes free-text
  * returns:

    * 3D location
    * nearest existing points
    * recommended cluster
    * triage suggestion

This can be demoed from the browser using a local backend.

---

## 12. Tech Stack Overview

### 12.1 Backend / ML

* **Python 3.x**
* `pandas` / `numpy`
* `scikit-learn` (UMAP, TSNE via separate package, metrics)
* `umap-learn`
* `hdbscan`
* `requests` (for Ollama calls)
* Optional: `faiss` or similar for ANN

### 12.2 Data & Artifacts

* JSONL for raw data
* Parquet / NPY / JSON for processed artifacts
* JS globals for web integration (no backend needed for demo)

### 12.3 Frontend

* **Three.js** for 3D scatterplot
* **TailwindCSS** for layout and styling
* **Chart.js** for charts
* **Vue.js (CDN)** for light state management
* `index.html` served via simple static hosting or `python -m http.server`

---

## 13. Operational Considerations

### 13.1 Batch vs. Real-Time

* The current design is **batch-oriented**:

  * Generate tickets
  * Recompute embeddings
  * Re-run manifold & clustering
  * Export web artifacts

* For real-time or incremental demos, lighter-weight incremental updates could be implemented (e.g., partial embedding + local re-clustering for new tickets), but this is out of scope for the initial design.

### 13.2 Reproducibility

* Fix random seeds:

  * UMAP / TSNE random state
  * HDBSCAN randomness, if applicable
* Version file formats and schema in documentation
* Optionally log runs (e.g., using MLflow or simple JSON run logs)

---

## 14. Summary

The Qognus Demo Platform’s ML pipeline for ApexGrid Systems:

* takes fully synthetic, LLM-generated support tickets
* converts them into dense embeddings suitable for

  * semantic search
  * clustering
  * visualization
* projects them into 3D for a **WebGL point cloud** that is:

  * semantically structured
  * visually compelling
  * easily explainable
* evaluates embedding and cluster quality with interpretable metrics
* exposes artifacts to a static frontend for demos, POCs, and workshops
* can be extended with triage agents, semantic search, and incident detection

This design makes ApexGrid an ideal synthetic “playground” for applied AI/ML in consulting, research, and product storytelling.