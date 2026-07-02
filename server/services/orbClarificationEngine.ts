/**
 * server/services/orbClarificationEngine.ts
 *
 * Service for intent identification and clarification question handling.
 * Learns user patterns to reduce future clarifications needed.
 */

import { logger } from "../_core/logger";
import { invokeLLM, extractMessageText, type Message } from "../_core/llm";
import { getDb } from "../db";
import {
  orbIntentLogs,
  orbClarificationHistory,
  orbUserAnswerPatterns,
  type OrbIntentLog,
  type InsertOrbIntentLog,
  type OrbClarificationHistory as DbClarificationHistory,
  type InsertOrbClarificationHistory,
  type OrbUserAnswerPattern,
  type InsertOrbUserAnswerPattern,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { genId } from "../../shared/genId";

export type QuestionType =
  | "choice"
  | "confirm"
  | "parameter"
  | "constraint"
  | "preference"
  | "context";

export interface DetectedIntent {
  intent: string;
  confidence: number;
  category: string;
  parameters?: Record<string, unknown>;
}

export interface IntentLog {
  id: string;
  userId: number;
  conversationId: string;
  userInput: string;
  detectedIntents: DetectedIntent[];
  primaryIntent?: string;
  intentConfidence?: number;
  ambiguityScore?: number;
  needsClarification: boolean;
  context?: Record<string, unknown>;
  spiritAssigned?: string;
  createdAt: Date;
}

export interface ClarificationQuestion {
  id: string;
  intentLogId: string;
  userId: number;
  conversationId: string;
  clarificationQuestion: string;
  questionType: QuestionType;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  userAnswer?: string;
  answeredAt?: Date;
  resolvedIntent?: string;
  resolutionConfidence?: number;
  spiritAsked?: string;
  createdAt: Date;
}

export interface AnswerPattern {
  id: string;
  userId: number;
  questionType: string;
  contextPattern?: string;
  commonAnswers: Array<{
    answer: string;
    frequency: number;
    lastUsed: Date;
  }>;
  defaultPreference?: string;
  confidenceScore: number;
  sampleCount: number;
  lastUpdatedAt: Date;
  createdAt: Date;
}

export interface IdentifyIntentInput {
  userId: number;
  conversationId: string;
  userInput: string;
  context?: Record<string, unknown>;
}

export interface CreateClarificationInput {
  intentLogId: string;
  userId: number;
  conversationId: string;
  clarificationQuestion: string;
  questionType: QuestionType;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  spiritAsked?: string;
}

export interface ClarificationStats {
  totalClarifications: number;
  /** 已作答比例 0–1（兩位小數）。 */
  answerRate: number;
  /** 平均作答秒數（createdAt→answeredAt），無樣本為 0。 */
  avgResponseTime: number;
  byQuestionType: Record<QuestionType, number>;
  /** 0–100：系統對該使用者偏好的學習程度（以回答模式平均信心度估算）。 */
  learningProgress: number;
}

/** 空統計（無 DB／無資料／失敗時回退），避免光球統計工具中斷對話。 */
function emptyClarificationStats(): ClarificationStats {
  return {
    totalClarifications: 0,
    answerRate: 0,
    avgResponseTime: 0,
    byQuestionType: {
      choice: 0,
      confirm: 0,
      parameter: 0,
      constraint: 0,
      preference: 0,
      context: 0,
    },
    learningProgress: 0,
  };
}

/**
 * AIDV-196：純函式聚合澄清統計（與 DB 解耦，便於決定性單元測試）。
 *
 * 取代原本恆回零的樁實作——`orbClarificationHistory` 與 `orbUserAnswerPatterns`
 * 已由 identifyIntent/generateClarification/recordAnswer 實際寫入，本函式據實聚合，
 * 讓光球回報的「已澄清次數／作答率／學習進度」不再造假。
 */
export function computeClarificationStats(
  clarifications: Array<{
    questionType: QuestionType;
    userAnswer: string | null;
    createdAt: Date;
    answeredAt: Date | null;
  }>,
  patterns: Array<{ confidenceScore: number; sampleCount: number }>,
): ClarificationStats {
  const stats = emptyClarificationStats();
  stats.totalClarifications = clarifications.length;

  let answeredCount = 0;
  let totalResponseMs = 0;
  let responseSamples = 0;

  for (const c of clarifications) {
    if (Object.prototype.hasOwnProperty.call(stats.byQuestionType, c.questionType)) {
      stats.byQuestionType[c.questionType]++;
    }
    const answeredAt = c.answeredAt;
    const isAnswered =
      c.userAnswer != null && c.userAnswer !== "" && answeredAt != null;
    if (!isAnswered || answeredAt == null) continue;
    answeredCount++;
    const createdMs =
      c.createdAt instanceof Date ? c.createdAt.getTime() : new Date(c.createdAt).getTime();
    const answeredMs =
      answeredAt instanceof Date ? answeredAt.getTime() : new Date(answeredAt).getTime();
    const deltaMs = answeredMs - createdMs;
    if (Number.isFinite(deltaMs) && deltaMs >= 0) {
      totalResponseMs += deltaMs;
      responseSamples++;
    }
  }

  if (stats.totalClarifications > 0) {
    stats.answerRate = Math.round((answeredCount / stats.totalClarifications) * 100) / 100;
  }
  if (responseSamples > 0) {
    stats.avgResponseTime = Math.round(totalResponseMs / responseSamples / 1000);
  }
  if (patterns.length > 0) {
    const avgConfidence =
      patterns.reduce(
        (sum, p) => sum + (Number.isFinite(p.confidenceScore) ? p.confidenceScore : 0),
        0,
      ) / patterns.length;
    stats.learningProgress = Math.max(0, Math.min(100, Math.round(avgConfidence * 100)));
  }

  return stats;
}

export class OrbClarificationEngine {
  /**
   * Identify user intent from input
   */
  async identifyIntent(input: IdentifyIntentInput): Promise<IntentLog> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");

      let detectedIntents: DetectedIntent[] = [];
      let primaryIntent: string | undefined;
      let intentConfidence: number | undefined;
      let ambiguityScore = 0;
      let needsClarification = false;

      // LLM-backed intent classification
      try {
        const messages: Message[] = [
          {
            role: "system",
            content: `You are an intent classifier for a creative video production AI platform called Healing Studio. Classify user input into structured intents and return ONLY a JSON object.

Common intents: create_video, edit_video, view_video, create_script, edit_script, adjust_audio, upload_media, export_content, configure_spirit, navigate, query_info, get_help, adjust_settings.

Return exactly:
{"intents":[{"intent":"string","confidence":0.0,"category":"string","parameters":{}}]}`
          },
          {
            role: "user",
            content: `User input: "${input.userInput}"${input.context ? `\nContext: ${JSON.stringify(input.context)}` : ""}\n\nClassify this user's intent.`
          }
        ];

        const llmResult = await invokeLLM({
          messages,
          runName: "orb-intent-classify",
          maxTokens: 400,
          response_format: { type: "json_object" },
          cacheable: true,
          cacheTtlSeconds: 60,
        });

        const raw = extractMessageText(llmResult.choices[0]?.message?.content);
        const parsed = JSON.parse(raw) as { intents?: DetectedIntent[] };
        if (Array.isArray(parsed.intents) && parsed.intents.length > 0) {
          detectedIntents = parsed.intents.map(i => ({
            intent: String(i.intent ?? "unknown"),
            confidence: Math.max(0, Math.min(1, Number(i.confidence ?? 0.5))),
            category: String(i.category ?? "general"),
            parameters: i.parameters ?? {},
          }));
        }
      } catch (llmErr) {
        logger.warn("orb_intent_classify_llm_failed", {
          userId: input.userId,
          error: llmErr instanceof Error ? llmErr.message : String(llmErr),
          note: "falling back to empty intents",
        });
      }

      // Compute ambiguity and whether clarification is needed
      if (detectedIntents.length > 1) {
        const topConfidences = detectedIntents
          .map(i => i.confidence)
          .sort((a, b) => b - a);

        if (topConfidences[0] && topConfidences[1]) {
          ambiguityScore = 1 - (topConfidences[0] - topConfidences[1]);
          needsClarification = ambiguityScore > 0.3;
        }
      } else if (detectedIntents[0]) {
        intentConfidence = detectedIntents[0].confidence;
        needsClarification = intentConfidence < 0.7;
      }

      // Insert into database
      const insertData: InsertOrbIntentLog = {
        userId: input.userId,
        conversationId: input.conversationId,
        userInput: input.userInput,
        detectedIntents: JSON.stringify(detectedIntents) as any,
        primaryIntent,
        intentConfidence: intentConfidence ? String(intentConfidence) : undefined,
        ambiguityScore: String(ambiguityScore),
        needsClarification,
        context: input.context ? (JSON.stringify(input.context) as any) : undefined,
      };

      const [inserted] = await db.insert(orbIntentLogs).values(insertData);
      const intentLogId = inserted.insertId;

      // Fetch the created log
      const [dbLog] = await db
        .select()
        .from(orbIntentLogs)
        .where(eq(orbIntentLogs.id, intentLogId));

      const intentLog: IntentLog = {
        id: String(dbLog.id),
        userId: dbLog.userId,
        conversationId: dbLog.conversationId,
        userInput: dbLog.userInput,
        detectedIntents: JSON.parse(dbLog.detectedIntents as any),
        primaryIntent: dbLog.primaryIntent ?? undefined,
        intentConfidence: dbLog.intentConfidence
          ? parseFloat(dbLog.intentConfidence)
          : undefined,
        ambiguityScore: dbLog.ambiguityScore
          ? parseFloat(dbLog.ambiguityScore)
          : undefined,
        needsClarification: dbLog.needsClarification,
        context: dbLog.context ? JSON.parse(dbLog.context as any) : undefined,
        spiritAssigned: dbLog.spiritAssigned ?? undefined,
        createdAt: dbLog.createdAt,
      };

      logger.info("orb_intent_identified", {
        intentLogId: intentLog.id,
        userId: input.userId,
        primaryIntent,
        confidence: intentConfidence,
        needsClarification,
      });

      return intentLog;
    } catch (error) {
      logger.error("orb_intent_identify_failed", {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate clarification question based on ambiguous intent
   */
  async generateClarification(
    intentLog: IntentLog
  ): Promise<ClarificationQuestion | null> {
    try {
      if (!intentLog.needsClarification) {
        return null;
      }

      // 問題生成策略（AIDV-561 收斂，取代原 TODO 佔位）：
      //   1. 先查歷史回答模式——高信心（>0.8）且有預設偏好 → 不問，直接沿用學習結果。
      //   2. 否則以 LLM 依「偵測到的意圖＋使用者原話＋對話 context」生成澄清問題。
      //   3. LLM 失敗 → 誠實降級為通用問題＋意圖清單選項（非假裝智慧生成）。

      // Check if we can predict answer from user patterns
      const pattern = await this.getUserAnswerPattern(
        intentLog.userId,
        "intent_disambiguation"
      );

      if (pattern && pattern.confidenceScore > 0.8 && pattern.defaultPreference) {
        // Don't ask - use learned preference
        logger.info("orb_clarification_skipped_learned", {
          userId: intentLog.userId,
          pattern: pattern.questionType,
        });
        return null;
      }

      // LLM-backed question generation
      let generatedQuestion = "您想要做什麼？請告訴我更多細節。";
      let generatedType: QuestionType = "choice";
      let generatedOptions: Array<{ value: string; label: string; description?: string }> = intentLog.detectedIntents.map(intent => ({
        value: intent.intent,
        label: intent.intent,
        description: `相關度: ${(intent.confidence * 100).toFixed(0)}%`,
      }));

      try {
        const intentSummary = intentLog.detectedIntents
          .map(i => `${i.intent} (${(i.confidence * 100).toFixed(0)}%)`)
          .join(", ");

        const messages: Message[] = [
          {
            role: "system",
            content: `You are a helpful AI assistant for a creative video platform. Generate a concise clarification question in Traditional Chinese to resolve ambiguous user intent. Return ONLY a JSON object.

Return exactly:
{"question":"string","questionType":"choice","options":[{"value":"string","label":"string","description":"string"}]}`
          },
          {
            role: "user",
            content: `User said: "${intentLog.userInput}"\nPossible intents: ${intentSummary}${intentLog.context ? `\nConversation context: ${JSON.stringify(intentLog.context)}` : ""}\n\nGenerate a clarification question with at most 4 options.`
          }
        ];

        const llmResult = await invokeLLM({
          messages,
          runName: "orb-clarification-gen",
          maxTokens: 350,
          response_format: { type: "json_object" },
        });

        const raw = extractMessageText(llmResult.choices[0]?.message?.content);
        const parsed = JSON.parse(raw) as {
          question?: string;
          questionType?: QuestionType;
          options?: Array<{ value: string; label: string; description?: string }>;
        };
        if (parsed.question) generatedQuestion = parsed.question;
        if (parsed.questionType) generatedType = parsed.questionType;
        if (Array.isArray(parsed.options) && parsed.options.length > 0) {
          generatedOptions = parsed.options;
        }
      } catch (llmErr) {
        logger.warn("orb_clarification_gen_llm_failed", {
          intentLogId: intentLog.id,
          error: llmErr instanceof Error ? llmErr.message : String(llmErr),
          note: "falling back to intent list options",
        });
      }

      const question: ClarificationQuestion = {
        id: genId("clarif", 8),
        intentLogId: intentLog.id,
        userId: intentLog.userId,
        conversationId: intentLog.conversationId,
        clarificationQuestion: generatedQuestion,
        questionType: generatedType,
        options: generatedOptions,
        createdAt: new Date(),
      };

      // Persist to DB so recordAnswer() can look it up by integer PK.
      const db = await getDb();
      if (db) {
        const insertData: InsertOrbClarificationHistory = {
          intentLogId: Number(intentLog.id),
          userId: intentLog.userId,
          conversationId: intentLog.conversationId,
          clarificationQuestion: question.clarificationQuestion,
          questionType: question.questionType,
          options: question.options ? (JSON.stringify(question.options) as any) : undefined,
          spiritAsked: intentLog.spiritAssigned,
        };
        const [dbResult] = await db.insert(orbClarificationHistory).values(insertData);
        question.id = String(dbResult.insertId);
      }

      logger.info("orb_clarification_generated", {
        clarificationId: question.id,
        intentLogId: intentLog.id,
        type: question.questionType,
        optionCount: question.options?.length ?? 0,
      });

      return question;
    } catch (error) {
      logger.error("orb_clarification_generate_failed", {
        intentLogId: intentLog.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get user's historical answer patterns
   */
  async getUserAnswerPattern(
    userId: number,
    questionType: string
  ): Promise<AnswerPattern | null> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const [pattern] = await db
        .select()
        .from(orbUserAnswerPatterns)
        .where(
          and(
            eq(orbUserAnswerPatterns.userId, userId),
            eq(orbUserAnswerPatterns.questionType, questionType)
          )
        )
        .orderBy(desc(orbUserAnswerPatterns.confidenceScore))
        .limit(1);

      if (!pattern) {
        return null;
      }

      return {
        id: String(pattern.id),
        userId: pattern.userId,
        questionType: pattern.questionType,
        contextPattern: pattern.contextPattern ?? undefined,
        commonAnswers: JSON.parse(pattern.commonAnswers as any),
        defaultPreference: pattern.defaultPreference ?? undefined,
        confidenceScore: parseFloat(pattern.confidenceScore),
        sampleCount: pattern.sampleCount,
        lastUpdatedAt: pattern.lastUpdatedAt,
        createdAt: pattern.createdAt,
      };
    } catch (error) {
      logger.error("orb_get_answer_pattern_failed", {
        userId,
        questionType,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Record user's answer to clarification question
   */
  async recordAnswer(
    clarificationId: string,
    userAnswer: string
  ): Promise<ClarificationQuestion> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const clarId = Number(clarificationId);

      // Update the clarification record
      await db
        .update(orbClarificationHistory)
        .set({
          userAnswer,
          answeredAt: new Date(),
        })
        .where(eq(orbClarificationHistory.id, clarId));

      // Fetch the updated record
      const [updated] = await db
        .select()
        .from(orbClarificationHistory)
        .where(eq(orbClarificationHistory.id, clarId));

      const clarification: ClarificationQuestion = {
        id: String(updated.id),
        intentLogId: String(updated.intentLogId),
        userId: updated.userId,
        conversationId: updated.conversationId,
        clarificationQuestion: updated.clarificationQuestion,
        questionType: updated.questionType,
        options: updated.options ? JSON.parse(updated.options as any) : undefined,
        userAnswer: updated.userAnswer ?? undefined,
        answeredAt: updated.answeredAt ?? undefined,
        resolvedIntent: updated.resolvedIntent ?? undefined,
        resolutionConfidence: updated.resolutionConfidence
          ? parseFloat(updated.resolutionConfidence)
          : undefined,
        spiritAsked: updated.spiritAsked ?? undefined,
        createdAt: updated.createdAt,
      };

      // Update answer patterns for learning
      await this.updateAnswerPattern(clarification);

      logger.info("orb_clarification_answered", {
        clarificationId,
        questionType: clarification.questionType,
      });

      return clarification;
    } catch (error) {
      logger.error("orb_clarification_record_answer_failed", {
        clarificationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update answer patterns based on new response
   */
  private async updateAnswerPattern(
    clarification: ClarificationQuestion
  ): Promise<void> {
    try {
      if (!clarification.userAnswer) return;
      const db = await getDb();
      if (!db) return;

      const existing = await db
        .select()
        .from(orbUserAnswerPatterns)
        .where(
          and(
            eq(orbUserAnswerPatterns.userId, clarification.userId),
            eq(orbUserAnswerPatterns.questionType, clarification.questionType)
          )
        )
        .orderBy(desc(orbUserAnswerPatterns.confidenceScore))
        .limit(1);

      const answer = clarification.userAnswer;
      const now = new Date().toISOString();

      if (existing[0]) {
        const currentAnswers: Array<{ answer: string; frequency: number; lastUsed: string }> =
          JSON.parse(existing[0].commonAnswers as any);
        const idx = currentAnswers.findIndex(a => a.answer === answer);
        if (idx >= 0) {
          currentAnswers[idx].frequency++;
          currentAnswers[idx].lastUsed = now;
        } else {
          currentAnswers.push({ answer, frequency: 1, lastUsed: now });
        }
        const newSampleCount = existing[0].sampleCount + 1;
        const newConfidence = Math.min(0.99, newSampleCount / 10).toFixed(2);
        const totalFreq = currentAnswers.reduce((s, a) => s + a.frequency, 0);
        const sorted = [...currentAnswers].sort((a, b) => b.frequency - a.frequency);
        const defaultPreference =
          sorted[0] && sorted[0].frequency / totalFreq > 0.5 ? sorted[0].answer : null;
        await db
          .update(orbUserAnswerPatterns)
          .set({
            commonAnswers: JSON.stringify(currentAnswers) as any,
            sampleCount: newSampleCount,
            confidenceScore: newConfidence as any,
            defaultPreference,
          })
          .where(eq(orbUserAnswerPatterns.id, existing[0].id));
      } else {
        await db.insert(orbUserAnswerPatterns).values({
          userId: clarification.userId,
          questionType: clarification.questionType,
          commonAnswers: JSON.stringify([{ answer, frequency: 1, lastUsed: now }]) as any,
          sampleCount: 1,
          confidenceScore: "0.10" as any,
          defaultPreference: null,
        });
      }

      logger.debug("orb_answer_pattern_updated", {
        userId: clarification.userId,
        questionType: clarification.questionType,
      });
    } catch (error) {
      logger.error("orb_update_answer_pattern_failed", {
        clarificationId: clarification.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - pattern updates shouldn't break functionality
    }
  }

  /**
   * Get clarification history for a conversation
   */
  async getHistory(
    conversationId: string,
    limit = 20
  ): Promise<ClarificationQuestion[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const rows = await db
        .select()
        .from(orbClarificationHistory)
        .where(eq(orbClarificationHistory.conversationId, conversationId))
        .orderBy(desc(orbClarificationHistory.createdAt))
        .limit(limit);
      return rows.map(row => ({
        id: String(row.id),
        intentLogId: String(row.intentLogId),
        userId: row.userId,
        conversationId: row.conversationId,
        clarificationQuestion: row.clarificationQuestion,
        questionType: row.questionType,
        options: row.options ? JSON.parse(row.options as any) : undefined,
        userAnswer: row.userAnswer ?? undefined,
        answeredAt: row.answeredAt ?? undefined,
        resolvedIntent: row.resolvedIntent ?? undefined,
        resolutionConfidence: row.resolutionConfidence
          ? parseFloat(row.resolutionConfidence)
          : undefined,
        spiritAsked: row.spiritAsked ?? undefined,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      logger.error("orb_get_clarification_history_failed", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get statistics about clarifications
   */
  async getStats(userId: number): Promise<ClarificationStats> {
    try {
      const db = await getDb();
      if (!db) return emptyClarificationStats();

      const clarifRows = await db
        .select({
          questionType: orbClarificationHistory.questionType,
          userAnswer: orbClarificationHistory.userAnswer,
          createdAt: orbClarificationHistory.createdAt,
          answeredAt: orbClarificationHistory.answeredAt,
        })
        .from(orbClarificationHistory)
        .where(eq(orbClarificationHistory.userId, userId));

      const patternRows = await db
        .select({
          confidenceScore: orbUserAnswerPatterns.confidenceScore,
          sampleCount: orbUserAnswerPatterns.sampleCount,
        })
        .from(orbUserAnswerPatterns)
        .where(eq(orbUserAnswerPatterns.userId, userId));

      return computeClarificationStats(
        clarifRows.map(r => ({
          questionType: r.questionType,
          userAnswer: r.userAnswer ?? null,
          createdAt: r.createdAt,
          answeredAt: r.answeredAt ?? null,
        })),
        patternRows.map(p => ({
          confidenceScore:
            typeof p.confidenceScore === "string"
              ? parseFloat(p.confidenceScore)
              : Number(p.confidenceScore ?? 0),
          sampleCount: p.sampleCount ?? 0,
        })),
      );
    } catch (error) {
      logger.error("orb_clarification_get_stats_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // 失敗時回零統計而非 throw，避免光球統計工具中斷整段對話。
      return emptyClarificationStats();
    }
  }

  // AIDV-561：原 predictClarificationNeed() 為零 callsite 的死 stub
  // （永遠回傳固定 {needsClarification:false, confidence:0.8}，且從未被呼叫），
  // 依卡上結論刪除；「是否需要澄清」的真實判斷已由 identifyIntent() 的
  // ambiguityScore / intentConfidence 門檻承擔。
}

// Singleton instance
export const orbClarificationEngine = new OrbClarificationEngine();
