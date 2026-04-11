#!/bin/sh
set -e

echo "=== Healing Studio Startup ==="
echo "[Env] NODE_ENV=${NODE_ENV}"
echo "[Env] PORT=${PORT}"
echo "[Env] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "[Migration] Running database migrations..."
  # drizzle-kit migrate applies pending SQL migrations from drizzle/ folder
  npx drizzle-kit migrate --config=drizzle.config.ts || {
    echo "[Migration] Warning: drizzle-kit migrate failed, trying push instead..."
    npx drizzle-kit push --config=drizzle.config.ts || echo "[Migration] Warning: push also failed, continuing anyway..."
  }
  echo "[Migration] Done."
else
  echo "[Migration] Skipping: DATABASE_URL not set."
fi

# Verify static files exist
if [ -f "dist/public/index.html" ]; then
  echo "[Static] dist/public/index.html ✅ found"
else
  echo "[Static] WARNING: dist/public/index.html NOT found!"
fi

# Start the server
echo "[Server] Starting node dist/index.js..."
exec node dist/index.js
