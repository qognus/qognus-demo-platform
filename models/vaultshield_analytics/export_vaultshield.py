"""
export_vaultshield.py
---------------------
Reads 'session_scores.parquet' and 'vaultshield_auth_logs.jsonl'.
Exports 'web/data/vaultshield_artifacts.js'.
"""
import json
import pandas as pd
import pathlib

DATA_DIR = pathlib.Path("data")
SCORES_FILE = DATA_DIR / "processed" / "session_scores.parquet"
RAW_LOGS = DATA_DIR / "raw" / "vaultshield_auth_logs.jsonl"
OUT_JS = pathlib.Path("web/data/vaultshield_artifacts.js")

def main():
    if not SCORES_FILE.exists():
        print("Scores file not found. Run score_sequences.py first.")
        return

    print("Loading scores...")
    df = pd.read_parquet(SCORES_FILE)
    
    # 1. Attack Counts
    attack_counts = df[df["is_attack"] == True]["attack_type"].value_counts().to_dict()
    
    # 2. Top Anomaly
    # Get the single highest scoring session
    top_session_row = df.iloc[0] # Sorted descending in previous script
    top_sid = top_session_row["session_id"]
    
    # We need the ACTUAL events for this session to draw the timeline
    # Only scanning raw logs for this specific ID to be efficient
    print(f"Fetching events for top anomaly: {top_sid}")
    events = []
    
    # Scan raw logs (inefficient for huge files, fine for demo)
    # A better way in prod is to save events in the parquet, but parquet hates lists of strings
    with RAW_LOGS.open("r", encoding="utf-8") as f:
        for line in f:
            if top_sid in line:
                rec = json.loads(line)
                if rec["session_id"] == top_sid:
                    events.append(rec)
    
    # Sort by time and extract types
    events.sort(key=lambda x: x["timestamp"])
    event_sequence = [e["event_type"] for e in events]

    top_anomaly_data = {
        "session_id": top_sid,
        "user_id": top_session_row["user_id"],
        "anomaly_score": float(top_session_row["anomaly_score"]),
        "attack_type": top_session_row["attack_type"],
        "explanation": top_session_row["explanation"],
        "worst_prob": float(top_session_row["worst_transition_prob"]),
        "events": event_sequence
    }

    # 3. Payload
    payload = {
        "total_sessions": len(df),
        "attack_counts": attack_counts,
        "top_anomaly": top_anomaly_data
    }
    
    # 4. Write JS
    print(f"Exporting to {OUT_JS}...")
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    js_content = f"window.VAULTSHIELD_ARTIFACTS = {json.dumps(payload, indent=2)};"
    
    with OUT_JS.open("w", encoding="utf-8") as f:
        f.write(js_content)
        
    print("Done.")

if __name__ == "__main__":
    main()