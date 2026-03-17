# 禪意多模態 AI 工作室 - Project TODO

## PART 1: UI/UX 高階禪意設計
- [x] 移除所有卡通吉祥物 (熊/鳥/兔)，替換為 Zen Co-Pilot 發光球體
- [x] 實作 Glassmorphism 毛玻璃效果全局樣式
- [x] 升級 Morandi/Zen 調色盤 (#F5F3F0, #6C6C6C)
- [x] Co-Pilot 懸停展開毛玻璃 tooltip（解釋 Temperature, Seed 等概念）
- [x] 骨架載入器 + 明確進度文字 (e.g., "合成語音中... 45%")
- [x] 行動裝置觸控優化 (Bottom Sheet, Tap-to-select)
- [x] Vibe Cards 使用高品質寫實縮圖

## PART 2: 深度角色塑造與互聯工作流
- [x] /models 重構為「角色鍛造所」多步驟精靈
- [x] 多角度資料集 UI（正面/側面/背面/表情）
- [x] 自動標註 + 觸發詞設定
- [x] 進階超參數滑桿 (Epochs, Learning Rate, Batch Size)
- [x] Studio 右側 Asset Drawer（拖放角色到 First Frame / Reference Images）
- [x] LoRA 權重/強度滑桿
- [x] Lightning / Deep Precision 模式切換
- [x] Director AI「發送到工作室」按鈕自動填充 Canvas

## PART 3: 雙引擎 RAG 與多模態調度
- [x] Director AI 分割畫面（左：聊天 / 右：Storyboard）
- [x] 雙引擎 Agent (Perplexity + Gemini Pro CO-STAR)
- [x] 多模態平行調度 + 正面解剖學約束
- [ ] ZIP 一鍵匯出 (.mp4, .mp3, .wav, .txt) — 需要實際檔案才能實作

## PART 4: 企業級 RBAC 與成本控制
- [x] 精確成本追蹤器 UI（tokens/seconds/characters → USD）
- [x] 企業共享資產網格 + 標籤系統
- [x] 共享獎勵配額機制
- [x] 持久「回報問題」按鈕

## PART 5: 基礎設施與可靠性
- [x] 背景任務佇列 SSE 進度串流
- [x] 安全中間件 Gemini Flash 預檢
- [x] 部分失敗回滾（不扣配額）
- [x] 零編譯錯誤驗證
- [x] .env.example 更新
- [x] 所有 UI 文字繁體中文
- [x] Vitest 測試更新 (28 tests passed)

## 已完成（v1 基礎版）
- [x] 資料庫 Schema 設計與遷移
- [x] 後端 tRPC 路由
- [x] 基礎前端頁面
- [x] 認證流程

## Phase 2 Critical Refactoring

### Pillar 1: Dynamic Zen Co-Pilot & Glassmorphism
- [x] Enforce strict Glassmorphism (blur backdrop, semi-transparent panels, no harsh borders)
- [x] Zen Co-Pilot orb with framer-motion breathing pulse animation
- [x] New user onboarding overlay (Zen Orb floats to UI elements with healing language)

### Pillar 2: Modality-Specific Workspaces
- [x] Image Workspace (Aspect Ratio, Style/Vibe Reference uploads, Negative Prompts)
- [x] Video Workspace (First/Last Frame dropzones, Camera Motion controls: Pan/Zoom/Tilt)
- [x] Audio Workspace (Instrumental vs Vocal toggle, Lyrics text area)
- [x] Voice Workspace (Voice Actor dropdown, Emotion sliders, Speed controls)

### Pillar 3: Progressive Disclosure Prompt Builder
- [x] Top level: Visual Vibe Cards selection
- [x] Advanced accordion: Subject, Action, Environment, Lighting, Camera Angle fields
- [x] Auto-concatenation into elite system prompt

### Pillar 4: Consistency Vault
- [x] Dedicated Consistency Vault panel for Character/Scene reference images
- [x] Upload and save Character Reference Images
- [x] Upload and save Scene Reference Images
- [x] Drag-and-drop from Vault into Video Workspace
- [x] Backend passes references as strict reference_image parameters

### Testing & Verification
- [x] Updated Vitest tests for new workspace params (32 tests passed)
- [x] TypeScript zero errors
- [x] All 4 workspaces verified in browser

## 文字清理
- [x] 移除所有「禪意」、「企業」、「禪」相關字眼

## Phase 1: 地基修復 (Foundation Repair)

### Task 1: 資料庫架構補齊
- [x] 新增 consistency_vault 資料表
- [x] 新增 subscription_plans 資料表
- [x] 新增 ai_director_preferences 資料表
- [x] 新增 generation_history 資料表
- [x] 修正 users.remainingGenerations 從 int 改為 JSON
- [x] 擴充 api_usage_logs 新增模態專屬參數欄位
- [x] 更新 server/db.ts 查詢函數

### Task 2: 真實檔案上傳管線
- [x] 新增 Express /api/upload 路由
- [x] 整合 storagePut 上傳至 S3
- [x] 更新 ConsistencyVault.tsx 使用真實上傳 API
- [x] 更新 ModelsPage.tsx 使用真實上傳 API

### Task 3: 介面動線修正
- [x] 首頁第 6 區塊替換為「共享空間」
- [x] 側邊欄新增 Consistency Vault 獨立入口
- [x] 側邊欄新增共享空間入口
- [x] 側邊欄新增個人設定入口

## Phase 2: 地基修復 - tRPC 路由與 UI 修正

### tRPC 路由新增
- [x] vault.list / vault.create / vault.update / vault.delete 路由
- [x] directorPreferences.get / directorPreferences.update 路由
- [x] history.list / history.bookmarked / history.toggleBookmark / history.rate / history.delete 路由
- [x] plans.list / plans.getById 路由（公開路由）
- [x] profile.updateQuotaJson / profile.updateOnboarding 路由

### 前端更新
- [x] ConsistencyVault.tsx 改用真實 /api/upload + vault tRPC 路由
- [x] 新增 VaultPage.tsx 獨立頁面
- [x] 新增 SharedSpace.tsx 共享空間頁面
- [x] 新增 SettingsPage.tsx 個人設定頁面
- [x] Home.tsx 移除「雙模式切換」改為「共享空間」
- [x] DashboardLayout.tsx 側邊欄新增 Vault / 共享空間 / 設定入口

### 測試
- [x] phase2.test.ts 28 個測試全部通過
- [x] 全部 60 個測試通過（3 個測試檔案）
- [x] TypeScript 零錯誤
