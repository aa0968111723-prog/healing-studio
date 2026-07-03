# J — 完整程式碼結構總覽(補充 wave J)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 性質:全 repo 目錄結構地圖 + 規模量化 + 每層職責。與 `00-overview §6`(資料夾導覽)互補:00 是導覽,本文件是**完整結構字典**,含檔案數/行數大戶/建置鏈。

---

## 1. 頂層佈局(monorepo,單一 package.json)

```
healing-studio/
├── client/          前端(React 19 + Vite + wouter)
├── server/          後端(Express + tRPC v11 + node-cron)
├── shared/          前後端共用(型別/註冊表/協定)109 檔
├── drizzle/         MySQL schema + migrations(schema.ts 4,758 行,journal idx→121)
├── supabase/        Postgres migrations(23)+ edge functions(2)
├── db/              孤兒 migrations 目錄(零引用,見 G4)
├── tests/           Playwright e2e(8 spec)
├── load-tests/      k6 負載測試(AIDV-711,無 npm script)
├── scripts/         check-*/scan-*/audit-*/simulate-* 自動化
├── config/          pricing-table.json 等(部分孤兒)
├── types/           全域型別宣告
├── patches/         patch-package(wouter@3.7.1 注入 __WOUTER_ROUTES__)
├── dev-environment/ 開發環境輔助
├── docs/            大量文件(含本 research/ 系列)
├── .claude/skills/  aidv-* 開發工作流技能(7 個)
├── .manus/          Manus 時期遺物(19 個 SQL 執行紀錄,可清)
├── AGENTS.md COORDINATION.md README.md todo.md(61KB)
├── .env.example(600+ 行) .env.production(7 個 VITE_* 公開旗標)
├── Dockerfile railway.toml .nixpacks.toml(fallback)
├── package.json tsconfig.json vite.config.ts drizzle.config.ts
├── vitest.config.ts playwright.config.ts eslint.config.js components.json
├── .brain-state.json(186KB,誤 commit 的 runtime 狀態,見 G4)
└── audit_orb.py deep_audit.py requirements.txt(Python 稽核腳本)
```

## 2. 規模量化(commit aef4214 實測)

| 層 | 數量 | 備註 |
|---|---|---|
| 前端頁面(`client/src/pages/*.tsx`) | 52 | 全 lazy 載入(Home 除外) |
| 前端元件(`components/**`,遞迴) | 307 | 含 ui/(shadcn)、orb*/、director/ 等 19 子目錄 |
| React Context(`contexts/*.tsx`) | 22 | App.tsx Provider 樹 17 層 |
| 共用 hooks(`hooks/**`) | 24 | useMobile/useOrbTaskObservations 等 |
| tRPC routers(`server/routers/*.ts`) | 76 | appRouter 註冊 60+ 命名空間 |
| 服務層(`server/services/**`) | 184 | orb*/spirit*/director/ 等 |
| 排程(`server/jobs/*.ts`) | 25 | node-cron |
| REST/webhook 路由(`server/routes/*.ts`) | 19 | |
| 共用模組(`shared/*.ts`) | 109 | 模型註冊表/agent-plan/worldbuilding-* |
| MySQL 表(`drizzle/schema.ts`) | 102 | 4,758 行,0 外鍵 |
| Supabase migrations | 23 | + 2 edge functions |
| **vitest 測試檔** | **602** | 但 e2e/eval 不在 CI;CI 目前 runner 秒掛 |
| Playwright spec | 8 | `tests/` |
| 前端總行數(.tsx) | ~199,000 | |
| 後端總行數(.ts,非測試) | ~180,000 | |

## 3. 前端結構(`client/src/`)

| 目錄 | 職責 | 重點內容 |
|---|---|---|
| `pages/` | 路由頁面元件(52) | 五大創作頁+admin/+settings/+social/ 子目錄 |
| `shells/` | 4-shell 殼層 | VideoShell/LearnShell/SettingsShell/SocialShell、`shellRouteTable.ts`(路由單一真相源)、video/(Cockpit 座艙) |
| `components/` | 領域+全域元件(307) | `ui/`=shadcn 基礎件;`orb/`+`orb-agent/`=光球;`director/`、`create/`、`workspaces/`、`design-kit/`(tokens)、`brain-pipeline/`、`home/`、`learn-hub/`、`teams/`、`social/`、`promptVault/`、`connectors/`、`flow-tv/`、`animation/`、`project/`、`feedback/`、`layout/` |
| `contexts/` | React Context(22) | Theme/Personality/GlobalOrbChat/OrbState/PageAgent/WorldContext/Projects/FocusFlow/Ambient/SiteOnboarding/IntentCard 等 |
| `adapters/` | tRPC/mock 接縫(6 條) | trpcClient(CSRF `x-trpc-source`)、dataStore/commander/posting(social 用) |
| `agent/` | 前端光球執行器 | `useGlobalOrbExecutor.ts`(多步驟頁面操作) |
| `spine/` | 4-shell 脊椎 | `projectGateway.ts`(聚合 creativeProject+worldbuilding+worldStoryboard)、`gate.ts`(確認門純函式) |
| `app/` | 路由組裝 | `ShellRoutes.tsx`、`lazyPages.ts`、`navigation.tsx` |
| `config/` | 前端設定 | `appRegistry`(re-export shared)、`featureFlags.ts`、`videoFlags`/`projectFlags`/`promptVaultFlags`/`teamsFlags`、`sidebarIcons` |
| `hooks/`/`lib/`/`stores/`/`data/`/`types/`/`providers/`/`_core/` | 支援層 | `_core/hooks/useAuth`、`lib/upload.ts`(presign 上傳鏈)、`stores/workspaceStore`(非 zustand) |

**前端行數大戶**(維護風險集中處):AnimationStudio 6,946 / DirectorAI 6,606 / GlobalOrbChatContext 6,567 / VideoStudio 5,408 / ImageStudio 5,354 / ProStudio 4,948 / OrbGuidePanel 4,883 / ProactiveOrbWidget 4,160 / Studio 3,998。

## 4. 後端結構(`server/`)

| 目錄 | 職責 | 重點內容 |
|---|---|---|
| `_core/` | 平台核心 | `index.ts`(Express 入口)、`trpc.ts`(procedure 階梯)、`googleAuth`/`oauth`(JWT jose)、`llmRouter.ts`(多供應商路由)、`llm.ts`(invokeLLM+估價表)、安全 guard(csrf/input/xss/ssrf/rateLimiter)、`redis*`、`featureFlags.ts`、`env.validated.ts` |
| `routers/` | tRPC 路由(76) | 見 00-overview §5.1;大戶 director.ts 3,629 / brainPipeline 3,401 / ai.ts 3,366 / generate 2,437;`learnHub.seed.ts` 12,195 行(種子教材) |
| `services/` | 業務服務(184) | `orb*`(光球 60+ 檔)、`spirit*`+`spiritTools/`(精靈)、`director/`(CO-STAR)、`fal*`/`replicate*`/`elevenLabs*`/`geminiMedia`(生成)、`memory/`(RAG 三層,含 MEMORY_TIERS.md)、`cost/`、`security/`(contentModeration/ragInjectionGuard)、`authz/`、`auth/`;大戶 agentToolExecutor 8,087 / modelPricing 3,500 / brainAutoRepair 3,034 |
| `jobs/` | cron(25) | newsFetcher/modelTrainingWorker/teachingArchiveIngestionWorker/dbSnapshot/r2Snapshot/apiUsageAlert/providerHealthProbe/costLedgerReconcile 等(見 02 §11) |
| `routes/` | REST/webhook(19) | upload/download/webhookFal|Suno|Replicate|Stripe/videoRoute/icsFeed/localAuth/googleAuth/passwordReset/orbTasks/aiProxy/`v1`(對外 API)/adminEvents/agentStatus/handoffTrace/toolsModels |
| `subsystems/` | 子系統 | `commander`/`contextPackets`/`projectContext`/`trainingTrack`(M 系列) |
| `repositories/` | 資料存取 | `mysql/`、`base/` |
| `middleware/` | 中介層 | brainContext(注入 user_ai_brain)等 |
| `eval/` | planner 回歸 | `runEval.ts`+`cases/`(6 個 case,`npm run eval`) |
| `ws/` | WebSocket | `orbVoiceGateway.ts`(/ws/orb-voice) |
| `config/`/`data/`/`lib/`/`utils/` | 支援層 | |
| `db.ts` | 5,701 行 | DB 存取巨石(扣點/退款/migration runner) |

**後端行數大戶**:learnHub.seed 12,195 / agentToolExecutor 8,087 / db.ts 5,701 / director 3,629 / modelPricing 3,500 / brainPipeline 3,401 / ai.ts 3,366 / brainAutoRepair 3,034。

## 5. 共用層(`shared/`,109 檔)

| 群組 | 檔案 |
|---|---|
| 模型註冊表 | unifiedModelRegistry、textToImageModelRegistry、imageToImageModelRegistry、videoModelCatalog、v2vModelRegistry、audioModelRegistry、voiceModelRegistry、threeDModelRegistry、skeletalModelRegistry、fineTuneModelRegistry、aiModelsCatalog、falModelCapabilities、engineModelIds |
| 代理/光球 | agent-plan-schema、agent-plan-safety、agent-actions、orb-agent-roles、global-agent-registry/tools/capabilities/workflows/orchestrator、slash-commands、spirit-chat-tools、spirit-handoff-protocol、agent-codex、agent-skills、skill-manifest |
| 世界觀(~20 檔) | worldbuilding-types/animation/timeline/generation-tasks/production-package/readiness/result-mapping/inspiration/progress/actions、video-input-assets、video-state-machines |
| 其他 | slash-commands、cross-modality-workflows、site-prompt-catalog、visual-inspiration-library、currency、genId、csv-safe、safe-url、`skills/official/` |

## 6. 資料層

- **MySQL**(`drizzle/schema.ts`):102 表、290 索引、**0 外鍵**;`meta/_journal.json` idx→121;`db:push`=drizzle-kit migrate;`MIGRATION_FAIL_CLOSED`(prod 人工設 true)。逐表字典見 H4(**待補**——因額度中斷未產出)。
- **Supabase**(`supabase/`):23 migrations + `functions/agent-heartbeat`、`functions/tts-liveness-probe`;主題=多代理影片管線(dispatch_task/checkpoint/SLO/20 tasks-hr trigger)+ 3 pg_cron;**5 張核心表基底 DDL 不在 repo**(dashboard 施作,B §5)。

## 7. 建置與部署鏈

```
開發:  npm run dev        → tsx watch server/_core/index.ts(前端 Vite middleware)
建置:  npm run build      → vite build(前端) + esbuild(後端 bundle → dist/index.js)
啟動:  npm start          → NODE_ENV=production node dist/index.js
型別:  npm run check / typecheck → tsc --noEmit(AGENTS.md 要求用 node tsc 非 npx)
測試:  npm test(vitest run) / test:e2e(playwright) / eval(planner regression)
掃描:  check:routes / check:navigation / check:shell-routes / check:learn-wiring 等
部署:  Railway → Dockerfile(railway.toml builder=DOCKERFILE)→ healthcheck /api/health(600s)
       → migration fail-closed → restart ON_FAILURE ×3
CI:    .github/workflows/pr-gate.yml(tsc·routes·navigation·vitest 四關)
       ⚠ 目前 runner 秒掛(帳務),實際合併零把關(見 F/B)
```

## 8. 依賴要點(package.json)

- 前端:react 19、wouter(patch)、@trpc/*、@tanstack/react-query、@radix-ui/*(全家桶)、tailwindcss 4、framer-motion、three+@react-three/*、@xyflow/react+dagre、recharts、xstate、jszip、jose
- 後端:express 4、drizzle-orm(⚠ 0.44.5,SQLi 需升 ^0.45.2)、mysql2、ioredis、@aws-sdk/client-s3、@fal-ai/client、replicate、elevenlabs、@google-cloud/*、@google/genai、@langchain/*、langsmith、node-cron、nodemailer、helmet、zod 4
- ⚠ 依賴漏洞 36 個(2 critical/9 high),處置表見 G4;Sentry 接線在但 `@sentry/node` 未列入=線上錯誤追蹤 no-op(B)

## 9. 交叉引用
- 詞彙/架構總覽:`00-overview`
- 逐頁功能與接線:`01-features`/`02-fullstack`
- 各層深挖:成本 `A`/`H1`、基建 `B`、UIUX `C`、實用 `D`、代理 `E`、任務卡 `F`、座艙 `G1`、世界觀 `G2`、工具 `G3`、雜項 `G4`、欄位字典 `H2`、技術債與沉睡能力 `I`
- **待補**:`H3`(音訊/統一/世界觀/座艙欄位字典)、`H4`(102 表逐表字典+對外 API)因 Fable5 額度中斷未產出,已完成研讀待補寫
