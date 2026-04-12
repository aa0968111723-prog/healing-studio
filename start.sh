#!/bin/sh
# NOTE: NO set -e here — we never want migration failure to kill the server

echo "=== Healing Studio Startup ==="
echo "[Env] NODE_ENV=${NODE_ENV}"
echo "[Env] PORT=${PORT}"
echo "[Env] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "[Migration] Running database migrations (max 60s)..."
  # Use timeout to prevent migration from hanging indefinitely
  timeout 60 npx drizzle-kit migrate 2>&1 || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "[Migration] Warning: migration timed out after 60s, continuing..."
    else
      echo "[Migration] Warning: migration failed (exit $EXIT_CODE), continuing anyway..."
    fi
  }
  echo "[Migration] Done."
else
  echo "[Migration] Skipping: DATABASE_URL not set."
fi

# Verify static files exist
if [ -f "dist/public/index.html" ]; then
  echo "[Static] dist/public/index.html found"
else
  echo "[Static] WARNING: dist/public/index.html NOT found!"
fi

# Start the server
echo "[Server] Starting node dist/index.js..."
exec node dist/index.js
