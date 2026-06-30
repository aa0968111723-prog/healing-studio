#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "[session-start] Installing npm dependencies in $PROJECT_DIR ..."
cd "$PROJECT_DIR"
npm install

echo "[session-start] Dependencies ready. Running quick type check ..."
node ./node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit 2>&1 | tail -5 || true

echo "[session-start] Session environment ready."
