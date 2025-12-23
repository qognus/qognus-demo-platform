# config.py
import pathlib

# 1. Paths
# Resolves to the project root regardless of where this script is imported
ROOT_DIR = pathlib.Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
WEB_DATA_DIR = ROOT_DIR / "web" / "data"

# 2. Ollama Settings
OLLAMA_HOST = "http://localhost:11434"
# Centralize model names so you only change them once
MODELS = {
    "embed": "mxbai-embed-large",
    "chat": "qwen3:latest",
    "vision": "bakllava:latest"
}

# 3. Project Constants
RANDOM_SEED = 42