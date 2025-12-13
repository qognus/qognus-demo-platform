import pandas as pd
import json
import pathlib
from sklearn.metrics import average_precision_score, roc_auc_score

SCORES_PATH = pathlib.Path("data/processed/vaultshield_session_scores.parquet")
OUT_METRICS = pathlib.Path("data/metrics/vaultshield_metrics.json")
OUT_METRICS.parent.mkdir(parents=True, exist_ok=True)

def main():
    df = pd.read_parquet(SCORES_PATH)
    
    y_true = df['is_attack'].astype(int)
    y_score = df['anomaly_score']
    
    # 1. PR-AUC (Average Precision)
    pr_auc = average_precision_score(y_true, y_score)
    
    # 2. ROC-AUC
    roc_auc = roc_auc_score(y_true, y_score)
    
    # 3. Precision @ Top 100
    top_100 = df.nlargest(100, 'anomaly_score')
    precision_at_k = top_100['is_attack'].mean()
    
    metrics = {
        "pr_auc": round(pr_auc, 4),
        "roc_auc": round(roc_auc, 4),
        "precision_at_100": round(precision_at_k, 4),
        "total_sessions": len(df),
        "total_attacks": int(y_true.sum())
    }
    
    print("Metrics:", metrics)
    
    with open(OUT_METRICS, "w") as f:
        json.dump(metrics, f, indent=2)

if __name__ == "__main__":
    main()