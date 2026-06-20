#!/usr/bin/env bash
# =============================================================================
# AIDV / healing-studio — 一鍵本機開發環境（macOS / Linux / WSL / Git Bash）
# in-repo 版：本腳本位於 repo 內 dev-environment/，假設你已在 repo（不 clone）。
# 用法：
#   在 repo 根 → cd dev-environment → ./setup.sh
#   或直接：bash dev-environment/setup.sh
# 環境變數：
#   REPO_DIR=/path/to/repo bash setup.sh   # 覆寫 repo 位置（預設自動偵測）
#   SKIP_DOCKER=1 bash setup.sh    # 自備 MySQL，不用 docker
#   SKIP_INSTALL=1 bash setup.sh   # 跳過 npm install
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_g(){ printf "\033[32m%s\033[0m\n" "$*"; }
c_y(){ printf "\033[33m%s\033[0m\n" "$*"; }
c_r(){ printf "\033[31m%s\033[0m\n" "$*"; }
step(){ printf "\n\033[36m▶ %s\033[0m\n" "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

# ── 0. 前置檢查 ──────────────────────────────────────────────────────────
step "0/6 檢查前置工具"
have git  || { c_r "缺 git"; exit 1; }
have node || { c_r "缺 node（需 >=20）"; exit 1; }
have npm  || { c_r "缺 npm（需 >=10）"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { c_r "Node 版本 $(node -v) 太舊，需 >=20（建議用 nvm 裝 20 LTS）"; exit 1; }
c_g "git / node $(node -v) / npm $(npm -v) OK"

# ── 1. 定位 repo（in-repo：不 clone）─────────────────────────────────────
step "1/6 定位 repo 根"
if [ -n "${REPO_DIR:-}" ]; then
  :
elif REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  :  # 由 git 推得 repo 根
else
  REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"  # fallback：dev-environment 上層即 repo 根
fi
c_g "REPO_DIR = $REPO_DIR"
cd "$REPO_DIR"

# ── 2. 建立 .env ─────────────────────────────────────────────────────────
step "2/6 建立 .env（最小可跑集）"
if [ -f .env ]; then
  c_y ".env 已存在，略過（如要重建請先刪除）"
else
  cp "$SCRIPT_DIR/.env.dev.example" .env
  SECRET="$( (openssl rand -base64 32 2>/dev/null) || node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
  # 跨平台 sed（GNU/BSD）
  if sed --version >/dev/null 2>&1; then sed -i "s|__GENERATED_BY_SETUP__|${SECRET}|" .env;
  else sed -i '' "s|__GENERATED_BY_SETUP__|${SECRET}|" .env; fi
  c_g "已建立 .env 並產生 JWT_SECRET（其餘金鑰留空＝OARS 警告、不崩潰）"
fi

# ── 3. 安裝相依 ──────────────────────────────────────────────────────────
step "3/6 npm install（--legacy-peer-deps，repo 慣例）"
if [ "${SKIP_INSTALL:-0}" = "1" ]; then c_y "SKIP_INSTALL=1，略過";
else npm install --legacy-peer-deps; fi

# ── 4. 起 MySQL + Redis ──────────────────────────────────────────────────
step "4/6 起本機 MySQL + Redis"
if [ "${SKIP_DOCKER:-0}" = "1" ]; then
  c_y "SKIP_DOCKER=1：請自備 MySQL 並確認 .env 的 DATABASE_URL 正確"
elif have docker; then
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d
  printf "等待 MySQL healthy "
  for i in $(seq 1 40); do
    s="$(docker inspect --format '{{.State.Health.Status}}' aidv-mysql 2>/dev/null || echo none)"
    [ "$s" = "healthy" ] && { echo; c_g "MySQL ready"; break; }
    printf "."; sleep 2
  done
else
  c_y "未發現 docker：請改自備 MySQL，或安裝 Docker Desktop 後重跑（或 SKIP_DOCKER=1）"
fi

# ── 5. 套 migration ──────────────────────────────────────────────────────
step "5/6 套用 drizzle migration"
if grep -q '__GENERATED' .env 2>/dev/null; then c_y "（提醒）.env 仍有未填佔位符"; fi
npm run db:push || c_y "db:push 失敗：確認 MySQL 已起且 DATABASE_URL 正確後再 \`npm run db:push\`（boot 時 runMigrations 也會補套）"

# ── 6. 完成 ──────────────────────────────────────────────────────────────
step "6/6 完成"
c_g "本機開發環境就緒。"
cat <<EOF

下一步（在 $REPO_DIR）：
  npm run dev          # 開發伺服器 → http://localhost:3000
  npm run check        # 驗證門：tsc + 路由對齊
  npm run test         # 單元測試（vitest）

注意：
  • main baseline 有 13 個 vitest 失敗（jsdom29+vitest2 localStorage 既有問題，非新回歸）。
  • 留空的金鑰會在 console 出現「OARS 友善警告」屬正常；要實際生成影片/圖片再貼 FAL_API_KEY 等。
  • 正式金鑰一律貼 Railway，勿 commit 進 repo（master-plan 鐵律 3）。
EOF
