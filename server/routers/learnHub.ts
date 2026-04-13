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
    summary: "所有必要和可選的環境變數完整說明，包含 Google OAuth、AI API Keys 和資料庫設定。",
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
    summary: "設定 Google OAuth 讓用戶可以用 Google 帳號登入 Healing Studio，以及 Demo 模式的使用方法。",
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
    summary: "影片工作室所有 21 個 fal.ai 模型的詳細說明，包含參數、適用場景和費率。",
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
    tags: ["影片生成", "Kling", "Wan", "Runway", "Veo 3", "Sora", "fal.ai", "模型目錄"],
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
    summary: "圖片創作室所有 23 種模型的詳細說明，包含文字生圖、圖片編輯、3D 建模等完整分類。",
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
    tags: ["圖片生成", "Flux", "GPT Image", "Seedream", "ControlNet", "3D 建模", "模型目錄"],
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
    summary: "專業創作室所有功能的完整說明，包含 TTS、音樂生成、聲音克隆、說話頭像等。",
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
    tags: ["TTS", "音樂生成", "聲音克隆", "說話頭像", "Demucs", "ElevenLabs", "音訊分離"],
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
    summary: "了解 AI Brain 的 5 個維度配置，以及如何根據需求選擇最適合的 LLM 引擎組合。",
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
| gemini/imagen-3 | Imagen 3 (Gemini) 🔵 | premium |
| vertex/imagen-3 | Imagen 3 (Vertex) 🔷 | premium |

### 影片引擎選項
| 引擎 | 標籤 | 等級 |
|------|------|------|
| fal/kling-v2.1-pro-t2v | Kling V2.1 Pro ✦ | premium |
| fal/wan-t2v-v2.1 | WAN T2V 2.1 | standard |
| fal/kling-v2.1-pro-i2v | Kling V2.1 i2v ✦ | premium |
| gemini/veo-3 | Veo 3 Preview 🔵 | premium |

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
    summary: "Healing Studio 所有 tRPC API 端點的完整文件，包含輸入參數、回傳值和使用範例。",
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
    summary: "Healing Studio 所有資料庫資料表的詳細欄位說明，以 MySQL + Drizzle ORM 實作。",
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
    summary: "了解 fal.ai API 的 Queue 架構、認證、代理下載白名單和錯誤處理，快速整合 AI 模型。",
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
    summary: "使用 ControlNet 精確控制圖片的姿勢、構圖和風格，讓 AI 按你的要求生成。",
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
    summary: "從上傳訓練資料到取得可用的 LoRA 模型，完整說明角色鍛造所的訓練流程。",
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
    summary: "從創意發想到最終影片輸出，使用 Healing Studio 完成一個完整影片創作項目的全流程指引。",
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
    summary: "如何使用保險庫 + LoRA + 多圖參考的組合，在系列圖片中保持完美的角色一致性。",
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
    summary: "Healing Studio 圖片創作室整合 5 種最新 3D 建模模型，從單張圖片生成電影級 3D 模型。",
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
    summary: "Healing Studio 獨特的 UI/UX 元件完整說明，包含光球夥伴、生成進度動畫、環境音效系統。",
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
    summary: "了解首頁精選（ShowcaseMasonry）的完整運作機制，以及如何將你的最佳作品展示給所有訪客。",
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
    summary: "從零到一部署 Healing Studio 到生產環境，包含資料庫、Google OAuth、FAL API 等完整設定步驟。",
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
    summary: "Healing Studio 所有 AI 生成模型的完整規格對照，包含點數費用、等級、特點與最佳使用場景。",
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
    summary: "從影片製作到品牌內容，詳解五種核心工作流程，教你如何串聯各工作室完成專案。",
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
    summary: "Healing Studio 所有頁面功能的完整索引，從創作工作室到管理後台一覽無遺。",
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
    summary: "從圖片到語音，手把手教你寫出高品質的 AI 提示詞，附上大量實際範例。",
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
    summary: "深入了解導演 AI 的雙引擎架構、三種人格模式、CO-STAR 腳本框架，以及如何用它規劃完整的多模態創作專案。",
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
    summary: "了解如何使用儀表板追蹤你的創作數據，包含配額管理、成本分析、每日趨勢和模態分佈圖表。",
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
    summary: "Healing Studio 獨有的身心靈功能，結合番茄鐘工作法、4-7-8 引導式呼吸和靈感碎片捕捉。",
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
    summary: "學會使用數位資產庫統一管理所有圖片、影片、音訊、語音和腳本檔案，支援團隊共享和批量管理。",
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
    summary: "了解如何使用共享空間進行團隊協作，包含資產共享、模型共享、貢獻統計和協作策略。",
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
    summary: "使用專案筆記記錄創作靈感和腳本，搭配創作排程日曆管理專案時程，支援 Google Calendar 整合。",
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
    summary: "管理員專屬的完整操作指南，包含用戶配額管理、系統統計、API 健康狀態監控和回饋報告處理。",
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
    summary: "深入了解 LoRA 訓練中心的四步驟精靈、六種訓練類型、雙引擎架構和進階超參數調整。",
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
    summary: "從聲音樣本克隆到生成說話頭像影片，完整教你使用 Qwen、Dia TTS、EchoMimic 和 Stable Avatar 等工具。",
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
    summary: "深入了解 Healing Studio 的 5 種 3D 建模工具，從物件重建到世界場景生成的完整教學。",
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
    summary: "深入學習如何串聯圖片、影片、音訊和語音四大模態，打造完整的多媒體作品。",
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
    summary: "了解如何使用 LangSmith 監控 AI 行為、追蹤 LLM 調用鏈、比較模型效能和匯出微調資料。",
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
    summary: "學會如何以最少的點數獲得最佳的創作效果，包含模型選擇策略、漸進式生成和預算管理。",
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
    summary: "彙整 Healing Studio 使用過程中最常遇到的問題和解決方案，涵蓋登入、生成、訓練和系統問題。",
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
    summary: "Healing Studio 的安全架構說明，包含認證機制、API 限流、內容安全策略和資料保護措施。",
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
    summary: "了解如何自訂導演 AI 偏好、調整 AI 大腦的 5 維度推理引擎和 4 種生成引擎配置。",
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
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
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
      if (idx === -1) throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
      const { id, ...updates } = input;
      docs[idx] = { ...docs[idx], ...updates, updatedAt: new Date().toISOString() };
      return docs[idx];
    }),

  /** 管理員：刪除文件 */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const idx = docs.findIndex(d => d.id === input.id);
      if (idx === -1) throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在" });
      docs.splice(idx, 1);
      return { success: true };
    }),
});
