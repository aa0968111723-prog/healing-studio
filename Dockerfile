# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Alpine build tools needed for any native addons (mysql2, etc.)
# py3-pip + cryptography upgrade resolves CVE-2024-0727 in builder image.
RUN apk add --no-cache python3 py3-pip make g++ \
    && pip3 install --break-system-packages 'cryptography>=42.0.2'

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Use deterministic dependency install in CI/Cloud Build.
# Increase Node heap for large Vite production builds to avoid OOM in small builders.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm ci --legacy-peer-deps

# Copy all source code
COPY . .

# Build frontend (Vite) + backend (esbuild/tsc)
RUN npm run build

# ─── Stage 2: Production Runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Set production mode so Express serves static files and skips Vite dev server
ENV NODE_ENV=production

# AIDV-57：每日 DB 備份 cron（server/jobs/dbSnapshotJob.ts）在 runtime 透過
# spawn("mysqldump") 對正式庫做一致性快照（--single-transaction，唯讀、不鎖表）。
# mariadb-client 提供 Alpine 上的 mysqldump binary，約 +3MB。
#   ⚠️ mariadb-connector-c 一定要一起裝：MySQL 8 server 預設用 caching_sha2_password
#   認證，而 Alpine mariadb-client 自身不含該 auth plugin——少了 connector-c 會在
#   連線階段就以 error 1045 "Plugin caching_sha2_password could not be loaded"
#   （載不到 /usr/lib/mariadb/plugin/caching_sha2_password.so）而失敗，
#   dump 直接 0-byte（備份等於壞掉）。connector-c 補上該 plugin，讓 MariaDB client
#   能正常認證到 MySQL 8。約再 +1MB。
# 注意：apk 套件不會從 builder 階段繼承到 runner，必須在「runner」階段安裝。
RUN apk add --no-cache mariadb-client mariadb-connector-c

# Copy node_modules from builder (already compiled, avoids re-compilation issues)
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package.json for runtime metadata (optional but good practice)
COPY package.json ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# AI 全站研究系統需要在 runtime 讀取 TypeScript 原始碼以執行靜態程式碼掃描。
# 體積成本約 +10MB，但啟用了 siteCodeScanner 真正掃描檔案的能力（否則
# 掃描器只能在 dist/ 上執行，回傳 0 findings）。
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/src ./client/src
COPY --from=builder /app/shared ./shared

# Railway dynamically assigns $PORT — expose the default
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
