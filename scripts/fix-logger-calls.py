#!/usr/bin/env python3
"""
Fix logger.X({event: "name", ...}) → logger.X("name", { ... }) across all agent
collaboration / multi-agent files. These all share the same legacy pattern.

Looks for the multi-line block:

    logger.<level>({
      event: "<name>",
      <key>: <value>,
      ...
    });

and rewrites it to:

    logger.<level>("<name>", {
      <key>: <value>,
      ...
    });

If the block has only the event field, the metadata object is omitted entirely.
"""
import re
import sys
from pathlib import Path

PATTERN = re.compile(
    r'(\s*)logger\.(info|warn|error|debug)\(\{\s*\n'
    r'(\s+)event:\s*"([^"]+)",?\s*\n'
    r'((?:.|\n)*?)'
    r'\}\);',
    re.MULTILINE,
)


def replace(match: re.Match) -> str:
    indent = match.group(1)
    level = match.group(2)
    inner_indent = match.group(3)
    event_name = match.group(4)
    rest = match.group(5).rstrip()

    # If rest is empty (only event), output single-arg form
    if not rest.strip():
        return f'{indent}logger.{level}("{event_name}");'

    # Otherwise wrap rest as second arg
    return (
        f'{indent}logger.{level}("{event_name}", {{\n'
        f'{rest}\n'
        f'{indent}}});'
    )


FILES = [
    "server/services/agentCollaborationOrchestrator.ts",
    "server/services/agentCommunicationBus.ts",
    "server/services/collaborativeTaskPlanner.ts",
    "server/services/multiAgentIntegration.ts",
    "server/routers/agentCollaborationRouter.ts",
]

repo_root = Path(__file__).resolve().parent.parent
fixed_total = 0
for relpath in FILES:
    path = repo_root / relpath
    src = path.read_text()
    new_src, n = PATTERN.subn(replace, src)
    if n > 0:
        path.write_text(new_src)
        print(f"  {relpath}: {n} replacements")
    fixed_total += n
print(f"Total: {fixed_total} replacements across {len(FILES)} files")
