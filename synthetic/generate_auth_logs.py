"""
generate_auth_logs.py
Qognus Demo Platform — ApexGrid / VaultShield
---------------------------------------------
Generates synthetic authentication logs for security analytics.

Features:
- Generates "Normal" sessions (Login -> MFA -> App Access -> Logout)
- Injects specific "Attack" scenarios:
  1. Brute Force (High volume failures for one user)
  2. Password Spray (Low volume failures across many users)
  3. Impossible Travel (logins from physically distant regions in short time)
  4. Privilege Escalation (User repeatedly trying to access admin areas)
  
Output: data/raw/vaultshield_auth_logs.jsonl
"""

import json
import random
import datetime
import pathlib
import uuid
from typing import List, Dict

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

DATA_DIR = pathlib.Path("data")
RAW_DIR = DATA_DIR / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FILE = RAW_DIR / "vaultshield_auth_logs.jsonl"

# Simulation settings
DAYS_BACK = 7
TOTAL_NORMAL_SESSIONS = 8000
ATTACK_INJECTION_RATE = 0.05  # 5% of traffic is malicious

# Domain Constants
USERS = [f"user_{i:03d}" for i in range(1, 201)]  # user_001 to user_200
ADMINS = [f"admin_{i:02d}" for i in range(1, 11)] # admin_01 to admin_10
ALL_ACCOUNTS = USERS + ADMINS

REGIONS = ["us-east-1", "us-west-2", "eu-central-1", "ap-southeast-1"]

# IP Address Pools (mocking subnets)
OFFICE_IPS = [f"10.50.{i}.{j}" for i in range(1, 5) for j in range(1, 50)]
VPN_IPS = [f"172.16.{i}.{j}" for i in range(10, 20) for j in range(1, 100)]
MALICIOUS_IPS = [f"192.168.666.{i}" for i in range(1, 50)]  # Obviously "bad" for demo clarity

# Event Taxonomy
EVENTS = [
    "LOGIN_PROMPT", "LOGIN_SUCCESS", "LOGIN_FAIL",
    "MFA_PROMPT", "MFA_SUCCESS", "MFA_FAIL",
    "APP_ACCESS", "DASHBOARD_VIEW", "REPORT_GEN",
    "ADMIN_PANEL_ACCESS", "API_KEY_GEN", "SUDO_ATTEMPT",
    "LOGOUT"
]

# ------------------------------------------------------------
# GENERATORS
# ------------------------------------------------------------

def get_random_time(start_time: datetime.datetime, end_time: datetime.datetime) -> datetime.datetime:
    """Returns a random datetime between start and end."""
    delta = end_time - start_time
    random_second = random.randint(0, int(delta.total_seconds()))
    return start_time + datetime.timedelta(seconds=random_second)

def generate_normal_session(start_time: datetime.datetime) -> List[Dict]:
    """
    Creates a standard, happy-path user session.
    Flow: Login -> MFA -> App Access -> (Work) -> Logout
    """
    user = random.choice(ALL_ACCOUNTS)
    ip = random.choice(OFFICE_IPS + VPN_IPS)
    region = random.choice(REGIONS) # Usually users stick to one, but random for base noise
    session_id = str(uuid.uuid4())
    
    logs = []
    current_time = start_time

    # 1. Login
    logs.append({
        "timestamp": current_time.isoformat(),
        "user_id": user,
        "session_id": session_id,
        "ip_address": ip,
        "event_type": "LOGIN_PROMPT",
        "region": region,
        "is_attack": False,
        "attack_type": None
    })
    
    current_time += datetime.timedelta(seconds=random.randint(1, 5))
    logs.append({
        "timestamp": current_time.isoformat(),
        "user_id": user,
        "session_id": session_id,
        "ip_address": ip,
        "event_type": "LOGIN_SUCCESS",
        "region": region,
        "is_attack": False,
        "attack_type": None
    })

    # 2. MFA
    current_time += datetime.timedelta(seconds=random.randint(1, 2))
    logs.append({
        "timestamp": current_time.isoformat(),
        "user_id": user,
        "session_id": session_id,
        "ip_address": ip,
        "event_type": "MFA_PROMPT",
        "region": region,
        "is_attack": False,
        "attack_type": None
    })

    current_time += datetime.timedelta(seconds=random.randint(5, 15))
    logs.append({
        "timestamp": current_time.isoformat(),
        "user_id": user,
        "session_id": session_id,
        "ip_address": ip,
        "event_type": "MFA_SUCCESS",
        "region": region,
        "is_attack": False,
        "attack_type": None
    })

    # 3. Work (App Access loops)
    for _ in range(random.randint(3, 8)):
        current_time += datetime.timedelta(seconds=random.randint(20, 300))
        action = random.choice(["APP_ACCESS", "DASHBOARD_VIEW", "REPORT_GEN"])
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": user,
            "session_id": session_id,
            "ip_address": ip,
            "event_type": action,
            "region": region,
            "is_attack": False,
            "attack_type": None
        })

    # 4. Logout
    current_time += datetime.timedelta(seconds=random.randint(10, 60))
    logs.append({
        "timestamp": current_time.isoformat(),
        "user_id": user,
        "session_id": session_id,
        "ip_address": ip,
        "event_type": "LOGOUT",
        "region": region,
        "is_attack": False,
        "attack_type": None
    })

    return logs

# ------------------------------------------------------------
# ATTACK SCENARIOS
# ------------------------------------------------------------

def inject_brute_force(start_time: datetime.datetime) -> List[Dict]:
    """
    Scenario: Single IP smashing a single account with failures.
    """
    target_user = random.choice(USERS)
    attacker_ip = random.choice(MALICIOUS_IPS)
    region = random.choice(REGIONS)
    session_id = str(uuid.uuid4())
    
    logs = []
    current_time = start_time

    # 20-50 failed attempts rapid fire
    for _ in range(random.randint(20, 50)):
        current_time += datetime.timedelta(seconds=random.randint(0, 2))
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": target_user,
            "session_id": session_id,
            "ip_address": attacker_ip,
            "event_type": "LOGIN_FAIL",
            "region": region,
            "is_attack": True,
            "attack_type": "BruteForce"
        })
    
    return logs

def inject_password_spray(start_time: datetime.datetime) -> List[Dict]:
    """
    Scenario: Single IP trying ONE password against MANY users.
    """
    attacker_ip = random.choice(MALICIOUS_IPS)
    region = random.choice(REGIONS)
    
    logs = []
    current_time = start_time
    
    # Try 30 different users
    targets = random.sample(USERS, 30)
    
    for user in targets:
        session_id = str(uuid.uuid4()) # Each attempt is a "session" technically
        current_time += datetime.timedelta(seconds=random.randint(10, 30)) # Slow-ish
        
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": user,
            "session_id": session_id,
            "ip_address": attacker_ip,
            "event_type": "LOGIN_FAIL",
            "region": region,
            "is_attack": True,
            "attack_type": "PasswordSpray"
        })

    return logs

def inject_impossible_travel(start_time: datetime.datetime) -> List[Dict]:
    """
    Scenario: User logs in from US-East, then 5 mins later from AP-Southeast.
    """
    user = random.choice(USERS)
    session_id_1 = str(uuid.uuid4())
    session_id_2 = str(uuid.uuid4())
    
    logs = []
    
    # Login 1 (US)
    t1 = start_time
    logs.append({
        "timestamp": t1.isoformat(),
        "user_id": user,
        "session_id": session_id_1,
        "ip_address": "10.50.1.100", # Office IP
        "event_type": "LOGIN_SUCCESS",
        "region": "us-east-1",
        "is_attack": True,
        "attack_type": "ImpossibleTravel"
    })

    # Login 2 (Asia) - only 15 mins later
    t2 = t1 + datetime.timedelta(minutes=15)
    logs.append({
        "timestamp": t2.isoformat(),
        "user_id": user,
        "session_id": session_id_2,
        "ip_address": "203.0.113.55", # External IP
        "event_type": "LOGIN_SUCCESS",
        "region": "ap-southeast-1",
        "is_attack": True,
        "attack_type": "ImpossibleTravel"
    })

    return logs

def inject_privilege_escalation(start_time: datetime.datetime) -> List[Dict]:
    """
    Scenario: Normal login, then repeated failures accessing Admin/Sudo.
    Sequence Anomaly: LOGIN -> MFA -> APP -> ADMIN_FAIL -> ADMIN_FAIL
    """
    user = random.choice(USERS) # Regular user, not admin
    ip = random.choice(VPN_IPS)
    region = "us-east-1"
    session_id = str(uuid.uuid4())
    
    logs = []
    current_time = start_time

    # 1. Normal Login Flow (To look legitimate initially)
    steps = ["LOGIN_PROMPT", "LOGIN_SUCCESS", "MFA_SUCCESS", "APP_ACCESS"]
    for step in steps:
        current_time += datetime.timedelta(seconds=random.randint(2, 5))
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": user,
            "session_id": session_id,
            "ip_address": ip,
            "event_type": step,
            "region": region,
            "is_attack": True,  # The whole session is tainted
            "attack_type": "PrivilegeEscalation"
        })

    # 2. The Suspicious Behavior (Accessing forbidden areas)
    for _ in range(4):
        current_time += datetime.timedelta(seconds=random.randint(5, 10))
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": user,
            "session_id": session_id,
            "ip_address": ip,
            "event_type": "ADMIN_PANEL_ACCESS", # This transition is rare for regular users
            "region": region,
            "is_attack": True,
            "attack_type": "PrivilegeEscalation"
        })
        
        current_time += datetime.timedelta(seconds=1)
        logs.append({
            "timestamp": current_time.isoformat(),
            "user_id": user,
            "session_id": session_id,
            "ip_address": ip,
            "event_type": "ACCESS_DENIED", # Result
            "region": region,
            "is_attack": True,
            "attack_type": "PrivilegeEscalation"
        })

    return logs

# ------------------------------------------------------------
# MAIN LOOP
# ------------------------------------------------------------

def main():
    print("==================================================")
    print(" VaultShield — Synthetic Auth Log Generator")
    print("==================================================")
    
    end_date = datetime.datetime.now(datetime.timezone.utc)
    start_date = end_date - datetime.timedelta(days=DAYS_BACK)
    
    all_logs = []
    
    # 1. Generate Normal Traffic
    print(f"Generating {TOTAL_NORMAL_SESSIONS} normal sessions...")
    for _ in range(TOTAL_NORMAL_SESSIONS):
        t = get_random_time(start_date, end_date)
        all_logs.extend(generate_normal_session(t))
        
    # 2. Inject Attacks
    num_attacks = int(TOTAL_NORMAL_SESSIONS * ATTACK_INJECTION_RATE)
    print(f"Injecting ~{num_attacks} attack scenarios...")
    
    for _ in range(num_attacks):
        t = get_random_time(start_date, end_date)
        scenario = random.choice([
            "brute_force", "password_spray", 
            "impossible_travel", "priv_esc"
        ])
        
        if scenario == "brute_force":
            all_logs.extend(inject_brute_force(t))
        elif scenario == "password_spray":
            all_logs.extend(inject_password_spray(t))
        elif scenario == "impossible_travel":
            all_logs.extend(inject_impossible_travel(t))
        elif scenario == "priv_esc":
            all_logs.extend(inject_privilege_escalation(t))

    # 3. Sort by Timestamp (essential for time-series realism)
    print("Sorting logs by timestamp...")
    all_logs.sort(key=lambda x: x["timestamp"])
    
    # 4. Write to JSONL
    print(f"Writing {len(all_logs)} events to {OUTPUT_FILE}...")
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        for entry in all_logs:
            f.write(json.dumps(entry) + "\n")
            
    print("Done. Ready for sequence modeling.")

if __name__ == "__main__":
    main()