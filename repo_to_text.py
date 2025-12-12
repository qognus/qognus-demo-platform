import os

def is_binary(file_path):
    """
    Simple check to see if a file is binary. 
    Reads a small chunk and looks for null bytes.
    """
    try:
        with open(file_path, 'rb') as f:
            chunk = f.read(1024)
            return b'\0' in chunk
    except Exception:
        return True

def merge_repo_to_txt(root_dir, output_file):
    # --- CONFIGURATION: 'data' and '.venv' are now ignored ---
    IGNORED_DIRS = {
        'data', '.git', '__pycache__', 'node_modules', 'venv', '.venv', 'env', 
        '.idea', '.vscode', 'dist', 'build', 'migrations', 'bin', 'obj'
    }
    IGNORED_EXTENSIONS = {
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
        '.pyc', '.exe', '.dll', '.so', '.dylib', '.bin', 
        '.lock', '.pdf', '.zip', '.tar', '.gz', '.db', '.sqlite3', '.pkl'
    }
    # ---------------------------------------------------------

    with open(output_file, 'w', encoding='utf-8') as outfile:
        for subdir, dirs, files in os.walk(root_dir):
            # Modify dirs in-place to skip ignored directories
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
            
            for file in files:
                file_path = os.path.join(subdir, file)
                _, ext = os.path.splitext(file)

                # Skip ignored extensions and the script itself/output file
                if (ext.lower() in IGNORED_EXTENSIONS or 
                    file == os.path.basename(__file__) or 
                    file == output_file):
                    continue

                # Skip binary files to prevent encoding errors
                if is_binary(file_path):
                    print(f"Skipping binary file: {file_path}")
                    continue

                # Write to the output text file
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as infile:
                        content = infile.read()
                        
                        # Write a clear header for the AI
                        outfile.write(f"\n{'='*50}\n")
                        outfile.write(f"FILE PATH: {os.path.relpath(file_path, root_dir)}\n")
                        outfile.write(f"{'='*50}\n\n")
                        
                        outfile.write(content)
                        outfile.write("\n")
                        
                    print(f"Added: {file_path}")
                except Exception as e:
                    print(f"Could not read {file_path}: {e}")

if __name__ == "__main__":
    current_dir = os.getcwd()
    output_filename = "full_codebase.txt"
    
    print(f"Scanning directory: {current_dir}")
    merge_repo_to_txt(current_dir, output_filename)
    print(f"\nDone! All code saved to: {output_filename}")