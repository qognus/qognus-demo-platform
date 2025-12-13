"""
generate_vaultshield_auth_logs.py
---------------------------------
Generates high-fidelity synthetic auth logs with specific attack patterns.
"""
import json
import random
import uuid
import datetime
import pathlib
import numpy as np
from tqdm import tqdm

OUTPUT_PATH = pathlib.Path("data/raw/vaultshield_auth_logs.jsonl")
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

# --- Config ---
N_SESSIONS = 12000
ATTACK_RATE = 0.04  # 4% attacks
START_DATE = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)

USERS = [f"user_{i:04d}" for i in range(1000)]
ORGS = ["org_A", "org_B", "org_C"]
REGIONS = ["us-east-1", "us-west-2", "eu-central-1"]

# Realistic User Agents
UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)"
]

# Attack Patterns
ATTACKS = ["password_spray", "impossible_travel", "token_replay", "mfa_fatigue", "priv_escalation"]

def get_event_time(base_time, offset_seconds=0):
    return (base_time + datetime.timedelta(seconds=offset_seconds)).isoformat()

def generate_normal_session(start_time):
    """Standard happy path: Login -> MFA -> Token -> Success"""
    user = random.choice(USERS)
    sid = str(uuid.uuid4())
    ip = f"10.0.{random.randint(1,255)}.{random.randint(1,255)}"
    
    events = []
    
    # 1. Login
    events.append({
        "event_type": "login_attempt",
        "result": "success", 
        "mfa_method": "password"
    })
    
    # 2. MFA (95% success)
    events.append({
        "event_type": "mfa_challenge",
        "result": "sent",
        "mfa_method": "push"
    })
    
    events.append({
        "event_type": "mfa_response",
        "result": "approved",
        "latency_ms": int(np.random.normal(4000, 1000)) # Human reaction time
    })
    
    # 3. Token Issuance
    events.append({
        "event_type": "token_issued",
        "scope": "read:user"
    })
    
    # 4. Usage
    for _ in range(random.randint(1, 5)):
        events.append({
            "event_type": "api_access",
            "resource": "dashboard",
            "result": "allow"
        })

    return pack_session(events, user, sid, ip, start_time, is_attack=False)

def generate_mfa_fatigue(start_time):
    """Attack: Multiple MFA pushes rejected, finally approved (User gave up)"""
    user = random.choice(USERS)
    sid = str(uuid.uuid4())
    ip = f"192.168.1.{random.randint(1,255)}" # Suspicious IP
    
    events = []
    events.append({"event_type": "login_attempt", "result": "success"})
    
    # Fatigue loop
    for _ in range(random.randint(3, 6)):
        events.append({"event_type": "mfa_challenge", "result": "sent"})
        events.append({"event_type": "mfa_response", "result": "denied", "latency_ms": 1200})
    
    # Final succumb
    events.append({"event_type": "mfa_challenge", "result": "sent"})
    events.append({"event_type": "mfa_response", "result": "approved", "latency_ms": 500})
    events.append({"event_type": "token_issued", "scope": "admin:all"})
    
    return pack_session(events, user, sid, ip, start_time, is_attack=True, attack_type="mfa_fatigue")

def generate_priv_escalation(start_time):
    """Attack: Standard login -> weird role change -> admin action"""
    user = random.choice(USERS)
    sid = str(uuid.uuid4())
    ip = f"172.16.{random.randint(1,255)}.{random.randint(1,255)}"
    
    events = [
        {"event_type": "login_attempt", "result": "success"},
        {"event_type": "mfa_challenge", "result": "sent"},
        {"event_type": "mfa_response", "result": "approved"},
        {"event_type": "token_issued", "scope": "read:user"},
        {"event_type": "api_access", "resource": "profile", "result": "allow"},
        # The anomaly:
        {"event_type": "role_assume", "role": "admin", "result": "success"}, 
        {"event_type": "api_access", "resource": "users:delete", "result": "allow"}
    ]
    return pack_session(events, user, sid, ip, start_time, is_attack=True, attack_type="admin_escalation")

def pack_session(events, user, sid, ip, start_time, is_attack, attack_type=None):
    """Wraps event list into full JSON objects"""
    logs = []
    current_time = start_time
    region = random.choice(REGIONS)
    ua = random.choice(UAS)
    
    for e in events:
        # Time drift
        dt = random.randint(1, 5)
        current_time += datetime.timedelta(seconds=dt)
        
        log = {
            "timestamp_utc": current_time.isoformat(),
            "session_id": sid,
            "user_id": user,
            "ip": ip,
            "region": region,
            "user_agent": ua,
            "is_attack": is_attack,
            "attack_type": attack_type,
            **e
        }
        logs.append(log)
    return logs

def main():
    print(f"Generating {N_SESSIONS} sessions...")
    all_logs = []
    
    for _ in tqdm(range(N_SESSIONS)):
        t = START_DATE + datetime.timedelta(minutes=random.randint(0, 10000))
        
        if random.random() < ATTACK_RATE:
            atk = random.choice(["mfa", "priv"])
            if atk == "mfa":
                all_logs.extend(generate_mfa_fatigue(t))
            else:
                all_logs.extend(generate_priv_escalation(t))
        else:
            all_logs.extend(generate_normal_session(t))
            
    # Sort by time
    all_logs.sort(key=lambda x: x["timestamp_utc"])
    
    with OUTPUT_PATH.open("w") as f:
        for log in all_logs:
            f.write(json.dumps(log) + "\n")
            
    print(f"Done. Saved to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()