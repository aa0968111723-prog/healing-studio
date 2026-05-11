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

      // TODO: Insert into database

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
   * Record user's answer to clarification question
   */
  async recordAnswer(
    clarificationId: string,
    userAnswer: string
  ): Promise<ClarificationQuestion> {
    try {
      // TODO: Update database record
      // Also update user answer patterns for learning

      const updated: ClarificationQuestion = {
        id: clarificationId,
        intentLogId: "",
        userId: 0,
        conversationId: "",
        clarificationQuestion: "",
        questionType: "choice",
        userAnswer,
        answeredAt: new Date(),
        createdAt: new Date(),
      };

      // TODO: Update answer patterns
      await this.updateAnswerPattern(updated);

      logger.info("orb_clarification_answered", {
        clarificationId,
        questionType: updated.questionType,
      });

      return updated;
    } catch (error) {
      logger.error("orb_clarification_record_answer_failed", {
        clarificationId,
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
      // TODO: Implement pattern learning logic:
      // 1. Find or create pattern record
      // 2. Update frequency counts
      // 3. Recalculate confidence score
      // 4. Update default preference if confidence high enough

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
      // TODO: Query database

      const history: ClarificationQuestion[] = [];

      return history;
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
