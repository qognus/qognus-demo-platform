"""
generate_tickets_langchain.py
Qognus Demo Platform — ApexGrid Systems
---------------------------------------

Generates fully synthetic ApexGrid support tickets using a local LLM
via Ollama, with LangChain + Pydantic structured output.

Design:
1. Generate all metadata in Python (ticket_id, product, category, etc.)
2. Ask the LLM ONLY for:
   - summary
   - description
   - topics (list of tags)
3. Use LangChain's PydanticOutputParser to enforce structure.
4. Combine meta + generated body into a final ticket object.

Output:
- data/raw/apexgrid_tickets.jsonl

Each line is a JSON object with:
  ticket_id, timestamp, product, category, subcategory, severity,
  customer_tier, region, environment, channel, summary, description, topics

Idempotent behavior:
- If the JSONL already exists, we read it, find the max ticket index
  (from ticket_id like 'TCK-000123'), and append new tickets after that.
- If we already have >= TOTAL_TICKETS, the script exits without doing work.
"""

import json
import random
import pathlib
import datetime
import time
from typing import Dict, Any, List

from tqdm import tqdm
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_ollama import ChatOllama


# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_DIR = DATA_DIR / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

OUT_JSONL = RAW_DIR / "apexgrid_tickets.jsonl"

# Local Ollama model name; adjust to what you have pulled
# (e.g. "phi3:medium", "phi3:latest", "qwen3:8b", etc.)
OLLAMA_MODEL = "phi3:medium"

# Target total number of tickets in the JSONL
TOTAL_TICKETS = 2000

# Time window for timestamps (last X days)
TIMESTAMP_DAYS_BACK = 30

# Number of retries per ticket if LLM call fails / parses badly
MAX_RETRIES_PER_TICKET = 3


# ------------------------------------------------------------
# TAXONOMY / METADATA DEFINITIONS
# ------------------------------------------------------------

PRODUCTS = ["HelioCloud", "GridSense", "LineaOps", "VaultShield"]

CATEGORIES = {
    "authentication": [
        "MFA_failure",
        "SSO_drift",
        "oauth_token_expired",
        "unexpected_logout",
        "credential_validation_error",
    ],
    "authorization": [
        "permission_denied",
        "role_mismatch",
        "policy_conflict",
        "invalid_scope",
    ],
    "billing": [
        "invoice_discrepancy",
        "duplicate_charge",
        "credit_allocation",
        "subscription_tier_mismatch",
    ],
    "latency": [
        "p95_spike",
        "trace_delay",
        "dashboard_render_slow",
        "edge_roundtrip_high",
    ],
    "integration": [
        "SIEM_connector_failed",
        "SCADA_protocol_error",
        "PLC_driver_fault",
        "webhook_delivery_failed",
        "SSO_integration_error",
    ],
    "data_quality": [
        "missing_values",
        "schema_mismatch",
        "drift_detected",
        "timestamp_skew",
        "cardinality_explosion",
    ],
    "api_errors": [
        "429_rate_limit",
        "500_internal",
        "401_unauthorized",
        "payload_too_large",
        "malformed_request",
    ],
    "telemetry_drop": [
        "sensor_unreachable",
        "edge_offline",
        "gateway_loss",
        "ingestion_gap",
        "backlog_spike",
    ],
    "security_alerts": [
        "bruteforce_detected",
        "anomalous_login",
        "malicious_IP",
        "impossible_travel",
        "MFA_bypass_suspected",
    ],
    "observability": [
        "missing_log_stream",
        "dashboard_error",
        "trace_sampling_bug",
        "alert_deduping_failed",
    ],
    "deployment_failures": [
        "canary_failed",
        "rollout_aborted",
        "agent_upgrade_failed",
        "PLC_update_incomplete",
    ],
    "firmware": [
        "version_mismatch",
        "checksum_failure",
        "unsupported_firmware",
        "incompatible_module",
    ],
    "scaling": [
        "autoscaler_unresponsive",
        "storage_saturation",
        "pod_evicted",
        "scaling_policy_mismatch",
    ],
    "dashboard_issues": [
        "widget_failure",
        "stale_chart",
        "incorrect_units",
        "rendering_error",
    ],
}

SEVERITIES = ["Sev1", "Sev2", "Sev3", "Sev4"]
SEVERITY_WEIGHTS = [0.03, 0.12, 0.40, 0.45]  # Sev1..Sev4

CUSTOMER_TIERS = ["enterprise", "midmarket", "startup"]
CUSTOMER_TIER_WEIGHTS = [0.4, 0.4, 0.2]

REGIONS = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"]
REGION_WEIGHTS = [0.3, 0.25, 0.25, 0.2]

ENVIRONMENTS = ["production", "staging", "sandbox"]
ENV_WEIGHTS = [0.7, 0.2, 0.1]

CHANNELS = ["portal", "email", "slack", "phone"]

PRODUCT_CATEGORY_MAP = {
    "HelioCloud": [
        "observability",
        "latency",
        "integration",
        "data_quality",
        "api_errors",
        "scaling",
        "dashboard_issues",
        "authentication",
        "authorization",
        "billing",
    ],
    "GridSense": [
        "telemetry_drop",
        "integration",
        "data_quality",
        "firmware",
        "deployment_failures",
        "latency",
    ],
    "LineaOps": [
        "telemetry_drop",
        "integration",
        "firmware",
        "deployment_failures",
        "data_quality",
        "latency",
    ],
    "VaultShield": [
        "authentication",
        "authorization",
        "security_alerts",
        "api_errors",
        "dashboard_issues",
        "data_quality",
    ],
}


# ------------------------------------------------------------
# Pydantic model for structured output
# ------------------------------------------------------------

class TicketBody(BaseModel):
    """
    Only the "semantic" parts that the LLM is allowed to generate.
    All other fields (product, category, severity, etc.) are injected
    by Python from metadata.
    """
    summary: str = Field(
        description="A single-sentence summary of the issue."
    )
    description: str = Field(
        description="A detailed description of the issue, 3-8 full sentences."
    )
    topics: List[str] = Field(
        description="List of 2-4 short tags related to this ticket."
    )


# ------------------------------------------------------------
# LangChain setup
# ------------------------------------------------------------

SYSTEM_PROMPT = """
You are generating fully synthetic enterprise support tickets for a fictional company named ApexGrid Systems.

Context:
- HelioCloud: SaaS observability (logs, metrics, traces, dashboards, alerts).
- GridSense: energy & utility IoT monitoring (SCADA, sensors, substations).
- LineaOps: manufacturing & robotics (PLC, lines, conveyors, robot cells).
- VaultShield: identity & security analytics (SSO, MFA, SIEM, anomalous logins).

STRICT RULES:
- Never reference real companies, people, brands, or domains.
- Use only generic references like "the customer", "their cluster", "the grid", etc.
- Align tone with professional enterprise support.
- Do NOT mention that this is synthetic or fictional.
- Do NOT include placeholders like 'lorem ipsum' or 'example.com'.
- You ONLY generate the fields: summary, description, topics.
- The final JSON format is dictated by the schema you are given.
"""

USER_TEMPLATE = """
You are generating the body of a support ticket for the ApexGrid product suite.

Here is the fixed metadata for this ticket (these values are ALREADY decided and must be respected conceptually):

ticket_id: {ticket_id}
timestamp: {timestamp}
product: {product}
category: {category}
subcategory: {subcategory}
severity: {severity}
customer_tier: {customer_tier}
region: {region}
environment: {environment}
channel: {channel}

Write:
- a concise, one-sentence SUMMARY describing the problem.
- a detailed DESCRIPTION of 3-8 full sentences:
  - mention relevant product/region/environment context naturally
  - describe what the customer observed, any diagnostics, and impact
  - keep it realistic and technically grounded for that product & category
- a TOPICS list (2-4 short tags) related to the issue.

You MUST follow the response JSON schema instructions that follow.
"""

PARSER = PydanticOutputParser(pydantic_object=TicketBody)

PROMPT = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("user", USER_TEMPLATE),
    ("assistant", "{format_instructions}"),
])


def make_llm() -> ChatOllama:
    """
    Construct the ChatOllama LLM configured to output JSON.
    """
    return ChatOllama(
        model=OLLAMA_MODEL,
        temperature=0.4,
        format="json",  # important for structured output
    )


def make_chain():
    """
    LCEL chain: Prompt -> LLM -> Pydantic parser.
    Returns TicketBody directly on success.
    """
    llm = make_llm()
    chain = PROMPT | llm | PARSER
    return chain


# ------------------------------------------------------------
# Helpers for metadata / idempotence
# ------------------------------------------------------------

def random_ticket_id(n: int) -> str:
    return f"TCK-{n:06d}"


def random_timestamp_within_days(days_back: int) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    delta = datetime.timedelta(days=random.uniform(0, days_back))
    ts = now - delta
    # ISO 8601 + "Z" marker
    return ts.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def choose_weighted(options: List[str], weights: List[float]) -> str:
    return random.choices(options, weights=weights, k=1)[0]


def build_metadata(index: int) -> Dict[str, Any]:
    """
    Construct the full metadata dict for ticket with numeric index.
    """
    product = random.choice(PRODUCTS)
    category = random.choice(PRODUCT_CATEGORY_MAP[product])
    subcategory = random.choice(CATEGORIES[category])

    severity = choose_weighted(SEVERITIES, SEVERITY_WEIGHTS)
    customer_tier = choose_weighted(CUSTOMER_TIERS, CUSTOMER_TIER_WEIGHTS)
    region = choose_weighted(REGIONS, REGION_WEIGHTS)
    environment = choose_weighted(ENVIRONMENTS, ENV_WEIGHTS)
    channel = random.choice(CHANNELS)

    ticket_id = random_ticket_id(index)
    timestamp = random_timestamp_within_days(TIMESTAMP_DAYS_BACK)

    return {
        "ticket_id": ticket_id,
        "timestamp": timestamp,
        "product": product,
        "category": category,
        "subcategory": subcategory,
        "severity": severity,
        "customer_tier": customer_tier,
        "region": region,
        "environment": environment,
        "channel": channel,
    }


def parse_ticket_index(ticket_id: str) -> int:
    """
    Extract the numeric part from IDs of the form 'TCK-000123'.
    Returns 0 if it can't parse.
    """
    try:
        return int(ticket_id.split("-")[-1])
    except Exception:
        return 0


def load_existing_max_index(path: pathlib.Path) -> int:
    """
    If the JSONL file exists, read it and return the max ticket index.
    If it doesn't exist or is empty, return 0.
    """
    if not path.exists():
        return 0

    max_idx = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                tid = obj.get("ticket_id", "")
                idx = parse_ticket_index(tid)
                if idx > max_idx:
                    max_idx = idx
            except Exception:
                # skip malformed lines
                continue
    return max_idx


# ------------------------------------------------------------
# Ticket generation using LangChain structured output
# ------------------------------------------------------------

def generate_ticket_body(chain, meta: Dict[str, Any]) -> TicketBody:
    """
    Invoke the LangChain chain with retries to get a TicketBody
    (summary, description, topics) for the given metadata.
    """
    for attempt in range(1, MAX_RETRIES_PER_TICKET + 1):
        try:
            result: TicketBody = chain.invoke({
                "ticket_id": meta["ticket_id"],
                "timestamp": meta["timestamp"],
                "product": meta["product"],
                "category": meta["category"],
                "subcategory": meta["subcategory"],
                "severity": meta["severity"],
                "customer_tier": meta["customer_tier"],
                "region": meta["region"],
                "environment": meta["environment"],
                "channel": meta["channel"],
                "format_instructions": PARSER.get_format_instructions(),
            })

            # Simple sanity checks:
            if len(result.summary.strip()) < 10:
                raise ValueError("Summary too short.")
            if len(result.description.split(".")) < 3:
                raise ValueError("Description too short or not enough sentences.")
            if not result.topics:
                raise ValueError("Missing topics.")

            return result

        except Exception as e:
            print(f"[{meta['ticket_id']}] Attempt {attempt} failed: {e}")
            time.sleep(1.5)

    raise RuntimeError(
        f"Failed to generate TicketBody after {MAX_RETRIES_PER_TICKET} attempts."
    )


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("===================================================")
    print(" Qognus Demo Platform — LangChain Structured Tickets")
    print("===================================================")
    print(f"Ollama model: {OLLAMA_MODEL}")
    print(f"Output JSONL: {OUT_JSONL}")
    print(f"Target total tickets: {TOTAL_TICKETS}")

    # Check how many tickets we already have (if any)
    existing_max_idx = load_existing_max_index(OUT_JSONL)

    if existing_max_idx >= TOTAL_TICKETS:
        print(f"Already have {existing_max_idx} tickets (>= target). Nothing to do.")
        return

    already_have = existing_max_idx
    to_generate = TOTAL_TICKETS - already_have

    if existing_max_idx == 0:
        print("No existing tickets found. Will generate from TCK-000001.")
    else:
        print(
            f"Found existing tickets up to TCK-{existing_max_idx:06d}. "
            f"Will append {to_generate} more (to reach {TOTAL_TICKETS})."
        )

    # Build the LLM chain once
    chain = make_chain()

    generated = 0
    failed = 0

    # Open file in APPEND mode (do NOT delete/overwrite)
    with OUT_JSONL.open("a", encoding="utf-8") as f_out:
        # start from existing_max_idx + 1 up to TOTAL_TICKETS
        for idx in tqdm(
            range(existing_max_idx + 1, TOTAL_TICKETS + 1),
            desc="Generating tickets"
        ):
            meta = build_metadata(idx)
            try:
                body = generate_ticket_body(chain, meta)
            except Exception as e:
                print(f"[{meta['ticket_id']}] FAILED: {e}")
                failed += 1
                continue

            ticket = {
                **meta,
                "summary": body.summary,
                "description": body.description,
                "topics": body.topics,
            }

            f_out.write(json.dumps(ticket, ensure_ascii=False) + "\n")
            generated += 1

    print("===================================================")
    print(f"Previously existing: {already_have}")
    print(f"Newly generated:    {generated}")
    print(f"Failed:             {failed}")
    print(f"Total now (approx): {already_have + generated}")
    print(f"Written to:         {OUT_JSONL}")
    print("===================================================")


if __name__ == "__main__":
    main()
