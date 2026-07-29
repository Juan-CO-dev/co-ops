import os
import re
import sys
from collections import defaultdict

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    # Initialize counters for this file
    counts = {
        'img_no_alt': 0,
        'button_no_aria_label': 0,
        'button_no_focus': 0,
        'a_no_focus': 0,
        'input_no_focus': 0,
        'textarea_no_focus': 0,
        'select_no_focus': 0,
        'nav_no_role': 0,
        'section_no_role': 0,
    }
    # Store first few lines for each issue type for reporting
    examples = defaultdict(list)
    for i, line in enumerate(lines, start=1):
        line_lower = line.lower()
        # 1. img without alt
        if '<img' in line_lower:
            if 'alt=' not in line_lower and 'alt={' not in line_lower:
                counts['img_no_alt'] += 1
                if len(examples['img_no_alt']) < 2:
                    examples['img_no_alt'].append((i, line.strip()))
        # 2. Button without aria-label or aria-labelledby
        if '<button' in line_lower:
            if 'aria-label=' not in line_lower and 'aria-labelledby=' not in line_lower:
                counts['button_no_aria_label'] += 1
                if len(examples['button_no_aria_label']) < 2:
                    examples['button_no_aria_label'].append((i, line.strip()))
        # 3. Button missing focus-visible or focus:ring
        if '<button' in line_lower:
            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                counts['button_no_focus'] += 1
                if len(examples['button_no_focus']) < 2:
                    examples['button_no_focus'].append((i, line.strip()))
        # 4. a missing focus-visible or focus:ring
        if '<a' in line_lower and '</a>' not in line_lower:  # approximate to avoid closing tags
            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                counts['a_no_focus'] += 1
                if len(examples['a_no_focus']) < 2:
                    examples['a_no_focus'].append((i, line.strip()))
        # 5. input missing focus-visible or focus:ring
        if '<input' in line_lower:
            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                counts['input_no_focus'] += 1
                if len(examples['input_no_focus']) < 2:
                    examples['input_no_focus'].append((i, line.strip()))
        # 6. textarea missing focus-visible or focus:ring
        if '<textarea' in line_lower:
            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                counts['textarea_no_focus'] += 1
                if len(examples['textarea_no_focus']) < 2:
                    examples['textarea_no_focus'].append((i, line.strip()))
        # 7. select missing focus-visible or focus:ring
        if '<select' in line_lower:
            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                counts['select_no_focus'] += 1
                if len(examples['select_no_focus']) < 2:
                    examples['select_no_focus'].append((i, line.strip()))
        # 8. nav without role
        if '<nav' in line_lower:
            if 'role=' not in line_lower:
                counts['no_role'] += 1  # we'll split later
                if len(examples['nav_no_role']) < 2:
                    examples['nav_no_role'].append((i, line.strip()))
        # 9. section without role
        if '<section' in line_lower:
            if 'role=' not in line_lower:
                counts['no_role'] += 1
                if len(examples['section_no_role']) < 2:
                    examples['section_no_role'].append((i, line.strip()))
    # Split no_role into nav and section (we can't tell from the count, but we have separate examples)
    # We'll keep the counts as we collected them separately in examples but not in counts.
    # Instead, we'll recount for nav and section separately above? We'll adjust: we'll have separate counters.
    # Let's refactor: we'll have separate counters for nav_no_role and section_no_role.
    # We'll rewrite the counting part to be more explicit.
    # For simplicity, we'll just use the examples and assume the counts from the examples are not accurate.
    # We'll instead count separately in the loop.
    # Let's rewrite the function to be clearer.
    # Given time, we'll output the examples and note that there are many.
    return counts, examples

def main():
    root = 'C:/Users/conta/co-ops'
    summary = defaultdict(lambda: defaultdict(int))
    for root_dir, dirs, files in os.walk(root):
        if 'node_modules' in root_dir or '.next' in root_dir:
            continue
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                filepath = os.path.join(root_dir, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                    # Counters for this file
                    img_no_alt = 0
                    button_no_aria_label = 0
                    button_no_focus = 0
                    a_no_focus = 0
                    input_no_focus = 0
                    textarea_no_focus = 0
                    select_no_focus = 0
                    nav_no_role = 0
                    section_no_role = 0
                    examples = []
                    for i, line in enumerate(lines, start=1):
                        line_lower = line.lower()
                        if '<img' in line_lower:
                            if 'alt=' not in line_lower and 'alt={' not in line_lower:
                                img_no_alt += 1
                                if len(examples) < 5:
                                    examples.append((i, 'img without alt', line.strip()))
                        if '<button' in line_lower:
                            if 'aria-label=' not in line_lower and 'aria-labelledby=' not in line_lower:
                                button_no_aria_label += 1
                                if len(examples) < 5:
                                    examples.append((i, 'button without aria-label', line.strip()))
                            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                                button_no_focus += 1
                                if len(examples) < 5:
                                    examples.append((i, 'button missing focus-visible/focus:ring', line.strip()))
                        if '<a' in line_lower and '</a>' not in line_lower:
                            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                                a_no_focus += 1
                                if len(examples) < 5:
                                    examples.append((i, 'a missing focus-visible/focus:ring', line.strip()))
                        if '<input' in line_lower:
                            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                                input_no_focus += 1
                                if len(examples) < 5:
                                    examples.append((i, 'input missing focus-visible/focus:ring', line.strip()))
                        if '<textarea' in line_lower:
                            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                                textarea_no_focus += 1
                                if len(examples) < 5:
                                    examples.append((i, 'textarea missing focus-visible/focus:ring', line.strip()))
                        if '<select' in line_lower:
                            if 'focus-visible' not in line_lower and 'focus:ring' not in line_lower:
                                select_no_focus += 1
                                if len(examples) < 5:
                                    examples.append((i, 'select missing focus-visible/focus:ring', line.strip()))
                        if '<nav' in line_lower:
                            if 'role=' not in line_lower:
                                nav_no_role += 1
                                if len(examples) < 5:
                                    examples.append((i, 'nav without role', line.strip()))
                        if '<section' in line_lower:
                            if 'role=' not in line_lower:
                                section_no_role += 1
                                if len(examples) < 5:
                                    examples.append((i, 'section without role', line.strip()))
                    if any([img_no_alt, button_no_aria_label, button_no_focus, a_no_focus, input_no_focus, textarea_no_focus, select_no_focus, nav_no_role, section_no_role]):
                        summary[filepath] = {
                            'img_no_alt': img_no_alt,
                            'button_no_aria_label': button_no_aria_label,
                            'button_no_focus': button_no_focus,
                            'a_no_focus': a_no_focus,
                            'input_no_focus': input_no_focus,
                            'textarea_no_focus': textarea_no_focus,
                            'select_no_focus': select_no_focus,
                            'nav_no_role': nav_no_role,
                            'section_no_role': section_no_role,
                            'examples': examples
                        }
                except Exception as e:
                    print(f'Error processing {filepath}: {e}', file=sys.stderr)
    # Print summary
    for filepath, data in summary.items():
        print(f'\\n{filepath}:')
        if data['img_no_alt']:
            print(f'  img without alt: {data["img_no_alt"]} (e.g., line {data["examples"][0][0] if data["examples"] else "?"})')
        if data['button_no_aria_label']:
            print(f'  button without aria-label: {data["button_no_aria_label"]} (e.g., line { [e[0] for e in data["examples"] if "button without aria-label" in e[1]][0] if any("button without aria-label" in e[1] for e in data["examples"]) else "?" })')
        if data['button_no_focus']:
            print(f'  button missing focus-visible/focus:ring: {data["button_no_focus"]}')
        if data['a_no_focus']:
            print(f'  a missing focus-visible/focus:ring: {data["a_no_focus"]}')
        if data['input_no_focus']:
            print(f'  input missing focus-visible/focus:ring: {data["input_no_focus"]}')
        if data['textarea_no_focus']:
            print(f'  textarea missing focus-visible/focus:ring: {data["textarea_no_focus"]}')
        if data['select_no_focus']:
            print(f'  select missing focus-visible/focus:ring: {data["select_no_focus"]}')
        if data['nav_no_role']:
            print(f'  nav without role: {data["nav_no_role"]}')
        if data['section_no_role']:
            print(f'  section without role: {data["section_no_role"]}')
        # Print a few examples
        if data['examples']:
            print('  Examples:')
            for ex in data['examples'][:3]:
                print(f'    Line {ex[0]}: {ex[1]} - {ex[2][:50]}...')

if __name__ == '__main__':
    main()