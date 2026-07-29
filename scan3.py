import os
import sys

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    findings = []
    for i, line in enumerate(lines, start=1):
        line_lower = line.lower()
        # 1. Button without aria-label or aria-labelledby
        if '<button' in line_lower:
            if 'aria-label=' not in line_lower and 'aria-labelledby=' not in line_lower:
                findings.append((i, 'Button without aria-label or aria-labelledby', 'medium'))
        # 2. Interactive elements without focus-visible or focus:ring
        for tag in ['button', 'a', 'input', 'textarea', 'select']:
            if f'<{tag}' in line_lower:
                if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                    findings.append((i, f'{tag} missing focus-visible or focus:ring', 'medium'))
        # 3. img/Image without alt
        if '<img' in line_lower:
            if 'alt=' not in line_lower:
                # Check for alt={...}
                if 'alt={' not in line_lower:
                    findings.append((i, 'img without alt', 'high'))
        if '<image' in line_lower:  # This matches <Image in lowercase
            if 'alt=' not in line_lower:
                if 'alt={' not in line_lower:
                    findings.append((i, 'Image without alt', 'high'))
        # 4. nav/section without role
        if '<nav' in line_lower:
            if 'role=' not in line_lower:
                findings.append((i, 'nav without role', 'low'))
        if '<section' in line_lower:
            if 'role=' not in line_lower:
                findings.append((i, 'section without role', 'low'))
    return findings

root = 'C:/Users/conta/co-ops'
for root_dir, dirs, files in os.walk(root):
    # Skip node_modules and .next directories
    if 'node_modules' in root_dir or '.next' in root_dir:
        continue
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            filepath = os.path.join(root_dir, file)
            try:
                findings = check_file(filepath)
                for line_num, msg, severity in findings:
                    print(f'{filepath}:{line_num}: {msg} [{severity}]')
            except Exception as e:
                print(f'Error reading {filepath}: {e}', file=sys.stderr)