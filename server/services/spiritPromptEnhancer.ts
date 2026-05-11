/**
 * server/services/spiritPromptEnhancer.ts
 *
 * Enhances spirit system prompts with memory, context, and learned behaviors.
 * Wraps around getRoleSystemPromptSlice to inject personalization.
 */

import type { AgentRole } from "../../shared/orb-agent-roles";
import { getRoleSystemPromptSlice } from "../../shared/orb-agent-roles";
import { SpiritMemoryManager } from "./spiritMemoryManager";
import { logger } from "../_core/logger";

export interface PromptEnhancementContext {
  userId?: number;
  sessionId?: string;
  currentPage?: string;
  recentActions?: string[];
}

/**
 * Get enhanced system prompt for a spirit including learned memories.
 * Falls back to basic prompt if memory retrieval fails.
 */
export async function getEnhancedSpiritPrompt(
  role: AgentRole,
  context?: PromptEnhancementContext
): Promise<string> {
  // Get base system prompt
  const basePrompt = getRoleSystemPromptSlice(role);

  // If no userId, return base prompt without memory enhancement
  if (!context?.userId) {
    return basePrompt;
  }

  try {
    // Retrieve memory section for this spirit
    const memorySection = await SpiritMemoryManager.formatMemoriesForPrompt(
      context.userId,
      role
    );

    // Inject memory section if available
    if (memorySection) {
      return `${basePrompt}\n\n${memorySection}`;
    }

    return basePrompt;
  } catch (error) {
    logger.error("spirit_prompt_enhancement_failed", {
      role,
      userId: context.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return base prompt on error - don't break spirit activation
    return basePrompt;
  }
}

/**
 * Enhanced chief-orchestrator system prompt with intent clarification guidance.
 * This is called separately because chief-orchestrator has special clarification logic.
 */
export function getChiefOrchestratorEnhancedPrompt(memorySection?: string): string {
  const basePrompt = [
    "【本回合扮演：總總（總管理精靈 chief orchestrator）】",
    "你是 25 位精靈的總管總總：從一開始就負責理解使用者意圖、分派任務給合適的精靈、追蹤全局進度。語氣像可靠的專案經理。",
    "",
    "【核心職責：意圖理解與澄清】",
    "在委派任務前，你必須確保意圖夠明確。如果使用者的需求模糊（缺少關鍵資訊），不要猜測，要用具體問題反問：",
    "- ❌ 不好的反問：「你想做什麼？」「請再說明一下」（太空泛）",
    "- ✅ 好的反問：「想做 15 秒短影音，還是一張海報？」「用在 IG 限動（9:16）還是 YouTube（16:9）？」",
    "",
    "【意圖澄清五維度】",
    "1. **交付物類型（goal）**：影片、圖片、音樂、完整 campaign？",
    "2. **專案範圍（scope）**：單一資產 vs 多步驟工作流？",
    "3. **時間安排（timeline）**：急件（1 小時）vs 有規劃（本週）？",
    "4. **預算考量（budget）**：成本優先 vs 品質優先？",
    "5. **協作複雜度（complexity）**：單一精靈處理 vs 需要團隊編排？",
    "",
    "如果缺少 2 個以上關鍵維度，使用意圖卡反問，給 2-4 個具體選項讓使用者快速挑選。",
    "",
    "【團隊狀態與分派】",
    "三個固定關心：① 目前有哪幾位精靈在跑任務？② 使用者目標是否已被完整的 handoff 鏈承接？③ 有沒有任務超時、卡住？",
    "回答模板：① 團隊狀態清單（進行中 / 排隊 / 完成）② 建議的 handoff 順序 ③ 風險或等待點。壓縮成 4-6 行，不寫長段落。",
    "",
    "【可呼叫工具】",
    "- agent-collaboration 狀態查詢",
    "- composeRoleChain 提供下一步建議",
    "- 意圖澄清卡（當意圖不清時自動觸發）",
    "",
    "【交棒規則】",
    "每次回覆明確指出「下一棒交給 OOO」並用 `@暱稱` 點名。",
    "- 規劃層級問題 → 交給導導",
    "- 品質審查 → 交給品品",
    "- 執行細節 → 交給編編",
    "- 意圖澄清完成 → 交給對應的專精精靈",
    "",
    "【禁區】",
    "- 不要重複導導的工作（任務拆解屬於導導）",
    "- 不要搶編編的執行細節",
    "- 總總的價值在「理解意圖 + 分派團隊」而不是親自代做",
    "- **絕對不要猜測意圖**：寧可多問一輪，也不要委派錯誤的精靈",
  ].join("\n");

  if (memorySection) {
    return `${basePrompt}\n\n${memorySection}`;
  }

  return basePrompt;
}

/**
 * Record spirit interaction for learning purposes.
 * Should be called after spirit performs an action.
 */
export async function recordSpiritInteraction(input: {
  userId: number;
  agentId: AgentRole;
  action: string;
  toolUsed?: string;
  outcome: "success" | "partial" | "failure";
  userFeedback?: string;
}): Promise<void> {
  try {
    // Record feedback
    await SpiritMemoryManager.recordFeedback({
      userId: input.userId,
      agentId: input.agentId,
      action: input.action,
      outcome: input.outcome,
      userFeedback: input.userFeedback,
    });

    // If tool was used successfully, record tool preference
    if (input.toolUsed && input.outcome === "success") {
      await SpiritMemoryManager.recordMemory({
        userId: input.userId,
        agentId: input.agentId,
        memoryType: "preference",
        memoryKey: `preferred_tool_${input.action}`,
        memoryValue: input.toolUsed,
        initialConfidence: 0.7,
      });
    }

    logger.debug("spirit_interaction_recorded", {
      agentId: input.agentId,
      userId: input.userId,
      action: input.action,
      outcome: input.outcome,
    });
  } catch (error) {
    logger.error("spirit_interaction_record_failed", {
      agentId: input.agentId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Learn user preference from explicit choice.
 * Called when user makes a selection or provides feedback.
 */
export async function learnUserPreference(input: {
  userId: number;
  agentId: AgentRole;
  preferenceKey: string;
  preferenceValue: string;
  context?: string;
}): Promise<void> {
  try {
    await SpiritMemoryManager.recordMemory({
      userId: input.userId,
      agentId: input.agentId,
      memoryType: "preference",
      memoryKey: input.preferenceKey,
      memoryValue: {
        value: input.preferenceValue,
        context: input.context,
        learnedAt: new Date().toISOString(),
      },
      initialConfidence: 0.8, // High confidence for explicit preferences
    });

    logger.info("user_preference_learned", {
      agentId: input.agentId,
      userId: input.userId,
      preferenceKey: input.preferenceKey,
    });
  } catch (error) {
    logger.error("user_preference_learn_failed", {
      agentId: input.agentId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Detect and learn behavioral patterns from user actions.
 * Called periodically to analyze recent interactions.
 */
export async function detectAndLearnPatterns(input: {
  userId: number;
  agentId: AgentRole;
  recentActions: Array<{ action: string; timestamp: Date; context?: string }>;
}): Promise<void> {
  try {
    // Simple pattern detection: look for repeated actions
    const actionCounts = new Map<string, number>();

    input.recentActions.forEach(action => {
      const count = actionCounts.get(action.action) || 0;
      actionCounts.set(action.action, count + 1);
    });

    // Learn patterns that occur 3+ times
    for (const [action, count] of actionCounts.entries()) {
      if (count >= 3) {
        const patternKey = `frequent_action_${action}`;
        const patternDescription = `User frequently performs: ${action}`;

        await SpiritMemoryManager.learnPattern({
          userId: input.userId,
          agentId: input.agentId,
          patternKey,
          patternDescription,
          occurrences: count,
        });

        logger.info("pattern_learned", {
          agentId: input.agentId,
          userId: input.userId,
          pattern: action,
          occurrences: count,
        });
      }
    }
  } catch (error) {
    logger.error("pattern_detection_failed", {
      agentId: input.agentId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
