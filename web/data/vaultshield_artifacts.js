window.VAULTSHIELD_ARTIFACTS = {
  "total_sessions": 12000,
  "attack_counts": {
    "mfa_fatigue": 244,
    "admin_escalation": 233
  },
  "metrics": {
    "pr_auc": 1.0,
    "roc_auc": 1.0,
    "precision_at_100": 1.0,
    "total_sessions": 12000,
    "total_attacks": 477
  },
  "top_anomaly": {
    "session_id": "03baab83-ea3e-42ed-bc6b-51a7734a3f48",
    "user_id": "user_0099",
    "anomaly_score": 82.89306334778564,
    "attack_type": "mfa_fatigue",
    "explanation": "mfa_response \u2192 mfa_challenge",
    "worst_prob": 9.969481410083955e-07,
    "events": [
      "START",
      "login_attempt",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "mfa_challenge",
      "mfa_response",
      "token_issued"
    ]
  }
};