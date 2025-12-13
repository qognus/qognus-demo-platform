"""
train_markov_chain.py
Qognus Demo Platform — ApexGrid / VaultShield
---------------------------------------------
Trains a First-Order Markov Chain on "Normal" authentication sequences.

Steps:
1. Load auth logs from JSONL.
2. Filter OUT any sessions marked as 'is_attack=True' (Ground Truth).
3. Group events by session_id and time.
4. Compute transition probabilities: P(Event_B | Event_A).
5. Save the Transition Matrix and State Map for the scoring engine.
"""

import json
import pathlib
import numpy as np
import pandas as pd

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_LOGS = DATA_DIR / "raw" / "vaultshield_auth_logs.jsonl"

PROCESSED_DIR = DATA_DIR / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

OUT_MATRIX = PROCESSED_DIR / "markov_transition_matrix.npy"
OUT_STATE_MAP = PROCESSED_DIR / "markov_state_map.json"

# We add a specialized "START" and "END" token to model the 
# beginning and conclusion of sessions naturally.
START_TOKEN = "SESSION_START"
END_TOKEN = "SESSION_END"

# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

def load_data(path: pathlib.Path) -> pd.DataFrame:
    """Load JSONL logs into a DataFrame."""
    if not path.exists():
        raise FileNotFoundError(f"Missing input file: {path}")
    
    records = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))
    
    return pd.DataFrame(records)

def build_transition_matrix(df_normal: pd.DataFrame):
    """
    Constructs the probability matrix from normal sessions.
    Returns: (matrix_numpy, state_to_index_dict)
    """
    # 1. Identify all unique event types
    unique_events = sorted(df_normal["event_type"].unique().tolist())
    
    # 2. Add special tokens to the state space
    states = [START_TOKEN] + unique_events + [END_TOKEN]
    state_to_idx = {s: i for i, s in enumerate(states)}
    n_states = len(states)
    
    # Initialize count matrix
    counts = np.zeros((n_states, n_states), dtype=np.float64)

    # 3. Process each session to count transitions
    # Sort by session and time to ensure correct order
    df_sorted = df_normal.sort_values(["session_id", "timestamp"])
    
    print(f"Aggregating transitions from {df_sorted['session_id'].nunique()} sessions...")

    for _, group in df_sorted.groupby("session_id"):
        events = group["event_type"].tolist()
        
        # Transition: START -> First Event
        first_evt_idx = state_to_idx[events[0]]
        start_idx = state_to_idx[START_TOKEN]
        counts[start_idx, first_evt_idx] += 1
        
        # Transitions: Event[i] -> Event[i+1]
        for i in range(len(events) - 1):
            curr_evt = events[i]
            next_evt = events[i+1]
            
            c_idx = state_to_idx[curr_evt]
            n_idx = state_to_idx[next_evt]
            
            counts[c_idx, n_idx] += 1
            
        # Transition: Last Event -> END
        last_evt_idx = state_to_idx[events[-1]]
        end_idx = state_to_idx[END_TOKEN]
        counts[last_evt_idx, end_idx] += 1

    # 4. Normalize rows to get Probabilities
    # Add Laplace smoothing (epsilon) to avoid 0.0 probabilities for rare valid transitions
    epsilon = 1e-5
    counts += epsilon
    
    # Divide each row by its sum
    row_sums = counts.sum(axis=1, keepdims=True)
    probs = counts / row_sums
    
    return probs, state_to_idx

# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

def main():
    print("==================================================")
    print(" VaultShield — Train Markov Chain Model")
    print("==================================================")
    
    # 1. Load Data
    print("Loading logs...")
    df = load_data(RAW_LOGS)
    print(f"Total events: {len(df)}")
    
    # 2. Filter for NORMAL traffic only (Ground Truth)
    # We want the model to learn what "Good" looks like.
    df_normal = df[df["is_attack"] == False].copy()
    print(f"Training on {len(df_normal)} normal events...")
    
    # 3. Build Matrix
    print("Computing transition probabilities...")
    transition_matrix, state_map = build_transition_matrix(df_normal)
    
    # 4. Save Artifacts
    print(f"Saving matrix shape: {transition_matrix.shape}")
    np.save(OUT_MATRIX, transition_matrix)
    
    with OUT_STATE_MAP.open("w", encoding="utf-8") as f:
        json.dump(state_map, f, indent=2)
        
    print(f" -> Matrix saved to: {OUT_MATRIX}")
    print(f" -> State map saved to: {OUT_STATE_MAP}")
    print("\nModel trained. Ready for scoring.")

if __name__ == "__main__":
    main()