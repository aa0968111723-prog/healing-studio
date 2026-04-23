# 全站健康檢查（餐廳比喻版）

日期：2026-04-23

> 2026-04-23（二次整修）：已完成第一刀，地圖功能改為後端 `/api/maps/proxy` 代送 forge key，前端不再直接攜帶 `VITE_FRONTEND_FORGE_API_KEY`。

## 1) 外場（Frontend）
- 技術棧：React 19 + Vite，路由用 wouter，資料請求用 tRPC + TanStack Query。
- 點餐流程：前端用 tRPC 的 `useMutation` 送單到 `/api/trpc`，並帶 `credentials: include`。
- 等待/錯誤體驗：
  - 頁面 lazy load 有 Skeleton。
  - 影片生成是非同步輪詢機制，生成中顯示 loading 卡片，可關閉但背景持續。
  - 失敗時有 toast 與錯誤區塊提示，不是整頁卡死。

## 2) 廚房（Backend）
- 架構：Express 單體 + tRPC router 模組化（`server/routers/*.ts`），入口集中在 `server/_core/index.ts`。
- 安全與穩定：
  - 有 helmet、compression、API rate limit。
  - 有全域錯誤處理、graceful shutdown。
  - 影片 API 使用 Zod schema 做欄位驗證（長度、範圍、enum）。
- 風險：
  - Router 與單一檔案（像 `videoStudio.ts`）很大，後續維護成本高。

## 3) 食材倉庫（Database / Cache）
- DB：MySQL + Drizzle ORM，主流查詢多為 ORM/參數化模板，SQL Injection 風險相對低。
- 防護：上傳路由有登入驗證、MIME allowlist、檔案大小限制。
- 快取：
  - 沒看到 Redis 作為跨程序/跨機器快取。
  - 現有多為 in-memory cache（例如健康檢查快取），重啟會失效，無法分散式共享。

## 4) 建築管線（部署 / 環境變數 / CORS）
- 部署：Railway 走 Dockerfile，健康檢查 `/api/health`，設定明確。
- 環境變數：
  - `.env.example` 很完整，server/client 皆有 Zod 驗證。
  - 本 repo 工作區目前沒有 `.env`（避免誤提交實際密鑰是好事）。
- 風險：
  - ✅ 第一刀已完成：地圖 key 改為後端 `FRONTEND_FORGE_API_KEY` 注入，前端不再直接暴露 `VITE_FRONTEND_FORGE_API_KEY`。
  - 目前前後端同源（`/api/trpc`）CORS 風險低；若日後拆前後端不同網域，需補 CORS allowlist。

## 最優先致命傷（建議第一刀）
1. **（已完成）前端公開 key 風險**：`VITE_FRONTEND_FORGE_API_KEY` 已改為後端代理注入。
2. **下一步補 Redis 快取**：把高成本、可重複的 AI 結果做 TTL 快取，降低外部 API 成本與等待時間。
3. **最後做廚房分站**：把超大 router 拆子模組（按模型/功能），提升可維護性與故障隔離。
