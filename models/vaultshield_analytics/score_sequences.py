"""
score_sequences.py
Qognus Demo Platform — ApexGrid / VaultShield
---------------------------------------------
Scores authentication sessions using the trained Markov Chain model.

Logic:
1. Reconstructs the full sequence for every session (Normal + Attack).
2. Calculates the Anomaly Score: -Sum(log(P_transition)).
   - High Score = Highly Anomalous (Low Probability).
3. Identifies the "Root Cause" transition (the step with the lowest probability).
4. Saves the results for the dashboard.
"""

import json
import pathlib
import numpy as np
import pandas as pd
from tqdm import tqdm

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_LOGS = DATA_DIR / "raw" / "vaultshield_auth_logs.jsonl"
PROCESSED_DIR = DATA_DIR / "processed"

MATRIX_FILE = PROCESSED_DIR / "markov_transition_matrix.npy"
STATE_MAP_FILE = PROCESSED_DIR / "markov_state_map.json"

OUT_SCORES = PROCESSED_DIR / "session_scores.parquet"

START_TOKEN = "SESSION_START"
END_TOKEN = "SESSION_END"

# Small epsilon to prevent log(0)
EPSILON = 1e-9

# ------------------------------------------------------------
# SCORING ENGINE
# ------------------------------------------------------------

def load_model():
    """Load the trained transition matrix and state map."""
    if not MATRIX_FILE.exists() or not STATE_MAP_FILE.exists():
        raise FileNotFoundError("Model artifacts not found. Run train_markov_chain.py first.")
    
    matrix = np.load(MATRIX_FILE)
    with STATE_MAP_FILE.open("r", encoding="utf-8") as f:
        state_map = json.load(f)
        
    return matrix, state_map

def score_session(events: list, matrix: np.ndarray, state_map: dict):
    """
    Calculates the anomaly score for a single session sequence.
    Returns: (total_score, max_anomaly_transition, worst_prob)
    """
    # 1. Pad sequence with tokens
    full_sequence = [START_TOKEN] + events + [END_TOKEN]
    
    total_nll = 0.0  # Negative Log Likelihood
    min_prob = 1.0
    worst_transition = None
    
    # 2. Walk through transitions
    for i in range(len(full_sequence) - 1):
        curr_state = full_sequence[i]
        next_state = full_sequence[i+1]
        
        # Handle unknown states (if new event types appear in future data)
        if curr_state not in state_map or next_state not in state_map:
            prob = EPSILON
        else:
            c_idx = state_map[curr_state]
            n_idx = state_map[next_state]
            prob = matrix[c_idx, n_idx]
        
        # Clamp prob to avoid log(0) error
        prob = max(prob, EPSILON)
        
        # 3. Accumulate Score (-log(p))
        # Lower probability = Higher Anomaly Score
        nll = -np.log(prob)
        total_nll += nll
        
        # 4. Track the "Why" (Lowest probability step)
        if prob < min_prob:
            min_prob = prob
            worst_transition = f"{curr_state} → {next_state}"

    # Normalize score by length to prevent long sessions from always looking bad
    # (Optional: depends on if length itself is considered anomalous)
    normalized_score = total_nll / len(full_sequence)
    
    return normalized_score, worst_transition, min_prob

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==================================================")
    print(" VaultShield — Score Sessions (Anomaly Detection)")
    print("==================================================")

    # 1. Load Data & Model
    print("Loading model and logs...")
    matrix, state_map = load_model()
    
    logs_df = pd.read_json(RAW_LOGS, lines=True)
    logs_df = logs_df.sort_values(["session_id", "timestamp"])
    
    print(f"Scoring {logs_df['session_id'].nunique()} unique sessions...")

    results = []

    # 2. Iterate over every session
    # GroupBy is efficient enough for ~10k sessions
    for session_id, group in tqdm(logs_df.groupby("session_id"), desc="Scoring"):
        events = group["event_type"].tolist()
        
        # Metadata from the first event in the session
        first_row = group.iloc[0]
        user_id = first_row["user_id"]
        is_attack = bool(first_row["is_attack"])
        attack_type = first_row.get("attack_type")
        ip_address = first_row["ip_address"]
        
        # 3. Calculate Score
        score, explanation, worst_prob = score_session(events, matrix, state_map)
        
        results.append({
            "session_id": session_id,
            "user_id": user_id,
            "ip_address": ip_address,
            "timestamp": first_row["timestamp"], # Session start time
            "is_attack": is_attack,
            "attack_type": str(attack_type) if attack_type else "Normal",
            "anomaly_score": float(round(score, 4)),
            "explanation": explanation,
            "worst_transition_prob": float(round(worst_prob, 6)),
            "event_count": len(events)
        })

    # 4. Save Results
    results_df = pd.DataFrame(results)
    results_df = results_df.sort_values("anomaly_score", ascending=False)
    
    print("\n--- Top 5 Anomalous Sessions Found ---")
    print(results_df[["user_id", "attack_type", "anomaly_score", "explanation"]].head(5).to_string(index=False))
    
    print(f"\nSaving scores to {OUT_SCORES}...")
    results_df.to_parquet(OUT_SCORES, index=False)
    
    # 5. Quick Accuracy Check (ROC-AUC proxy)
    # How well did we separate attacks (High Score) from normal (Low Score)?
    avg_attack_score = results_df[results_df["is_attack"] == True]["anomaly_score"].mean()
    avg_normal_score = results_df[results_df["is_attack"] == False]["anomaly_score"].mean()
    
    print(f"\nAvg Score (Attack): {avg_attack_score:.4f}")
    print(f"Avg Score (Normal): {avg_normal_score:.4f}")
    
    if avg_attack_score > avg_normal_score:
        print("SUCCESS: Attack sessions have higher anomaly scores.")
    else:
        print("WARNING: Model may need tuning (Attack scores are low).")

if __name__ == "__main__":
    main()