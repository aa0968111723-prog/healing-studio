/**
 * modelConsents.ts — 模型訓練肖像權 / 照片使用同意書 Router
 *
 * 用途：當訓練資料集包含真實人類或第三方版權素材時，使用者必須在送出
 * `models.create` 之前先建立至少一筆有效的數位同意書，並把 consentId
 * 帶入訓練請求。本 router 提供 CRUD：
 *   - create        建立並數位簽署
 *   - list          列出本人所有同意書
 *   - get           取得單一同意書（含全文快照）
 *   - revoke        撤回（軟刪除，保留稽核紀錄）
 *
 * 條款全文快照欄位 `termsSnapshot` 會在送出時固定，避免日後條款修訂影響
 * 既有授權的舉證效力。
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

/** 條款版本：每次條款內容變更，請同步更新本常數 */
export const CURRENT_TERMS_VERSION = "v1.0-2026-05";

const SubjectTypeEnum = z.enum(["self", "real_person", "copyrighted"]);
const ConsentTypeEnum = z.enum(["portrait", "photo_usage", "both"]);
const SignerRelationEnum = z.enum([
  "self",
  "guardian",
  "copyright_holder",
  "authorized_representative",
]);
const UsageScopeEnum = z.enum([
  "training_only",
  "personal_output",
  "public_display",
  "commercial",
]);

const CoveredAssetSchema = z.object({
  url: z.string().url(),
  fileKey: z.string().optional(),
  kind: z.enum(["image", "video"]),
  sha256: z.string().optional(),
});

/**
 * 簽名 data URL 必須為 base64 PNG，最大 ~256KB（避免塞超大圖檔）
 */
const SignatureDataUrlSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+$/, {
    message: "簽名格式無效，需為 base64 PNG / JPEG data URL",
  })
  .max(350_000, "簽名圖檔過大（>256KB），請重新繪製");

export const modelConsentsRouter = router({
  /** 建立並簽署同意書 */
  create: protectedProcedure
    .input(
      z.object({
        subjectType: SubjectTypeEnum,
        consentType: ConsentTypeEnum.default("both"),

        subjectName: z.string().min(1).max(128),
        subjectEmail: z.string().email().max(320).optional(),
        subjectIdLast4: z.string().max(8).optional(),

        signerName: z.string().min(1).max(128),
        signerEmail: z.string().email().max(320),
        signerRelation: SignerRelationEnum,

        usageScope: UsageScopeEnum.default("training_only"),
        allowDerivative: z.boolean().default(false),

        validUntil: z.coerce.date().optional(),

        termsVersion: z.string().max(32).default(CURRENT_TERMS_VERSION),
        termsSnapshot: z.string().min(50).max(50_000),
        signatureDataUrl: SignatureDataUrlSchema,

        proofFileUrl: z.string().url().optional(),
        proofFileKey: z.string().optional(),
        coveredAssets: z.array(CoveredAssetSchema).max(60).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 法定代理人 / 著作權持有人簽署時，必須提供主體 Email 以便日後驗證
      if (
        input.signerRelation !== "self" &&
        !input.subjectEmail &&
        !input.subjectIdLast4
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "代理簽署時，需提供主體 Email 或身分證件後 4 碼以利稽核",
        });
      }

      // 簽署人若為「本人」，主體姓名必須與簽署人一致（避免冒簽）
      if (
        input.signerRelation === "self" &&
        input.subjectName.trim() !== input.signerName.trim()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "本人簽署時，主體姓名必須與簽署人姓名一致",
        });
      }

      // 取請求 IP / UA 作為稽核線索（best-effort）
      const xff = ctx.req.headers["x-forwarded-for"];
      const signedIp = Array.isArray(xff)
        ? xff[0]
        : typeof xff === "string"
          ? xff.split(",")[0]?.trim()
          : ctx.req.ip;
      const ua = ctx.req.headers["user-agent"];
      const signedUserAgent = Array.isArray(ua) ? ua[0] : ua;

      const id = await db.createModelTrainingConsent({
        userId: ctx.user.id,
        subjectType: input.subjectType,
        consentType: input.consentType,
        subjectName: input.subjectName.trim(),
        subjectEmail: input.subjectEmail?.toLowerCase(),
        subjectIdLast4: input.subjectIdLast4,
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail.toLowerCase(),
        signerRelation: input.signerRelation,
        usageScope: input.usageScope,
        allowDerivative: input.allowDerivative,
        validUntil: input.validUntil,
        termsVersion: input.termsVersion,
        termsSnapshot: input.termsSnapshot,
        signatureDataUrl: input.signatureDataUrl,
        signedIp: signedIp?.slice(0, 64),
        signedUserAgent: signedUserAgent?.slice(0, 500),
        proofFileUrl: input.proofFileUrl,
        proofFileKey: input.proofFileKey,
        coveredAssets: input.coveredAssets,
      });

      return { id };
    }),

  /** 列出本人所有同意書（簡要欄位，不含完整 termsSnapshot / signature） */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getModelTrainingConsentsByUser(ctx.user.id);
    return rows.map(r => ({
      id: r.id,
      subjectType: r.subjectType,
      consentType: r.consentType,
      subjectName: r.subjectName,
      signerName: r.signerName,
      signerRelation: r.signerRelation,
      usageScope: r.usageScope,
      allowDerivative: r.allowDerivative,
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      termsVersion: r.termsVersion,
      revokedAt: r.revokedAt,
      signedAt: r.signedAt,
      isActive: db.isConsentActive({
        revokedAt: r.revokedAt,
        validFrom: r.validFrom,
        validUntil: r.validUntil,
      }),
      coveredAssetCount: Array.isArray(r.coveredAssets)
        ? r.coveredAssets.length
        : 0,
    }));
  }),

  /** 取得單一同意書（含完整快照與簽名圖） */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const c = await db.getModelTrainingConsent(input.id);
      if (!c)
        throw new TRPCError({ code: "NOT_FOUND", message: "同意書不存在" });
      if (c.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
      }
      return c;
    }),

  /** 撤回同意書（軟刪除） */
  revoke: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const c = await db.getModelTrainingConsent(input.id);
      if (!c)
        throw new TRPCError({ code: "NOT_FOUND", message: "同意書不存在" });
      if (c.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
      }
      if (c.revokedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "此同意書已撤回",
        });
      }
      await db.revokeModelTrainingConsent(input.id, input.reason ?? null);
      return { ok: true };
    }),
});
