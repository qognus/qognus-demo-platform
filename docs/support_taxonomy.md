# **ApexGrid Support Ticket Taxonomy**

*Unified schema for synthetic ticket generation, embeddings, clustering & triage workflows*

---

## **1. Introduction**

This document defines the official **Support Ticket Taxonomy** for ApexGrid Systems.
The taxonomy is designed to:

* produce realistic synthetic support tickets
* drive clear 2D/3D semantic embedding clusters
* provide consistent metadata for evaluation
* support downstream ML tasks such as routing, topic modeling, and duplicate detection
* reflect the hybrid nature of ApexGrid’s product suite

All categories, subcategories, and metadata fields are fictional and safe for open-source use.

---

# **2. Ticket Data Model**

Every synthetic ticket conforms to the following schema:

| Field           | Type         | Description                                          |
| --------------- | ------------ | ---------------------------------------------------- |
| `ticket_id`     | string       | Unique ticket identifier                             |
| `timestamp`     | ISO8601      | Creation time                                        |
| `product`       | enum         | One of: HelioCloud, GridSense, LineaOps, VaultShield |
| `category`      | enum         | High-level issue area                                |
| `subcategory`   | enum         | More specific issue subtype                          |
| `severity`      | enum         | Sev1–Sev4                                            |
| `customer_tier` | enum         | enterprise, midmarket, startup                       |
| `region`        | enum         | us-west-2, us-east-1, eu-central-1, ap-southeast-1   |
| `environment`   | enum         | production, staging, sandbox                         |
| `channel`       | enum         | email, portal, slack, phone                          |
| `summary`       | string       | Short description                                    |
| `description`   | string       | Full natural-language body                           |
| `topics`        | list<string> | Optional LLM-generated topic hints                   |

This structure ensures strong ML signal while remaining flexible.

---

# **3. Category Overview (Top-Level)**

ApexGrid uses 14 top-level categories spanning SaaS, energy, industrial, and security domains.

These drive major cluster separations in embeddings.

---

## **3.1 authentication**

Issues related to user login, MFA, or identity lifecycle.

**Examples**

* MFA_failure
* SSO_drift
* password_reset_loop
* oauth_token_expired
* unexpected_logout

**Products:** VaultShield, HelioCloud

---

## **3.2 authorization**

RBAC, permissions, and access policy errors.

**Examples**

* permission_denied
* role_mismatch
* policy_conflict
* API_scope_invalid

**Products:** VaultShield, HelioCloud

---

## **3.3 billing**

Financial and usage-related issues.

**Examples**

* invoice_discrepancy
* overage_dispute
* credit_allocation
* subscription_tier_mismatch

**Products:** HelioCloud

---

## **3.4 latency**

Performance or response time degradation.

**Examples**

* p95_spike
* slow_dashboard_render
* trace_latency_regression
* edge_roundtrip_high

**Products:** HelioCloud, LineaOps, GridSense

---

## **3.5 integration**

Failures in third-party or internal system connectors.

**Examples**

* SIEM_connector_failed
* SCADA_protocol_error
* PLC_driver_fault
* SSO_integration_error
* webhook_delivery_failed

**Products:** All, but domain varies

* LineaOps → PLC/OPC-UA
* GridSense → SCADA
* VaultShield → SIEM/SSO
* HelioCloud → webhook/API

---

## **3.6 data_quality**

Issues related to data correctness, completeness, or drift.

**Examples**

* missing_values
* schema_mismatch
* drift_detected
* metric_cardinality_explosion
* timestamp_skew

**Products:** All

---

## **3.7 api_errors**

Errors surfaced via API calls.

**Examples**

* rate_limit_429
* internal_500
* auth_failed_401
* payload_too_large
* malformed_request

**Products:** HelioCloud, VaultShield

---

## **3.8 telemetry_drop**

Loss of sensor, agent, or device data.

**Examples**

* sensor_unreachable
* edge_offline
* gateway_loss
* backlog_spike
* ingestion_gap

**Products:** GridSense, LineaOps, HelioCloud (agent data)

---

## **3.9 security_alerts**

Threat or identity events that triggered analytical modules.

**Examples**

* bruteforce_detected
* anomalous_login
* malicious_IP
* impossible_travel
* MFA_bypass_suspected

**Products:** VaultShield

---

## **3.10 observability**

Dashboards, logs, traces, metrics, and alerting.

**Examples**

* missing_log_stream
* dashboard_error
* alert_deduping_failed
* trace_sampling_bug

**Products:** HelioCloud

---

## **3.11 deployment_failures**

Issues with pushing configuration, firmware, or software updates.

**Examples**

* canary_failed
* rollout_aborted
* edge_firmware_timeout
* agent_upgrade_failed
* PLC_update_incomplete

**Products:** LineaOps, GridSense, HelioCloud

---

## **3.12 firmware**

Hardware-level compatibility issues.

**Examples**

* version_mismatch
* checksum_failure
* hardware_cap_exceeded
* unsupported_firmware

**Products:** LineaOps, GridSense

---

## **3.13 scaling**

Problems with workload capacity or autoscaling mechanisms.

**Examples**

* autoscaler_unresponsive
* pod_eviction_spike
* storage_saturation
* scaling_policy_conflict

**Products:** HelioCloud

---

## **3.14 dashboard_issues**

User-interface or visualisation-related errors.

**Examples**

* widget_failure
* stale_chart
* incorrect_units
* access_denied_in_ui

**Products:** HelioCloud, VaultShield

---

# **4. Subcategory Dictionary**

Below is the consolidated mapping:

```
authentication:
  - MFA_failure
  - SSO_drift
  - oauth_token_expired
  - unexpected_logout
  - credential_validation_error

authorization:
  - permission_denied
  - role_mismatch
  - policy_conflict
  - invalid_scope

billing:
  - invoice_discrepancy
  - duplicate_charge
  - credit_allocation
  - subscription_tier_mismatch

latency:
  - p95_spike
  - trace_delay
  - dashboard_render_slow
  - edge_roundtrip_high

integration:
  - SIEM_connector_failed
  - SCADA_protocol_error
  - PLC_driver_fault
  - webhook_delivery_failed
  - SSO_integration_error

data_quality:
  - missing_values
  - schema_mismatch
  - drift_detected
  - timestamp_skew
  - cardinality_explosion

api_errors:
  - 429_rate_limit
  - 500_internal
  - 401_unauthorized
  - payload_too_large
  - malformed_request

telemetry_drop:
  - sensor_unreachable
  - edge_offline
  - gateway_loss
  - ingestion_gap
  - backlog_spike

security_alerts:
  - bruteforce_detected
  - anomalous_login
  - malicious_IP
  - impossible_travel
  - MFA_bypass_suspected

observability:
  - missing_log_stream
  - dashboard_error
  - trace_sampling_bug
  - alert_deduping_failed

deployment_failures:
  - canary_failed
  - rollout_aborted
  - agent_upgrade_failed
  - PLC_update_incomplete

firmware:
  - version_mismatch
  - checksum_failure
  - unsupported_firmware
  - incompatible_module

scaling:
  - autoscaler_unresponsive
  - storage_saturation
  - pod_evicted
  - scaling_policy_mismatch

dashboard_issues:
  - widget_failure
  - stale_chart
  - incorrect_units
  - rendering_error
```

This dictionary can be referenced directly by LLM prompts, embedding pipelines, or dashboards.

---

# **5. Metadata Distribution Guidelines**

This section defines how synthetic data should be balanced for realistic domain simulation.

## **Severity Distribution**

* **Sev1:** 3%
* **Sev2:** 12%
* **Sev3:** 40%
* **Sev4:** 45%

## **Product Distribution**

Ideal for clustering variety:

* HelioCloud — 40%
* GridSense — 25%
* LineaOps — 20%
* VaultShield — 15%

## **Customer Tier**

* enterprise — 40%
* midmarket — 40%
* startup — 20%

## **Channels**

* portal — 45%
* email — 30%
* slack — 15%
* phone_transcript — 10%

## **Regions**

* us-west-2 — 30%
* us-east-1 — 25%
* eu-central-1 — 25%
* ap-southeast-1 — 20%

These ratios ensure natural cluster density when projecting embeddings.

---

# **6. Triage Workflow Attributes (Optional Extensions)**

Tickets may include optional fields for richer ML demos:

* `predicted_category` (LLM-routing)
* `similar_ticket_ids`
* `requires_escalation`
* `sla_violation_likelihood`
* `related_incident_signature`
* `triage_summary` (LLM-generated)

These fields enable agentic workflows and multi-step automation prototypes.

---

# **7. Topic Keywords for LLM Consistency**

Each product area has domain-specific vocabulary. These help keep synthetic tickets consistent, realistic, and clusterable.

### **HelioCloud (SaaS Observability)**

`p95`, `latency`, `logs`, `traces`, `OpenTelemetry`, `deploy`, `dashboard`, `SLO`, `alert`, `microservice`, `pipeline`, `throughput`, `cardinality`

### **GridSense (Energy IoT)**

`voltage`, `frequency`, `SCADA`, `IEC`, `transformer`, `PTP`, `edge`, `gateway`, `sensor`, `telemetry`, `outage`, `firmware`, `reactive load`

### **LineaOps (Manufacturing)**

`PLC`, `Modbus`, `robot arm`, `workcell`, `reject rate`, `jitter`, `conveyor`, `downtime`, `cycle time`, `encoder`, `firmware push`

### **VaultShield (Identity Security)**

`MFA`, `SSO`, `OAuth`, `SIEM`, `bruteforce`, `anomalous login`, `federation`, `identity risk`, `threat score`, `audit log`

These keywords help drive uniform cluster structure across synthetic datasets.

---

# **8. Summary**

The ApexGrid Support Taxonomy provides a unified cross-product classification system for generating synthetic enterprise support tickets. It creates:

* strong signal for embeddings
* clear subcluster separation
* consistent LLM output
* realistic operational scenarios
* flexible metadata for modelling

This taxonomy is the backbone of the Qognus Demo Platform’s NLP and embeddings pipeline, ensuring repeatable and believable synthetic data across all product domains.
