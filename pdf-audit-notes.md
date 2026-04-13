# PDF 1: Healing Studio 深度架構評估報告 - Key Findings

## 執行摘要
- 報告結論：專案真實完成度約 35-40%，而非先前評估的 70%
- 根本原因：現有實作完成了大量 UI 外殼 (Shell)，但核心差異化功能完全缺失
- 缺失功能：AI 思維島鏈可視化、3D 光球人格系統、視覺提示詞引導、提示詞強度評估引擎、長影片製作管線

## 1.1 已具備雛形的功能（真實完成度）
| 功能模組 | 真實完成度 | 關鍵落差 |
|---------|----------|---------|
| 4 個模態工作區 | 60% | 缺少「腳本」第5工作區；影片/音樂/語音實際只呼叫圖片生成 API |
| Progressive Prompt Builder | 55% | 缺少提示詞強度評估引擎 (PRMs/LLM-as-a-judge) |
| AI Director 聊天 | 40% | 完全缺少 3 種人格切換；缺少快速建議按鈕；缺少 Onboarding 引導 |
| Consistency Vault | 30% | 無獨立 consistency_vault 資料表；無真實 S3 上傳；未整合 ControlNet 參數 |
| 數位資產庫 | 45% | 缺少詳細檢視頁面；缺少版本歷史；缺少「編輯提示詞重新生成」 |
| 角色鍛造所 | 35% | 無真實模型訓練 API；無資料集上傳到 S3；status 永遠停在 training |
| 專案筆記 | 50% | 缺少 Markdown 編輯器；缺少標籤系統 |
| 儀表板 | 40% | 缺少進度條視覺化；缺少「購買更多配額」按鈕 |
| 管理後台 | 50% | 缺少系統監控面板；缺少 API 狀態檢查 |
| 回饋中心 | 55% | 缺少管理員回覆功能 |

## 1.2 完全缺失的核心功能
| 缺失功能 | 技術需求 | 影響範圍 | 實作難度 |
|---------|---------|---------|---------|
| AI 思維島鏈可視化 (iToT) | Three.js/D3.js 互動式樹狀結構 | 產品第一核心差異化 | 極高 |
| 3D 光球人格系統 | Three.js + @react-three/fiber + GLSL Shaders + XState | AI Director 視覺核心 | 極高 |
| 視覺提示詞引導系統 | 草圖/線條圖上傳、圖像分析 API | 突破純文字限制的核心創新 | 高 |
| 提示詞強度評估引擎 | PRMs / LLM-as-a-judge 即時評估 | 提升提示詞品質 | 中 |
| 新手 Onboarding (黃金90秒) | react-joyride 或自訂 Overlay | 影響新使用者留存率 | 中 |
| 長影片製作管線 | 腳本分鏡自動化、逐圖生成 | 專業影片創作完整工作流 | 極高 |
| 腳本工作區（第5模態） | 場景數輸入、故事大綱、AI 生成腳本 | 完整多模態覆蓋 | 中 |
| 社群與共享空間 | 討論區、留言板、提示詞/種子庫 | 社群互動與知識共享 | 高 |
| 法律版權檢查 | C2PA 內容溯源、SynthID 浮水印 | 法律合規與倫理保障 | 高 |
| 訂閱方案與付費系統 | Stripe 整合 | 商業模式基礎 | 中 |
| ZIP 一鍵匯出 | JSZip/archiver | 專業交付流程 | 低 |
| 注意力熱力圖面板 | 注意力權重可視化、熱力圖渲染 | AI 透明度進階功能 | 高 |

## 1.3 資料庫落差
- PRD 定義 10 張核心資料表，現有實作僅 7 張
- 欄位符合度平均僅約 45%
- 完全缺失：subscription_plans, consistency_vault, generation_history, audit_logs, ai_director_preferences

## 1.4 後端 API 真實性
- 圖片生成：呼叫真實 generateImage() API — 唯一真正運作的生成管線
- 影片、音樂、語音生成：後端程式碼第 288 行明確註解 "In production, these would call Veo 3.1, Suno V5, ElevenLabs respectively"。這三個模態結果是模擬的 placeholder URL

## 第二部分：整合與落差診斷

### 2.1 首頁設計衝接
- 多模態創作引擎：基本對齊
- 導演 AI 互動系統：部分對齊（缺少人格選擇視覺暗示、3D 光球預覽）
- 角色品牌庫：名稱偏差（PDF 稱「角色品牌庫」含 Vault + 品牌管理）
- 共享與協作：嚴重偏差（PDF 第6區塊應為「共享與協作」）

### 2.3 PRD 核心亮點放置建議
| 核心亮點 | 建議放置位置 | 呈現方式 | 觸發邏輯 |
|---------|----------|---------|---------|
| AI 思維島鏈 | Studio 頁面底部，生成結果區域旁 | 可展開側面板或 Modal，內含互動式樹狀結構 | 生成完成後出現「查看 AI 推理過程」按鈕 |
| 3D 光球 | 全站右下角固定位置（類似客服 Widget） | Three.js Canvas 渲染的 3D 球體，帶呼吸動效 | 常駐顯示；根據使用者行為自動切換人格狀態 |
| 視覺提示詞引導 | Studio 左側 Progressive Prompt Builder 內 | 「上傳草圖」按鈕和拖放區域 | 使用者上傳圖片後，後端分析並自動填入結構化提示詞欄位 |
| 提示詞強度評估 | Studio 提示詞輸入區下方 | 即時顯示品質分數條 (0-100) + 修改建議氣泡 | debounce 500ms 自動觸發評估 |
| 新手 Onboarding | 全站 Overlay | 半透明遮罩 + 高亮目標元素 + 浮動提示框 | 首次登入自動觸發 |

## 第三部分：衝突與風險排除

### 3.1 文件之間的設計衝突
- 衝突 1: AI Director 定位分歧 — PRD 定義為聊天頁面，數位產品設計文件定義為全站主動式 AI 代理
- 衝突 2: Consistency Vault 歸屬 — PRD 放在首頁第3區塊和 Studio 右側面板，數位產品設計文件則為獨立系統
- 衝突 3: 「共享空間」vs「雙模式切換」

### 3.2 邏輯斷層
- 斷層 1: 配額系統粒度不足（PRD 要求按模態分別追蹤）
- 斷層 2: 生成結果無法追溯參數
- 斷層 3: Consistency Vault 的拖放是假的

### 3.3 技術整合隱患
- 隱患 1: Three.js 未安裝（現有光球是純 CSS + Framer Motion 的 2D 圓形）
- 隱患 2: XState 未安裝
- 隱患 3: 向量資料庫未整合
- 隱患 4: SSE/WebSocket 未實作（生成進度是前端模擬的 setInterval）
- 隱患 5: 檔案上傳端點缺失

## 第四部分：整合策略提案

### 4.1 真實完成度總結
| 維度 | 完成度 | 說明 |
|-----|------|-----|
| 認證與使用者管理 | 80% | OAuth 完整，RBAC 基礎可用 |
| 資料庫 Schema | 35% | 7/10 表存在，欄位符合度低 |
| 後端 API | 40% | tRPC 骨架完整，但 3/4 模態生成為模擬 |
| 前端 UI 外殼 | 55% | 所有主要頁面有基礎 UI，但缺 5 個核心差異化功能 |
| 核心差異化功能 | 5% | 思維島鏈、3D 光球、視覺提示詞、提示詞評估、長影片管線均為 0% |
| 工作流串聯 | 25% | Director→Studio 有 sessionStorage 串聯 |
| 測試覆蓋 | 45% | 32 項測試通過，但僅覆蓋認證、權限、輸入驗證 |

加權總完成度：約 35-40%

### 4.2 推進至 100% 的關鍵路徑
- 考慮 Manus 平台限制（無 GPU、無 Three.js 伺服器端渲染、無向量資料庫），建議採用務實降級策略

## PDF 1 建議的 4 階段路徑

### 第一階段：地基修復（最高優先）
1. 資料庫 Schema 補齊：新增 consistency_vault, subscription_plans, ai_director_preferences, generation_history 4 張表
2. 檔案上傳端點：Express /api/upload 路由
3. 首頁第6區塊修正：替換為「共享空間」
4. 配額系統重構：remainingGenerations 從 int 改為 JSON

### 第二階段：核心差異化（高優先）
1. AI Director 人格系統：ai_director_preferences 表 + 3 種人格切換
2. 提示詞強度評估引擎：LLM-as-a-judge 評估步驟
3. 新手 Onboarding：react-joyride 4 步驟引導
4. 腳本工作區（第5模態）
5. Consistency Vault 獨立化

### 第三階段：可視化與進階功能（中優先）
1. AI 思維島鏈（務實降級方案）：不使用 Three.js 3D 渲染，改用 **D3.js 2D 互動式樹狀圖** + Framer Motion 動效
2. 光球升級（務實降級方案）：不使用 Three.js + GLSL Shaders，改用 **CSS 3D transforms + Framer Motion + SVG 濾鏡**
3. 視覺提示詞引導
4. 跨模態串聯

### 第四階段：社群與合規（較低優先）
1. 共享空間
2. 法律版權檢查
3. ZIP 匯出
4. 訂閱方案與 Stripe 整合

## 結論
- 目前擁有一個「結構完整但功能淺薄」的原型
- 核心差異化功能（思維島鏈、3D 光球、視覺提示詞、提示詞評估）均處於零實作狀態
- 關鍵下一步：補齊資料庫 Schema、建立真實檔案上傳管線、實作 AI Director 人格系統
- 務實降級策略：D3.js 替代 Three.js、CSS 3D 替代 GLSL、LLM vision 替代專用圖像分析 API

# PDF 2: 從被動式響應到主動式代理 (Proactive Agentic AI)

## 系統一 (System 1) 核心架構
四大深度技術模塊：
1. **多模態創作引擎**：生成圖、影、音樂、配音、腳本 — 統一潛在空間架構
2. **AI 思維島鏈 (AI Thought Island Chain)**：將 AI 推理過程視覺化為互動式樹狀結構
3. **視覺提示詞引導系統**：上傳草圖/線框圖，AI 轉換為結構化提示詞
4. **提示詞強度和優化建議引擎**：LLM-as-a-judge 即時評估 + PRMs

## 第一章：系統一架構與認知心理學
- 雙系統理論 (Dual-process theory)：系統一 = 快速直覺，系統二 = 慢思熟慮
- 創作者平台的「系統一」= 多模態生成引擎 + 互動式推理引擎
- 統一潛在空間 (Single Latent Space) 架構

## 第二章：原生多模態創作引擎
- 統一潛在空間中的幾何-外觀聯合表徵 (Unified Latent Representation)
- 影音原生的時空同步機制
- 跨模態同步模組 (Cross-Modal Synchronization, CMS)

## 第三章：AI 思維島鏈 (iToT) 架構
### 3.1 互動式思維樹 (iToT) 的可視化重構與論點圖解
- 系統捕捉模型內部推理路徑，運用「論點圖解」(Argument Diagramming)
- 轉化為「軌跡映射」(Trajectory Mapping) 的互動式樹狀結構
- 每個節點（島嶼）代表特定階段生成的局部思路/前提假設/場景參數規劃
- 連接節點的線段（鏈條）清晰標示邏輯推演的軌跡與依賴關係
- 系統利用顏色編碼標識活躍路徑 (Active Paths)
- 提供節點展開與摺疊功能

### 3.2 深度控制權：節點介入與動態修改
- **修剪與刪除** (Pruning & Deletion)：移除邏輯錯誤的節點
- **擴充與自訂** (Expansion & Customization)：手動新增自訂思路 (Custom Thoughts)
- **重新引導** (Node-Based Steering)：選擇樹狀結構中某一分支為優先發展路徑

### 互動維度對比
| 維度 | 傳統黑盒子 | 互動式思維島鏈 (iToT) |
|-----|---------|----------------|
| 透明度 | 完全不透明 | 完整推理路徑可視化 |
| 控制權 | 僅能修改最終輸出 | 可介入任何中間節點 |
| 錯誤修正 | 只能重新生成 | 精準定位並修剪錯誤分支 |
| 學習價值 | 無 | 理解 AI 決策邏輯 |

## 第四章：視覺提示詞引導系統 (Visual Prompt Guidance System)
- 4.1 從文本依賴到視覺化約束空間輸入
  - 上傳草圖/線框圖 (Sketches & Wireframes)
  - 邊界框與分割遮罩 (Bounding Boxes & Segmentation Masks)
  - 參考圖像與深度圖 (Reference & Depth Maps)
- 4.2 視覺特徵的結構化轉換與跨模態對齊
  - 將視覺元素轉換為 Structured Latent Prompts
  - Vision-grounded Reasoning 能力

## 第五章：提示詞強度和優化建議引擎 (Prompt Strength & Optimization Engine)
- 5.1 過程獎勵模型 (PRMs) 的細粒度評估
  - 三個獨立評量維度：
    1. Monte Carlo 估計分數 (r_{importance})：評估步驟對最終結果的重要性
    2. LLM 評判者分數 (r_{qual})：文字敘述質量、語意清晰度、邏輯合理性
    3. 準確性分數 (r_{acc})：是否符合事實基礎與專業領域規範
- 5.2 LLM-as-a-judge 自動化驗證
- 5.3 自動化優化迴圈與動態運算分配策略
  - Prompt Strength 量化指標
  - 主動修改建議 (Prompt Expansion)
  - Dynamic Compute Allocation

## 第六章：模塊間深度技術整合與系統級協同效應
- 6.1 PRM 與 iToT 的視覺化交會
  - PRM 的 r_{qual} 和 r_{importance} 映射到思維島鏈節點顏色/熱度
  - 熱度圖 (Heatmaps) 標示信心水準
- 6.2 視覺引導空間約束與原生多模態引擎的無縫融合

## 第七章：總結與未來展望

## 系統二 (System 2)：思維鏈系統 / 自注意力機制顯現化

### 核心概念
- 如果其他系統是「畫筆」和「畫布」，那麼這個系統就是「AI 的 X 光機」
- 致力於解決 Black Box 問題
- 兩個極具突破性的核心技術：
  1. **思維鏈系統 (Chain of Thought, CoT)**
  2. **自注意力機制顯現化 (Visualization of Self-Attention)**

### CoT 思維鏈
- 運作原理：傳統 AI 是「輸入 A → 直接輸出 B」，思維鏈是「輸入 A → 推理步驟 1 → 推理步驟 2 → 輸出 B」
- 創作者價值：讓你知道 AI 是「怎麼理解」你的指令的
- 文本與視覺的雙軌推理機制
- Generative Visual Chain-of-Thought (GVCoT)：在潛在空間中生成中介的視覺思考圖 (Intermediate Visual Thoughts)

### 自注意力機制顯現化
- 將注意力權重轉化為熱力圖或連線圖
- 交叉注意力 (Cross-Attention)：跨模態特徵映射，決定「哪一個字詞應該出現在畫面的哪一個位置」
- 自注意力 (Self-Attention)：同模態內部的全局一致性與幾何結構

### 動態評估與反思機制 (Reflection Mechanism)
- PARM (Potential Assessment Reward Model) 與 PARM++
- 每一步生成步驟動態評估推理路徑是否有潛力
- Self-correct 程序：模型發現錯誤聯想時主動回退或修正

### 創作者價值：從結果承受者轉變為過程架構師
- 思維鏈讓創作者從「結果的被動承受者」轉變為「過程的邏輯架構師」
- 模型透明地展示：「我是這樣理解你的指令的」
