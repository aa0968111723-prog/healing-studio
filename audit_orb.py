#!/usr/bin/env python3
"""Audit script: compare appRegistry supportedActions vs actual page handle capabilities."""
import re, glob

registry_file = 'shared/appRegistry.ts'
with open(registry_file) as f:
    content = f.read()

# Parse appRegistry - find page entries
pages = {}
entries = re.findall(r'\{\s*id:\s*"([^"]+)".*?supportedActions:\s*\[(.*?)\]', content, re.DOTALL)
for page_id, actions_str in entries:
    actions = re.findall(r'"([^"]+)"', actions_str)
    pages[page_id] = sorted(actions)

# Parse actual page handle capabilities
page_files = glob.glob('client/src/pages/*.tsx')
actual_caps = {}
for pf in page_files:
    with open(pf) as f:
        pc = f.read()
    # Find pageId within useRegisterPageAgent block (not from CustomEvent or other contexts)
    register_match = re.search(r'useRegisterPageAgent\(\{[^}]*?pageId:\s*"([^"]+)"', pc, re.DOTALL)
    if not register_match:
        # Fallback to any pageId
        register_match = re.search(r'pageId:\s*"([^"]+)"', pc)
    if register_match:
        pid = register_match.group(1)
        # Find action.type checks
        types = set(re.findall(r'action\.type\s*===?\s*"([^"]+)"', pc))
        # Also find case statements in switch
        cases = set(re.findall(r'case\s+"([^"]+)"', pc))
        # Filter to known action types
        known = {'navigate','setTab','setParam','setModality','setMode','setModel',
                 'fillPrompt','applyPreset','submit','reset','openDialog','search',
                 'focusElement','runWorkflow'}
        actual = (types | cases) & known
        actual_caps[pid] = sorted(actual)

# Compare and report
print(f"{'Page ID':<25} | {'Registry':<50} | {'Actual':<50} | Mismatch")
print("-" * 180)
all_pids = sorted(set(list(pages.keys()) + list(actual_caps.keys())))
issues = []
for pid in all_pids:
    reg = pages.get(pid, [])
    act = actual_caps.get(pid, [])
    missing_in_registry = sorted(set(act) - set(reg))
    missing_in_actual = sorted(set(reg) - set(act))
    mismatch = ''
    if missing_in_registry:
        mismatch += f'Registry needs: {missing_in_registry} '
    if missing_in_actual:
        mismatch += f'Page needs: {missing_in_actual}'
    if not mismatch:
        mismatch = 'OK'
    else:
        issues.append((pid, missing_in_registry, missing_in_actual))
    print(f"{pid:<25} | {str(reg):<50} | {str(act):<50} | {mismatch}")

print(f"\n\n=== ISSUES FOUND: {len(issues)} ===")
for pid, missing_reg, missing_page in issues:
    print(f"  {pid}:")
    if missing_reg:
        print(f"    - appRegistry.supportedActions should ADD: {missing_reg}")
    if missing_page:
        print(f"    - Page handle() should ADD support for: {missing_page}")
