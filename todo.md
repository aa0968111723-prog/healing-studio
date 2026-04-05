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
- [x] ZIP 一鍵匯出 (.mp4, .mp3, .wav, .txt) — JSZip 實作完成

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

## Phase 2 Final Polish: 介面極簡化與真實數據連動

### Task 1: 移除訂閱模組
- [x] 移除 SettingsPage 中訂閱方案 UI 區塊
- [x] 保留帳號資訊與導演 AI 偏好

### Task 2: 真實餘額 API 連動
- [x] 側邊欄配額數字改為真實 API 讀取（user.remainingGenerations）
- [x] 儀表板配額數字改為真實 API 讀取（dashboard.myStats）
- [x] 後端生成任務成功後扣除資料庫配額（deductUserQuota + refundUserQuota）
- [x] 移除前端寫死的假配額數字（全站皆讀 user.remainingGenerations）

### Task 3: AI 人格與評估引擎驗證
- [x] 展示三種人格對「畫一隻貓」的差異回覆
- [x] 展示 evaluatePrompt 對「一隻貓」的評分與建議

### Task 4: Phase 3 啟動宣告
- [x] 正式宣告第二階段完工
- [x] 簡述第三階段技術框架

## Phase 3-A: 品牌更迭與思維鏈可視化

### Task 1: 品牌名稱更迭
- [x] 全站文本替換 Healing Studio → AI Director
- [x] Navbar Logo 更新
- [x] 網頁 title 更新
- [x] 首頁歡迎詞更新
- [x] 系統提示訊息更新
- [x] 確認無死角（僅 dist/ 建構產物殘留，重建後消失）

### Task 2: AI 思維島鏈 (D3.js)
- [x] 安裝 d3.js + framer-motion 依賴
- [x] 後端 CoT 數據擷取與回傳（generate.multimodal 回傳 thoughtChain 陣列）
- [x] ThoughtIslandChain 元件建立（D3.js 互動式樹狀圖）
- [x] Studio 生成結果旁渲染思維樹狀圖

### Task 3: 3D 光球化身 (Visual Soul)
- [x] CSS 3D transforms + Framer Motion + SVG 濾鏡
- [x] 待機狀態：緩慢呼吸光暈
- [x] 思考中狀態：快速閃爍多色漸變
- [x] 生成中狀態：光束擴張效應
- [x] 導航列/首頁光球與 AI 全域狀態綁定（AIStateContext + useAIState）

### Task 4: 跨模態快捷操作
- [x] 歷史頁面結果卡片新增快捷按鈕（重新生成/發送到影片工作區/發送到音樂工作區）
- [x] Studio 結果卡片新增快捷按鈕（透過 ThoughtIslandChain 展示推導軌跡）
- [x] 點擊後攜帶參數無縫跳轉（sessionStorage sendToStudio）

### 測試與驗證
- [x] 新增 phase3a-visual.test.ts（16 個測試）
- [x] 全部 126 個測試通過（6 個測試檔案）

## Phase 3-B: UX 大重構 - 光球引導 + 一體化工作區

### Task 1: 光球引導型黃金 90 秒 Onboarding
- [x] 將 VisualSoul 光球移至首頁/Studio 視覺焦點位置
- [x] 建立 OnboardingFlow 元件（對話式引導 + 打字機特效）
- [x] 步驟一：光球問「今天想創作什麼畫面？」
- [x] 步驟二：展示思維鏈推導過程
- [x] 步驟三：自動生成並展示結果
- [x] 首次登入偵測邏輯（localStorage hasCompletedOnboarding）

### Task 2: 一體化工作區 (Unified Workspace)
- [x] Studio 設為核心主戰場
- [x] 左側抽屜：一致性保險庫 (Vault) + 數位資產 (Assets)
- [x] 右側抽屜：生成歷史 (History)
- [x] 抽屜面板支援拖曳/點擊匯入當前創作流
- [x] 側邊欄精簡至 6 個頂級入口（工作室/導演AI/角色鍛造所/共享空間/儀表板/設定）

### Task 3: 思維島鏈視覺層級
- [x] 生成等待期間優雅展開思維樹狀圖（hasProcessing 自動展開 + 發光邊框）
- [x] 光球互動時同步展示推導過程（OnboardingFlow 整合 ThoughtIslandChain）
- [x] 確保不被背景遮擋（border-primary/40 + shadow-lg + z-index）

### 驗證
- [x] TypeScript 零錯誤
- [x] 全部 126 個 vitest 測試通過

## Phase 3-C: 全功能地毯式生存測試

### Test A: 首頁與引導
- [x] 移除首頁所有靜態介紹卡片，光球佔據中央
- [x] Onboarding 狀態機：光球主動問話引導
- [x] 主動建議：輸入「寧靜」時跳出 Choice Chips 標籤

### Test B: Studio 與思維島
- [x] D3.js 思維島鏈真實生長（非偽造數據）
- [x] 展示推理 JSON 數據結構
- [x] Token 權重調整確實傳遞至後端 Payload

### Test C: 保險庫與資產整合
- [x] 移除側邊欄「保險庫」與「歷史」獨立入口
- [x] Studio 左右抽屜面板正常運作
- [x] 一鍵呼叫：從抽屜點擊角色帶入 Prompt

### Test D: 跨模態工作流
- [x] 圖片生成後「發送到影片」按鈕生效
- [x] 轉換時自動帶入風格、比例與 Seed
- [x] ZIP 匯出功能實作（JSZip 打包）

### 驗證
- [x] TypeScript 零錯誤
- [x] 全部 vitest 測試通過
- [x] 5 位人格滿意度報告

## Phase 3-D: 實機地毯式全功能測試 + GenAI 專家稽核

### Task 1: GenAI 專家稽核
- [x] Prompt 演化精度：最終 Prompt 符合 SD/MJ 高效語法
- [x] 跨模態參數對齊：Seed/CFG/Style 100% 繼承
- [x] CoT 真實含金量：JSON 為 LLM 真實推理，非固定拆分

### Task 2: 7 人格實機測試
- [x] 小白：OnboardingFlow Choice Chips 由 LLM 分析產生
- [x] 阿強：D3.js 島鏈根據真實推理 JSON 生長
- [x] 艾導：抽屜角色點擊 100% 填入 Prompt Builder
- [x] 忙哥：跨模態三連發 Payload 精準
- [x] ZIP 匯出包完整（JSZip 實作）

### Task 3: UI 與 GenAI 品質修正
- [x] Framer Motion 動效優化
- [x] 後端 Prompt 模板升級（SD/MJ 語法）
- [x] TypeScript 零錯誤
- [x] 全部 vitest 測試通過

## Phase 4: PDF 合規性稽核修復

### 技術合規性修復
- [x] VisualSoul 人格顏色系統：Calm(電藍)/Creative(霓虹粉)/Technical(螢光綠) 三色切換
- [x] DirectorEngine 狀態機：根據打字速度、停頓時間、失敗次數自動切換人格
- [x] 光球主動介入 UI：Studio 浮動提示氣泡（ProactiveOrbWidget）
- [x] 常駐新手導覽入口：Settings 頁面可重新啟動引導
- [x] ThoughtIslandChain 節點介入功能（修剪/擴充/重新引導按鈕）

### 產品哲學合規性修復
- [x] AIStateContext 擴充：加入 personality 狀態與自動切換邏輯
- [x] Studio 光球常駐顯示：右下角固定位置 Widget（ProactiveOrbWidget）
- [x] 光球呼吸頻率與人格綁定（Calm=6s, Creative=4s, Technical=8s）

### 視覺合規性
- [x] Pro/快速模式切換 UI 標籤優化

## Phase 5: 顯示隱藏欄位 + 下載功能

### 隱藏欄位顯示
- [x] Studio 頁面：顯示所有隱藏的參數欄位（專案筆記、進階設定等）
- [x] History 頁面：展開卡片時顯示完整欄位（compiledPrompt、thoughtChain、parameterSnapshot 等）
- [x] Notes 頁面：確認所有筆記欄位可見（tags、scheduledDate、updatedAt、scriptJson）
- [x] Settings 頁面：確認所有設定欄位可見

### 下載功能
- [x] Studio 生成結果：加入 PNG/MP4/MP3 下載按鈕
- [x] History 頁面：每筆紀錄加入下載按鈕（根據模態下載對應格式）
- [x] Assets 頁面：資產卡片加入下載按鈕（含展開詳情面板）
- [x] 下載功能支援：PNG（圖片）、MP4（影片）、MP3（音樂/語音）+ Notes 下載 MD

## Phase 6: 光球視覺升級 + 拖曳功能

- [x] VisualSoul PERSONALITY_COLORS 升級為高亮度霓虹色系（電藍/霓虹粉/螢光綠）
- [x] ProactiveOrbWidget 加入 framer-motion drag 全域拖曳
- [x] 拖曳結束後位置寫入 localStorage 持久化記憶

## Phase 7: 光球引導邏輯升級

- [x] ProactiveOrbWidget 新增 guideTo(elementId) 方法（移動+脈衝+返回）
- [x] 90 秒引導流程（4 步驟：prompt-input → personality-selector → generate-button → storyboard-panel）
- [x] 完成後 localStorage.setItem("onboarded", "true") 不再觸發
- [x] 移除 OnboardingFlow.tsx 遮罩式教學彈窗（改為自動導航到 Studio）
- [x] 為目標元素加上 id prop（prompt-input, personality-selector, generate-button, storyboard-panel）

## Phase 8: Proactive Agentic 創作流水線

### 任務一：自注意力 UI (Self-Attention UI)
- [x] Token 解析器：正則拆解 Prompt 為獨立 Token 標籤
- [x] 視覺化滑桿（Radix Slider）：0.5~2.0 權重控制
- [x] 視覺回饋：權重>1.2 橘色發光，<0.8 半透明淡出
- [x] 回寫機制：自動回寫為 (token: weight) 語法

### 任務二：思維島鏈語意縮放 (Semantic Zoom)
- [x] D3.js d3-zoom 整合：畫布拖曳與滾輪縮放
- [x] 三視角層次：縮略圖(<0.75)/標準(0.75-1.2)/專家(>=1.2)
- [x] Agentic 介入按鈕：修剪/擴充/重新引導

### 任務三：視覺積木引導 (Onboarding Blocks)
- [x] 6 大分類積木面板：主體/風格/氛圍/場景/光線/鏡頭
- [x] 顏色編碼：每分類專屬色系
- [x] 已選組合區：點擊積木後上方顯示
- [x] 無縫串接：積木→Token→自注意力→生成→思維島鏈

### 任務四：Studio 主介面整合
- [x] PromptBuilder 佔據上半部主導視覺
- [x] ThoughtIslandChain 於生成按鈕下方 Framer Motion 滑出
- [x] Z-index 防呆：自注意力滑桿不被 D3 畫布蓋住
- [x] 毛玻璃 + 柔和光暈效果 + 時間戳相對耗時格式修正

## Phase 9: Agentic 實體連動 + 知識管理 + 新手引導

### 任務一：光球進階互動 (Floating Orb)
- [x] 全局拖曳接收區 (Drop Zone)：圖片卡片/思維節點可拖入光球
- [x] 拖入時閃爍光球顏色 + 「已成功擷取元素」提示
- [x] handleOrbCommand 串接真實 API：「存到筆記」→ saveToNotesContext
- [x] handleOrbCommand 串接真實 API：「加入排程」→ addToCalendar

### 任務二：筆記與日曆系統
- [x] ProjectNotesDrawer 右側滑出抽屜（Sheet/Radix）
- [x] ThoughtIslandChain「釘選至筆記」按鈕
- [x] Studio 生成圖片旁「釘選至筆記」按鈕
- [x] 光球拖曳/輸入「筆記」可喚出抽屜
- [x] CalendarPage 月曆檢視（react-day-picker）
- [x] 拖曳排程：角色卡片/分鏡拖至日曆日期
- [x] 自然語言排程：光球輸入「排程到下週五」解析時間

### 任務三：全域新手引導 (Onboarding Tour)
- [x] OnboardingTour.tsx Spotlight 導覽元件
- [x] Step 1: 聚焦視覺化積木
- [x] Step 2: 聚焦自注意力滑桿
- [x] Step 3: 聚焦右下角光球
- [x] Step 4: 聚焦側邊欄
- [x] localStorage hasSeenTour 判定
- [x] 「略過」退出 + 設定頁/光球「重新導覽」觸發

## Phase 10: 創作者工作室 UI/UX 易用性升級

### 1. Studio 技術名詞淡化
- [x] 將工作區標題中的技術商標（如 Veo 3.1）藏到 tooltip 或淡化字體
- [x] 降低新手認知負擔

### 2. 動態靈感積木 (Contextual Blocks)
- [x] ProgressivePromptBuilder 根據 modality 動態顯示不同積木
- [x] 圖片/影片：移除「氛圍」類別（與 Vibe Cards 重疊）
- [x] 音樂：建立專屬積木（樂器/曲風/節奏/環境質感）
- [x] 積木點擊正確反映到 rawPrompt

### 3. 影片時間軸引導優化
- [x] VideoWorkspace 首幀/末幀說明文案改為新手友善版本
- [x] ArrowRight 旁增加「過渡動態」小字提示

### 4. 語音常用語境預設 (Quick Presets)
- [x] VoiceWorkspace 新增冥想引導/故事旁白/熱情廣告快捷按鈕
- [x] 點擊自動填寫 text, speed, emotionType, emotionIntensity, voiceActorId

### 5. 光球對話框亮度調整
- [x] ProactiveOrbWidget 對話框背景改為亮色系
- [x] 確保文字清晰易讀 + Glassmorphism 一致性

## Phase 11: 靈感積木自訂與收藏功能

### 1. 資料庫與後端 API
- [x] custom_blocks 資料表（modality, category, label, prompt, emoji）
- [x] block_combos 資料表（name, modality, blockIds, customBlockIds, vibeCardIds）
- [x] customBlocks tRPC router（create, list, delete）
- [x] blockCombos tRPC router（create, list, rename, delete）
- [x] db.ts helpers（CRUD 函式）

### 2. 前端 UI
- [x] 「自訂積木」按鈕 + 建立 Dialog（類別選擇、標籤、英文提示詞）
- [x] 自訂積木以 * 前綴顯示在對應類別中
- [x] 長按自訂積木可刪除
- [x] 「我的組合」按鈕 + Popover 面板（儲存/套用/重命名/刪除組合）
- [x] 一鍵儲存當前選取積木為組合
- [x] 一鍵套用已儲存組合（還原積木 + Vibe Cards 選取狀態）
- [x] 組合數量 badge 顯示
- [x] 音樂模態專屬類別（樂器/曲風/節奏/環境質感）支援自訂積木

### 3. 測試
- [x] 11 個新增 Vitest 測試全部通過（custom blocks CRUD + block combos CRUD）
- [x] 全部 184 個測試通過

## SEO 修復

- [x] 首頁新增 description meta tag（50-160 字元）
- [x] 首頁新增 keywords meta tag
- [x] 關鍵字精簡至 6 個核心關鍵字（原 10 個過多）

## 原子扣點機制 (Atomic Deduction)

- [x] db.ts: 新增 atomicDeductQuota 函式，使用 SQL UPDATE ... SET remaining = remaining - 1 WHERE remaining >= amount + affectedRows 檢查
- [x] routers.ts: 替換所有讀取後寫回的扣點邏輯為 deductUserQuota（原子扣點）
- [x] 確保扣點失敗時拋出明確錯誤（配額不足）
- [x] 安全檢查失敗/生成失敗時自動退還配額 (refundUserQuota)
- [x] 撰寫原子扣點測試 (12 個測試通過)

## 跨模態參數死鎖修復

- [x] 讀取 HistoryPage 的「發送至工作室」邏輯
- [x] 實作 sessionStorage 傳遞完整 parameterSnapshot
- [x] Studio 頁面啟動時讀取 sessionStorage 並填入對應工作區參數
- [x] 確保 seed、temperature、所有隱藏參數完整傳遞
- [x] 後端 parameterSnapshot 保存所有模態專屬參數（image/video/audio/voice）
- [x] 前端 handleHistoryToStudio 還原所有模態專屬參數

## ThoughtIslandChain 真實時間戳改造

- [x] 讀取 ThoughtIslandChain 現有假時間戳邏輯
- [x] 讀取後端 SSE 事件流與生成流程
- [x] 後端生成流程中加入真實 timestamp 到 thoughtChain 各節點
- [x] SSE 事件流即時推送 thoughtChain 節點更新
- [x] ThoughtIslandChain 改為消費即時 SSE 事件，節點依真實運算時間浮現
- [x] Fallback：無 SSE 時使用靜態 thoughtChain 數據
- [x] 新增 generate.prepareJob 兩步流程（快速取得 jobId → SSE 連接 → 執行生成）
- [x] ThoughtNode type 新增 'passed' 狀態支援
- [x] generationEvents.ts EventEmitter 事件引擎
- [x] sseRoute.ts SSE endpoint /api/generation-events/:jobId

## ZIP 匯出功能實作

- [x] 安裝 jszip 依賴（file-saver 改用原生 URL.createObjectURL 方案）
- [x] Studio 頁面：實作真實 ZIP 匯出（圖片/影片/音樂/語音 + parameters.txt + metadata.json）
- [x] History 頁面：實作真實 ZIP 匯出（歷史紀錄結果 + parameters.txt + metadata.json）
- [x] 移除所有「即將推出」假 Toast，替換為真實 ZIP 打包下載邏輯

## OnboardingFlow Choice Chips 靈感建議

- [x] 後端新增 evaluate.suggestChips tRPC 路由（LLM 生成 3~5 個延展靈感詞彙）
- [x] 前端 OnboardingFlow 加入 Debounced 查詢機制（500ms 延遲）
- [x] 渲染可點擊 Choice Chips UI（毛玻璃風格 + 動畫進場）
- [x] 點擊 Chip 後自動填入輸入框 + 自動觸發新一輪 AI 建議
- [x] 重新整合 OnboardingFlow 到首頁（首次登入觸發）+ 保留靜態 STARTER_CHIPS 作為初始建議

## evaluatePrompt 建議轉 Actionable Chips

- [x] 後端 evaluatePrompt 回傳結構擴充（每條建議附帶 actionType + actionPayload + label + reason）
- [x] 前端 PromptStrengthBar 建議區域改為可點擊 Actionable Chips UI（展開預覽 + 套用按鈕）
- [x] 點擊 Chip「套用」按鈕直接追加/替換 Prompt Input（已驗證 fluffy ginger cat 成功追加）
- [x] 支援多種 actionType（append_prompt / replace_prompt / add_negative / set_vibe）

## ErrorBoundary + API Timeout 例外處理

- [x] 建立通用 ErrorBoundary React 元件（Zero-Anxiety 友善錯誤 UI + 重試按鈕，支援 full-page 與 inline 模式）
- [x] Studio 頁面外層包裝 ErrorBoundary（ProtectedDashboardRoute inline 模式）
- [x] History 頁面外層包裝 ErrorBoundary（ProtectedDashboardRoute inline 模式）
- [x] 後端 API 呼叫加入 withTimeout 機制（7個 invokeLLM + 1個 generateImage 全部包裝）
- [x] 前端生成流程錯誤處理：顯示「未扣積分，請稍後重試」Zero-Anxiety 訊息
- [x] tRPC mutation onError 統一友善錯誤 Toast（超時/網路/配額/一般錯誤分類處理）

## 離線模式提示

- [x] 建立 OfflineBanner 元件（偵測 navigator.onLine + online/offline 事件）
- [x] 全域提示條 UI（頂部固定橫幅，琥珀色離線 + 綠色恢復 + 動畫進出場）
- [x] 整合至 App.tsx 全域佈局（z-index 9999）
- [x] 離線時禁用生成按鈕並顯示提示（Studio 「開始創作」按鈕 disabled + title 提示）

## 越權操作防呆（JWT/Session 過期攔截）

- [x] 建立 AuthExpiredModal 元件（優雅登入提示 UI，毛玻璃背景 + 彈簧動畫）
- [x] tRPC QueryCache/MutationCache 加入 UNAUTHORIZED 錯誤攔截（替換強制跳轉為 Modal 事件）
- [x] 建立全域 auth 過期事件機制（CustomEvent + debounce 2s 防重複觸發）
- [x] 後端 protectedProcedure 已統一回傳 UNAUTHORIZED 狀態碼（原有架構已支援）
- [x] 前端 onClick 防呆（Studio 生成按鈕 requireAuth guard + 其他 mutation 由底層攔截器統一覆蓋）

## 環境變數 Zod 驗證層（Missing API Key 防呆）

- [x] 分析現有 env.ts 架構與所有環境變數引用（9 個檔案 45 處引用）
- [x] zod 已預裝（tRPC 依賴）
- [x] 建立 server/_core/env.validated.ts（core + multimodal Zod schema + OARS 柔性警告 + assertApiKey/getApiKey 工具）
- [x] 建立 client/src/lib/env.validated.ts（VITE_ 變數 Zod schema + 前端 styled console 警告）
- [x] 更新 server/_core/env.ts 從 validated 模組 re-export，保持 ENV 形狀向後相容
- [x] 缺少金鑰時 console.warn OARS 格式而非 crash（開發環境顯示多模態金鑰狀態摘要）

## 拔除舊有 Mock 引信

- [x] 盤點所有 mock 假資料位置（結果：16 個頁面元件均已對接 tRPC，無寫死假資料）
- [x] 確認所有頁面已具備完善 Empty State UI（尚無生成歷史/數位資產/角色模型/筆記/回饋等）
- [x] TypeScript 編譯零錯誤確認（無需修改，已清潔）

## system_settings Table 架構補齊

- [x] drizzle/schema.ts 新增 system_settings Table（27 欄位，含 UI 主題/隱私/備份/生成預設/通知/區域 + extraSettings JSON 擴展欄）
- [x] 與 users 表建立一對一關聯（userId UNIQUE 約束）
- [x] 生成遷移檔 0004_past_pandemic.sql 並執行 SQL（驗證 27 欄位建立成功）
- [x] server/db.ts 新增 getSystemSettings / upsertSystemSettings 查詢輔助
- [x] server/routers.ts 新增 settings.get（含預設值 fallback）與 settings.update tRPC 路由（Zod 驗證 22 個可更新欄位）

## 首頁生態 DB Schema 擴充

- [x] drizzle/schema.ts 新增 news_articles 表（16 欄位：標題、OARS 柔化摘要、內容 Markdown、來源、分類、標籤、置頂、發布時間、閱讀次數等）
- [x] drizzle/schema.ts 新增 featured_showcase 表（17 欄位：generatedItemId、vibeParameters 情緒矩陣、completelyDeconstructedBlocks 解構積木 JSON、圖片 CDN、排序權重、按讚/fork 計數等）
- [x] 生成遷移檔 0005_nasty_anita_blake.sql 並執行 SQL（兩張表建立成功）
- [x] TypeScript 編譯零錯誤確認

## 首頁新聞 Node-Cron 雙活備援

- [x] 安裝 node-cron + @types/node-cron 依賴
- [x] 設定 NEWS_API_KEY 與 NEWSDATA_API_KEY 環境變數（已透過 webdev_request_secrets 注入）
- [x] 實作 server/jobs/newsFetcher.ts（NewsAPI→NewsData 雙活備援 + OARS 摘要 + 分類標籤 + 超時保護）
- [x] 整合 cron 排程至 server/_core/index.ts（每 6 小時 + 啟動後 30s 首次抓取）
- [x] TypeScript 編譯零錯誤
- [x] 伺服器啟動正常，日誌確認「新聞抓取排程已註冊」

## OARS NLP 柔化器（Gemini Flash）

- [x] 分析現有 newsFetcher generateOarsSummary 流程
- [x] 建立 Gemini Flash 專用 NLP 柔化 Prompt（消除恐嚇字眼 + TL;DR + 權重標籤）
- [x] 重寫為批次處理管線（一次送整批新聞給 Gemini，JSON Schema 結構化回傳）
- [x] 自動權重標籤分類（Model Breakthrough / Inspiration Tip / Industry Shift / Creative Tool / Community Spotlight / Tutorial Guide / General Update）
- [x] 更新 news_articles 寫入邏輯（柔化標題 + TL;DR 摘要 + 權重標籤 + 技術標籤 + 分類）
- [x] 本地 Fallback 柔化器（Gemini 不可用時的正則替換 + 規則分類備援）
- [x] TypeScript 編譯零錯誤確認
- [x] 伺服器啟動正常確認

## 首頁 tRPC Router（新聞 + Showcase）

- [x] 建立 server/routers/news.ts — 新聞唯讀 API（list / getById / categories / pinned / byTag）
- [x] 建立 server/routers/showcase.ts — 精選展示唯讀 API（list / getById / trending / byModality / stats）
- [x] LOD 分頁機制（cursor-based pagination，支援 limit + cursor + category/modality 篩選）
- [x] DB 查詢直接在 Router 內使用 Drizzle ORM（requireDb helper + 安全錯誤處理）
- [x] 整合至 server/routers.ts 主路由（newsRouter + showcaseRouter merge）
- [x] 所有端點使用 publicProcedure（唯讀，前端不直連第三方 API）
- [x] 10 個端點全部通過 curl 驗證（正確 JSON 結構 + 404 友善錯誤訊息）
- [x] TypeScript 編譯零錯誤確認

## 首頁 WebGL 動態環境系統

- [x] 建立 AmbientEnvironment.tsx Canvas 粒子動畫元件（原生 Canvas 2D，零外部依賴）
- [x] 時間偵測邏輯：依當地時間切換 4 種情境（夜空 22-05 / 晨光 05-11 / 咖啡廳 11-17 / 深海 17-22）
- [x] 夜空情境：深藍漸層 + 星星閃爍粒子 + 流星尾跡 + 星雲光暈
- [x] 晨光情境：暖橙漸層 + 光塵飄浮粒子 + 柔和光暈 + 太陽光束
- [x] 咖啡廳情境：暖棕漸層 + 蒸氣上升粒子 + 散景光點
- [x] 深海情境：深青漸層 + 氣泡上浮粒子 + 水波紋光影（caustic ripples）
- [x] 流體背景模糊效果（backdrop-blur-md + Canvas 漸層疊加 + 場景自適應 glassmorphism）
- [x] 情境切換平滑過渡動畫（漸層色交叉淡入淡出 ~2s + 粒子重新初始化）
- [x] 整合至 Home.tsx 作為 fixed 全屏背景層 + 場景自適應文字/按鈕/卡片色彩
- [x] 效能優化：requestAnimationFrame + visibilitychange 離屏暫停 + DPR 上限 2x + 粒子數量依視窗面積自適應
- [x] SceneBadge 場景指示器（動態圖標 + 問候語）+ useCurrentScene hook
- [x] TypeScript 編譯零錯誤確認 + 瀏覽器實測夜空場景正常渲染

## 首頁環境白噪音系統

- [x] 建立 AmbientSoundEngine.tsx — Web Audio API 程序化音效引擎（零外部依賴）
- [x] 夜空音效：柔和白噪音（lowpass 800Hz）+ 低頻嗡鳴（55Hz A1）+ 偶發蟟蟀聲（3800-4600Hz 脈衝）
- [x] 晨光音效：鳥鳴模擬（多音節 chirp 序列）+ 輕柔風聲（pink noise bandpass）+ 溫暖 pad（C4 大三和弦）
- [x] 咖啡廳音效：Lo-fi 環境音（brown noise lowpass）+ 杯碟輕響（triangle burst）+ 低語人聲（LFO 調變 bandpass）
- [x] 深海音效：深沉水流聲（brown noise + LFO 波動）+ 氣泡音（頻率上升 burst）+ 低頻共鳴（40/60Hz）
- [x] OARS 心理學合規：預設靜音（Open-ended）、溫暖中低頻偏好（Affirming）、場景反映情境（Reflective）、漸進式 3s 淡入（Summarizing）
- [x] 場景切換時音效平滑交叉淡入淡出（2s crossfade + 舊層自動清理）
- [x] SoundControl UI：靜音/播放切換 + hover 展開音量滑桿 + 場景自適應色彩 + localStorage 記憶
- [x] 瀏覽器自動播放政策處理（需使用者點擊後才建立 AudioContext + resume）
- [x] 整合至 Home.tsx nav bar，與 AmbientEnvironment 場景同步（useAmbientSound hook）
- [x] visibilitychange 離屏自動暫停/恢復 AudioContext
- [x] TypeScript 編譯零錯誤確認 + 瀏覽器實測 UI 正常渲染

## 首頁 HLS 動態解析度播放器

- [x] 安裝 hls.js 1.6.15 依賴
- [x] 建立 AmbientVideo.tsx HLS 播放器元件（autoplay/muted/loop/playsinline 屬性綁定）
- [x] 實作 HLS 動態分片解析度串流（ABR startLevel=-1 auto + capLevelToPlayerSize + 温和切換策略）
- [x] 滿版背景影片佈局（object-fit: cover + absolute inset-0 + 淡入動畫 1200ms）
- [x] 原生 HLS 支援偵測（Safari 原生 canPlayType → hls.js polyfill → fallback MP4 三層降級）
- [x] 錯誤容錯：network error 自動重試 + media error 自動修復 + fatal 靜默降級
- [x] 整合至 Home.tsx 最頂層（AmbientVideo 在 AmbientEnvironment 之下，粒子疊加在影片之上）
- [x] 半透明黑色遮罩（overlayOpacity 0.35）確保文字可讀性
- [x] TypeScript 編譯零錯誤確認
- [x] 畫面渲染正常確認（粒子動畫 + nav + hero + features 正常顯示）

## 首頁 Scrollytelling 滾動故事線互動

- [x] 建立 Scrollytelling 鉤子（Framer Motion useScroll + useTransform + useMotionValueEvent）
- [x] HLS 影片 + 粒子環境 Opacity 隨滾動漸隱（heroScrollProgress [0,0.3,1] → [1,1,0] 曲線）
- [x] Hero 內容視差上移（heroY: 0 → -80px）+ 文字漸隱（heroContentOpacity: [0,0.5,0.85] → [1,0.8,0]）
- [x] 情報站 Features Grid 漸入效果（whileInView + margin:-80px 觸發）
- [x] CTA 區塊漸入效果（whileInView + margin:-60px 觸發）
- [x] 效能優化：isAmbientVisible 狀態追蹤，opacity < 0.01 時停止渲染 Canvas + Video
- [x] ScrollIndicator 元件（「向下探索」+ 動態滑鼠圖示動畫）
- [x] Hero 區段 min-h-[85vh] 確保足夠滾動空間
- [x] 整合至 Home.tsx（motion.div 包裹 AmbientVideo + AmbientEnvironment，style.opacity 綁定 ambientOpacity）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器滾動效果驗證（頂部粒子全顯 → 滾動至底部粒子完全消失 → Features/CTA 正常顯示）

## 首頁情報站 Bento Grid 網格

- [x] 建立 IntelBentoGrid.tsx 元件（Bento Grid 佈局 + layoutBentoItems 佈局引擎）
- [x] 資訊權重佈局：Model Breakthrough 跨列/跨行寬視角 hero 卡片（col-span-2 row-span-2）
- [x] Inspiration Tip 自動分配至網格邊角小方塊（col-span-1 row-span-1）
- [x] 其他標籤（Industry Shift / Creative Tool / Community Spotlight / Tutorial Guide / General Update）中等尺寸卡片
- [x] 大面積留白設計，廢棄紅點通知，以權重標籤徽章取代
- [x] 結合 Radix Tabs 分類切換（全部 / 模型突破 / 靈感技巧 / 產業與工具）
- [x] 結合 Radix ScrollArea 可捲動區域（maxHeight 680px）
- [x] 4 場景自適應色彩（SCENE_CARD_STYLES 對應 nightSky/morning/cafe/deepSea）
- [x] 整合 trpc.news.list API 讀取真實資料（staleTime 60s）
- [x] 整合至 Home.tsx Features Grid 與 CTA 之間
- [x] 空狀態設計（「暫無情報，敬請期待」）+ 載入骨架動畫
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器渲染效果驗證（Tabs + 空狀態 + 場景色彩正常）

## 情報站 Bento 卡片動態物理

- [x] Framer Motion Hover 特效：whileHover scale(1.02) + ease [0.16,1,0.3,1] 軟彈過渡曲線
- [x] Progressive Disclosure 三層漸進式揭露：
  - Layer 1: Small 卡片 hover 時展開隱藏的 oarsSummary（AnimatePresence height 動畫）
  - Layer 2: Footer 詳情（來源/瀏覽數）hover 時 opacity 0.7→1 + y 位移歸零
  - Layer 3: Hero/Medium 卡片 hover 時顯示「閱讀完整報導」CTA + 箭頭動畫
- [x] CSS 毛玻璃流體高光：
  - Mouse-tracking radial gradient（useMotionValue + useSpring 追蹤滑鼠位置）
  - Edge glow ring（hover 時 boxShadow inset 1.5px + 外圈 32px 光暈）
  - Accent stripe 亮度隨 hover 提升
- [x] Hero/Medium/Small 卡片各自適配的揭露層級
- [x] 修復 useScroll ref hydration 錯誤（改用 window scrollY）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器零 console 錯誤 + 頁面正常渲染

## 首頁精選作品瀑布流

- [x] 建立 ShowcaseMasonry.tsx 元件（CSS Columns 原生瀑布流佈局，零 JS 佈局計算）
- [x] 綁定 trpc.showcase.list LOD API（useInfiniteQuery + cursor-based 分頁）
- [x] ProgressiveImage 漸進式圖片載入（IntersectionObserver lazy load + blur placeholder + 500ms 淡入動畫）
- [x] 60 FPS 效能優化（CSS contain: layout style paint + will-change: transform + contentVisibility: auto）
- [x] Infinite Scroll 無限捲動載入（IntersectionObserver sentinel + rootMargin 300px 預載）
- [x] 4 場景自適應色彩（SCENE_MASONRY_STYLES 對應 nightSky/morning/cafe/deepSea）
- [x] ModalityTabs 模態篩選（全部/圖像/影片/音樂/語音）
- [x] 空狀態（Sparkles 圖示 + 「暫無精選作品」）+ SkeletonCard 隨機高度骨架動畫
- [x] MasonryCard hover 特效（scale 1.02 + Progressive Disclosure 描述展開 + glow ring）
- [x] 整合至 Home.tsx（情報站與 CTA 之間）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器渲染效果驗證（精選作品區塊 + Tabs + 空狀態 + CTA 正常顯示）

## Showcase 卡片水波紋過渡特效

- [x] 建立 RippleTransition.tsx 全螢幕水波紋遮罩元件（clip-path circle 擴散 + 同心漣漪 + 中心光暈 + 浮動粒子）
- [x] 水波紋從點擊座標向外擴散（動態計算 maxRadius 覆蓋全螢幕）
- [x] 4 場景自適應水波紋色彩（SCENE_RIPPLE_COLORS: primary/ring/glow/text/particle）
- [x] 動畫完成後無縫 navigate('/studio')（onComplete callback + 300ms label 延遲）
- [x] useRippleTransition hook（triggerRipple/resetRipple 狀態管理）
- [x] 整合至 ShowcaseMasonry MasonryCard onClick 攚截（不跳轉詳情頁）
- [x] 「進入工作室」過渡標籤 + 脈衝光點動畫
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器零 console 錯誤 + HMR 更新正常

## 完全解構 JSON 傳遞（Showcase → Studio 100% 還原）

- [x] 分析 featured_showcase schema：completelyDeconstructedBlocks（完整積木 JSON）+ generatedItemId + vibeParameters
- [x] 建立 ShowcaseTransferContext.tsx（Context + sessionStorage 雙層備援，頁面重整也不遺失）
- [x] ShowcaseTransferProvider 包裹 App.tsx（NotesDrawerProvider 內層）
- [x] showcase.getById 已回傳完整 LOD Level 2 資料（含 deconstructedBlocks + vibeParameters + originalPrompt）
- [x] 水波紋動畫期間背景 prefetch（utils.showcase.getById.fetch 與動畫並行）
- [x] prefetchReady polling 機制（資料就緒後才觸發 navigate，最長 3s 安全逾時）
- [x] Studio 頁面 useEffect 讀取 consumePayload 實現 100% 開局還原：
  - modality 自動切換
  - compiledPrompt / rawPrompt / vibeCardIds 還原
  - negativePrompt + styleReferenceUrl（圖像模態）
  - firstFrameUrl（影片模態）
  - temperature / seed / loraWeight / mode 技術參數
  - aspectRatio / musicStyle / voiceText 等模態專屬參數
- [x] Prefetch 失敗容錯（仍導航至 Studio，但不預載配方）
- [x] toast 提示「已載入『XXX』的完整配方」
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）+ HMR 更新正常

## 首頁微行為追蹤（Sense Engine）

- [x] 建立 useSenseEngine hook（微行為追蹤引擎核心，零外部依賴）
- [x] 定義 6 種 SenseEvent 特徵型別：cardDwell / scrollHesitation / hoverIntent / clickAbort / sectionVisit / rapidScan
- [x] cardDwell 追蹤：卡片停留超過 5s 觸發事件（含 cardTitle/modality/tags 元資料）
- [x] scrollHesitation 追蹤：區域內反覆上下滾動超過 3 遍未點擊（含 directionChanges/totalScrollDistance/durationMs）
- [x] hoverIntent 追蹤：意圖分數 intentScore = timeScore*0.6 + travelScore*0.4（停留越久+移動越少=越高意圖）
- [x] clickAbort 追蹤：mousedown 後未 mouseup（holdMs > 200ms 才記錄）
- [x] rapidScan 追蹤：3s 內快速揃過 4+ 張卡片（avgDwellMs < 2s）
- [x] 特徵陣列暫存至 sessionStorage（MAX_EVENTS 200 筆自動裁剪）
- [x] requestIdleCallback 非阻塞事件處理 + 離屏自動清理計時器
- [x] useCardSenseProps 便捷工具（一次綁定 dwell + hoverIntent + clickAbort + rapidScan）
- [x] useSectionScrollSense 區塊滾動追蹤（IntersectionObserver 偵測區塊進入視野）
- [x] 整合至 ShowcaseMasonry MasonryCard（showcase-masonry 區塊）
- [x] 整合至 IntelBentoGrid BentoCard（intel-bento-grid 區塊）
- [x] getFeatureSummary 特徵摘要產生器（modalityPreference / highIntentCards / hesitationSections）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）+ HMR 更新正常

## 代理意圖推論（Agent Intent Inference）

- [x] 建立後端 tRPC 端點 sense.inferIntent（publicProcedure，未登入使用者也可推論）
- [x] Gemini Director 角色推理 Prompt（OARS 心理學框架 + 行為特徵解讀指南 + 溫暖非評判語氣）
- [x] 輸入：SenseEvent[]（max 200）+ featureSummary（highIntentCards/hesitationSections/modalityPreference）
- [x] 輸出：JSON Schema 結構化回傳 8 欄位（intentType/intentLabel/confidence/psychologicalInsight/suggestedAction/actionDetail/detectedAesthetics/preferredModality）
- [x] 6 種心理判定類型：choice_paralysis / aesthetic_preference / exploration_mode / goal_oriented / inspiration_seeking / passive_browsing
- [x] 6 種建議行動：recommend_modality / recommend_style / simplify_choices / proactive_guide / encourage_exploration / offer_quick_start
- [x] 前端 useIntentInference hook：
  - 自動觸發（每 10s 檢查條件）+ 手動 triggerInference
  - 觸發條件：事件≥ 5 + 工作階段≥30s，或高信號事件≥ 1 + 事件≥3
  - 防抖：同一工作階段最多 3 次，間隔≥60s
  - sessionStorage 快取推論結果
- [x] Home.tsx 整合：
  - useSenseEngine + useIntentInference 在首頁層級初始化
  - 意圖推論低語卡片（confidence > 0.4 時顯示）
  - 顯示 intentLabel + 信心度 + psychologicalInsight + actionDetail + detectedAesthetics 標籤
  - 場景自適應色彩
- [x] 30s 超時保護 + Gemini 失敗優雅降級（fallback 探索模式）
- [x] curl 測試通過（賦博龐克/霓虹街景/蒸氣波 → 「正在尋找靈感」80% 信心度 + cyberpunk/dark_mechanical/vaporwave 美學偵測）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）+ HMR 更新正常

## 代理暗中重構環境（Silent Environment Reconstruction）

- [x] 擴展後端 showcase.byAesthetics 端點：
  - 接收 aesthetics[] 美學標籤陣列，在 title/description/originalPrompt 中模糊比對
  - matchScore 加權排序（匹配度 DESC → sortWeight DESC → likeCount DESC）
  - excludeIds 參數排除已可見卡片
  - cursor-based 分頁
- [x] 前端 Home.tsx 偵測 aesthetic_preference 意圖（confidence > 0.5）時傳遞 aestheticOverride
- [x] ShowcaseMasonry 靜默洗牌機制：
  - visibleIdsRef 透過 IntersectionObserver 追蹤已進入視野的卡片
  - reconstructedItems state 儲存美學匹配結果
  - allItems 合併邏輯：保留已可見卡片 + 接續重構卡片 + ID 去重
- [x] 已可見卡片保持不動，新載入卡片透過 AnimatePresence popLayout 平滑淡入
- [x] 防止重複觸發（reconstructedRef + reconstructionAestheticsRef 雙重防護）
- [x] 靜默失敗容錯（catch 靜默保留原始卡片）
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] byAesthetics 端點 curl 測試通過（回傳正確 JSON 結構）
- [x] HMR 更新正常 + 瀏覽器零 console 錯誤

## 首頁情境問候語（OARS Contextual Greeting）

- [x] 建立 OarsGreeting.tsx 元件（基於 OARS 心理學 + 當地時間的柔性引導）
- [x] 4 場景問候語庫（夜空 7 句 / 晨光 7 句 / 咖啡廳 7 句 / 深海 7 句，各 6 句副引導語）
- [x] OARS 四原則融入：主問候語（Open-ended + Reflective）、副引導語（Affirming + Summarizing）
- [x] 打字機動畫效果（useTypewriter hook，55ms/字 + 500ms 延遲啟動 + 游標閃爍 3 次後消失）
- [x] 副標語 AnimatePresence 淡入（打字完成後才顯示，ease [0.16,1,0.3,1]）
- [x] useStableRandom 穩定隨機選取（同一 10 分鐘內保持一致）
- [x] 平台描述子延遲淡入（「Healing Studio · AI 多模態創作平台」）
- [x] 場景自適應色彩（textPrimary + textMuted 外部傳入）
- [x] 整合至 Home.tsx Hero 區塊取代原有靜態標題
- [x] TypeScript 編譯零錯誤確認（Found 0 errors）
- [x] 瀏覽器實測：夜空場景「夜晚是最誠實的創作時刻。」打字機動畫 + 「星光會為你的靈感指路」副引導語正常渲染

## 光球行動與邀約 (VisualSoul Invitation)

- [x] VisualSoul 光球元件（右下角浮動光球 + 呼吸動畫）
- [x] SoulInvitation 提示氣泡（OARS 個性化語句 + 場景自適應）
- [x] 整合意圖推論狀態（猶豫偵測觸發光球浮起）
- [x] 光球點擊導航至創作室（攜帶推薦參數）

## Studio 接收端整合 (Soul Invitation Payload)

- [x] Studio 讀取 sessionStorage soul_invitation_payload
- [x] 自動預設模態（image/video/music/voice）
- [x] 自動填充風格標籤（detectedAesthetics → Vibe Cards）
- [x] 自動填充提示詞建議（actionDetail → prompt input）
- [x] 歡迎 Toast 提示（顯示光球推薦來源）
- [x] 消費後清除 payload 防止重複觸發
- [x] vitest 測試覆蓋（48 tests passed）

## 情報站卡片完整內容展開 (BentoCard Article Dialog)

- [x] BentoCard 加入 onClick 事件（可點擊指示）
- [x] Radix Dialog 彈出完整文章（bodyMarkdown 渲染）
- [x] Framer Motion 絲滑動畫過渡
- [x] 顯示來源與原始連結
- [x] vitest 測試覆蓋（31 tests passed）

## 創作室：大腦組態資料庫 (AI Brain Config DB)

- [x] user_ai_brain Table（5 種推理大腦 + 4 種生成引擎預設值，綁定 users）
- [x] user_model_switch_logs Table（模型切換日誌）
- [x] custom_blocks_combo Table（S-S-L-C-M 積木 JSON 結構存檔）
- [x] DB migration 執行成功

## Brain Context Middleware

- [x] brainContext middleware 實作（讀取 user_ai_brain 注入 ctx.brain）
- [x] Health Ping 健康狀態區驗（引擎可用性檢查）
- [x] Graceful Degradation 優雅退回預設引擎
- [x] 安全提示日誌（切換/降級事件記錄）
- [x] 整合至 tRPC router（brainProcedure）
- [x] vitest 測試覆蓋（24 tests passed）

## Settings AI Brain 儀表板 (/settings/ai-brain)

- [x] brain tRPC 路由（getBrain / upsertBrain / switchModel / healthStatus）
- [x] 5 大推理大腦下拉選單（導演/新聞過濾/編譯器/光球語調/RAG 向量）
- [x] 4 大生成引擎下拉選單（圖片/影片/音樂/配音）
- [x] 健康狀態點燈（Online 綠 / Degraded 橘 / Offline 紅）
- [x] Live Preview 光球對話範例
- [x] 整合路由至 App.tsx
- [x] vitest 測試覆蓋（21 tests passed）

## 真實 API 金鑰匯入

- [x] NEWS_API_KEY (NewsAPI.org) — 驗證通過
- [x] NEWSDATA_API_KEY (NewsData.io) — 驗證通過
- [x] FAL_API_KEY (Fal.ai 圖片/影片生成) — 驗證通過
- [x] LANGSMITH_API_KEY (LangSmith 研究監控) — 格式正確
- [x] PINECONE_API_KEY (Pinecone 向量資料庫) — 驗證通過
- [x] ELEVENLABS_API_KEY (ElevenLabs 語音合成) — 免費版 401，可能過期
- [x] SUNO_API_KEY (Suno AI 音樂生成) — 格式正確
- [x] REPLICATE_API_TOKEN (Replicate 模型託管) — 驗證通過
- [ ] POSEHUB_API_KEY (骨骼姿勢測量) — 待確認環境變數名稱
- [x] 驗證測試確認金鑰有效（14 tests passed）

## 四模態 SDK Orchestrator (modelClients.ts)

- [x] 安裝官方 SDK（@fal-ai/client, elevenlabs, replicate）
- [x] SafeApiCaller 安全通訊器（Rate Limit 偵測 + 指數退避重試 + 超時保護）
- [x] FalClient 封裝（圖片生成 Flux + 影片生成）
- [x] SunoClient 封裝（音樂生成 REST API）
- [x] ElevenLabsClient 封裝（語音合成 TTS）
- [x] ReplicateClient 封裝（進階預留通用模型）
- [x] ModelOrchestrator 統一調度器（四模態路由 + 健康檢查）

## Voice Compiler 配音編譯器

- [x] 情緒積木 → SSML 表情指令映射（prosody/emphasis/break）
- [x] 劇本斷點自動植入 break 換氣停頓（1.5s 遲疑感）
- [x] SSML 編譯管線（積木 JSON → 分段 → 情緒標註 → SSML 輸出）
- [x] 與 ElevenLabsClient 整合（SSML → TTS 音訊）
- [x] vitest 測試覆蓋（31 tests passed）

## Audio Compiler 音樂編譯器

- [x] 時間軸結構標記動態生成（[Verse 1] / [Chorus] / [Bridge] / [Drop] 等）
- [x] Tag Stacking Limit 演算法（每個中括號元素 ≤ 4 個樂器/風格）
- [x] 積木 → 音樂提示詞編譯管線（S-S-L-C-M → Suno/Udio 格式）
- [x] 風格衝突偵測與自動調和
- [x] vitest 測試覆蓋（41 tests passed）

## Video Compiler 影片編譯器

- [x] 情感→物理動作翻譯（Action Verbs 大規模映射，14 種情感）
- [x] 相機運鏡約束（Camera Vectors 穩定光學綁定，16 種運鏡模式）
- [x] 首尾幀錨定邏輯接口（Frame Anchoring）
- [x] 【相機運動+主體+具體動作+環境光影】公式編譯管線
- [x] 視角跳躍阻擋機制（合法轉換矩陣 + 橋接運鏡）
- [x] vitest 測試覆蓋（47 tests passed）

## 核心動力引擎填補 (Wave 1/2/0)

- [x] Wave 1: Video 模擬→Fal.ai 真實對接
- [x] Wave 1: Audio 模擬→Suno V5 真實對接
- [x] Wave 1: Voice 模擬→ElevenLabs SDK 真實對接
- [x] Wave 2: deductUserQuota 悲觀鎖原子交易 (SELECT FOR UPDATE)
- [x] Wave 2: Race Condition 防護 + Transaction Rollback
- [x] Wave 0: 光球一鍵轉接 URL Query 參數機制
- [x] Wave 0: Studio.tsx 自動擷取 preset_prompt 填入輸入框

## 四模態高階創作積木擴充 (The 4-Modality Formula)

- [x] 移除舊版 VISUAL_BLOCK_CATEGORIES 和 AUDIO_BLOCK_CATEGORIES
- [x] 建立 IMAGE_BLOCK_CATEGORIES（SSLCM：主體/風格/光影/色彩/構圖）
- [x] 建立 VIDEO_BLOCK_CATEGORIES（主體/風格/主體動態/運鏡/節奏）
- [x] 建立 AUDIO_BLOCK_CATEGORIES（GMIT：曲風/情緒/樂器/速度）
- [x] 建立 VOICE_BLOCK_CATEGORIES（情感/調性語速/結構段落）
- [x] 修改 getBlocksForModality 四模態路由
- [x] 修改 ALL_BUILTIN_BLOCKS 合併四陣列

## 四模態真實生成 URL 回傳 (Real Generation Pipeline)

- [x] 驗證 FAL_KEY / SUNO_API_KEY / ELEVENLABS_API_KEY 存在
- [x] 影片模態：改用 Gemini Veo REST API 真實生成 → resultUrl
- [x] 音樂模態：Suno API 真實生成 + 輪詢等待 audio_url → resultUrl
- [x] 語音模態：ElevenLabs TTS → S3 上傳 → resultUrl
- [x] 圖片模態：確認已有真實生成邏輯（generateImage）

## Vault/Model → 四模態生成資料流打通

- [x] Task 1: 生成路由 input schema 加入 vaultCharacterId / vaultSceneId，注入 characterRefUrl / styleReferenceUrl
- [x] Task 2: 生成路由 input schema 加入 fineTunedModelId，注入 triggerWord 至 compiledPrompt
- [x] Task 3: Studio.tsx handleVaultSelect 補齊 audio/voice 處理 + 角色鍛造所快選 UI

## 首頁背景截斷與版面溢位修復

- [x] 將 Hero Section 漸層背景移至最外層 fixed/absolute 容器，涵蓋全頁面
- [x] 移除 Hero Section 內的 absolute inset-0 -z-10 漸層背景 div
- [x] 最外層主容器加 overflow-x-hidden + flex flex-col
- [x] 所有 section 內層加 relative z-10 確保內容在背景之上

## 精選作品被情報站遮蓋修復

- [x] 修復 ShowcaseMasonry 被 IntelBentoGrid 遮蓋的問題（加 z-10 至 IntelBentoGrid、ShowcaseMasonry、IntentWhisper）

## LoRA 訓練服務模組 (loraTrainer.ts)

- [x] 建立 server/services/loraTrainer.ts
- [x] 實作 buildZipBuffer（jszip 打包圖片）
- [x] 實作 uploadZipToStorage（storagePut 上傳 S3）
- [x] 實作 submitReplicateLoraTraining（Replicate API 提交訓練）
- [x] 實作 runLoraTrainingJob（主函數：打包→上傳→提交→輪詢→回寫 DB）
- [x] models.create 路由加入背景 LoRA 訓練啟動邏輯
- [x] 任務 3：ModelsPage.tsx 加入訓練進度輪詢 UI（trainingStatusQuery + 進度條 + 狀態顯示）
- [x] 任務 4：env.validated.ts 加入 REPLICATE_API_TOKEN 非必填警告

## Model Training Worker (背景任務消費者)

- [x] 任務 1：db.ts 新增 getQueuedJobsByType 和 getStuckJobsByType
- [x] 任務 2：建立 server/jobs/modelTrainingWorker.ts（cron 每 5 分鐘消費 queued + 恢復 stuck）
- [x] 任務 3：在 server/_core/index.ts 註冊 initModelTrainingWorkerCron()
- [x] 修復 IntelBentoGrid ScrollArea 680px 限高導致遮蔽 ShowcaseMasonry

## 重寫 modelTrainingWorker.ts（詳細規格版）

- [x] 重寫 modelTrainingWorker.ts：介面定義 + processQueuedTrainingJobs + recoverStuckTrainingJobs + runModelTrainingWorker + cron
- [x] 確認 index.ts 已正確註冊 initModelTrainingWorkerCron

## 端對端 LoRA 訓練鏈路完整性稽核

- [x] 任務 A：確認 db.ts getQueuedJobsByType + getStuckJobsByType 已存在（and/eq/sql import 已齊全）
- [x] 確認 loraTrainer.ts 使用 ostris/flux-dev-lora-trainer 模型 (version hash: a22c463f)
- [x] 確認 modelTrainingWorker.ts 正確消費 queued 任務 + 恢復 stuck 任務
- [x] 確認 index.ts 已註冊 initModelTrainingWorkerCron (行 13, 73)
- [x] 確認 models.create 路由正確觸發背景訓練 (行 1256-1272)

## 任務 B：重寫 loraTrainer.ts（Replicate SDK 版）

- [ ] 改用 Replicate SDK（replicate.predictions.create/get）取代 raw fetch
- [ ] 調整日誌格式為 [LoraTrainer] ISO ✅/⚠️/❌
- [ ] 調整進度百分比（5→15→25→30→30-90→100）
- [ ] submitReplicateTraining 使用 model name 而非 version hash
- [ ] 輪詢使用 replicate.predictions.get 而非 raw fetch

## 影片模態修復

- [x] 修復後端影片生成邏輯（改用 @google/genai SDK → generateVideos → 輪詢 → S3 上傳 → 回傳可播放 URL）
- [x] 修復前端影片顯示（Studio.tsx 結果區域根據模態條件渲染 <video>/<audio>/<img> 標籤）
- [x] 新增 MP4 下載功能（影片生成完成後可下載）
- [x] 新增錯誤訊息顯示（videoError/audioError/voiceError 紅色文字提示）
- [x] Gemini Veo API 配額不足時顯示友善錯誤訊息

## 影片生成實測 + LoRA SDK 重寫 + 歷史頁面播放器

### 任務 1：實測影片生成
- [x] 在 Studio 影片模態觸發生成，驗證 Gemini Veo API 完整管線（48s 完成，1 個影片生成成功）
- [x] 確認 API Key 配額足夠，Veo 2.0 正常運作

### 任務 2：loraTrainer.ts Replicate SDK 重寫
- [x] 改用 Replicate SDK（replicate.predictions.create/get）取代 raw fetch（已在先前開發中完成）
- [x] 調整日誌格式為 [LoraTrainer] ISO ✅/⚠️/❌（已完成）
- [x] 調整進度百分比（5→15→25→30→30-90→100）（已完成）
- [x] submitReplicateTraining 使用 model name ostris/flux-dev-lora-trainer（已完成）
- [x] 輪詢使用 replicate.predictions.get（已完成）

### 任務 3：歷史頁面播放器
- [x] HistoryPage 結果縮圖根據模態條件渲染 <video>/<audio>/<img>
- [x] 展開詳情時也使用對應播放器（下載按鈕已支援 MP4/MP3）

## 光球（VisualSoul）優化

### 任務 1：強化光球引導邏輯
- [x] 分析現有光球互動時機與觸發條件（降低信心門檻 0.4→0.3，延遲 2.5s→1.8s，再觸發間隔 30s→45s）
- [x] 優化光球情感回應（新增首次造訪歡迎語、回訪問候、時段感知問候）
- [x] 改善光球引導文案（優化 OARS 模板觸發條件，降低 aesthetic_preference 門檻）
- [x] 增強光球狀態轉換（新增歡迎訊息浮層動畫，帶尾巴指向光球）

### 任務 2：修復與優化光球 AI 代理連結頁面
- [x] 修復人格選擇器同步到全域 AIStateContext（setGlobalPersonality）
- [x] 修正 Storyboard 版本標籤（Veo 3.1→Veo 2.0，Suno V5→Suno V4）
- [x] 新增導演 AI 思考狀態光球指示器（聊天區上方顯示光球 + 「導演 AI 正在思考中...」）
- [x] 優化主動介入規則（降低閒置觸發 30s→20s，新增人格化訊息、慶祝規則、引導探索規則）
