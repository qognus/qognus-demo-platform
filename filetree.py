import os
for root, dirs, files in os.walk('.'):
    # Ignore hidden/cache folders
    dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
    level = root.count(os.sep)
    indent = ' ' * 4 * level
    print(f'{indent}{os.path.basename(root)}/')
    subindent = ' ' * 4 * (level + 1)
    for f in files:
        if not f.startswith('.'):
            print(f'{subindent}{f}')