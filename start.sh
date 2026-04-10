#!/bin/sh
set -e

echo "=== Healing Studio Startup ==="

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "[Migration] Running database migrations..."
  npx drizzle-kit migrate || echo "[Migration] Warning: migration failed, continuing anyway..."
  echo "[Migration] Done."
else
  echo "[Migration] Skipping: DATABASE_URL not set."
fi

# Start the server
echo "[Server] Starting node dist/index.js..."
exec node dist/index.js
