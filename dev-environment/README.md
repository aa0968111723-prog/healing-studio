# AIDV / healing-studio — 終端機開發環境包（in-repo）

> repo 內的一鍵本機開發環境（`dev-environment/`）。
> 已在 repo 內 → 不需 clone，直接 `cd dev-environment` 跑 setup 即可。
> 對應 Jira 專案 **AIDV**（活看板，SSOT）＋ `docs/plan/AIDV-master-plan.md`（鏡像）。
> 校準日：2026-06-18（依 repo `main` 與 AIDV-1～100 實況）。

---

## 1. 這個棧長什麼樣

| 層 | 技術 |
|---|---|
| 前端 | React 19 · Vite 7 · Wouter · TanStack Query · Tailwind v4 · Radix/shadcn · three/R3F · XState |
| API | tRPC v11 · Express 4 · Helmet · 自建 JWT（jose） |
| 資料 | **MySQL**（Drizzle ORM，77 個 migration）· 向量＝Pinecone（AIDV-19 後改 Supabase pgvector） |
| LLM | OpenRouter（統一閘道，`LLM_ENGINE=auto`）→ Anthropic / Gemini / Vertex 降級 |
| 生成 | fal.ai · Replicate · Gemini · ElevenLabs · Suno |
| 部署 | Railway（Dockerfile builder）· healthcheck `/api/health` |
| 任務匯流排 | 目前＝**記憶體內 EventEmitter**（`server/generationEvents.ts`）→ AIDV-13 要改 BullMQ+Redis |

**規模**：82 表 / 54 routes / ~565 procedure / 34 router；影片 18 子系統。

---

## 2. 前置需求

- **Node ≥ 20**（`engines` 限定；建議 20 LTS。用 nvm/nvm-windows 管版本）
- **npm ≥ 10**
- **Git**
- **Docker Desktop**（最省事；用來起本機 MySQL + Redis）
  - 不想用 Docker？自備 MySQL 8，並把 `.env` 的 `DATABASE_URL` 指過去即可（`-SkipDocker` / `SKIP_DOCKER=1`）。

---

## 3. 一鍵安裝（已在 repo 內）

在 repo 根目錄，進入本資料夾跑 setup（腳本會自動定位 repo 根，不需 clone）：

**Windows（PowerShell）**
```powershell
cd dev-environment
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

**macOS / Linux / WSL / Git Bash**
```bash
cd dev-environment
./setup.sh
```

腳本會：① 檢查 Node/npm/git → ② 定位 repo 根（`git rev-parse --show-toplevel`，不 clone）→ ③ 建 `<repo>/.env` 並自動產生 `JWT_SECRET`（僅當 `.env` 不存在）→ ④ `npm install --legacy-peer-deps` → ⑤ 起 MySQL+Redis 並等 healthy → ⑥ 套 migration（`npm run db:push`；boot 時 `runMigrations` 也會補套）。完成後 `npm run dev`。

---

## 4. 手動步驟（想自己一步步跑）

```bash
# 0) 你已在 repo 根（已 clone 過本 repo）。本資料夾即 dev-environment/。

# 1) 起本機 MySQL + Redis（compose 檔在 dev-environment/）
docker compose -f dev-environment/docker-compose.yml up -d

# 2) 建 .env（最小集），並填 JWT_SECRET
cp dev-environment/.env.dev.example .env
#   產生密鑰並貼到 .env 的 JWT_SECRET：
openssl rand -base64 32

# 3) 安裝相依（repo 鎖定 legacy-peer-deps）
npm install --legacy-peer-deps

# 4) 套 migration（需 DATABASE_URL）
npm run db:push

# 5) 開發！
npm run dev          # → http://localhost:3000
```

> 也可用 `Makefile`（在 repo 根）：`make up && make env && make install && make migrate && make dev`。

---

## 5. 常用指令（package.json）

| 指令 | 作用 |
|---|---|
| `npm run dev` | 開發伺服器（tsx watch，含 Vite middleware） |
| `npm run build` | 生產建置（vite build + esbuild 打包 server） |
| `npm start` | 跑 `dist/index.js`（生產） |
| `npm run check` | **驗證門**：`check-deps --typecheck` |
| `npm run check:routes` | 路由/registry 對齊掃描 |
| `npm run check:navigation` | 禁 `window.location` 內部導航掃描 |
| `npm run test` | 單元測試（vitest） |
| `npm run test:e2e` | 端對端（Playwright） |
| `npm run db:push` | drizzle-kit migrate |
| `npm run eval` | 規劃器 eval（改 prompt/schema 前必跑） |

### 開發工作流的「驗證門」（master-plan §2，每張卡階 3→4 全綠才放行）
```bash
npx tsc --noEmit
npm run check:routes
npm run check:navigation
npx vitest run <你改的測> <鄰測>
```

---

## 6. 疑難排解（踩過的雷，先看這裡）

- **`npm install` 報 peer 衝突** → 一定要帶 `--legacy-peer-deps`（`.npmrc` 已鎖，但手動跑別漏）。
- **啟動時一堆「⚠ 環境變數缺失提醒」** → 正常。`server/_core/env.validated.ts` 用 OARS 模式：缺金鑰只警告不崩潰。要用到哪個模組再貼那把金鑰。
- **沒設 `DATABASE_URL`** → 伺服器仍會起，但會印 `Missing DATABASE_URL. Skipping mysql2…`，所有 DB 功能與 migration 都跳過。本機務必起 MySQL。
- **migration 失敗 / 卡住** → 用 `node dev-environment/migrate-debug.mjs` 逐句套、單句報錯（讀 `DATABASE_URL` env，fallback 才用 dev 預設）。本 repo 有 **migration 三鐵則**（2026-06-13 P0 教訓 AIDV-76）：① 禁 MySQL 不支援的 `CREATE INDEX IF NOT EXISTS`；② 每個 `--> statement-breakpoint` 只能一句（mysql2 沒開 multipleStatements）；③ `ALTER/CREATE INDEX` 必須 `information_schema` 守門。守門測試在 `server/migration-prod-pending-block.test.ts`。
- **boot 印 orphan migration 警告** → 未登記 `drizzle/meta/_journal.json` 的 `.sql` 永遠不會跑（已知白名單：`0033`、`0039–0044`、`0067_repair_worldbuilding_v4_columns`，見 `server/orphan-migrations-journal.test.ts`）。
- **vitest 有 13 個失敗** → main baseline 既有（jsdom29+vitest2 的 localStorage 問題，AIDV-29），**不是你弄壞的**。判斷新回歸時請扣掉這 13。
- **Atlassian / Confluence 連不上** → 已知（AIDV-88）：Rovo MCP 只有 Jira scope、且本雲端容器 egress 擋 atlassian.net。與本機開發無關。

---

## 7. 缺什麼？

完整「需要補足的部分」見規劃文件。一句話版：
- **要貼 Railway 的金鑰**：`REDIS_URL`（AIDV-13）、`FAL_API_KEY`（AIDV-16）、Supabase keys（AIDV-19）。
- **要修的反模式**（深度稽核報告三大）：記憶體內 `generationBus` → BullMQ+Redis；`base64` 上傳 → signed URL/tus；runtime SchemaEnsure → 部署前獨立 migration。
- **金鑰治理**：任何「正式」金鑰一律只貼 Railway，絕不 commit（master-plan 鐵律 3）。
