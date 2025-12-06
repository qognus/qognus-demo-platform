## 🔹 README.md

````markdown
# Qognus Demo Platform  
*A fully synthetic, production-style environment for applied AI/ML demos*

The **Qognus Demo Platform** is an end-to-end demonstration and experimentation environment built around a fictional hybrid enterprise, **ApexGrid Systems**. It provides realistic synthetic datasets, embedding & clustering pipelines, model-health evaluation, agent workflows, and an interactive WebGL visualization layer.

This project enables safe, compliance-free demonstrations of real enterprise AI concepts across:
- NLP and text classification  
- embeddings & vector search  
- anomaly detection  
- multi-modal clustering  
- LLM-based ticket generation  
- agentic triage workflows  
- forecasting & operational analytics  

It is suitable for:
- client proofs of concept  
- consulting engagements  
- internal demos and playbooks  
- technical workshops and conference talks  
- websites and portfolios  
- research prototypes  

---

## 🔧 Key Components

### 1. Synthetic Enterprise Environment — ApexGrid Systems

ApexGrid is a fictional mid-to-large hybrid enterprise operating across SaaS, energy utilities, industrial IoT, and cybersecurity.

Products:

- **HelioCloud** — SaaS observability & APM  
- **GridSense** — energy/utility IoT monitoring  
- **LineaOps** — manufacturing & robotics telemetry  
- **VaultShield** — identity & security analytics  

The repository includes documentation describing:

- the product suite  
- support ticket taxonomy  
- operational challenges  
- customer tiers and regions  
- realistic metadata schema  

This serves as the canonical foundation for all synthetic data and ML pipelines.

---

### 2. Synthetic Data Generation (Local LLM via Ollama)

The `/synthetic` module uses local LLMs (e.g. Qwen, LLaMA via **Ollama**) to generate thousands of fully synthetic support tickets, each including:

- product, category, subcategory  
- severity and customer tier  
- environment and region  
- timestamp  
- summary and full description  
- optional LLM-generated topics  

All data is:

- fictional and non-identifying  
- free from real PII or company names  
- consistent with the ApexGrid taxonomy  

Main pieces:

- `synthetic/generate_tickets_ollama.py`  
- prompt templates per product  
- sample batches for inspection and testing  

---

### 3. Embedding & Clustering Pipeline

Located in `/models/embed` and `/models/cluster`, this pipeline transforms synthetic text into high-dimensional vectors using local embedding models such as:

- `mxbai-embed-large`  
- `nomic-embed-text`  

It then applies:

- UMAP / t-SNE / PaCMAP for 2D/3D manifolds  
- HDBSCAN or similar algorithms for semantic clustering  
- duplicate/near-duplicate detection  
- cluster labeling and keyword extraction  

Outputs include:

- `ticket_points.js` for WebGL visualizations  
- `embeddings.npy`  
- `cluster_labels.npy`  

---

### 4. Model Evaluation / Health Metrics

The `/models/eval` module provides metrics to characterize the embedding and clustering quality, such as:

- silhouette scores  
- cluster cohesion and separation  
- cluster stability  
- topic entropy  
- severity and category distributions  
- drift over time  
- precision@k for duplicate retrieval  
- cluster purity (when ground-truth labels are used)  

Aggregated outputs are written to:

- `model_health.json`  
- JavaScript payloads consumed by the web UI  

---

### 5. Interactive Web Visualization (WebGL + Charts)

The `/web` folder contains a standalone visualization layer built with:

- **Three.js** for 3D point clouds  
- **TailwindCSS** for styling  
- **Chart.js** for charts  
- lightweight **Vue.js** state management  

Features:

- 3D embedding view of support tickets  
- coloring by category, product, or severity  
- hover tooltips for representative samples  
- charts for category distribution, severity mix, and volume over time  
- model-health and cluster-quality summaries  

This layer can be embedded into websites or used standalone for live demos.

---

## 📁 Repository Structure

```text
qognus-demo-platform/
│
├── data/
│   ├── raw/
│   ├── processed/
│   └── taxonomy/
│
├── synthetic/
│   ├── generate_tickets_ollama.py
│   ├── prompts/
│   └── examples/
│
├── models/
│   ├── embed/
│   ├── cluster/
│   └── eval/
│
├── web/
│   ├── index.html
│   ├── js/
│   ├── css/
│   └── assets/
│
├── docs/
│   ├── apexgrid_overview.md
│   ├── product_suite.md
│   ├── support_taxonomy.md
│   ├── ml_pipeline_design.md
│   └── architecture.png
│
└── notebooks/
    ├── 01_generate_synthetic.ipynb
    ├── 02_embeddings.ipynb
    ├── 03_clustering.ipynb
    ├── 04_model_health.ipynb
    └── 05_visualization_prototyping.ipynb
````

---

## 🚀 Getting Started

### 1. Install dependencies

#### Python

```bash
pip install -r requirements.txt
```

#### Ollama

Install from: [https://ollama.com/download](https://ollama.com/download)

Pull the required models, for example:

```bash
ollama pull qwen3:8b
ollama pull mxbai-embed-large
```

---

### 2. Generate synthetic tickets

```bash
python synthetic/generate_tickets_ollama.py
```

This will create a JSONL file of synthetic support tickets under `data/raw/` (or similar, depending on configuration).

---

### 3. Compute embeddings

```bash
python models/embed/compute_embeddings.py
```

Embeddings are written to `data/processed/embeddings.npy` and corresponding metadata structures.

---

### 4. Cluster & evaluate

```bash
python models/cluster/cluster_umap_hdbscan.py
python models/eval/embedding_health.py
```

Cluster assignments, manifold coordinates, and evaluation metrics are stored in `data/processed/` and web-ready JS files in `web/data/`.

---

### 5. Launch the web visualization

From the `web` directory:

```bash
cd web
python -m http.server 3000
```

Then open:

```text
http://localhost:3000
```

in a browser to explore the 3D embedding, charts, and model-health summaries.

---

## 🧠 Intended Use

The Qognus Demo Platform is designed to:

* demonstrate applied AI/ML techniques without real-world data
* support repeatable, transparent POCs with a consistent synthetic enterprise
* act as a sandbox for experimenting with embeddings, clustering, and agent workflows
* provide visually compelling assets for presentations, workshops, and websites

Because all data is synthetic and the enterprise is fictional, it can be safely shared, extended, and adapted.

---

## 🛡 License

MIT – see `LICENSE` for details.
Suitable for demos, workshops, educational use, and research.
