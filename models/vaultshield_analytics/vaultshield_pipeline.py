"""
vaultshield_pipeline.py
Qognus Demo Platform — ApexGrid / VaultShield
---------------------------------------------
End-to-end pipeline:
1. Loads auth logs.
2. Trains Markov Chain on 'normal' sessions.
3. Scores all sessions for sequence anomalies.
4. Exports web artifacts (JSON).
"""

import json
import sys
import pathlib
import numpy as np
import pandas as pd
from collections import defaultdict
from tqdm import tqdm

# ------------------------------------------------------------
# SETUP: Import from Central Config
# ------------------------------------------------------------
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

try:
    from config import RAW_DIR, WEB_DATA_DIR
except ImportError:
    print("❌ Error: Could not import 'config.py'.")
    sys.exit(1)

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------
RAW_LOGS = RAW_DIR / "vaultshield_auth_logs.jsonl"
OUT_JSON = WEB_DATA_DIR / "vaultshield_artifacts.json"

START_TOKEN = "SESSION_START"
END_TOKEN = "SESSION_END"
EPSILON = 1e-9

# ------------------------------------------------------------
# LOGIC
# ------------------------------------------------------------

def load_data():
    if not RAW_LOGS.exists():
        print(f"⚠️  Input {RAW_LOGS} not found. Running generator...")
        import subprocess
        gen_script = PROJECT_ROOT / "synthetic" / "generate_vaultshield_auth_logs.py"
        subprocess.run([sys.executable, str(gen_script)], check=True)

    print("Loading logs...")
    # Read JSONL into DataFrame
    with RAW_LOGS.open("r", encoding="utf-8") as f:
        data = [json.loads(line) for line in f]
    
    return pd.DataFrame(data)

def train_markov_model(df):
    """Trains transition matrix on NON-ATTACK sessions."""
    print("Training Markov Model on normal traffic...")
    
    # Filter ground truth
    normal_df = df[df["is_attack"] == False].sort_values(["session_id", "timestamp_utc"])
    
    transitions = defaultdict(lambda: defaultdict(int))
    
    for _, group in normal_df.groupby("session_id"):
        events = group["event_type"].tolist()
        if not events: continue
        
        # Start -> First
        transitions[START_TOKEN][events[0]] += 1
        
        # Event -> Event
        for i in range(len(events) - 1):
            transitions[events[i]][events[i+1]] += 1
            
        # Last -> End
        transitions[events[-1]][END_TOKEN] += 1
        
    # Convert to probabilities (log space not needed here, we do it at scoring)
    model = {}
    for src, targets in transitions.items():
        total = sum(targets.values())
        model[src] = {tgt: count/total for tgt, count in targets.items()}
        
    return model

def score_session(events, model):
    """Computes anomaly score (-log likelihood)."""
    score = 0.0
    explanation = []
    
    # Pad sequence
    seq = [START_TOKEN] + events + [END_TOKEN]
    
    worst_prob = 1.0
    worst_transition = None
    
    for i in range(len(seq) - 1):
        u, v = seq[i], seq[i+1]
        
        # Get prob (use epsilon if transition never seen)
        prob = model.get(u, {}).get(v, EPSILON)
        
        # Log-Likelihood (lower prob = higher score)
        nll = -np.log(prob)
        score += nll
        
        if prob < worst_prob:
            worst_prob = prob
            worst_transition = f"{u} → {v}"
            
    # Normalize by length to avoid penalizing long sessions purely for length
    norm_score = score / len(seq)
    return norm_score, worst_transition, worst_prob

def run_scoring(df, model):
    print(f"Scoring {df['session_id'].nunique()} sessions...")
    
    df_sorted = df.sort_values(["session_id", "timestamp_utc"])
    results = []
    
    for sid, group in tqdm(df_sorted.groupby("session_id")):
        events = group["event_type"].tolist()
        meta = group.iloc[0]
        
        score, reason, prob = score_session(events, model)
        
        results.append({
            "session_id": sid,
            "user_id": meta["user_id"],
            "is_attack": bool(meta["is_attack"]),
            "attack_type": meta.get("attack_type"),
            "anomaly_score": round(score, 4),
            "explanation": reason,
            "worst_prob": prob,
            "events": events
        })
        
    return pd.DataFrame(results)

def export_artifacts(results_df):
    print(f"Exporting to {OUT_JSON}...")
    
    # 1. Attack Stats
    attacks = results_df[results_df["is_attack"] == True]
    counts = attacks["attack_type"].value_counts().to_dict()
    
    # 2. Metrics (Detection Performance)
    # Simple threshold-based recall/precision simulation
    threshold = results_df[results_df["is_attack"]==False]["anomaly_score"].quantile(0.99)
    y_pred = results_df["anomaly_score"] > threshold
    y_true = results_df["is_attack"]
    
    tp = ((y_pred) & (y_true)).sum()
    fp = ((y_pred) & (~y_true)).sum()
    fn = ((~y_pred) & (y_true)).sum()
    
    precision = tp / (tp + fp) if (tp+fp) > 0 else 0
    recall = tp / (tp + fn) if (tp+fn) > 0 else 0
    
    # 3. Top Anomaly (Forensics)
    top = results_df.nlargest(1, "anomaly_score").iloc[0]
    top_dict = {
        "session_id": top["session_id"],
        "user_id": top["user_id"],
        "anomaly_score": top["anomaly_score"],
        "attack_type": top["attack_type"],
        "explanation": top["explanation"],
        "worst_prob": top["worst_prob"],
        "events": top["events"]
    }
    
    # 4. Score Distribution (Histogram data)
    bins = [0, 5, 10, 15, 20, 100]
    labels = ["0-5", "5-10", "10-15", "15-20", "20+"]
    
    normal_scores = results_df[~results_df["is_attack"]]["anomaly_score"]
    attack_scores = results_df[results_df["is_attack"]]["anomaly_score"]
    
    hist_norm = pd.cut(normal_scores, bins=bins, labels=labels).value_counts().sort_index().tolist()
    hist_attack = pd.cut(attack_scores, bins=bins, labels=labels).value_counts().sort_index().tolist()

    payload = {
        "total_sessions": len(results_df),
        "attack_counts": counts,
        "metrics": {
            "pr_auc": precision, # Approximation for demo
            "recall": recall,
            "threshold": threshold
        },
        "top_anomaly": top_dict,
        "dist_labels": labels,
        "dist_normal": hist_norm,
        "dist_attack": hist_attack
    }
    
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(payload, f)
    print("Done.")

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==================================================")
    print(" VaultShield — Unified Pipeline")
    print("==================================================")
    
    df = load_data()
    model = train_markov_model(df)
    results = run_scoring(df, model)
    export_artifacts(results)

if __name__ == "__main__":
    main()