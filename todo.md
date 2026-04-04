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
