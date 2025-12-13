import json
import math
import pathlib
import pandas as pd
from tqdm import tqdm

DATA_PATH = pathlib.Path("data/raw/vaultshield_auth_logs.jsonl")
MODEL_PATH = pathlib.Path("models/vaultshield_markov.json")
OUTPUT_PATH = pathlib.Path("data/processed/vaultshield_session_scores.parquet")
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

EPSILON = 1e-6 # Penalty for unseen transitions

def main():
    with open(MODEL_PATH) as f:
        model = json.load(f)
        
    df = pd.read_json(DATA_PATH, lines=True)
    
    results = []
    
    # Score every session (Normal + Attack)
    grouped = df.sort_values('timestamp_utc').groupby('session_id')
    
    for sid, group in tqdm(grouped):
        events = group['event_type'].tolist()
        
        # Metadata for result
        meta = group.iloc[0]
        
        session_risk = 0.0
        risk_steps = []
        
        # START transition
        curr = 'START'
        
        for next_evt in events:
            # Probability P(next | curr)
            prob = model.get(curr, {}).get(next_evt, EPSILON)
            
            # Risk = -log(P)
            step_risk = -math.log(prob)
            session_risk += step_risk
            
            risk_steps.append({
                "from": curr,
                "to": next_evt,
                "risk": round(step_risk, 2)
            })
            
            curr = next_evt
            
        # Normalize by length? Or raw sum? 
        # Raw sum is better for "longer sequence = more surface area"
        
        results.append({
            "session_id": sid,
            "user_id": meta['user_id'],
            "ip": meta['ip'],
            "is_attack": meta['is_attack'],
            "attack_type": meta['attack_type'],
            "anomaly_score": session_risk,
            "risk_steps": json.dumps(risk_steps), # Store as JSON string for Parquet
            "event_count": len(events)
        })
        
    res_df = pd.DataFrame(results)
    res_df.to_parquet(OUTPUT_PATH)
    print(f"Scored {len(res_df)} sessions.")

if __name__ == "__main__":
    main()