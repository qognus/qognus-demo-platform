"""
pipelines/vaultshield/export_web_artifacts.py
---------------------------------------------
Reads the NEW "Infra-Safe" session scores and metrics.
Exports to web/data/vaultshield_artifacts.js for the RICH UI.
"""
import json
import pandas as pd
import pathlib

# Input Paths (From your new structure)
SCORES_PATH = pathlib.Path("data/processed/vaultshield_session_scores.parquet")
METRICS_PATH = pathlib.Path("data/metrics/vaultshield_metrics.json")

# Output Path
OUT_JS = pathlib.Path("web/data/vaultshield_artifacts.js")
OUT_JS.parent.mkdir(parents=True, exist_ok=True)

def main():
    if not SCORES_PATH.exists():
        print("Scores file not found. Run score_sessions.py first.")
        return

    # 1. Load Data
    df = pd.read_parquet(SCORES_PATH)
    
    with open(METRICS_PATH) as f:
        metrics_data = json.load(f)

    # 2. Aggregations for "Threat Monitor" Tab
    attack_counts = df[df["is_attack"] == True]["attack_type"].value_counts().to_dict()
    
    # 3. Top Anomaly for "Forensics" Tab
    # Get the single highest scoring session to feature
    top_row = df.nlargest(1, "anomaly_score").iloc[0]
    
    # Parse the risk steps string back to list
    risk_steps = json.loads(top_row["risk_steps"])
    
    # Find the "Worst Transition" for the explanation
    worst_step = max(risk_steps, key=lambda x: x["risk"])
    explanation = f"{worst_step['from']} → {worst_step['to']}"
    
    # Reconstruct event list for the UI timeline
    # (The UI expects a list of event names)
    events = [step["from"] for step in risk_steps]
    events.append(risk_steps[-1]["to"])

    top_anomaly_data = {
        "session_id": top_row["session_id"],
        "user_id": top_row["user_id"],
        "anomaly_score": float(top_row["anomaly_score"]),
        "attack_type": top_row["attack_type"],
        "explanation": explanation,
        "worst_prob": float(2.718**(-worst_step["risk"])), # Convert NLL back to prob for display
        "events": events
    }

    # 4. Construct Final Payload
    payload = {
        "total_sessions": len(df),
        "attack_counts": attack_counts,
        "metrics": metrics_data, # Pass PR-AUC etc.
        "top_anomaly": top_anomaly_data
    }
    
    # 5. Write JS File
    print(f"Exporting merged artifacts to {OUT_JS}...")
    js_content = f"window.VAULTSHIELD_ARTIFACTS = {json.dumps(payload, indent=2)};"
    
    with OUT_JS.open("w", encoding="utf-8") as f:
        f.write(js_content)
        
    print("Done.")

if __name__ == "__main__":
    main()