/**
 * learnHub.ts — 學習文件中心 Router
 *
 * 提供靜態/動態學習文件的 CRUD API。
 * 資料來源：靜態種子資料（啟動時內建）+ 管理員可在後台新增。
 *
 * 分類（category）：
 *  - getting-started   入門指南
 *  - model-guide       模型說明
 *  - api-docs          API 文件
 *  - technique         生成技術
 *  - ai-news           AI 新聞
 *  - workflow          創作流程
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";

// ─── 靜態種子文件資料 ─────────────────────────────────────────────────────────

export type DocCategory =
  | "getting-started"
  | "model-guide"
  | "api-docs"
  | "technique"
  | "ai-news"
  | "workflow";

export interface LearnDoc {
  id: string;
  category: DocCategory;
  title: string;
  summary: string;
  content: string;        // Markdown content
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  readingMinutes: number;
  publishedAt: string;    // ISO date string
  updatedAt: string;
  featured: boolean;
  externalUrl?: string;   // If linking to external resource
  authorName?: string;
}

const SEED_DOCS: LearnDoc[] = [
  // ══════════════════════════════════════════════════════
  // 入門指南
  // ══════════════════════════════════════════════════════
  {
    id: "gs-001",
    category: "getting-started",
    title: "Healing Studio 完整入門指南",
    summary: "5 分鐘快速了解平台所有功能，從創作工作室到影片工作室的完整介紹。",
    content: `# Healing Studio 完整入門指南

## 🌟 什麼是 Healing Studio？

Healing Studio 是一個整合 AI 的全方位創作平台，讓你能夠用最直觀的方式生成圖片、影片、音樂和語音。

## 🗂️ 主要功能區

### 創作工作室
核心功能。使用靈感積木系統組合提詞，AI 自動選擇最適合的模型生成作品。

- **四種創作模態**：圖片、影片、音訊、語音
- **靈感積木**：點選積木快速組合提詞
- **ZenCoPilot**：AI 即時建議和優化
- **光球夥伴**：隨時提供靈感和協助

### 圖片創作室
超過 20 種頂尖圖片生成模型：
- GPT Image 1.5、Flux 2 Pro、SDXL
- 圖片編輯、ControlNet 姿勢控制
- 3D 建模（Trellis、HunYuan3D）

### 影片工作室
21 個 FAL.AI 頂尖影片模型：
- **文生影**：Kling 2.1、Veo 3、Sora
- **圖生影**：Runway Gen4、PixVerse 4.5
- **畫質優化**：ByteDance 超分、RIFE 補幀

### 專業創作室
音訊/語音/影片專業工具：
- TTS 多語言語音合成
- 音樂生成、聲音克隆
- AI 說話頭像影片

### 導演 AI
AI 扮演創意導演，透過對話規劃完整創作項目。

## 🚀 快速開始

1. 點擊左側欄「創作工作室」
2. 選擇創作模態（圖片/影片/音訊/語音）
3. 點選幾個靈感積木
4. 按下「開始生成」按鈕
5. 享受你的第一件 AI 作品！

## 💡 進階技巧

- **詳細提詞**效果優於**簡短提詞**
- 使用**負面提詞**排除不想要的元素
- 試試不同**風格積木**組合
- **一致性保險庫**可以保持角色視覺一致
`,
    tags: ["入門", "快速開始", "平台介紹"],
    difficulty: "beginner",
    readingMinutes: 5,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "gs-002",
    category: "getting-started",
    title: "靈感積木系統完整教學",
    summary: "了解如何使用靈感積木快速組合提詞，讓 AI 生成符合你想像的作品。",
    content: `# 靈感積木系統完整教學

## 什麼是靈感積木？

靈感積木是 Healing Studio 獨創的提詞輔助系統。每個積木代表一個創作要素，點選積木後系統會自動將其組合成完整的 AI 提詞。

## 積木分類

### 主體（Subject）
描述畫面的主要元素：人物、動物、景色、物件等。

### 風格（Style）
視覺風格：水彩、油畫、賽博龐克、浮世繪、極簡主義等。

### 光線（Lighting）
光線效果：柔光、霓虹燈、黃金時刻、逆光、燭光等。

### 色調（Color）
顏色傾向：暖色調、冷色調、低飽和、高飽和等。

### 情緒（Mood）
整體氛圍：寧靜、神秘、夢幻、活潑、憂鬱等。

## 進階技巧

### 自定義積木
點擊「+ 新增積木」可以建立你自己的積木，並保存到個人積木庫。

### 積木組合
- 主體 + 風格 + 光線 = 基礎完整提詞
- 加入情緒積木可以讓畫面更有感染力
- 加入鏡頭角度積木可以控制構圖

### PromptStrengthBar
觀察提詞強度條，幫助你判斷提詞是否足夠詳細。
`,
    tags: ["積木", "提詞", "入門"],
    difficulty: "beginner",
    readingMinutes: 6,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "gs-003",
    category: "getting-started",
    title: "如何設定 FAL_API_KEY",
    summary: "取得 fal.ai API 金鑰並設定到平台，解鎖所有進階影像生成功能。",
    content: `# 如何設定 FAL_API_KEY

## 步驟一：取得 API Key

1. 前往 [fal.ai](https://fal.ai) 官方網站
2. 點擊右上角「Sign Up」免費註冊
3. 登入後前往 [Dashboard → Keys](https://fal.ai/dashboard/keys)
4. 點擊「Create new key」
5. 複製生成的 API Key（格式：\`fal-xxx...\`）

## 步驟二：設定到平台

### 方法 A：Railway 環境變數（推薦）
1. 登入 Railway.app 控制台
2. 進入你的 Healing Studio 專案
3. 點擊 Service → Variables
4. 新增變數：Key = \`FAL_API_KEY\`，Value = 你的金鑰
5. 點擊 Deploy 重新部署

### 方法 B：本地開發
在專案根目錄建立 \`.env\` 檔案：
\`\`\`
FAL_API_KEY=fal-your-key-here
\`\`\`

## 費率說明

fal.ai 按使用量計費，不同模型費率不同：
- Kling 2.1（5s）：約 $0.35
- Wan 2.1（720p）：約 $0.08
- Sora Turbo（10s）：約 $2.00

建議先從免費額度開始體驗！
`,
    tags: ["API Key", "設定", "fal.ai"],
    difficulty: "beginner",
    readingMinutes: 4,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 模型說明
  // ══════════════════════════════════════════════════════
  {
    id: "mg-001",
    category: "model-guide",
    title: "影片模型選擇指南：Kling vs Wan vs Runway",
    summary: "三大主流影片生成模型的完整對比，幫助你根據需求選擇最適合的模型。",
    content: `# 影片模型選擇指南

## Kling v2.1（快手）

**優點：**
- 中文語意理解最強
- 動態表現自然流暢
- 支援起始幀 + 結束幀雙控

**適合場景：**
- 中文創作者首選
- 人物動態場景
- 需要精確首尾控制的場景

**費用：** 約 $0.35/5s，$0.70/10s

---

## Wan 2.1（阿里）

**優點：**
- 開源模型，費用最低
- 720p 高畫質
- 物理動態表現出色

**適合場景：**
- 自然場景（水流、風吹、火焰）
- 預算有限時的首選
- 批量生成

**費用：** 約 $0.05-0.12/次

---

## Runway Gen4 Turbo

**優點：**
- 電影級畫質
- 精確鏡頭控制
- 商業品質輸出

**適合場景：**
- 商業廣告製作
- 高品質宣傳影片
- 需要專業鏡頭感的作品

**費用：** 約 $0.50/5s

---

## 選擇建議

| 需求 | 推薦模型 |
|------|--------|
| 中文提詞 | Kling 2.1 |
| 低費用 | Wan 2.1 |
| 最高品質 | Runway Gen4 |
| 動畫風格 | Wan 2.1 V2V |
| 長影片（10s+） | Sora Turbo |
`,
    tags: ["Kling", "Wan", "Runway", "模型比較", "影片生成"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-05T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "mg-002",
    category: "model-guide",
    title: "圖片生成模型完整對比（GPT Image vs Flux vs SDXL）",
    summary: "主流圖片 AI 模型的特點、適用場景和費率詳細說明。",
    content: `# 圖片生成模型完整對比

## GPT Image 1.5（OpenAI）

**特點：**
- 最強的自然語言理解
- 文字渲染能力業界第一
- 多圖融合效果優秀

**適合：** 需要精確描述、文字圖片、複雜構圖

---

## Flux 2 Pro（Black Forest Labs）

**特點：**
- 開源最強圖片模型
- 真實感極佳
- 細節豐富

**適合：** 寫實風格、人像攝影風格、商品展示

---

## Nano Banana Pro（Gemini）

**特點：**
- 速度極快（10秒以內）
- 多圖參考融合
- 角色一致性強

**適合：** 快速原型、角色設計、多圖合成

---

## SDXL（Stability AI）

**特點：**
- 支援 ControlNet 精確控制
- 豐富的社區 LoRA 模型
- 高度可自定義

**適合：** 精確姿勢控制、特定風格藝術、LoRA 微調

---

## Seedream v5（ByteDance）

**特點：**
- 原生 2K 高解析度
- 中文提詞優化
- 文字布局優秀

**適合：** 海報設計、中文排版、高清圖片

---

## 費用比較（參考）

| 模型 | 大約費用/張 |
|------|-----------|
| GPT Image 1.5 | $0.040 |
| Flux 2 Pro | $0.055 |
| Nano Banana 2 | $0.006 |
| Seedream v5 | $0.012 |
| SDXL | $0.003 |
`,
    tags: ["GPT Image", "Flux", "SDXL", "Seedream", "圖片生成"],
    difficulty: "intermediate",
    readingMinutes: 10,
    publishedAt: "2026-04-06T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 生成技術
  // ══════════════════════════════════════════════════════
  {
    id: "tech-001",
    category: "technique",
    title: "提詞工程（Prompt Engineering）完全指南",
    summary: "掌握提詞技術，讓你的 AI 生成效果提升 10 倍。從基礎到進階的完整教學。",
    content: `# 提詞工程完全指南

## 提詞的基本結構

一個好的提詞通常包含：

\`\`\`
[主體] + [動作/狀態] + [環境/背景] + [風格] + [光線] + [品質標籤]
\`\`\`

### 範例

❌ 差：\`一個女孩\`

✅ 好：\`一位年輕女性，微笑，坐在咖啡廳窗邊，水彩畫風格，柔和自然光，高品質，細節豐富\`

## 常用品質標籤

\`\`\`
masterpiece, best quality, ultra detailed
8k, high resolution, photorealistic
cinematic lighting, professional photography
\`\`\`

## 負面提詞的重要性

負面提詞用來排除不想要的元素：

\`\`\`
low quality, blurry, distorted, ugly, deformed
extra limbs, bad anatomy, watermark, text
\`\`\`

## 風格關鍵字大全

### 藝術風格
- 油畫：\`oil painting, textured brushstrokes\`
- 水彩：\`watercolor, soft edges, translucent\`
- 動漫：\`anime style, cel shading, vivid colors\`
- 寫實：\`photorealistic, hyperrealistic, RAW photo\`

### 光線類型
- 黃金時刻：\`golden hour, warm sunlight\`
- 霓虹燈：\`neon lights, cyberpunk lighting\`
- 柔光：\`soft light, diffused, gentle\`
- 戲劇光：\`dramatic lighting, chiaroscuro\`

## 進階技巧

### 權重控制
使用 \`(關鍵詞:1.5)\` 增強特定元素的影響力：
\`\`\`
(beautiful face:1.3), (flowing hair:1.2), detailed background
\`\`\`

### 提詞分層
先寫最重要的元素，次要元素放後面：
\`\`\`
主要主體 → 風格 → 環境 → 光線 → 品質標籤
\`\`\`

## 中文 vs 英文提詞

| 場景 | 建議語言 |
|------|---------|
| Kling 影片 | 中文效果更好 |
| 其他模型 | 英文效果更好 |
| Seedream | 中文優化 |
| GPT Image | 中英文均佳 |
`,
    tags: ["提詞", "Prompt Engineering", "技術", "入門到進階"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-08T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "tech-002",
    category: "technique",
    title: "ControlNet 進階控制：OpenPose & Canny 完全教學",
    summary: "使用 ControlNet 精確控制圖片和影片的姿勢、構圖和風格，讓 AI 按你的要求生成。",
    content: `# ControlNet 進階控制教學

## 什麼是 ControlNet？

ControlNet 是一種讓你精確控制 AI 生成結果的技術。透過提供「控制圖」（如骨架姿勢圖、邊緣輪廓圖），AI 會按照控制圖的結構生成圖片。

## 主要 ControlNet 類型

### OpenPose（骨架姿勢控制）
提供人體骨架圖，AI 會生成符合該姿勢的人物。

**使用場景：**
- 固定特定姿勢
- 保持多張圖片的姿勢一致
- 模仿參考照片的姿勢

**在 Healing Studio 使用：**
1. 前往圖片創作室
2. 找到「DWPose 骨架姿勢估計」工具
3. 上傳參考圖片，獲得骨架圖
4. 將骨架圖 URL 用於 SDXL + ControlNet 生成

### Canny（邊緣輪廓控制）
提取圖片邊緣，保持構圖但改變風格。

**使用場景：**
- 保持構圖改變風格
- 線稿上色
- 圖片風格轉換

### Depth（深度圖控制）
控制場景的空間深度關係。

**使用場景：**
- 保持場景構圖深度
- 影片 3D 視差效果

## 實際操作範例

### 姿勢控制生成

1. 準備一張姿勢參考圖
2. 用 DWPose 提取骨架圖
3. 輸入提詞：\`一位女性，站立，微笑\`
4. 在 ControlNet 設定中選擇 OpenPose
5. 上傳骨架圖
6. 生成！

### 注意事項

- ControlNet 強度（Conditioning Scale）建議 0.6-0.8
- 太高的強度會讓圖片過於貼近控制圖，缺乏創意
- 太低的強度控制效果不明顯
`,
    tags: ["ControlNet", "OpenPose", "Canny", "進階技術"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // AI 新聞
  // ══════════════════════════════════════════════════════
  {
    id: "news-001",
    category: "ai-news",
    title: "Google Veo 3 發布：首個原生音頻影片模型",
    summary: "Google 最新影片生成模型 Veo 3 支援原生音頻生成，生成的影片自帶配音和音效。",
    content: `# Google Veo 3 發布

## 重大突破：原生音頻生成

2026 年，Google 發布 Veo 3，這是首個能夠在生成影片時同步生成原生音頻的模型。

## 主要特點

- **影片長度**：8 秒
- **解析度**：最高 1080p
- **音頻**：原生配音、音效、背景音樂同步生成
- **語言**：支援多語言提詞

## 與 Veo 2 的對比

| 功能 | Veo 2 | Veo 3 |
|------|-------|-------|
| 最長影片 | 8s | 8s |
| 原生音頻 | ❌ | ✅ |
| 解析度 | 720p | 1080p |
| 動態品質 | 優秀 | 卓越 |

## 如何在 Healing Studio 使用

前往**影片工作室 → 文生影**，選擇「Google Veo 3 Flash」模型。

提詞技巧：
- 在提詞中描述聲音元素：\`配合輕柔的鋼琴音樂\`
- 描述環境音：\`海浪聲、鳥鳴\`
- 模型會自動根據場景生成相應的音效

## 費率

約 $1.50-2.00 / 8秒影片（較高端，建議在確認需求後使用）
`,
    tags: ["Veo 3", "Google", "影片生成", "AI 新聞"],
    difficulty: "beginner",
    readingMinutes: 4,
    publishedAt: "2026-04-11T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "news-002",
    category: "ai-news",
    title: "Kling v2.1 上線：影片動態再升級",
    summary: "快手 Kling v2.1 版本正式上線，中文語意理解更強，動態表現更自然。",
    content: `# Kling v2.1 正式上線

快手 Kling 影片生成模型更新至 v2.1，帶來多項重大改進。

## 更新亮點

### 更強的中文理解
Kling v2.1 對中文提詞的理解能力大幅提升，更能準確抓住中文描述的細微語義。

### 更自然的物理動態
水流、布料飄動、頭髮搖擺等物理動態更加自然逼真。

### 首尾幀控制改進
圖生影模式的起始幀 + 結束幀雙控功能更穩定，過渡更流暢。

## 使用建議

- 提詞可使用中文，效果比英文更好
- 描述具體的動作和場景細節
- CFG Scale 建議維持在 0.5-0.7 之間

在 Healing Studio 影片工作室 → 圖生影 分類中可以找到 Kling v2.1 I2V 模型。
`,
    tags: ["Kling", "快手", "影片生成", "AI 新聞"],
    difficulty: "beginner",
    readingMinutes: 3,
    publishedAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 創作流程
  // ══════════════════════════════════════════════════════
  {
    id: "wf-001",
    category: "workflow",
    title: "完整影片創作流程：從概念到成品",
    summary: "從創意發想到最終影片輸出，使用 Healing Studio 完成一個完整影片創作項目的全流程指引。",
    content: `# 完整影片創作流程

## 第一步：創意發想（5 分鐘）

### 使用 AI 導演
1. 前往**導演 AI** 頁面
2. 描述你的創作想法（例如：「我想做一個關於春天花開的短影片，30秒，溫暖治癒」）
3. 導演 AI 會詢問更多細節並幫你規劃腳本
4. 保存腳本到**專案筆記**

---

## 第二步：概念圖生成（10 分鐘）

### 使用圖片創作室
1. 根據腳本每個場景，在圖片創作室生成概念圖
2. 推薦使用：Nano Banana Pro（快速）或 Flux 2 Pro（高品質）
3. 對滿意的概念圖加書籤，並儲存到**數位資產庫**

---

## 第三步：關鍵幀圖生影（30 分鐘）

### 使用影片工作室 → 圖生影
1. 挑選最滿意的概念圖
2. 根據場景選擇合適的模型：
   - 人物場景 → Kling v2.1 I2V
   - 自然場景 → Wan 2.1 I2V
   - 電影感 → Runway Gen4
3. 生成每個場景的影片片段

---

## 第四步：影片後期優化（10 分鐘）

### 使用影片工作室 → 畫質優化
1. 用 **ByteDance Upscaler** 將影片升至 2x 或 4x 解析度
2. 如果影片不夠流暢，用 **RIFE 補幀** 提升到 60fps

---

## 第五步：配音配樂（10 分鐘）

### 使用專業創作室
1. 音效：使用 ElevenLabs 音效生成環境音
2. 配樂：使用 Sonauto 生成背景音樂
3. 旁白：使用 Qwen TTS 或 ElevenLabs TTS

---

## 第六步：匯出與分享

1. 下載所有生成的媒體檔案
2. 用影片編輯軟體組合（推薦：CapCut、DaVinci Resolve）
3. 分享到社群媒體！

---

## 小提示

- 整個流程的 AI 生成費用約 $2-5
- 批量生成多個版本，選最好的
- 用**一致性保險庫**儲存角色參考，保持角色一致
`,
    tags: ["工作流程", "影片製作", "完整流程", "導演AI"],
    difficulty: "intermediate",
    readingMinutes: 15,
    publishedAt: "2026-04-09T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // API 文件
  // ══════════════════════════════════════════════════════
  {
    id: "api-001",
    category: "api-docs",
    title: "fal.ai API 完整介紹與最佳實踐",
    summary: "了解 fal.ai API 的架構、認證方式、Queue 系統和錯誤處理，快速整合 AI 模型到你的應用。",
    content: `# fal.ai API 完整介紹

## API 架構

fal.ai 提供兩種 API 調用方式：

### 1. 同步呼叫（fal.run）
適合快速模型（< 30 秒）：
\`\`\`
POST https://fal.run/{model-id}
Authorization: Key {FAL_API_KEY}
Content-Type: application/json
\`\`\`

### 2. Queue 非同步（queue.fal.run）
適合長時任務（影片、音樂生成等）：
\`\`\`
# 提交任務
POST https://queue.fal.run/{model-id}

# 查詢狀態
GET https://queue.fal.run/{model-id}/requests/{request_id}/status

# 取得結果
GET https://queue.fal.run/{model-id}/requests/{request_id}
\`\`\`

## 認證方式

在 Header 中帶入 API Key：
\`\`\`
Authorization: Key fal-your-api-key
\`\`\`

## 任務狀態

| 狀態 | 說明 |
|------|------|
| IN_QUEUE | 排隊中 |
| IN_PROGRESS | 處理中 |
| COMPLETED | 完成 |
| FAILED | 失敗 |

## 常見模型 ID

| 功能 | 模型 ID |
|------|---------|
| Kling 2.1 T2V | fal-ai/kling-video/v2.1/standard/text-to-video |
| Wan 2.1 720p | fal-ai/wan-ai/wan2.1-t2v-720p |
| Flux 2 Pro | fal-ai/flux-pro/v1.1 |
| GPT Image 1.5 | fal-ai/gpt-image-1.5 |
| RIFE 補幀 | fal-ai/rife-v4.6/video |

## 錯誤處理最佳實踐

1. 實作指數退避重試（最多 3 次）
2. Queue 任務設置合理的超時（影片：300s，音樂：300s）
3. 捕捉 FAILED 狀態並顯示友好錯誤訊息
4. 記錄 request_id 方便排查問題
`,
    tags: ["fal.ai", "API", "開發者", "Queue"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-07T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
];

// ─── In-memory store（後端無 DB 表時使用） ────────────────────────────────

let docs: LearnDoc[] = [...SEED_DOCS];

// ─── Router ──────────────────────────────────────────────────────────────────

export const learnHubRouter = router({

  /** 列出所有文件（支援分類篩選、搜尋、精選篩選） */
  list: publicProcedure
    .input(z.object({
      category:    z.string().optional(),
      search:      z.string().optional(),
      featured:    z.boolean().optional(),
      difficulty:  z.enum(["beginner", "intermediate", "advanced"]).optional(),
      limit:       z.number().min(1).max(100).default(50),
      offset:      z.number().min(0).default(0),
    }))
    .query(({ input }) => {
      let result = [...docs];

      if (input.category) {
        result = result.filter(d => d.category === input.category);
      }
      if (input.featured !== undefined) {
        result = result.filter(d => d.featured === input.featured);
      }
      if (input.difficulty) {
        result = result.filter(d => d.difficulty === input.difficulty);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        result = result.filter(d =>
          d.title.toLowerCase().includes(q) ||
          d.summary.toLowerCase().includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q))
        );
      }

      // Sort: featured first, then by publishedAt desc
      result.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });

      const total = result.length;
      const items = result.slice(input.offset, input.offset + input.limit);

      return { items, total };
    }),

  /** 取得單篇文件（含完整 content） */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const doc = docs.find(d => d.id === input.id);
      if (!doc) throw new Error("文件不存在");
      return doc;
    }),

  /** 取得所有分類及各分類文件數量 */
  categories: publicProcedure.query(() => {
    const categoryCounts: Record<string, number> = {};
    docs.forEach(d => {
      categoryCounts[d.category] = (categoryCounts[d.category] ?? 0) + 1;
    });
    return categoryCounts;
  }),

  /** 管理員：新增文件 */
  create: adminProcedure
    .input(z.object({
      category:      z.enum(["getting-started", "model-guide", "api-docs", "technique", "ai-news", "workflow"]),
      title:         z.string().min(1).max(200),
      summary:       z.string().min(1).max(500),
      content:       z.string().min(1),
      tags:          z.array(z.string()).default([]),
      difficulty:    z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
      readingMinutes: z.number().min(1).max(120).default(5),
      featured:      z.boolean().default(false),
      externalUrl:   z.string().url().optional(),
      authorName:    z.string().max(100).optional(),
    }))
    .mutation(({ input }) => {
      const now = new Date().toISOString();
      const newDoc: LearnDoc = {
        id: `custom-${Date.now()}`,
        ...input,
        publishedAt: now,
        updatedAt: now,
      };
      docs.unshift(newDoc);
      return newDoc;
    }),

  /** 管理員：更新文件 */
  update: adminProcedure
    .input(z.object({
      id:      z.string(),
      title:   z.string().min(1).max(200).optional(),
      summary: z.string().min(1).max(500).optional(),
      content: z.string().min(1).optional(),
      tags:    z.array(z.string()).optional(),
      featured: z.boolean().optional(),
      category: z.enum(["getting-started", "model-guide", "api-docs", "technique", "ai-news", "workflow"]).optional(),
      difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      readingMinutes: z.number().min(1).max(120).optional(),
    }))
    .mutation(({ input }) => {
      const idx = docs.findIndex(d => d.id === input.id);
      if (idx === -1) throw new Error("文件不存在");
      const { id, ...updates } = input;
      docs[idx] = { ...docs[idx], ...updates, updatedAt: new Date().toISOString() };
      return docs[idx];
    }),

  /** 管理員：刪除文件 */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const idx = docs.findIndex(d => d.id === input.id);
      if (idx === -1) throw new Error("文件不存在");
      docs.splice(idx, 1);
      return { success: true };
    }),
});
