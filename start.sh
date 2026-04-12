#!/bin/sh
echo "=== Healing Studio Startup ==="
echo "[Env] NODE_ENV=${NODE_ENV}"
echo "[Env] PORT=${PORT}"
echo "[Env] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo YES || echo NO)"

# Verify static files exist
if [ -f "/app/dist/public/index.html" ]; then
  echo "[Static] /app/dist/public/index.html found"
else
  echo "[Static] WARNING: /app/dist/public/index.html NOT found!"
fi

echo "[Server] Starting node dist/index.js..."
exec node /app/dist/index.js
