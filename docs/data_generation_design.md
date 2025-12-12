# **Synthetic Data Generation Design — Qognus Demo Platform**

*ApexGrid Systems — Support Ticket Generation via Local LLMs (Ollama)*

---

## **1. Purpose & Scope**

This document describes how **synthetic enterprise support tickets** are generated for the fictional hybrid company **ApexGrid Systems** using **local LLMs via Ollama**.

Synthetic tickets serve as the foundation for:

* embeddings
* clustering
* topic extraction
* anomaly detection
* semantic search
* triage agent workflows
* WebGL visualization

The design ensures:

* high-quality, realistic enterprise data
* zero risk of real PII, customer names, or sensitive content
* consistent adherence to the ApexGrid taxonomy
* repeatability and controllability
* stable vocabulary for embedding clusters

---

# **2. Data Generation Goals**

Synthetic tickets must:

1. **Resemble real enterprise support cases**
2. **Use consistent domain vocabulary** from the product suite
3. **Respect the taxonomy** (category + subcategory)
4. **Produce natural cluster structure** for embeddings
5. **Include metadata** enabling charts & filters
6. **Avoid hallucinating real companies, people, or identifiable brands**
7. **Scale to 5,000–20,000 tickets** without quality collapse

---

# **3. Generation Pipeline Overview**

```text
[Metadata Matrix]
    ↓
[Prompt Builder]
    ↓
[Ollama Chat API]
    ↓
[JSON Validator]
    ↓
[Post-Processor / Normalizer]
    ↓
[data/raw/apexgrid_tickets.jsonl]
```

### Components:

* **Metadata Matrix**
  Pre-generated combinations of product, category, severity, etc.

* **Prompt Builder**
  Creates structured prompts for LLM ticket generation.

* **LLM (Ollama)**
  Local, deterministic-ish generation through system/user messages.

* **JSON Validator**
  Ensures well-formed JSON; re-requests if invalid.

* **Post-Processor**
  Applies cleanup, fixes inconsistencies, enforces taxonomy.

* **Output Writer**
  Appends JSON objects into `.jsonl` for downstream ML pipelines.

---

# **4. Models Used (via Ollama)**

Two local models are recommended:

### **4.1 Primary Ticket Generator**

* **Model:** `qwen2.5:latest` or `qwen2:latest`
* Why:

  * Best local LLM for structured, long-form enterprise text
  * Good JSON adherence
  * Clean domain language

### **4.2 Lightweight Alternative**

* **Model:** `llama3:8b` or `qwen:7b-instruct`
* Why:

  * Fast for generating large batches
  * Good JSON compliance with constrained prompts

---

# **5. Metadata Matrix Design**

Goal: generate diverse tickets while controlling distribution.

Structure (`metadata_matrix.csv` or generator):

| product     | category       | subcategory      | severity | customer_tier | region         | environment |
| ----------- | -------------- | ---------------- | -------- | ------------- | -------------- | ----------- |
| HelioCloud  | observability  | dashboard_error  | Sev3     | midmarket     | us-west-2      | production  |
| GridSense   | telemetry_drop | edge_offline     | Sev2     | enterprise    | eu-central-1   | production  |
| LineaOps    | integration    | PLC_driver_fault | Sev1     | enterprise    | us-east-1      | production  |
| VaultShield | authentication | MFA_failure      | Sev4     | startup       | ap-southeast-1 | staging     |
| ...         | ...            | ...              | ...      | ...           | ...            | ...         |

### Key Rules

* Respect product/domain alignment
* Severity distribution follows guidelines in `support_taxonomy.md`
* Ensure each product/category pair appears at least 100–300 times
* Generate 5–10k rows for robust manifold structure
* Metadata matrix drives ticket diversity, not randomness

---

# **6. Prompt Architecture**

Ticket generation uses **two-layer prompting**: a **system prompt** setting rules and a **user prompt** with metadata for a specific ticket.

---

## **6.1 System Prompt (Global Controls)**

```text
You are generating fully synthetic enterprise support tickets for a fictional company named ApexGrid Systems.

STRICT RULES:
- Never reference real companies, people, locations, or brands.
- Follow the ApexGrid Support Taxonomy exactly.
- Output ONLY valid JSON objects.
- Always include: ticket_id, timestamp, product, category, subcategory, severity, customer_tier, region, environment, channel, summary, description, topics.
- "description" should be 3-8 sentences.
- Use professional enterprise language.
- Do NOT include placeholder text.
- Use terminology consistent with the product domain (HelioCloud, GridSense, LineaOps, VaultShield).

The tickets represent common support issues across cloud observability, energy IoT, manufacturing robotics, and identity security analytics.
```

---

## **6.2 User Prompt (Per Ticket)**

```text
Generate ONE synthetic ApexGrid support ticket as JSON.

Use the following metadata exactly:

ticket_id: "{{ticket_id}}"
product: "{{product}}"
category: "{{category}}"
subcategory: "{{subcategory}}"
severity: "{{severity}}"
customer_tier: "{{customer_tier}}"
region: "{{region}}"
environment: "{{environment}}"
channel: "{{channel}}"

Focus the summary and description on the product domain and taxonomy definitions.
Include a list of short topic tags (2-4 items).
Timestamp should be within the last 30 days.
```

---

# **7. LLM Output Format**

Expected JSON object:

```json
{
  "ticket_id": "TCK-004381",
  "timestamp": "2025-02-12T03:21:44Z",
  "product": "HelioCloud",
  "category": "observability",
  "subcategory": "missing_log_stream",
  "severity": "Sev2",
  "customer_tier": "midmarket",
  "region": "us-west-2",
  "environment": "production",
  "channel": "portal",
  "summary": "Log stream for container group is missing from dashboard.",
  "description": "Our engineering team noticed missing logs from the main container group..."
  ,
  "topics": ["logs", "agent", "dashboard"]
}
```

---

# **8. JSON Validation and Retry Logic**

Tickets must pass validation before being accepted.

Validation checks:

1. JSON loads correctly
2. All required fields exist
3. Values comply with taxonomy
4. Summary is non-empty
5. Description ~3–8 sentences
6. Topics is a list
7. No real PII or unapproved proper nouns
8. No placeholder content (e.g., "lorem ipsum", "example.com")

### If any validation fails:

* Retry **up to 3 times** with a stricter corrective prompt
* Track failed items in logs

---

# **9. Post-Processing & Cleanup**

Performed after validation:

### **9.1 Normalization**

* Trim whitespace
* Canonicalize severity: `Sev1` vs `sev1`
* Convert region codes to canonical (`us-west-2`, etc.)
* Strip accidental real brand mentions (fallback filter)
* Ensure product-specific vocabulary appears

### **9.2 Content Quality Enhancements**

* Confirm summary is short (8–12 words)
* Confirm description uses product vocabulary
* Ensure no repetitive or duplicate text

### **9.3 Optional Augmentations**

* Automatically generate topics if missing (small term-frequency cluster)
* Add `triage_summary` using a compact LLM prompt
* Embed a sentence containing a measurable indicator (latency, voltage, throughput, etc.)

---

# **10. Ticket Volume & Batching**

Recommended volumes:

| Pipeline Purpose | Ticket Count | Notes                                   |
| ---------------- | ------------ | --------------------------------------- |
| Minimal demo     | 500–1,500    | Fast embeddings & UMAP                  |
| Standard demo    | 3,000–5,000  | Strong cluster density                  |
| Advanced         | 10,000+      | Best visual separation & topic clusters |

Batch strategy:

* Generate in chunks of 50–200 tickets
* Checkpoint after each batch
* Each batch receives a unique timestamp seed to avoid clustering artifacts

---

# **11. Determinism and Reproducibility**

To balance LLM creativity with repeatability:

* Set `temperature: 0.7–0.9` for richness
* For reproducibility experiments, use `temperature: 0.2–0.4`
* Persist the metadata matrix
* Persist all system and user prompts for audit
* Save each batch’s generation logs under `data/logs/`

---

# **12. Data Quality Management**

### **12.1 Linguistic Quality**

* Minimum sentence length check
* No contradictions with metadata
* Product vocabulary matching:
  e.g., GridSense → SCADA, sensors, voltage, telemetry

### **12.2 Taxonomy Alignment**

* Tickets must match allowed subcategories
* Cross-product mismatches are rejected:

  * e.g. VaultShield ticket containing `PLC_driver_fault` → invalid
* Category/subcategory pairs validated against `support_taxonomy.md`

### **12.3 Embedding Health Considerations**

* Avoid overly repetitive phrasing
* Ensure metadata distributions match guidelines
* Insert variation via minor stochasticity

---

# **13. Scalability Considerations**

### **13.1 Multi-threading**

Generation can be parallelized:

* One thread per metadata row
* Or batched parallel calls to Ollama
* Respect Ollama model loading constraints (usually 1 model active at a time)

### **13.2 Multi-Model Strategy**

To increase diversity:

* Mix models:

  * 70% `qwen2.5:latest`
  * 30% `llama3:8b`

### **13.3 Long-term Extension**

Future datasets may include:

* synthetic IoT telemetry
* synthetic identity access logs
* synthetic SCADA packets
* synthetic error traces
* synthetic call-center transcripts

All consistent with the same fictional organization.

---

# **14. Folder Structure**

```
data_generation/
│
├── metadata_matrix.csv
├── generate_tickets_ollama.py
├── prompts/
│   ├── system_prompt.txt
│   ├── user_prompt_template.txt
│   └── corrective_prompt.txt
├── validators/
│   ├── json_validator.py
│   ├── taxonomy_validator.py
│   └── pii_filter.py
└── logs/
    ├── batch_0001.log
    ├── batch_0002.log
    └── ...
```

---

# **15. Example Python Code Snippet**

Pseudo-implementation of a batch generator:

```python
def generate_ticket(metadata):
    payload = {
        "model": "qwen2.5:latest",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(metadata)}
        ]
    }

    resp = requests.post("http://localhost:11434/api/chat", json=payload)
    data = extract_json(resp.text)

    if not validate_ticket(data):
        return retry_with_correction(metadata)

    return clean_ticket(data)
```

---

# **16. Summary**

The synthetic data generation system:

* Uses **controlled metadata** to ensure domain diversity
* Uses **structured LLM prompts** to generate realistic text
* Enforces **taxonomy compliance** and vocabulary consistency
* Validates JSON and content quality
* Produces rich unified tickets across four domains
* Scales to thousands of samples
* Ensures clean semantic structure for embeddings & clustering
* Operates **100% locally** with **zero real data**

This system forms the beginning of the full ML pipeline documented in `ml_pipeline_design.md`.