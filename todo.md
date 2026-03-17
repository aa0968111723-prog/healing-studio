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

## Phase 3: 全站核心功能「活化」與「邏輯對齊」審計

### 1. 模型訓練審計
- [x] 檢查角色鍛造所所有按鈕（上傳、下一步、開始訓練）
- [x] 移除所有 mockLoading / fakeSuccess 邏輯（確認無 mock 邏輯殘留）
- [x] 確保訓練按鈕觸發後端任務並寫入資料庫（models.create → backgroundJobs + fineTunedModels）

### 2. 提示詞工程符合性檢查
- [x] 審計 compileElitePrompt 函數（新增 referenceImages 參數 + visualWeight 計算）
- [x] 檢查視覺權重計算與 ControlNet 參數傳遞（visualWeight 0.3~0.7 + controlNetParams 注入）
- [x] 確保參考圖上傳後正確轉化為模型參數（styleRef/vibeRef/charRef → generateImage originalImages）

### 3. 跨模態動線驗證
- [x] 驗證腳本生成後「發送到配音/圖片工作區」按鈕（DirectorAI sendToStudio → Studio 接收 prompt + audioScript）
- [x] 確保側邊欄所有入口為真實路由無死連結（11 個側邊欄路由 = 11 個頁面檔案）
- [x] 驗證 Director AI「發送到工作室」功能

### 4. 測試與報告
- [x] 新增 phase3-audit.test.ts（32 個測試）
- [x] 回報死按鈕→功能按鈕轉換清單
- [x] 確認系統準備好承載 Phase 2 AI 人格評估

## Phase 4: 注入 AI 靈魂 (AI Soul Injection)

### 1. 生成歷史頁面 (/history)
- [x] 建立 HistoryPage.tsx 頁面元件
- [x] 從 generation_history 資料庫讀取歷史紀錄
- [x] 支援多模態縮圖顯示（圖片/影片/音樂/語音）
- [x] 實作收藏（bookmark）與評分（rating）功能
- [x] 新增 /history 路由至 App.tsx 與側邊欄

### 2. AI Director 人格系統與主動介入
- [x] 根據 ai_director_preferences 切換沉穩/創意/技術人格
- [x] 實作三種人格的差異化系統提示詞
- [x] 實作主動介入邏輯（停頓偵測、設定不足提醒）
- [x] 前端 DirectorAI 頁面整合人格切換 UI

### 3. 提示詞強度評估條 (LLM-as-a-Judge)
- [x] 後端實作 evaluatePrompt tRPC 路由
- [x] 呼叫 LLM 進行即時提示詞分析
- [x] 返回 0-100 分數 + 具體優化建議
- [x] Studio 前端新增即時分數條 UI

### 4. 測試與驗證
- [x] 新增 phase4-soul.test.ts（18 個測試）
- [x] 全部 110 個測試通過（5 個測試檔案）
- [x] 展示三種人格回覆範例
