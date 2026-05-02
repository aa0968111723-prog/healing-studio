/**
 * externalServices.ts — 外部服務訂閱管理 tRPC Router
 * ──────────────────────────────────────────────────────────────────────────
 * 管理 Healing Studio 所依賴的第三方 API 服務訂閱記錄
 * （fal.ai、ElevenLabs、Pinecone、LangSmith、Replicate 等）
 *
 * 功能：
 *   - list      : 列出所有外部服務訂閱（admin only）
 *   - upsert    : 新增或更新服務訂閱記錄（admin only）
 *   - delete    : 刪除服務記錄（admin only）
 *   - summary   : 查看總月費 + 各服務狀態摘要（admin only）
 *   - updateApiKeyStatus : 更新 API key 健康狀態（由健康監控 job 呼叫）
 */

import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { externalServiceSubscriptions } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const BILLING_CYCLES = ["monthly", "annual", "pay-as-you-go"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const API_KEY_STATUSES = ["valid", "invalid", "unknown"] as const;

const ServiceUpsertInput = z.object({
  id: z.number().int().positive().optional(), // 有 id 時為更新
  serviceName: z.string().min(1).max(64),
  planName: z.string().max(128).optional(),
  monthlyCostUsd: z.number().min(0).max(99999).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  nextRenewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  apiKeyEnvVar: z.string().max(64).optional(),
  apiKeyStatus: z.enum(API_KEY_STATUSES).default("unknown"),
  workspaceName: z.string().max(128).optional(),
  ownerEmail: z.string().email().max(320).optional(),
  riskLevel: z.enum(RISK_LEVELS).default("medium"),
  notes: z.string().max(2000).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const externalServicesRouter = router({

  // ── 列出所有服務（admin）──────────────────────────────────────────────────
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

    return db
      .select()
      .from(externalServiceSubscriptions)
      .orderBy(desc(externalServiceSubscriptions.updatedAt));
  }),

  // ── 摘要（admin）─────────────────────────────────────────────────────────
  summary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

    const rows = await db.select().from(externalServiceSubscriptions);

    // 計算總月費
    const totalMonthlyCostUsd = rows.reduce((sum, row) => {
      const cost = parseFloat(String(row.monthlyCostUsd ?? "0"));
      if (row.billingCycle === "annual") return sum + cost / 12;
      return sum + cost;
    }, 0);

    // 依 apiKeyStatus 分組
    const statusCount: Record<string, number> = {
      valid: 0,
      invalid: 0,
      unknown: 0,
    };
    for (const row of rows) {
      const status = row.apiKeyStatus ?? "unknown";
      statusCount[status] = (statusCount[status] ?? 0) + 1;
    }

    // 依 riskLevel 分組
    const riskCount: Record<string, number> = { low: 0, medium: 0, high: 0 };
    for (const row of rows) {
      const risk = row.riskLevel ?? "medium";
      riskCount[risk] = (riskCount[risk] ?? 0) + 1;
    }

    // 即將到期（30 天內）
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcomingRenewals = rows
      .filter(row => {
        if (!row.nextRenewalDate) return false;
        const renewal = new Date(row.nextRenewalDate);
        return renewal >= now && renewal <= thirtyDaysLater;
      })
      .map(row => ({
        serviceName: row.serviceName,
        nextRenewalDate: row.nextRenewalDate,
        monthlyCostUsd: row.monthlyCostUsd,
      }));

    return {
      totalServices: rows.length,
      totalMonthlyCostUsd: parseFloat(totalMonthlyCostUsd.toFixed(2)),
      statusCount,
      riskCount,
      upcomingRenewals,
    };
  }),

  // ── 新增或更新服務（admin）────────────────────────────────────────────────
  upsert: adminProcedure
    .input(ServiceUpsertInput)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      // Drizzle date() 欄位需要 Date 物件，將 YYYY-MM-DD string 轉換
      const renewalDate = input.nextRenewalDate ? new Date(input.nextRenewalDate) : undefined;

      const values = {
        serviceName: input.serviceName,
        planName: input.planName,
        monthlyCostUsd: input.monthlyCostUsd !== undefined ? input.monthlyCostUsd.toFixed(2) : undefined,
        billingCycle: input.billingCycle,
        nextRenewalDate: renewalDate,
        apiKeyEnvVar: input.apiKeyEnvVar,
        apiKeyStatus: input.apiKeyStatus,
        workspaceName: input.workspaceName,
        ownerEmail: input.ownerEmail,
        riskLevel: input.riskLevel,
        notes: input.notes,
      };

      if (input.id) {
        // 更新
        await db
          .update(externalServiceSubscriptions)
          .set(values)
          .where(eq(externalServiceSubscriptions.id, input.id));
        return { id: input.id, action: "updated" as const };
      } else {
        // 新增
        const result = await db
          .insert(externalServiceSubscriptions)
          .values(values);
        return { id: Number(result[0].insertId), action: "created" as const };
      }
    }),

  // ── 刪除服務（admin）─────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      await db
        .delete(externalServiceSubscriptions)
        .where(eq(externalServiceSubscriptions.id, input.id));

      return { success: true };
    }),

  // ── 更新 API key 健康狀態（健康監控 job 呼叫）────────────────────────────
  updateApiKeyStatus: adminProcedure
    .input(
      z.object({
        apiKeyEnvVar: z.string(),
        status: z.enum(API_KEY_STATUSES),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { updated: 0 };

      const result = await db
        .update(externalServiceSubscriptions)
        .set({ apiKeyStatus: input.status })
        .where(eq(externalServiceSubscriptions.apiKeyEnvVar, input.apiKeyEnvVar));

      return { updated: result[0].affectedRows ?? 0 };
    }),

  // ── 批次種子（管理員初始化服務清單）──────────────────────────────────────
  seedDefaults: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

    // 預設 Healing Studio 使用的所有外部服務
    const defaultServices = [
      {
        serviceName: "fal.ai",
        planName: "Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "FAL_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "medium" as const,
        notes: "主要影像/影片生成 API。WAN T2V、I2V、Flux、Trellis 等模型均走此服務。",
      },
      {
        serviceName: "ElevenLabs",
        planName: "Creator",
        billingCycle: "monthly" as const,
        apiKeyEnvVar: "ELEVENLABS_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "medium" as const,
        notes: "TTS 語音合成。需確保 API key 未開啟「限制鍵」toggle，否則 text_to_speech 無權限。",
      },
      {
        serviceName: "Google Gemini",
        planName: "API Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "GEMINI_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "主要 LLM（gemini-2.5-flash/pro）。也用於 text-embedding-004（RAG 向量化）。",
      },
      {
        serviceName: "Pinecone",
        planName: "Serverless Free",
        billingCycle: "monthly" as const,
        apiKeyEnvVar: "PINECONE_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "medium" as const,
        notes: "RAG 向量記憶系統。Index: ai-director-memories, dimension=1024 (llama-text-embed-v2)。",
      },
      {
        serviceName: "Replicate",
        planName: "Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "REPLICATE_API_TOKEN",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "備用模型執行平台。",
      },
      {
        serviceName: "LangSmith",
        planName: "Developer Free",
        billingCycle: "monthly" as const,
        apiKeyEnvVar: "LANGSMITH_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "LLM 呼叫追蹤/分析。Project: 網站。",
      },
      {
        serviceName: "Cloudflare R2",
        planName: "Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "S3_ACCESS_KEY_ID",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "媒體資產儲存。Bucket: bruce. $0.015/GB storage. 每日快照由 r2SnapshotJob 監控。",
      },
      {
        serviceName: "NVIDIA NIM",
        planName: "Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "NVIDIA_API",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "備用 LLM/推理 API。133 個模型可用。",
      },
      {
        serviceName: "Brave Search",
        planName: "Data for AI",
        billingCycle: "monthly" as const,
        apiKeyEnvVar: "BRAVE_SEARCH_API_KEY",
        apiKeyStatus: "valid" as const,
        riskLevel: "low" as const,
        notes: "Learn Hub 學習文章搜尋用。",
      },
      {
        serviceName: "Perplexity API",
        planName: "Pay-as-you-go",
        billingCycle: "pay-as-you-go" as const,
        apiKeyEnvVar: "PERPLEXITY_API_KEY",
        apiKeyStatus: "unknown" as const,
        riskLevel: "low" as const,
        notes:
          "（選用）已由 OpenRouter perplexity/sonar 模型取代，不需另外申請。如仍想用直連 API 可在 Railway 設定 PERPLEXITY_API_KEY；webSearch 會優先走 Brave，再 fallback 到 OpenRouter Sonar。",
      },
      {
        serviceName: "Railway",
        planName: "Hobby",
        billingCycle: "monthly" as const,
        apiKeyEnvVar: "",
        apiKeyStatus: "valid" as const,
        riskLevel: "high" as const,
        notes: "主機部署平台（後端 + MySQL DB）。所有環境變數在此設定。GitHub push 自動觸發重新部署。",
      },
    ];

    // 避免重複種子：只插入尚不存在的服務名稱
    const existing = await db.select({ serviceName: externalServiceSubscriptions.serviceName }).from(externalServiceSubscriptions);
    const existingNames = new Set(existing.map(r => r.serviceName));

    const toInsert = defaultServices.filter(s => !existingNames.has(s.serviceName));
    if (toInsert.length === 0) return { inserted: 0, skipped: defaultServices.length };

    await db.insert(externalServiceSubscriptions).values(toInsert);
    return { inserted: toInsert.length, skipped: defaultServices.length - toInsert.length };
  }),
});
