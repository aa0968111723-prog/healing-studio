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
import {
  protectedProcedure,
  publicProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import { TRPCError } from "@trpc/server";

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
  content: string; // Markdown content
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  readingMinutes: number;
  publishedAt: string; // ISO date string
  updatedAt: string;
  featured: boolean;
  externalUrl?: string; // If linking to external resource
  authorName?: string;
  attachments?: Array<{
    type: "image" | "video" | "pdf" | "audio";
    url: string;
    title?: string;
  }>;
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

Healing Studio 是一個整合 AI 的全方位創作平台，讓你能夠用最直觀的方式生成圖片、影片、音樂和語音。平台基於 React + Node.js + tRPC 架構，採用 fal.ai 作為多模態生成後端，並以 Google Gemini 作為智能大腦。

---

## 🗂️ 全站導覽：17 個功能模組

### 🎨 創作工作室（/studio）
核心功能。使用靈感積木系統組合提詞，AI 自動選擇最適合的模型生成作品。
- **四種創作模態**：圖片、影片、音訊、語音
- **靈感積木**：點選積木快速組合提詞，支援自定義積木和積木組合
- **ZenCoPilot**：AI 即時建議、提詞優化、以及靈感晶片推薦
- **光球夥伴（Orb）**：隨時提供創作靈感和操作協助
- **視覺靈魂（Visual Soul）**：生成結果的 3D 動態展示
- **一致性保險庫整合**：可直接注入角色/場景圖至提詞

### 🎵 音樂配音創作室（/pro-studio）
8 大功能分類，20+ 工具的專業音訊影片工作站：
1. **文字生音樂**（Sonauto）：MIDI 風格、BPM 控制
2. **音效生成**（ElevenLabs）：0.5–22 秒精確時長
3. **AI 語音合成（TTS）**：ElevenLabs 多語言 + Qwen TTS
4. **聲音克隆**（Qwen Clone + Dia TTS）：上傳聲音樣本複製聲紋
5. **說話頭像**（EchoMimic/Stable Avatar/Longcat Avatar）
6. **音訊分離**（Demucs）：人聲/背景音分離
7. **影片配音**（ElevenLabs Dubbing）：自動翻譯配音
8. **語音轉文字**（WhisperX）：精確字幕生成

### 🖼️ 圖片創作室（/image-studio）
23 種頂尖圖片生成模型，5 大分類：
- **文字生圖**：Nano Banana 2/Pro、Seedream v4、Imagen 4
- **圖片編輯**：GPT Image 1.5、Flux Kontext、Grok Edit、Seedream v4.5/v5 Edit
- **畫質優化**：SeedVR Upscale（超分辨率）
- **控制工具**：DWPose 骨架偵測、SD 3.5 + ControlNet
- **3D 建模**：Trellis 2、SAM 3D、HunYuan3D v3、Rodin、HunYuan World

### 🎬 影片工作室（/video-studio）
21 個 fal.ai 頂尖影片模型，5 大分類：
- **文生影（T2V）**：Kling 2.1、Wan 2.1 480p/720p、MiniMax、Veo 3、LTX、Sora
- **圖生影（I2V）**：Kling 2.1 I2V、Wan 2.1 I2V、Runway Gen4 Turbo、PixVerse 4.5、MiniMax I2V
- **影生影（V2V）**：Wan 2.1 V2V、Kling 1.6 V2V、LTX I2V
- **畫質優化**：ByteDance Video Upscaler、RIFE v4.6 補幀、Topaz Video Enhance
- **進階控制**：CamMaster 鏡頭控制、AnimateDiff、DepthCrafter、Vidu Q1 Reference

### 🎭 導演 AI（/director）
AI 扮演創意導演，透過對話規劃完整創作項目。支援多種導演人格（Gemini 2.5 Pro/Flash、Vertex AI）。

### 🤖 角色鍛造所（/models）
LoRA 微調模型管理中心：
- 上傳 3–20 張訓練圖（支援角度標記）
- 自動 AI 圖片標註（invokeLLM）
- 背景非同步 Replicate 訓練
- 模型狀態：queued → training → ready / failed
- 支援 team_shared 可見性，分享給團隊使用
- 一鍵套用到創作工作室/圖片創作室/影片工作室

### 🕐 生成歷史（/history）
所有生成結果的管理中心：
- 按模態篩選（圖片/影片/音訊/語音）、關鍵字搜尋
- 書籤收藏、星級評分（1–5 星）
- 刪除紀錄
- 加入首頁精選（showcase.promote，每天最多 5 件）

### 📦 數位資產庫（/assets）
個人 + 團隊共享的媒體資產管理：
- 上傳並儲存任意媒體檔案
- 切換 private / team_shared 可見性
- 刪除資產

### 🗄️ 一致性保險庫（/vault）
角色和場景視覺一致性的核心系統：
- 儲存角色參考圖（character type）
- 儲存場景參考圖（scene type）
- 在創作工作室生成時直接注入角色/場景 URL
- 支援標籤和元資料管理

### 📝 專案筆記（/notes）
整合 Markdown + 腳本的筆記系統：
- 支援 note / script / calendar_event 三種類型
- 可設定排程日期
- 腳本格式（scriptJson）支援結構化內容

### 📅 創作排程（/calendar）
創作日曆系統，整合專案筆記的排程功能。

### 👥 共享空間（/shared）
團隊共享的協作工作空間。

### 📊 儀表板（/dashboard）
個人使用統計中心：
- 生成次數、成本摘要
- 按模態的使用分佈圓餅圖
- 每日生成趨勢折線圖
- 最近 10 筆使用紀錄

### 💬 回饋中心（/feedback）
使用者意見回饋系統：
- 類別：bug / feature_request / quality_issue / general
- 優先級：low / medium / high / critical
- 回饋通知自動推送給管理員

### 📚 學習文件（/learn）
本文件所在的知識庫中心，整合所有教學文章。

### ⚙️ 個人設定（/settings + /settings/ai-brain）
- 主題/字型/動畫偏好設定
- AI Brain 5 維度模型配置（全站導演/新聞過濾/編譯器/光球語調/RAG 向量）

### 🛡️ 管理後台（/admin）
管理員專屬：
- 查看所有使用者清單與配額
- 使用量統計 + 成本摘要
- 回饋報告管理

---

## 🚀 快速開始

1. 點擊左側欄「**創作工作室**」
2. 選擇創作模態（圖片/影片/音訊/語音）
3. 點選幾個靈感積木
4. 按下「**開始生成**」按鈕
5. 觀看光球夥伴的思考過程動畫
6. 欣賞你的第一件 AI 作品！

## 💡 進階技巧

- **詳細提詞**效果優於**簡短提詞**
- 使用**負面提詞**排除不想要的元素
- 試試不同**風格積木**組合並儲存為積木組合
- **一致性保險庫**可以保持角色視覺一致
- 多個工作室可以串聯使用（圖片創作室 → 影片工作室）
`,
    tags: ["入門", "快速開始", "平台介紹", "導覽"],
    difficulty: "beginner",
    readingMinutes: 8,
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

靈感積木是 Healing Studio 獨創的提詞輔助系統。每個積木代表一個創作要素，點選積木後系統會自動將其組合成完整的 AI 提詞。積木系統搭配 AI 提詞編譯器（Elite Prompt Compiler），能夠將你選擇的積木轉化為高品質的英文生成提詞。

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

## 自定義積木（Custom Blocks）

你可以建立屬於自己的積木庫：
1. 在創作工作室底部點擊「+ 新增積木」
2. 輸入積木名稱、關鍵詞、選擇模態（image/video/audio/voice）
3. 積木儲存到個人帳號，永久保留
4. 積木可以按模態篩選顯示

**API：** \`trpc.customBlocks.create\` / \`trpc.customBlocks.list\` / \`trpc.customBlocks.delete\`

## 積木組合（Block Combos）

將多個積木組合儲存為一個命名方案：
1. 選好幾個積木後點擊「儲存組合」
2. 輸入組合名稱
3. 下次直接一鍵載入整組積木

**API：** \`trpc.blockCombos.create\` / \`trpc.blockCombos.list\` / \`trpc.blockCombos.rename\` / \`trpc.blockCombos.delete\`

## PromptStrengthBar

提詞強度條根據你輸入的提詞字數和積木數量計算強度（0–100%）：
- **0–30%**：提詞太簡單，效果可能不佳
- **30–70%**：適中，大多數場景夠用
- **70–100%**：詳細，通常能獲得最好效果

## ZenCoPilot（提詞助手）

點擊光球或輸入框旁的按鈕啟動 ZenCoPilot：
- **靈感晶片**（Inspiration Chips）：AI 推薦相關關鍵詞
- **提詞優化**：自動改善你的提詞
- **suggestChips API**：\`trpc.evaluate.suggestChips\`
- **提詞評估 API**：\`trpc.evaluate.prompt\`

## 積木組合快捷使用

在積木列表上方有一個「積木組合」下拉選單，可以快速載入已儲存的組合，並支援重命名。
`,
    tags: ["積木", "提詞", "入門", "ZenCoPilot", "積木組合"],
    difficulty: "beginner",
    readingMinutes: 6,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "gs-003",
    category: "getting-started",
    title: "環境變數設定完整指南",
    summary:
      "所有必要和可選的環境變數完整說明，包含 Google OAuth、AI API Keys 和資料庫設定。",
    content: `# 環境變數設定完整指南

## 必要環境變數（核心平台）

| 變數名稱 | 說明 | 範例 |
|---------|------|------|
| \`DATABASE_URL\` | MySQL 連線字串 | \`mysql://user:pass@host:3306/db\` |
| \`JWT_SECRET\` | Session JWT 金鑰（至少 32 字元） | \`openssl rand -base64 32\` 生成 |
| \`GOOGLE_CLIENT_ID\` | Google OAuth 2.0 Client ID | 從 Google Cloud Console 取得 |
| \`GOOGLE_CLIENT_SECRET\` | Google OAuth 2.0 Client Secret | 從 Google Cloud Console 取得 |
| \`GOOGLE_REDIRECT_URI\` | OAuth 回調 URL | \`https://your-domain.com/api/oauth/callback\` |

## 選用環境變數（功能模組）

### AI 語言模型
| 變數名稱 | 模組 | 說明 |
|---------|------|------|
| \`GEMINI_API_KEY\` | AI Brain + 提詞編譯器 | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| \`GOOGLE_CLOUD_PROJECT_ID\` | Vertex AI | GCP 專案 ID |
| \`GOOGLE_APPLICATION_CREDENTIALS_JSON\` | Vertex AI | GCP 服務帳號 JSON（整行） |
| \`GOOGLE_CLOUD_LOCATION\` | Vertex AI | 預設 us-central1 |
| \`GCS_BUCKET_NAME\` | 雲端儲存 | Google Cloud Storage bucket |

### 圖片 / 影片生成
| 變數名稱 | 模組 | 說明 |
|---------|------|------|
| \`FAL_API_KEY\` | 圖片/影片生成（核心） | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) |
| \`REPLICATE_API_TOKEN\` | LoRA 模型訓練 | [replicate.com/account](https://replicate.com/account) |

### 音訊 / 語音
| 變數名稱 | 模組 | 說明 |
|---------|------|------|
| \`ELEVENLABS_API_KEY\` | TTS / 音效 / 配音 | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io) |
| \`SUNO_API_KEY\` | AI 音樂生成 | [suno.ai](https://suno.ai) |

### 記憶系統
| 變數名稱 | 模組 | 說明 |
|---------|------|------|
| \`PINECONE_API_KEY\` | RAG 記憶系統 | [app.pinecone.io](https://app.pinecone.io) |
| \`PINECONE_ENVIRONMENT\` | Pinecone | 預設 us-east-1 |
| \`PINECONE_INDEX_NAME\` | Pinecone | 預設 ai-director-memories |

### 其他可選
| 變數名稱 | 說明 |
|---------|------|
| \`LANGSMITH_API_KEY\` | LangSmith 追蹤（自動啟用） |
| \`NODE_ENV\` | production / development |
| \`PORT\` | 伺服器端口（預設 3000） |

## 設定方法

### 本地開發（.env 檔案）
\`\`\`bash
cp .env.example .env
# 編輯 .env 填入各項金鑰
\`\`\`

### Railway 部署
1. 進入 Railway 控制台 → 你的服務 → Variables
2. 逐一新增上述變數
3. 每次更新後自動重新部署

### 無資料庫 Demo 模式
只需設定 \`FAL_API_KEY\`，不設 \`DATABASE_URL\` 即可進入 Demo 模式：
- 使用 \`/api/oauth/demo/start\` 登入（示範帳號：Demo User）
- 生成配額：999 點（虛擬）
- 所有資料儲存在記憶體，重啟後清除

## LLM 引擎優先序

1. 如果設定了 \`GEMINI_API_KEY\` → 使用 Gemini API 直接呼叫
2. 如果設定了 \`GOOGLE_CLOUD_PROJECT_ID\` + \`GOOGLE_APPLICATION_CREDENTIALS_JSON\` → 使用 Vertex AI
3. 如果設定了 \`BUILT_IN_FORGE_API_KEY\` → 使用 Manus Forge（舊版相容）
4. 否則 → AI 功能降級（提詞直接使用原文，不經過 LLM 編譯）
`,
    tags: ["設定", "環境變數", "API Key", "部署", "Google OAuth"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "gs-004",
    category: "getting-started",
    title: "Google OAuth 2.0 登入設定教學",
    summary:
      "設定 Google OAuth 讓用戶可以用 Google 帳號登入 Healing Studio，以及 Demo 模式的使用方法。",
    content: `# Google OAuth 2.0 登入設定

## 登入系統架構

Healing Studio 使用 Google OAuth 2.0 作為主要認證系統，同時提供 Demo 模式供無資料庫環境使用。

## 設定 Google OAuth

### 步驟一：建立 Google Cloud 專案
1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新專案或選擇現有專案
3. 啟用 **Google+ API**（或 People API）

### 步驟二：設定 OAuth 2.0 憑證
1. 前往「API 和服務」→「憑證」
2. 點擊「建立憑證」→「OAuth 用戶端 ID」
3. 應用程式類型選「網路應用程式」
4. 填入授權重新導向 URI：
   - 開發環境：\`http://localhost:3000/api/oauth/callback\`
   - 生產環境：\`https://your-domain.com/api/oauth/callback\`
5. 複製 **Client ID** 和 **Client Secret**

### 步驟三：設定環境變數
\`\`\`
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/oauth/callback
\`\`\`

## OAuth 流程說明

| 端點 | 說明 |
|------|------|
| \`GET /api/oauth/google/start\` | 重導向到 Google 登入頁 |
| \`GET /api/oauth/callback\` | Google 回調，建立 session |
| \`POST /api/oauth/logout\` | 清除 session cookie |
| \`GET /api/oauth/demo/start\` | Demo 模式登入 |

## Session 管理

- 使用 **JWT** 存在 HttpOnly Cookie（名稱：\`hs-session\`）
- Cookie 有效期：1 年
- 安全設定：
  - HTTPS 環境：\`Secure=true, SameSite=None\`
  - HTTP 環境：\`Secure=false, SameSite=Lax\`
- 登入後自動 upsert 使用者資料到資料庫

## Demo 模式

當 \`DATABASE_URL\` 未設定時，平台自動進入 Demo 模式：
- Demo 使用者：ID=0, name="Demo User", email="demo@healing-studio.ai"
- 配額：999 點（虛擬，不扣除）
- 所有生成返回示範媒體（Unsplash 圖片、Google CDN 影片）
- 認證過期時自動顯示 \`AuthExpiredModal\` 彈窗

## 登入頁跳轉邏輯（client/src/const.ts）

\`\`\`typescript
getLoginUrl()    // 返回 Google OAuth 起始 URL（帶 returnTo 參數）
getDemoLoginUrl() // 返回 /api/oauth/demo/start
\`\`\`
`,
    tags: ["Google OAuth", "登入", "認證", "JWT", "Demo 模式"],
    difficulty: "intermediate",
    readingMinutes: 7,
    publishedAt: "2026-04-02T00:00:00Z",
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
    title: "影片工作室全模型完整目錄（21 個模型）",
    summary:
      "影片工作室所有 21 個 fal.ai 模型的詳細說明，包含參數、適用場景和費率。",
    content: `# 影片工作室全模型完整目錄

## 📹 文生影（Text-to-Video，T2V）

### 1. Kling 2.1 Standard（快手）
- **API：** \`trpc.videoStudio.klingTextToVideo\`
- **FAL 模型：** \`fal-ai/kling-video/v2.1/standard/text-to-video\`
- **時長：** 5 秒或 10 秒
- **比例：** 16:9、9:16、1:1
- **特點：** 中文語意理解最強，動態自然，首選中文創作
- **超時：** 300 秒

### 2. Wan 2.1（阿里巴巴）
- **API：** \`trpc.videoStudio.wanTextToVideo\`
- **FAL 模型：** \`fal-ai/wan-ai/wan2.1-t2v-720p\`（720p）/ \`fal-ai/wan-ai/wan2.1-t2v-480p\`（480p）
- **解析度：** 720p 或 480p（根據輸入切換）
- **特點：** 開源最強，物理動態出色（水流/風吹），費用最低
- **超時：** 300 秒

### 3. MiniMax Hailuo（迷你麥斯）
- **API：** \`trpc.videoStudio.minimaxTextToVideo\`
- **FAL 模型：** \`fal-ai/minimax/video-01\`
- **特點：** 流暢敘事型影片，對話場景表現優秀
- **超時：** 300 秒

### 4. Google Veo 3（谷歌）
- **API：** \`trpc.videoStudio.veo3TextToVideo\`
- **FAL 模型：** \`fal-ai/veo3\`
- **特點：** **首個原生音頻影片模型**，生成影片自帶音效和配樂，8 秒
- **超時：** 480 秒

### 5. LTX Video 13B Distilled
- **API：** \`trpc.videoStudio.ltxTextToVideo\`
- **FAL 模型：** \`fal-ai/ltx-video-13b-distilled\`
- **特點：** 快速蒸餾模型，速度快，適合原型驗證
- **超時：** 240 秒

### 6. Sora（OpenAI）
- **API：** \`trpc.videoStudio.soraTextToVideo\`
- **FAL 模型：** \`fal-ai/sora\`
- **特點：** OpenAI 旗艦影片模型，物理模擬精準，最長 20 秒
- **超時：** 480 秒

---

## 🖼️→🎬 圖生影（Image-to-Video，I2V）

### 7. Kling 2.1 I2V
- **API：** \`trpc.videoStudio.klingImageToVideo\`
- **FAL 模型：** \`fal-ai/kling-video/v2.1/standard/image-to-video\`
- **特點：** 中文首選，起始幀控制精準，結束幀可選

### 8. Wan 2.1 I2V
- **API：** \`trpc.videoStudio.wanImageToVideo\`
- **FAL 模型：** \`fal-ai/wan-ai/wan2.1-i2v-720p\`（720p）/ \`480p\`

### 9. Runway Gen4 Turbo
- **API：** \`trpc.videoStudio.runwayImageToVideo\`
- **FAL 模型：** \`fal-ai/runway-gen4-turbo/image-to-video\`
- **特點：** 電影級畫質，商業品質輸出，精確鏡頭控制

### 10. PixVerse 4.5
- **API：** \`trpc.videoStudio.pixverseImageToVideo\`
- **FAL 模型：** \`fal-ai/pixverse/v4.5/image-to-video\`
- **特點：** 動畫風格出色，表情生動

### 11. MiniMax I2V
- **API：** \`trpc.videoStudio.minimaxImageToVideo\`
- **FAL 模型：** \`fal-ai/minimax/video-01/image-to-video\`

---

## 🎬→🎬 影生影（Video-to-Video，V2V）

### 12. Wan 2.1 V2V
- **API：** \`trpc.videoStudio.wanVideoToVideo\`
- **FAL 模型：** \`fal-ai/wan-ai/wan2.1-v2v-480p\`

### 13. Kling 1.6 V2V
- **API：** \`trpc.videoStudio.klingVideoToVideo\`
- **FAL 模型：** \`fal-ai/kling-video/v1.6/standard/video-to-video\`

### 14. LTX I2V（影片接續）
- **API：** \`trpc.videoStudio.ltxImageToVideo\`
- **FAL 模型：** \`fal-ai/ltx-video/image-to-video\`

---

## ⬆️ 畫質優化

### 15. ByteDance Video Upscaler（超分辨率）
- **API：** \`trpc.videoStudio.videoUpscale\`
- **FAL 模型：** \`fal-ai/bytedance/upscaler/video\`
- **特點：** 2x/4x 超分辨率，保留細節

### 16. RIFE v4.6 補幀
- **API：** \`trpc.videoStudio.frameInterpolation\`
- **FAL 模型：** \`fal-ai/rife-v4.6/video\`
- **特點：** 將 24fps 提升到 48fps 或 60fps，消除卡頓感

### 17. Topaz Video Enhance
- **API：** \`trpc.videoStudio.topazEnhance\`
- **FAL 模型：** \`fal-ai/topaz/video-enhance\`
- **特點：** 專業級視頻修復，最高支援 4K 輸出
- **超時：** 600 秒

---

## 🎛️ 進階控制

### 18. CamMaster（鏡頭控制）
- **API：** \`trpc.videoStudio.camMaster\`
- **FAL 模型：** \`fal-ai/cammaster\`
- **特點：** 精確控制鏡頭移動（Pan/Tilt/Zoom/Rotate）

### 19. AnimateDiff V2V（動畫風格轉換）
- **API：** \`trpc.videoStudio.animateDiff\`
- **FAL 模型：** \`fal-ai/animatediff-v2v\`
- **特點：** 將寫實影片轉換為動畫風格

### 20. DepthCrafter（深度視差）
- **API：** \`trpc.videoStudio.depthCrafter\`
- **FAL 模型：** \`fal-ai/depthcrafter\`
- **特點：** 生成深度圖，用於視差效果和 3D 場景重建

### 21. Vidu Q1 Reference（參考圖生影）
- **API：** \`trpc.videoStudio.viduReferenceToVideo\`
- **FAL 模型：** \`fal-ai/vidu/q1/reference-to-video\`
- **特點：** 多參考圖融合生成，角色一致性強
`,
    tags: [
      "影片生成",
      "Kling",
      "Wan",
      "Runway",
      "Veo 3",
      "Sora",
      "fal.ai",
      "模型目錄",
    ],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-05T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "mg-002",
    category: "model-guide",
    title: "圖片創作室全模型完整目錄（23 個模型）",
    summary:
      "圖片創作室所有 23 種模型的詳細說明，包含文字生圖、圖片編輯、3D 建模等完整分類。",
    content: `# 圖片創作室全模型完整目錄

## 📸 文字生圖（Text-to-Image）

### 1. Nano Banana 2（Gemini 3.1 Flash Image）
- **API：** \`trpc.imageStudio.nanoBanana2\`
- **FAL 模型：** \`fal-ai/nano-banana-2\`
- **參數：** prompt、aspect_ratio（auto/1:1/16:9/9:16/4:3/3:4/4:1/1:4/8:1/1:8）、image_urls（最多 14 張）、num_images（1–4）
- **特點：** Gemini 3.1 Flash，速度快，支援多圖參考融合，文字渲染佳
- **超時：** 120 秒

### 2. Nano Banana Pro（Gemini 3 Pro Image）
- **API：** \`trpc.imageStudio.nanoBananaPro\`
- **FAL 模型：** \`fal-ai/nano-banana-pro\`
- **特點：** 最高品質 Gemini 圖片模型，細節豐富，最多 14 張參考圖

### 3. Seedream v4（ByteDance）
- **API：** \`trpc.imageStudio.seedreamV4\`
- **FAL 模型：** \`fal-ai/bytedance/seedream/v4/text-to-image\`
- **比例：** 1:1、16:9、9:16、4:3、3:4、3:2、2:3
- **特點：** ByteDance 高品質模型，中文提詞優化

### 4. Google Imagen 4（Preview）
- **API：** \`trpc.imageStudio.imagen4\`
- **FAL 模型：** \`fal-ai/imagen4/preview\`
- **特點：** Google 最新圖片生成模型，真實感出色

---

## ✏️ 圖片編輯（Image Editing）

### 5. Nano Banana Pro Edit
- **API：** \`trpc.imageStudio.nanoBananaProEdit\`
- **FAL 模型：** \`fal-ai/nano-banana-pro/edit\`
- **參數：** prompt、image_url、aspect_ratio

### 6. Nano Banana Edit（Gemini 2.0 Flash）
- **API：** \`trpc.imageStudio.nanoBananaEdit\`
- **FAL 模型：** \`fal-ai/nano-banana/edit\`

### 7. Nano Banana 2 Edit（Gemini 3.1 Flash 編輯）
- **API：** \`trpc.imageStudio.nanoBanana2Edit\`
- **FAL 模型：** \`fal-ai/nano-banana-2/edit\`

### 8. Seedream v4.5 Edit（ByteDance）
- **API：** \`trpc.imageStudio.seedreamV45Edit\`
- **FAL 模型：** \`fal-ai/bytedance/seedream/v4.5/edit\`

### 9. Seedream v5 Lite Edit
- **API：** \`trpc.imageStudio.seedreamV5LiteEdit\`
- **FAL 模型：** \`fal-ai/bytedance/seedream/v5/lite/edit\`

### 10. Grok Edit（xAI）
- **API：** \`trpc.imageStudio.grokEdit\`
- **FAL 模型：** \`fal-ai/grok/image-edit\`（或類似端點）

### 11. GPT Image 1.5 Edit（OpenAI）
- **API：** \`trpc.imageStudio.gptImage15Edit\`
- **FAL 模型：** \`fal-ai/gpt-image-1.5/edit\`
- **特點：** OpenAI 最強圖片編輯，文字插入/修改/去除，多圖合成

### 12. FLUX.1 Kontext Pro（Black Forest Labs）
- **API：** \`trpc.imageStudio.fluxKontext\`
- **FAL 模型：** \`fal-ai/flux-pro/kontext\`
- **特點：** 語境感知編輯，保留背景同時精確修改目標區域

### 13. Flux 2 Pro Edit
- **API：** \`trpc.imageStudio.flux2ProEdit\`
- **FAL 模型：** \`fal-ai/flux-2-pro/edit\`

---

## 🔍 畫質優化

### 14. SeedVR Upscale（影像超分辨率）
- **API：** \`trpc.imageStudio.seedVRUpscale\`
- **FAL 模型：** \`fal-ai/seedvr/upscale/image\`
- **特點：** ByteDance 最強超分，可放大到 4K

---

## 🎛️ 控制工具

### 15. DWPose 骨架姿勢偵測
- **API：** \`trpc.imageStudio.dwPose\`
- **FAL 模型：** \`fal-ai/dwpose\`
- **特點：** 提取人體骨架圖，用於 ControlNet 姿勢控制輸入

### 16. Stable Diffusion 3.5 Large + ControlNet + LoRA
- **API：** \`trpc.imageStudio.stableDiffusion35\`
- **FAL 模型：** \`fal-ai/stable-diffusion-v35-large\`
- **參數：** prompt、negative_prompt、image_url（ControlNet 輸入）、lora_url、control_net_type（openpose/canny/depth/scribble）
- **特點：** 精確姿勢控制，支援自定義 LoRA 模型

### 17. Fast SDXL
- **API：** \`trpc.imageStudio.fastSdxl\`
- **FAL 模型：** \`fal-ai/fast-sdxl\`
- **特點：** 快速生成，適合快速原型

### 18. SD LoRA（LoRA 微調模型生成）
- **API：** \`trpc.imageStudio.sdLora\`
- **FAL 模型：** \`fal-ai/lora\`
- **特點：** 支援指定 LoRA URL 生成，與角色鍛造所整合

---

## 🧊 3D 建模

### 19. Trellis 2（圖片生成 3D GLB）
- **API：** \`trpc.imageStudio.trellis2\`
- **FAL 模型：** \`fal-ai/trellis-2\`
- **特點：** 從單張圖片生成高品質 3D GLB 模型

### 20. SAM 3D Objects（物件重建）
- **API：** \`trpc.imageStudio.sam3dObjects\`
- **FAL 模型：** \`fal-ai/sam-3/3d-objects\`
- **特點：** 自動分割並重建場景中的 3D 物件

### 21. HunYuan3D v3 電影級（混元）
- **API：** \`trpc.imageStudio.hunyuan3d\`
- **FAL 模型：** \`fal-ai/hunyuan3d-v3/image-to-3d\`
- **特點：** 騰訊混元最強 3D 生成，電影級精度

### 22. Rodin（文字/圖片生成 3D）
- **API：** \`trpc.imageStudio.rodin3d\`
- **FAL 模型：** \`fal-ai/hyper3d/rodin\`
- **特點：** 支援文字 + 圖片雙輸入生成 3D 模型

### 23. HunYuan World（圖片轉世界）
- **API：** \`trpc.imageStudio.hunyuanWorld\`
- **FAL 模型：** \`fal-ai/hunyuan_world/image-to-world\`
- **特點：** 將單張圖片擴展為完整 3D 世界場景
`,
    tags: [
      "圖片生成",
      "Flux",
      "GPT Image",
      "Seedream",
      "ControlNet",
      "3D 建模",
      "模型目錄",
    ],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-06T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "mg-003",
    category: "model-guide",
    title: "音樂配音創作室完整功能說明（20+ 工具）",
    summary:
      "專業創作室所有功能的完整說明，包含 TTS、音樂生成、聲音克隆、說話頭像等。",
    content: `# 音樂配音創作室完整功能說明

## 🎵 文字生音樂

### textToMusic
- **API：** \`trpc.proStudio.textToMusic\`
- **FAL 模型：** Sonauto / Stable Audio
- **參數：** prompt（主要描述）、lyrics（歌詞，可選）、genre（風格）、bpm（40–300）、key（調號）、duration（時長）
- **輸出：** audio_url、tags、lyrics、seed

### soundEffects（ElevenLabs 音效）
- **API：** \`trpc.proStudio.soundEffects\`
- **ElevenLabs 模型：** Sound Effects Generator
- **參數：** text（描述）、duration_seconds（0.5–22）、prompt_influence（0–1）
- **特點：** 精確時長控制，適合 Foley 音效製作

---

## 🗣️ AI 語音合成（TTS）

### elevenLabsTTS（多語言高品質）
- **API：** \`trpc.proStudio.elevenLabsTTS\`
- **參數：** text（最多 5000 字）、voice_id、model_id（eleven_turbo_v2_5）、stability（0–1）、similarity_boost（0–1）、style（0–1）、language_code
- **特點：** 支援 29 種語言，情緒控制，最自然的 TTS

### qwenTTS（Qwen 語音）
- **API：** \`trpc.proStudio.qwenTTS\`
- **特點：** 阿里雲 Qwen 語音，中文表現優秀，快速低成本

---

## 🎤 聲音克隆

### qwenCloneAndSpeak（Qwen 聲音克隆 + 朗讀）
- **API：** \`trpc.proStudio.qwenCloneAndSpeak\`
- **參數：** 上傳聲音樣本 → 輸入要朗讀的文字 → 輸出克隆聲音

### diaTTSVoiceClone（Dia TTS）
- **API：** \`trpc.proStudio.diaTTSVoiceClone\`
- **特點：** 對話式聲音克隆，支援多說話人場景

### qwenVoiceDesign（聲音設計）
- **API：** \`trpc.proStudio.qwenVoiceDesign\`
- **特點：** 從頭設計一個全新聲音，而非克隆

### klingCreateVoice（Kling 語音創建）
- **API：** \`trpc.proStudio.klingCreateVoice\`
- **特點：** 快手 Kling 語音創建服務

---

## 🎭 說話頭像（Talking Avatar）

### speechToVideo / echoMimic（EchoMimic）
- **API：** \`trpc.proStudio.speechToVideo\` / \`trpc.proStudio.echoMimic\`
- **特點：** 上傳人臉圖 + 音頻 → 生成說話頭像影片
- **超時：** 300 秒

### stableAvatar（Stable Avatar）
- **API：** \`trpc.proStudio.stableAvatar\`
- **特點：** Stability AI 說話頭像，表情自然

### longcatAvatar（Longcat Avatar）
- **API：** \`trpc.proStudio.longcatAvatar\`
- **特點：** 支援較長時長的說話頭像

### ltxAudioToVideo（LTX Audio to Video）
- **API：** \`trpc.proStudio.ltxAudioToVideo\`
- **特點：** 音頻驅動影片生成，不限於人臉

---

## 🎼 音訊分離與處理

### demucs（人聲/伴奏分離）
- **API：** \`trpc.proStudio.demucs\`
- **FAL 模型：** Meta Demucs
- **參數：** audio_url、model（htdemucs/htdemucs_ft/htdemucs_6s）、shifts（0–10）
- **輸出：** 分別下載人聲軌、鼓軌、貝斯軌、其他軌

### audioIsolation（音頻隔離）
- **API：** \`trpc.proStudio.audioIsolation\`
- **特點：** 去除背景噪音，保留主要音源

### mergeAudios（音頻合併）
- **API：** \`trpc.proStudio.mergeAudios\`
- **特點：** 將多個音頻片段合併（淡入淡出）

### voiceChanger（聲音變換）
- **API：** \`trpc.proStudio.voiceChanger\`
- **特點：** 即時聲音風格轉換

---

## 🎬 影片配音

### dubbing（ElevenLabs 配音翻譯）
- **API：** \`trpc.proStudio.dubbing\`
- **特點：** 自動翻譯影片音頻 + 生成目標語言配音，保持音調一致

---

## 📝 語音轉文字

### speechToText（WhisperX）
- **API：** \`trpc.proStudio.speechToText\`
- **特點：** 精確字幕生成，支援中英文，含時間戳記

---

## 工作任務狀態查詢

大部分長時間任務使用 Queue 模式，通過以下 API 查詢：
- \`trpc.proStudio.jobStatus\`：查詢任務狀態（pending/processing/completed/failed）
- \`trpc.proStudio.checkApiKey\`：確認 API Key 是否設定
`,
    tags: [
      "TTS",
      "音樂生成",
      "聲音克隆",
      "說話頭像",
      "Demucs",
      "ElevenLabs",
      "音訊分離",
    ],
    difficulty: "intermediate",
    readingMinutes: 14,
    publishedAt: "2026-04-07T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "mg-004",
    category: "model-guide",
    title: "AI Brain 配置系統：5 大引擎維度詳細說明",
    summary:
      "了解 AI Brain 的 5 個維度配置，以及如何根據需求選擇最適合的 LLM 引擎組合。",
    content: `# AI Brain 配置系統

## 什麼是 AI Brain？

AI Brain 是 Healing Studio 的智能核心配置，讓你為平台的不同 AI 功能指定最適合的語言模型（LLM）引擎。進入 **設定 → AI 大腦設定**（/settings/ai-brain）進行配置。

## 5 大引擎維度

### 1. 全站導演（director）
**負責：** 提詞編譯（Elite Prompt Compiler）、導演 AI 對話、多模態生成的主 LLM
- **推薦：** Gemini 2.5 Pro ✦（最高品質提詞）
- **快速選項：** Gemini 2.5 Flash ⚡（速度優先）
- **可選引擎：** Gemini 2.5 Pro / Flash、Gemini 1.5 Pro / Flash、Vertex Gemini 2.5 Pro 🔷、Vertex Llama 3.2 90B

### 2. 新聞過濾（analyst）
**負責：** AI 新聞抓取和摘要過濾
- **推薦：** Gemini 2.5 Flash ⚡（快速，費用低）
- **可選引擎：** Gemini 2.5 Flash / Pro、Gemini 1.5 Flash、Vertex Gemini 2.5 Flash 🔷、Vertex Llama 3.1 405B

### 3. 編譯器（storyteller）
**負責：** 進階提詞編譯、創意敘事增強
- **推薦：** Gemini 2.5 Pro ✦（創意最強）
- **可選引擎：** Gemini 2.5 Pro / Flash、Gemini 1.5 Pro、Vertex Gemini 2.5 Pro 🔷、Vertex Mistral NeMo

### 4. 光球語調（technician）
**負責：** 光球夥伴（Orb）的對話語調和建議生成
- **推薦：** Gemini 2.5 Flash ⚡（即時回應）
- **可選引擎：** Gemini 2.5 Flash / Pro、Gemini 1.5 Flash、Vertex Gemini 2.5 Flash 🔷

### 5. RAG 向量（curator）
**負責：** RAG 記憶系統的查詢和摘要（Pinecone 向量資料庫）
- **推薦：** Gemini 2.5 Flash ⚡（高效率）
- **可選引擎：** Gemini 2.5 Flash / Pro、Gemini 1.5 Pro、Vertex Gemini 2.5 Pro 🔷

## 生成引擎配置（GENERATION_ENGINE_CATALOG）

除 LLM 引擎外，還可以配置生成引擎：

### 圖片引擎選項
| 引擎 | 標籤 | 等級 |
|------|------|------|
| fal/flux-pro-1.1 | Flux Pro 1.1 ✦ | premium |
| fal/flux-dev | Flux Dev | premium |
| fal/flux-schnell | Flux Schnell ⚡ | fast |
| fal/sd3-medium | Stable Diffusion 3 | standard |
| fal/ideogram-v2 | Ideogram V2 | premium |
| vertex/imagen-3 | Imagen 3 (Vertex) 🔷 | premium |

### 影片引擎選項
| 引擎 | 標籤 | 等級 |
|------|------|------|
| fal/kling-v2.1-pro-t2v | Kling V2.1 Pro ✦ | premium |
| fal/wan-t2v-v2.1 | WAN T2V 2.1 | standard |
| fal/kling-v2.1-pro-i2v | Kling V2.1 i2v ✦ | premium |
| fal/minimax-t2v | MiniMax Hailuo | standard |

## Brain API 端點

| API | 說明 |
|-----|------|
| \`trpc.brain.catalog\` | 取得完整引擎目錄 |
| \`trpc.brain.get\` | 取得當前用戶的 Brain 配置 |
| \`trpc.brain.upsert\` | 更新 Brain 配置 |
| \`trpc.brain.pricingSummary\` | 各引擎的成本預估摘要 |
| \`trpc.brain.healthStatus\` | 各引擎連線狀態 |
| \`trpc.brain.pingProviders\` | Ping 各 LLM 提供商 |
| \`trpc.brain.orbVoicePreview\` | 光球語音預覽 |

## 模型等級說明

| 等級 | 說明 | 速度 | 費用 |
|------|------|------|------|
| fast | 快速模型，適合即時互動 | ⚡⚡⚡ | 低 |
| standard | 均衡模型，適合一般任務 | ⚡⚡ | 中 |
| premium | 最高品質，適合最終輸出 | ⚡ | 高 |
`,
    tags: ["AI Brain", "LLM", "Gemini", "Vertex AI", "引擎配置"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-08T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // API 文件
  // ══════════════════════════════════════════════════════

  {
    id: "api-001",
    category: "api-docs",
    title: "tRPC API 完整端點目錄（100+ 端點）",
    summary:
      "Healing Studio 所有 tRPC API 端點的完整文件，包含輸入參數、回傳值和使用範例。",
    content: `# tRPC API 完整端點目錄

## 架構說明

Healing Studio 使用 **tRPC v10** 作為 API 層，前後端共享型別，無需手寫 API 文件。
所有端點通過 \`/api/trpc/*\` 路徑存取。

### 端點類型
- **publicProcedure**：無需認證（匿名可用）
- **protectedProcedure**：需要有效 session
- **adminProcedure**：需要 role = 'admin'
- **brainProcedure**：需要 Brain 配置（AI 生成功能）

---

## 認證（auth）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`auth.me\` | protected | 取得當前用戶資訊（id, name, email, role, remainingGenerations） |
| \`auth.logout\` | protected | 登出，清除 session cookie |

---

## 生成（generate）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`generate.prepareJob\` | protected | 準備生成任務，扣除點數，返回 jobId + 引擎資訊 |
| \`generate.multimodal\` | protected | 執行多模態生成（圖片/影片/音訊/語音），返回結果 URL |
| \`generate.jobStatus\` | protected | 查詢後台任務狀態（progress 0–100, message, resultUrl） |

### generate.prepareJob 輸入
\`\`\`typescript
{
  generationType: "image" | "video" | "audio" | "voice" | "multimodal",
  engineOverride?: string,  // 強制指定引擎（可選）
}
\`\`\`

### generate.multimodal 輸入
\`\`\`typescript
{
  prompt: string,
  generationType: "image" | "video" | "audio" | "voice" | "multimodal",
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
  seed?: number,
  negativePrompt?: string,
  vibeCards?: string[],
  temperature?: number,
  // 圖片專用
  styleReferenceUrl?: string,
  vibeReferenceUrl?: string,
  // 影片專用
  firstFrameUrl?: string,
  lastFrameUrl?: string,
  characterRefUrl?: string,
  videoDuration?: number,
  cameraMotion?: string,
  // 音訊專用
  musicStyle?: string,
  isInstrumental?: boolean,
  lyrics?: string,
  audioDuration?: number,
  // 語音專用
  voiceText?: string,
  voiceSpeed?: number,
  voiceStability?: number,
  voiceEmotionType?: string,
  voiceEmotionIntensity?: number,
  // 進階
  vaultCharacterId?: number,
  vaultSceneId?: number,
  fineTunedModelId?: number,
  loraWeight?: number,
}
\`\`\`

---

## 歷史記錄（history）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`history.list\` | protected | 列出用戶生成歷史（支援 limit 參數，預設 50） |
| \`history.bookmarked\` | protected | 列出收藏的歷史記錄 |
| \`history.toggleBookmark\` | protected | 切換書籤狀態（輸入：id, isBookmarked） |
| \`history.rate\` | protected | 評分（輸入：id, rating 1–5） |
| \`history.delete\` | protected | 刪除歷史記錄（輸入：id） |

---

## 精選展示（showcase）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`showcase.list\` | public | LOD 分頁列表（cursor + limit + modality 篩選） |
| \`showcase.getById\` | public | 單件作品詳情（含完整積木解構） |
| \`showcase.trending\` | public | 熱門作品（按讚 × 2 + Fork × 3 排序，最多 8 件） |
| \`showcase.byModality\` | public | 依模態篩選（image/video/audio/voice） |
| \`showcase.byAesthetics\` | public | 依美學標籤搜尋（LIKE 全文搜索） |
| \`showcase.promote\` | protected | 將歷史記錄加入精選（每天限 5 件） |
| \`showcase.myItems\` | protected | 查詢我的精選作品 |
| \`showcase.removeItem\` | protected | 移除我的精選作品（設為 isActive=false） |
| \`showcase.stats\` | public | 精選統計（各模態數量和總讚數） |

---

## 一致性保險庫（vault）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`vault.list\` | protected | 列出所有保險庫項目（支援 itemType 篩選） |
| \`vault.create\` | protected | 新增項目（name, itemType, imageUrl, tags, metadata） |
| \`vault.update\` | protected | 更新項目（id, name, tags, metadata） |
| \`vault.delete\` | protected | 刪除項目（id） |

---

## AI Brain（brain）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`brain.catalog\` | protected | 取得完整引擎目錄（REASONING_MODEL_CATALOG + GENERATION_ENGINE_CATALOG） |
| \`brain.get\` | protected | 取得用戶的 Brain 配置 |
| \`brain.upsert\` | protected | 更新 Brain 配置（各維度模型選擇） |
| \`brain.pricingSummary\` | protected | 各引擎的定價摘要 |
| \`brain.healthStatus\` | protected | 各引擎連線健康狀態 |
| \`brain.pingProviders\` | protected | Ping 各 LLM 提供商的延遲 |
| \`brain.orbVoicePreview\` | protected | 光球語音預覽 |

---

## 模型（models）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`models.myModels\` | protected | 我的 LoRA 微調模型清單 |
| \`models.teamModels\` | protected | 團隊共享模型清單 |
| \`models.create\` | protected | 建立微調模型（觸發 Replicate 訓練） |
| \`models.captionImages\` | protected | 使用 LLM 自動生成訓練圖標註 |
| \`models.toggleVisibility\` | protected | 切換 private / team_shared 可見性 |
| \`models.delete\` | protected | 刪除模型 |

---

## 筆記（notes）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`notes.list\` | protected | 列出所有筆記 |
| \`notes.create\` | protected | 建立筆記（title, content, scriptJson, noteType, scheduledDate） |
| \`notes.update\` | protected | 更新筆記（id + 任意欄位） |
| \`notes.delete\` | protected | 刪除筆記（id） |

---

## 儀表板（dashboard）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`dashboard.myStats\` | protected | 用戶完整統計（成本摘要、最近記錄、按模態分佈、每日趨勢） |

---

## 管理員（admin）

| 端點 | 類型 | 說明 |
|------|------|------|
| \`admin.allUsers\` | admin | 所有用戶清單 |
| \`admin.updateQuota\` | admin | 更新用戶配額（userId, amount） |
| \`admin.usageLogs\` | admin | 所有使用紀錄（limit 預設 100） |
| \`admin.teamCostSummary\` | admin | 團隊成本摘要 |

---

## 特殊端點

| 端點 | 類型 | 說明 |
|------|------|------|
| \`ai.chat\` | protected | AI 聊天（支援 calm/creative/technical 人格） |
| \`director.chat\` | protected | 導演 AI 對話 |
| \`directorPreferences.get\` | protected | 導演偏好設定 |
| \`directorPreferences.update\` | protected | 更新導演偏好 |
| \`evaluate.prompt\` | protected | 評估提詞品質 |
| \`evaluate.suggestChips\` | protected | 推薦靈感晶片 |
| \`news.list\` | public | 新聞清單（分頁） |
| \`news.getById\` | public | 單篇新聞 |

---

## HTTP 端點（非 tRPC）

| 路徑 | 說明 |
|------|------|
| \`GET /api/health\` | 健康檢查，返回 {ok: true, timestamp} |
| \`POST /api/upload\` | 檔案上傳（multipart/form-data） |
| \`GET /api/proxy-download?url=\` | 代理下載（白名單域名） |
| \`GET /api/sse/:jobId\` | Server-Sent Events 生成進度流 |
| \`GET /api/oauth/google/start\` | 開始 Google OAuth |
| \`GET /api/oauth/callback\` | OAuth 回調 |
| \`POST /api/oauth/logout\` | 登出 |
| \`GET /api/oauth/demo/start\` | Demo 模式登入 |
`,
    tags: ["tRPC", "API 文件", "端點", "開發者", "後端"],
    difficulty: "advanced",
    readingMinutes: 20,
    publishedAt: "2026-04-07T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "api-002",
    category: "api-docs",
    title: "資料庫 Schema 完整說明（15 張資料表）",
    summary:
      "Healing Studio 所有資料庫資料表的詳細欄位說明，以 MySQL + Drizzle ORM 實作。",
    content: `# 資料庫 Schema 完整說明

## 技術棧

- **資料庫：** MySQL（建議 MySQL 8.0+）
- **ORM：** Drizzle ORM（TypeScript 原生）
- **Schema 位置：** \`drizzle/schema.ts\`
- **遷移工具：** Drizzle Kit

---

## 主要資料表（15 張）

### 1. users（用戶）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK, auto) | 用戶 ID |
| googleId | varchar(255) | Google OAuth Sub |
| email | varchar(255) | Email |
| name | varchar(255) | 顯示名稱 |
| avatarUrl | text | 頭像 URL |
| role | enum | 'user' / 'admin' |
| remainingGenerations | int | 剩餘生成配額（點數） |
| quotaJson | json | 各模態詳細配額 |
| onboardingDone | boolean | 新手引導是否完成 |
| createdAt | timestamp | 建立時間 |
| updatedAt | timestamp | 更新時間 |

### 2. generationHistory（生成歷史）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 歷史 ID |
| userId | int | 用戶 ID |
| prompt | text | 原始提詞 |
| compiledPrompt | text | AI 編譯後的提詞 |
| generationType | varchar | image/video/audio/voice |
| modality | varchar | 同上，展示用 |
| resultUrl | text | 主要結果 URL |
| thumbnailUrl | text | 縮圖 URL |
| resultData | json | 完整結果資料（含所有模型資訊） |
| rating | tinyint | 1–5 星評分 |
| isBookmarked | boolean | 是否收藏 |
| engineUsed | varchar | 使用的引擎（fal 模型 ID） |
| pointsCost | int | 消耗的點數 |
| createdAt | timestamp | 生成時間 |

### 3. featuredShowcase（首頁精選展示）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 精選 ID |
| generatedItemId | int | 關聯的歷史 ID |
| title | varchar(200) | 精選標題 |
| description | text | 精選描述 |
| imageUrl | text | 展示媒體 URL |
| thumbnailUrl | text | 縮圖 URL |
| originalPrompt | text | 原始提詞 |
| modality | enum | image/video/audio/voice |
| sortWeight | int | 排序權重（管理員設定） |
| likeCount | int | 按讚數 |
| forkCount | int | Fork 數 |
| isActive | boolean | 是否顯示 |
| curatorUserId | int | 提交者 ID |
| vibeParameters | json | 氛圍參數 |
| completelyDeconstructedBlocks | json | 積木解構資料 |
| createdAt | timestamp | 建立時間 |

### 4. backgroundJobs（背景任務）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 任務 ID |
| userId | int | 用戶 ID |
| jobType | varchar | generation/model_training 等 |
| status | enum | queued/processing/completed/failed |
| progress | int | 進度 0–100 |
| progressMessage | text | 進度訊息 |
| resultJson | json | 任務結果 |
| errorMessage | text | 錯誤訊息 |
| startedAt | timestamp | 開始時間 |
| completedAt | timestamp | 完成時間 |

### 5. digitalAssetLibrary（數位資產庫）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 資產 ID |
| userId | int | 用戶 ID |
| name | varchar(255) | 資產名稱 |
| fileUrl | text | 資產 URL |
| fileKey | varchar(500) | 儲存路徑 key |
| fileType | varchar | image/video/audio/voice |
| visibility | enum | private/team_shared |
| metadata | json | 額外元資料 |

### 6. fineTunedModels（LoRA 微調模型）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 模型 ID |
| userId | int | 用戶 ID |
| name | varchar(255) | 模型名稱 |
| description | text | 說明 |
| modelType | enum | image_subject/voice_clone/style_lora |
| status | enum | queued/training/ready/failed |
| triggerWord | varchar | LoRA 觸發詞 |
| loraUrl | text | 訓練完成的 LoRA 模型 URL |
| replicateModelId | varchar | Replicate 模型 ID |
| replicateVersionId | varchar | Replicate 版本 ID |
| visibility | enum | private/team_shared |
| configJson | json | 訓練設定（epochs/lr/batchSize/datasetImages） |
| fileUrl | text | 訓練資料集 URL |

### 7. consistencyVault（一致性保險庫）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 保險庫 ID |
| userId | int | 用戶 ID |
| name | varchar(255) | 名稱 |
| itemType | enum | character/scene |
| imageUrl | text | 參考圖 URL |
| tags | json | 標籤陣列 |
| metadata | json | 元資料（角色描述等） |

### 8. projectNotesCalendar（專案筆記/日曆）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 筆記 ID |
| userId | int | 用戶 ID |
| title | varchar(255) | 標題 |
| content | text | Markdown 內容 |
| scriptJson | json | 腳本格式內容 |
| noteType | enum | note/script/calendar_event |
| scheduledDate | timestamp | 排程日期 |

### 9. customBlocks（自定義積木）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 積木 ID |
| userId | int | 用戶 ID |
| blockName | varchar(100) | 積木名稱 |
| keywords | text | 積木關鍵詞 |
| category | varchar(50) | 分類 |
| modality | varchar(20) | image/video/audio/voice |

### 10. blockCombos（積木組合）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 組合 ID |
| userId | int | 用戶 ID |
| name | varchar(100) | 組合名稱 |
| modality | varchar(20) | 適用模態 |
| blockIds | json | 積木 ID 陣列 |
| customText | text | 額外自定義文字 |

### 11. userAiBrain（用戶 AI Brain 配置）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | Brain ID |
| userId | int (unique) | 用戶 ID |
| directorModel | varchar | 導演 LLM 模型 |
| analystModel | varchar | 分析師 LLM 模型 |
| storytellerModel | varchar | 編譯器 LLM 模型 |
| technicianModel | varchar | 技術師 LLM 模型 |
| curatorModel | varchar | 策展人（RAG）LLM 模型 |
| imageEngine | varchar | 圖片生成引擎 |
| videoEngine | varchar | 影片生成引擎 |
| audioEngine | varchar | 音樂生成引擎 |
| voiceEngine | varchar | 語音生成引擎 |
| multimodalEngine | varchar | 多模態引擎 |

### 12. apiUsageLogs（API 使用記錄）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 記錄 ID |
| userId | int | 用戶 ID |
| requestType | varchar | 請求類型（generate/image/video...） |
| modelId | varchar | 使用的模型 ID |
| promptTokens | int | 輸入 Tokens |
| completionTokens | int | 輸出 Tokens |
| totalTokens | int | 總 Tokens |
| costUsd | decimal | 費用（USD） |
| costPoints | int | 費用（點數） |
| latencyMs | int | 延遲（毫秒） |
| success | boolean | 是否成功 |

### 13. newsArticles（新聞文章）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 新聞 ID |
| title | varchar(500) | 標題 |
| summary | text | 摘要 |
| content | text | 完整內容 |
| sourceUrl | text | 來源 URL |
| imageUrl | text | 封面圖 |
| category | varchar | 分類（ai/tech/art/business） |
| tags | json | 標籤 |
| publishedAt | timestamp | 發布時間 |

### 14. systemSettings（系統設定）
| 欄位 | 類型 | 說明 |
|------|------|------|
| userId | int (PK) | 用戶 ID |
| uiTheme | enum | system/light/dark |
| accentColor | varchar | 強調色 |
| fontScale | enum | small/medium/large |
| reducedMotion | boolean | 減少動畫 |
| defaultModality | enum | image/video/audio/voice |

### 15. userFeedbackReports（回饋報告）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | int (PK) | 回饋 ID |
| userId | int | 用戶 ID |
| title | varchar | 標題 |
| description | text | 詳細說明 |
| category | enum | bug/feature_request/quality_issue/general |
| priority | enum | low/medium/high/critical |
| status | enum | open/in_progress/resolved/closed |

---

## 資料庫遷移

\`\`\`bash
# 生成遷移文件
npx drizzle-kit generate:mysql

# 推送到資料庫（開發用）
npx drizzle-kit push:mysql

# 查看當前 schema
npx drizzle-kit introspect:mysql
\`\`\`
`,
    tags: ["資料庫", "Schema", "MySQL", "Drizzle ORM", "資料表"],
    difficulty: "advanced",
    readingMinutes: 18,
    publishedAt: "2026-04-08T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "api-003",
    category: "api-docs",
    title: "fal.ai API 架構與最佳實踐",
    summary:
      "了解 fal.ai API 的 Queue 架構、認證、代理下載白名單和錯誤處理，快速整合 AI 模型。",
    content: `# fal.ai API 架構與最佳實踐

## API 架構

Healing Studio 使用 fal.ai 作為主要的多模態生成後端。目前整合了：
- **23 個圖片生成模型**（imageStudio 路由）
- **21 個影片生成模型**（videoStudio 路由）
- **多個音訊模型**（proStudio 路由）

### FAL_API_KEY 設定
從 [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) 取得 API Key，格式：\`6xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxx...\`

---

## API 呼叫模式

### 模式一：同步呼叫（fal.run）
適合快速模型（< 30 秒）：
\`\`\`
POST https://fal.run/{model-id}
Authorization: Key {FAL_API_KEY}
Content-Type: application/json
\`\`\`

### 模式二：Queue 非同步（推薦用於圖片/影片/音樂）
1. 提交任務：
   \`\`\`
   POST https://queue.fal.run/{model-id}
   \`\`\`

2. 輪詢狀態（每 3 秒）：
   \`\`\`
   GET https://queue.fal.run/{model-id}/requests/{request_id}/status
   \`\`\`
   狀態值：\`IN_QUEUE\` → \`IN_PROGRESS\` → \`COMPLETED\` / \`FAILED\`

3. 取得結果：
   \`\`\`
   GET https://queue.fal.run/{model-id}/requests/{request_id}
   \`\`\`

### 各模型超時設定
| 類型 | 超時時間 |
|------|---------|
| 圖片生成 | 120 秒 |
| 影片生成 | 300 秒（Veo 3/Sora：480 秒） |
| 視頻增強 | 600 秒（Topaz） |
| TTS/音效 | 90 秒 |
| 音樂生成 | 180 秒 |
| 3D 建模 | 240–300 秒 |

---

## 代理下載白名單（/api/proxy-download）

為了繞過 CORS 限制，後端提供代理下載端點。允許的域名白名單：

\`\`\`
fal.media
cdn.fal.ai
v3.fal.media
storage.googleapis.com
r2.cloudflarestorage.com
amazonaws.com
replicate.delivery
pbxt.replicate.delivery
suno.ai
elevenlabs.io
images.unsplash.com  (Demo 圖片)
www.soundhelix.com   (Demo 音訊)
\`\`\`

使用方式：\`GET /api/proxy-download?url={encoded_fal_url}\`

---

## Demo 模式降級

當 FAL_API_KEY 餘額耗盡或未設定時，系統自動返回 Demo 示範媒體：

**Demo 圖片（Unsplash）：**
- \`https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=1024&q=80\`
- \`https://images.unsplash.com/photo-1686002359940-6a51b0d64f68?w=1024&q=80\`

**Demo 影片（Google CDN）：**
- \`https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4\`
- \`https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4\`

**Demo 音訊（SoundHelix）：**
- \`https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3\`

---

## 錯誤處理

\`\`\`typescript
// TRPCError 錯誤代碼
INTERNAL_SERVER_ERROR  // fal.ai 任務失敗
TIMEOUT               // 超過等待時間
FORBIDDEN             // 配額不足（remainingGenerations <= 0）
NOT_FOUND             // 找不到資源
\`\`\`

## 點數計費規則

- **1 點 ≈ $0.01 USD**（100 點 ≈ $1 USD）
- 點數在 prepareJob 時預先扣除
- 生成失敗時自動退款（\`db.refundUserQuota\`）
- Demo 模式下不扣除點數
`,
    tags: ["fal.ai", "API", "Queue", "代理下載", "錯誤處理", "點數計費"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-09T00:00:00Z",
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
    summary:
      "掌握提詞技術，讓你的 AI 生成效果提升 10 倍。從基礎到進階的完整教學。",
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
- 賽博龐克：\`cyberpunk, neon lights, futuristic\`
- 浮世繪：\`ukiyo-e, traditional Japanese art\`

### 光線類型
- 黃金時刻：\`golden hour, warm sunlight\`
- 霓虹燈：\`neon lights, cyberpunk lighting\`
- 柔光：\`soft light, diffused, gentle\`
- 戲劇光：\`dramatic lighting, chiaroscuro\`
- 逆光：\`backlight, silhouette\`

## Elite Prompt Compiler（AI 提詞編譯器）

Healing Studio 使用 Gemini 自動將你的積木組合編譯成高品質英文提詞。

**編譯器功能：**
1. 將中文積木關鍵詞翻譯為標準英文術語
2. 根據創作模態（圖片/影片）調整提詞結構
3. 加入品質標籤（masterpiece, best quality）
4. 整合 RAG 記憶系統（保持風格一致）
5. 注入角色/場景保險庫描述

**溫度（Temperature）控制：**
- 0.3 → 嚴格準確（適合寫實/商業）
- 0.7 → 均衡（預設）
- 1.2 → 創意隨機（適合藝術探索）

## RAG 記憶系統

透過 Pinecone 向量資料庫，系統記住你的創作偏好：
- 設定 \`PINECONE_API_KEY\` 啟用
- 每次生成後自動更新記憶
- 下次生成時優先使用相似風格
- 3 秒超時，不阻塞主流程

## 中文 vs 英文提詞

| 場景 | 建議語言 |
|------|---------|\
| Kling 影片 | 中文效果更好 |
| 其他大多數模型 | 英文效果更好 |
| Seedream | 中文優化 |
| GPT Image 1.5 | 中英文均佳 |
| Nano Banana（Gemini） | 中英文均佳 |
`,
    tags: ["提詞", "Prompt Engineering", "技術", "AI 編譯器", "RAG"],
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
    title: "一致性保險庫：角色和場景視覺一致性完全教學",
    summary: "使用一致性保險庫在多張圖片和影片中保持角色、場景的視覺一致性。",
    content: `# 一致性保險庫完全教學

## 什麼是一致性保險庫？

一致性保險庫（/vault）是 Healing Studio 的核心功能之一，讓你能夠在不同的創作任務中保持角色或場景的視覺一致性。

## 兩種保險庫類型

### 角色保險庫（Character）
用途：保存角色的參考外觀，確保同一角色在不同圖片/影片中看起來一致。

**適用場景：**
- 漫畫系列：同一主角出現在不同場景
- 短影片系列：同一人物出現在不同集數
- 品牌角色：吉祥物在不同宣傳物件中的一致性

### 場景保險庫（Scene）
用途：保存背景/環境的參考圖，確保同一場景在不同角度或時間看起來一致。

**適用場景：**
- 同一室內場景的不同角度
- 同一城市街道的不同時間（白天/夜晚）
- 同一品牌風格的背景

---

## 使用步驟

### 步驟一：儲存參考圖
1. 前往 **一致性保險庫**（/vault）
2. 點擊「+ 新增」
3. 選擇類型：角色 或 場景
4. 輸入名稱（如：「主角小明」）
5. 貼上參考圖 URL 或上傳圖片
6. 可選：輸入標籤和描述

**API：** \`trpc.vault.create\`

### 步驟二：在創作工作室使用
1. 前往 **創作工作室**（/studio）
2. 在生成設定中找到「一致性保險庫」選項
3. 從下拉選單選擇角色或場景
4. 生成時，選擇的圖片 URL 會自動注入到提詞中

**技術實現：** 生成時，\`vaultCharacterId\` 和 \`vaultSceneId\` 被傳入 \`generate.multimodal\`，伺服器從保險庫取得圖片 URL 並注入提詞。

### 步驟三：結合微調模型
對於更高的一致性需求，可以同時使用：
1. 保險庫參考圖（提供外觀參考）
2. LoRA 微調模型（強化角色特徵學習）

在「角色鍛造所」訓練 LoRA，並在生成時同時指定 \`fineTunedModelId\`。

---

## 技巧與建議

### 最佳參考圖選擇
- 清晰、正面、無遮擋的主體
- 1024×1024 或更高解析度
- 背景簡單（白色/純色背景最佳）
- 避免特殊角度或藝術風格，選用「標準」視角

### 多角度參考
保存同一角色的多張參考圖：
- 正面圖
- 側面圖
- 背面圖
在不同生成任務中選用相應角度的參考圖

### 場景一致性技巧
- 保存場景的「基準圖」作為固定參考
- 用提詞描述變化（時間、光線）
- 場景 URL 注入後，模型會保持建築/佈局一致

---

## API 參考

\`\`\`typescript
// 新增保險庫項目
trpc.vault.create.mutate({
  name: "主角小明",
  itemType: "character",
  imageUrl: "https://...",
  tags: ["男性", "現代", "短髮"],
  metadata: { description: "約 25 歲的科技公司工程師" }
})

// 使用保險庫生成
trpc.generate.multimodal.mutate({
  prompt: "小明在辦公室工作",
  generationType: "image",
  vaultCharacterId: 5,  // 角色 ID
  vaultSceneId: 12,     // 場景 ID（可選）
})
\`\`\`
`,
    tags: ["一致性保險庫", "角色一致性", "場景一致性", "LoRA", "進階技術"],
    difficulty: "intermediate",
    readingMinutes: 10,
    publishedAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "tech-003",
    category: "technique",
    title: "ControlNet 進階控制：OpenPose、Canny、Depth 完全教學",
    summary:
      "使用 ControlNet 精確控制圖片的姿勢、構圖和風格，讓 AI 按你的要求生成。",
    content: `# ControlNet 進階控制教學

## 什麼是 ControlNet？

ControlNet 是一種讓你精確控制 AI 生成結果的技術。透過提供「控制圖」（如骨架姿勢圖、邊緣輪廓圖），AI 會按照控制圖的結構生成圖片。

在 Healing Studio 圖片創作室中，**Stable Diffusion 3.5 Large** 模型支援 ControlNet 控制。

## 使用 DWPose 提取骨架

1. 前往 **圖片創作室**
2. 選擇「**DWPose 骨架偵測**」工具
3. 上傳包含人物的參考圖
4. DWPose 返回骨架姿勢圖（JSON 格式的關節座標 + 視覺化圖片）
5. 複製骨架圖 URL

**API：** \`trpc.imageStudio.dwPose\`

## ControlNet 類型

在 **SD 3.5 Large + ControlNet** 工具中選擇：

### OpenPose（骨架姿勢）
- **輸入：** DWPose 生成的骨架圖
- **效果：** AI 按照骨架姿勢生成人物
- **適合：** 固定動作姿勢、多圖姿勢一致

### Canny（邊緣輪廓）
- **輸入：** 原圖（系統自動提取邊緣）
- **效果：** 保留構圖輪廓，改變風格
- **適合：** 線稿上色、構圖保留

### Depth（深度圖）
- **輸入：** 原圖（系統自動提取深度）
- **效果：** 保留 3D 空間關係
- **適合：** 場景重建、視角保持

### Scribble（塗鴉草稿）
- **輸入：** 手繪草稿圖
- **效果：** 按草稿生成精細圖片
- **適合：** 從草稿到成品的快速原型

## 參數設定

**API：** \`trpc.imageStudio.stableDiffusion35\`

\`\`\`typescript
{
  prompt: "一位年輕女性，坐在咖啡廳",
  negative_prompt: "ugly, low quality",
  image_url: "骨架圖 URL",  // ControlNet 輸入
  control_net_type: "openpose",  // openpose/canny/depth/scribble
  lora_url: "LoRA 模型 URL",  // 可選：自定義 LoRA
  guidance_scale: 7.5,
  num_steps: 28,
}
\`\`\`

## 強度建議

| 使用場景 | 建議強度 |
|---------|---------|
| 精確姿勢控制 | 0.8–1.0 |
| 輕微引導 | 0.4–0.6 |
| 風格自由 | 0.2–0.3 |

## LoRA 整合

在 SD ControlNet 中可以同時使用自定義 LoRA：
1. 在「角色鍛造所」訓練 LoRA 模型
2. 取得 loraUrl
3. 在 stableDiffusion35 中傳入 lora_url 和觸發詞

**API：** \`trpc.imageStudio.sdLora\`（純 LoRA 生成，不含 ControlNet）
`,
    tags: ["ControlNet", "OpenPose", "DWPose", "Canny", "Depth", "SD 3.5"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "tech-004",
    category: "technique",
    title: "LoRA 模型訓練：角色鍛造所完整教學",
    summary:
      "從上傳訓練資料到取得可用的 LoRA 模型，完整說明角色鍛造所的訓練流程。",
    content: `# LoRA 模型訓練完整教學

## 什麼是 LoRA？

LoRA（Low-Rank Adaptation）是一種輕量級的模型微調技術。通過訓練少量參數，讓 AI 模型「記住」你的特定角色、物品或風格，並在生成時能夠精確再現。

---

## 前置準備

### 1. 設定 Replicate API Token
\`\`\`
REPLICATE_API_TOKEN=r8_your_token_here
\`\`\`
從 [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) 取得

### 2. 準備訓練圖片

**數量：** 建議 10–20 張（最少 3 張）

**圖片要求：**
- 解析度：512×512 以上（建議 1024×1024）
- 格式：JPG、PNG
- 主體清晰，無嚴重遮擋
- 多角度：正面、側面、3/4 側、背面等

**角度分類（Healing Studio 支援）：**
- \`front\`：正面
- \`side\`：側面
- \`back\`：背面
- \`expression\`：表情特寫
- \`other\`：其他角度

---

## 訓練步驟

### 步驟一：建立模型
1. 前往 **角色鍛造所**（/models）
2. 點擊「新增模型」
3. 填入：
   - 模型名稱（如：「小明角色」）
   - 模型類型：\`image_subject\`（人物/物件）/ \`style_lora\`（風格）/ \`voice_clone\`
   - **觸發詞**（Trigger Word）：如 \`xiaoMing_char\`（用於生成時激活）

### 步驟二：上傳訓練圖
1. 上傳所有訓練圖片
2. 為每張圖選擇角度標記
3. 可選：讓 AI 自動生成圖片標註（\`trpc.models.captionImages\`）
   - AI 使用 Gemini 視覺模型分析圖片
   - 自動生成詳細英文描述
   - 每張約 3–5 秒

### 步驟三：設定訓練參數
| 參數 | 建議值 | 說明 |
|------|--------|------|
| Epochs | 20–30 | 訓練輪數（越多越精準，但時間更長） |
| Learning Rate | 0.0001 | 學習率（預設值通常最佳） |
| Batch Size | 4 | 批次大小（3 張以下圖片建議設 1） |

### 步驟四：開始訓練
點擊「開始訓練」後：
1. 系統調用 \`trpc.models.create\`
2. 伺服器在背景調用 Replicate API
3. 訓練任務進入 Queue
4. 狀態：\`queued\` → \`training\` → \`ready\` / \`failed\`

---

## 訓練時間

| 圖片數量 | 大約時間 |
|---------|---------|
| 3–5 張 | 10–20 分鐘 |
| 10–15 張 | 30–60 分鐘 |
| 20 張 | 60–120 分鐘 |

---

## 使用訓練好的模型

### 在創作工作室使用
1. 回到角色鍛造所，等待狀態變為 \`ready\`
2. 點擊「套用到創作工作室」
3. 系統自動將模型 ID 和觸發詞帶入創作工作室
4. 在提詞中包含觸發詞（系統自動附加）
5. 生成時模型自動激活

### 在圖片創作室使用（SD LoRA）
1. 點擊「套用到圖片創作室」
2. 系統帶入 LoRA URL
3. 使用 \`trpc.imageStudio.sdLora\` 生成
4. 在提詞中加入觸發詞

### 在影片工作室使用
1. 點擊「套用到影片工作室」
2. 系統帶入 LoRA 資訊
3. 配合角色保險庫提升一致性

---

## 團隊共享

訓練完成的模型可以共享給團隊：
1. 點擊「分享到團隊」按鈕
2. 可見性切換為 \`team_shared\`
3. 分享時退回 3 點配額（\`refundUserQuota\`）
4. 所有團隊成員可在「角色鍛造所 → 團隊模型」中看到並使用

**API：** \`trpc.models.toggleVisibility\`
`,
    tags: ["LoRA", "模型訓練", "Replicate", "角色鍛造所", "微調"],
    difficulty: "advanced",
    readingMinutes: 14,
    publishedAt: "2026-04-11T00:00:00Z",
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
    summary:
      "從創意發想到最終影片輸出，使用 Healing Studio 完成一個完整影片創作項目的全流程指引。",
    content: `# 完整影片創作流程

## 全流程概覽（約 1.5 小時）

\`\`\`
導演 AI → 概念圖 → 圖生影 → 畫質優化 → 配音配樂 → 組合輸出
（5 min） （15 min）（30 min）（15 min）（15 min） （10 min）
\`\`\`

---

## 第一步：創意發想（5 分鐘）

### 使用 AI 導演
1. 前往**導演 AI**（/director）
2. 描述你的創作想法（例如：「我想做一個關於春天花開的短影片，30 秒，溫暖治癒」）
3. 導演 AI 會：
   - 詢問目標受眾和用途
   - 提議分鏡結構
   - 推薦適合的音樂風格
   - 建議各場景的攝影角度
4. 保存腳本到**專案筆記**（/notes）
   - 使用 \`trpc.notes.create\`，noteType = 'script'

---

## 第二步：概念圖生成（15 分鐘）

### 使用圖片創作室
1. 根據腳本每個場景，前往**圖片創作室**（/image-studio）
2. 推薦模型：
   - 快速原型：**Nano Banana 2**（Gemini 3.1 Flash，10 秒內）
   - 高品質：**Nano Banana Pro** 或 **Flux 2 Pro Edit**
   - 特定角色：搭配**一致性保險庫**
3. 滿意的概念圖：
   - 在生成歷史中加書籤（\`trpc.history.toggleBookmark\`）
   - 或儲存到**數位資產庫**（\`trpc.assets.*\`）

---

## 第三步：關鍵幀圖生影（30 分鐘）

### 使用影片工作室 → 圖生影
1. 挑選最滿意的概念圖作為首幀
2. 根據場景選擇適合的模型：

| 場景類型 | 推薦模型 | 特點 |
|---------|---------|------|
| 中文人物場景 | Kling 2.1 I2V | 中文語意最強 |
| 自然風景 | Wan 2.1 I2V 720p | 物理動態出色 |
| 電影商業感 | Runway Gen4 Turbo | 電影級品質 |
| 動畫風格 | PixVerse 4.5 I2V | 動態生動 |

3. 可選：設定結束幀（Kling 支援首尾幀控制）

**API：** \`trpc.videoStudio.klingImageToVideo\` / \`wanImageToVideo\` / \`runwayImageToVideo\`

---

## 第四步：畫質優化（10 分鐘）

### 使用影片工作室 → 畫質優化

1. **超分辨率（必做）：**
   - 工具：ByteDance Video Upscaler
   - 效果：解析度提升 2x–4x
   - **API：** \`trpc.videoStudio.videoUpscale\`

2. **補幀（選做）：**
   - 工具：RIFE v4.6
   - 效果：24fps → 48fps 或 60fps，消除卡頓
   - **API：** \`trpc.videoStudio.frameInterpolation\`

3. **專業修復（高階）：**
   - 工具：Topaz Video Enhance
   - 效果：4K 輸出，細節恢復
   - **API：** \`trpc.videoStudio.topazEnhance\`（超時 600 秒）

---

## 第五步：配音配樂（15 分鐘）

### 使用音樂配音創作室（/pro-studio）

1. **背景音樂：**
   - textToMusic：輸入風格描述（如「輕柔的鋼琴曲，治癒，60 BPM，C 大調」）
   - **API：** \`trpc.proStudio.textToMusic\`

2. **音效（可選）：**
   - soundEffects：輸入描述（如「春天鳥鳴聲，3 秒」）
   - **API：** \`trpc.proStudio.soundEffects\`

3. **旁白（可選）：**
   - ElevenLabs TTS 或 Qwen TTS
   - **API：** \`trpc.proStudio.elevenLabsTTS\` / \`trpc.proStudio.qwenTTS\`

---

## 第六步：匯出與分享

1. 在**生成歷史**中找到所有素材，下載所需
2. 使用外部影片編輯軟體組合（推薦：CapCut、DaVinci Resolve）
3. 加入最終的音樂和旁白
4. 將滿意的最終成品加入**首頁精選**（\`trpc.showcase.promote\`，最多 5 件/天）

---

## 費用估算

| 步驟 | 費用估計 |
|------|---------|
| 概念圖（5 張，Nano Banana Pro） | ~$0.05 |
| 圖生影（3 個場景，Kling 2.1） | ~$1.05 |
| 畫質優化（ByteDance Upscaler） | ~$0.15 |
| 補幀（RIFE） | ~$0.05 |
| 背景音樂（Sonauto） | ~$0.10 |
| TTS 旁白（ElevenLabs） | ~$0.05 |
| **合計** | **約 $1.50** |
`,
    tags: ["工作流程", "影片製作", "完整流程", "導演 AI", "圖生影"],
    difficulty: "intermediate",
    readingMinutes: 15,
    publishedAt: "2026-04-09T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "wf-002",
    category: "workflow",
    title: "圖片系列創作工作流程：保持角色一致性",
    summary:
      "如何使用保險庫 + LoRA + 多圖參考的組合，在系列圖片中保持完美的角色一致性。",
    content: `# 圖片系列創作：角色一致性工作流程

## 適用場景

- 漫畫/圖文故事系列
- 品牌吉祥物的不同情境展示
- 電商商品的多角度展示
- AI 影片分鏡概念圖

---

## 三種一致性方案

### 方案 A：保險庫參考（快速，中等一致性）

**耗時：** 10 分鐘設定 + 即刻可用

1. 準備最佳角色參考圖（1–3 張）
2. 儲存到**一致性保險庫** → 角色類型
3. 每次生成時，在設定中選擇該角色
4. 建議搭配的模型：**Nano Banana Pro**（Gemini 多圖參考最強）

**一致性評分：★★★☆☆**

---

### 方案 B：LoRA 微調（中等時間，高一致性）

**耗時：** 準備 30 分鐘 + 訓練 30–60 分鐘

1. 收集 10–20 張角色參考圖（多角度）
2. 在**角色鍛造所**建立 LoRA 模型
3. 等待訓練完成（狀態：ready）
4. 使用 \`trpc.imageStudio.sdLora\` 生成
5. 提詞中加入觸發詞

**一致性評分：★★★★☆**

---

### 方案 C：保險庫 + LoRA 組合（最高一致性）

**耗時：** 設定 + 訓練共 1–2 小時

1. 完成 LoRA 訓練
2. 同時設定一致性保險庫
3. 生成時：
   - 使用 SD 3.5 + ControlNet（姿勢控制）
   - 加入 LoRA 模型（特徵強化）
   - 保險庫圖片作為視覺參考

**一致性評分：★★★★★**

---

## 系列圖片生成技巧

### 固定種子（Seed）
在 nanoBanana2/Pro 中指定相同的 seed：
- 相同種子可產生更相似的圖片風格
- 但只改變提詞，不能保證角色不變

### 多圖參考（Nano Banana Pro 特有功能）
\`\`\`typescript
trpc.imageStudio.nanoBananaPro.mutate({
  prompt: "主角小明，坐在圖書館閱讀",
  image_urls: [
    "保險庫角色參考圖 URL 1",
    "保險庫角色參考圖 URL 2",
    "上一張生成結果 URL",  // 使用最新生成圖作為參考
  ],
  aspect_ratio: "16:9",
})
\`\`\`
**關鍵：** 將上一張成功生成的圖片 URL 也加入參考，形成「接力鏈」。

### 批量生成策略
1. 先生成 5–10 張候選
2. 選出最接近期望的 1–2 張
3. 以選出的圖片為參考再生成下一批
4. 逐步收斂，提高一致性

---

## 精選展示提交

完成系列作品後，可以加入首頁精選：
1. 在**生成歷史**找到最佳作品
2. 點擊「加入精選」按鈕
3. 填入標題和描述
4. **API：** \`trpc.showcase.promote\`
5. 每天最多提交 5 件
`,
    tags: ["角色一致性", "系列創作", "LoRA", "保險庫", "多圖參考"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-11T00:00:00Z",
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
    summary:
      "Google 最新影片生成模型 Veo 3 支援原生音頻生成，生成的影片自帶配音和音效。",
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

前往**影片工作室 → 文生影**，選擇「Google Veo 3」模型（\`trpc.videoStudio.veo3TextToVideo\`）。

提詞技巧：
- 在提詞中描述聲音元素：\`配合輕柔的鋼琴音樂\`
- 描述環境音：\`海浪聲、鳥鳴\`
- 模型會自動根據場景生成相應的音效

超時設定：480 秒（8 分鐘）

## 費率

約 $1.50–2.00 / 8 秒影片（較高端，建議在確認需求後使用）
`,
    tags: ["Veo 3", "Google", "影片生成", "AI 新聞", "原生音頻"],
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

## 在 Healing Studio 中的位置

- **文生影：** 影片工作室 → 文生影 → Kling 2.1 Standard T2V
  - **API：** \`trpc.videoStudio.klingTextToVideo\`
  - **FAL 模型：** \`fal-ai/kling-video/v2.1/standard/text-to-video\`

- **圖生影：** 影片工作室 → 圖生影 → Kling 2.1 Standard I2V
  - **API：** \`trpc.videoStudio.klingImageToVideo\`
  - **FAL 模型：** \`fal-ai/kling-video/v2.1/standard/image-to-video\`

## 使用建議

- 提詞可使用中文，效果比英文更好
- 描述具體的動作和場景細節（如「輕風吹動頭髮，陽光灑落」）
- 比例建議：16:9（橫屏）或 9:16（直屏/Reels）
- 時長：5 秒（預設）或 10 秒
`,
    tags: ["Kling", "快手", "影片生成", "AI 新聞"],
    difficulty: "beginner",
    readingMinutes: 3,
    publishedAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "news-003",
    category: "ai-news",
    title: "3D 建模新世代：Trellis 2、HunYuan3D v3、Rodin 全面整合",
    summary:
      "Healing Studio 圖片創作室整合 5 種最新 3D 建模模型，從單張圖片生成電影級 3D 模型。",
    content: `# 3D 建模新世代

## Healing Studio 整合的 5 種 3D 模型

### 1. Trellis 2（fal-ai/trellis-2）
- 從**單張圖片**生成高品質 3D GLB 模型
- 支援 PBR 材質（金屬度、粗糙度）
- 輸出格式：GLB（可直接在 Three.js 中使用）
- **API：** \`trpc.imageStudio.trellis2\`

### 2. SAM 3D Objects（fal-ai/sam-3/3d-objects）
- 使用 Segment Anything Model 3D
- 自動分割場景中的每個物件並分別重建 3D
- 適合從**複雜場景**中提取多個 3D 物件
- **API：** \`trpc.imageStudio.sam3dObjects\`

### 3. HunYuan3D v3（fal-ai/hunyuan3d-v3/image-to-3d）
- 騰訊混元最強 3D 模型
- 電影級精度，細節豐富
- 支援高解析度紋理貼圖
- **API：** \`trpc.imageStudio.hunyuan3d\`

### 4. Rodin（fal-ai/hyper3d/rodin）
- 支援**文字 + 圖片雙輸入**生成 3D
- 可只輸入文字描述就生成 3D
- Hyper 3D 技術，速度快
- **API：** \`trpc.imageStudio.rodin3d\`

### 5. HunYuan World（fal-ai/hunyuan_world/image-to-world）
- 將單張圖片擴展為**完整 3D 世界場景**
- 不只是物件，而是整個環境
- 可用於 VR/AR 場景製作
- **API：** \`trpc.imageStudio.hunyuanWorld\`

---

## 3D 輸出格式說明

| 格式 | 說明 | 用途 |
|------|------|------|
| GLB | 二進制 GLTF | Three.js、Babylon.js、Blender |
| GLTF | 文字格式 GLTF | Web 3D 展示 |
| OBJ | 傳統 3D 格式 | 3ds Max、Maya、Cinema 4D |

---

## 實際應用案例

- **電商產品展示：** 上傳商品圖 → Trellis 2 → 360° 3D 展示
- **角色模型：** 上傳角色概念圖 → HunYuan3D v3 → 可動角色模型
- **場景建構：** 上傳場景圖 → HunYuan World → VR 場景
- **物件庫：** 一張照片生成一個可用 3D 資產
`,
    tags: ["3D 建模", "Trellis 2", "HunYuan3D", "Rodin", "AI 新聞"],
    difficulty: "intermediate",
    readingMinutes: 6,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 補充：全站元件說明
  // ══════════════════════════════════════════════════════

  {
    id: "gs-005",
    category: "getting-started",
    title: "全站關鍵元件說明：光球夥伴、視覺靈魂、思維島鏈",
    summary:
      "Healing Studio 獨特的 UI/UX 元件完整說明，包含光球夥伴、生成進度動畫、環境音效系統。",
    content: `# 全站關鍵元件說明

## 🔮 光球夥伴（ProactiveOrbWidget）

光球是 Healing Studio 的核心 AI 陪伴元件，位於創作工作室右下角。

### 功能
- **主動提示：** 根據你的閒置時間和創作狀態，主動給予靈感建議
- **提詞建議：** 分析當前積木組合，推薦相關關鍵詞
- **語音支援：** 連接 AI Brain 的「光球語調」引擎
- **模態感知：** 根據不同模態（圖片/影片/音訊）給予對應建議

### 光球語調配置
在 **設定 → AI 大腦設定** 中配置光球語調引擎（\`technician\` 維度），可選 Gemini 2.5 Flash 或 Pro。

---

## 🎭 視覺靈魂（Visual Soul / Visual Soul 3D）

生成完成後，結果會以「視覺靈魂」的方式展示：
- 圖片：以帶 glow 效果的浮動卡片呈現
- 影片：可播放的影片播放器
- 3D 模型：Three.js 渲染的可旋轉 3D 展示

### VisualSoulInvitation
當有 showcase 作品被「Fork」時，系統會彈出視覺靈魂邀請窗，讓用戶直接在創作工作室復現該作品的配方（積木 + 提詞）。

---

## 🏝️ 思維島鏈（ThoughtIslandChain）

生成進度的視覺化動畫系統。在生成過程中，系統推送一系列「思考事件」（thought-update），以動態卡片鏈的方式呈現：

1. ✅ 安全檢查
2. 📝 提詞編譯
3. ⚖️ 視覺權重計算
4. 🎨 開始生成（顯示引擎名稱）
5. 🎉 生成完成
6. 💡 點數扣除

每個思考事件通過 **Server-Sent Events（SSE）** 從 \`/api/sse/:jobId\` 端點推送到前端，實現即時更新。

---

## 🌊 環境音效引擎（AmbientSoundEngine）

首頁和創作工作室的背景音效系統：
- 自動偵測場景模式（如夜空、晨光）
- 播放對應的治癒系環境音（鳥鳴、海浪、下雨等）
- 可以靜音或調整音量

---

## 🎨 場景切換器（SceneSwitcher）

首頁的視覺主題切換器：
- **nightSky**（夜空）：深藍星空背景
- **morning**（晨光）：溫暖橙色漸變
- 其他場景：根據配置自動適配卡片顏色、文字顏色

---

## 💧 漣漪轉場（RippleTransition）

頁面/場景切換時的流體漣漪動畫效果，使用 CSS clip-path 動畫實現。

---

## 🔔 AuthExpiredModal

當 JWT session 過期時，自動彈出認證過期提醒：
- Google 登入按鈕（\`getLoginUrl()\`）
- Demo 登入選項（\`getDemoLoginUrl()\`）
- 「稍後再說」關閉按鈕

透過 \`emitAuthExpiredDebounced()\`（防抖 2 秒）觸發，防止多個 401 請求重複觸發彈窗。

---

## 🗺️ 導航架構

| 路徑 | 元件 | 認證 |
|------|------|------|
| / | Home | 公開 |
| /studio | Studio | 需要登入 |
| /pro-studio | ProStudio | 需要登入 |
| /image-studio | ImageStudio | 需要登入 |
| /video-studio | VideoStudio | 需要登入 |
| /director | DirectorAI | 需要登入 |
| /models | ModelsPage | 需要登入 |
| /history | HistoryPage | 需要登入 |
| /assets | AssetsLibrary | 公開儀表板 |
| /vault | VaultPage | 公開儀表板 |
| /notes | NotesPage | 公開儀表板 |
| /calendar | CalendarPage | 公開儀表板 |
| /shared | SharedSpace | 公開儀表板 |
| /dashboard | DashboardPage | 公開儀表板 |
| /feedback | FeedbackPage | 公開儀表板 |
| /learn | LearnHub | 公開儀表板 |
| /settings | SettingsPage | 公開儀表板 |
| /settings/ai-brain | AiBrainSettings | 需要登入 |
| /admin | AdminPage | 管理員 |
`,
    tags: ["UI 元件", "光球夥伴", "思維島鏈", "SSE", "環境音效", "路由"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "wf-003",
    category: "workflow",
    title: "首頁精選展示系統：如何提交和管理精選作品",
    summary:
      "了解首頁精選（ShowcaseMasonry）的完整運作機制，以及如何將你的最佳作品展示給所有訪客。",
    content: `# 首頁精選展示系統

## 什麼是首頁精選？

首頁精選（Showcase）是 Healing Studio 的公開展示廳，展示平台用戶的優秀 AI 創作。訪客不需要登入就能欣賞精選作品，並可以「Fork」（複製配方）重現類似的創作。

---

## 精選展示架構（ShowcaseMasonry）

首頁以**瀑布流佈局**（Masonry Layout）展示精選：
- **Cursor-based 無限捲動分頁**（每頁 12 件）
- **四種模態篩選**：圖片、影片、音訊、語音
- **熱門排序算法**：\`likeCount × 2 + forkCount × 3\`
- **美學標籤搜尋**：根據 LIKE 全文搜索標題/描述/原始提詞

---

## 提交精選

### 條件
1. 需要有登入帳號（非 Demo 模式）
2. 生成結果需有有效的 resultUrl
3. 每天最多提交 5 件（伺服器強制限制）

### 提交步驟
1. 前往**生成歷史**（/history）
2. 找到想展示的作品
3. 點擊「加入精選」按鈕（★ 圖示）
4. 填寫：
   - **標題**（必填，1–200 字）
   - **描述**（選填，最多 500 字）
5. 確認提交

**API：** \`trpc.showcase.promote\`

### 精選資料自動填充
提交時系統自動從歷史記錄取得：
- 媒體 URL（imageUrl/videoUrl）
- 縮圖 URL
- 原始提詞
- 模態類型
- 生成引擎資訊

---

## 精選管理

### 查看我的精選
在生成歷史頁面可看到「我的精選」分頁。

**API：** \`trpc.showcase.myItems\`

### 移除精選
找到不想展示的作品，點擊移除按鈕。
系統將 \`isActive\` 設為 \`false\`，作品停止在首頁顯示。

**API：** \`trpc.showcase.removeItem\`

---

## 精選排序系統

| 欄位 | 說明 | 權重 |
|------|------|------|
| sortWeight | 管理員手動設定 | 最高優先 |
| likeCount | 按讚數 | × 2 |
| forkCount | Fork 數 | × 3 |
| id | 建立順序 | 最後比較 |

**熱門計算公式：** \`sortWeight DESC → (likeCount × 2 + forkCount × 3) DESC → id DESC\`

---

## Fork 功能（復現精選配方）

當訪客在首頁看到喜歡的作品，可以點擊「Fork」：
1. 系統彈出 \`VisualSoulInvitation\` 窗口
2. 顯示原始積木解構（completelyDeconstructedBlocks）
3. 用戶可以選擇：「直接使用此配方」
4. 創作工作室自動載入相同的積木組合和提詞
5. Fork 數 +1

---

## 公開 API（無需登入）

| API | 說明 |
|-----|------|
| \`showcase.list\` | 分頁列表（cursor + limit + modality） |
| \`showcase.getById\` | 單件詳情 |
| \`showcase.trending\` | 熱門 8 件 |
| \`showcase.byModality\` | 依模態篩選 |
| \`showcase.byAesthetics\` | 依美學標籤搜尋 |
| \`showcase.stats\` | 各模態統計 |

---

## Demo 模式降級

無資料庫時，所有公開 showcase 端點返回空結果：
\`\`\`
{ items: [], nextCursor: undefined }
\`\`\`
首頁仍可正常顯示（ShowcaseMasonry 顯示空狀態），不會崩潰。
`,
    tags: ["精選展示", "ShowcaseMasonry", "Fork", "瀑布流", "無限捲動"],
    difficulty: "beginner",
    readingMinutes: 9,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "api-004",
    category: "api-docs",
    title: "部署指南：Railway + Google Cloud 完整步驟",
    summary:
      "從零到一部署 Healing Studio 到生產環境，包含資料庫、Google OAuth、FAL API 等完整設定步驟。",
    content: `# 部署指南：Railway + Google Cloud

## 技術棧概覽

| 層次 | 技術 | 說明 |
|------|------|------|
| 前端 | React + Vite + TypeScript | 靜態資源 |
| 後端 | Node.js + Express + tRPC | API 伺服器 |
| 資料庫 | MySQL 8.0 | 主要資料庫 |
| ORM | Drizzle ORM | TypeScript ORM |
| 認證 | Google OAuth 2.0 + JWT | Session 管理 |
| 生成 | fal.ai | 多模態 AI 生成 |
| LLM | Google Gemini API | 提詞編譯 + 對話 |
| 向量 DB | Pinecone | RAG 記憶系統 |
| 媒體 | fal.media + CDN | 生成結果儲存 |

---

## 方案一：Railway 部署（推薦）

### 步驟一：設定資料庫
1. 在 Railway 新增 **MySQL** 服務
2. 複製 \`DATABASE_URL\` 環境變數

### 步驟二：部署應用
1. 將 GitHub repo 連接到 Railway
2. Railway 自動偵測 \`package.json\` 的 build 腳本
3. Build 命令：\`npm run build\`
4. Start 命令：\`node dist/index.js\`

### 步驟三：設定環境變數
在 Railway Variables 中設定以下必要變數：
\`\`\`
DATABASE_URL        # Railway MySQL URL（自動提供）
JWT_SECRET          # openssl rand -base64 32 生成
GOOGLE_CLIENT_ID    # Google Cloud Console
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI # https://your-app.railway.app/api/oauth/callback
GEMINI_API_KEY      # aistudio.google.com/apikey
FAL_API_KEY         # fal.ai/dashboard/keys
\`\`\`

### 步驟四：資料庫遷移
\`\`\`bash
# 推送 schema 到 Railway MySQL
DATABASE_URL=mysql://... npx drizzle-kit push:mysql
\`\`\`

### 步驟五：設定自定義網域
1. Railway Settings → Domains
2. 新增你的自定義域名
3. 設置 DNS 的 CNAME 指向 Railway 提供的端點

---

## 方案二：本地開發

### 前置要求
- Node.js 18+
- MySQL 8.0（或使用 Docker）
- pnpm / npm

### 啟動步驟
\`\`\`bash
# 複製環境變數
cp .env.example .env
# 編輯 .env

# 安裝依賴
npm install

# 推送資料庫 schema
npx drizzle-kit push:mysql

# 啟動開發伺服器（前後端同時啟動）
npm run dev
\`\`\`

開發伺服器：http://localhost:3000

---

## 方案三：無資料庫 Demo 模式

無需設定任何資料庫，只需：
\`\`\`
FAL_API_KEY=你的fal金鑰
GEMINI_API_KEY=你的gemini金鑰（可選）
\`\`\`

- 使用 \`/api/oauth/demo/start\` 登入
- 所有資料儲存在記憶體
- 生成功能完全可用（需 FAL_API_KEY）

---

## 生產環境注意事項

### CORS 設定
後端自動根據 HOST header 判斷是否為安全連線：
- HTTPS 域名 → Cookie: \`Secure=true, SameSite=None\`
- HTTP/localhost → Cookie: \`Secure=false, SameSite=Lax\`

### 代理下載安全性
\`/api/proxy-download\` 端點有嚴格的白名單限制，只允許以下域名：
fal.media、cdn.fal.ai、storage.googleapis.com 等（共 10 個域名）

### 健康檢查
Railway 自動使用 \`GET /api/health\` 確認服務運作：
\`\`\`json
{"ok": true, "timestamp": 1776051949610}
\`\`\`

### 背景任務
- **新聞抓取 Cron**：\`server/_core/index.ts\` 中定時執行
- **模型訓練 Worker**：監控 Replicate 訓練任務狀態

---

## Google OAuth 重要設定

### OAuth 同意畫面
在 Google Cloud Console 設定：
- 應用程式名稱：Healing Studio
- 支援電子郵件
- 授權域名：你的 Railway/生產域名

### 已授權重新導向 URI
必須精確匹配（包含結尾的 /api/oauth/callback）：
\`\`\`
https://your-app.railway.app/api/oauth/callback
http://localhost:3000/api/oauth/callback  (開發用)
\`\`\`
`,
    tags: ["部署", "Railway", "Google Cloud", "MySQL", "環境設定"],
    difficulty: "advanced",
    readingMinutes: 15,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 全站完整知識庫文件
  // ══════════════════════════════════════════════════════

  {
    id: "mg-full-models",
    category: "model-guide",
    title: "全模型完整對照表：圖片 / 影片 / 音頻 / 語音 / 3D",
    summary:
      "Healing Studio 所有 AI 生成模型的完整規格對照，包含點數費用、等級、特點與最佳使用場景。",
    content: `# 全模型完整對照表

本文件列出 Healing Studio 平台上所有可用的 AI 生成模型，幫助你選擇最適合的模型。

---

## 一、圖片生成（Text-to-Image）

| 模型 | 等級 | 點數/張 | 特點 |
|------|------|---------|------|
| **Flux Pro 1.1** | Premium | 4 | 最高品質，細節精準，適合最終成品 |
| **Flux Dev** | Premium | 3 | 開發者版，速度較快，品質接近 Pro |
| **Flux Schnell** | Economy | 1 | 超快速，適合快速預覽和測試提示詞 |
| **SD3 Medium** | Standard | 2 | 穩定擴散第三代，風格多元 |
| **AuraFlow** | Standard | 2 | 獨特風格，適合藝術創作 |
| **Ideogram V2** | Premium | 4 | 擅長文字排版，適合海報/LOGO |
| **Imagen 3 (Gemini)** | Premium | 4 | Google 最新模型，自然寫實 |
| **Imagen 3 Fast** | Economy | 1 | Imagen 3 快速版，適合預覽 |
| **Imagen 3 (Vertex)** | Premium | 5 | 企業級 API，最高穩定性 |

### 選擇建議
- **快速測試**：用 Flux Schnell（1點）或 Imagen 3 Fast（1點）
- **最終成品**：用 Flux Pro 1.1（4點）或 Imagen 3（4點）
- **有文字需求**：用 Ideogram V2（4點）
- **預算有限**：用 SD3 Medium（2點）或 AuraFlow（2點）

---

## 二、圖片編輯（Image-to-Image）

| 模型 | 等級 | 點數/次 | 特點 |
|------|------|---------|------|
| **Flux Dev i2i** | Premium | 3 | 保留構圖的風格轉換 |
| **SD3 Medium i2i** | Standard | 2 | 基礎風格轉換 |
| **IP-Adapter FaceID** | Premium | 4 | 臉部一致性保持，角色換裝 |
| **ControlNet Union** | Standard | 3 | 深度/邊緣/骨架多層控制 |
| **AuraSR 超解析度** | Economy | 1 | 圖片放大增強，無損提升 |
| **RemBG 去背** | Economy | 1 | 智能去除背景 |

---

## 三、影片生成（Text-to-Video）

| 模型 | 等級 | 點數/5秒 | 點數/秒 | 特點 |
|------|------|----------|---------|------|
| **Kling V2.1 Pro** | Ultra | 49 | 9.8 | 最高品質，動態流暢 |
| **Kling V1.5 Pro** | Premium | 35 | 7.0 | 穩定品質，性價比佳 |
| **MiniMax Hailuo** | Standard | 20 | 3.3 | 高性價比，適合批量 |
| **Luma Dream Machine** | Premium | 30 | 6.0 | 夢境感強，藝術風格 |
| **WAN T2V 2.1** | Standard | 15 | 3.0 | 基礎影片，經濟實惠 |
| **CogVideoX 5B** | Standard | 15 | 2.5 | 開源方案，穩定可靠 |
| **Veo 2 (Gemini)** | Ultra | 35 | 7.0 | Google Veo 2，高品質 |
| **Veo 3 Preview** | Ultra | 50 | 10.0 | 最新預覽版，需申請 |

### 選擇建議
- **頂級品質**：Kling V2.1 Pro 或 Veo 2
- **性價比首選**：MiniMax Hailuo 或 WAN T2V 2.1
- **藝術風格**：Luma Dream Machine
- **預算測試**：CogVideoX 5B

---

## 四、圖片轉影片（Image-to-Video）

| 模型 | 等級 | 點數/5秒 | 特點 |
|------|------|----------|------|
| **Kling V2.1 Pro i2v** | Ultra | 55 | 最高品質，完美銜接 |
| **Kling V1.5 Pro i2v** | Premium | 40 | 穩定品質 |
| **Runway Gen3 Turbo** | Premium | 40 | 快速生成 |
| **Stable Video** | Standard | 15 | 基礎方案，每25幀 |
| **MiniMax i2v** | Standard | 22 | 高性價比 |
| **Luma i2v** | Premium | 32 | 夢境風格 |

---

## 五、音樂/音頻生成

| 模型 | 等級 | 點數 | 單位 | 特點 |
|------|------|------|------|------|
| **Stable Audio** | Premium | 5 | 每30秒 | 高品質純音樂 |
| **AudioLDM 2** | Standard | 3 | 每10秒 | 音效為主 |
| **MMAudio V2** | Standard | 4 | 每15秒 | 多模態音頻 |
| **ACE-Step** | Premium | 8 | 每60秒 | 長音樂片段 |
| **MusicGen** | Standard | 3 | 每15秒 | Meta 開源 |
| **Suno V4** | Premium | 10 | 每首 | 完整歌曲+歌詞 |
| **Suno V3.5** | Standard | 6 | 每首 | 穩定版歌曲 |
| **Lyria 2** | Premium | 8 | 每30秒 | Google 音樂 |
| **ElevenLabs Music** | Premium | 10 | 每30秒 | 高品質音樂 |
| **ElevenLabs 音效** | Standard | 3 | 每次 | 音效片段 |

### 選擇建議
- **完整歌曲**：Suno V4（含歌詞）或 Suno V3.5
- **背景音樂**：Stable Audio 或 ACE-Step
- **音效**：ElevenLabs 音效 或 AudioLDM 2
- **長片段**：ACE-Step（60秒/次）

---

## 六、語音合成（Text-to-Speech）

| 模型 | 等級 | 點數/千字符 | 特點 |
|------|------|------------|------|
| **ElevenLabs V3** | Premium | 4 | 最自然，情感表現力強 |
| **ElevenLabs Multilingual V2** | Premium | 3 | 多語言支援 |
| **ElevenLabs Turbo V2.5** | Economy | 1 | 快速合成 |
| **ElevenLabs Flash V2.5** | Economy | 1 | 極速版 |
| **MetaVoice V1** | Premium | 5 | 高品質語音 |
| **PlayAI TTS** | Premium | 4 | 表現力強 |
| **Kokoro TTS** | Economy | 1 | 輕量級，高效 |
| **Orpheus TTS** | Standard | 2 | 情感豐富 |
| **Dia TTS** | Standard | 2 | 對話式 |
| **Gemini TTS Flash** | Economy | 1 | Google 快速版 |
| **Gemini TTS Pro** | Standard | 2 | Google 專業版 |

### 選擇建議
- **配音/旁白**：ElevenLabs V3 或 Multilingual V2
- **快速測試**：Kokoro TTS 或 ElevenLabs Flash
- **對話場景**：Dia TTS
- **情感表達**：Orpheus TTS

---

## 七、3D 生成

| 模型 | 等級 | 點數/次 | 特點 |
|------|------|---------|------|
| **Trellis 3D** | Premium | 10 | 高品質3D模型 |
| **TripoSR** | Standard | 5 | 快速3D重建 |
| **Stable Zero123** | Standard | 4 | 零樣本3D |

---

## 八、其他工具

| 工具 | 用途 | 點數 |
|------|------|------|
| **MMAudio V2 v2a** | 影片提取/生成配音 | 4 |
| **Whisper** | 語音辨識/字幕生成 | 2 |
| **Kling v2v** | 影片風格轉換 | 35 |
| **Flux LoRA Training** | LoRA 微調訓練 | 50 |

---

## 點數系統說明

- **1 USD ≈ 100 點數**
- 等級費用範圍：Economy(1-2) / Standard(2-5) / Premium(3-10) / Ultra(35-55)
- 影片生成最貴（按秒計費）
- 團隊共享素材可獲得 **2 點數獎勵**
- 可在「AI 大腦設定」自訂每個模態的預設模型
`,
    tags: ["模型", "對照表", "點數", "費用", "選擇指南"],
    difficulty: "beginner",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "wf-full-workflows",
    category: "workflow",
    title: "五大創作工作流程完整指南",
    summary:
      "從影片製作到品牌內容，詳解五種核心工作流程，教你如何串聯各工作室完成專案。",
    content: `# 五大創作工作流程完整指南

學會這五種工作流程，你就能充分利用 Healing Studio 的所有功能。

---

## 工作流程 A：完整影片製作

> 適合製作 15-60 秒的完整影片作品

### 步驟
1. **導演 AI** → 構思腳本（CO-STAR 框架）
   - 選擇「創意型」或「技術型」導演人格
   - 描述你的影片概念，AI 會生成結構化腳本
   - 腳本包含視覺提示詞、語音腳本、音樂風格建議

2. **一鍵發送到工作室**
   - 腳本的 visualPrompt 自動填入提示詞
   - musicVibe 自動設定音樂風格
   - audioScript 用於語音合成

3. **圖片創作室** → 生成關鍵畫面/角色設計
   - 推薦：Flux Pro 1.1（最終成品）或 Flux Schnell（快速測試）
   - 設定一致性保險庫確保角色統一

4. **影片工作室** → 用圖片轉影片
   - 上傳關鍵畫面作為首幀
   - 推薦：Kling V2.1 Pro（最高品質）或 MiniMax（性價比）
   - 選擇 5/10/15 秒時長

5. **音樂配音創作室** → 生成配樂 + 旁白
   - 配樂：Stable Audio 或 Suno V4
   - 旁白：ElevenLabs V3 或 Multilingual V2

6. **數位資產庫** → 統一管理所有素材

### 預估費用
- 經濟方案：~30 點（Schnell + WAN + AudioLDM + Kokoro）
- 標準方案：~80 點（Flux Dev + Kling V1.5 + Stable Audio + ElevenLabs Turbo）
- 頂級方案：~120 點（Flux Pro + Kling V2.1 Pro + Suno V4 + ElevenLabs V3）

---

## 工作流程 B：角色一致性系列

> 適合需要在多張圖片/多部影片中保持同一角色外觀

### 步驟
1. **LoRA 訓練工坊** → 訓練專屬角色模型
   - 上傳 5-15 張角色照片（多角度：正面/側面/背面/表情）
   - AI 自動標註圖片
   - 設定觸發詞（例如：\`sks_character\`）
   - 啟動訓練（約 10-30 分鐘）

2. **角色鍛造所** → 管理模型
   - 查看訓練狀態和配置
   - 可分享給團隊使用

3. **創作工作室** → 使用自訂模型生成
   - 選擇你訓練的 LoRA 模型
   - 在提示詞中加入觸發詞
   - 調整 LoRA 權重（0.5-1.0）

4. **一致性保險庫** → 保存角色定義
   - 儲存角色參考圖
   - 下次生成時可直接注入

---

## 工作流程 C：音樂 + 影片 MV

> 適合製作音樂影片

### 步驟
1. **導演 AI** → 規劃 MV 腳本
   - 選擇「創意型」導演
   - 描述曲風、情緒、視覺意象

2. **音樂配音創作室** → 生成歌曲
   - **Suno V4**：完整歌曲 + 歌詞（10點/首）
   - 也可用 Stable Audio 生成純音樂

3. **圖片創作室** → 生成場景圖
   - 根據歌詞段落設計不同場景
   - 使用 Flux Pro 1.1 確保品質

4. **影片工作室** → 圖片轉影片
   - 為每個場景生成 5-10 秒影片片段
   - 使用 Luma Dream Machine 增加夢境感

5. **專案筆記** → 追蹤製作進度

---

## 工作流程 D：冥想/療癒內容

> 適合製作冥想引導、療癒音頻

### 步驟
1. **導演 AI（沉穩型）** → 規劃引導腳本
   - 選擇「沉穩型」導演人格
   - 設定冥想主題和時長

2. **音樂配音創作室** → 生成環境音
   - **Stable Audio**：自然環境音（森林/海浪/雨聲）
   - 時長建議：30-60 秒循環片段

3. **文字轉語音** → 生成引導旁白
   - **ElevenLabs Multilingual V2**：溫柔中文旁白
   - 語速放慢，語氣平靜

4. **圖片創作室** → 生成視覺化場景
   - 柔和色調的自然場景
   - 使用「寧靜」或「自然」氛圍卡

5. **專注流** → 搭配番茄鐘使用
   - 4-7-8 引導式呼吸
   - 番茄鐘工作/休息循環

---

## 工作流程 E：品牌內容製作

> 適合企業品牌宣傳和行銷內容

### 步驟
1. **導演 AI（技術型）** → 規劃品牌影片結構
   - 選擇「技術型」確保參數精確
   - 描述品牌核心價值和目標受眾

2. **LoRA 訓練** → 訓練品牌風格模型
   - 上傳品牌視覺素材訓練統一風格

3. **圖片創作室** → 生成品牌視覺素材
   - 使用品牌 LoRA 確保風格一致
   - Ideogram V2 適合含文字的設計

4. **影片工作室** → 製作品牌短片
   - 15-30 秒品牌宣傳片
   - 使用首幀控制確保畫面精準

5. **共享空間** → 團隊審核
   - 分享給團隊成員審核
   - 收集回饋後微調

---

## 提示詞最佳實踐

### 圖片提示詞結構
\`\`\`
[主體描述], [環境/背景], [光線], [構圖], [風格], [色調]
\`\`\`
**範例：**
> A serene forest clearing at golden hour, soft volumetric light filtering through ancient trees, cinematic composition, Monet-inspired color palette, 8K ultra detail

### 影片提示詞結構
\`\`\`
[場景描述], [動態/運鏡], [氛圍], [技術參數]
\`\`\`
**範例：**
> Slow dolly zoom into a misty mountain lake, gentle ripples, warm sunrise light, cinematic 24fps, shallow depth of field

### 音樂提示詞結構
\`\`\`
[風格/類型], [情緒], [樂器], [節奏/BPM], [時長]
\`\`\`
**範例：**
> Ambient electronic, ethereal and calming, soft synth pads with gentle piano, 80 BPM, 30 seconds

### 語音提示詞結構
\`\`\`
[語言], [語氣], [語速], [情感]
\`\`\`
**範例：**
> 繁體中文，溫柔引導的語氣，中等語速，帶有安慰感
`,
    tags: ["工作流程", "影片製作", "角色一致性", "MV", "冥想", "品牌"],
    difficulty: "intermediate",
    readingMinutes: 15,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "gs-full-sitemap",
    category: "getting-started",
    title: "全站功能地圖：21 個頁面完整介紹",
    summary:
      "Healing Studio 所有頁面功能的完整索引，從創作工作室到管理後台一覽無遺。",
    content: `# 全站功能地圖

Healing Studio 包含 21 個功能頁面，涵蓋創作、管理、協作、學習的完整生態系。

---

## 🎨 核心創作區

### 1. 創作工作室（/studio）
**平台核心入口**，統一管理四大生成模態。

| 功能 | 說明 |
|------|------|
| 四大模態 | 圖片、影片、音頻/音樂、語音 |
| 氛圍卡 | 8 款 Vibe Cards：寧靜/溫暖/夢幻/自然/復古/極簡/歡愉/神秘 |
| 創意溫度 | 滑桿 0-1，控制 AI 創造力 |
| 種子碼 | 相同種子碼產生相似結果 |
| 參考圖片 | 風格/氛圍/角色三種參考，支援 ControlNet |
| LoRA 模型 | 選擇自訂微調模型 + 權重調節 |
| 生成模式 | 閃電模式（快速）vs 深度精煉（高品質） |

### 2. 音樂配音創作室（/pro-studio）
**專業音頻工作站**，20+ 工具。

- 文字生音樂（Suno, Stable Audio, MusicGen 等）
- 音效生成（ElevenLabs Sound Effects）
- AI 語音合成（11 種 TTS 模型）
- 聲音克隆、說話頭像
- 音訊分離（Demucs）
- 影片配音（ElevenLabs Dubbing）
- 語音轉文字（WhisperX）

### 3. 圖片創作室（/image-studio）
**專業圖片工作站**。

- 文字生圖（9 種模型）
- 圖片編輯（風格轉換、ControlNet、FaceID）
- 超解析度、去背
- 批次生成、多尺寸

### 4. 影片工作室（/video-studio）
**專業影片工作站**。

- 文字轉影片（8 種模型）
- 圖片轉影片（6 種模型）
- 影片轉影片、影片轉音頻
- 首幀/尾幀控制
- 5/10/15 秒時長選擇

---

## 🤖 AI 協作區

### 5. 導演 AI（/director）
CO-STAR 雙引擎導演系統。

- 三種人格：沉穩/創意/技術
- Storyboard 即時面板
- 腳本一鍵發送到工作室
- 腳本微調、模板庫
- 對話持久化

### 6. 光球（全站浮動 Orb）
AI 創作夥伴，在每個頁面都能開啟。

- 三種人格同步導演 AI
- 了解全站所有功能和模型
- 根據當前頁面提供情境建議
- 提示詞優化、功能引導

---

## 🔧 訓練與管理區

### 7. 角色鍛造所（/models）
LoRA 微調模型管理。

### 8. LoRA 訓練工坊（/lora-trainer）
四步驟微調訓練流程。

### 9. 一致性保險庫（/vault）
角色/場景視覺一致性。

---

## 📊 歷史與資產區

### 10. 生成歷史（/history）
所有生成紀錄、書籤、評分。

### 11. 數位資產庫（/assets）
統一管理所有數位資產。

---

## 📝 專案管理區

### 12. 專案筆記（/notes）
筆記 + 腳本 + 日曆事件。

### 13. 創作排程（/calendar）
時間線管理、Google Calendar 整合。

### 14. 共享空間（/shared）
團隊協作與作品展示。

---

## 📈 分析與回饋區

### 15. 儀表板（/dashboard）
使用統計、點數消耗、趨勢分析。

### 16. 回饋中心（/feedback）
Bug 回報、功能建議。

---

## 📚 學習區

### 17. 學習文件（/learn）
教學文章、模型說明、API 文件。

---

## 🧘 身心靈區

### 18. 專注流（/focus-flow）
番茄鐘 + 療癒呼吸 + 想法記錄。

---

## ⚙️ 設定區

### 19. 個人設定（/settings）
導演偏好、帳戶管理。

### 20. AI 大腦設定（/settings/ai-brain）
自訂每個模態的 AI 引擎。

### 21. 管理後台（/admin）
管理員專屬：用戶管理、使用統計。

---

## 💡 快速跳轉指南

| 我想要... | 去哪裡？ |
|-----------|---------|
| 生成一張圖片 | 創作工作室 或 圖片創作室 |
| 製作短影片 | 影片工作室 |
| 生成音樂 | 音樂配音創作室 |
| AI 幫我規劃腳本 | 導演 AI |
| 訓練我的角色模型 | LoRA 訓練工坊 |
| 查看過去的作品 | 生成歷史 |
| 管理所有素材 | 數位資產庫 |
| 學習使用技巧 | 學習文件 |
| 放鬆一下 | 專注流 |
`,
    tags: ["全站地圖", "功能索引", "入門", "導覽"],
    difficulty: "beginner",
    readingMinutes: 10,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "tech-prompt-mastery",
    category: "technique",
    title: "提示詞大師班：四大模態的提示詞撰寫秘訣",
    summary:
      "從圖片到語音，手把手教你寫出高品質的 AI 提示詞，附上大量實際範例。",
    content: `# 提示詞大師班

掌握提示詞是使用 AI 生成工具最重要的技能。本文涵蓋四大模態的提示詞撰寫技巧。

---

## 一、圖片提示詞

### 基本結構
\`\`\`
[主體] + [環境/背景] + [光線] + [構圖] + [風格] + [色調] + [品質關鍵字]
\`\`\`

### 品質關鍵字（加在尾部提升品質）
- \`8K ultra detail, masterpiece, best quality\`
- \`professional photography, award-winning\`
- \`cinematic lighting, volumetric light\`
- \`sharp focus, intricate details\`

### 風格關鍵字
| 風格 | 關鍵字 |
|------|--------|
| 寫實攝影 | \`photorealistic, DSLR, 85mm lens, bokeh\` |
| 油畫 | \`oil painting, impasto, gallery quality\` |
| 水彩 | \`watercolor, soft edges, paper texture\` |
| 動漫 | \`anime style, cel shading, vibrant colors\` |
| 3D 渲染 | \`3D render, octane, unreal engine 5\` |
| 極簡 | \`minimalist, clean, negative space\` |

### 實際範例

**人像攝影：**
> A graceful young woman in a flowing white dress standing in a sunlit meadow, golden hour backlight creating a halo effect, shallow depth of field, 85mm portrait lens, perfectly symmetrical anatomy, flawless proportions, 8K ultra detail

**風景：**
> A serene Japanese zen garden at dawn, raked sand patterns, moss-covered stones, soft morning mist, warm golden light filtering through maple trees, wide angle composition, cinematic color grading, 4K

**產品：**
> A sleek wireless earbuds product shot on a reflective black surface, dramatic rim lighting, clean white background, professional studio setup, commercial photography, ultra sharp focus

### 負面提示詞（避免不良效果）
- \`blurry, low quality, distorted, watermark\`
- \`extra fingers, deformed hands\`（人物專用）
- \`cropped, out of frame\`

---

## 二、影片提示詞

### 基本結構
\`\`\`
[場景描述] + [動態/運鏡] + [氛圍] + [技術參數]
\`\`\`

### 常用運鏡詞彙
| 運鏡 | 描述 | 適用場景 |
|------|------|----------|
| dolly zoom | 鏡頭推近/拉遠 | 強調主體 |
| tracking shot | 跟蹤鏡頭 | 跟隨運動 |
| aerial view | 空拍俯瞰 | 壯闊場景 |
| slow motion | 慢動作 | 戲劇效果 |
| time-lapse | 縮時攝影 | 時間流逝 |
| pan | 水平搖移 | 展示環境 |
| tilt | 垂直搖移 | 展示高度 |

### 實際範例

**自然場景：**
> Slow aerial tracking shot over a misty mountain lake at sunrise, gentle ripples on water surface, warm golden light breaking through clouds, cinematic 24fps, anamorphic lens flare

**人物動態：**
> A dancer performing a graceful spin in slow motion, flowing silk dress creating dynamic shapes, dramatic side lighting, shallow depth of field, 60fps slow motion

**產品展示：**
> Smooth 360-degree rotation around a luxury watch on a marble surface, dramatic lighting revealing metallic reflections, shallow depth of field, commercial style

---

## 三、音樂提示詞

### 基本結構
\`\`\`
[風格/類型] + [情緒] + [樂器] + [節奏/BPM] + [時長]
\`\`\`

### 風格參考
| 類型 | 關鍵字範例 |
|------|-----------|
| 環境音樂 | ambient, atmospheric, ethereal |
| 電子音樂 | electronic, synth-wave, EDM, lo-fi |
| 古典 | orchestral, piano solo, string quartet |
| 流行 | pop, catchy melody, upbeat |
| 搖滾 | rock, electric guitar, driving drums |
| 爵士 | jazz, smooth, saxophone, swing |
| 療癒 | healing, meditation, nature sounds |

### 實際範例

**冥想音樂：**
> Ambient meditation music, gentle flowing water sounds, soft singing bowls, ethereal pad drones, 60 BPM, deeply calming and introspective, 60 seconds

**品牌配樂：**
> Uplifting corporate background music, clean piano with light strings, inspirational and professional, 120 BPM, modern and optimistic, 30 seconds

**遊戲配樂：**
> Epic orchestral fantasy battle theme, full symphony with brass fanfares, intense percussion, building to a heroic climax, 140 BPM, 45 seconds

---

## 四、語音提示詞

### TTS 腳本撰寫技巧
1. **標點控制節奏**：逗號=短停，句號=長停
2. **括號標註情感**：（溫柔地）、（興奮地）
3. **保持自然語序**：避免過於書面的用語
4. **控制長度**：每段 50-100 字最佳

### 實際範例

**冥想引導：**
> （緩慢、溫柔地）現在，請你閉上眼睛。深深地吸一口氣......（停頓三秒）然後，慢慢地吐出來。感受空氣流過你的身體，讓每一個細胞都得到放鬆。

**品牌旁白：**
> （自信、專業地）在科技與人文的交匯點，我們相信創造力的無限可能。這不只是一個工具，這是你的創意夥伴。

**教學解說：**
> （清晰、友善地）歡迎來到 Healing Studio。今天我要帶你完成第一件 AI 創作。首先，點擊左邊的「創作工作室」。
`,
    tags: ["提示詞", "技巧", "圖片", "影片", "音樂", "語音", "教學"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：導演 AI
  // ══════════════════════════════════════════════════════

  {
    id: "deep-director",
    category: "technique",
    title: "導演 AI 深度指南：CO-STAR 框架、雙引擎 RAG 與人格系統",
    summary:
      "深入了解導演 AI 的雙引擎架構、三種人格模式、CO-STAR 腳本框架，以及如何用它規劃完整的多模態創作專案。",
    content: `# 導演 AI 深度指南

## 系統架構概覽

導演 AI 是 Healing Studio 的創意核心中樞，採用**雙引擎 RAG（Retrieval-Augmented Generation）**架構：

\`\`\`
用戶輸入 → 【第一引擎：研究階段】 → 【第二引擎：創意編排】 → CO-STAR 輸出
              (30 秒超時)             (45 秒超時)
\`\`\`

### 第一引擎：人格感知研究
- 搜索平台知識庫（所有模型規格、功能說明）
- 查詢用戶歷史偏好（RAG 記憶系統）
- 根據選定人格調整搜索重點
- 超時：30 秒

### 第二引擎：創意編排
- 接收研究結果 + 用戶請求
- 套用 CO-STAR 框架生成結構化腳本
- 輸出 JSON 格式（含 visualPrompt、audioScript、musicVibe）
- 超時：45 秒

---

## 三種導演人格

### 🧘 沉穩型（Calm）
**核心風格：** 邏輯導向、結構分明、理性分析
- 適合：商業影片、教學影片、技術產品展示
- 輸出特點：精確的技術參數建議、清晰的分鏡結構
- 色調偏好：冷靜色調、中性色彩
- LLM 溫度：較低（偏嚴謹）

### 🎨 創意型（Creative）
**核心風格：** 情感驅動、視覺衝擊、敘事氛圍
- 適合：藝術影片、MV、品牌形象、故事短片
- 輸出特點：富有想像力的視覺描述、情感共鳴的文案
- 色調偏好：大膽配色、對比強烈
- LLM 溫度：較高（偏創意）

### ⚙️ 技術型（Technical）
**核心風格：** 參數精確、最佳實踐、性能優化
- 適合：需要精確控制的專業製作
- 輸出特點：詳細的模型參數建議、成本估算、品質最佳化路徑
- 色調偏好：根據場景精確推薦
- LLM 溫度：最低（偏嚴謹）

---

## CO-STAR 腳本框架

CO-STAR 是導演 AI 輸出的結構化腳本格式：

| 欄位 | 全名 | 說明 |
|------|------|------|
| **C** | Context | 背景設定、情境描述 |
| **O** | Objective | 創作目標和預期效果 |
| **S** | Style | 視覺風格、藝術方向 |
| **T** | Tone | 情感基調、氛圍 |
| **A** | Audience | 目標受眾 |
| **R** | Response | 結構化輸出（含技術參數） |

### CO-STAR 輸出 JSON 結構

\`\`\`typescript
{
  visualPrompt: string,      // 英文視覺提詞（直接可用於生成）
  audioScript: string,       // 繁體中文語音腳本
  musicVibe: string,         // 音樂風格描述
  suggestedModels: string[], // 推薦使用的模型
  estimatedCost: number,     // 預估點數消耗
  proactiveQuestions: string[], // 追問引導問題
}
\`\`\`

---

## 腳本模板庫

導演 AI 內建 6 種常用模板：

| 模板 | 適用場景 | 預設人格 |
|------|---------|---------|
| 短片製作 | 15-60 秒敘事影片 | 創意型 |
| 冥想引導 | 療癒音頻+視覺 | 沉穩型 |
| 品牌宣傳 | 企業形象短片 | 技術型 |
| 廣告片 | 社群媒體廣告 | 創意型 |
| 教學影片 | 步驟式教學 | 沉穩型 |
| 音樂 MV | 完整歌曲影片 | 創意型 |

### 使用模板
1. 在導演 AI 頁面點擊「模板庫」
2. 選擇適合的模板
3. 系統自動設定人格和對話起始語
4. 根據引導回答問題
5. 導演 AI 生成完整腳本

---

## 一鍵發送到工作室

腳本生成後，可以一鍵將內容發送到各工作室：

| 發送目標 | 自動填入內容 |
|---------|-------------|
| 創作工作室 | visualPrompt → 提詞框 |
| 影片工作室 | visualPrompt → 提詞框 + 模型推薦 |
| 音樂配音創作室 | musicVibe → 音樂描述 + audioScript → TTS 文字 |
| 專案筆記 | 完整腳本 → noteType='script' |

---

## 偏好設定

在 **設定 → 導演偏好**（/settings）中配置：

| 設定項 | 選項 | 說明 |
|--------|------|------|
| 預設人格 | calm / creative / technical | 每次開啟導演 AI 的預設人格 |
| 輸出框架 | CO-STAR / SSLCM / SELCM / free | 腳本結構化格式 |
| 自定義系統提示 | 自由文字 | 額外的風格指引 |

**API：** \`trpc.director.preferences.get\` / \`trpc.director.preferences.update\`

---

## 對話管理

導演 AI 支援對話持久化：
- **儲存對話**：\`trpc.director.saveSession\` — 保存當前對話快照
- **載入對話**：\`trpc.director.loadSession\` — 恢復之前的對話
- **刪除對話**：\`trpc.director.deleteSession\` — 移除不需要的對話
- **列出對話**：\`trpc.director.listSessions\` — 查看所有已存對話

---

## 進階技巧

### 迭代優化
1. 先用導演 AI 生成初版腳本
2. 使用 \`trpc.director.refineScript\` 進行微調
3. 反覆調整直到滿意
4. 一鍵發送到工作室

### 人格切換策略
- 先用**技術型**了解可用模型和參數
- 再用**創意型**發想視覺概念
- 最後用**沉穩型**規劃執行流程

### 結合 RAG 記憶
- 設定 \`PINECONE_API_KEY\` 後，導演 AI 會記住你的風格偏好
- 多次使用後，推薦會更精準
- 記憶系統 3 秒超時，不阻塞主流程
`,
    tags: ["導演 AI", "CO-STAR", "RAG", "人格系統", "雙引擎", "腳本"],
    difficulty: "intermediate",
    readingMinutes: 15,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：儀表板與分析
  // ══════════════════════════════════════════════════════

  {
    id: "deep-dashboard",
    category: "getting-started",
    title: "儀表板與數據分析完整教學",
    summary:
      "了解如何使用儀表板追蹤你的創作數據，包含配額管理、成本分析、每日趨勢和模態分佈圖表。",
    content: `# 儀表板與數據分析完整教學

## 進入儀表板

點擊左側選單的「📊 儀表板」或直接前往 /dashboard。

---

## 四大統計指標

儀表板頂部顯示四個核心指標卡片：

### 1. 剩餘配額
- 顯示當前帳號的生成配額（點數）
- 新帳號預設配額：依管理員設定
- 配額用完需聯絡管理員補充

### 2. 總 API 請求數
- 統計你的所有 API 調用次數
- 包含：圖片生成、影片生成、音訊生成、語音合成、安全檢查、提詞擴展、導演 AI

### 3. 預估總成本（USD）
- 根據 API 使用量計算的預估費用
- 1 點 ≈ $0.01 USD

### 4. 每次請求平均成本
- 總成本 ÷ 總請求數
- 幫助評估使用效率

---

## 分析圖表

### 7 天活動柱狀圖
- X 軸：最近 7 天的日期
- Y 軸：每日請求次數
- 幫助了解你的創作頻率和高峰時段

### 模態分佈圓餅圖
- 按模態分類的請求佔比
- 顏色編碼：
  - 🎨 圖片生成（藍色）
  - 🎬 影片生成（紫色）
  - 🎵 音訊生成（綠色）
  - 🎤 語音配音（橘色）
  - 🛡️ 安全檢查（灰色）
  - 📝 提詞擴展（青色）
  - 🎭 導演 AI（粉色）

### 7 天成本趨勢折線圖
- 顯示每日的成本變化趨勢
- 幫助規劃預算和使用策略

---

## 最近使用記錄

底部顯示最近 50 筆請求記錄，每筆包含：

| 欄位 | 說明 |
|------|------|
| 請求類型 | 圖片/影片/音訊/語音/安全/提詞/導演 |
| 狀態 | ✅ 成功 / ❌ 失敗 / 🚫 被攔截 |
| API 提供商 | fal.ai / Gemini / ElevenLabs 等 |
| Token 使用量 | 消耗的 Token 數（LLM 請求） |
| 預估費用 | 單次費用（USD） |
| 時間戳記 | 本地時區顯示 |

---

## 費用優化建議

### 降低成本的策略
1. **先用快速模型測試**：Flux Schnell（1 點）→ 確認效果後再用 Flux Pro（4 點）
2. **減少失敗生成**：寫好提詞再生成，避免浪費點數
3. **善用積木組合**：保存成功的積木組合，下次直接載入
4. **選擇適當模型**：不需要頂級品質時用標準模型

### 配額管理
- 儀表板配額到 0 時無法生成
- 管理員可通過 admin.updateQuota 補充
- Demo 模式下配額為 999（虛擬）

**API：** \`trpc.dashboard.myStats\`（單次查詢返回所有統計資料）
`,
    tags: ["儀表板", "數據分析", "配額", "成本", "統計"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：專注流
  // ══════════════════════════════════════════════════════

  {
    id: "deep-focus-flow",
    category: "getting-started",
    title: "專注流完整教學：番茄鐘 × 療癒呼吸 × 想法捕捉",
    summary:
      "Healing Studio 獨有的身心靈功能，結合番茄鐘工作法、4-7-8 引導式呼吸和靈感碎片捕捉。",
    content: `# 專注流完整教學

## 什麼是專注流？

專注流（Focus Flow）是 Healing Studio 獨有的「身心靈」功能模組，將創作者的身心健康融入工作流程。它結合三個核心元素：

1. **🍅 番茄鐘（Pomodoro）**：結構化工作/休息循環
2. **🫁 療癒時光（Healing Time）**：引導式呼吸練習
3. **💭 想法捕捉（Thoughts Capture）**：碎片靈感記錄

---

## 番茄鐘工作法

### 基本流程
\`\`\`
專注工作（25 分鐘） → 短休息（5 分鐘） → 專注工作 → 短休息 → ...
\`\`\`

### 時間預設選項

| 模式 | 工作時間 | 休息時間 | 適用場景 |
|------|---------|---------|---------|
| 衝刺 | 15 分鐘 | 3 分鐘 | 快速任務 |
| 標準 | 25 分鐘 | 5 分鐘 | 一般創作（預設） |
| 深度 | 45 分鐘 | 10 分鐘 | 長時間專注 |
| 馬拉松 | 50 分鐘 | 15 分鐘 | 大型專案 |

### 功能特點
- 大字體倒數計時器
- 工作/休息自動切換
- 完成輪次計數器
- 總專注時間累計
- 完成時 Toast 祝賀通知
- 跨頁面持久化（離開頁面不會中斷）

### 使用建議
- 工作階段：全心投入創作（提詞撰寫、模型選擇、結果評估）
- 休息階段：離開螢幕、伸展、喝水
- 每 4 個番茄鐘後，進行一次較長的休息（15-20 分鐘）

---

## 療癒時光（引導式呼吸）

### 呼吸循環

專注流採用 **4-相呼吸法**：

| 階段 | 時長 | 動作 | 動畫效果 |
|------|------|------|---------|
| 吸氣 | 4 秒 | 緩慢深吸 | 光球膨脹 |
| 屏住 | 4 秒 | 保持 | 光球維持 |
| 吐氣 | 6 秒 | 緩慢吐出 | 光球收縮 |
| 放鬆 | 2 秒 | 自然呼吸 | 光球淡出 |

### 療癒時間預設

- 3 分鐘：快速放鬆
- 5 分鐘：標準療癒（預設）
- 10 分鐘：深度放鬆
- 15 分鐘：冥想級別
- 20 分鐘：完整冥想

### 動畫光球
- 呼吸引導配有動態縮放的光球動畫
- 光球大小同步呼吸節奏
- 搭配柔和的顏色漸變

---

## 想法捕捉

### 功能
- 在工作或休息期間記錄突發靈感
- 輸入框固定在頁面底部
- 可隨時新增、刪除、清空想法
- 每則想法帶有時間戳記

### 資料結構
\`\`\`typescript
{
  id: string,
  text: string,
  createdAt: string
}
\`\`\`

### 使用建議
- 工作中突然想到新的創作點子 → 快速記錄
- 休息時的靈感閃現 → 不用打開其他 App
- 整理後可以轉移到「專案筆記」正式記錄

---

## 偏好設定持久化

所有專注流設定保存在瀏覽器 localStorage（key: \`focus-flow-prefs\`）：
- 工作時長預設
- 休息時長預設
- 療癒時長預設
- 上次使用的設定自動恢復

---

## 建議工作流程

\`\`\`
1. 開啟專注流
2. 設定番茄鐘（25 分鐘工作）
3. 開始創作（撰寫提詞、生成作品）
4. 休息時切換到「療癒時光」（5 分鐘呼吸）
5. 記錄休息時的靈感（想法捕捉）
6. 重複循環直到完成
\`\`\`

進入專注流：點擊左側選單「🍃 專注流」或直接前往 /focus-flow。
`,
    tags: ["專注流", "番茄鐘", "呼吸練習", "冥想", "身心靈", "生產力"],
    difficulty: "beginner",
    readingMinutes: 10,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：數位資產庫
  // ══════════════════════════════════════════════════════

  {
    id: "deep-assets",
    category: "getting-started",
    title: "數位資產庫完整教學：上傳、管理與分享你的創作素材",
    summary:
      "學會使用數位資產庫統一管理所有圖片、影片、音訊、語音和腳本檔案，支援團隊共享和批量管理。",
    content: `# 數位資產庫完整教學

## 什麼是數位資產庫？

數位資產庫（/assets）是你的私人媒體管理中心，統一儲存和管理所有創作素材。所有上傳的檔案都通過 S3 兼容的雲端儲存安全保管。

---

## 支援的檔案類型

| 類型 | 圖示 | 副檔名 | 說明 |
|------|------|--------|------|
| 🖼️ 圖片 | Image | PNG, JPEG, WebP | 生成圖片、參考圖、素材 |
| 🎬 影片 | Video | MP4, WebM | 生成影片、素材影片 |
| 🎵 音訊 | Music | MP3, WAV | 音樂、音效、環境音 |
| 🎤 語音 | Mic | MP3, WAV | TTS 輸出、語音錄音 |
| 📄 腳本 | FileText | TXT | 導演腳本、文字稿 |
| 📦 打包 | Package | ZIP | 批量素材包 |

---

## 上傳素材

### 步驟
1. 前往 **數位資產庫**（/assets）
2. 點擊「+ 上傳資產」按鈕
3. 選擇檔案（支援拖放）
4. 填寫：
   - **標題**（必填）
   - **說明**（選填）
   - **類型**（自動偵測，可手動調整）
5. 確認上傳

### 技術細節
- 上傳使用 POST /api/upload（multipart/form-data）
- **重要：** 瀏覽器必須帶 cookies（credentials: 'include'）
- 上傳完成後返回檔案 URL

**API：** \`trpc.assets.upload\`

---

## 管理素材

### 篩選功能
- **按類型篩選**：圖片、影片、音訊、語音、腳本、打包
- **關鍵字搜尋**：搜尋標題和標籤
- **排序**：按日期或檔案大小

### 素材操作

| 操作 | 說明 | API |
|------|------|-----|
| 下載 | 通過代理下載（繞過 CORS） | GET /api/proxy-download?url= |
| 刪除 | 確認後永久刪除 | \`trpc.assets.delete\` |
| 編輯 | 修改標題、說明、標籤 | \`trpc.assets.update\` |
| 分享 | 切換為團隊可見 | \`trpc.assets.publish\` |
| 複製連結 | 複製素材 URL | 前端操作 |

### 檔案大小顯示
- 系統自動轉換顯示：B → KB → MB
- 方便評估儲存空間使用量

---

## 團隊共享

### 公開資產
1. 找到要分享的素材
2. 點擊「分享」或切換可見性
3. 可見性切換為 \`team_shared\`
4. 團隊成員可在「共享空間」看到

### 私人資產
- 預設所有上傳為私人（private）
- 只有你本人可以看到和管理

**API：**
- \`trpc.assets.myAssets\` — 我的資產
- \`trpc.assets.teamAssets\` — 團隊共享資產

---

## 與其他功能整合

| 整合功能 | 說明 |
|---------|------|
| 創作工作室 | 上傳的圖片可作為參考圖使用 |
| 一致性保險庫 | 資產庫的圖片可直接匯入保險庫 |
| 導演 AI | 腳本資產可作為導演 AI 的參考 |
| 生成歷史 | 生成結果可保存到資產庫 |

---

## 注意事項
- 上傳大小限制取決於伺服器設定
- 雲端儲存使用 S3 兼容服務（Google Cloud Storage 或 AWS S3）
- 刪除素材為永久操作，無法還原
- 代理下載只允許白名單域名的 URL
`,
    tags: ["數位資產庫", "上傳", "管理", "分享", "S3"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：團隊協作與共享空間
  // ══════════════════════════════════════════════════════

  {
    id: "deep-shared",
    category: "workflow",
    title: "團隊協作完整指南：共享空間、資產分享與協作最佳實踐",
    summary:
      "了解如何使用共享空間進行團隊協作，包含資產共享、模型共享、貢獻統計和協作策略。",
    content: `# 團隊協作完整指南

## 共享空間概覽

共享空間（/shared）是 Healing Studio 的團隊協作中心，讓團隊成員能夠分享創作素材和訓練好的模型。

---

## 共享資產

### 瀏覽團隊資產
1. 前往 **共享空間**（/shared）
2. 「團隊資產」分頁顯示所有共享素材
3. 可按模態篩選：圖片 / 影片 / 音訊 / 語音 / 腳本 / 打包
4. 支援關鍵字搜尋

### 資產來源
- 任何團隊成員在「數位資產庫」中將素材設為 \`team_shared\`
- 資產上傳者的名稱會顯示在卡片上

### 下載資產
- 點擊下載按鈕
- 使用 \`/api/proxy-download\` 代理繞過 CORS
- 支援所有格式的直接下載

**API：** \`trpc.assets.teamAssets\`（30 秒快取）

---

## 共享模型

### 瀏覽團隊模型
1. 切換到「團隊模型」分頁
2. 顯示所有可見性為 \`team_shared\` 的 LoRA 模型
3. 每個模型卡片顯示：
   - 模型名稱和描述
   - 模型類型（image_subject / style_lora / portrait_lora 等）
   - 訓練狀態
   - 觸發詞
   - 建立者

### 使用團隊模型
1. 複製模型的 LoRA URL
2. 在創作工作室或圖片創作室中選擇
3. 生成時自動附加觸發詞

**API：** \`trpc.models.teamModels\`

---

## 如何分享你的素材

### 分享資產
1. 前往 **數位資產庫**（/assets）
2. 找到要分享的素材
3. 點擊分享按鈕，可見性切換為 \`team_shared\`
4. 素材立即在共享空間可見

### 分享模型
1. 前往 **角色鍛造所**（/models）
2. 找到訓練完成（\`ready\`）的模型
3. 點擊「分享到團隊」
4. 可見性切換為 \`team_shared\`
5. 分享時系統退回 3 點配額（鼓勵分享）

**API：** \`trpc.models.toggleVisibility\`

---

## 貢獻統計

共享空間顯示團隊協作數據：
- 你的個人貢獻數量
- 團隊總共享資產數量
- 團隊總共享模型數量
- 最近活動動態

---

## 協作最佳實踐

### 資產命名規範
- 使用描述性名稱：「品牌 A - 主視覺 - v2」而非「img001」
- 標記版本號：v1、v2、final
- 加入用途標籤：海報、社群、影片素材

### 模型共享策略
- 訓練好的角色 LoRA → 立即分享給團隊
- 風格 LoRA → 團隊統一風格時特別有用
- 場景 LoRA → 系列作品的環境一致性

### 工作流程協作
1. **導演 AI** 生成腳本 → 保存到筆記
2. 不同成員負責不同場景的素材
3. 所有素材上傳到資產庫 + 共享
4. 在共享空間集中審核
5. 最終作品加入首頁精選
`,
    tags: ["團隊協作", "共享空間", "資產分享", "模型分享", "協作"],
    difficulty: "beginner",
    readingMinutes: 10,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：專案筆記與創作排程
  // ══════════════════════════════════════════════════════

  {
    id: "deep-notes-calendar",
    category: "getting-started",
    title: "專案筆記與創作排程完整教學",
    summary:
      "使用專案筆記記錄創作靈感和腳本，搭配創作排程日曆管理專案時程，支援 Google Calendar 整合。",
    content: `# 專案筆記與創作排程完整教學

## 專案筆記（/notes）

### 三種筆記類型

| 類型 | 圖示顏色 | 用途 |
|------|---------|------|
| 📄 筆記（note） | 青色 | 一般靈感記錄、創作構想 |
| 🎬 腳本（script） | 紫色 | 結構化創作腳本（含 scriptJson） |
| 📅 日曆事件（calendar_event） | 琥珀色 | 有排程日期的待辦事項 |

### 建立筆記
1. 前往 **專案筆記**（/notes）
2. 點擊「+ 新增筆記」
3. 填寫：
   - **標題**（必填）
   - **內容**（Markdown 格式）
   - **類型**：筆記 / 腳本 / 日曆事件
   - **標籤**（逗號分隔）
   - **排程日期**（日曆事件必填）
4. 儲存

### 功能特點
- **Markdown 渲染**：支援標題、列表、粗體、連結等
- **篩選**：按類型篩選（全部 / 筆記 / 腳本 / 日曆事件）
- **搜尋**：全文搜尋標題和內容
- **匯出**：下載為 TXT 純文字檔
- **標籤系統**：自定義標籤分類

### 腳本格式（scriptJson）
腳本類型的筆記支援結構化 JSON 內容，可與導演 AI 的輸出整合：
\`\`\`typescript
{
  scenes: [
    { visualPrompt: string, audioScript: string, musicVibe: string }
  ]
}
\`\`\`

**API：**
- \`trpc.notes.list\` — 列出所有筆記
- \`trpc.notes.create\` — 建立筆記
- \`trpc.notes.update\` — 更新筆記
- \`trpc.notes.delete\` — 刪除筆記

---

## 創作排程（/calendar）

### 日曆功能
1. 前往 **創作排程**（/calendar）
2. 日曆格網顯示當月所有天
3. 有排程的日期會顯示事件卡片
4. 點擊事件卡片查看詳情

### 事件卡片
- 顯示標題和類型指示色
- 可點擊展開查看完整內容
- 支援拖放重新排序（Framer Motion 動畫）

### 月份導航
- 上一月 / 下一月切換按鈕
- 快速跳轉到今天

### Google Calendar 整合
點擊「加入 Google Calendar」按鈕，系統會：
1. 將事件轉換為 Google Calendar 格式
2. 開啟 Google Calendar 新增事件頁面
3. 自動填入標題和日期

---

## 整合工作流程

### 導演 AI → 筆記
1. 在導演 AI 生成腳本
2. 點擊「保存到筆記」
3. 自動建立 noteType='script' 的筆記
4. 包含完整 CO-STAR 結構

### 筆記 → 日曆
1. 在筆記中標記為 calendar_event 類型
2. 設定排程日期
3. 自動出現在創作排程日曆中

### 最佳實踐
- 每個創作專案建立一個「腳本」筆記
- 把拍攝/生成日期設為日曆事件
- 標籤用於分類不同專案
- 定期回顧「筆記」整理靈感
`,
    tags: ["專案筆記", "創作排程", "日曆", "腳本", "Google Calendar"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：管理員後台
  // ══════════════════════════════════════════════════════

  {
    id: "deep-admin",
    category: "api-docs",
    title: "管理員後台完整教學：用戶管理、系統監控與回饋處理",
    summary:
      "管理員專屬的完整操作指南，包含用戶配額管理、系統統計、API 健康狀態監控和回饋報告處理。",
    content: `# 管理員後台完整教學

## 存取條件

- 必須擁有 \`role = 'admin'\` 的帳號
- 超級管理員帳號在 \`server/db.ts\` 的 SUPER_ADMIN_EMAILS 中硬編碼
- 管理員可通過 ADMIN_EMAILS 環境變數動態新增
- 超級管理員無法被降級

---

## 七大管理分頁

### 1. 總覽（Overview）

顯示系統整體健康狀態：
- 總用戶數
- 總 API 請求數
- 總成本（USD）
- 每日請求平均
- 30 天趨勢圖
- API 提供商使用分佈

**API：** \`trpc.admin.systemStats\` / \`trpc.admin.systemDailyTrend\` / \`trpc.admin.apiProviderBreakdown\`

### 2. 用戶管理（Users）

| 操作 | 說明 | API |
|------|------|-----|
| 查看用戶清單 | 所有用戶資訊一覽 | \`trpc.admin.allUsers\` |
| 更新配額 | 設定用戶的生成點數 | \`trpc.admin.updateQuota\` |
| 變更角色 | 切換 user ↔ admin | \`trpc.admin.updateRole\` |
| 查看活動 | 個別用戶的使用歷史 | \`trpc.admin.userActivity\` |

**注意：** 超級管理員帳號無法被降級為一般用戶。

### 3. 回饋管理（Feedback）

| 操作 | 說明 | API |
|------|------|-----|
| 查看所有回饋 | 列出用戶提交的回饋 | \`trpc.feedback.all\` |
| 搜尋回饋 | 按關鍵字篩選 | 前端篩選 |
| 更新狀態 | open → in_progress → resolved → closed | \`trpc.feedback.updateStatus\` |

回饋分類：bug / feature_request / quality_issue / general
優先級：low / medium / high / critical

### 4. 生成歷史（Generation History）

查看全平台最近 100 筆生成記錄：
- 用戶名稱
- 提詞內容
- 使用模型
- 生成結果
- 點數消耗
- 時間戳記

**API：** \`trpc.admin.allGenerationHistory\`

### 5. 背景任務（Background Jobs）

監控所有背景任務狀態：
- 模型訓練任務
- 新聞抓取任務
- 其他排程任務

狀態：queued → processing → completed / failed / cancelled

**API：** \`trpc.admin.allBackgroundJobs\`

### 6. API 狀態（API Status）

檢查所有外部 API 的連線狀態：
- Replicate（LoRA 訓練）
- fal.ai（多模態生成）
- ElevenLabs（TTS/音效）
- Gemini（LLM）
- Pinecone（RAG 記憶）
- LangSmith（追蹤）

**API：** \`trpc.admin.apiKeysStatus\`

### 7. 使用記錄（Usage Logs）

詳細的 API 請求審計日誌：
- 請求類型和時間
- 成功/失敗狀態
- Token 消耗量
- 費用明細
- 延遲時間

**API：** \`trpc.admin.usageLogs\`（限制 100 筆）

---

## 管理員最佳實踐

### 配額管理策略
- 新用戶：設定初始配額（如 100 點）
- 活躍用戶：定期補充
- 團隊帳號：批量設定較高配額

### 監控重點
- 每日檢查 API 狀態頁面
- 關注失敗率偏高的提供商
- 定期查看回饋報告
- 監控成本趨勢避免超支

### 安全注意
- 定期審查用戶角色
- 超級管理員帳號妥善保管
- 回饋中的 bug 報告優先處理
`,
    tags: ["管理員", "後台", "用戶管理", "系統監控", "API 狀態"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：LoRA 訓練中心
  // ══════════════════════════════════════════════════════

  {
    id: "deep-lora-trainer",
    category: "model-guide",
    title: "LoRA 訓練中心深度教學：六種模型類型與進階訓練參數",
    summary:
      "深入了解 LoRA 訓練中心的四步驟精靈、六種訓練類型、雙引擎架構和進階超參數調整。",
    content: `# LoRA 訓練中心深度教學

## 概覽

LoRA 訓練中心（/lora-trainer）是 Healing Studio 的進階模型微調系統，提供比角色鍛造所更精細的控制。支援六種訓練類型和雙引擎架構。

---

## 六種訓練類型

| 類型 | 說明 | 資料需求 | 引擎 |
|------|------|---------|------|
| **image_subject** | 人物/物件主題 LoRA | 3-20 張圖片 | Replicate |
| **portrait_lora** | 臉部特化 LoRA | 5-20 張正面照 | fal.ai |
| **style_lora** | 藝術/視覺風格 LoRA | 5-30 張風格圖 | fal.ai |
| **scene_lora** | 環境/背景 LoRA | 5-20 張場景圖 | fal.ai |
| **video_lora** | 動態模式 LoRA | 3-10 段影片 | fal.ai |
| **voice_clone** | 聲音克隆 | 1-5 段音訊 | fal.ai |

---

## 四步驟訓練精靈

### 步驟一：資料集上傳

**圖片資料集：**
- 支援格式：JPG、PNG、WebP
- 建議解析度：512×512 以上（最佳 1024×1024）
- 角度標記：front / side / back / expression / other
- 每張圖會顯示上傳進度

**影片資料集（video_lora）：**
- 支援格式：MP4、WebM
- 建議時長：3-30 秒

**音訊資料集（voice_clone）：**
- 支援格式：MP3、WAV
- 建議時長：10-60 秒
- 清晰錄音、無背景噪音

### 步驟二：AI 自動標註

系統使用 Vision 模型自動為每張圖片生成英文描述：
- 分析圖片中的主體、背景、光線、風格
- 每張約 3-5 秒
- 標註品質直接影響訓練效果
- 可手動修改 AI 生成的標註

**API：** \`trpc.models.captionImages\`

### 步驟三：超參數調整

| 參數 | 預設值 | 建議範圍 | 說明 |
|------|--------|---------|------|
| Epochs | 100-1000 | 依資料量 | 訓練輪數 |
| Learning Rate | 0.0001 | 0.00005-0.0005 | 學習速率 |
| Steps | 自動計算 | 100-5000 | 訓練步數 |
| 觸發詞 | 自訂 | 唯一英文詞 | 生成時激活 LoRA |
| Style 旗標 | false | true/false | 風格 LoRA 專用 |

**關鍵建議：**
- 資料少（3-5 張）→ Epochs 降低（避免過擬合）
- 資料多（15-20 張）→ Epochs 可提高
- Learning Rate 過高 → 訓練不穩定
- Learning Rate 過低 → 訓練過慢

### 步驟四：啟動訓練

點擊「開始訓練」後：
1. 系統打包資料集
2. 提交到訓練引擎（Replicate 或 fal.ai）
3. 背景監控訓練進度
4. 訓練完成自動更新狀態

**API：** \`trpc.loraTrainer.submitTraining\`

---

## 雙引擎架構

### Replicate 引擎（image_subject 預設）
- 使用 FLUX-Dev-LoRA-Trainer
- \`REPLICATE_API_TOKEN\` 環境變數
- 適合人物/物件主題

### fal.ai 引擎（其他類型預設）
- 支援更多訓練類型
- \`FAL_API_KEY\` 環境變數
- 自動降級：主引擎失敗時嘗試備用引擎

---

## 訓練監控

### 訓練狀態面板
| 指標 | 說明 |
|------|------|
| 總模型數 | 所有已建立的模型 |
| 已就緒 | 訓練完成可使用 |
| 訓練中 | 正在訓練的模型 |
| 失敗 | 訓練失敗的模型 |
| 待處理 | 排隊等待的模型 |
| 按類型使用量 | 各類型模型的使用次數 |

### 訓練歷史
- 查看所有模型的完整訓練記錄
- 包含配置詳情、訓練時間、結果狀態
- 可取消進行中的訓練

**API：**
- \`trpc.loraTrainer.stats\` — 訓練概覽
- \`trpc.loraTrainer.trainingHistory\` — 完整歷史
- \`trpc.loraTrainer.trainingDetail\` — 單一模型詳情
- \`trpc.loraTrainer.pollTraining\` — 即時狀態查詢
- \`trpc.loraTrainer.cancelTraining\` — 取消訓練

---

## 使用訓練好的模型

訓練完成（\`ready\` 狀態）後：
1. 在角色鍛造所查看模型
2. 複製 LoRA URL 和觸發詞
3. 在以下工作室使用：
   - **創作工作室**：選擇自訂模型 + 設定 LoRA 權重
   - **圖片創作室**：SD LoRA / SD 3.5 + ControlNet + LoRA
   - **影片工作室**：配合角色保險庫

### LoRA 權重建議
- 0.5：輕微影響（保留更多原始模型特性）
- 0.7：平衡（推薦）
- 1.0：最強影響（可能過擬合）
`,
    tags: ["LoRA", "訓練中心", "微調", "Replicate", "fal.ai", "超參數"],
    difficulty: "advanced",
    readingMinutes: 14,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：聲音克隆與說話頭像
  // ══════════════════════════════════════════════════════

  {
    id: "deep-voice-avatar",
    category: "technique",
    title: "聲音克隆與說話頭像完整教學",
    summary:
      "從聲音樣本克隆到生成說話頭像影片，完整教你使用 Qwen、Dia TTS、EchoMimic 和 Stable Avatar 等工具。",
    content: `# 聲音克隆與說話頭像完整教學

## 第一部分：聲音克隆

### 什麼是聲音克隆？
上傳一段聲音樣本，AI 學習聲紋特徵後，能用該聲音朗讀任何文字。

### 方案比較

| 工具 | API | 特點 | 適合場景 |
|------|-----|------|---------|
| Qwen Clone | \`trpc.proStudio.qwenCloneAndSpeak\` | 阿里雲，中文最佳 | 中文旁白 |
| Dia TTS | \`trpc.proStudio.diaTTSVoiceClone\` | 對話式，多人場景 | 對話影片 |
| Qwen Voice Design | \`trpc.proStudio.qwenVoiceDesign\` | 從零設計新聲音 | 原創角色 |
| Kling Voice | \`trpc.proStudio.klingCreateVoice\` | 快手語音 | 快速克隆 |

### Qwen 聲音克隆流程
1. 準備聲音樣本（10-60 秒清晰錄音）
2. 上傳到音樂配音創作室（/pro-studio）
3. 選擇「聲音克隆」分類
4. 上傳聲音樣本
5. 輸入要朗讀的文字
6. 系統生成克隆聲音音訊

### 聲音樣本最佳實踐
- **時長**：15-30 秒最佳（太短不足以學習，太長浪費）
- **品質**：安靜環境錄音，無背景噪音
- **內容**：包含各種音節和語調變化
- **格式**：MP3 或 WAV（16kHz 以上取樣率）
- **語言**：與輸出語言一致效果最好

---

## 第二部分：說話頭像

### 什麼是說話頭像？
上傳一張人臉照片 + 一段音頻，AI 會讓照片中的人物「說話」——嘴唇同步音頻內容。

### 方案比較

| 工具 | API | 特點 | 超時 |
|------|-----|------|------|
| EchoMimic | \`trpc.proStudio.echoMimic\` | 表情豐富 | 300 秒 |
| Stable Avatar | \`trpc.proStudio.stableAvatar\` | Stability AI，自然表情 | 300 秒 |
| Longcat Avatar | \`trpc.proStudio.longcatAvatar\` | 支援較長時長 | 300 秒 |
| LTX Audio-to-Video | \`trpc.proStudio.ltxAudioToVideo\` | 不限人臉 | 300 秒 |

### 說話頭像製作流程

#### 步驟一：準備人臉照片
- **解析度**：至少 512×512（建議 1024×1024）
- **角度**：正面最佳，輕微側面可接受
- **表情**：中性表情，嘴巴閉合
- **背景**：簡單背景效果更好

#### 步驟二：準備音頻
- 使用 ElevenLabs TTS 或 Qwen TTS 生成語音
- 或使用聲音克隆生成的音頻
- 時長建議：5-30 秒

#### 步驟三：生成說話頭像
1. 前往音樂配音創作室 → 說話頭像
2. 上傳人臉照片
3. 上傳或選擇音頻
4. 選擇工具（EchoMimic / Stable Avatar 等）
5. 開始生成（約 1-3 分鐘）

---

## 完整聲音+頭像工作流

\`\`\`
1. 撰寫旁白文字
2. ElevenLabs TTS → 生成語音（或聲音克隆）
3. 圖片創作室 → 生成角色正面照
4. 一致性保險庫 → 保存角色照
5. EchoMimic → 照片+語音 → 說話頭像影片
6. 影片工作室 → 畫質優化
\`\`\`

### 進階：多角色對話影片
1. 用 Dia TTS 生成多人對話音頻
2. 為每個角色生成獨立的人臉照片
3. 分別製作每個角色的說話頭像
4. 在外部剪輯軟體中組合

---

## 其他音訊工具

### 音訊分離（Demucs）
- **API：** \`trpc.proStudio.demucs\`
- 將混合音頻分離為：人聲 / 鼓聲 / 貝斯 / 其他
- 模型選項：htdemucs / htdemucs_ft / htdemucs_6s
- 適合：提取人聲、製作伴奏

### 影片配音（ElevenLabs Dubbing）
- **API：** \`trpc.proStudio.dubbing\`
- 自動翻譯影片音軌
- 保持原始語調和節奏
- 支援多種目標語言

### 語音轉文字（WhisperX）
- **API：** \`trpc.proStudio.speechToText\`
- 精確語音辨識
- 含時間戳記字幕
- 支援中英文
`,
    tags: ["聲音克隆", "說話頭像", "TTS", "EchoMimic", "Demucs", "WhisperX"],
    difficulty: "intermediate",
    readingMinutes: 14,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：3D 建模
  // ══════════════════════════════════════════════════════

  {
    id: "deep-3d-modeling",
    category: "technique",
    title: "3D 建模深度教學：從單張圖片到完整 3D 世界",
    summary:
      "深入了解 Healing Studio 的 5 種 3D 建模工具，從物件重建到世界場景生成的完整教學。",
    content: `# 3D 建模深度教學

## 概覽

Healing Studio 圖片創作室整合了 5 種最先進的 3D 建模 AI 模型，涵蓋從單一物件到完整世界場景的各種需求。

---

## 五種 3D 模型詳解

### 1. Trellis 2 — 通用 3D 物件生成

**API：** \`trpc.imageStudio.trellis2\`
**FAL 模型：** \`fal-ai/trellis-2\`

**特點：**
- 從單張圖片生成高品質 3D GLB 模型
- 支援 PBR（物理基礎渲染）材質
- 金屬度、粗糙度自動推測
- 輸出可直接用於 Three.js、Blender

**最佳使用場景：**
- 電商產品 3D 展示
- 遊戲道具建模
- 角色模型原型

**輸入建議：**
- 主體清晰、背景簡單的照片
- 1024×1024 解析度最佳
- 避免透明或反射材質的物品

---

### 2. SAM 3D Objects — 場景物件分割重建

**API：** \`trpc.imageStudio.sam3dObjects\`
**FAL 模型：** \`fal-ai/sam-3/3d-objects\`

**特點：**
- 基於 Segment Anything Model 3D
- 自動分割場景中的每個物件
- 分別重建每個物件的 3D 模型
- 適合從複雜照片中提取多個 3D 物件

**最佳使用場景：**
- 從合照中提取個別物件
- 室內場景物件分離
- 批量 3D 資產生成

---

### 3. HunYuan3D v3 — 電影級 3D 建模

**API：** \`trpc.imageStudio.hunyuan3d\`
**FAL 模型：** \`fal-ai/hunyuan3d-v3/image-to-3d\`

**特點：**
- 騰訊混元最強 3D 模型
- 電影級精度和細節
- 高解析度紋理貼圖
- 支援複雜幾何結構

**最佳使用場景：**
- 影視級角色模型
- 高品質 3D 渲染素材
- 展覽級 3D 作品

**注意：** 計算時間較長（240-300 秒），建議確認需求後再使用。

---

### 4. Rodin — 文字+圖片雙輸入 3D

**API：** \`trpc.imageStudio.rodin3d\`
**FAL 模型：** \`fal-ai/hyper3d/rodin\`

**特點：**
- **唯一支援純文字輸入**的 3D 模型
- 也支援圖片+文字雙輸入
- Hyper 3D 技術，速度較快
- 適合快速原型

**使用方式：**
- 純文字：「一把中世紀劍」→ 3D 劍模型
- 圖片+文字：上傳概念圖 + 補充描述 → 更精準的 3D 模型

**最佳使用場景：**
- 快速 3D 概念驗證
- 沒有參考圖時的 3D 生成
- 遊戲資產快速原型

---

### 5. HunYuan World — 圖片轉 3D 世界

**API：** \`trpc.imageStudio.hunyuanWorld\`
**FAL 模型：** \`fal-ai/hunyuan_world/image-to-world\`

**特點：**
- 不只生成單一物件，而是**完整 3D 環境**
- 從單張風景/室內照片擴展為可探索的 3D 空間
- 支援 VR/AR 場景製作
- 包含地面、天空、遠景

**最佳使用場景：**
- VR 場景製作
- 虛擬空間設計
- 沉浸式體驗原型
- 遊戲場景建構

---

## 3D 輸出格式

| 格式 | 說明 | 相容軟體 |
|------|------|---------|
| GLB | 二進位 GLTF，最常用 | Three.js、Babylon.js、Blender、Unity |
| GLTF | 文字格式 GLTF | Web 3D 平台 |
| OBJ | 傳統 3D 格式 | 3ds Max、Maya、Cinema 4D |

---

## 完整 3D 創作工作流

### 流程一：產品 3D 展示
\`\`\`
1. 拍攝/生成產品正面照
2. Trellis 2 → 3D GLB 模型
3. 下載 GLB 用於網站 3D 展示
\`\`\`

### 流程二：角色 3D 建模
\`\`\`
1. 圖片創作室 → 生成角色概念圖
2. HunYuan3D v3 → 電影級 3D 模型
3. Blender 進一步調整
\`\`\`

### 流程三：VR 場景
\`\`\`
1. 圖片創作室 → 生成風景/室內圖
2. HunYuan World → 3D 世界場景
3. 用於 VR 體驗或遊戲引擎
\`\`\`

### 流程四：批量 3D 資產
\`\`\`
1. 拍攝多物件場景照
2. SAM 3D Objects → 分割重建
3. 每個物件獨立 GLB
4. 組合到 3D 專案中
\`\`\`

---

## 提詞建議

### 最佳輸入圖片
- ✅ 白色/純色背景
- ✅ 正面 + 微俯角（最佳 3D 推測）
- ✅ 光線均勻、無強烈陰影
- ❌ 過度透視變形
- ❌ 模糊或低解析度
- ❌ 大面積透明/反射材質

### Rodin 文字提詞技巧
- 描述材質：「wooden table with metal legs」
- 描述形狀：「spherical vase with narrow neck」
- 描述風格：「low-poly game asset of a sword」
`,
    tags: ["3D 建模", "Trellis", "HunYuan3D", "Rodin", "GLB", "VR"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：跨模態工作流串聯
  // ══════════════════════════════════════════════════════

  {
    id: "deep-cross-modal",
    category: "technique",
    title: "跨模態工作流串聯：圖 × 影 × 音 × 聲的進階組合技",
    summary:
      "深入學習如何串聯圖片、影片、音訊和語音四大模態，打造完整的多媒體作品。",
    content: `# 跨模態工作流串聯

## 什麼是跨模態串聯？

Healing Studio 的四大工作室（創作、圖片、影片、音樂配音）並非獨立運作，而是可以互相串聯、層層疊加。跨模態工作流就是將不同模態的輸出作為下一個模態的輸入，形成完整的創作管線。

---

## 核心串聯路徑

\`\`\`
文字 → 圖片 → 影片 → 配音 → 最終作品
  ↓       ↓       ↓       ↓
 提詞   概念圖   動態影片  完整影片
  ↓       ↓       ↓
 音樂   3D模型   說話頭像
\`\`\`

---

## 路徑 A：文字 → 圖片 → 影片

### 步驟
1. **文字提詞** → 圖片創作室 → 生成概念圖
2. **概念圖** → 影片工作室（I2V）→ 生成動態影片
3. **影片** → 畫質優化 → 最終影片

### 推薦模型組合

| 步驟 | 經濟方案 | 標準方案 | 頂級方案 |
|------|---------|---------|---------|
| 文字→圖 | Flux Schnell | Nano Banana Pro | Flux Pro 1.1 |
| 圖→影 | Wan 2.1 I2V | MiniMax I2V | Kling 2.1 I2V |
| 畫質 | — | ByteDance Upscale | Topaz Enhance |

### 關鍵技巧
- 生成概念圖時考慮構圖適合動態化
- 動態描述要具體（「微風吹動頭髮」比「動態畫面」好）
- 首幀控制：用生成的圖片作為 I2V 首幀

---

## 路徑 B：文字 → 音樂 + 音效 → 影片配音

### 步驟
1. **音樂描述** → 音樂配音創作室 → 生成背景音樂
2. **音效描述** → 生成環境音效
3. **旁白文字** → TTS → 生成語音旁白
4. **組合** → 在外部軟體合成

### 推薦工具

| 用途 | 推薦工具 | API |
|------|---------|-----|
| 背景音樂 | textToMusic（Sonauto） | \`trpc.proStudio.textToMusic\` |
| 環境音效 | soundEffects（ElevenLabs） | \`trpc.proStudio.soundEffects\` |
| 旁白 | ElevenLabs TTS | \`trpc.proStudio.elevenLabsTTS\` |
| 中文旁白 | Qwen TTS | \`trpc.proStudio.qwenTTS\` |

---

## 路徑 C：圖片 → 3D → VR 場景

### 步驟
1. **AI 生成風景圖** → 圖片創作室
2. **風景圖** → HunYuan World → 3D 世界場景
3. **角色概念圖** → HunYuan3D v3 → 3D 角色模型
4. **組合** → 在 3D 引擎中組裝場景

---

## 路徑 D：聲音 → 頭像 → 影片

### 步驟
1. **聲音克隆** → 複製真人聲紋
2. **克隆聲音** → 朗讀腳本文字
3. **AI 生成角色正面照** → 圖片創作室
4. **角色照 + 音訊** → EchoMimic → 說話頭像影片
5. **說話頭像** → 影片工作室 → 畫質優化

---

## 路徑 E：導演 AI 全自動編排

### 步驟
1. **導演 AI** → 接收創意概念
2. **CO-STAR 腳本** → 結構化輸出
3. **一鍵發送** → visualPrompt 到創作工作室
4. **一鍵發送** → musicVibe 到音樂配音
5. **一鍵發送** → audioScript 到 TTS
6. **手動串聯** → 各模態結果組合

---

## 一致性保險庫在串聯中的角色

### 角色一致性
- 在圖片生成時注入角色保險庫
- 同一角色在不同場景的概念圖保持一致
- 所有概念圖轉影片時角色外觀統一

### 場景一致性
- 在不同角度/時間的場景圖中注入場景保險庫
- 白天/夜晚版本的同一場景保持建築結構一致

---

## 費用優化策略

### 漸進式生成（推薦）
1. **快速模型測試**（低成本）→ 確認方向
2. **中等模型精修**（中成本）→ 調整細節
3. **頂級模型定稿**（高成本）→ 最終輸出

### 各路徑費用估算

| 路徑 | 經濟方案 | 頂級方案 |
|------|---------|---------|
| 文→圖→影 | ~5 點 | ~60 點 |
| 文→音+效+聲 | ~10 點 | ~25 點 |
| 圖→3D→場景 | ~15 點 | ~25 點 |
| 聲→頭像→影 | ~10 點 | ~30 點 |
| 全路徑組合 | ~40 點 | ~140 點 |

---

## 常見串聯問題

### Q：不同模型生成的風格不一致怎麼辦？
**A：** 使用一致性保險庫 + 相同的 seed + 相同的風格積木。LoRA 微調是最強的一致性保證。

### Q：影片轉場不自然怎麼辦？
**A：** 使用影片工作室的 RIFE 補幀工具平滑過渡，或使用 V2V 統一風格。

### Q：音頻和影片怎麼同步？
**A：** 先生成音頻（確定時長），再根據音頻時長生成對應長度的影片。
`,
    tags: ["跨模態", "工作流串聯", "進階", "多媒體", "組合技"],
    difficulty: "advanced",
    readingMinutes: 15,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：AI 監控中心
  // ══════════════════════════════════════════════════════

  {
    id: "deep-langsmith",
    category: "api-docs",
    title: "AI 監控中心（LangSmith）完整教學：追蹤、比較與微調",
    summary:
      "了解如何使用 LangSmith 監控 AI 行為、追蹤 LLM 調用鏈、比較模型效能和匯出微調資料。",
    content: `# AI 監控中心完整教學

## 什麼是 AI 監控中心？

AI 監控中心（/langsmith）是 Healing Studio 整合 LangSmith 的進階 AI 行為分析工具。它讓你能夠追蹤每一次 LLM 調用的輸入、輸出、延遲和成本，並進行模型間的效能比較。

**前置要求：** 設定 \`LANGSMITH_API_KEY\` 環境變數

---

## 五大功能分頁

### 1. 總覽（Overview）

顯示 AI 系統的整體健康狀態：
- **連線狀態**：LangSmith API 是否連接成功
- **專案資訊**：當前追蹤的專案名稱
- **每小時流量**：LLM 調用頻率趨勢
- **錯誤率**：失敗的調用比例
- **延遲分佈**：回應時間的統計圖

**API：** \`trpc.langsmith.overview\` / \`trpc.langsmith.healthCheck\`

### 2. 追蹤記錄（Traces / Runs）

瀏覽每一次 LLM 調用的詳細記錄：

| 欄位 | 說明 |
|------|------|
| Run ID | 唯一識別碼 |
| 名稱 | 調用的功能名稱 |
| 輸入 | 發送給 LLM 的 prompt |
| 輸出 | LLM 返回的結果 |
| 延遲 | 回應時間（毫秒） |
| Token | 輸入/輸出 Token 數 |
| 狀態 | 成功 / 失敗 |
| 標籤 | 自定義分類標籤 |

支援功能：
- **標籤篩選**：按功能標籤過濾（如 prompt-compiler、director-ai）
- **分頁瀏覽**：大量記錄的分頁導航
- **父子關係**：查看多步驟調用的層級結構

**API：** \`trpc.langsmith.runs\` / \`trpc.langsmith.runDetail\`

### 3. 模型比較（Comparison）

並排比較不同模型或不同配置的效能：
- 延遲對比
- Token 消耗對比
- 輸出品質對比
- 成本效益分析
- 雷達圖可視化

支援「盲測」模式：隱藏模型名稱，純粹根據輸出品質評分。

**API：** \`trpc.langsmith.comparison\`

### 4. 資料集（Datasets）

管理用於微調和評測的資料集：
- 查看現有資料集清單
- 將優質的 Run 加入資料集作為訓練樣本
- 資料集格式與 LangSmith 標準相容

**API：** \`trpc.langsmith.datasets\` / \`trpc.langsmith.createExample\`

### 5. 微調匯出（Export）

將高品質的 LLM 交互紀錄匯出為微調訓練資料：
- 按回饋評分篩選最佳樣本
- JSONL 格式輸出
- 可直接用於 LLM 微調訓練
- 支援自定義過濾條件

**API：** \`trpc.langsmith.exportMicroTuning\`

---

## 回饋收集

### 為 AI 回應評分
- 在追蹤記錄中對每次調用評分
- 👍 好 / 👎 差
- 回饋用於改善模型選擇和提詞品質

**API：** \`trpc.langsmith.createFeedback\`

---

## 監控最佳實踐

### 日常監控
1. 每天檢查「總覽」頁的錯誤率
2. 關注延遲異常的調用
3. 比較不同模型的成本效益

### 品質改善
1. 找出低評分的 Run
2. 分析輸入提詞的問題
3. 調整 AI Brain 的模型配置
4. 將優質樣本加入資料集

### 成本優化
1. 比較不同模型的 Token 消耗
2. 找出 Token 浪費最多的功能
3. 調整系統提詞減少不必要的輸出
`,
    tags: ["LangSmith", "AI 監控", "追蹤", "模型比較", "微調"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：費用優化策略
  // ══════════════════════════════════════════════════════

  {
    id: "deep-cost-optimization",
    category: "technique",
    title: "點數與費用優化完全策略",
    summary:
      "學會如何以最少的點數獲得最佳的創作效果，包含模型選擇策略、漸進式生成和預算管理。",
    content: `# 點數與費用優化完全策略

## 計費系統概覽

### 點數系統
- **1 USD ≈ 100 點數**
- 點數在 \`generate.prepareJob\` 時預先扣除
- 生成失敗時自動退款（\`refundUserQuota\`）
- Demo 模式下點數為虛擬（999 點）

### 成本層級
| 等級 | 點數範圍 | 適用 |
|------|---------|------|
| Economy | 1-2 點 | 快速測試、預覽 |
| Standard | 2-5 點 | 一般創作 |
| Premium | 3-10 點 | 高品質輸出 |
| Ultra | 35-55 點 | 影片生成、頂級品質 |

---

## 策略一：漸進式生成（最重要）

\`\`\`
快速預覽 → 中等品質 → 最終成品
（1-2 點）  （3-5 點）  （4-10 點）
\`\`\`

### 圖片漸進式
1. **Flux Schnell**（1 點）→ 快速確認構圖和主題
2. **Nano Banana 2**（2 點）→ 調整細節
3. **Flux Pro 1.1**（4 點）→ 最終成品

### 影片漸進式
1. **WAN T2V**（15 點/5秒）→ 概念驗證
2. **MiniMax**（20 點/5秒）→ 品質確認
3. **Kling V2.1 Pro**（49 點/5秒）→ 最終輸出

---

## 策略二：模型選擇矩陣

### 圖片生成
| 場景 | 推薦模型 | 點數 |
|------|---------|------|
| 快速測試 | Flux Schnell / Imagen 3 Fast | 1 |
| 中文場景 | Seedream v4 | 2 |
| 多圖參考 | Nano Banana Pro | 3 |
| 含文字設計 | Ideogram V2 | 4 |
| 最終成品 | Flux Pro 1.1 / Imagen 3 | 4 |

### 影片生成
| 場景 | 推薦模型 | 點數/5秒 |
|------|---------|----------|
| 快速原型 | WAN T2V / CogVideoX | 15 |
| 中文場景 | Kling 2.1 Standard | 20 |
| 商業品質 | Kling V2.1 Pro | 49 |
| 含音頻 | Veo 3 | 50 |

### 音訊/語音
| 場景 | 推薦模型 | 點數 |
|------|---------|------|
| 快速 TTS | Kokoro / ElevenLabs Flash | 1 |
| 中文旁白 | Qwen TTS | 1 |
| 專業配音 | ElevenLabs V3 | 4 |
| 背景音樂 | AudioLDM / MusicGen | 3 |
| 完整歌曲 | Suno V4 | 10 |

---

## 策略三：減少浪費

### 提詞品質 = 節省點數
- **精確的提詞** → 一次生成就滿意 → 省下重試費用
- **使用積木組合** → 保存成功配方 → 下次一鍵載入
- **參考上一次結果** → 用成功圖片作為參考，減少試錯

### 避免常見浪費
- ❌ 用頂級模型做快速測試（浪費 3-4 倍點數）
- ❌ 不寫負面提詞（容易出現不良效果需重試）
- ❌ 不使用 seed（每次結果完全不同難以微調）
- ❌ 忘記設定比例（裁切後不符需求需重做）

---

## 策略四：批量優化

### 系列創作
- 先用快速模型確定所有場景的構圖
- 全部確認後，再用高品質模型逐一生成
- 避免「邊想邊做」造成的點數浪費

### LoRA 投資回報
- 訓練 LoRA：~50 點
- 但每次使用時角色一致性更好 → 減少重試
- 10 次以上的系列創作就能回本

---

## 策略五：AI Brain 配置

### LLM 引擎優化
| 維度 | 省錢選擇 | 品質選擇 |
|------|---------|---------|
| 全站導演 | Gemini 2.5 Flash | Gemini 2.5 Pro |
| 新聞過濾 | Gemini 2.5 Flash | Gemini 2.5 Flash |
| 編譯器 | Gemini 2.5 Flash | Gemini 2.5 Pro |
| 光球語調 | Gemini 2.5 Flash | Gemini 2.5 Flash |
| RAG 向量 | Gemini 2.5 Flash | Gemini 2.5 Pro |

**提示：** 大多數場景使用 Flash 就足夠，只有最終成品需要 Pro。

---

## 預算規劃

### 個人創作者（每月 200 點）
- 20 張高品質圖片
- 5 個短影片（5 秒）
- 10 首背景音樂
- 20 次 TTS 旁白

### 小型團隊（每月 1000 點）
- 100 張圖片（混合品質）
- 15 個影片
- 3 個 LoRA 訓練
- 無限 TTS 和音效

### 查看即時消耗
在 **儀表板**（/dashboard）隨時檢視：
- 剩餘點數
- 7 日消耗趨勢
- 各模態消耗佔比
`,
    tags: ["費用優化", "點數", "成本", "策略", "模型選擇"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：FAQ 與疑難排解
  // ══════════════════════════════════════════════════════

  {
    id: "deep-faq",
    category: "getting-started",
    title: "常見問題與疑難排解（FAQ）",
    summary:
      "彙整 Healing Studio 使用過程中最常遇到的問題和解決方案，涵蓋登入、生成、訓練和系統問題。",
    content: `# 常見問題與疑難排解

## 登入相關

### Q：無法用 Google 登入？
**A：** 檢查以下項目：
1. \`GOOGLE_CLIENT_ID\` 和 \`GOOGLE_CLIENT_SECRET\` 是否正確設定
2. \`GOOGLE_REDIRECT_URI\` 是否與 Google Cloud Console 中的設定完全一致
3. 確認 OAuth 同意畫面已正確設定
4. 清除瀏覽器 Cookie 後重試

### Q：登入後自動跳出/Session 過期？
**A：** 
- JWT Session 有效期為 1 年
- 如果頻繁過期，檢查 \`JWT_SECRET\` 是否變更過（變更後所有舊 session 失效）
- 系統會自動顯示 AuthExpiredModal，重新登入即可
- HTTPS 環境下 Cookie 設定為 \`SameSite=None\`，確保瀏覽器未禁用第三方 Cookie

### Q：Demo 模式怎麼使用？
**A：** 不設定 \`DATABASE_URL\` 即進入 Demo 模式：
- 前往 \`/api/oauth/demo/start\` 登入
- Demo 帳號：Demo User, demo@healing-studio.ai
- 配額：999 點（虛擬，不扣除）
- 所有資料存在記憶體，重啟後清除

---

## 生成相關

### Q：生成結果是空白/Demo 圖片？
**A：** 這表示 API Key 未設定或餘額不足：
1. 檢查 \`FAL_API_KEY\` 是否已設定
2. 檢查 fal.ai 帳號餘額
3. 如果是 Demo 模式，生成結果會是 Unsplash 範例圖

### Q：生成超時失敗？
**A：** 不同模型有不同超時時間：
- 圖片：120 秒
- 影片：300 秒（Veo 3 / Sora：480 秒）
- 3D 建模：240-300 秒
- 影片增強：600 秒（Topaz）

如果經常超時：
- fal.ai 可能伺服器負載高，稍後重試
- 嘗試用較快的模型（如 Flux Schnell）
- 確認網路連線穩定

### Q：生成品質不如預期？
**A：** 提升品質的方法：
1. **改善提詞**：加入品質關鍵字（masterpiece, 8K, ultra detail）
2. **使用負面提詞**：排除不想要的元素
3. **選擇更高等級模型**：Economy → Standard → Premium
4. **使用參考圖**：提供風格或角色參考
5. **調整溫度**：降低溫度增加一致性

### Q：點數被扣了但沒有生成結果？
**A：** 如果生成失敗，系統會自動退款（\`refundUserQuota\`）。如果未退款：
- 查看「生成歷史」確認是否有失敗記錄
- 聯絡管理員手動調整配額

---

## LoRA 訓練相關

### Q：LoRA 訓練一直卡在 queued？
**A：** 
1. 確認 \`REPLICATE_API_TOKEN\` 已正確設定
2. Replicate 帳號可能需要付費方案才能訓練
3. 使用 \`trpc.loraTrainer.pollTraining\` 查詢即時狀態
4. 檢查管理員後台的背景任務狀態

### Q：訓練完但效果不好？
**A：** 
- 訓練圖片太少（建議 10-20 張）
- 圖片角度不夠多樣（需要正面、側面、背面等）
- Epochs 設定不當（太低 = 沒學會，太高 = 過擬合）
- 觸發詞在生成時沒有正確使用

### Q：如何判斷過擬合？
**A：** 過擬合的徵兆：
- 生成的圖片和訓練圖片幾乎一模一樣
- 改變提詞後主體外觀完全不變
- 無法產生新的姿勢或角度
- 解決方法：降低 Epochs、增加訓練圖片多樣性

---

## 系統相關

### Q：頁面載入很慢？
**A：** 
- 確認網路連線速度
- 清除瀏覽器快取
- 關閉不需要的瀏覽器擴充功能
- 如果是首次載入，Vite 會在背景打包資源

### Q：媒體無法下載？
**A：** 
- 下載使用 \`/api/proxy-download\` 代理
- 確認媒體 URL 的域名在白名單中
- fal.media URL 有時效性，過期需重新生成

### Q：上傳檔案失敗？
**A：** 
- 確認 fetch 請求包含 \`credentials: 'include'\`
- 檢查檔案大小是否超過伺服器限制
- 確認 S3/GCS 儲存服務已正確設定

### Q：如何回報 Bug？
**A：** 
1. 前往 **回饋中心**（/feedback）
2. 選擇類別：Bug 回報
3. 設定優先級
4. 詳細描述問題和重現步驟
5. 提交後管理員會收到通知

---

## 環境設定相關

### Q：最少需要設定哪些環境變數？
**A：** 
- **最低限度**（Demo 模式）：無需任何環境變數
- **基本功能**：\`FAL_API_KEY\`（圖片/影片生成）
- **完整功能**：\`DATABASE_URL\` + \`JWT_SECRET\` + \`GOOGLE_CLIENT_ID\` + \`GOOGLE_CLIENT_SECRET\` + \`GOOGLE_REDIRECT_URI\` + \`FAL_API_KEY\` + \`GEMINI_API_KEY\`

### Q：LLM 引擎的優先順序？
**A：** 
1. \`GEMINI_API_KEY\` → Gemini API 直接調用
2. \`GOOGLE_CLOUD_PROJECT_ID\` + \`GOOGLE_APPLICATION_CREDENTIALS_JSON\` → Vertex AI
3. 以上都沒有 → AI 功能降級（提詞直接使用原文）
`,
    tags: ["FAQ", "疑難排解", "常見問題", "登入", "生成", "LoRA"],
    difficulty: "beginner",
    readingMinutes: 15,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：安全性與隱私
  // ══════════════════════════════════════════════════════

  {
    id: "deep-security",
    category: "api-docs",
    title: "安全性與隱私保護說明",
    summary:
      "Healing Studio 的安全架構說明，包含認證機制、API 限流、內容安全策略和資料保護措施。",
    content: `# 安全性與隱私保護說明

## 認證與授權

### OAuth 2.0 認證
- 使用 **Google OAuth 2.0** 作為唯一登入方式
- 不儲存任何密碼
- JWT Token 存在 HttpOnly Cookie 中（防 XSS）
- HTTPS 環境啟用 Secure Flag

### Session 安全
- Cookie 名稱：\`hs-session\`
- 有效期：1 年
- HTTPS：\`Secure=true, SameSite=None\`
- HTTP：\`Secure=false, SameSite=Lax\`

### 角色權限
| 角色 | 權限 |
|------|------|
| user | 基本創作功能 |
| admin | 管理後台 + 學習文件 CRUD |
| super_admin | 不可被降級的頂級管理員 |

---

## API 安全

### 速率限制（Rate Limiting）
- 限制：300 次請求 / 15 分鐘（/api/ 路徑）
- 使用 express-rate-limit 中間件
- 超過限制返回 429 Too Many Requests

### Helmet 安全標頭
- 啟用所有 Helmet 預設安全標頭
- CSP（內容安全策略）因內聯腳本和 CDN 資源需求已停用
- 其他安全標頭正常運作：
  - X-Frame-Options
  - X-Content-Type-Options
  - Referrer-Policy
  - Strict-Transport-Security

### 代理下載白名單
\`/api/proxy-download\` 端點嚴格限制允許的域名：
\`\`\`
fal.media, cdn.fal.ai, v3.fal.media
storage.googleapis.com
r2.cloudflarestorage.com
amazonaws.com
replicate.delivery, pbxt.replicate.delivery
suno.ai, elevenlabs.io
images.unsplash.com (Demo)
www.soundhelix.com (Demo)
\`\`\`

未在白名單中的域名會被拒絕，防止 SSRF 攻擊。

---

## 內容安全

### 學習文件 XSS 防護
- 所有 Markdown 內容在渲染前先進行 HTML 標籤剝離
- 使用 \`stripHtmlTags()\` 移除所有原始 HTML 標籤
- 防止 \`<script>\`、\`<img onerror=...>\`、\`<style>\` 等注入

### 輸入驗證
- 所有 tRPC 端點使用 Zod Schema 驗證
- 字串長度限制（如標題 200 字、描述 500 字）
- 枚舉值嚴格驗證（如角色、狀態、模態）

---

## 資料保護

### 資料儲存
- 用戶資料存在 MySQL 資料庫
- 生成的媒體存在 fal.media CDN
- 上傳的檔案存在 S3 兼容儲存（GCS 或 AWS S3）
- RAG 記憶存在 Pinecone 向量資料庫

### 資料刪除
- 用戶可刪除自己的：生成歷史、資產、筆記、保險庫項目
- 管理員可管理所有用戶資料
- 刪除操作為永久操作

### Demo 模式安全
- 無資料庫時所有資料存在記憶體
- 伺服器重啟後所有 Demo 資料清除
- Demo 帳號無法存取真實用戶資料

---

## 基礎設施安全

### 資料庫連線
- 連線池配置：connectionLimit=10, maxIdle=5
- 閒置超時：60 秒
- KeepAlive：啟用
- 優雅關機：SIGTERM/SIGINT 時關閉連線池

### 背景任務安全
- Circuit Breaker 模式防止級聯故障
- 新聞抓取器：30 分鐘冷卻期
- 模型訓練 Worker：10 分鐘冷卻期
- 去重複鎖防止重疊執行

### 資料壓縮
- 啟用 compression 中間件
- 減少傳輸資料量

---

## 安全建議

### 管理員建議
1. 定期更換 \`JWT_SECRET\`（會使所有現有 session 失效）
2. 限制 ADMIN_EMAILS 環境變數中的帳號數量
3. 監控 API 使用量避免濫用
4. 定期審查用戶角色和配額

### 用戶建議
1. 不要在公開場合分享 API Key
2. 使用強密碼的 Google 帳號
3. 定期檢查儀表板的使用記錄
4. 發現異常使用通過回饋中心回報
`,
    tags: ["安全性", "隱私", "OAuth", "Rate Limit", "XSS", "CORS"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 深度指南：個人設定與 AI Brain
  // ══════════════════════════════════════════════════════

  {
    id: "deep-settings",
    category: "getting-started",
    title: "個人設定與 AI 大腦配置完整教學",
    summary:
      "了解如何自訂導演 AI 偏好、調整 AI 大腦的 5 維度推理引擎和 4 種生成引擎配置。",
    content: `# 個人設定與 AI 大腦配置完整教學

## 個人設定（/settings）

### 個人資訊
顯示你的帳號基本資訊：
- 顯示名稱（來自 Google 帳號）
- Email
- 角色（user / admin）
- 剩餘配額（點數）

### 導演 AI 偏好

| 設定項 | 選項 | 說明 |
|--------|------|------|
| 預設人格 | 🧘 沉穩 / 🎨 創意 / ⚙️ 技術 | 導演 AI 每次啟動的預設人格 |
| 輸出框架 | CO-STAR / SSLCM / SELCM / Free | 腳本結構化格式 |
| 自定義系統提示 | 自由文字 | 額外的個人風格指引 |

### 框架說明

| 框架 | 全名 | 特點 |
|------|------|------|
| CO-STAR | Context/Objective/Style/Tone/Audience/Response | 最完整，適合商業製作 |
| SSLCM | Situation/Style/Length/Content/Mood | 精簡版 |
| SELCM | Setting/Emotion/Lighting/Composition/Medium | 視覺導向 |
| Free | 自由格式 | 不限制結構 |

**API：** \`trpc.director.preferences.get\` / \`trpc.director.preferences.update\`

---

## AI 大腦設定（/settings/ai-brain）

AI 大腦是 Healing Studio 的智能核心，讓你為不同功能指定最適合的模型。

### 5 大推理引擎（Reasoning Brain）

| 維度 | 負責功能 | 推薦（品質） | 推薦（速度） |
|------|---------|-------------|-------------|
| 全站導演 | 提詞編譯、導演 AI 對話 | Gemini 2.5 Pro | Gemini 2.5 Flash |
| 新聞過濾 | AI 新聞抓取和摘要 | Gemini 2.5 Flash | Gemini 2.5 Flash |
| 編譯器 | 進階提詞編譯、敘事 | Gemini 2.5 Pro | Gemini 2.5 Flash |
| 光球語調 | 光球夥伴的對話生成 | Gemini 2.5 Flash | Gemini 2.5 Flash |
| RAG 向量 | RAG 記憶查詢和摘要 | Gemini 2.5 Flash | Gemini 2.5 Flash |

### 4 大生成引擎（Generation Engine）

| 維度 | 負責功能 | 引擎選項 |
|------|---------|---------|
| 文字→圖片 | 主要圖片生成 | Flux Pro / Dev / Schnell / SD3 / Imagen 3 |
| 文字→影片 | 主要影片生成 | Kling V2.1 / WAN / Veo 3 |
| 文字→音訊 | 音樂生成 | Stable Audio / Suno |
| 文字→語音 | TTS 語音 | ElevenLabs / Kokoro |

### 引擎等級系統

| 等級 | 圖示 | 速度 | 品質 | 費用 |
|------|------|------|------|------|
| Fast ⚡ | 閃電 | 最快 | 標準 | 最低 |
| Standard | — | 中等 | 良好 | 中等 |
| Premium ✦ | 星號 | 較慢 | 最高 | 較高 |

### 健康狀態監控

每個引擎都有健康狀態指示器：
- 🟢 綠色：正常運作
- 🔴 紅色：連線失敗或超過失敗閾值
- 系統會追蹤連續失敗次數
- 超過閾值時自動降級到備用引擎
- 可手動重設健康狀態

### 引擎配置匯入/匯出

支援以 JSON 格式匯入/匯出整套 Brain 配置：
- 方便在不同環境間遷移設定
- 或分享推薦配置給團隊成員

**API：**
- \`trpc.brain.get\` — 取得當前配置
- \`trpc.brain.upsert\` — 更新配置
- \`trpc.brain.catalog\` — 取得所有可用引擎目錄
- \`trpc.brain.pricingSummary\` — 各引擎定價
- \`trpc.brain.healthStatus\` — 健康狀態
- \`trpc.brain.pingProviders\` — Ping 各提供商延遲

---

## 推薦配置

### 經濟配置（最低成本）
- 所有推理引擎：Gemini 2.5 Flash
- 圖片：Flux Schnell
- 影片：WAN T2V
- TTS：Kokoro

### 均衡配置（推薦）
- 導演+編譯器：Gemini 2.5 Pro
- 其他推理：Gemini 2.5 Flash
- 圖片：Flux Dev
- 影片：Kling V2.1 Standard
- TTS：ElevenLabs Turbo

### 頂級配置（最高品質）
- 所有推理引擎：Gemini 2.5 Pro
- 圖片：Flux Pro 1.1
- 影片：Kling V2.1 Pro
- TTS：ElevenLabs V3
`,
    tags: ["個人設定", "AI Brain", "引擎配置", "推理引擎", "生成引擎"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 積分系統完整說明
  // ══════════════════════════════════════════════════════

  {
    id: "gs-credits-system",
    category: "getting-started",
    title: "積分加扣分機制完整說明",
    summary:
      "詳細說明 Healing Studio 的積分系統，包含取得方式、扣除規則、退還機制與各模型費率表。本平台不使用信用卡或真實金錢，所有操作皆以平台積分計費。",
    content: `# 🎯 積分加扣分機制完整說明

> **重要聲明：** Healing Studio 平台 **不使用信用卡或任何真實金錢**。所有生成操作均以「平台積分（Points）」計費，積分由平台免費發放與獎勵，無需任何付費。

---

## 📌 基本概念

| 項目 | 說明 |
|------|------|
| 計費單位 | **平台積分（Points / pts）** |
| 新帳號贈送 | **50 積分** |
| 最小扣除 | **1 積分** |
| 最大單次扣除 | **500 積分**（安全上限） |
| 真實金錢 | ❌ **不涉及任何真實金錢交易** |
| 信用卡 | ❌ **不需要綁定信用卡** |

---

## 💰 積分取得方式

### 1. 新帳號註冊獎勵
- 每位新用戶註冊後自動獲得 **50 積分**

### 2. 分享數位資產獎勵
- 將你的圖片、影片、音樂等作品分享至「共享空間」
- **首次分享** 可獲得 **+2 積分**
- 注意：同一作品僅限首次分享時獲得獎勵，重複切換不再重複加分

### 3. 分享訓練模型獎勵
- 將訓練完成（Ready）的 AI 模型分享至共享空間
- **首次分享** 可獲得 **+3 積分**
- 注意：模型必須為「已完成」狀態且僅限首次分享

### 4. 管理員手動加分
- 平台管理員可依活動或需求手動調整用戶積分

---

## 📉 積分扣除規則

### 扣除時機
積分在 **生成開始前** 即先扣除（原子鎖定機制），確保不會超額使用。

### 扣除流程
1. 系統根據所選模型與參數 **估算積分費用**
2. 使用資料庫交易鎖（FOR UPDATE）**原子扣除**
3. 若積分不足，立即提示錯誤，**不會執行生成**
4. 扣除成功後，開始執行 AI 生成任務

### 積分不足時
系統會顯示：「積分不足（需要 X pts，剩餘 Y pts）」，並建議聯繫管理員。

---

## 🔄 積分退還機制

當生成任務失敗時，系統會 **自動全額退還** 已扣除的積分：

| 失敗原因 | 是否退還 |
|----------|----------|
| 安全檢查未通過（內容不符規範） | ✅ 全額退還 |
| 圖片生成 API 錯誤 | ✅ 全額退還 |
| 影片生成 API 錯誤 | ✅ 全額退還 |
| 音樂生成 API 錯誤 | ✅ 全額退還 |
| 語音生成 API 錯誤 | ✅ 全額退還 |
| 任務逾時 | ✅ 全額退還 |
| 生成成功 | ❌ 不退還（正常扣除） |

---

## 🖼️ 圖片生成費率

| 模型 | 等級 | 基礎積分 | 單位 |
|------|------|----------|------|
| Flux Schnell | 經濟 | 1 pts | 每張圖片 |
| Imagen 3 Fast | 經濟 | 1 pts | 每張圖片 |
| SD3 Medium | 標準 | 2 pts | 每張圖片 |
| AuraFlow | 標準 | 2 pts | 每張圖片 |
| Flux Dev | 進階 | 3 pts | 每張圖片 |
| Flux Pro 1.1 | 進階 | 4 pts | 每張圖片 |
| Ideogram V2 | 進階 | 4 pts | 每張圖片 |
| Imagen 3 | 進階 | 4 pts | 每張圖片 |
| Vertex Imagen 3 | 進階 | 5 pts | 每張圖片 |

---

## 🎬 影片生成費率

影片生成以 **基礎積分 + 時長延伸** 計費：

| 模型 | 等級 | 基礎積分 | 每秒加收 | 單位 |
|------|------|----------|----------|------|
| WAN T2V 2.1 | 標準 | 15 pts | 3 pts/s | 每5秒 |
| CogVideoX 5B | 標準 | 15 pts | 2.5 pts/s | 每6秒 |
| MiniMax Hailuo | 標準 | 20 pts | 3.3 pts/s | 每6秒 |
| Luma Dream Machine | 進階 | 30 pts | 6 pts/s | 每5秒 |
| Kling V1.5 Pro | 進階 | 35 pts | 7 pts/s | 每5秒 |
| Veo 2 (Gemini) | 頂級 | 35 pts | 7 pts/s | 每5秒 |
| Kling V2.1 Pro | 頂級 | 49 pts | 9.8 pts/s | 每5秒 |
| Veo 3 Preview | 頂級 | 50 pts | 10 pts/s | 每5秒 |

**計費範例：** 使用 Kling V2.1 Pro 生成 10 秒影片 = max(49, 10 × 9.8) = **98 pts**

---

## 🎵 音樂 / 音效生成費率

| 模型 | 等級 | 基礎積分 | 時長加收 | 單位 |
|------|------|----------|----------|------|
| AudioLDM 2 | 標準 | 3 pts | 0.3 pts/s | 每10秒 |
| MusicGen | 標準 | 3 pts | 0.2 pts/s | 每15秒 |
| ElevenLabs 音效 | 標準 | 3 pts | — | 每次生成 |
| MMAudio V2 | 標準 | 4 pts | 0.27 pts/s | 每15秒 |
| Stable Audio | 進階 | 5 pts | 0.17 pts/s | 每30秒 |
| Suno V3.5 | 標準 | 6 pts | — | 每首歌曲 |
| ACE-Step | 進階 | 8 pts | 0.13 pts/s | 每60秒 |
| Lyria 2 | 進階 | 8 pts | 0.27 pts/s | 每30秒 |
| Suno V4 | 進階 | 10 pts | — | 每首歌曲 |
| ElevenLabs Music | 進階 | 10 pts | 0.33 pts/s | 每30秒 |

---

## 🗣️ 語音合成（TTS）費率

語音按 **字符數** 計費：

| 模型 | 等級 | 基礎積分 | 每千字符 |
|------|------|----------|----------|
| Gemini TTS Flash | 經濟 | 1 pts | 1 pts |
| Kokoro TTS | 經濟 | 1 pts | 1 pts |
| ElevenLabs Turbo V2.5 | 經濟 | 1 pts | 1 pts |
| ElevenLabs Flash V2.5 | 經濟 | 1 pts | 1 pts |
| Gemini TTS Pro | 標準 | 2 pts | 2 pts |
| Orpheus TTS | 標準 | 2 pts | 2 pts |
| Dia TTS | 標準 | 2 pts | 2 pts |
| ElevenLabs Multilingual V2 | 進階 | 3 pts | 3 pts |
| ElevenLabs V3 | 進階 | 4 pts | 4 pts |
| PlayAI TTS | 進階 | 4 pts | 4 pts |
| MetaVoice V1 | 進階 | 5 pts | 5 pts |

**計費範例：** 使用 ElevenLabs V3 朗讀 5000 字 = ceil(5000/1000) × 4 = **20 pts**

---

## 🧊 3D 模型生成費率

| 模型 | 等級 | 基礎積分 |
|------|------|----------|
| Stable Zero123 | 標準 | 4 pts |
| Zero123++ | 標準 | 4 pts |
| TripoSR | 標準 | 5 pts |
| DreamGaussian | 標準 | 8 pts |
| Trellis 3D | 進階 | 10 pts |
| MV-Adapter | 進階 | 12 pts |
| Fantasia3D | 進階 | 12 pts |
| Hyper3D Rodin | 進階 | 15 pts |
| Meshy 4 | 進階 | 20 pts |

---

## 🏋️ 模型訓練費率

| 模型 | 等級 | 基礎積分 | 每步驟加收 |
|------|------|----------|-----------|
| SD3 LoRA 訓練 | 進階 | 150 pts | 0.08 pts/步 |
| Flux LoRA 快速訓練 | 頂級 | 200 pts | 0.1 pts/步 |
| Flux LoRA 人像訓練 | 頂級 | 250 pts | 0.12 pts/步 |
| DreamBooth Flux | 頂級 | 300 pts | 0.15 pts/步 |
| CogVideoX LoRA 訓練 | 頂級 | 500 pts | 0.2 pts/步 |

---

## 📊 計費公式

\`\`\`
最終積分 = max(最低積分, min(最高積分,
  基礎積分 + 時長加收 + 字符加收 + 批次加收 + 步驟加收
))
\`\`\`

每個模型都有 **最低** 和 **最高** 積分限制，防止異常計費。

---

## ❓ 常見問題

**Q: 積分用完了怎麼辦？**
A: 可以透過分享作品獲得獎勵積分，或聯繫平台管理員申請加分。

**Q: 生成失敗會扣積分嗎？**
A: 不會！所有失敗的生成任務會自動全額退還積分。

**Q: 積分有使用期限嗎？**
A: 目前沒有使用期限，積分永久有效。

**Q: 需要付費或綁定信用卡嗎？**
A: **完全不需要！** 本平台所有功能均以免費積分運作，不涉及任何真實金錢交易。

**Q: 示範模式（Demo）會扣積分嗎？**
A: 不會。示範模式使用範例素材，不消耗積分。

**Q: 在哪裡查看我的積分餘額？**
A: 側邊欄下方的「剩餘配額」卡片即可即時查看，也可前往「積分說明」頁面查看完整資訊。
`,
    tags: ["積分", "扣分", "加分", "費率", "計費", "退還", "入門指南"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-prompt-library",
    category: "api-docs",
    title: "提示詞庫系統完整說明",
    summary: "提示詞庫（Prompt Library）的 DB schema、tRPC API、前端使用方式完整指南。",
    content: `# 提示詞庫系統說明

## 概覽

提示詞庫（/prompt-library）是用來管理、收藏和分享 AI 提示詞的系統。支援個人提示詞管理和公開社群廣場。

---

## DB Schema：prompt_library 表

\`\`\`sql
CREATE TABLE prompt_library (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  userId        INT NOT NULL,
  title         VARCHAR(256) NOT NULL,
  content       TEXT NOT NULL,           -- 完整提示詞內容
  category      VARCHAR(64) DEFAULT 'general',  -- image/video/audio/voice/story/system/general
  tags          JSON,                    -- string[]
  isFavorite    BOOLEAN DEFAULT FALSE,
  isPublic      BOOLEAN DEFAULT FALSE,
  useCount      INT DEFAULT 0,
  modelHint     VARCHAR(128),            -- 建議使用的模型 ID（e.g. fal-ai/wan）
  language      VARCHAR(8) DEFAULT 'zh',
  createdAt     TIMESTAMP DEFAULT NOW(),
  updatedAt     TIMESTAMP DEFAULT NOW() ON UPDATE NOW(),
  INDEX pl_userId_idx (userId),
  INDEX pl_category_idx (category)
);
\`\`\`

---

## tRPC API 端點

所有端點掛載於 \`trpc.promptLibrary.*\`，均需登入（protectedProcedure）。

| 端點 | 說明 |
|------|------|
| \`list\` | 分頁列出我的提示詞（支援 category/search/favoritesOnly 篩選） |
| \`listPublic\` | 公開廣場（依 useCount 熱門排序） |
| \`getById\` | 取得單一提示詞 |
| \`create\` | 新增提示詞 |
| \`update\` | 更新（限本人） |
| \`delete\` | 刪除（限本人） |
| \`toggleFavorite\` | 切換收藏 |
| \`incrementUseCount\` | 使用次數 +1（複製時呼叫） |
| \`adminSeed\` | 管理員批次種子（admin only） |

---

## 前端頁面：/prompt-library

- **我的提示詞** tab：搜尋 + 分類篩選 + 只看收藏 toggle
- **公開廣場** tab：熱門提示詞排行
- **新增/編輯 Dialog**：標題、內容、分類、標籤、公開 switch、建議模型
- 複製按鈕：複製到剪貼簿 + 自動呼叫 incrementUseCount

---

## 使用範例

\`\`\`typescript
// 新增提示詞
const result = await trpc.promptLibrary.create.mutate({
  title: "電影感人像",
  content: "cinematic portrait, golden hour lighting, shallow depth of field, 8K",
  category: "image",
  tags: ["電影感", "人像", "黃金時刻"],
  isPublic: true,
  modelHint: "fal-ai/flux/schnell",
});

// 列出我的收藏提示詞
const data = await trpc.promptLibrary.list.query({
  favoritesOnly: true,
  page: 1,
  pageSize: 20,
});
\`\`\`
`,
    tags: ["提示詞庫", "prompt-library", "schema", "tRPC", "API"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-pinecone-rag",
    category: "api-docs",
    title: "Pinecone RAG 向量記憶系統",
    summary: "AI 如何用 Pinecone 記住你的創作風格偏好，dimension=1024，llama-text-embed-v2。",
    content: `# Pinecone RAG 向量記憶系統

## 概覽

RAG（Retrieval-Augmented Generation）記憶系統讓 AI 能夠記住用戶的創作歷史和偏好，在每次生成前從 Pinecone 檢索最相關的 3 筆記憶，並注入 System Prompt。

---

## 設定資訊

| 項目 | 值 |
|------|-----|
| **Index 名稱** | \`ai-director-memories\` |
| **Dimension** | **1024**（llama-text-embed-v2） |
| **Metric** | cosine |
| **Cloud** | AWS us-east-1（Serverless Free Tier） |
| **Embedding 模型** | Gemini text-embedding-004（768 維 → 補零至 1024） |

> ⚠️ **重要**：Index dimension 必須與 Pinecone 建立時設定一致（1024）。
> 目前使用 Gemini embedding（768 維）補零至 1024 維以確保相容。
> 未來可改用 Pinecone Inference API 直接呼叫 llama-text-embed-v2。

---

## 環境變數

\`\`\`env
PINECONE_API_KEY=pcsk_Thp6j_...
PINECONE_INDEX_NAME=ai-director-memories
PINECONE_ENVIRONMENT=us-east-1
\`\`\`

---

## 核心檔案：server/services/ragMemory.ts

### 主要函式

| 函式 | 說明 |
|------|------|
| \`upsertMemory(record)\` | 儲存生成記憶到 Pinecone |
| \`queryMemories(userId, prompt, topK)\` | 檢索最相關的 K 筆記憶 |
| \`buildMemoryContext(userId, prompt)\` | 生成注入 System Prompt 的記憶摘要 |
| \`ensurePineconeIndex()\` | 確保 index 存在（啟動時呼叫） |

### 記憶觸發時機

1. 用戶生成圖片/影片/音訊/語音完成後 → \`upsertMemory()\` 自動記錄
2. 下次生成前 → \`buildMemoryContext()\` 注入前 3 筆相關記憶
3. 記憶失敗時靜默降級，不影響主生成流程

---

## 向量化的內容

每筆記憶向量化的文字包含：
- 提示詞內容（前 2000 字）
- 生成模態（image/video/audio/voice）
- 靈感積木 ID（vibeCardIds）
- 生成結果摘要

Pinecone metadata 欄位：userId, generationId, prompt, generationType, vibeCardIds, rating, timestamp
`,
    tags: ["Pinecone", "RAG", "向量", "記憶", "embedding", "llama"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-fal-webhook",
    category: "api-docs",
    title: "fal.ai Webhook 持久化機制",
    summary: "fal.ai 非同步生成完成後如何透過 Webhook 持久化結果到資料庫。",
    content: `# fal.ai Webhook 持久化機制

## 概覽

fal.ai 支援長時間生成任務（影片生成可能需要 2-5 分鐘），透過 Webhook 在任務完成時主動通知後端，避免 client 長時間 polling。

---

## Webhook 端點

\`\`\`
POST /api/webhook/fal
\`\`\`

實作位置：\`server/routes/webhookFal.ts\`
掛載位置：\`server/_core/index.ts\` → \`app.use(falWebhookRouter)\`

---

## 環境變數設定

\`\`\`env
# 完整的 Webhook URL，告訴 fal.ai 回傳結果到哪裡
VITE_SITE_URL=https://healing-studio-production.up.railway.app
\`\`\`

fal.ai 呼叫時自動組合：\`\${VITE_SITE_URL}/api/webhook/fal\`

---

## 請求流程

\`\`\`
[用戶點擊生成]
    ↓
[後端呼叫 falQueueSubmit()]
    ↓ （帶入 webhookUrl）
[fal.ai 接受任務，回傳 requestId]
    ↓ （2-5 分鐘後）
[fal.ai POST /api/webhook/fal]
    ↓
[webhookFal.ts 接收]
    ↓
[查詢 backgroundJobs 表，更新 status=completed, resultJson]
    ↓
[前端 SSE/polling 偵測到完成，顯示結果]
\`\`\`

---

## Webhook Payload 格式

\`\`\`json
{
  "request_id": "fal-xxx-yyy",
  "status": "COMPLETED",
  "payload": {
    "images": [{ "url": "https://..." }],
    "videos": [{ "url": "https://..." }]
  }
}
\`\`\`

---

## 核心程式碼

\`\`\`typescript
// server/services/falDispatcher.ts
const webhookUrl = serverEnv.VITE_SITE_URL
  ? \`\${serverEnv.VITE_SITE_URL}/api/webhook/fal\`
  : undefined;

await falQueueSubmit(modelId, input, { webhookUrl });
\`\`\`

> ⚠️ **注意**：\`VITE_SITE_URL\` 需在 Railway 手動設定為正式網域，
> 本地開發時 fal.ai 無法回呼 localhost，需用 ngrok 等工具。
`,
    tags: ["fal.ai", "webhook", "非同步", "持久化", "生成"],
    difficulty: "intermediate",
    readingMinutes: 7,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "gs-env-vars",
    category: "getting-started",
    title: "環境變數完整設定指南（Railway）",
    summary: "Healing Studio 所有環境變數的說明、設定位置與注意事項。",
    content: `# 環境變數完整設定指南

## 設定位置

所有環境變數在 **Railway Dashboard** → 你的專案 → Variables 中設定。
GitHub push 後會自動重新部署並套用新變數。

---

## 必填變數

### 資料庫
\`\`\`env
DATABASE_URL=mysql://root:password@mainline.proxy.rlwy.net:32933/railway
\`\`\`

### Google OAuth
\`\`\`env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REDIRECT_URI=https://your-domain.up.railway.app/api/auth/google/callback
\`\`\`

### JWT
\`\`\`env
JWT_SECRET=（至少 32 字元的隨機字串）
\`\`\`

---

## AI 服務 API Keys

| 變數名稱 | 服務 | 說明 |
|----------|------|------|
| \`FAL_KEY\` | fal.ai | 主要生成 API（圖片/影片/音訊） |
| \`GEMINI_API_KEY\` | Google Gemini | LLM + Embedding |
| \`ELEVENLABS_API_KEY\` | ElevenLabs | TTS 語音合成（需關閉「限制鍵」） |
| \`PINECONE_API_KEY\` | Pinecone | RAG 向量記憶 |
| \`PINECONE_INDEX_NAME\` | Pinecone | 固定值：\`ai-director-memories\` |
| \`PINECONE_ENVIRONMENT\` | Pinecone | 固定值：\`us-east-1\` |
| \`REPLICATE_API_TOKEN\` | Replicate | 備用模型平台 |
| \`LANGSMITH_API_KEY\` | LangSmith | LLM 追蹤分析 |
| \`LANGSMITH_PROJECT\` | LangSmith | 固定值：\`網站\` |
| \`NVIDIA_API\` | NVIDIA NIM | Orb AI 代理人（備用） |
| \`BRAVE_SEARCH_API_KEY\` | Brave Search | Learn Hub 文章搜尋 |

---

## Cloudflare R2 儲存

\`\`\`env
S3_ENDPOINT=https://481637fcf27f301c0dc03b8e40a6f645.r2.cloudflarestorage.com
S3_BUCKET_NAME=bruce
S3_ACCESS_KEY_ID=（R2 API Token 的 Access Key）
S3_SECRET_ACCESS_KEY=（R2 API Token 的 Secret Key）
S3_PUBLIC_DOMAIN=https://pub-1d17422fbdc74137aec6c99f88a78ee2.r2.dev
\`\`\`

---

## 網站設定

\`\`\`env
VITE_SITE_URL=https://healing-studio-production.up.railway.app
# fal.ai webhook 會使用此 URL，必須為公開可訪問的網域
# 本地開發時可省略（webhook 功能會降級為 polling）
\`\`\`

---

## Stripe（Roadmap，尚未啟用）

\`\`\`env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
# 設定後 stripeWebhookRouter (/api/webhooks/stripe) 才會執行 HMAC 驗證
\`\`\`

---

## 常見問題

**Q: ElevenLabs 回傳 401 或 403？**
A: 登入 ElevenLabs → API Keys → 確認該 Key 未開啟「限制鍵」toggle，否則 text_to_speech 無權限。

**Q: Pinecone upsert 失敗？**
A: 確認 index 已在 Pinecone Dashboard 建立，名稱為 \`ai-director-memories\`，dimension=1024。

**Q: fal.ai webhook 沒有觸發？**
A: 確認 \`VITE_SITE_URL\` 已設定為正式網域（不能是 localhost），且 /api/webhook/fal 端點可公開訪問。
`,
    tags: ["環境變數", "Railway", "設定", "API Key", "入門"],
    difficulty: "beginner",
    readingMinutes: 10,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-db-schema",
    category: "api-docs",
    title: "完整資料庫 Schema 說明（23 張表）",
    summary: "Healing Studio 所有資料庫表的欄位定義、用途說明和關聯關係。",
    content: `# 完整資料庫 Schema 說明

資料庫：MySQL（Railway）
ORM：Drizzle ORM
連線：透過 \`getDb()\` 取得 lazy-initialized connection pool

---

## 表一覽（23 張）

### 核心用戶

**users** — 用戶帳號
\`\`\`
id, openId（Google/GitHub）, name, email, loginMethod,
role（user/admin）, quotaJson, remainingGenerations,
onboardingDone, createdAt, updatedAt, lastSignedIn
\`\`\`

**userAiBrain** — AI 大腦組態
\`\`\`
id, userId（unique）, modelConfig JSON, vibeConfig JSON,
systemPrompt, createdAt, updatedAt
\`\`\`

**userModelSwitchLogs** — 模型切換歷史
\`\`\`
id, userId, fromModel, toModel, reason, createdAt
\`\`\`

**aiDirectorPreferences** — 導演 AI 偏好
\`\`\`
id, userId（unique）, stylePresets JSON, colorPalette JSON,
narrativeStyle, updatedAt
\`\`\`

---

### 生成與資產

**generationHistory** — 生成歷史
\`\`\`
id, userId, modality（image/video/audio/voice）,
prompt, modelId, resultUrl, metadata JSON,
backgroundJobId, rating, createdAt
\`\`\`

**backgroundJobs** — 後台非同步任務
\`\`\`
id, userId, jobType, status（queued/processing/completed/failed/cancelled）,
progress, progressMessage, resultJson, errorMessage, createdAt, updatedAt
索引：userId_status_idx, userId_createdAt_idx
\`\`\`

**digitalAssetLibrary** — 數位資產庫
\`\`\`
id, userId, title, description, assetType, fileUrl,
thumbnailUrl, metadata JSON, tags JSON, isPublic,
downloadCount, createdAt, updatedAt
\`\`\`

---

### 一致性保險庫

**consistencyVault** — 角色/場景一致性卡片
\`\`\`
id, userId, name, type（character/scene/style）,
imageUrl, description, traits JSON, createdAt, updatedAt
\`\`\`

---

### 提示詞與積木

**promptLibrary** — 提示詞庫（新增）
\`\`\`
id, userId, title, content, category, tags JSON,
isFavorite, isPublic, useCount, modelHint, language,
createdAt, updatedAt
索引：pl_userId_idx, pl_category_idx
\`\`\`

**customBlocks** — 自定義靈感積木
\`\`\`
id, userId, label, emoji, prompt, category,
likeCount, useCount, tags JSON, createdAt, updatedAt
\`\`\`

**customBlocksCombo** — 積木組合
\`\`\`
id, userId, name, description, blockIds JSON,
likeCount, useCount, tags JSON, createdAt, updatedAt
\`\`\`

---

### 模型訓練

**fineTunedModels** — LoRA 訓練模型
\`\`\`
id, userId, name, description, baseModel,
status（pending/training/completed/failed）,
replicateTrainingId, modelUrl, triggerWord,
sampleImages JSON, createdAt, updatedAt
\`\`\`

---

### 訂閱與金流

**subscriptionPlans** — 訂閱方案定義
\`\`\`
id, planId（unique）, name, monthlyCredits,
priceUsd, features JSON, isActive, createdAt
\`\`\`

**userSubscriptions** — 用戶訂閱（Stripe，新增）
\`\`\`
id, userId（unique）, stripeCustomerId, stripeSubscriptionId,
planId, status, currentPeriodStart, currentPeriodEnd,
cancelAtPeriodEnd, createdAt, updatedAt
\`\`\`

---

### 運營監控

**apiUsageLogs** — API 使用量記錄
\`\`\`
id, userId, service, endpoint, tokens, cost,
statusCode, createdAt
\`\`\`

**externalServiceSubscriptions** — 外部服務訂閱管理（新增）
\`\`\`
id, serviceName, planName, monthlyCostUsd,
billingCycle, nextRenewalDate, apiKeyEnvVar,
apiKeyStatus（valid/invalid/unknown）, workspaceName,
ownerEmail, riskLevel, notes, createdAt, updatedAt
\`\`\`

**r2StorageSnapshots** — R2 儲存每日快照（新增）
\`\`\`
id, snapshotDate, totalBytes, totalObjects,
bytesByType JSON, objectsByType JSON,
estimatedMonthlyCostUsd, createdAt
\`\`\`

**systemSettings** — 系統全域設定
\`\`\`
id, key（unique）, value JSON, description, updatedAt
\`\`\`

---

### 內容與社群

**newsArticles** — AI 新聞文章
\`\`\`
id, title, summary, content, sourceUrl（unique）,
source, publishedAt, imageUrl, tags JSON, createdAt
索引：publishedAt_idx, sourceUrl_idx
\`\`\`

**featuredShowcase** — 精選展示牆
\`\`\`
id, userId, title, description, imageUrl,
videoUrl, modality, likes, createdAt
\`\`\`

**projectNotesCalendar** — 筆記日曆
\`\`\`
id, userId, title, content, date, type,
tags JSON, createdAt, updatedAt
\`\`\`

**userFeedbackReports** — 用戶回饋
\`\`\`
id, userId, type, title, description,
status（open/in-progress/resolved）,
priority, createdAt, updatedAt
\`\`\`
`,
    tags: ["資料庫", "schema", "MySQL", "Drizzle", "表結構"],
    difficulty: "advanced",
    readingMinutes: 15,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-endpoints-catalog",
    category: "api-docs",
    title: "完整 API 端點目錄（tRPC + REST）",
    summary: "Healing Studio 所有 tRPC router 端點和 REST 端點的完整目錄與說明。",
    content: `# 完整 API 端點目錄

## tRPC（主要 API）

基礎路徑：\`/trpc/\`
認證：所有 protectedProcedure 需要有效 JWT cookie（登入後自動設定）

### trpc.brain.*（大腦組態）
| 端點 | 類型 | 說明 |
|------|------|------|
| catalog | query | 取得所有模型目錄 |
| get | query | 取得用戶大腦組態 |
| upsert | mutation | 更新大腦組態 |
| healthStatus | query | 所有 AI 服務健康狀態 |
| pingProviders | query | 即時 ping 所有 AI 提供商 |
| monitorSummary | query | 監控摘要 |
| webSearch | query | Brave 搜尋 |
| adminSeed | mutation | 管理員種子資料（admin） |

### trpc.promptLibrary.*（提示詞庫）
| 端點 | 類型 | 說明 |
|------|------|------|
| list | query | 分頁列出我的提示詞 |
| listPublic | query | 公開廣場 |
| getById | query | 取得單一提示詞 |
| create | mutation | 新增 |
| update | mutation | 更新（限本人） |
| delete | mutation | 刪除（限本人） |
| toggleFavorite | mutation | 切換收藏 |
| incrementUseCount | mutation | 使用次數 +1 |
| adminSeed | mutation | 批次種子（admin） |

### trpc.externalServices.*（外部服務管理）
| 端點 | 類型 | 說明 |
|------|------|------|
| list | query | 列出所有服務（admin） |
| summary | query | 月費摘要 + 狀態統計（admin） |
| upsert | mutation | 新增或更新服務（admin） |
| delete | mutation | 刪除服務（admin） |
| updateApiKeyStatus | mutation | 更新 key 健康狀態（admin） |
| seedDefaults | mutation | 種子預設服務清單（admin） |

### trpc.imageStudio.*
| 端點 | 類型 | 說明 |
|------|------|------|
| generate | mutation | 生成圖片（fal.ai Flux/Kontext） |
| styles | query | 可用風格列表 |
| aspectRatios | query | 可用比例列表 |

### trpc.videoStudio.*
| 端點 | 類型 | 說明 |
|------|------|------|
| generateT2V | mutation | 文生影片（fal-ai/wan-ai/wan2.1-t2v-720p） |
| generateI2V | mutation | 圖生影片（fal-ai/wan-ai/wan2.1-i2v-720p） |

### trpc.learnHub.*（學習文件）
| 端點 | 類型 | 說明 |
|------|------|------|
| list | query | 列出文件（支援篩選/搜尋） |
| getById | query | 取得單篇文件 |
| featured | query | 精選文件 |
| create | mutation | 新增文件（admin） |
| update | mutation | 更新文件（admin） |
| delete | mutation | 刪除文件（admin） |

### trpc.news.*
| 端點 | 類型 | 說明 |
|------|------|------|
| list | query | 列出新聞（分頁） |
| fetch | mutation | 手動觸發新聞抓取（admin） |

---

## REST 端點

| 路徑 | 方法 | 說明 |
|------|------|------|
| \`/api/health\` | GET | 服務健康狀態（公開） |
| \`/api/webhook/fal\` | POST | fal.ai 生成完成回呼 |
| \`/api/webhooks/stripe\` | POST | Stripe 支付 webhook（骨架） |
| \`/api/auth/google\` | GET | Google OAuth 登入 |
| \`/api/auth/google/callback\` | GET | OAuth 回呼 |
| \`/api/events\` | GET | SSE 生成進度串流 |

---

## 認證機制

- **主要**：Google OAuth（/api/auth/google）
- **Session**：JWT 存在 HttpOnly Cookie（\`healing-studio-session\`）
- **示範模式**：\`/api/auth/demo-login\`（無需 Google 帳號）
- **tRPC ctx.user**：所有 protectedProcedure 均可透過 \`ctx.user\` 取得當前用戶
`,
    tags: ["API", "端點", "tRPC", "REST", "認證"],
    difficulty: "intermediate",
    readingMinutes: 12,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-r2-snapshot",
    category: "api-docs",
    title: "R2 儲存空間每日快照系統",
    summary: "每日凌晨 2 點自動掃描 Cloudflare R2 bucket，統計用量並估算費用。",
    content: `# R2 儲存空間每日快照系統

## 概覽

\`server/jobs/r2SnapshotJob.ts\` 是每日執行一次的 cron job，負責掃描 Cloudflare R2 bucket，統計各類型媒體的儲存量，並將結果寫入 \`r2_storage_snapshots\` 資料表。

---

## 執行時間

| 設定 | 值 |
|------|-----|
| Cron 表達式 | \`0 18 * * *\` |
| UTC 時間 | 每天 18:00 UTC |
| 台灣時間 | 每天凌晨 02:00 UTC+8 |

---

## 環境變數

\`\`\`env
S3_ENDPOINT=https://481637fcf27f301c0dc03b8e40a6f645.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=（R2 API Token Access Key）
S3_SECRET_ACCESS_KEY=（R2 API Token Secret Key）
S3_BUCKET_NAME=bruce
\`\`\`

> 若任一變數未設定，job 自動跳過並輸出警告。

---

## 分類規則

| 路徑前綴 | 分類 |
|----------|------|
| \`images/\` | images |
| \`videos/\` | videos |
| \`audio/\` | audio |
| \`voice/\` | voice |
| \`models/\` | models |
| 其他 | other |

---

## R2 定價

| 項目 | 費率 |
|------|------|
| 儲存 | $0.015/GB/月 |
| Class A 操作 | $0.36/百萬次 |
| Class B 操作 | $0.036/百萬次 |
| 前 10GB | **免費** |

---

## DB 記錄：r2_storage_snapshots

\`\`\`sql
snapshotDate         DATE        -- 快照日期
totalBytes           BIGINT      -- 總位元組數
totalObjects         INT         -- 總物件數
bytesByType          JSON        -- 各類型位元組數
objectsByType        JSON        -- 各類型物件數
estimatedMonthlyCostUsd DECIMAL  -- 估算月費（USD）
\`\`\`

---

## 手動觸發（開發測試）

\`\`\`typescript
import { takeR2Snapshot } from "./jobs/r2SnapshotJob";
await takeR2Snapshot(); // 立即執行一次快照
\`\`\`

---

## 匯出函式

| 函式 | 說明 |
|------|------|
| \`takeR2Snapshot()\` | 執行一次快照 |
| \`initR2SnapshotCron()\` | 啟動每日 cron |
| \`stopR2SnapshotCron()\` | 停止 cron |
`,
    tags: ["R2", "Cloudflare", "快照", "儲存", "監控", "cron"],
    difficulty: "intermediate",
    readingMinutes: 6,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "workflow-stripe-roadmap",
    category: "workflow",
    title: "Stripe 金流整合 Roadmap",
    summary: "Healing Studio Stripe 訂閱金流的完整整合計畫，從骨架到正式上線。",
    content: `# Stripe 金流整合 Roadmap

## 現狀（骨架已建立）

\`server/routes/stripeWebhook.ts\` — POST /api/webhooks/stripe

目前骨架已處理 5 個事件（僅 log，不執行業務邏輯）：
- \`checkout.session.completed\`
- \`invoice.paid\`
- \`invoice.payment_failed\`
- \`customer.subscription.updated\`
- \`customer.subscription.deleted\`

---

## 整合步驟

### Step 1：設定 Stripe 帳號
1. 前往 [stripe.com](https://stripe.com) 建立帳號
2. 建立訂閱方案（Products + Prices）
3. 取得 \`STRIPE_SECRET_KEY\` 和 \`STRIPE_PUBLISHABLE_KEY\`

### Step 2：設定 Webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL：\`https://healing-studio-production.up.railway.app/api/webhooks/stripe\`
3. 監聽事件：選擇上述 5 個事件
4. 取得 \`STRIPE_WEBHOOK_SECRET\`（whsec_...）

### Step 3：Railway 環境變數
\`\`\`env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
\`\`\`

### Step 4：完善 Webhook 骨架

在 \`stripeWebhook.ts\` 中，將各處理函式的 TODO 替換為實際業務邏輯：

\`\`\`typescript
// checkout.session.completed → 建立/更新 userSubscriptions
async function handleCheckoutSessionCompleted(session) {
  const db = await getDb();
  await db.insert(userSubscriptions).values({
    userId: session.metadata.userId,
    stripeCustomerId: session.customer,
    stripeSubscriptionId: session.subscription,
    planId: session.metadata.planId,
    status: "active",
  });
}
\`\`\`

### Step 5：前端結帳頁面
- 建立 \`/pricing\` 頁面，展示方案列表
- 使用 Stripe.js 的 \`redirectToCheckout()\` 跳轉到 Stripe Checkout
- 結帳成功後 Stripe 通知 webhook，自動開通訂閱

### Step 6：HMAC 驗證

重要：需換成原始 body 才能驗證簽名：

\`\`\`typescript
// 在 stripeWebhook.ts 路由前加入
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));

// 然後用 stripe SDK 驗證
const event = stripe.webhooks.constructEvent(
  req.body,  // raw Buffer
  req.headers["stripe-signature"],
  process.env.STRIPE_WEBHOOK_SECRET
);
\`\`\`

---

## DB Schema（已建立）

**userSubscriptions** 表已在 drizzle/schema.ts 中建立：
\`stripeCustomerId, stripeSubscriptionId, planId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd\`

---

## 預估整合時間

| 步驟 | 估計時間 |
|------|----------|
| Stripe 帳號設定 | 30 分鐘 |
| Webhook 完善 | 2-4 小時 |
| 前端結帳頁面 | 4-8 小時 |
| 測試 + 上線 | 2-4 小時 |
| **合計** | **約 1-2 天** |
`,
    tags: ["Stripe", "金流", "訂閱", "webhook", "roadmap"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "api-discord-alerts",
    category: "api-docs",
    title: "Discord 健康告警設定說明",
    summary: "API 服務異常時如何透過 Discord Webhook 即時告警，設定方式與告警格式。",
    content: `# Discord 健康告警設定說明

## 概覽

\`server/jobs/apiHealthMonitor.ts\` 定期監控所有 AI 服務（fal.ai、Gemini、ElevenLabs、Pinecone 等），當服務異常時透過 Discord Webhook 發送即時告警。

---

## 設定 Discord Webhook

1. 在 Discord 伺服器中，選擇你想接收告警的頻道
2. 頻道設定 → 整合 → Webhooks → 建立 Webhook
3. 複製 Webhook URL
4. 在 Railway 設定環境變數：

\`\`\`env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
\`\`\`

---

## 監控的服務

| 服務 | 監控方式 | 告警觸發條件 |
|------|----------|------------|
| fal.ai | HTTP GET /health | 非 2xx 回應 |
| Google Gemini | 輕量 API 呼叫 | 非 2xx 或 timeout |
| ElevenLabs | HTTP HEAD | 非 2xx 回應 |
| Pinecone | GET /indexes | 非 2xx 回應 |
| NVIDIA NIM | GET /v1/models | 非 2xx 回應 |
| Replicate | GET /v1/models | 非 2xx 回應 |

---

## 告警格式

Discord 訊息格式（Embed）：

\`\`\`json
{
  "embeds": [{
    "title": "⚠️ Healing Studio API 告警",
    "color": 16711680,
    "fields": [
      { "name": "服務", "value": "ElevenLabs" },
      { "name": "狀態", "value": "❌ 連線失敗（503）" },
      { "name": "時間", "value": "2026-04-17 18:00:00 UTC" }
    ]
  }]
}
\`\`\`

---

## 監控頻率

預設每 5 分鐘執行一次健康檢查。
可在 \`apiHealthMonitor.ts\` 調整 cron 時間：

\`\`\`typescript
// 每 5 分鐘
cron.schedule("*/5 * * * *", runHealthCheck);
// 每 10 分鐘
cron.schedule("*/10 * * * *", runHealthCheck);
\`\`\`

---

## 告警降噪

為避免連續告警（服務間歇性異常），系統只在：
1. 服務從「正常」變「異常」時發送告警
2. 服務從「異常」恢復「正常」時發送恢復通知

同一服務連續異常不重複發送。

---

## 測試告警

\`\`\`typescript
import { sendDiscordAlert } from "./jobs/apiHealthMonitor";

await sendDiscordAlert({
  service: "測試服務",
  status: "offline",
  message: "這是一條測試告警",
});
\`\`\`
`,
    tags: ["Discord", "告警", "監控", "webhook", "健康檢查"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 新增 15 篇文件：全站階層式知識庫（2026-04-19）
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "kb-background-tasks",
    title: "背景任務中心完整指南",
    category: "getting-started",
    summary: "說明 /background-tasks 頁面的 9 種任務類型、狀態輪詢機制與結果預覽功能。",
    content: `# 背景任務中心完整指南

## 什麼是背景任務中心？

**路徑**：\`/background-tasks\`

背景任務中心讓所有耗時的 AI 生成工作在後台執行，使用者可以繼續使用網站，完成後再回來查看結果。

---

## 支援的 9 種任務類型

| jobType | 說明 | 預估時間 |
|---------|------|----------|
| \`image_generation\` | 圖像生成（Flux / SDXL / Stable Diffusion） | 10–60 秒 |
| \`video_generation\` | 影片生成（WAN / Hailuo / Kling） | 1–5 分鐘 |
| \`audio_generation\` | 音頻生成（Suno / MusicGen） | 30–120 秒 |
| \`voice_cloning\` | 語音克隆（ElevenLabs / F5-TTS） | 20–90 秒 |
| \`3d_generation\` | 3D 模型生成（Tripo3D） | 2–5 分鐘 |
| \`lora_training\` | LoRA 微調訓練 | 10–60 分鐘 |
| \`video_script\` | 腳本分析與分鏡生成 | 30–60 秒 |
| \`cross_modal\` | 跨模態轉換 | 1–3 分鐘 |
| \`batch_export\` | 批量匯出資產 | 依數量而定 |

---

## 任務狀態流程

\`\`\`
pending → processing → completed
                    ↘ failed
                    ↘ cancelled
\`\`\`

- **pending**：已排隊等待執行
- **processing**：正在執行中
- **completed**：成功完成，可查看結果
- **failed**：執行失敗，可查看錯誤訊息
- **cancelled**：使用者手動取消

---

## 狀態輪詢機制

前端每 **3 秒**自動呼叫 \`backgroundTask.getStatus\` API，直到任務狀態變為 \`completed\` 或 \`failed\`。

\`\`\`typescript
// 輪詢邏輯示例
const { data } = trpc.backgroundTask.getStatus.useQuery(
  { jobId },
  { refetchInterval: 3000, enabled: status === 'processing' }
);
\`\`\`

---

## 超時機制

- 所有背景任務最長執行時間：**30 分鐘**
- 超時後自動標記為 \`failed\`，錯誤訊息為 \`"Task timeout after 30 minutes"\`

---

## 結果預覽

任務完成後，\`resultJson\` 欄位儲存輸出結果：

\`\`\`json
{
  "url": "https://cdn.example.com/output.mp4",
  "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
  "duration": 15.3,
  "metadata": { "width": 1920, "height": 1080 }
}
\`\`\`

---

## 如何使用

1. 前往任意創作工具（圖像、影片、音頻等）
2. 點擊「生成」按鈕，任務自動進入背景執行
3. 頁面右上角出現任務通知圖示
4. 點擊通知或前往 \`/background-tasks\` 查看進度
5. 完成後點擊「查看結果」預覽並儲存到資產庫
`,
    tags: ["背景任務", "生成", "非同步", "狀態追蹤"],
    difficulty: "beginner",
    readingMinutes: 6,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-prompt-library",
    title: "提示詞庫完整指南",
    category: "technique",
    summary: "說明 /prompt-library 的 7 大分類、公開廣場、收藏與使用次數統計功能。",
    content: `# 提示詞庫完整指南

## 什麼是提示詞庫？

**路徑**：\`/prompt-library\`

提示詞庫是集中管理所有 AI 提示詞的地方，支援個人收藏、公開分享，以及按使用情境分類。

---

## 7 大分類

| category | 說明 | 適用工具 |
|----------|------|----------|
| \`general\` | 通用提示詞 | 所有 AI 工具 |
| \`image\` | 圖像生成提示詞 | 圖像工作室 |
| \`video\` | 影片生成提示詞 | 影片工作室 |
| \`audio\` | 音頻生成提示詞 | 音頻工作室 |
| \`voice\` | 語音合成提示詞 | 語音複製 |
| \`story\` | 故事創作提示詞 | Director AI |
| \`system\` | 系統級提示詞 | AI Brain 設定 |

---

## 功能詳解

### 建立提示詞

1. 點擊「新增提示詞」按鈕
2. 填寫標題、內容、分類標籤
3. 選擇是否公開分享

### 公開廣場

- 切換到「廣場」Tab 可瀏覽所有公開提示詞
- 按 \`useCount\`（使用次數）排序，熱門提示詞排在最前
- 可直接「複製」或「收藏」他人的提示詞

### 收藏功能

- 點擊提示詞卡片上的 ★ 圖示即可收藏
- 收藏的提示詞顯示在「我的收藏」Tab

### 使用次數統計

每次點擊「使用此提示詞」按鈕，\`useCount\` 自動 +1。這個數字反映了該提示詞的受歡迎程度。

---

## 搜尋與篩選

- **關鍵字搜尋**：標題與內容全文搜尋
- **分類篩選**：點擊分類 Tag 快速篩選
- **排序方式**：最新建立 / 最多使用 / 最近更新

---

## 在工具中使用

在任何創作工具的提示詞輸入框旁，點擊「從提示詞庫選取」按鈕，可直接從庫中選取並填入提示詞。

---

## 資料庫結構

\`\`\`sql
promptLibrary (
  id, userId, title, content,
  category ENUM('general','image','video','audio','voice','story','system'),
  isPublic BOOLEAN,
  useCount INT DEFAULT 0,
  tags JSON,
  createdAt, updatedAt
)
\`\`\`
`,
    tags: ["提示詞", "收藏", "廣場", "分類", "AI"],
    difficulty: "beginner",
    readingMinutes: 5,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-showcase",
    title: "首頁精選展示系統指南",
    category: "getting-started",
    summary: "說明 featuredShowcase 表的 promote 流程、sortWeight 排序、likeCount 互動與 Cursor 分頁。",
    content: `# 首頁精選展示系統指南

## 什麼是精選展示？

首頁（\`/\`）的 Showcase Masonry 牆展示社群中最優秀的 AI 生成作品。作品由使用者自行申請加入精選，或由管理員直接設置。

---

## 精選展示資料庫結構

\`\`\`sql
featuredShowcase (
  id, userId, title, description,
  mediaUrl, thumbnailUrl,
  modality ENUM('image','video','audio','3d'),
  sortWeight INT DEFAULT 0,   -- 數字越大越靠前
  likeCount INT DEFAULT 0,    -- 按讚數
  isActive BOOLEAN DEFAULT true,
  createdAt, updatedAt
)
\`\`\`

---

## Promote 流程（申請加入精選）

1. 在資產庫（\`/assets\`）找到你的作品
2. 點擊「申請精選」按鈕
3. 填寫標題、說明
4. 系統呼叫 \`showcase.promote\` API
5. 作品以 \`sortWeight: 0\` 進入精選佇列
6. 管理員可在後台調整 \`sortWeight\` 提高排序

---

## sortWeight 排序邏輯

- \`sortWeight\` 越高，在 Masonry 牆越靠前
- 同 \`sortWeight\` 的作品以 \`createdAt\` 倒序排列
- 管理員可設定 1–1000 的排序權重

---

## likeCount 互動

- 任何登入使用者都可以對精選作品按讚
- 重複按讚會取消讚（Toggle 機制）
- \`likeCount\` 即時更新，不刷頁

---

## Cursor 分頁

精選展示使用 **Cursor 分頁**（非傳統 offset 分頁）：

\`\`\`typescript
// 請求第一頁
trpc.showcase.list({ limit: 20 })

// 請求下一頁（傳入上一頁最後一筆的 cursor）
trpc.showcase.list({ limit: 20, cursor: lastItemId })
\`\`\`

這確保在高頻更新的情況下，分頁結果不會重複或遺漏。

---

## API 端點

| 端點 | 說明 |
|------|------|
| \`showcase.list\` | 取得精選列表（Cursor 分頁） |
| \`showcase.getById\` | 取得單一作品完整資訊 |
| \`showcase.myItems\` | 取得我的精選申請 |
| \`showcase.promote\` | 申請加入精選 |
| \`showcase.stats\` | 取得展示統計（管理員） |
`,
    tags: ["精選", "首頁", "展示", "Masonry", "社群"],
    difficulty: "beginner",
    readingMinutes: 5,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-sense-engine",
    title: "Sense Engine 意圖推論引擎指南",
    category: "technique",
    summary: "說明 Sense Engine 的 6 種行為事件監聽、OARS 框架與 6 種心理判定類型。",
    content: `# Sense Engine 意圖推論引擎指南

## 什麼是 Sense Engine？

Sense Engine 是 Healing Studio 的**隱式意圖感知系統**，它透過監聽使用者在頁面上的行為模式，自動推論使用者當前的心理狀態，並據此提供個性化建議。

---

## 6 種行為事件

| 事件 | 觸發條件 | 意義 |
|------|----------|------|
| \`cardDwell\` | 滑鼠停留在卡片上 > 2 秒 | 使用者對此內容感興趣 |
| \`scrollHesitation\` | 滾動速度突然變慢 | 使用者看到感興趣的內容 |
| \`hoverIntent\` | 滑鼠移向按鈕但未點擊 | 猶豫中，考慮行動 |
| \`clickAbort\` | 開始點擊但中途放棄 | 決策障礙或改變主意 |
| \`sectionVisit\` | 進入特定頁面區塊 | 主動探索某個功能 |
| \`rapidScan\` | 快速上下滾動頁面 | 尋找特定內容 |

---

## OARS 框架

Sense Engine 使用 **OARS** 框架分析行為序列：

- **O**bserve（觀察）：記錄所有行為事件
- **A**nalyze（分析）：統計事件頻率與模式
- **R**eason（推理）：對應到心理狀態模型
- **S**uggest（建議）：觸發個性化 UI 回應

---

## 6 種心理判定類型

| 心理類型 | 觸發行為組合 | UI 回應 |
|----------|-------------|---------|
| \`choice_paralysis\` | 多次 clickAbort + hoverIntent | 顯示「為你推薦」精選 |
| \`aesthetic_preference\` | 長時間 cardDwell 在視覺內容 | 推送相似風格作品 |
| \`exploration_mode\` | rapidScan + sectionVisit 多區塊 | 顯示功能導覽地圖 |
| \`goal_oriented\` | 快速點擊、少停留 | 減少干擾，簡化界面 |
| \`inspiration_seeking\` | scrollHesitation 在創意內容 | 推送靈感 Gallery |
| \`passive_browsing\` | 低互動、長時間停留 | 自動播放精選內容 |

---

## 首頁觸發示例

在首頁（\`/\`），當 Sense Engine 判定使用者為 \`choice_paralysis\` 狀態時：
1. 右下角彈出「不知道從哪開始？」提示卡
2. 顯示根據歷史使用偏好的個性化功能入口
3. Director AI 的歡迎訊息調整為引導式問題

---

## 隱私說明

Sense Engine 的所有分析均在**本地瀏覽器端**執行，不上傳原始行為數據到伺服器。只有最終的心理判定結果（用於個性化推薦）才會存入使用者的 AI Brain 設定中。
`,
    tags: ["Sense Engine", "意圖推論", "個性化", "行為分析", "OARS"],
    difficulty: "advanced",
    readingMinutes: 8,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-settings-complete",
    title: "個人設定完整指南",
    category: "getting-started",
    summary: "說明 /settings 頁面的 5 個 Tab：個人資料、外觀、通知、引導設定、管理員面板。",
    content: `# 個人設定完整指南

## 設定頁面入口

**路徑**：\`/settings\`（基本設定）、\`/settings/ai-brain\`（AI Brain 設定）

---

## Tab 1：個人資料（profile）

- **顯示名稱**：最多 50 字元
- **頭像**：上傳自訂頭像（最大 5MB，支援 JPG/PNG/WebP）
- **個人簡介**：最多 200 字元
- **電子郵件**：顯示目前登入的 Email（不可修改）
- **帳號建立日期**：顯示資訊

---

## Tab 2：外觀（appearance）

### 主題模式
| 選項 | 說明 |
|------|------|
| 淺色模式 | 白底黑字，適合白天使用 |
| 深色模式 | 黑底白字，護眼舒適 |
| 系統自動 | 跟隨裝置系統設定 |

### 場景氛圍
| 場景 | 視覺風格 |
|------|----------|
| 療癒森林 | 綠色系，柔和自然 |
| 星空冥想 | 深藍紫色，夢幻感 |
| 晨光工作室 | 暖橘色，活力感 |
| 極簡白空間 | 純白，專注工作 |

### 字型大小
- 小（14px）/ 標準（16px）/ 大（18px）/ 特大（20px）

### 動畫效果
- 開啟：完整過渡動畫與微互動
- 關閉：靜態界面，適合低效能裝置

---

## Tab 3：通知設定（notifications）

| 通知類型 | 說明 | 預設 |
|----------|------|------|
| 任務完成通知 | 背景任務完成時通知 | 開啟 |
| 系統公告 | 新功能或維護通知 | 開啟 |
| AI Brain 回覆 | Director AI 主動訊息 | 開啟 |
| 促銷優惠 | 積分優惠或限時活動 | 關閉 |

---

## Tab 4：引導設定（onboarding）

- 重置新手引導流程
- 重新觀看功能介紹教學
- 重置所有「不再顯示」的提示

---

## Tab 5：管理員面板（admin）

**⚠️ 僅管理員帳號可見**

- 系統全域設定
- 使用者管理
- 積分手動調整
- 功能開關（Feature Flags）

---

## AI Brain 設定（\`/settings/ai-brain\`）

此為獨立頁面，設定 Director AI 的個性化行為：
- AI 人格風格（溫柔陪伴 / 專業效率 / 創意激發）
- 記憶深度（保留最近 N 次對話的記憶）
- 主動建議頻率
- 禁用詞彙列表
`,
    tags: ["設定", "個人化", "主題", "外觀", "通知"],
    difficulty: "beginner",
    readingMinutes: 6,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-director-script",
    title: "Director AI 腳本分析模式指南",
    category: "workflow",
    summary: "說明 Director AI 的腳本分析 Tab（Tab 2）：腳本解析、分鏡表生成與 CO-STAR 框架。",
    content: `# Director AI 腳本分析模式指南

## Director AI 雙模式概覽

**路徑**：\`/director\`

Director AI 有兩個主要工作模式：

| Tab | 模式 | 說明 |
|-----|------|------|
| Tab 1 | 對話模式（Chat） | 自由對話、創意發想、問答 |
| Tab 2 | 腳本分析模式（Script） | 輸入腳本，自動解析生成分鏡表 |

---

## 腳本分析模式（Tab 2）詳解

### 輸入區

在腳本輸入框中貼入你的**影片腳本或故事大綱**。支援格式：
- 純文字腳本
- 場景描述段落
- 對話劇本格式（角色名：台詞）

### 分鏡表生成

點擊「分析腳本」後，AI 自動解析並生成結構化分鏡表：

\`\`\`
┌─────────────────────────────────────────────────────────┐
│ 分鏡 #1                                                  │
│ 場景描述：森林中的小屋，黃昏光線                              │
│ 攝影機角度：中景，微微仰角                                   │
│ 人物動作：主角緩步走向小屋門口                               │
│ 情緒氛圍：寧靜、期待                                        │
│ 建議音效：輕柔的森林環境音                                   │
│ 時長估計：3–5 秒                                           │
└─────────────────────────────────────────────────────────┘
\`\`\`

### 分鏡表欄位定義

| 欄位 | 說明 |
|------|------|
| 場景描述 | 畫面的視覺元素與環境 |
| 攝影機角度 | 遠景/中景/近景/特寫，及攝影機位置 |
| 人物動作 | 角色的肢體動作與表情 |
| 情緒氛圍 | 此分鏡傳達的情感 |
| 建議音效 | 背景音、對白或音樂提示 |
| 時長估計 | 建議的分鏡持續秒數 |

---

## CO-STAR 框架

Director AI 使用 **CO-STAR** 框架來確保腳本分析的一致性：

| 字母 | 代表 | 說明 |
|------|------|------|
| **C** | Context（情境） | 故事的背景與世界觀設定 |
| **O** | Objective（目標） | 這段腳本想傳達的核心訊息 |
| **S** | Style（風格） | 視覺與敘事風格 |
| **T** | Tone（語調） | 情感基調與氛圍 |
| **A** | Audience（受眾） | 目標觀眾群 |
| **R** | Response（呈現） | 期望觀眾產生的反應 |

---

## 匯出功能

分鏡表可匯出為：
- **JSON**：供程式介接使用
- **PDF**：可列印的分鏡表文件
- **Markdown**：在筆記或文件中使用

---

## 與創作工作室整合

在分鏡表中，每個分鏡旁有「生成圖像」按鈕，點擊後直接以該分鏡描述為提示詞，在圖像工作室生成對應分鏡畫面。
`,
    tags: ["Director AI", "腳本", "分鏡", "CO-STAR", "影片"],
    difficulty: "intermediate",
    readingMinutes: 7,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-langsmith-detail",
    title: "LangSmith 監控頁面完整指南",
    category: "api-docs",
    summary: "說明 /langsmith 的 5 個 Tab：總覽、追蹤、比較、資料集、匯出，以及 Feedback 評分與資料集管理。",
    content: `# LangSmith 監控頁面完整指南

## 什麼是 LangSmith 頁面？

**路徑**：\`/langsmith\`

LangSmith 頁面整合了 LangSmith 的 LLM 追蹤與評估功能，讓開發者與進階使用者監控 AI 呼叫的品質與效能。

---

## 5 個功能 Tab

### Tab 1：總覽（overview）

- 今日 LLM 呼叫總次數
- 平均回應延遲（ms）
- 錯誤率統計圖表
- 最常使用的模型排行

### Tab 2：追蹤（traces）

每筆 LLM 呼叫的詳細記錄：

| 欄位 | 說明 |
|------|------|
| Trace ID | 唯一追蹤識別碼 |
| 模型名稱 | 使用的 LLM 模型 |
| 輸入 tokens | 提示詞消耗的 token 數 |
| 輸出 tokens | 回應消耗的 token 數 |
| 延遲 | 回應時間（毫秒） |
| 狀態 | success / error |
| 時間戳 | 呼叫發生的時間 |

點擊任一追蹤記錄可展開查看完整的輸入輸出內容。

### Tab 3：比較（comparison）

- 選取 2–4 筆追蹤記錄進行並排比較
- 可比較相同提示詞在不同模型下的輸出差異
- 支援 A/B 測試工作流

### Tab 4：資料集（datasets）

建立與管理評估資料集：
- 從追蹤記錄中選取樣本加入資料集
- 為每個樣本標記「預期輸出」
- 用於後續的模型評估與微調

### Tab 5：匯出（export）

支援兩種匯出格式：

| 格式 | 用途 |
|------|------|
| **OpenAI Fine-tuning** | 直接用於 GPT 系列模型微調 |
| **JSONL** | 通用格式，適用於其他訓練框架 |

---

## Feedback 評分系統

在每筆追蹤記錄旁，可給予 1–5 星評分：
- ⭐⭐⭐⭐⭐ 完美回應
- ⭐⭐⭐ 可接受但有改進空間
- ⭐ 錯誤或無用的回應

這些評分被記錄為 \`userFeedbackReports\`，用於：
1. 識別需要改進的提示詞
2. 建立高品質的訓練資料集
3. 監控模型退化現象

---

## 使用場景

- **偵錯**：當某個 AI 功能回應異常時，在此查找根本原因
- **效能優化**：找出高延遲的 LLM 呼叫並優化提示詞
- **成本分析**：追蹤 token 消耗，找出高成本操作
- **模型評估**：系統性比較不同模型的輸出品質
`,
    tags: ["LangSmith", "LLM追蹤", "監控", "評估", "Fine-tuning"],
    difficulty: "advanced",
    readingMinutes: 8,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-focus-flow-complete",
    title: "專注流（Focus Flow）完整指南",
    category: "workflow",
    summary: "說明 /focus-flow 的 3 個 Tab：番茄鐘、療癒時間、靈感捕捉，以及呼吸引導動畫與想法收集功能。",
    content: `# 專注流（Focus Flow）完整指南

## 什麼是專注流？

**路徑**：\`/focus-flow\`

專注流是一個身心整合的工作輔助工具，結合番茄鐘技術、冥想音療與創意捕捉，幫助使用者進入深度工作狀態。

---

## 3 個功能 Tab

### Tab 1：番茄鐘（pomodoro）

經典番茄工作法計時器，針對 Healing Studio 做了療癒化設計：

**預設時間配置：**
| 階段 | 時長 | 說明 |
|------|------|------|
| 專注工作 | 25 分鐘 | 深度工作期 |
| 短暫休息 | 5 分鐘 | 放鬆恢復 |
| 長休息 | 15 分鐘 | 每 4 輪番茄後 |

**可自訂設定：**
- 工作時間：10–60 分鐘
- 短休息：3–15 分鐘
- 長休息：10–30 分鐘
- 背景音樂選擇（森林雨聲、咖啡廳、白噪音）

**計時器操作：**
- 開始 / 暫停 / 重置
- 自動進入下一階段（可關閉）
- 完成通知（聲音 + 瀏覽器通知）

---

### Tab 2：療癒時間（healing）

引導式呼吸與冥想體驗：

**呼吸引導動畫（BREATHING_PHASES）：**

\`\`\`
BREATHING_PHASES = [
  { phase: "inhale",  duration: 4, label: "吸氣",  color: "#a8d8ea" },
  { phase: "hold",    duration: 4, label: "屏息",  color: "#aa96da" },
  { phase: "exhale",  duration: 6, label: "呼氣",  color: "#fcbad3" },
  { phase: "rest",    duration: 2, label: "休息",  color: "#ffffd2" }
]
\`\`\`

動畫是一個**會隨呼吸節律擴縮的圓形**，顏色隨階段改變。

**療癒音頻選項：**
- 頌缽聲（528Hz）
- 自然環境音（海浪、森林、雨聲）
- 引導冥想語音（繁體中文）

**療癒計時：**
- 設定療癒時長（5 / 10 / 15 / 20 分鐘）
- 計時結束時播放溫柔提示音

---

### Tab 3：靈感捕捉（idea）

工作中突然閃現的靈感，立即記錄：

**快速輸入：**
- 純文字輸入框（支援 Markdown）
- 語音轉文字（點擊麥克風按鈕）
- 最多 500 字元

**標籤分類：**
- 自由標籤（按 Enter 新增）
- 常用標籤：創意、待辦、問題、參考

**想法列表：**
- 顯示今日捕捉的所有想法
- 點擊可展開編輯
- 星號標記重要想法
- 「送到筆記」按鈕將想法儲存到 \`/notes\`

---

## FocusFlowContext 全域狀態

專注流使用 React Context 管理跨組件狀態：

\`\`\`typescript
interface FocusFlowState {
  activeTab: "pomodoro" | "healing" | "idea";
  pomodoroState: "idle" | "working" | "break" | "longBreak";
  secondsRemaining: number;
  completedPomodoros: number;
  ideas: IdeaNote[];
}
\`\`\`

這表示即使切換 Tab，番茄鐘計時仍會繼續在後台運行。

---

## 使用建議

1. 開始工作前先做 **5 分鐘呼吸療癒**，讓心靜下來
2. 進入番茄鐘工作模式，專注 25 分鐘
3. 休息時若有靈感，切到靈感捕捉 Tab 快速記錄
4. 下班前查看今日靈感，整理到筆記中
`,
    tags: ["專注", "番茄鐘", "冥想", "呼吸", "靈感"],
    difficulty: "beginner",
    readingMinutes: 7,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-lora-trainer-detail",
    title: "LoRA 訓練器完整指南",
    category: "model-guide",
    summary: "說明 /lora-trainer 的訓練流程、6 種模型類型、狀態追蹤與訓練結果 zip 匯出。",
    content: `# LoRA 訓練器完整指南

## 什麼是 LoRA 訓練器？

**路徑**：\`/lora-trainer\`

LoRA（Low-Rank Adaptation）是一種高效的 AI 模型微調技術，讓你用少量圖片訓練專屬的個人化風格模型。

---

## 支援的 6 種模型類型

| 模型類型 | 說明 | 建議訓練圖片數 |
|----------|------|---------------|
| \`flux-lora\` | Flux.1 LoRA，目前最高品質 | 15–30 張 |
| \`sdxl-lora\` | SDXL LoRA，速度與品質平衡 | 20–50 張 |
| \`sd15-lora\` | SD 1.5 LoRA，相容性最廣 | 20–50 張 |
| \`face-lora\` | 人臉特化 LoRA，精準重現臉部特徵 | 10–20 張 |
| \`style-lora\` | 藝術風格 LoRA，複刻插畫或繪畫風格 | 20–40 張 |
| \`concept-lora\` | 概念/物體 LoRA，訓練特定物品或角色 | 15–30 張 |

---

## 訓練流程

### 步驟 1：建立訓練集

1. 點擊「新增訓練集」
2. 上傳訓練圖片（支援 JPG/PNG，建議 512x512 以上）
3. 為每張圖片加上描述性標籤（Caption）
4. 系統自動裁切並預處理圖片

### 步驟 2：設定訓練參數

| 參數 | 說明 | 建議值 |
|------|------|--------|
| 訓練步數 | Gradient update 次數 | 1000–3000 步 |
| 學習率 | 模型調整速率 | 0.0001（預設） |
| LoRA Rank | 模型複雜度 | 16–64 |
| Batch Size | 每次訓練的圖片數 | 1–4 |

### 步驟 3：開始訓練

- 點擊「開始訓練」，任務進入**背景任務佇列**
- 訓練時間因步數而異（通常 10–60 分鐘）
- 可在 \`/background-tasks\` 監控訓練進度

### 步驟 4：取得訓練結果

訓練完成後：
1. 在 \`/lora-trainer\` 頁面看到「訓練完成」通知
2. 點擊「下載模型」，取得 \`.zip\` 檔案
3. 或點擊「直接使用」，在圖像工作室中套用此 LoRA

---

## 訓練狀態追蹤

| 狀態 | 說明 |
|------|------|
| \`preparing\` | 正在預處理訓練圖片 |
| \`training\` | 訓練進行中 |
| \`validating\` | 生成驗證樣本，檢驗訓練效果 |
| \`packaging\` | 打包輸出檔案 |
| \`completed\` | 訓練完成，可下載使用 |
| \`failed\` | 訓練失敗，查看錯誤日誌 |

---

## 資料庫儲存

訓練完成的模型資訊儲存在 \`fineTunedModels\` 表：

\`\`\`sql
fineTunedModels (
  id, userId, name, description,
  modelType, baseModel,
  trainingSteps, status,
  downloadUrl, thumbnailUrl,
  createdAt, updatedAt
)
\`\`\`

---

## 在圖像工作室中使用 LoRA

在圖像工作室（\`/image-studio\`）的進階設定中：
1. 展開「LoRA 模型」區塊
2. 從你的模型列表中選取已訓練的 LoRA
3. 調整 LoRA 強度（0.1–1.0）
4. 生成圖像時系統自動套用 LoRA 風格
`,
    tags: ["LoRA", "微調", "訓練", "自訂模型", "Flux"],
    difficulty: "advanced",
    readingMinutes: 9,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-credits-complete",
    title: "積分系統完整指南",
    category: "getting-started",
    summary: "說明 /credits 頁面的所有模型費率、Tier 分級、Category 分類與點數計算方式。",
    content: `# 積分系統完整指南

## 什麼是積分？

**路徑**：\`/credits\`

積分（Credits）是 Healing Studio 的通用消耗貨幣，使用任何 AI 生成功能都會消耗積分。

---

## 積分取得方式

| 來源 | 積分數量 | 說明 |
|------|----------|------|
| 免費新用戶 | 100 積分 | 每個新帳號贈送 |
| 每日簽到 | 10 積分 | 每天登入即可領取 |
| Pro 方案（月費） | 2,000 積分/月 | 訂閱包含積分 |
| 單次購買 | 依方案而定 | 一次性積分包 |

---

## 費率 Tier 分級

| Tier | 說明 | 代表模型 |
|------|------|----------|
| **Free** | 免費模型，不消耗積分 | 基礎文字對話 |
| **Basic** | 低費率（1–5 積分/次） | SD 1.5 圖像生成 |
| **Standard** | 標準費率（5–20 積分/次） | SDXL、Flux Schnell |
| **Premium** | 高費率（20–50 積分/次） | Flux Pro、Midjourney 品質 |
| **Ultra** | 頂級費率（50+ 積分/次） | Sora、最新旗艦模型 |

---

## 模型費率表（依 Category）

### 文字生成（text-generation）
| 模型 | 費率 |
|------|------|
| Gemini 1.5 Flash | 1 積分/1K tokens |
| GPT-4o mini | 2 積分/1K tokens |
| GPT-4o | 10 積分/1K tokens |
| Claude 3 Opus | 15 積分/1K tokens |

### 圖像生成（image-generation）
| 模型 | 費率 |
|------|------|
| Flux Schnell | 5 積分/張 |
| Flux Dev | 15 積分/張 |
| Flux Pro | 30 積分/張 |
| SDXL | 8 積分/張 |

### 影片生成（video-generation）
| 模型 | 費率 |
|------|------|
| WAN 2.1（5秒） | 50 積分/次 |
| Hailuo（5秒） | 60 積分/次 |
| Kling 1.6（5秒） | 55 積分/次 |

### 語音合成（text-to-speech）
| 模型 | 費率 |
|------|------|
| ElevenLabs | 2 積分/1K 字元 |
| F5-TTS | 1 積分/1K 字元 |

### 音樂生成（audio-generation）
| 模型 | 費率 |
|------|------|
| Suno v4 | 20 積分/首 |
| MusicGen | 10 積分/首 |

### 3D 生成（3d-generation）
| 模型 | 費率 |
|------|------|
| Tripo3D | 40 積分/個 |

---

## 積分計算規則

\`\`\`
消耗積分 = 基礎費率 × 品質係數 × 數量
\`\`\`

**品質係數：**
- 標準品質：× 1.0
- 高品質：× 1.5
- 超高品質：× 2.0

---

## 積分不足時

當積分不足以執行操作時：
- 畫面顯示「積分不足」提示
- 自動導向到積分購買頁面
- 可選擇使用較低費率的替代模型繼續

---

## 積分歷史查詢

在 \`/credits\` 頁面的「歷史記錄」Tab：
- 查看所有積分消耗與獲得記錄
- 按日期、模型、金額篩選
- 匯出 CSV 供帳務對帳
`,
    tags: ["積分", "費率", "計費", "訂閱", "模型"],
    difficulty: "beginner",
    readingMinutes: 8,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-schema-23tables",
    title: "資料庫 Schema 完整 23 張表指南",
    category: "api-docs",
    summary: "完整說明所有 23 張資料庫表的欄位定義、用途與關聯關係。",
    content: `# 資料庫 Schema 完整 23 張表指南

## 資料庫連線資訊

- **引擎**：MySQL（Railway 托管）
- **ORM**：Drizzle ORM
- **Schema 位置**：\`server/db/schema.ts\`

---

## 核心使用者表

### users
\`\`\`sql
users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100),
  avatarUrl TEXT,
  role ENUM('user','admin') DEFAULT 'user',
  credits INT DEFAULT 100,
  bio TEXT,
  tier ENUM('free','pro','enterprise') DEFAULT 'free',
  createdAt DATETIME,
  updatedAt DATETIME
)
\`\`\`

### userSubscriptions
\`\`\`sql
userSubscriptions (
  id, userId, planId,
  status ENUM('active','cancelled','expired','trial'),
  currentPeriodStart DATETIME,
  currentPeriodEnd DATETIME,
  stripeSubscriptionId VARCHAR(255),
  createdAt, updatedAt
)
\`\`\`

### subscriptionPlans
\`\`\`sql
subscriptionPlans (
  id, name, description,
  price DECIMAL(10,2), currency VARCHAR(3),
  creditsPerMonth INT,
  features JSON,
  stripePriceId VARCHAR(255),
  isActive BOOLEAN DEFAULT true
)
\`\`\`

### externalServiceSubscriptions
\`\`\`sql
externalServiceSubscriptions (
  id, userId,
  service ENUM('elevenlabs','pinecone','fal','openai','stability'),
  tier VARCHAR(50),
  apiKeyHash VARCHAR(255),  -- 加密儲存
  usageLimit INT,
  currentUsage INT DEFAULT 0,
  resetDate DATETIME,
  createdAt, updatedAt
)
\`\`\`

---

## 生成與資產表

### generationHistory
\`\`\`sql
generationHistory (
  id, userId,
  modality ENUM('image','video','audio','voice','3d','text'),
  modelId VARCHAR(100),
  prompt TEXT,
  outputUrl TEXT,
  creditsUsed INT,
  metadata JSON,
  createdAt
)
\`\`\`

### digitalAssetLibrary
\`\`\`sql
digitalAssetLibrary (
  id, userId, title, description,
  fileUrl TEXT, thumbnailUrl TEXT,
  fileType VARCHAR(50), fileSize BIGINT,
  modality ENUM('image','video','audio','voice','3d','document'),
  tags JSON, isPublic BOOLEAN DEFAULT false,
  r2Key VARCHAR(500),  -- Cloudflare R2 儲存路徑
  createdAt, updatedAt
)
\`\`\`

### r2StorageSnapshots
\`\`\`sql
r2StorageSnapshots (
  id, userId,
  bucketName VARCHAR(100),
  totalFiles INT,
  totalSizeBytes BIGINT,
  snapshotData JSON,  -- 詳細檔案列表
  takenAt DATETIME,
  createdAt
)
\`\`\`

---

## AI 功能表

### backgroundJobs
\`\`\`sql
backgroundJobs (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36),
  jobType ENUM('image_generation','video_generation','audio_generation',
               'voice_cloning','3d_generation','lora_training',
               'video_script','cross_modal','batch_export'),
  status ENUM('pending','processing','completed','failed','cancelled'),
  inputJson JSON,   -- 任務輸入參數
  resultJson JSON,  -- 任務輸出結果
  errorMessage TEXT,
  startedAt DATETIME,
  completedAt DATETIME,
  createdAt, updatedAt
  -- 超時：30 分鐘自動標記 failed
)
\`\`\`

### aiDirectorPreferences
\`\`\`sql
aiDirectorPreferences (
  id, userId,
  personality ENUM('gentle','professional','creative'),
  memoryDepth INT DEFAULT 10,
  suggestionFrequency ENUM('low','medium','high'),
  blockedKeywords JSON,
  customSystemPrompt TEXT,
  updatedAt
)
\`\`\`

### userAiBrain
\`\`\`sql
userAiBrain (
  id, userId,
  memories JSON,      -- 對話記憶摘要
  preferences JSON,   -- 推斷的使用偏好
  senseEngineProfile JSON,  -- Sense Engine 心理側寫
  lastUpdated DATETIME
)
\`\`\`

### consistencyVault
\`\`\`sql
consistencyVault (
  id, userId, name, description,
  referenceImages JSON,  -- 參考圖片 URL 陣列
  characterSheet JSON,   -- 角色特徵描述
  styleGuide TEXT,
  createdAt, updatedAt
)
\`\`\`

### fineTunedModels
\`\`\`sql
fineTunedModels (
  id, userId, name, description,
  modelType ENUM('flux-lora','sdxl-lora','sd15-lora',
                 'face-lora','style-lora','concept-lora'),
  baseModel VARCHAR(100),
  trainingSteps INT,
  status ENUM('preparing','training','validating','packaging','completed','failed'),
  downloadUrl TEXT,
  thumbnailUrl TEXT,
  createdAt, updatedAt
)
\`\`\`

---

## 內容管理表

### promptLibrary
\`\`\`sql
promptLibrary (
  id, userId, title, content TEXT,
  category ENUM('general','image','video','audio','voice','story','system'),
  isPublic BOOLEAN DEFAULT false,
  useCount INT DEFAULT 0,
  tags JSON,
  createdAt, updatedAt
)
\`\`\`

### featuredShowcase
\`\`\`sql
featuredShowcase (
  id, userId, title, description TEXT,
  mediaUrl TEXT, thumbnailUrl TEXT,
  modality ENUM('image','video','audio','3d'),
  sortWeight INT DEFAULT 0,
  likeCount INT DEFAULT 0,
  isActive BOOLEAN DEFAULT true,
  createdAt, updatedAt
)
\`\`\`

### newsArticles
\`\`\`sql
newsArticles (
  id, title, summary TEXT, content TEXT,
  sourceUrl VARCHAR(500), sourceProvider VARCHAR(100),
  category VARCHAR(50),
  thumbnailUrl TEXT,
  isPinned BOOLEAN DEFAULT false,
  publishedAt DATETIME,
  createdAt
)
\`\`\`

### customBlocks
\`\`\`sql
customBlocks (
  id, userId, name, description,
  blockType VARCHAR(50),
  config JSON,  -- 區塊設定
  isPublic BOOLEAN DEFAULT false,
  createdAt, updatedAt
)
\`\`\`

### blockCombos（即 customBlocksCombo）
\`\`\`sql
customBlocksCombo (
  id, userId, name, description,
  blockIds JSON,  -- 組合的 block ID 陣列
  workflow JSON,  -- 執行流程定義
  createdAt, updatedAt
)
\`\`\`

---

## 筆記與日曆表

### projectNotesCalendar
\`\`\`sql
projectNotesCalendar (
  id, userId, title, content TEXT,
  noteType ENUM('note','event','reminder','idea'),
  scheduledAt DATETIME,  -- 日曆事件時間
  tags JSON,
  isCompleted BOOLEAN DEFAULT false,
  createdAt, updatedAt
)
\`\`\`

---

## 系統監控表

### apiUsageLogs
\`\`\`sql
apiUsageLogs (
  id, userId,
  service VARCHAR(100),  -- 'openai','fal','elevenlabs' 等
  endpoint VARCHAR(255),
  statusCode INT,
  latencyMs INT,
  inputTokens INT, outputTokens INT,
  creditsCharged INT,
  createdAt
)
\`\`\`

### userModelSwitchLogs
\`\`\`sql
userModelSwitchLogs (
  id, userId,
  fromModel VARCHAR(100),
  toModel VARCHAR(100),
  reason TEXT,
  modality VARCHAR(50),
  createdAt
)
\`\`\`

### userFeedbackReports
\`\`\`sql
userFeedbackReports (
  id, userId,
  feedbackType ENUM('bug','suggestion','rating','other'),
  subject VARCHAR(255),
  content TEXT,
  rating INT,  -- 1-5 星（LangSmith 評分）
  metadata JSON,
  status ENUM('pending','reviewed','resolved'),
  createdAt, updatedAt
)
\`\`\`

### systemSettings
\`\`\`sql
systemSettings (
  id, key VARCHAR(100) UNIQUE,
  value JSON,
  description TEXT,
  updatedBy VARCHAR(36),  -- 管理員 userId
  updatedAt
)
\`\`\`

---

## 表關聯圖

\`\`\`
users ─┬─ userSubscriptions → subscriptionPlans
       ├─ externalServiceSubscriptions
       ├─ generationHistory
       ├─ digitalAssetLibrary → r2StorageSnapshots
       ├─ backgroundJobs
       ├─ aiDirectorPreferences
       ├─ userAiBrain
       ├─ consistencyVault
       ├─ fineTunedModels
       ├─ promptLibrary
       ├─ featuredShowcase
       ├─ customBlocks → customBlocksCombo
       ├─ projectNotesCalendar
       ├─ apiUsageLogs
       ├─ userModelSwitchLogs
       └─ userFeedbackReports
\`\`\`
`,
    tags: ["資料庫", "Schema", "SQL", "MySQL", "Drizzle"],
    difficulty: "advanced",
    readingMinutes: 12,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-news-system",
    title: "AI 新聞系統完整指南",
    category: "ai-news",
    summary: "說明 /news 頁面的新聞抓取機制（BraveLearnFetcher）、定時任務、newsArticles 表與置頂功能。",
    content: `# AI 新聞系統完整指南

## 什麼是 AI 新聞系統？

**路徑**：\`/news\`

Healing Studio 內建 AI 新聞聚合系統，自動從多個來源抓取最新 AI 領域新聞，讓使用者不離開網站就能掌握行業動態。

---

## 新聞抓取機制

### BraveLearnFetcher

使用 **Brave Search API** 抓取 AI 相關新聞：

\`\`\`typescript
// 搜尋關鍵字
const AI_NEWS_QUERIES = [
  "artificial intelligence news",
  "large language model update",
  "generative AI breakthrough",
  "AI image video generation",
  "machine learning research"
];
\`\`\`

每次抓取最多 **20 篇**新聞，去重後存入 \`newsArticles\` 表。

### newsFetcher Cron 定時任務

| 任務 | 頻率 | 說明 |
|------|------|------|
| 新聞抓取 | 每 6 小時 | 自動更新新聞列表 |
| 舊聞清理 | 每天 00:00 | 刪除 30 天前的文章 |

---

## newsArticles 表結構

\`\`\`sql
newsArticles (
  id, title,
  summary TEXT,    -- AI 自動生成的摘要
  content TEXT,    -- 完整內容（若可取得）
  sourceUrl VARCHAR(500),
  sourceProvider VARCHAR(100),  -- 'brave','openai-blog','anthropic' 等
  category VARCHAR(50),
  thumbnailUrl TEXT,
  isPinned BOOLEAN DEFAULT false,  -- 管理員置頂
  publishedAt DATETIME,
  createdAt
)
\`\`\`

---

## 新聞分類（categories）

| 分類 | 說明 |
|------|------|
| \`breakthrough\` | 重大技術突破 |
| \`product\` | 新產品或功能發布 |
| \`research\` | 學術研究論文 |
| \`industry\` | 產業動態與商業新聞 |
| \`tutorial\` | 教學與實踐指南 |
| \`policy\` | AI 政策與法規 |

---

## 置頂功能（isPinned）

管理員可在後台將重要新聞設為置頂：
- 置頂文章始終顯示在列表最頂端
- 置頂文章有醒目的視覺標記
- 最多同時置頂 3 篇

---

## 前端功能

### 新聞卡片

每篇新聞顯示：
- 縮圖
- 標題（最多 2 行）
- AI 摘要（最多 3 行）
- 來源名稱與發布時間
- 「閱讀原文」按鈕（外部連結）

### 篩選與搜尋

- **分類篩選**：點擊分類 Tag
- **關鍵字搜尋**：標題全文搜尋
- **時間篩選**：今日 / 本週 / 本月

### 「加入 AI Brain」功能

閱讀新聞時，點擊「讓 AI Brain 學習此文」按鈕：
- AI 自動萃取文章重點
- 存入使用者的 AI Brain 知識庫
- 影響 Director AI 的後續建議

---

## 管理員功能

- 手動觸發新聞抓取
- 審核並刪除不適當內容
- 設定置頂文章
- 查看各分類文章數量統計
`,
    tags: ["新聞", "AI動態", "Brave", "自動抓取", "RSS"],
    difficulty: "intermediate",
    readingMinutes: 6,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-health-monitoring",
    title: "系統健康監控完整指南",
    category: "api-docs",
    summary: "說明 apiHealthMonitor、Circuit Breaker 熔斷機制與 BrainAutoRepair 自動修復系統。",
    content: `# 系統健康監控完整指南

## 監控系統架構

Healing Studio 有三層監控機制，確保系統穩定性：

1. **API 健康監控**（apiHealthMonitor）
2. **Circuit Breaker 熔斷器**
3. **BrainAutoRepair 自動修復**

---

## 1. API 健康監控（apiHealthMonitor）

定期測試所有外部 API 的可用性：

### 監控的服務

| 服務 | 監控端點 | 頻率 |
|------|----------|------|
| OpenAI | \`/v1/models\` | 每 5 分鐘 |
| FAL.ai | \`/queue/health\` | 每 5 分鐘 |
| ElevenLabs | \`/v1/user\` | 每 10 分鐘 |
| Pinecone | Index Stats | 每 10 分鐘 |
| Gemini | \`/v1/models\` | 每 5 分鐘 |

### 健康狀態定義

| 狀態 | 說明 | 觸發條件 |
|------|------|----------|
| \`healthy\` | 正常運作 | 回應時間 < 2000ms |
| \`degraded\` | 效能下降 | 回應時間 2000–5000ms |
| \`down\` | 服務中斷 | 回應時間 > 5000ms 或錯誤 |

### Discord 告警

當任何服務狀態從 \`healthy\` 變為 \`down\` 時，系統自動發送 Discord Webhook 通知。

---

## 2. Circuit Breaker 熔斷器

防止連鎖故障的保護機制：

\`\`\`
正常狀態 → 呼叫失敗 5 次 → 熔斷（Open）
     ↑                              ↓
 恢復正常 ← 測試成功 ← 半開（Half-Open，30 秒後）
\`\`\`

### 熔斷設定

| 參數 | 值 | 說明 |
|------|----|----|
| 失敗門檻 | 5 次 | 連續失敗 5 次觸發熔斷 |
| 重置時間 | 30 秒 | 熔斷後等待時間 |
| 半開測試 | 1 次請求 | 測試服務是否恢復 |

### 熔斷時的行為

- 熔斷器開啟期間，所有呼叫立即返回錯誤（不等待超時）
- 前端顯示「此服務暫時不可用，系統正在自動修復」
- 自動切換到備用模型（如果有的話）

---

## 3. BrainAutoRepair 自動修復

當 AI Brain（Director AI）的回應品質下降時，自動進行修復：

### 精準度測試機制

\`\`\`typescript
// 使用 Gemini Flash 進行精準度測試（非 Pro，以節省 token）
const testResponse = await geminiFlash.generate({
  prompt: ACCURACY_TEST_PROMPT,
  maxTokens: 8192
});
const score = evaluateAccuracy(testResponse);
\`\`\`

### 修復觸發條件

| 觸發條件 | 說明 |
|----------|------|
| 精準度分數 < 70% | AI 回應品質下降 |
| 連續 3 次無法完成任務 | 系統性錯誤 |
| 使用者 1 星評分率 > 20% | 使用者滿意度過低 |

### 修復流程

1. 分析最近 100 筆失敗記錄
2. 識別問題模式（token 超出 / 格式錯誤 / 幻覺）
3. 自動調整系統提示詞
4. 重置對話記憶中的錯誤資訊
5. 記錄修復操作到 \`systemSettings\`

---

## 管理員監控頁面（/admin）

在管理員後台可查看：

- 所有外部 API 的即時狀態
- Circuit Breaker 狀態
- BrainAutoRepair 最近觸發記錄
- 系統整體健康分數（0–100）

---

## 緊急降級模式

當多個關鍵服務同時不可用時，系統進入**降級模式**：
- 只保留文字對話功能（使用本地模型）
- 圖像/影片生成功能暫停
- 頁面頂部顯示系統維護橫幅
`,
    tags: ["監控", "健康檢查", "Circuit Breaker", "自動修復", "穩定性"],
    difficulty: "advanced",
    readingMinutes: 9,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-home-page",
    title: "首頁完整功能指南",
    category: "getting-started",
    summary: "說明首頁（/）的 ShowcaseMasonry 展示牆、Sense Engine 觸發機制、功能卡展示區與 Demo 模式入口。",
    content: `# 首頁完整功能指南

## 首頁路徑

**路徑**：\`/\`（根路徑）

首頁是 Healing Studio 的門面，整合了社群展示、功能導航與智慧推薦。

---

## ShowcaseMasonry 展示牆

首頁最醒目的區塊是 Masonry 瀑布流展示牆，展示精選的 AI 生成作品。

### 展示牆特性

- **瀑布流排版**：作品以不等高的 Masonry 格局呈現
- **多媒體支援**：圖像、影片、音頻縮圖都可展示
- **Cursor 分頁**：無限下滾載入更多作品
- **按讚互動**：點擊愛心按鈕，likeCount 即時更新

### 展示牆資料來源

- 資料來自 \`featuredShowcase\` 資料庫表
- 以 \`sortWeight DESC, createdAt DESC\` 排序
- 只顯示 \`isActive = true\` 的作品

---

## Sense Engine 觸發區

### 觸發機制

當 Sense Engine 偵測到使用者的行為模式，首頁 UI 會自動調整：

| 偵測到的心理狀態 | UI 變化 |
|-----------------|---------|
| \`choice_paralysis\` | 彈出「為你推薦」浮動卡片 |
| \`exploration_mode\` | 展開完整功能地圖導覽 |
| \`inspiration_seeking\` | 自動播放精選影片 Reel |
| \`passive_browsing\` | 展示牆進入自動輪播模式 |

### 觸發時機

- 頁面停留超過 **30 秒**後開始分析行為
- 收集到足夠事件（至少 3 種不同事件）後觸發判定

---

## 功能卡展示區

首頁中段有一排功能入口卡片，讓使用者快速跳轉到各工具：

| 功能卡 | 連結 | 說明 |
|--------|------|------|
| 創作工作室 | \`/studio\` | 四模態 AI 創作 |
| Director AI | \`/director\` | 智慧對話與腳本 |
| 圖像工作室 | \`/image-studio\` | 進階圖像生成 |
| 影片工作室 | \`/video-studio\` | 影片生成與編輯 |
| 語音複製 | \`/pro-studio\` | 聲音克隆與合成 |
| 3D 建模 | \`/assets\`（3D Tab）| 3D 模型生成 |
| LoRA 訓練 | \`/lora-trainer\` | 自訂模型訓練 |
| 新聞中心 | \`/news\` | AI 產業動態 |

### 個性化排序

已登入使用者的功能卡會根據使用頻率自動排序——最常用的功能卡排在最前面。

---

## Demo 模式入口

未登入的訪客可以使用 **Demo 模式**體驗核心功能：

- Demo 模式按鈕位於首頁右上角
- Demo 使用者有 **10 積分**的免費試用額度
- Demo 積分不可累積，頁面重整後重置

### Demo 支援的功能

| 功能 | Demo 限制 |
|------|-----------|
| 圖像生成 | 最多 2 張，512x512 尺寸 |
| 文字對話 | 最多 5 輪對話 |
| 音頻生成 | 最多 30 秒音頻 |

---

## 頁首（Header）元素

| 元素 | 說明 |
|------|------|
| Logo | 點擊返回首頁 |
| 搜尋框 | 全站內容搜尋（快捷鍵 Cmd/Ctrl+K） |
| 通知鈴鐺 | 背景任務完成通知 |
| 積分顯示 | 當前積分餘額（紅色表示積分不足）|
| 頭像選單 | 個人設定、登出等 |

---

## 頁尾（Footer）元素

- 版本號
- 服務條款與隱私政策連結
- Discord 社群連結
- API 狀態頁連結（顯示即時系統健康）
`,
    tags: ["首頁", "Masonry", "展示", "Demo", "導航"],
    difficulty: "beginner",
    readingMinutes: 7,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  {
    id: "kb-background-jobs-db",
    title: "backgroundJobs 資料表完整指南",
    category: "api-docs",
    summary: "說明 backgroundJobs 表的 jobType enum、status 狀態流程、resultJson 格式規範與 30 分鐘超時機制。",
    content: `# backgroundJobs 資料表完整指南

## 資料表定位

\`backgroundJobs\` 是背景任務系統的核心資料表，記錄所有非同步 AI 生成任務的生命週期。

---

## 完整欄位定義

\`\`\`sql
CREATE TABLE backgroundJobs (
  id            VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  userId        VARCHAR(36) NOT NULL,
  jobType       ENUM(
                  'image_generation',
                  'video_generation',
                  'audio_generation',
                  'voice_cloning',
                  '3d_generation',
                  'lora_training',
                  'video_script',
                  'cross_modal',
                  'batch_export'
                ) NOT NULL,
  status        ENUM('pending','processing','completed','failed','cancelled')
                DEFAULT 'pending',
  inputJson     JSON,       -- 任務輸入參數（因模型不同而異）
  resultJson    JSON,       -- 任務輸出結果（見下方格式說明）
  errorMessage  TEXT,       -- 失敗時的錯誤訊息
  priority      TINYINT DEFAULT 5,  -- 1（最高）到 10（最低）
  startedAt     DATETIME,
  completedAt   DATETIME,
  createdAt     DATETIME DEFAULT NOW(),
  updatedAt     DATETIME ON UPDATE NOW(),
  INDEX idx_userId_status (userId, status),
  INDEX idx_createdAt (createdAt)
);
\`\`\`

---

## jobType 各類型說明

### image_generation

\`\`\`json
// inputJson 格式
{
  "modelId": "fal-ai/flux/dev",
  "prompt": "a beautiful sunset over mountains",
  "negativePrompt": "blur, distortion",
  "width": 1024, "height": 1024,
  "steps": 28, "guidance": 3.5,
  "seed": 42,
  "loraId": "optional-lora-id"
}

// resultJson 格式
{
  "imageUrl": "https://cdn.fal.ai/...",
  "thumbnailUrl": "https://cdn.fal.ai/...thumb.jpg",
  "seed": 42,
  "width": 1024, "height": 1024
}
\`\`\`

### video_generation

\`\`\`json
// inputJson 格式
{
  "modelId": "fal-ai/wan/t2v-turbo",
  "prompt": "camera slowly panning over a forest",
  "duration": 5,
  "resolution": "720p"
}

// resultJson 格式
{
  "videoUrl": "https://cdn.fal.ai/....mp4",
  "thumbnailUrl": "https://cdn.fal.ai/...thumb.jpg",
  "duration": 5.2,
  "fps": 24,
  "width": 1280, "height": 720
}
\`\`\`

### audio_generation

\`\`\`json
// inputJson 格式
{
  "modelId": "suno/bark",
  "prompt": "peaceful meditation music with flute",
  "duration": 60,
  "style": "ambient"
}

// resultJson 格式
{
  "audioUrl": "https://cdn.fal.ai/....mp3",
  "duration": 62.4,
  "sampleRate": 44100
}
\`\`\`

### voice_cloning

\`\`\`json
// inputJson 格式
{
  "text": "要轉換的文字內容",
  "voiceId": "elevenlabs-voice-id",
  "model": "eleven_multilingual_v2",
  "speed": 1.0, "stability": 0.5
}

// resultJson 格式
{
  "audioUrl": "https://...",
  "duration": 8.3,
  "characterCount": 150
}
\`\`\`

### lora_training

\`\`\`json
// inputJson 格式
{
  "modelType": "flux-lora",
  "baseModel": "flux-dev",
  "trainingSteps": 1500,
  "learningRate": 0.0001,
  "loraRank": 32,
  "datasetId": "training-set-uuid"
}

// resultJson 格式
{
  "downloadUrl": "https://r2.example.com/loras/....zip",
  "modelId": "fine-tuned-model-uuid",
  "finalLoss": 0.0023,
  "validationImages": ["url1", "url2", "url3"]
}
\`\`\`

---

## status 狀態流程

\`\`\`
建立任務
    ↓
pending ─────────────────── 排隊中（等待工作執行緒）
    ↓
processing ──────────────── 執行中（呼叫外部 API）
    ↓              ↓
completed        failed
（儲存結果）    （儲存錯誤訊息）
    
任何狀態 → cancelled（使用者手動取消）
\`\`\`

---

## 30 分鐘超時機制

**超時邏輯**（\`server/routers.ts\`）：

\`\`\`typescript
// 定時任務：每 5 分鐘掃描超時任務
const checkTimeouts = async () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  
  await db.update(backgroundJobs)
    .set({
      status: 'failed',
      errorMessage: 'Task timeout after 30 minutes',
      completedAt: new Date()
    })
    .where(
      and(
        eq(backgroundJobs.status, 'processing'),
        lt(backgroundJobs.startedAt, thirtyMinutesAgo)
      )
    );
};
\`\`\`

---

## 查詢 API

| API 端點 | 說明 |
|----------|------|
| \`backgroundTask.create\` | 建立新任務 |
| \`backgroundTask.getStatus\` | 查詢任務狀態（前端輪詢用）|
| \`backgroundTask.list\` | 取得使用者的任務列表 |
| \`backgroundTask.cancel\` | 取消進行中的任務 |
| \`backgroundTask.retry\` | 重試失敗的任務 |

---

## 資料清理策略

- \`completed\` 且超過 **7 天**：保留 resultJson，清空 inputJson
- \`failed\` 且超過 **30 天**：整筆刪除
- \`cancelled\` 且超過 **3 天**：整筆刪除
- 定時清理任務每天 02:00（UTC）執行
`,
    tags: ["backgroundJobs", "資料庫", "背景任務", "非同步", "Schema"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

];

// ─── In-memory store（後端無 DB 表時使用） ────────────────────────────────

let docs: LearnDoc[] = [...SEED_DOCS];

/**
 * 提供給 learnDocSyncer 等外部模組存取 docs 陣列的接口。
 * 新增文件時，syncer 會呼叫 addLearnDoc；查詢是否已存在時使用 hasLearnDoc。
 */
export function addLearnDoc(doc: LearnDoc): void {
  docs.unshift(doc);
}
export function hasLearnDoc(id: string): boolean {
  return docs.some(d => d.id === id);
}
export function getLearnDocCount(): number {
  return docs.length;
}

// ─── Video Types & Seed Data ─────────────────────────────────────────────────

export type VideoCategory =
  | "getting-started"
  | "model-guide"
  | "technique"
  | "workflow"
  | "ai-news";

export interface LearnVideo {
  id: string;
  category: VideoCategory;
  title: string;
  summary: string;
  videoUrl: string; // YouTube / external video URL
  thumbnailUrl?: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  durationMinutes: number;
  publishedAt: string;
  updatedAt: string;
  featured: boolean;
  authorName?: string;
}

const SEED_VIDEOS: LearnVideo[] = [
  {
    id: "video-001",
    category: "getting-started",
    title: "Healing Studio 快速入門",
    summary: "5 分鐘帶你了解 Healing Studio 的核心功能與操作方式",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["入門", "教學", "快速上手"],
    difficulty: "beginner",
    durationMinutes: 5,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "video-002",
    category: "technique",
    title: "AI 圖片生成技巧：Prompt 寫作進階",
    summary: "深入了解如何撰寫有效的 Prompt 來生成高品質圖片",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["Prompt", "圖片生成", "進階技巧"],
    difficulty: "intermediate",
    durationMinutes: 12,
    publishedAt: "2026-04-05T00:00:00Z",
    updatedAt: "2026-04-05T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "video-003",
    category: "model-guide",
    title: "模型比較：選擇最適合你的 AI 模型",
    summary: "比較不同 AI 模型的特點與適用場景",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["模型", "比較", "選擇指南"],
    difficulty: "beginner",
    durationMinutes: 8,
    publishedAt: "2026-04-08T00:00:00Z",
    updatedAt: "2026-04-08T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "video-004",
    category: "workflow",
    title: "導演模式完整教學",
    summary: "從零開始學會使用導演模式創作 AI 影片",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["導演模式", "影片創作", "工作流程"],
    difficulty: "intermediate",
    durationMinutes: 15,
    publishedAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "video-005",
    category: "technique",
    title: "LoRA 模型訓練實戰",
    summary: "手把手教你訓練自己的 LoRA 模型",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["LoRA", "模型訓練", "高級"],
    difficulty: "advanced",
    durationMinutes: 20,
    publishedAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "video-006",
    category: "ai-news",
    title: "2026 年 AI 創作趨勢展望",
    summary: "回顧與展望 AI 創作技術的最新發展",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tags: ["AI趨勢", "新聞", "展望"],
    difficulty: "beginner",
    durationMinutes: 10,
    publishedAt: "2026-04-15T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
];

let videos: LearnVideo[] = [...SEED_VIDEOS];

// ─── Quiz Types & Seed Data ──────────────────────────────────────────────────

export type QuizCategory =
  | "getting-started"
  | "model-guide"
  | "technique"
  | "workflow"
  | "pro-studio"
  | "director-ai"
  | "3d-modeling"
  | "tools-features"
  | "safety-privacy";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LearnQuiz {
  id: string;
  category: QuizCategory;
  title: string;
  summary: string;
  questions: QuizQuestion[];
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedMinutes: number;
  publishedAt: string;
  updatedAt: string;
  featured: boolean;
  authorName?: string;
}

const SEED_QUIZZES: LearnQuiz[] = [
  {
    id: "quiz-001",
    category: "getting-started",
    title: "Healing Studio 基礎知識測驗",
    summary: "測試你對 Healing Studio 基本操作的了解程度",
    questions: [
      {
        id: "q1-1",
        question: "Healing Studio 的核心理念是什麼？",
        options: ["高效生產", "療癒放鬆創作", "競爭比賽", "快速輸出"],
        correctIndex: 1,
        explanation:
          "Healing Studio 主打「療癒放鬆創作」，以人為本，不讓使用者焦慮。",
      },
      {
        id: "q1-2",
        question: "要生成一張 AI 圖片，首先應該前往哪個頁面？",
        options: ["設定頁", "圖片工作室", "學習文件中心", "行事曆"],
        correctIndex: 1,
        explanation: "圖片工作室（Image Studio）是生成 AI 圖片的主要工作區。",
      },
      {
        id: "q1-3",
        question: "光球（Orb）助手可以幫你做什麼？",
        options: [
          "只能聊天",
          "導航頁面、生成內容、提供創作靈感",
          "只能搜尋文件",
          "只能修改設定",
        ],
        correctIndex: 1,
        explanation:
          "光球助手是全站 AI Agent，可以導航頁面、協助創作、提供靈感等多種功能。",
      },
    ],
    tags: ["入門", "基礎", "平台功能"],
    difficulty: "beginner",
    estimatedMinutes: 3,
    publishedAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "quiz-002",
    category: "technique",
    title: "Prompt 寫作技巧測驗",
    summary: "測試你對 AI Prompt 撰寫的掌握程度",
    questions: [
      {
        id: "q2-1",
        question: "以下哪種 Prompt 寫法最可能產生高品質的圖片？",
        options: [
          "一隻貓",
          "一隻可愛的橘色貓咪，坐在窗台上，自然光照射，柔和散景背景",
          "貓貓貓貓貓",
          "cat",
        ],
        correctIndex: 1,
        explanation:
          "具體描述主體、場景、光線和風格的 Prompt 通常能產生更好的結果。",
      },
      {
        id: "q2-2",
        question: "負面提詞（Negative Prompt）的作用是什麼？",
        options: [
          "增加圖片亮度",
          "告訴 AI 不要生成哪些元素",
          "加速生成速度",
          "改變圖片解析度",
        ],
        correctIndex: 1,
        explanation:
          "負面提詞告訴 AI 應該避免生成的元素，例如 'blurry, low quality' 等。",
      },
      {
        id: "q2-3",
        question: "提詞中的權重標記（如 (keyword:1.5)）有什麼作用？",
        options: [
          "改變圖片大小",
          "增強或減弱某個關鍵詞的影響力",
          "改變生成速度",
          "不會有任何效果",
        ],
        correctIndex: 1,
        explanation:
          "權重標記可以調整特定關鍵詞對生成結果的影響程度，數值越高影響越大。",
      },
      {
        id: "q2-4",
        question: "以下哪個不是常見的圖片風格描述詞？",
        options: ["photorealistic", "watercolor", "pixel art", "database"],
        correctIndex: 3,
        explanation:
          "'database' 不是圖片風格描述詞，其他三個都是常用的風格關鍵詞。",
      },
    ],
    tags: ["Prompt", "技巧", "圖片生成"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-05T00:00:00Z",
    updatedAt: "2026-04-05T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },
  {
    id: "quiz-003",
    category: "model-guide",
    title: "AI 模型知識測驗",
    summary: "了解你對不同 AI 模型的認知程度",
    questions: [
      {
        id: "q3-1",
        question: "LoRA 模型的主要用途是什麼？",
        options: [
          "訓練全新的 AI 模型",
          "微調現有模型以適應特定風格或主題",
          "壓縮圖片檔案",
          "翻譯文件",
        ],
        correctIndex: 1,
        explanation:
          "LoRA（Low-Rank Adaptation）是一種輕量化的模型微調技術，可以讓現有模型學習特定風格。",
      },
      {
        id: "q3-2",
        question: "什麼是 CFG Scale（引導尺度）？",
        options: [
          "圖片的解析度設定",
          "AI 遵循提詞的程度",
          "模型的大小",
          "生成速度的設定",
        ],
        correctIndex: 1,
        explanation:
          "CFG Scale 控制 AI 生成結果與你的提詞之間的一致性，數值越高越嚴格遵循提詞。",
      },
      {
        id: "q3-3",
        question: "以下哪個是影片生成模型？",
        options: ["DALL-E", "Kling", "BERT", "GPT"],
        correctIndex: 1,
        explanation: "Kling 是一個 AI 影片生成模型，可以從文字或圖片生成影片。",
      },
    ],
    tags: ["模型", "LoRA", "技術知識"],
    difficulty: "intermediate",
    estimatedMinutes: 4,
    publishedAt: "2026-04-08T00:00:00Z",
    updatedAt: "2026-04-08T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
  {
    id: "quiz-004",
    category: "workflow",
    title: "創作流程進階測驗",
    summary: "測試你對 Healing Studio 進階工作流程的理解",
    questions: [
      {
        id: "q4-1",
        question: "導演模式（Director AI）的主要功能是什麼？",
        options: [
          "寫程式碼",
          "將劇本拆分為分鏡並生成影片",
          "管理使用者帳號",
          "壓縮檔案",
        ],
        correctIndex: 1,
        explanation:
          "導演模式可以自動將你的劇本拆分為多個分鏡，並為每個分鏡生成 AI 影片。",
      },
      {
        id: "q4-2",
        question: "一致性金庫（Consistency Vault）的作用是什麼？",
        options: [
          "儲存密碼",
          "保存並重複使用角色外觀，確保跨場景的角色一致性",
          "備份檔案",
          "管理帳單",
        ],
        correctIndex: 1,
        explanation:
          "一致性金庫讓你儲存角色的參考圖片和描述，在不同場景中保持角色外觀一致。",
      },
      {
        id: "q4-3",
        question: "批次生成（Batch Generation）適合在什麼情境使用？",
        options: [
          "只需要一張圖時",
          "需要同時生成多個變化版本時",
          "只是瀏覽作品時",
          "修改個人設定時",
        ],
        correctIndex: 1,
        explanation:
          "批次生成適合在你需要探索多個不同版本或大量生成素材的時候使用。",
      },
    ],
    tags: ["工作流程", "導演模式", "進階"],
    difficulty: "advanced",
    estimatedMinutes: 4,
    publishedAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 圖片工作室模型深度測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-005",
    category: "model-guide",
    title: "圖片工作室模型深度測驗",
    summary: "深入考驗你對 23 種圖片生成模型的了解程度",
    questions: [
      {
        id: "q5-1",
        question: "Nano Banana 2 和 Nano Banana 2 Pro 的主要差異是什麼？",
        options: [
          "只有名稱不同",
          "Pro 版本支援更高解析度與更精緻的細節表現",
          "Pro 版本只能生成黑白圖片",
          "兩者完全相同",
        ],
        correctIndex: 1,
        explanation:
          "Nano Banana 2 Pro 是進階版本，在解析度和細節品質上都有顯著提升。",
      },
      {
        id: "q5-2",
        question: "Seedream v4 模型的最大特色是什麼？",
        options: [
          "只能生成風景照",
          "支援中英文雙語提詞，擅長東亞美學風格",
          "只支援英文提詞",
          "是一個影片生成模型",
        ],
        correctIndex: 1,
        explanation:
          "Seedream v4 是字節跳動開發的模型，支援中英文提詞，特別擅長東亞美學風格的圖片生成。",
      },
      {
        id: "q5-3",
        question: "Flux Kontext 模型的核心功能是什麼？",
        options: [
          "文字生成圖片",
          "基於參考圖片進行上下文感知編輯",
          "3D 模型生成",
          "音樂生成",
        ],
        correctIndex: 1,
        explanation:
          "Flux Kontext 是 Black Forest Labs 的圖片編輯模型，能理解圖片上下文並進行精確編輯。",
      },
      {
        id: "q5-4",
        question: "SeedVR Upscale 的主要用途是什麼？",
        options: [
          "降低圖片品質",
          "將低解析度圖片放大至高解析度，同時保持或提升畫質",
          "裁切圖片",
          "添加浮水印",
        ],
        correctIndex: 1,
        explanation:
          "SeedVR Upscale 是超分辨率工具，可以將圖片放大同時保持甚至提升畫質。",
      },
      {
        id: "q5-5",
        question: "DWPose 骨架偵測在創作流程中扮演什麼角色？",
        options: [
          "生成隨機圖片",
          "偵測人體姿勢骨架，作為 ControlNet 的控制條件",
          "壓縮圖片檔案大小",
          "自動添加文字到圖片",
        ],
        correctIndex: 1,
        explanation:
          "DWPose 可以從參考圖片中偵測出人體骨架姿勢，搭配 ControlNet 使用來精確控制生成圖片的人物姿態。",
      },
      {
        id: "q5-6",
        question: "以下哪個不是圖片工作室中的「圖片編輯」類模型？",
        options: [
          "GPT Image 1.5",
          "Grok Edit",
          "Imagen 4",
          "Seedream v4.5 Edit",
        ],
        correctIndex: 2,
        explanation:
          "Imagen 4 是 Google 的文字生圖模型，不是圖片編輯模型。GPT Image 1.5、Grok Edit 和 Seedream v4.5 Edit 都屬於圖片編輯類別。",
      },
    ],
    tags: ["圖片模型", "Image Studio", "模型比較"],
    difficulty: "intermediate",
    estimatedMinutes: 6,
    publishedAt: "2026-04-11T00:00:00Z",
    updatedAt: "2026-04-11T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 影片工作室模型深度測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-006",
    category: "model-guide",
    title: "影片工作室模型深度測驗",
    summary: "考驗你對 21 種影片生成模型的細節掌握",
    questions: [
      {
        id: "q6-1",
        question: "Kling v2.1 與前代版本相比，最大改進是什麼？",
        options: [
          "生成速度減慢",
          "動態表現力和物理一致性大幅提升",
          "只支援黑白影片",
          "取消了圖片轉影片功能",
        ],
        correctIndex: 1,
        explanation:
          "Kling v2.1 在動態表現力和物理一致性方面有顯著提升，讓生成的影片更自然流暢。",
      },
      {
        id: "q6-2",
        question: "Google Veo 3 的獨特之處是什麼？",
        options: [
          "只能生成靜態圖片",
          "是首個支援原生音頻的影片生成模型",
          "不支援文字提詞",
          "只能生成 3 秒影片",
        ],
        correctIndex: 1,
        explanation:
          "Veo 3 是 Google 推出的首個原生音頻影片生成模型，能同時生成影片和對應的音效。",
      },
      {
        id: "q6-3",
        question: "MiniMax video-01 模型最擅長什麼類型的影片？",
        options: [
          "只能做 3D 動畫",
          "擅長電影級品質的長片段生成",
          "只能做簡單動畫",
          "只能做靜態幻燈片",
        ],
        correctIndex: 1,
        explanation:
          "MiniMax video-01 擅長生成電影級品質的影片，在長片段生成上表現優異。",
      },
      {
        id: "q6-4",
        question: "Wan 2.1 影片模型有幾種變體？",
        options: [
          "只有 1 種",
          "有 1.3B 和 14B 兩種參數規模的變體",
          "有 10 種變體",
          "沒有不同變體",
        ],
        correctIndex: 1,
        explanation:
          "Wan 2.1 提供 1.3B（輕量快速）和 14B（高品質）兩種參數規模的變體。",
      },
      {
        id: "q6-5",
        question: "使用「圖片轉影片」功能時，最重要的注意事項是什麼？",
        options: [
          "輸入圖片的解析度無所謂",
          "確保輸入圖片品質高且構圖清晰，提詞描述預期的動態效果",
          "只能使用黑白圖片",
          "不需要任何提詞",
        ],
        correctIndex: 1,
        explanation:
          "高品質的輸入圖片加上清楚描述預期動態的提詞，能讓圖片轉影片的效果最佳。",
      },
      {
        id: "q6-6",
        question: "LTX Video v0.9.7 的特點是什麼？",
        options: [
          "品質最高但速度最慢",
          "速度極快，適合快速原型和預覽",
          "只支援 4K 解析度",
          "不支援文字提詞",
        ],
        correctIndex: 1,
        explanation:
          "LTX Video 系列以生成速度快著稱，非常適合快速迭代和預覽概念。",
      },
    ],
    tags: ["影片模型", "Video Studio", "Kling", "Veo"],
    difficulty: "intermediate",
    estimatedMinutes: 6,
    publishedAt: "2026-04-11T00:00:00Z",
    updatedAt: "2026-04-11T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 音樂配音創作室完整測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-007",
    category: "pro-studio",
    title: "音樂配音創作室完整測驗",
    summary: "測試你對 Pro Studio 8 大功能和 20+ 工具的掌握",
    questions: [
      {
        id: "q7-1",
        question: "Sonauto 音樂生成工具支援哪些進階參數控制？",
        options: [
          "只能輸入文字描述",
          "支援 MIDI 風格選擇和 BPM 控制",
          "只能調整音量",
          "不支援任何參數控制",
        ],
        correctIndex: 1,
        explanation:
          "Sonauto 支援 MIDI 風格選擇和 BPM（每分鐘節拍數）控制，讓你精確調整音樂風格和節奏。",
      },
      {
        id: "q7-2",
        question: "ElevenLabs 音效生成的時長範圍是多少？",
        options: [
          "只能生成 1 秒",
          "0.5 至 22 秒",
          "1 至 60 秒",
          "沒有時長限制",
        ],
        correctIndex: 1,
        explanation:
          "ElevenLabs 音效生成支援 0.5 至 22 秒的精確時長控制。",
      },
      {
        id: "q7-3",
        question: "Demucs 音訊分離工具的主要功能是什麼？",
        options: [
          "合成新的音樂",
          "將音訊分離為人聲和背景音樂等獨立軌道",
          "壓縮音訊檔案",
          "轉換音訊格式",
        ],
        correctIndex: 1,
        explanation:
          "Demucs 可以將混合音訊分離為獨立的人聲、鼓、低音、其他樂器等軌道。",
      },
      {
        id: "q7-4",
        question: "以下哪個工具支援聲音克隆功能？",
        options: [
          "Sonauto",
          "Qwen Clone + Dia TTS",
          "WhisperX",
          "Demucs",
        ],
        correctIndex: 1,
        explanation:
          "Qwen Clone 和 Dia TTS 支援上傳聲音樣本來複製聲紋，實現聲音克隆功能。",
      },
      {
        id: "q7-5",
        question: "WhisperX 的主要功能是什麼？",
        options: [
          "生成音樂",
          "語音轉文字並生成精確的時間戳字幕",
          "生成影片",
          "聲音克隆",
        ],
        correctIndex: 1,
        explanation:
          "WhisperX 是語音轉文字工具，能精確辨識語音內容並生成帶有時間戳的字幕。",
      },
      {
        id: "q7-6",
        question: "說話頭像（Talking Head）功能使用了哪些技術？",
        options: [
          "只使用 GPT",
          "EchoMimic、Stable Avatar 和 Longcat Avatar 等模型",
          "只使用基本動畫",
          "只使用靜態圖片疊加",
        ],
        correctIndex: 1,
        explanation:
          "說話頭像功能整合了 EchoMimic、Stable Avatar 和 Longcat Avatar 等多個模型來實現逼真的口型同步效果。",
      },
      {
        id: "q7-7",
        question: "ElevenLabs Dubbing（影片配音）能做到什麼？",
        options: [
          "只能添加背景音樂",
          "自動翻譯並為影片重新配音",
          "只能錄製原始配音",
          "只能去除影片中的聲音",
        ],
        correctIndex: 1,
        explanation:
          "ElevenLabs Dubbing 可以自動將影片中的語音翻譯成其他語言並重新配音。",
      },
    ],
    tags: ["Pro Studio", "音樂", "配音", "語音"],
    difficulty: "intermediate",
    estimatedMinutes: 7,
    publishedAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 導演模式 CO-STAR 深度測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-008",
    category: "director-ai",
    title: "導演模式 CO-STAR 深度測驗",
    summary: "深入測試你對 Director AI 的 CO-STAR 框架和雙引擎 RAG 的了解",
    questions: [
      {
        id: "q8-1",
        question: "CO-STAR 框架中的 C、O、S、T、A、R 分別代表什麼？",
        options: [
          "Color, Object, Size, Time, Area, Range",
          "Context, Objective, Style, Tone, Audience, Response",
          "Camera, Operation, Scene, Take, Action, Result",
          "Create, Optimize, Share, Test, Analyze, Repeat",
        ],
        correctIndex: 1,
        explanation:
          "CO-STAR 是 Context（上下文）、Objective（目標）、Style（風格）、Tone（語調）、Audience（受眾）、Response（回應格式）的縮寫，用於結構化提詞設計。",
      },
      {
        id: "q8-2",
        question: "導演模式的「劇本拆分」功能如何運作？",
        options: [
          "手動逐句分割",
          "AI 自動分析劇本結構，將其拆分為多個分鏡段落",
          "只能按照段落分割",
          "需要手動標記每個分鏡的起止點",
        ],
        correctIndex: 1,
        explanation:
          "導演模式的 AI 會自動分析劇本內容，根據場景轉換、情緒變化等因素智能拆分為多個分鏡段落。",
      },
      {
        id: "q8-3",
        question: "Director AI 的「段落聊天」(Segment Chat) 功能有什麼作用？",
        options: [
          "只是普通聊天機器人",
          "針對單個分鏡段落進行 AI 輔助的 CO-STAR 提詞生成與微調",
          "只能翻譯字幕",
          "只能調整影片長度",
        ],
        correctIndex: 1,
        explanation:
          "段落聊天讓你與 AI 就單個分鏡段落進行深入對話，協助生成和優化該段落的 CO-STAR 提詞。",
      },
      {
        id: "q8-4",
        question: "Director AI 的「全局分析」(Global Analysis) 有什麼功能？",
        options: [
          "只分析單一分鏡",
          "綜合分析所有分鏡的一致性、節奏和整體敘事結構",
          "只檢查拼寫錯誤",
          "只計算影片總時長",
        ],
        correctIndex: 1,
        explanation:
          "全局分析會綜合檢視所有分鏡，確保風格一致性、節奏合理性和整體敘事結構的完整性。",
      },
      {
        id: "q8-5",
        question: "導演模式支援的「批次 CO-STAR」(Batch COSTAR) 是什麼？",
        options: [
          "一次刪除所有分鏡",
          "一次為所有分鏡自動生成 CO-STAR 框架提詞",
          "批量下載影片",
          "批量添加音效",
        ],
        correctIndex: 1,
        explanation:
          "批次 CO-STAR 可以一次為劇本中所有分鏡段落自動生成 CO-STAR 框架的結構化提詞。",
      },
      {
        id: "q8-6",
        question: "Director AI 使用的「雙引擎 RAG」指的是什麼？",
        options: [
          "兩個不同的聊天機器人",
          "結合向量搜尋和關鍵字搜尋的雙重檢索增強生成系統",
          "兩個不同的影片生成引擎",
          "兩種不同的字幕格式",
        ],
        correctIndex: 1,
        explanation:
          "雙引擎 RAG 結合了向量語義搜尋和傳統關鍵字搜尋，確保 AI 能找到最相關的知識來輔助創作。",
      },
    ],
    tags: ["導演模式", "CO-STAR", "RAG", "分鏡"],
    difficulty: "advanced",
    estimatedMinutes: 7,
    publishedAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    featured: true,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // LoRA 訓練進階測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-009",
    category: "technique",
    title: "LoRA 訓練進階測驗",
    summary: "深入測試你對 LoRA 模型訓練六種類型和進階參數的理解",
    questions: [
      {
        id: "q9-1",
        question: "Healing Studio 的角色鍛造所支援幾種 LoRA 模型訓練類型？",
        options: ["2 種", "4 種", "6 種", "10 種"],
        correctIndex: 2,
        explanation:
          "角色鍛造所支援 6 種 LoRA 訓練類型，涵蓋不同的風格學習和角色一致性需求。",
      },
      {
        id: "q9-2",
        question: "訓練 LoRA 模型時，「訓練步數」(Training Steps) 設定太高會怎樣？",
        options: [
          "品質一定會提升",
          "可能導致過擬合（Overfitting），模型失去創造力",
          "完全沒有影響",
          "生成速度會加快",
        ],
        correctIndex: 1,
        explanation:
          "訓練步數過高容易導致過擬合，模型會過度記憶訓練圖片而失去泛化能力和創造力。",
      },
      {
        id: "q9-3",
        question: "準備 LoRA 訓練資料集時，以下哪項最重要？",
        options: [
          "圖片數量越多越好，品質無所謂",
          "高品質、多角度、一致風格的圖片，搭配精確的標註描述",
          "只需要一張圖片就夠了",
          "圖片的解析度越低越好",
        ],
        correctIndex: 1,
        explanation:
          "高品質資料集需要多角度、一致風格的圖片配合精確的文字標註，這是訓練成功的關鍵。",
      },
      {
        id: "q9-4",
        question: "LoRA 的「Rank」(秩) 參數設定會影響什麼？",
        options: [
          "只影響檔案名稱",
          "控制模型的學習容量，Rank 越高表示模型可以學到更多細節",
          "只影響生成速度",
          "完全不影響訓練結果",
        ],
        correctIndex: 1,
        explanation:
          "Rank（秩）控制 LoRA 矩陣的維度，Rank 越高模型可以學到更複雜的特徵，但也更容易過擬合。",
      },
      {
        id: "q9-5",
        question: "使用 LoRA 模型生成圖片時，「觸發詞」(Trigger Word) 的作用是什麼？",
        options: [
          "只是裝飾性文字",
          "在提詞中加入觸發詞來啟用 LoRA 學到的特定風格或角色",
          "用來暫停生成",
          "用來改變圖片解析度",
        ],
        correctIndex: 1,
        explanation:
          "觸發詞是訓練時設定的關鍵詞，在生成提詞中加入觸發詞才能讓 LoRA 發揮其學到的風格效果。",
      },
      {
        id: "q9-6",
        question: "LoRA 模型與完整微調 (Full Fine-Tuning) 的主要差異是什麼？",
        options: [
          "沒有差異",
          "LoRA 只修改少量參數，檔案小且訓練快，Full Fine-Tuning 修改全部參數",
          "LoRA 品質一定比較差",
          "Full Fine-Tuning 不需要 GPU",
        ],
        correctIndex: 1,
        explanation:
          "LoRA 透過低秩分解只修改少量附加參數，模型檔案很小，而 Full Fine-Tuning 修改所有參數，需要更多資源。",
      },
    ],
    tags: ["LoRA", "模型訓練", "過擬合", "資料集"],
    difficulty: "advanced",
    estimatedMinutes: 7,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 3D 建模工具測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-010",
    category: "3d-modeling",
    title: "3D 建模工具完整測驗",
    summary: "測試你對 Trellis 2、HunYuan3D v3、SAM 3D 等 3D 工具的認識",
    questions: [
      {
        id: "q10-1",
        question: "Trellis 2 的主要功能是什麼？",
        options: [
          "文字聊天",
          "從單張圖片生成 3D 模型",
          "剪輯影片",
          "生成音樂",
        ],
        correctIndex: 1,
        explanation:
          "Trellis 2 可以從單張 2D 圖片生成完整的 3D 模型。",
      },
      {
        id: "q10-2",
        question: "HunYuan3D v3 與其他 3D 模型相比的優勢是什麼？",
        options: [
          "只能生成簡單形狀",
          "支援生成帶有高品質材質和紋理的精緻 3D 模型",
          "只支援線框模型",
          "不能從圖片生成",
        ],
        correctIndex: 1,
        explanation:
          "HunYuan3D v3 是騰訊開發的進階 3D 生成模型，能生成具有高品質材質和紋理的精緻模型。",
      },
      {
        id: "q10-3",
        question: "SAM 3D 的核心技術基礎是什麼？",
        options: [
          "基於 GPT 語言模型",
          "基於 Segment Anything Model 的 3D 分割技術",
          "基於音訊處理技術",
          "基於 CSS 動畫",
        ],
        correctIndex: 1,
        explanation:
          "SAM 3D 建立在 Meta 的 Segment Anything Model 之上，將 2D 分割能力擴展到 3D 空間。",
      },
      {
        id: "q10-4",
        question: "Rodin 3D 模型生成工具最適合什麼場景？",
        options: [
          "只能做平面設計",
          "生成高品質的角色和物件 3D 模型，適合遊戲和動畫場景",
          "只能做文字排版",
          "只能做 2D 插畫",
        ],
        correctIndex: 1,
        explanation:
          "Rodin 擅長生成適用於遊戲和動畫的高品質角色與物件 3D 模型。",
      },
      {
        id: "q10-5",
        question: "HunYuan World 與一般 3D 模型生成有何不同？",
        options: [
          "完全相同",
          "能生成完整的 3D 場景世界，而不只是單一物件",
          "只能做 2D 背景",
          "只能做文字效果",
        ],
        correctIndex: 1,
        explanation:
          "HunYuan World 專注於場景級別的 3D 生成，可以創建完整的 3D 世界和環境場景。",
      },
    ],
    tags: ["3D", "Trellis", "HunYuan3D", "建模"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-13T00:00:00Z",
    updatedAt: "2026-04-13T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 一致性保險庫進階測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-011",
    category: "technique",
    title: "一致性保險庫進階使用測驗",
    summary: "深入了解 Consistency Vault 的角色和場景一致性管理技巧",
    questions: [
      {
        id: "q11-1",
        question: "一致性保險庫（Consistency Vault）能儲存哪些類型的參考資料？",
        options: [
          "只能儲存文字",
          "角色參考圖片、場景描述、風格設定和視覺特徵",
          "只能儲存音訊",
          "只能儲存影片",
        ],
        correctIndex: 1,
        explanation:
          "一致性保險庫支援儲存角色參考圖片、場景描述、風格設定和各種視覺特徵，確保跨場景一致性。",
      },
      {
        id: "q11-2",
        question: "在創作工作室中，如何使用保險庫中的角色？",
        options: [
          "需要手動複製貼上所有描述",
          "直接從保險庫注入角色參考圖至提詞，AI 自動保持一致性",
          "只能在設定頁面使用",
          "需要每次重新上傳圖片",
        ],
        correctIndex: 1,
        explanation:
          "保險庫與創作工作室深度整合，可以一鍵注入角色/場景參考圖到提詞中。",
      },
      {
        id: "q11-3",
        question: "使用保險庫保持角色一致性時，以下哪個做法最有效？",
        options: [
          "只上傳一張模糊的圖片",
          "上傳多角度、多表情的高品質參考圖，並撰寫詳細的角色描述",
          "不需要任何參考圖片",
          "只寫一個詞的描述",
        ],
        correctIndex: 1,
        explanation:
          "多角度、多表情的參考圖配合詳細文字描述，能讓 AI 更準確地在不同場景中重現角色特徵。",
      },
      {
        id: "q11-4",
        question: "保險庫在導演模式中扮演什麼角色？",
        options: [
          "沒有任何作用",
          "為所有分鏡提供統一的角色和場景參考，確保敘事一致性",
          "只能在導演模式外使用",
          "只用來儲存導演的個人資料",
        ],
        correctIndex: 1,
        explanation:
          "在導演模式中，保險庫為所有分鏡段落提供統一的角色和場景參考，是保持視覺敘事一致性的核心工具。",
      },
      {
        id: "q11-5",
        question: "一致性保險庫支援哪種類型的場景管理？",
        options: [
          "只能管理室內場景",
          "支援管理各種場景的光線、色調、構圖風格等視覺一致性要素",
          "只能管理黑白場景",
          "不支援場景管理",
        ],
        correctIndex: 1,
        explanation:
          "保險庫的場景管理涵蓋光線、色調、構圖風格等多個視覺要素，確保同一場景的多個鏡頭風格一致。",
      },
    ],
    tags: ["一致性保險庫", "角色一致性", "Consistency Vault"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 提示詞四大模態進階測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-012",
    category: "technique",
    title: "提示詞四大模態進階測驗",
    summary: "考驗你對圖片、影片、音訊、語音四種模態提詞撰寫的精細掌握",
    questions: [
      {
        id: "q12-1",
        question: "撰寫影片生成提詞時，與圖片提詞最大的不同是什麼？",
        options: [
          "完全相同，沒有差異",
          "需要描述動態過程、鏡頭運動和時間推移",
          "影片提詞越短越好",
          "影片不需要提詞",
        ],
        correctIndex: 1,
        explanation:
          "影片提詞需要額外描述動態元素：鏡頭移動方向、物體運動軌跡、時間推移效果等，這些是圖片提詞不需要的。",
      },
      {
        id: "q12-2",
        question: "音樂生成提詞中，以下哪些元素最能影響結果品質？",
        options: [
          "只寫「好聽的音樂」",
          "風格、BPM、樂器組合、情緒氛圍、節奏型態",
          "只寫音樂長度",
          "只寫作者名字",
        ],
        correctIndex: 1,
        explanation:
          "好的音樂提詞需要明確指定風格（如 Lo-fi Hip Hop）、BPM、樂器組合、情緒氛圍和節奏型態。",
      },
      {
        id: "q12-3",
        question: "使用 TTS（文字轉語音）時，如何控制語音的情感表現？",
        options: [
          "無法控制",
          "透過標記語調（如興奮、平靜、悲傷）和語速設定來調整",
          "只能選擇男聲或女聲",
          "只能調整音量",
        ],
        correctIndex: 1,
        explanation:
          "TTS 系統支援透過情感標記和語速設定來控制語音表現，讓合成語音更自然有感情。",
      },
      {
        id: "q12-4",
        question: "以下哪個圖片提詞技巧可以提升生成品質？",
        options: [
          "用越多重複詞越好",
          "加入光線描述（如 golden hour、soft ambient light）和品質關鍵詞（如 8K、masterpiece）",
          "只用單字描述",
          "故意寫錯字",
        ],
        correctIndex: 1,
        explanation:
          "光線描述和品質關鍵詞能引導 AI 生成更有氛圍和更高品質的圖片結果。",
      },
      {
        id: "q12-5",
        question: "在音效（Sound Effect）生成提詞中，最重要的要素是什麼？",
        options: [
          "顏色描述",
          "聲音的來源、環境、質感和時間特性（如漸入漸出）",
          "圖片風格",
          "人物外貌",
        ],
        correctIndex: 1,
        explanation:
          "音效提詞需要精確描述聲音來源（如雨滴、風聲）、環境（室內/室外）、質感和時間變化特性。",
      },
      {
        id: "q12-6",
        question: "靈感積木系統如何幫助你撰寫更好的提詞？",
        options: [
          "靈感積木會自動生成完整提詞，不需要你做任何事",
          "透過點選預設積木快速組合提詞結構，支援自定義積木和積木組合",
          "靈感積木只是裝飾元素",
          "靈感積木只能用在音樂生成",
        ],
        correctIndex: 1,
        explanation:
          "靈感積木系統提供預設的風格、主題、場景等積木，點選即可組合成結構化提詞，還支援自定義積木。",
      },
    ],
    tags: ["提示詞", "多模態", "Prompt 技巧"],
    difficulty: "advanced",
    estimatedMinutes: 7,
    publishedAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 靈感積木與創作工作室測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-013",
    category: "getting-started",
    title: "靈感積木與創作工作室測驗",
    summary: "測試你對靈感積木系統和創作工作室核心功能的掌握",
    questions: [
      {
        id: "q13-1",
        question: "創作工作室（Studio）支援哪四種創作模態？",
        options: [
          "文字、表格、簡報、試算表",
          "圖片、影片、音訊、語音",
          "3D、VR、AR、MR",
          "網頁、App、遊戲、外掛",
        ],
        correctIndex: 1,
        explanation:
          "創作工作室支援圖片、影片、音訊和語音四種創作模態。",
      },
      {
        id: "q13-2",
        question: "靈感積木系統中的「積木組合」是什麼功能？",
        options: [
          "拼圖遊戲",
          "將多個常用積木組合為一套，一鍵載入整組提詞設定",
          "積木的顏色設定",
          "積木的刪除功能",
        ],
        correctIndex: 1,
        explanation:
          "積木組合可以把你常用的多個靈感積木打包成一套，下次創作時一鍵載入完整的提詞結構。",
      },
      {
        id: "q13-3",
        question: "ZenCoPilot 在創作工作室中的作用是什麼？",
        options: [
          "只是一個計時器",
          "AI 即時建議、提詞優化和靈感晶片推薦",
          "只能聊天",
          "只能搜尋網頁",
        ],
        correctIndex: 1,
        explanation:
          "ZenCoPilot 是創作工作室內建的 AI 助手，能即時提供提詞建議、優化建議和靈感晶片推薦。",
      },
      {
        id: "q13-4",
        question: "視覺靈魂（Visual Soul）在創作工作室中展示什麼？",
        options: [
          "天氣預報",
          "生成結果的 3D 動態展示效果",
          "系統使用說明",
          "使用者的個人資料",
        ],
        correctIndex: 1,
        explanation:
          "視覺靈魂以 3D 動態的方式展示 AI 生成的結果，為創作過程增添療癒感。",
      },
      {
        id: "q13-5",
        question: "創作工作室中的 AI 模型自動選擇機制是如何運作的？",
        options: [
          "隨機選擇模型",
          "根據你的提詞內容和創作模態，自動推薦最適合的 AI 模型",
          "永遠使用同一個模型",
          "需要使用者手動查詢所有模型的文件後自行選擇",
        ],
        correctIndex: 1,
        explanation:
          "創作工作室會分析你的提詞內容和選擇的模態，智能推薦最適合的 AI 模型來生成作品。",
      },
    ],
    tags: ["靈感積木", "創作工作室", "ZenCoPilot"],
    difficulty: "beginner",
    estimatedMinutes: 5,
    publishedAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 點數與費用管理測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-014",
    category: "tools-features",
    title: "點數系統與費用優化測驗",
    summary: "了解 Healing Studio 積分制度和費用節省策略",
    questions: [
      {
        id: "q14-1",
        question: "Healing Studio 的點數系統如何運作？",
        options: [
          "完全免費，不需要點數",
          "每次生成內容消耗對應點數，不同模型和模態消耗不同",
          "只有 VIP 才需要點數",
          "點數只能用來購買裝飾品",
        ],
        correctIndex: 1,
        explanation:
          "每次 AI 生成會消耗點數，消耗量因模型複雜度、解析度、時長等因素而異。",
      },
      {
        id: "q14-2",
        question: "以下哪個策略可以有效節省點數？",
        options: [
          "每次都用最高解析度",
          "先用低成本模型測試概念，確認方向後再用高品質模型精修",
          "同時開啟所有模型生成",
          "不使用任何功能",
        ],
        correctIndex: 1,
        explanation:
          "先用低成本快速模型驗證創意方向，確認滿意後再投入更多點數使用高品質模型，是最有效的省點策略。",
      },
      {
        id: "q14-3",
        question: "影片生成通常比圖片生成消耗更多點數的原因是什麼？",
        options: [
          "影片模型都比較貴",
          "影片需要生成多幀畫面，計算量遠大於單張圖片",
          "這是系統錯誤",
          "影片和圖片消耗相同",
        ],
        correctIndex: 1,
        explanation:
          "影片是由多幀畫面組成，AI 需要確保幀間的連貫性，計算量遠大於單張圖片生成。",
      },
      {
        id: "q14-4",
        question: "Healing Studio 的積分加分機制包含哪些？",
        options: [
          "沒有任何加分機制",
          "每日登入獎勵、創作活躍度獎勵、學習完成獎勵等",
          "只能購買積分",
          "積分只會減少不會增加",
        ],
        correctIndex: 1,
        explanation:
          "系統有多種積分加分機制，包括每日登入獎勵、活躍創作獎勵和完成學習測驗獎勵等。",
      },
      {
        id: "q14-5",
        question: "如何在儀表板查看點數使用趨勢？",
        options: [
          "無法查看",
          "在儀表板的數據分析頁面查看按天/週/月的使用量趨勢圖表",
          "只能查看總餘額",
          "需要聯繫客服",
        ],
        correctIndex: 1,
        explanation:
          "儀表板提供視覺化的點數使用趨勢圖表，可按不同時間維度查看消耗分佈。",
      },
    ],
    tags: ["點數", "積分", "費用", "優化"],
    difficulty: "beginner",
    estimatedMinutes: 5,
    publishedAt: "2026-04-15T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 專注流與創作規劃測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-015",
    category: "tools-features",
    title: "專注流與創作規劃測驗",
    summary: "測試你對番茄鐘、療癒呼吸和想法捕捉系統的理解",
    questions: [
      {
        id: "q15-1",
        question: "專注流（Focus Flow）整合了哪些功能？",
        options: [
          "只有計時器",
          "番茄鐘定時器、療癒呼吸引導和想法捕捉系統",
          "只有音樂播放",
          "只有筆記功能",
        ],
        correctIndex: 1,
        explanation:
          "專注流結合番茄鐘計時、療癒呼吸引導和快速想法捕捉，打造完整的專注創作環境。",
      },
      {
        id: "q15-2",
        question: "療癒呼吸引導的設計理念是什麼？",
        options: [
          "增加使用者的緊張感",
          "透過有節奏的呼吸引導幫助創作者放鬆，符合平台療癒放鬆的核心理念",
          "只是裝飾功能",
          "用來測量心跳",
        ],
        correctIndex: 1,
        explanation:
          "療癒呼吸引導體現了 Healing Studio「療癒放鬆創作」的核心理念，在專注創作間隙提供放鬆時刻。",
      },
      {
        id: "q15-3",
        question: "想法捕捉（Idea Capture）系統的用途是什麼？",
        options: [
          "自動截圖",
          "在創作過程中快速記錄靈感閃現的想法，避免中斷心流狀態",
          "只能記錄文字",
          "只能在離線時使用",
        ],
        correctIndex: 1,
        explanation:
          "想法捕捉讓你在專注創作時快速記錄腦中浮現的靈感，不打斷當前的心流狀態。",
      },
      {
        id: "q15-4",
        question: "創作行事曆（Calendar）可以做什麼？",
        options: [
          "只能顯示日期",
          "規劃創作排程、設定截止日期和追蹤創作進度",
          "只能設定鬧鐘",
          "只能看天氣預報",
        ],
        correctIndex: 1,
        explanation:
          "創作行事曆讓你規劃創作排程、設定專案截止日期，並追蹤整體創作進度。",
      },
      {
        id: "q15-5",
        question: "專案筆記（Notes）與一般筆記應用有什麼不同？",
        options: [
          "完全相同",
          "與 AI 創作工具深度整合，可以直接從筆記啟動創作、引用素材",
          "只能輸入純文字",
          "不支援搜尋",
        ],
        correctIndex: 1,
        explanation:
          "專案筆記與 Healing Studio 的創作工具深度整合，筆記中的想法可以直接轉化為創作行動。",
      },
    ],
    tags: ["專注流", "番茄鐘", "療癒呼吸", "創作規劃"],
    difficulty: "beginner",
    estimatedMinutes: 5,
    publishedAt: "2026-04-15T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 安全性與帳號管理測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-016",
    category: "safety-privacy",
    title: "安全性與帳號管理測驗",
    summary: "了解 Healing Studio 的安全機制和隱私保護措施",
    questions: [
      {
        id: "q16-1",
        question: "Healing Studio 使用什麼登入驗證方式？",
        options: [
          "帳號密碼",
          "Google OAuth 2.0 安全登入",
          "手機簡訊驗證",
          "指紋辨識",
        ],
        correctIndex: 1,
        explanation:
          "Healing Studio 使用 Google OAuth 2.0 進行安全身份驗證，不儲存使用者密碼。",
      },
      {
        id: "q16-2",
        question: "AI 生成內容的安全審核機制是如何運作的？",
        options: [
          "沒有任何審核",
          "使用 Safety Moderation 系統自動檢測並過濾不適當的輸入和輸出",
          "全部由人工審核",
          "只檢查檔案大小",
        ],
        correctIndex: 1,
        explanation:
          "系統內建 Safety Moderation 模組，會自動檢測提詞和生成結果中的不適當內容。",
      },
      {
        id: "q16-3",
        question: "使用者的創作資料儲存在哪裡？",
        options: [
          "使用者的本機電腦",
          "安全的雲端儲存空間（Cloudflare R2），並有定期備份",
          "公開的網路空間",
          "不會儲存任何資料",
        ],
        correctIndex: 1,
        explanation:
          "創作素材儲存在 Cloudflare R2 安全雲端空間，系統會進行定期快照備份以確保資料安全。",
      },
      {
        id: "q16-4",
        question: "登入逾期（Auth Expired）時系統會如何處理？",
        options: [
          "直接刪除使用者帳號",
          "顯示提示 Modal 引導重新登入，不會遺失未保存的創作",
          "強制關閉瀏覽器",
          "沒有任何提示",
        ],
        correctIndex: 1,
        explanation:
          "登入逾期時系統會顯示提示對話框引導使用者重新登入，並盡可能保護未保存的創作進度。",
      },
      {
        id: "q16-5",
        question: "Healing Studio 的隱私保護原則包括哪些？",
        options: [
          "會分享使用者資料給第三方",
          "不儲存敏感個人資訊、不分享創作資料給第三方、定期安全審計",
          "沒有隱私保護",
          "只有付費使用者才有隱私保護",
        ],
        correctIndex: 1,
        explanation:
          "Healing Studio 遵循嚴格的隱私保護原則：最小化資料收集、不分享第三方、定期安全審計。",
      },
    ],
    tags: ["安全", "隱私", "OAuth", "帳號管理"],
    difficulty: "beginner",
    estimatedMinutes: 5,
    publishedAt: "2026-04-16T00:00:00Z",
    updatedAt: "2026-04-16T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 跨模態創作工作流測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-017",
    category: "workflow",
    title: "跨模態創作工作流進階測驗",
    summary: "測試你對圖×影×音×聲串聯創作流程的深度理解",
    questions: [
      {
        id: "q17-1",
        question: "「圖片 → 影片 → 配音」的跨模態工作流中，第一步應該注意什麼？",
        options: [
          "隨便生成一張圖就好",
          "生成高品質的關鍵幀圖片，確保構圖和風格適合後續影片化",
          "先生成影片再截圖",
          "不需要注意任何事",
        ],
        correctIndex: 1,
        explanation:
          "第一步的圖片品質和構圖會直接影響後續影片生成的效果，需要特別注意構圖適合動態轉換。",
      },
      {
        id: "q17-2",
        question: "在跨模態工作流中，如何確保音樂和影片的節奏同步？",
        options: [
          "無法同步",
          "先確定影片的節奏和場景轉換點，再生成匹配 BPM 和情緒的配樂",
          "隨機搭配",
          "只能使用預設音樂",
        ],
        correctIndex: 1,
        explanation:
          "先分析影片的場景節奏和轉換點，再根據這些時間點生成 BPM 和情緒匹配的配樂，確保視聽同步。",
      },
      {
        id: "q17-3",
        question: "以下哪個是完整跨模態工作流的正確順序？",
        options: [
          "音樂 → 3D → 文字 → 圖片",
          "概念構思 → 圖片生成 → 影片化 → 音效/音樂 → 配音/字幕",
          "配音 → 圖片 → 刪除 → 重來",
          "影片 → 圖片 → 音樂 → 3D",
        ],
        correctIndex: 1,
        explanation:
          "標準流程是：先構思概念，生成關鍵圖片，將圖片影片化，添加音效配樂，最後配音和字幕。",
      },
      {
        id: "q17-4",
        question: "使用 Demucs 分離出的人聲，可以搭配什麼工具進行後續處理？",
        options: [
          "無法進行任何後續處理",
          "使用 ElevenLabs 進行聲音克隆，或用 WhisperX 生成精確字幕",
          "只能直接刪除",
          "只能轉換為 MIDI",
        ],
        correctIndex: 1,
        explanation:
          "Demucs 分離出的乾淨人聲可以作為 ElevenLabs 聲音克隆的素材，或用 WhisperX 生成字幕。",
      },
      {
        id: "q17-5",
        question: "在跨模態工作流中，「一致性保險庫」在哪個環節最關鍵？",
        options: [
          "只在最後一步有用",
          "在圖片和影片生成的每個環節都需要，確保角色外觀跨場景一致",
          "只在音效生成時用到",
          "不需要使用保險庫",
        ],
        correctIndex: 1,
        explanation:
          "一致性保險庫在圖片和影片生成的每個環節都至關重要，確保同一角色在所有場景中外觀一致。",
      },
      {
        id: "q17-6",
        question: "批次生成在跨模態工作流中有什麼優勢？",
        options: [
          "沒有任何優勢",
          "可以一次生成多個版本進行比較，快速找到最佳的視覺方向",
          "只會浪費點數",
          "只能用於文字生成",
        ],
        correctIndex: 1,
        explanation:
          "批次生成讓你在創作初期快速探索多個視覺方向，從多個版本中挑選最佳方案，提升工作流效率。",
      },
    ],
    tags: ["跨模態", "工作流", "串聯創作"],
    difficulty: "advanced",
    estimatedMinutes: 7,
    publishedAt: "2026-04-16T00:00:00Z",
    updatedAt: "2026-04-16T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 儀表板與數據分析測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-018",
    category: "tools-features",
    title: "儀表板與數據分析測驗",
    summary: "測試你對 Dashboard 數據分析和 LangSmith 追蹤功能的了解",
    questions: [
      {
        id: "q18-1",
        question: "儀表板（Dashboard）提供哪些核心數據？",
        options: [
          "只顯示日期",
          "生成次數統計、點數使用趨勢、模型使用分佈和創作活躍度",
          "只顯示帳號資訊",
          "只顯示天氣",
        ],
        correctIndex: 1,
        explanation:
          "儀表板提供全方位的創作數據：生成次數、點數消耗趨勢、各模型使用分佈和個人創作活躍度分析。",
      },
      {
        id: "q18-2",
        question: "LangSmith 監控中心可以追蹤什麼？",
        options: [
          "只追蹤頁面瀏覽量",
          "AI 模型的每次調用鏈路、延遲、成本和輸入輸出內容",
          "只追蹤使用者登入",
          "只追蹤網路速度",
        ],
        correctIndex: 1,
        explanation:
          "LangSmith 可以追蹤每次 AI 調用的完整鏈路，包括延遲、成本估算和輸入輸出內容。",
      },
      {
        id: "q18-3",
        question: "如何利用儀表板數據來改善創作效率？",
        options: [
          "數據沒有實際用途",
          "分析哪些模型最常用且效果最好，哪些時段創作最活躍，據此調整工作策略",
          "只能截圖分享",
          "只能匯出為 PDF",
        ],
        correctIndex: 1,
        explanation:
          "通過分析模型使用效率和個人創作節奏，可以有針對性地調整模型選擇和創作時間安排。",
      },
      {
        id: "q18-4",
        question: "儀表板的「模型使用分佈」可以幫助你了解什麼？",
        options: [
          "模型的程式碼結構",
          "你最常使用哪些模型，以及各模型的使用頻率比例",
          "模型的技術文件",
          "模型的開發團隊",
        ],
        correctIndex: 1,
        explanation:
          "模型使用分佈圖表讓你清楚看到自己的模型使用偏好，有助於發現可能被忽略的優質模型。",
      },
      {
        id: "q18-5",
        question: "對管理員來說，儀表板額外提供了什麼功能？",
        options: [
          "與普通使用者完全相同",
          "系統整體使用量統計、用戶活躍度排行和系統健康狀態監控",
          "只多了一個按鈕",
          "管理員不能使用儀表板",
        ],
        correctIndex: 1,
        explanation:
          "管理員版儀表板額外提供系統整體統計、用戶活躍排行和系統健康狀態等管理功能。",
      },
    ],
    tags: ["儀表板", "數據分析", "LangSmith", "Dashboard"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 光球助手深度測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-019",
    category: "getting-started",
    title: "光球助手深度操作測驗",
    summary: "考驗你對光球（Orb）AI Agent 的 7 種指令和互動模式的掌握",
    questions: [
      {
        id: "q19-1",
        question: "光球助手（Orb）支援哪些 ACTION 指令類型？",
        options: [
          "只有聊天功能",
          "navigate（導航）、preset（預設）、modality（模態切換）、focus（聚焦）、generate（生成）、refine（優化）、export（匯出）",
          "只有搜尋功能",
          "只有設定功能",
        ],
        correctIndex: 1,
        explanation:
          "光球支援 7 種 ACTION 指令：navigate、preset、modality、focus、generate、refine 和 export，涵蓋全站操作。",
      },
      {
        id: "q19-2",
        question: "光球的「主動模式」(Proactive Mode) 會在什麼時候觸發？",
        options: [
          "每秒鐘都觸發",
          "偵測到使用者閒置 90 秒或 180 秒時，主動提供靈感和提示",
          "永遠不會主動觸發",
          "只在使用者登出時觸發",
        ],
        correctIndex: 1,
        explanation:
          "主動模式設定了 90 秒和 180 秒的閒置閾值，在使用者可能卡關時溫柔地提供靈感和操作建議。",
      },
      {
        id: "q19-3",
        question: "光球的視覺狀態有哪些？",
        options: [
          "只有一種狀態",
          "idle（待機）、thinking（思考中）、generating（生成中）、listening（聆聽中）、acting（執行中）",
          "只有開和關兩種",
          "沒有視覺反饋",
        ],
        correctIndex: 1,
        explanation:
          "光球有 5 種視覺狀態：idle、thinking、generating、listening 和 acting，讓使用者清楚知道 AI 的當前狀態。",
      },
      {
        id: "q19-4",
        question: "光球在使用者遇到錯誤時會如何反應？",
        options: [
          "顯示錯誤代碼",
          "以療癒的語氣提供解決方案，鼓勵使用者不要焦慮",
          "關閉系統",
          "完全沒有反應",
        ],
        correctIndex: 1,
        explanation:
          "光球的錯誤處理遵循療癒設計原則：不讓使用者焦慮，用溫暖的語氣引導解決問題。",
      },
      {
        id: "q19-5",
        question: "光球助手使用的 AI 後端是什麼？",
        options: [
          "只使用規則系統",
          "MiniMax M2.7 via NVIDIA NIM 作為主要引擎，Gemini 作為後備",
          "只使用 GPT-3",
          "不使用任何 AI",
        ],
        correctIndex: 1,
        explanation:
          "光球使用 MiniMax M2.7（透過 NVIDIA NIM）作為主要 AI 引擎，並以 Gemini 作為後備確保服務穩定。",
      },
    ],
    tags: ["光球", "Orb", "AI Agent", "主動模式"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // 素材庫與歷史紀錄測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-020",
    category: "tools-features",
    title: "素材庫與歷史紀錄管理測驗",
    summary: "測試你對數位資產庫、歷史紀錄和素材管理的了解",
    questions: [
      {
        id: "q20-1",
        question: "數位資產庫（Asset Library）支援管理哪些類型的檔案？",
        options: [
          "只支援文字檔",
          "AI 生成的圖片、影片、音訊、3D 模型和使用者上傳的素材",
          "只支援圖片",
          "不支援使用者上傳",
        ],
        correctIndex: 1,
        explanation:
          "數位資產庫支援所有類型的創作素材：AI 生成的各種內容以及使用者自行上傳的檔案。",
      },
      {
        id: "q20-2",
        question: "歷史紀錄（History）頁面可以做什麼？",
        options: [
          "只能查看日期",
          "回顧所有生成歷史、重複使用之前的提詞設定、重新生成作品",
          "只能刪除記錄",
          "不能進行任何操作",
        ],
        correctIndex: 1,
        explanation:
          "歷史紀錄讓你回顧所有生成的作品，可以重複使用之前的提詞設定或對作品進行再次生成。",
      },
      {
        id: "q20-3",
        question: "在資產庫中，如何有效組織大量素材？",
        options: [
          "全部放在同一個資料夾",
          "使用標籤分類、建立資料夾結構、善用搜尋和篩選功能",
          "不需要組織",
          "只能按日期排序",
        ],
        correctIndex: 1,
        explanation:
          "善用標籤系統、資料夾結構和搜尋篩選功能，可以讓大量素材保持井然有序。",
      },
      {
        id: "q20-4",
        question: "素材庫與創作工作室之間的整合體現在哪裡？",
        options: [
          "完全獨立，沒有整合",
          "可以直接從素材庫選取素材注入到創作提詞中作為參考或編輯",
          "只能手動下載後重新上傳",
          "只能在設定中連結",
        ],
        correctIndex: 1,
        explanation:
          "素材庫與創作工具深度整合，可以直接從庫中選取素材作為圖片編輯的輸入或角色參考。",
      },
      {
        id: "q20-5",
        question: "雲端儲存空間（R2）的素材備份機制是什麼？",
        options: [
          "不會備份",
          "每日自動快照備份，確保素材不會意外遺失",
          "只在週末備份",
          "需要使用者手動備份",
        ],
        correctIndex: 1,
        explanation:
          "Cloudflare R2 儲存空間搭配每日自動快照機制，確保所有素材都有定期備份保護。",
      },
    ],
    tags: ["素材庫", "歷史紀錄", "資產管理", "R2"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // ControlNet 進階操控測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-021",
    category: "technique",
    title: "ControlNet 精細控制技術測驗",
    summary: "深入測試你對 OpenPose、Canny、Depth 等 ControlNet 模式的掌握",
    questions: [
      {
        id: "q21-1",
        question: "ControlNet 的核心概念是什麼？",
        options: [
          "讓 AI 完全隨機生成",
          "透過額外的控制條件（姿勢、邊緣、深度圖等）精確引導 AI 生成結果",
          "只是一種圖片濾鏡",
          "只用來調整亮度",
        ],
        correctIndex: 1,
        explanation:
          "ControlNet 讓你透過姿勢骨架、邊緣圖、深度圖等額外條件精確控制 AI 生成的構圖和形態。",
      },
      {
        id: "q21-2",
        question: "OpenPose 控制模式適合什麼場景？",
        options: [
          "只適合風景圖",
          "需要精確控制人物姿態和動作的圖片生成",
          "只適合建築圖",
          "只適合抽象藝術",
        ],
        correctIndex: 1,
        explanation:
          "OpenPose 通過人體骨架偵測來控制生成圖片中人物的精確姿態和動作。",
      },
      {
        id: "q21-3",
        question: "Canny 邊緣偵測控制適合什麼場景？",
        options: [
          "只適合模糊圖片",
          "需要保持原圖輪廓結構但改變風格或內容的場景",
          "只適合文字生成",
          "不適合任何場景",
        ],
        correctIndex: 1,
        explanation:
          "Canny 邊緣偵測提取圖片的輪廓線條，讓 AI 在保持結構的同時改變風格、顏色或內容。",
      },
      {
        id: "q21-4",
        question: "Depth 深度圖控制有什麼優勢？",
        options: [
          "只能生成平面圖",
          "可以控制圖片的前後景深關係，讓空間感更準確",
          "只能改變顏色",
          "會降低圖片品質",
        ],
        correctIndex: 1,
        explanation:
          "深度圖控制能精確引導圖片中的空間層次關係，讓近景和遠景的深度效果更加準確自然。",
      },
      {
        id: "q21-5",
        question: "SD 3.5 + ControlNet 組合在 Healing Studio 中如何使用？",
        options: [
          "需要安裝額外軟體",
          "直接在圖片工作室中選擇控制工具，上傳參考圖片即可",
          "只能在命令列使用",
          "不支援 ControlNet",
        ],
        correctIndex: 1,
        explanation:
          "Healing Studio 將 SD 3.5 + ControlNet 整合到圖片工作室的介面中，上傳參考圖片並選擇控制模式即可。",
      },
    ],
    tags: ["ControlNet", "OpenPose", "Canny", "Depth"],
    difficulty: "advanced",
    estimatedMinutes: 5,
    publishedAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },

  // ══════════════════════════════════════════════════════
  // AI Brain 設定精細測驗
  // ══════════════════════════════════════════════════════
  {
    id: "quiz-022",
    category: "tools-features",
    title: "AI Brain 配置系統精細測驗",
    summary: "測試你對 AI 大腦 5 大引擎維度和個人化設定的深度了解",
    questions: [
      {
        id: "q22-1",
        question: "AI Brain 系統有哪 5 大引擎維度？",
        options: [
          "只有 1 個引擎",
          "安全引擎、創意引擎、效率引擎、個性引擎、學習引擎",
          "只有速度和品質兩個維度",
          "沒有可調整的維度",
        ],
        correctIndex: 1,
        explanation:
          "AI Brain 提供 5 大引擎維度，讓使用者可以根據個人需求全方位調整 AI 的行為表現。",
      },
      {
        id: "q22-2",
        question: "LLM_ENGINE 設定中的 'auto' 模式如何運作？",
        options: [
          "隨機選擇一個引擎",
          "依照優先順序自動選擇可用的 AI 引擎，加上斷路器健康檢查",
          "永遠使用同一個引擎",
          "不使用任何引擎",
        ],
        correctIndex: 1,
        explanation:
          "auto 模式依照 gemini > minimax > vertex > forge 的優先順序，搭配斷路器健康檢查自動選擇最佳可用引擎。",
      },
      {
        id: "q22-3",
        question: "Healing Studio 支援哪些 LLM 引擎？",
        options: [
          "只支援一種",
          "Gemini API、Vertex AI、Manus Forge、MiniMax M2.7（via NVIDIA NIM）",
          "只支援 GPT",
          "不使用 LLM",
        ],
        correctIndex: 1,
        explanation:
          "系統支援四種 LLM 引擎：Gemini API（引擎 A）、Vertex AI（B）、Manus Forge（C）和 MiniMax M2.7（D）。",
      },
      {
        id: "q22-4",
        question: "個人化設定中的「個性」(Personality) 選擇會影響什麼？",
        options: [
          "只影響背景顏色",
          "光球助手的對話語氣、建議風格和視覺靈魂的呈現效果",
          "只影響字型大小",
          "完全沒有影響",
        ],
        correctIndex: 1,
        explanation:
          "個性設定會影響光球的對話風格、建議口吻，以及視覺靈魂的色彩和動態效果。",
      },
      {
        id: "q22-5",
        question: "「安靜模式」(Quiet Mode) 開啟後會有什麼效果？",
        options: [
          "關閉所有聲音",
          "減少光球的主動互動頻率，讓創作者不被打擾",
          "提高音量",
          "加快生成速度",
        ],
        correctIndex: 1,
        explanation:
          "安靜模式減少光球的主動彈出頻率，讓偏好專注不受打擾的創作者可以安靜地工作。",
      },
    ],
    tags: ["AI Brain", "LLM", "個人化", "設定"],
    difficulty: "intermediate",
    estimatedMinutes: 5,
    publishedAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    featured: false,
    authorName: "Healing Studio Team",
  },
];

let quizzes: LearnQuiz[] = [...SEED_QUIZZES];

// ─── Router ──────────────────────────────────────────────────────────────────

export const learnHubRouter = router({
  /** 列出所有文件（支援分類篩選、搜尋、精選篩選） */
  list: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        featured: z.boolean().optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
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
        result = result.filter(
          d =>
            d.title.toLowerCase().includes(q) ||
            d.summary.toLowerCase().includes(q) ||
            d.tags.some(t => t.toLowerCase().includes(q))
        );
      }

      // Sort: featured first, then by publishedAt desc
      result.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return (
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );
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
      if (!doc)
        throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
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
    .input(
      z.object({
        category: z.enum([
          "getting-started",
          "model-guide",
          "api-docs",
          "technique",
          "ai-news",
          "workflow",
        ]),
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(500),
        content: z.string().min(1),
        tags: z.array(z.string()).default([]),
        difficulty: z
          .enum(["beginner", "intermediate", "advanced"])
          .default("beginner"),
        readingMinutes: z.number().min(1).max(120).default(5),
        featured: z.boolean().default(false),
        externalUrl: z.string().url().optional(),
        authorName: z.string().max(100).optional(),
        attachments: z
          .array(
            z.object({
              type: z.enum(["image", "video", "pdf", "audio"]),
              url: z.string().url(),
              title: z.string().max(120).optional(),
            })
          )
          .default([]),
      })
    )
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
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        summary: z.string().min(1).max(500).optional(),
        content: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        featured: z.boolean().optional(),
        category: z
          .enum([
            "getting-started",
            "model-guide",
            "api-docs",
            "technique",
            "ai-news",
            "workflow",
          ])
          .optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        readingMinutes: z.number().min(1).max(120).optional(),
        attachments: z
          .array(
            z.object({
              type: z.enum(["image", "video", "pdf", "audio"]),
              url: z.string().url(),
              title: z.string().max(120).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = docs.findIndex(d => d.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
      const { id, ...updates } = input;
      docs[idx] = {
        ...docs[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      return docs[idx];
    }),

  /** 管理員：刪除文件 */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const idx = docs.findIndex(d => d.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
      docs.splice(idx, 1);
      return { success: true };
    }),

  /** 管理員：批量匯入文件（支援圖片/影片/PDF/音訊附件） */
  importDocs: adminProcedure
    .input(
      z.object({
        docs: z.array(
          z.object({
            category: z.enum([
              "getting-started",
              "model-guide",
              "api-docs",
              "technique",
              "ai-news",
              "workflow",
            ]),
            title: z.string().min(1).max(200),
            summary: z.string().min(1).max(500),
            content: z.string().min(1),
            tags: z.array(z.string()).default([]),
            difficulty: z
              .enum(["beginner", "intermediate", "advanced"])
              .default("beginner"),
            readingMinutes: z.number().min(1).max(120).default(5),
            featured: z.boolean().default(false),
            externalUrl: z.string().url().optional(),
            authorName: z.string().max(100).optional(),
            attachments: z
              .array(
                z.object({
                  type: z.enum(["image", "video", "pdf", "audio"]),
                  url: z.string().url(),
                  title: z.string().max(120).optional(),
                })
              )
              .default([]),
          })
        ),
      })
    )
    .mutation(({ input }) => {
      const now = new Date().toISOString();
      const imported: LearnDoc[] = input.docs.map((item, idx) => ({
        id: `import-${Date.now()}-${idx}`,
        ...item,
        publishedAt: now,
        updatedAt: now,
      }));
      docs = [...imported, ...docs];
      return { success: true, count: imported.length };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎬 影片學習區 (Video Learning)
  // ═══════════════════════════════════════════════════════════════════════════

  /** 列出所有影片 */
  videoList: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(({ input }) => {
      let result = [...videos];

      if (input.category) {
        result = result.filter(v => v.category === input.category);
      }
      if (input.difficulty) {
        result = result.filter(v => v.difficulty === input.difficulty);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          v =>
            v.title.toLowerCase().includes(q) ||
            v.summary.toLowerCase().includes(q) ||
            v.tags.some(t => t.toLowerCase().includes(q))
        );
      }

      result.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return (
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );
      });

      const total = result.length;
      const items = result.slice(input.offset, input.offset + input.limit);
      return { items, total };
    }),

  /** 取得單部影片 */
  videoGetById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const video = videos.find(v => v.id === input.id);
      if (!video)
        throw new TRPCError({ code: "NOT_FOUND", message: "影片不存在" });
      return video;
    }),

  /** 管理員：新增影片 */
  videoCreate: adminProcedure
    .input(
      z.object({
        category: z.enum([
          "getting-started",
          "model-guide",
          "technique",
          "ai-news",
          "workflow",
        ]),
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(500),
        videoUrl: z.string().url(),
        thumbnailUrl: z.string().url().optional(),
        tags: z.array(z.string()).default([]),
        difficulty: z
          .enum(["beginner", "intermediate", "advanced"])
          .default("beginner"),
        durationMinutes: z.number().min(1).max(600).default(10),
        featured: z.boolean().default(false),
        authorName: z.string().max(100).optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date().toISOString();
      const newVideo: LearnVideo = {
        id: `video-${Date.now()}`,
        ...input,
        publishedAt: now,
        updatedAt: now,
      };
      videos.unshift(newVideo);
      return newVideo;
    }),

  /** 管理員：更新影片 */
  videoUpdate: adminProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        summary: z.string().min(1).max(500).optional(),
        videoUrl: z.string().url().optional(),
        thumbnailUrl: z.string().url().optional(),
        tags: z.array(z.string()).optional(),
        featured: z.boolean().optional(),
        category: z
          .enum([
            "getting-started",
            "model-guide",
            "technique",
            "ai-news",
            "workflow",
          ])
          .optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        durationMinutes: z.number().min(1).max(600).optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = videos.findIndex(v => v.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "影片不存在" });
      const { id, ...updates } = input;
      videos[idx] = {
        ...videos[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      return videos[idx];
    }),

  /** 管理員：刪除影片 */
  videoDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const idx = videos.findIndex(v => v.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "影片不存在" });
      videos.splice(idx, 1);
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 📝 學習測驗區 (Learning Quiz)
  // ═══════════════════════════════════════════════════════════════════════════

  /** 列出所有測驗 */
  quizList: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(({ input }) => {
      let result = [...quizzes];

      if (input.category) {
        result = result.filter(q => q.category === input.category);
      }
      if (input.difficulty) {
        result = result.filter(q => q.difficulty === input.difficulty);
      }
      if (input.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          quiz =>
            quiz.title.toLowerCase().includes(q) ||
            quiz.summary.toLowerCase().includes(q) ||
            quiz.tags.some(t => t.toLowerCase().includes(q))
        );
      }

      result.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return (
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );
      });

      const total = result.length;
      const items = result.slice(input.offset, input.offset + input.limit);
      return { items, total };
    }),

  /** 取得單個測驗（含題目） */
  quizGetById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const quiz = quizzes.find(q => q.id === input.id);
      if (!quiz)
        throw new TRPCError({ code: "NOT_FOUND", message: "測驗不存在" });
      return quiz;
    }),

  /** 管理員：新增測驗 */
  quizCreate: adminProcedure
    .input(
      z.object({
        category: z.enum([
          "getting-started",
          "model-guide",
          "technique",
          "workflow",
          "pro-studio",
          "director-ai",
          "3d-modeling",
          "tools-features",
          "safety-privacy",
        ]),
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(500),
        questions: z.array(
          z.object({
            id: z.string(),
            question: z.string().min(1),
            options: z.array(z.string()).min(2).max(6),
            correctIndex: z.number().min(0),
            explanation: z.string().min(1),
          })
        ).min(1),
        tags: z.array(z.string()).default([]),
        difficulty: z
          .enum(["beginner", "intermediate", "advanced"])
          .default("beginner"),
        estimatedMinutes: z.number().min(1).max(60).default(5),
        featured: z.boolean().default(false),
        authorName: z.string().max(100).optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date().toISOString();
      const newQuiz: LearnQuiz = {
        id: `quiz-${Date.now()}`,
        ...input,
        publishedAt: now,
        updatedAt: now,
      };
      quizzes.unshift(newQuiz);
      return newQuiz;
    }),

  /** 管理員：更新測驗 */
  quizUpdate: adminProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        summary: z.string().min(1).max(500).optional(),
        questions: z
          .array(
            z.object({
              id: z.string(),
              question: z.string().min(1),
              options: z.array(z.string()).min(2).max(6),
              correctIndex: z.number().min(0),
              explanation: z.string().min(1),
            })
          )
          .min(1)
          .optional(),
        tags: z.array(z.string()).optional(),
        featured: z.boolean().optional(),
        category: z
          .enum([
            "getting-started",
            "model-guide",
            "technique",
            "workflow",
            "pro-studio",
            "director-ai",
            "3d-modeling",
            "tools-features",
            "safety-privacy",
          ])
          .optional(),
        difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        estimatedMinutes: z.number().min(1).max(60).optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = quizzes.findIndex(q => q.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "測驗不存在" });
      const { id, ...updates } = input;
      quizzes[idx] = {
        ...quizzes[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      return quizzes[idx];
    }),

  /** 管理員：刪除測驗 */
  quizDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const idx = quizzes.findIndex(q => q.id === input.id);
      if (idx === -1)
        throw new TRPCError({ code: "NOT_FOUND", message: "測驗不存在" });
      quizzes.splice(idx, 1);
      return { success: true };
    }),
});
