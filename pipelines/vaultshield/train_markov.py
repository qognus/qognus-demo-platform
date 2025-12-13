import json
import pathlib
import pandas as pd
import numpy as np
from collections import defaultdict

DATA_PATH = pathlib.Path("data/raw/vaultshield_auth_logs.jsonl")
MODEL_DIR = pathlib.Path("models")
MODEL_DIR.mkdir(exist_ok=True)

def main():
    print("Training Markov Baseline...")
    df = pd.read_json(DATA_PATH, lines=True)
    
    # Filter ground truth: Only train on normal data
    df_normal = df[df['is_attack'] == False].copy()
    
    # Group by session
    sessions = df_normal.sort_values('timestamp_utc').groupby('session_id')['event_type'].apply(list)
    
    # Build Transitions
    transitions = defaultdict(lambda: defaultdict(int))
    
    for seq in sessions:
        # Add START token
        transitions['START'][seq[0]] += 1
        
        for i in range(len(seq) - 1):
            curr_e, next_e = seq[i], seq[i+1]
            transitions[curr_e][next_e] += 1
            
        # Add END token
        transitions[seq[-1]]['END'] += 1
        
    # Convert to Probabilities (log probs for stability)
    markov_model = {}
    
    for src, targets in transitions.items():
        total = sum(targets.values())
        markov_model[src] = {tgt: count/total for tgt, count in targets.items()}
        
    # Save
    with open(MODEL_DIR / "vaultshield_markov.json", "w") as f:
        json.dump(markov_model, f, indent=2)
        
    print("Model saved.")

if __name__ == "__main__":
    main()