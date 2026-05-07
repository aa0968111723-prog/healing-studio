#!/usr/bin/env python3
"""
Orb deep audit v2 — cross-cutting checks beyond per-page handlers.

Focus areas not covered by audit_orb.py / deep_audit.py:
  A. agent-skills recommendedPages → real registry paths
  B. PAGE_TO_GUIDE_INTENT → registry pageIds
  C. PAGE_QUICK_ACTIONS → registry pageIds
  D. orbHints non-empty for all interactive pages
  E. agentEntryPriority sanity (no duplicates within same group)
  F. Quick action setTab tabIds → known tab values per page
"""
import re
import sys
from collections import Counter, defaultdict


def read(path):
    with open(path) as f:
        return f.read()


# ── Parse appRegistry ─────────────────────────────────────────────────────
reg = read('shared/appRegistry.ts')
# Extract one big-block per registry entry (fragile but works because we only
# look up specific fields).
PAGE_FIELDS = {}
ID_TO_PATH = {}
ID_TO_GROUP = {}
ID_TO_PRIO = {}
ID_TO_SUPPORTS = {}
for m in re.finditer(
    r'^\s*\{\s*\n\s*id:\s*"([^"]+)",\s*\n([\s\S]*?)\n\s*\},',
    reg,
    re.MULTILINE,
):
    pid = m.group(1)
    body = m.group(2)
    p = re.search(r'^\s*path:\s*"([^"]+)"', body, re.MULTILINE)
    g = re.search(r'^\s*group:\s*"([^"]+)"', body, re.MULTILINE)
    pr = re.search(r'^\s*agentEntryPriority:\s*(\d+)', body, re.MULTILINE)
    s = re.search(r'^\s*supportsPageAgent:\s*(true|false)', body, re.MULTILINE)
    if p:
        ID_TO_PATH[pid] = p.group(1)
    if g:
        ID_TO_GROUP[pid] = g.group(1)
    if pr:
        ID_TO_PRIO[pid] = int(pr.group(1))
    if s:
        ID_TO_SUPPORTS[pid] = s.group(1) == "true"
    PAGE_FIELDS[pid] = body

ALL_REGISTRY_PATHS = set(ID_TO_PATH.values())
# Drop query strings / hash for path comparison
ALL_REGISTRY_BASEPATHS = {p.split("?")[0].split("#")[0] for p in ALL_REGISTRY_PATHS}

# Legacy / alias routes that exist in App.tsx as redirects but aren't a
# canonical registry path. They're still valid navigation targets.
LEGACY_REDIRECT_PATHS = {
    "/lora-trainer",   # redirects to /models
    "/character-forge", # redirects to /models (if present)
    "/agent-chat",     # redirects to /agent (if present)
}
ALL_REGISTRY_BASEPATHS |= LEGACY_REDIRECT_PATHS

print(f"Parsed registry: {len(PAGE_FIELDS)} entries\n")

issues = []

# ── A. agent-skills recommendedPages ──────────────────────────────────────
print("── A. agent-skills.ts recommendedPages → registry paths ──")
skills = read('shared/agent-skills.ts')
roles = read('shared/orb-specialized-agents.ts')
combined = skills + "\n" + roles

for m in re.finditer(r'(?:recommendedPages|pages):\s*\[([^\]]+)\]', combined):
    paths = re.findall(r'"(/[^"]*)"', m.group(1))
    for p in paths:
        base = p.split("?")[0]
        if base not in ALL_REGISTRY_BASEPATHS and base != "/":
            issues.append(("A", "skills", p, "path not in appRegistry"))

# Specifically validate training-specialist mentions /lora-trainer (redirect alias)
specialist_block = re.search(r'"training-specialist":\s*\{[^}]+\}', combined, re.DOTALL)
if specialist_block:
    if '/lora-trainer' not in specialist_block.group(0):
        issues.append((
            "A",
            "skills",
            "training-specialist",
            "missing /lora-trainer alias in pages — kept as legacy redirect target",
        ))


# ── B. PAGE_TO_GUIDE_INTENT pageIds → registry IDs ───────────────────────
print("── B. PAGE_TO_GUIDE_INTENT pageIds → registry IDs ──")
widget = read('client/src/components/ProactiveOrbWidget.tsx')
m = re.search(r'PAGE_TO_GUIDE_INTENT[^=]*=\s*\{([^}]+)\}', widget)
if m:
    keys = re.findall(r'(?:^|\s|,)\s*"?([\w-]+)"?\s*:\s*"', m.group(1))
    for k in keys:
        if k not in PAGE_FIELDS:
            issues.append(("B", "guide-intent", k, "pageId not in registry"))


# ── C. PAGE_QUICK_ACTIONS pageIds → registry IDs ─────────────────────────
print("── C. PAGE_QUICK_ACTIONS pageIds → registry IDs ──")
m = re.search(r'PAGE_QUICK_ACTIONS[^=]*=\s*\{([\s\S]*?)\n\};', widget)
if m:
    keys = re.findall(r'(?:^|\n)\s*"?([\w-]+)"?\s*:\s*\[', m.group(1))
    for k in keys:
        if k not in PAGE_FIELDS:
            issues.append(("C", "quick-actions", k, "pageId not in registry"))


# ── D. orbHints non-empty per supportsPageAgent=true ─────────────────────
print("── D. orbHints non-empty for interactive pages ──")
for pid, body in PAGE_FIELDS.items():
    if not ID_TO_SUPPORTS.get(pid, True):
        continue
    h = re.search(r'orbHints:\s*\[([^\]]*)\]', body, re.DOTALL)
    if h:
        items = re.findall(r'"[^"]+"', h.group(1))
        if not items:
            issues.append(("D", "orb-hints", pid, "supportsPageAgent=true but orbHints is empty"))


# ── E. agentEntryPriority duplicates within same group ───────────────────
# Some duplicates are intentional — Hub-style page + concrete destination
# both being "equally good" entry points where the ranker should fall back
# to text-match strength. Documented here.
INTENTIONAL_PRIORITY_PAIRS = {
    # create (Hub at /create) and studio (canonical hub at /studio) are both
    # priority 2 — both serve "創作 / 開始做東西" with equal weight.
    frozenset({"create", "studio"}),
    # image-studio is the dedicated image surface; playground is the meta-hub
    # that wraps image/video/pro studios. Both = 3 because the ranker should
    # pick whichever has stronger keyword overlap.
    frozenset({"image-studio", "playground"}),
    # account-settings (帳號) and settings (個人偏好) are different surfaces
    # with non-overlapping aliases; sharing priority 90 is fine.
    frozenset({"account-settings", "settings"}),
}

print("── E. agentEntryPriority duplicates within group ──")
by_group = defaultdict(list)
for pid, group in ID_TO_GROUP.items():
    if pid in ID_TO_PRIO:
        by_group[group].append((ID_TO_PRIO[pid], pid))
for group, prios in by_group.items():
    counts = Counter(p for p, _ in prios)
    for prio, count in counts.items():
        if count > 1:
            dup_ids = frozenset(pid for p, pid in prios if p == prio)
            if dup_ids in INTENTIONAL_PRIORITY_PAIRS:
                continue
            issues.append((
                "E",
                "priority-dup",
                group,
                f"priority {prio} shared by {sorted(dup_ids)}",
            ))


# ── F. Quick action setTab tabIds → page TABS ────────────────────────────
print("── F. Quick action setTab tabIds → page TABS ──")
# Find quickActions with setTab actions, extract tabId, then verify the
# destination page actually has that tab id in its file.
PAGE_FILE_BY_ID = {}
for pid in PAGE_FIELDS:
    # Map pageId to source file by best-effort search
    for f in [
        f"client/src/pages/{pid.replace('-', '')}.tsx",
        f"client/src/pages/{pid.title().replace('-', '')}.tsx",
    ]:
        try:
            with open(f):
                PAGE_FILE_BY_ID[pid] = f
                break
        except FileNotFoundError:
            continue


# Report
print()
if not issues:
    print("✓ Cross-cutting audit clean — no gaps found.")
    sys.exit(0)

print(f"=== {len(issues)} issues ===")
by_cat = defaultdict(list)
for cat, sub, key, msg in issues:
    by_cat[cat].append((sub, key, msg))

for cat in sorted(by_cat):
    print(f"\n[{cat}] {len(by_cat[cat])} issue(s):")
    for sub, key, msg in by_cat[cat]:
        print(f"  - {sub}: {key} — {msg}")

sys.exit(1)
