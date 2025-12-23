import os
import shutil
from pathlib import Path

# Config
PROJECT_ROOT = Path(__file__).parent
ARCHIVE_DIR = PROJECT_ROOT / "_archive"
WEB_DIR = PROJECT_ROOT / "web"

# Define what we want to KEEP in web/js (The new architecture)
# Everything else in web/js will be moved to archive.
KEEP_JS_FILES = {
    "ollama_client.js"
}

def main():
    # 1. Setup Archive
    if not ARCHIVE_DIR.exists():
        ARCHIVE_DIR.mkdir()
        print(f"📁 Created archive folder: {ARCHIVE_DIR}")

    # 2. Clean up web/js/ (The loose legacy scripts)
    js_dir = WEB_DIR / "js"
    if js_dir.exists():
        for file in js_dir.iterdir():
            if file.is_file():
                if file.name not in KEEP_JS_FILES:
                    print(f"📦 Archiving legacy script: {file.name}")
                    move_to_archive(file, "legacy_js")

    # 3. Clean up web/components/ (The old HTML fragments)
    # The new components are in web/js/components, so the old web/components folder is obsolete.
    old_components_dir = WEB_DIR / "components"
    if old_components_dir.exists():
        print(f"📦 Archiving legacy HTML components folder...")
        move_to_archive(old_components_dir, "legacy_html_components")

    # 4. Clean up web/css/ (Since we use Tailwind CDN now)
    css_dir = WEB_DIR / "css"
    if css_dir.exists():
         print(f"📦 Archiving unused CSS folder...")
         move_to_archive(css_dir, "legacy_css")

    print("\n✅ Cleanup complete! Your 'web/' folder is now strict and clean.")
    print(f"   (Old files are safe in '{ARCHIVE_DIR.name}')")

def move_to_archive(src_path, category):
    """Moves a file or folder into _archive/category/"""
    dest_dir = ARCHIVE_DIR / category
    if not dest_dir.exists():
        dest_dir.mkdir(parents=True)
    
    dest_path = dest_dir / src_path.name
    try:
        shutil.move(str(src_path), str(dest_path))
    except Exception as e:
        print(f"   ⚠️ Could not move {src_path.name}: {e}")

if __name__ == "__main__":
    main()