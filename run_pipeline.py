"""
run_pipeline.py
Orchestrates the entire Qognus/ApexGrid ML pipeline.
Runs stages sequentially in separate processes to ensure memory cleanup.
"""

import sys
import time
import subprocess
import pathlib

# Define the pipeline stages in order
STAGES = [
    {
        "name": "1. Embeddings (Ollama)",
        "path": "models/embed/compute_embeddings.py",
        "desc": "Generates vector embeddings for tickets."
    },
    {
        "name": "2. Projection & Clustering",
        "path": "models/cluster/cluster_umap_hdbscan.py",
        "desc": "Projects to 3D and finds topic clusters."
    },
    {
        "name": "3. Health Evaluation",
        "path": "models/eval/embedding_health.py",
        "desc": "Calculates silhouette scores and cluster metrics."
    },
    {
        "name": "4. GridSense Anomaly Detection",
        "path": "models/gridsense_timeseries/anomaly_model.py",
        "desc": "PCA-based anomaly detection on IoT timeseries."
    },
    {
        "name": "5. VaultShield Security Analytics",
        "path": "models/vaultshield_analytics/vaultshield_pipeline.py",
        "desc": "Markov Chain analysis of auth logs."
    },
    {
        "name": "6. LineaOps Manufacturing",
        "path": "models/lineaops_manufacturing/lineaops_pipeline.py",
        "desc": "Robotics telemetry and OEE simulation."
    },
    {
        "name": "7. Web Artifact Export",
        "path": "models/eval/export_web_artifacts.py",
        "desc": "Generates JS files for the frontend."
    }
]

def run_stage(stage_info):
    name = stage_info["name"]
    script_path = stage_info["path"]
    
    print(f"\n{'='*70}")
    print(f"🚀  RUNNING: {name}")
    print(f"    Script: {script_path}")
    print(f"{'='*70}\n")
    
    start_time = time.time()
    
    # Run the script as a subprocess
    # sys.executable ensures we use the same python interpreter (the venv)
    result = subprocess.run([sys.executable, script_path])
    
    duration = time.time() - start_time
    
    if result.returncode != 0:
        print(f"\n❌  Stage FAILED: {name}")
        print(f"    Exit Code: {result.returncode}")
        print("    Pipeline stopped.")
        sys.exit(result.returncode)
        
    print(f"\n✅  Stage COMPLETED in {duration:.1f} seconds.")

def main():
    print("Starting Qognus Demo Platform Pipeline...")
    total_start = time.time()
    
    # Verify files exist before starting
    for stage in STAGES:
        if not pathlib.Path(stage["path"]).exists():
            print(f"❌  Error: Script not found: {stage['path']}")
            sys.exit(1)

    # Execute
    for stage in STAGES:
        run_stage(stage)
        
    total_time = time.time() - total_start
    print(f"\n✨  PIPELINE FINISHED SUCCESSFULLY in {total_time:.1f} seconds.")
    print("    You can now launch the web server: python -m http.server 3000 -d web")

if __name__ == "__main__":
    main()