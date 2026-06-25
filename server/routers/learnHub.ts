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
import { sanitizeRichText, sanitizePlainText } from "../utils/sanitize";
import { FAL_MODEL_CATALOG } from "../services/falModels";
import { LEGACY_FAL_ALIAS_MAP } from "../../shared/engineModelIds";
import {
  type DocCategory,
  type LearnDoc,
  type VideoCategory,
  type LearnVideo,
  type QuizCategory,
  type QuizQuestion,
  type LearnQuiz,
  SEED_DOCS,
  SEED_VIDEOS,
  SEED_QUIZZES,
} from "./learnHub.seed";

// ─── 靜態種子文件資料 ─────────────────────────────────────────────────────────




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

/**
 * 給 `siteKnowledge.buildLearnHubIndexKnowledge()` 用的精簡摘要清單。
 *
 * 為什麼不直接 export `docs`：
 *  - 光球只需要 id / title / summary / category / difficulty / readingMinutes / featured。
 *  - 完整 content 可能上百 KB，全塞進系統提示詞會炸 token。
 *  - 這層投影也讓未來改成 DB-backed 時不破壞 siteKnowledge 的契約。
 */
export function getAllLearnDocsForOrbIndex(): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  featured: boolean;
  readingMinutes: number;
}> {
  return docs.map(d => ({
    id: d.id,
    category: d.category,
    title: d.title,
    summary: d.summary,
    difficulty: d.difficulty,
    featured: d.featured,
    readingMinutes: d.readingMinutes,
  }));
}

// ─── Video Types & Seed Data ─────────────────────────────────────────────────




let videos: LearnVideo[] = [...SEED_VIDEOS];

// ─── Quiz Types & Seed Data ──────────────────────────────────────────────────





let quizzes: LearnQuiz[] = [...SEED_QUIZZES];

/**
 * Internal accessors for video / quiz seed data — 給 spirit tools / siteKnowledge
 * 翻全站學習素材時用。會回傳精簡投影，避免大欄位（content / questions）拖累呼叫端。
 *
 * Double-underscore prefix = "internal, not for tRPC". 不要在 router 暴露。
 */
export function __getAllVideos(): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  durationMinutes: number;
  featured: boolean;
  tags: string[];
  videoUrl: string;
}> {
  return videos.map(v => ({
    id: v.id,
    category: v.category,
    title: v.title,
    summary: v.summary,
    difficulty: v.difficulty,
    durationMinutes: v.durationMinutes,
    featured: v.featured,
    tags: v.tags,
    videoUrl: v.videoUrl,
  }));
}

export function __getAllQuizzes(): Array<{
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  estimatedMinutes: number;
  featured: boolean;
  tags: string[];
  questionCount: number;
}> {
  return quizzes.map(q => ({
    id: q.id,
    category: q.category,
    title: q.title,
    summary: q.summary,
    difficulty: q.difficulty,
    estimatedMinutes: q.estimatedMinutes,
    featured: q.featured,
    tags: q.tags,
    questionCount: q.questions.length,
  }));
}

function upsertSeedDoc(nextDoc: LearnDoc): void {
  const idx = docs.findIndex(d => d.id === nextDoc.id);
  if (idx === -1) {
    docs.unshift(nextDoc);
    return;
  }
  docs[idx] = nextDoc;
}

function buildModelCoverageDoc(): LearnDoc {
  const categories = Object.entries(FAL_MODEL_CATALOG);
  const categoryLines = categories
    .map(([category, models]) => {
      const uniqueModels = new Set(models.map(m => m.modelId));
      const tierCount = models.reduce(
        (acc, m) => {
          acc[m.tier] += 1;
          return acc;
        },
        { ultra: 0, premium: 0, standard: 0, fast: 0 } as Record<
          "ultra" | "premium" | "standard" | "fast",
          number
        >
      );

      return `- **${category}**：${uniqueModels.size} 個 unique modelId（設定 ${models.length} 筆，ultra ${tierCount.ultra} / premium ${tierCount.premium} / standard ${tierCount.standard} / fast ${tierCount.fast}）`;
    })
    .join("\n");

  const allModelIds = new Set(
    categories.flatMap(([, models]) => models.map(m => m.modelId))
  );
  const legacyAliasCount = Object.keys(LEGACY_FAL_ALIAS_MAP).length;
  const sampleModelIds = Array.from(allModelIds).slice(0, 40).join("\n");

  const content = `# 生成模型全量資料盤點（自動彙整）

> 更新時間：${new Date().toISOString()}
> 
> 本文件由 \`FAL_MODEL_CATALOG\` 與 \`LEGACY_FAL_ALIAS_MAP\` 自動整理，確保學習文件中心可直接看到目前程式碼中的生成模型覆蓋狀況。

## 一、模型覆蓋統計（按 16 類能力）

${categoryLines}

---

## 二、全站模型 ID 覆蓋

- **unique modelId 總數**：${allModelIds.size}
- **legacy alias 對映數**：${legacyAliasCount}

### 目前 catalog 內的 modelId（前 40 筆）

\`\`\`
${sampleModelIds}
\`\`\`

---

## 三、學習建議

1. 新增模型時，請同步更新：
   - \`server/services/falModels.ts\`
   - \`shared/engineModelIds.ts\`（若有舊別名）
   - Learn Hub 模型說明與測驗題庫
2. 若某類別模型數 < 3，建議優先補齊，以降低單點供應商風險。
3. 任何模型下線時，需同步更新學習文件與測驗答案解析，避免教材過期。`;

  return {
    id: "mg-999",
    category: "model-guide",
    title: "生成模型全量資料盤點（自動彙整）",
    summary:
      "以程式內 FAL_MODEL_CATALOG 與 legacy alias map 自動生成的模型覆蓋報告，集中展示所有生成模型資料。",
    content,
    tags: ["生成模型", "catalog", "自動彙整", "Learn Hub"],
    difficulty: "advanced",
    readingMinutes: 10,
    publishedAt: "2026-04-22T00:00:00Z",
    updatedAt: new Date().toISOString(),
    featured: true,
    authorName: "Healing Studio System",
  };
}

function buildQuizCoverageDoc(): LearnDoc {
  const categoryCounts = quizzes.reduce<Record<string, number>>((acc, quiz) => {
    acc[quiz.category] = (acc[quiz.category] ?? 0) + 1;
    return acc;
  }, {});

  const difficultyCounts = quizzes.reduce<
    Record<"beginner" | "intermediate" | "advanced", number>
  >(
    (acc, quiz) => {
      acc[quiz.difficulty] += 1;
      return acc;
    },
    { beginner: 0, intermediate: 0, advanced: 0 }
  );

  const totalQuestions = quizzes.reduce(
    (sum, quiz) => sum + quiz.questions.length,
    0
  );

  const categoryLines = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `- ${category}: ${count} 份測驗`)
    .join("\n");

  const topQuizzes = [...quizzes]
    .sort((a, b) => b.questions.length - a.questions.length)
    .slice(0, 10)
    .map(
      q =>
        `- ${q.title}（${q.category} / ${q.difficulty} / ${q.questions.length} 題）`
    )
    .join("\n");

  const content = `# 學習測驗資料盤點（自動彙整）

> 更新時間：${new Date().toISOString()}
> 
> 本文件會根據目前 \`SEED_QUIZZES\` 自動整理題庫結構，確保「測試內資料」可直接在學習文件中心檢閱。

## 一、題庫總量

- 測驗份數：**${quizzes.length}**
- 題目總數：**${totalQuestions}**
- 難度分佈：beginner ${difficultyCounts.beginner} / intermediate ${difficultyCounts.intermediate} / advanced ${difficultyCounts.advanced}

## 二、分類分佈

${categoryLines}

## 三、題量較高的測驗（前 10 份）

${topQuizzes}

## 四、維運規範

1. 每新增模型教學，至少新增 1 份對應測驗（3-5 題）。
2. 每次模型或流程改版，需同步更新題目 explanation。
3. 難度標籤若失衡（任一級別 < 20%）請補題。`;

  return {
    id: "wf-999",
    category: "workflow",
    title: "學習測驗資料盤點（自動彙整）",
    summary:
      "從現有測驗資料自動統計份數、題量、難度與分類分佈，將測試資料集中到學習文件中心。",
    content,
    tags: ["學習測驗", "題庫盤點", "自動彙整", "Learning QA"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-22T00:00:00Z",
    updatedAt: new Date().toISOString(),
    featured: true,
    authorName: "Healing Studio System",
  };
}

const AUTOMATION_MAINTENANCE_TOOLS = [
  {
    area: "健康監控",
    tool: "apiHealthMonitor",
    file: "server/jobs/apiHealthMonitor.ts",
    purpose: "定期檢查外部服務可用性與延遲，提前預警故障。",
  },
  {
    area: "熔斷保護",
    tool: "circuitBreaker",
    file: "server/jobs/circuitBreaker.ts",
    purpose: "連續失敗時暫停高風險呼叫，避免擴散式錯誤。",
  },
  {
    area: "成本治理",
    tool: "apiUsageAlertJob",
    file: "server/jobs/apiUsageAlertJob.ts",
    purpose: "監控 API 成本和配額異常，發送告警。",
  },
  {
    area: "資料備援",
    tool: "r2SnapshotJob",
    file: "server/jobs/r2SnapshotJob.ts",
    purpose: "定時快照雲端素材與關鍵資料，降低資料遺失風險。",
  },
  {
    area: "知識同步",
    tool: "learnDocSyncer",
    file: "server/jobs/learnDocSyncer.ts",
    purpose: "自動彙整新聞與教學內容，更新學習文件中心。",
  },
  {
    area: "資訊更新",
    tool: "newsFetcher",
    file: "server/jobs/newsFetcher.ts",
    purpose: "抓取並整理最新 AI 新聞，保持內容時效。",
  },
  {
    area: "模型訓練",
    tool: "modelTrainingWorker",
    file: "server/jobs/modelTrainingWorker.ts",
    purpose: "處理 LoRA 等訓練任務隊列與狀態更新。",
  },
  {
    area: "外部抓取",
    tool: "braveLearnFetcher",
    file: "server/jobs/braveLearnFetcher.ts",
    purpose: "擴充外部知識來源，補強學習文件內容。",
  },
] as const;

function buildAutomationMaintenanceDoc(): LearnDoc {
  const rows = AUTOMATION_MAINTENANCE_TOOLS.map(
    t => `| ${t.area} | ${t.tool} | ${t.file} | ${t.purpose} |`
  ).join("\n");

  const content = `# 全站自動化維護工具總覽（Automation Ops）

> 更新時間：${new Date().toISOString()}
>
> 目標：建立全站維運自動化工具的單一索引，讓團隊能快速查到「哪個工具在維護哪個環節」。

## 一、工具矩陣

| 維護面向 | 工具 | 對應檔案 | 主要用途 |
|---|---|---|---|
${rows}

## 二、建議維運節奏

1. 每日檢查：健康監控、熔斷狀態、成本告警。
2. 每週檢查：知識同步結果、新聞來源品質、題庫更新。
3. 每月檢查：快照完整性、訓練任務成功率、告警閾值調校。

## 三、新增工具時的標準流程

1. 在 \`server/jobs/\` 新增工具模組與最小可觀測日誌。
2. 補上對應測試（至少一個健康路徑 + 一個失敗路徑）。
3. 把工具加入本文件矩陣，確保學習中心可追蹤。
4. 若工具會影響成本，需同步新增成本告警規則。`;

  return {
    id: "api-999",
    category: "api-docs",
    title: "全站自動化維護工具總覽（Automation Ops）",
    summary:
      "集中整理全站健康監控、熔斷、成本治理、備援、知識同步與訓練等自動化維護工具。",
    content,
    tags: ["automation", "維運", "ops", "job-scheduler"],
    difficulty: "intermediate",
    readingMinutes: 8,
    publishedAt: "2026-04-22T00:00:00Z",
    updatedAt: new Date().toISOString(),
    featured: true,
    authorName: "Healing Studio System",
  };
}

function syncAutoGeneratedLearnDocs(): void {
  upsertSeedDoc(buildModelCoverageDoc());
  upsertSeedDoc(buildQuizCoverageDoc());
  upsertSeedDoc(buildAutomationMaintenanceDoc());
}

syncAutoGeneratedLearnDocs();

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
        title: sanitizePlainText(input.title),
        summary: sanitizePlainText(input.summary),
        content: sanitizeRichText(input.content),
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
        ...(updates.title !== undefined && { title: sanitizePlainText(updates.title) }),
        ...(updates.summary !== undefined && { summary: sanitizePlainText(updates.summary) }),
        ...(updates.content !== undefined && { content: sanitizeRichText(updates.content) }),
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
