/**
 * server/services/orbClarificationEngine.ts
 *
 * Service for intent identification and clarification question handling.
 * Learns user patterns to reduce future clarifications needed.
 */

import { logger } from "../_core/logger";
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

export class OrbClarificationEngine {
  /**
   * Identify user intent from input
   */
  async identifyIntent(input: IdentifyIntentInput): Promise<IntentLog> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // TODO: Implement actual intent classification
      // Could use: keyword matching, LLM-based classification, learned patterns

      const detectedIntents: DetectedIntent[] = [];
      let primaryIntent: string | undefined;
      let intentConfidence: number | undefined;
      let ambiguityScore = 0;
      let needsClarification = false;

      // Simple heuristic: if confidence < 0.7 or multiple high-confidence intents
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

      // TODO: Implement smart question generation based on:
      // - Detected intents and their parameters
      // - User's historical answer patterns
      // - Context of conversation

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

      // Generate question
      const question: ClarificationQuestion = {
        id: `clarif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        intentLogId: intentLog.id,
        userId: intentLog.userId,
        conversationId: intentLog.conversationId,
        clarificationQuestion: "需要澄清您的意圖...", // TODO: Generate actual question
        questionType: "choice",
        options: intentLog.detectedIntents.map(intent => ({
          value: intent.intent,
          label: intent.intent,
          description: `信心度: ${(intent.confidence * 100).toFixed(0)}%`,
        })),
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
  async getStats(userId: number): Promise<{
    totalClarifications: number;
    answerRate: number;
    avgResponseTime: number;
    byQuestionType: Record<QuestionType, number>;
    learningProgress: number;
  }> {
    try {
      // TODO: Implement actual database aggregation

      const stats = {
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
        learningProgress: 0, // 0-100, how well system has learned user patterns
      };

      return stats;
    } catch (error) {
      logger.error("orb_clarification_get_stats_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Predict if clarification will be needed (proactive check)
   */
  async predictClarificationNeed(
    userId: number,
    userInput: string,
    context?: Record<string, unknown>
  ): Promise<{
    needsClarification: boolean;
    confidence: number;
    suggestedQuestions?: string[];
  }> {
    try {
      // TODO: Use ML model or heuristics to predict

      return {
        needsClarification: false,
        confidence: 0.8,
      };
    } catch (error) {
      logger.error("orb_predict_clarification_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        needsClarification: false,
        confidence: 0,
      };
    }
  }
}

// Singleton instance
export const orbClarificationEngine = new OrbClarificationEngine();
