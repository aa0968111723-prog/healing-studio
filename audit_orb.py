#!/usr/bin/env python3
"""Audit script: compare appRegistry supportedActions vs actual page handle capabilities.

Some pages intentionally hide certain runtime capabilities from the static
fallback ranker (so navigate/setTab on Hub-style pages doesn't outrank the real
destination studio). Those are recorded in INTENTIONAL_HIDDEN_ACTIONS and
treated as "OK" by this audit.
"""
import re, glob

# (pageId, action) — page DOES handle this action at runtime, but registry
# intentionally excludes it from supportedActions. Documented in appRegistry.ts
# next to each entry.
INTENTIONAL_HIDDEN_ACTIONS = {
    ("create", "setTab"),         # Hub: setTab handled at runtime, not advertised
    ("playground", "setTab"),     # Hub: setTab handled at runtime, not advertised
    ("process-viewer", "navigate"),  # navigate only meaningful on /process itself
}

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
page_files = glob.glob('client/src/pages/*.tsx') + glob.glob('client/src/pages/**/*.tsx', recursive=True)
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
    # Filter out intentional hidden actions from "missing in registry"
    missing_in_registry = sorted(
        a for a in (set(act) - set(reg))
        if (pid, a) not in INTENTIONAL_HIDDEN_ACTIONS
    )
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

if not issues:
    print("\n✓ All pages aligned (intentional hidden actions documented in INTENTIONAL_HIDDEN_ACTIONS)")
