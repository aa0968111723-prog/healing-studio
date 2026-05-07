#!/usr/bin/env python3
"""
Deep audit script for the Orb assistant:
1. Check if each page's capabilities options match the actual handle() case branches
2. Check if state exposure is sufficient for the orb to make decisions
3. Check if handle() has proper error messages for unsupported actions
4. Check if NAV_ALLOWLIST covers reasonable destinations
"""
import re, glob, json, os

# Pages whose state is computed dynamically (IIFE / function returning object).
# Static regex can't see through them, so skip the NO_STATE check.
DYNAMIC_STATE_PAGES = {"pro-studio", "video-studio"}

# Pages that validate navigation via inline string comparison or `window.location`
# rather than a Set named NAV_ALLOWLIST. Functionally safe but pattern-different.
INLINE_NAV_VALIDATION_PAGES = {"account-settings"}

# Use a set to dedupe (recursive glob also returns top-level files)
page_files = sorted(
    set(glob.glob('client/src/pages/*.tsx'))
    | set(glob.glob('client/src/pages/**/*.tsx', recursive=True))
)

# Settings/auth-style pages don't need to navigate to all four studios; the
# 5-path threshold doesn't apply to them.
NAV_NARROW_EXEMPT = {
    "account-settings",  # 個資/安全/活動，回首頁 + 儀表板 + 設定 + 積分即可
    "admin",
    "admin-api-usage",
    "admin-brain-pipeline",
    "langsmith",
    "credits",
    "vault",  # 角色保險庫離站只回常用入口
}

issues = []

for pf in page_files:
    with open(pf) as f:
        pc = f.read()

    # Find pageId
    register_match = re.search(r'useRegisterPageAgent\(\{[^}]*?pageId:\s*"([^"]+)"', pc, re.DOTALL)
    if not register_match:
        continue
    pid = register_match.group(1)

    # === Check 1: capabilities action options vs handle() cases ===
    # Find all capability action types declared
    cap_actions = re.findall(r'action:\s*"([^"]+)"', pc)
    # Find all handle() case branches
    handle_cases = set(re.findall(r'case\s+"([^"]+)"', pc))
    handle_types = set(re.findall(r'action\.type\s*===?\s*"([^"]+)"', pc))
    all_handled = handle_cases | handle_types

    # Check if capabilities declare actions not handled
    for ca in set(cap_actions):
        if ca not in all_handled and ca not in ['navigate']:  # navigate is often handled via if
            issues.append((pid, "CAP_NOT_HANDLED", f"Capability declares action '{ca}' but no case/if found in handle()"))

    # === Check 2: setTab options vs actual tab values ===
    # Find setTab capability options
    setTab_options = []
    in_setTab_block = False
    for line in pc.split('\n'):
        if 'action: "setTab"' in line:
            in_setTab_block = True
        elif in_setTab_block and 'options:' in line:
            continue
        elif in_setTab_block and 'id:' in line:
            m = re.search(r'id:\s*"([^"]+)"', line)
            if m:
                setTab_options.append(m.group(1))
        elif in_setTab_block and (']' in line and 'options' not in line):
            in_setTab_block = False

    # Find actual tab validation in handle
    tab_valid_values = re.findall(r'(?:valid|allowed|TABS|TAB_OPTIONS).*?\[([^\]]+)\]', pc)

    # === Check 3: NAV_ALLOWLIST completeness ===
    nav_allowlist = re.findall(r'NAV_ALLOWLIST.*?=.*?new Set\(\[(.*?)\]\)', pc, re.DOTALL)
    if nav_allowlist:
        nav_paths = re.findall(r'"([^"]+)"', nav_allowlist[0])
        # Check if common destinations are included
        common_paths = ['/studio', '/image-studio', '/video-studio', '/pro-studio', '/settings']
        missing_nav = [p for p in common_paths if p not in nav_paths and pid not in NAV_NARROW_EXEMPT]
        if missing_nav and len(nav_paths) < 5 and pid not in NAV_NARROW_EXEMPT:
            issues.append((pid, "NAV_ALLOWLIST_NARROW", f"NAV_ALLOWLIST only has {len(nav_paths)} paths: {nav_paths[:5]}"))
    elif 'navigate' in all_handled:
        # Has navigate handler but no allowlist - check if it uses a different mechanism
        if (
            'ALLOWLIST' not in pc
            and 'allowlist' not in pc.lower()
            and pid not in INLINE_NAV_VALIDATION_PAGES
        ):
            issues.append((pid, "NO_NAV_ALLOWLIST", "Handles navigate but no allowlist found - potential security issue"))

    # === Check 4: state exposure completeness ===
    if pid in DYNAMIC_STATE_PAGES:
        # State is computed via IIFE — assume the page handles it; static parser can't see through it.
        pass
    else:
        state_match = re.search(r'state:\s*\{([^}]+)\}', pc)
        if state_match:
            state_keys = re.findall(r'(\w+)(?:\s*[:,])', state_match.group(1))
            # Check if critical state is exposed for decision-making
            if pid in ['studio', 'image-studio', 'video-studio', 'pro-studio']:
                needed_state = ['model', 'prompt', 'mode', 'modality', 'tab']
                # Flexible check - any partial match
                exposed = [k for k in state_keys]
                missing_state = []
                for ns in needed_state:
                    if not any(ns.lower() in k.lower() for k in exposed):
                        missing_state.append(ns)
                if missing_state:
                    issues.append((pid, "STATE_INCOMPLETE", f"Creative page missing state keys: {missing_state}"))
        else:
            issues.append((pid, "NO_STATE", "No state object exposed to orb"))

    # === Check 5: Default case handling ===
    if 'default:' not in pc and 'handle' in pc:
        # Check if there's a catch-all return for unsupported actions. The
        # regex spans multiple lines (re.DOTALL) because most pages format the
        # return literal across 3-4 lines.
        if not re.search(
            r'return\s*\{\s*ok:\s*false[^}]*?(?:unsupported|not-applicable|inapplicable|未支援)',
            pc,
            re.DOTALL,
        ):
            issues.append((pid, "NO_DEFAULT_HANDLER", "No default/catch-all for unsupported action types"))

# Report
print(f"{'Page ID':<25} | {'Issue Type':<25} | Description")
print("-" * 120)
for pid, itype, desc in sorted(issues):
    print(f"{pid:<25} | {itype:<25} | {desc}")

print(f"\n\n=== TOTAL ISSUES: {len(issues)} ===")

# Group by type
from collections import Counter
type_counts = Counter(itype for _, itype, _ in issues)
print("\nBy type:")
for t, c in type_counts.most_common():
    print(f"  {t}: {c}")
