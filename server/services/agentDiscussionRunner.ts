/**
 * agentDiscussionRunner.ts — 多代理「自動討論」執行器
 *
 * Caller 已透過 AgentCollaborationOrchestrator.startCollaboration 建好 session
 * 後再呼叫這支：對同一份 user prompt 連續跑 N 棒精靈，每位用 invokeLLM 拿一段
 * 回覆，並把該回覆 publish 到 AgentCommunicationBus（correlationId =
 * collaborationId），客戶端輪詢 getCollaborationMessages 就能看到一輪一輪冒出
 * 的討論串。
 *
 * 為什麼要做：原本 startCollaboration 只把 task 派給第一棒（director），
 * executeProtocolHandoff 也是「使用者按一次按鈕、交一棒」，沒有 auto-loop。
 * 這支補上「丟一個 prompt → 多位精靈自動接著回」這條路，讓使用者不用每換一棒
 * 就點一次。
 *
 * 邊界：
 * - 預設最多 3 輪、最多 4 位獨立精靈（避免無止境繞圈）
 * - LLM 呼叫一律序列（不平行）— 後一棒看得到前一棒的內容才能接話
 * - 任何 LLM 失敗就停下來，把錯誤寫進 session.result，不影響使用者
 * - 整個 runner 跑完才把 session 標 completed；中途已經發出的 message 仍然
 *   留在 bus history 給 UI 顯示
 */

import {
  SPIRIT_COLLAB_PROTOCOL,
  getRoleSystemPromptSlice,
  getPrimaryNicknameForRole,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import { createAgentMessage } from "../../shared/agent-communication-protocol";
import { AgentCommunicationBus } from "./agentCommunicationBus";
import { AgentCollaborationOrchestrator } from "./agentCollaborationOrchestrator";
import { invokeLLM } from "../_core/llm";
import { logger } from "../_core/logger";

interface RunAutoDiscussionInput {
  /** 已存在的 collaboration session id（startCollaboration 回傳的那個） */
  collaborationId: string;
  /** 使用者最初丟出的需求一句話 */
  userPrompt: string;
  /** 第一棒接手的精靈；通常由 selectRoleForIntent 決定，預設 director */
  initialAgent?: AgentRole;
  /** 最多跑幾輪（每輪 = 一位精靈說一段） */
  maxRounds?: number;
  /** 使用者靜音的精靈，遇到就跳過 */
  mutedRoles?: ReadonlyArray<AgentRole>;
  /**
   * 每位精靈 LLM 呼叫的硬上限（毫秒）。預留時間給多輪累積，
   * 整支 runner 大約 maxRounds * timeoutMs 是 worst case。
   */
  timeoutMsPerTurn?: number;
}

interface DiscussionTurn {
  agent: AgentRole;
  nickname: string;
  text: string;
  startedAt: number;
  durationMs: number;
}

interface RunAutoDiscussionResult {
  collaborationId: string;
  turns: DiscussionTurn[];
  participatingAgents: AgentRole[];
  /** 中斷原因：max-rounds / no-handoff / llm-error / cancelled */
  stoppedReason: "max-rounds" | "no-handoff" | "llm-error" | "cancelled";
}

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_TURN_TIMEOUT_MS = 25_000;

/**
 * 從 SPIRIT_COLLAB_PROTOCOL 挑下一位精靈：跳過已經講過的、跳過 muted 的，
 * 走第一個還可用的 handoff。回 null 代表沒人可以接、應該收尾。
 */
function pickNextAgent(
  current: AgentRole,
  alreadySpoken: ReadonlyArray<AgentRole>,
  muted: ReadonlyArray<AgentRole>
): AgentRole | null {
  const spec = SPIRIT_COLLAB_PROTOCOL[current];
  if (!spec) return null;
  const mutedSet = new Set<AgentRole>(muted);
  const spokenSet = new Set<AgentRole>(alreadySpoken);
  for (const handoff of spec.handoffs) {
    if (mutedSet.has(handoff.to)) continue;
    if (spokenSet.has(handoff.to)) continue;
    return handoff.to;
  }
  return null;
}

/**
 * 把至今的討論轉成「給下一棒看的對話歷史」：每位精靈以 assistant 身份說過
 * 什麼都帶進去，原始使用者需求在最前面當 user 角色。讓接手的精靈能讀到前
 * 文，而不是憑空再寫一篇。
 */
function buildMessagesForAgent(
  userPrompt: string,
  history: ReadonlyArray<DiscussionTurn>,
  nextAgent: AgentRole
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const persona = getRoleSystemPromptSlice(nextAgent);
  const collabContext =
    "你跟其他幾位精靈正在一起討論同一個使用者需求。請延續前面的對話、不要重覆別人講過的事；把你的角色觀點補上，並在結尾用一句話說「下一棒可以做什麼」。回覆控制在 4-6 句，不要長篇大論。";
  const system = `${persona}\n\n${collabContext}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: userPrompt },
  ];
  for (const turn of history) {
    messages.push({
      role: "assistant",
      content: `（${turn.nickname} / ${turn.agent}）${turn.text}`,
    });
  }
  return messages;
}

/**
 * 把單一精靈的回覆寫進 bus，UI 端輪詢 getCollaborationMessages 就會看到。
 * 用 broadcast 是因為 runner 沒有「下一棒已經 subscribe」的保證，broadcast
 * 永遠進 history 也永遠不會找不到收件人。
 */
async function publishTurn(
  turn: DiscussionTurn,
  collaborationId: string
): Promise<void> {
  const message = createAgentMessage(
    turn.agent,
    "broadcast",
    "share_context",
    {
      action: "discussion_turn",
      data: {
        nickname: turn.nickname,
        text: turn.text,
        durationMs: turn.durationMs,
        startedAt: turn.startedAt,
      },
      reason: "auto-discussion turn",
    },
    {
      correlationId: collaborationId,
      priority: "normal",
    }
  );
  await AgentCommunicationBus.publish(message);
}

/**
 * 主入口：把整輪討論跑完並回傳結果摘要。中途已 publish 的 message 不會回收 —
 * 即便整支 runner 失敗，使用者仍然能看到已產生的部分對話。
 */
export async function runAutoDiscussion(
  input: RunAutoDiscussionInput
): Promise<RunAutoDiscussionResult> {
  const maxRounds = Math.max(1, Math.min(input.maxRounds ?? DEFAULT_MAX_ROUNDS, 5));
  const timeoutMs = Math.max(
    5_000,
    Math.min(input.timeoutMsPerTurn ?? DEFAULT_TURN_TIMEOUT_MS, 60_000)
  );
  const muted = input.mutedRoles ?? [];

  const turns: DiscussionTurn[] = [];
  const spoken: AgentRole[] = [];
  let currentAgent: AgentRole = input.initialAgent ?? "director";
  let stoppedReason: RunAutoDiscussionResult["stoppedReason"] = "max-rounds";

  for (let round = 0; round < maxRounds; round += 1) {
    if (muted.includes(currentAgent)) {
      const next = pickNextAgent(currentAgent, spoken, muted);
      if (!next) {
        stoppedReason = "no-handoff";
        break;
      }
      currentAgent = next;
      continue;
    }

    const messages = buildMessagesForAgent(input.userPrompt, turns, currentAgent);
    const startedAt = Date.now();
    let text = "";
    try {
      const result = await Promise.race([
        invokeLLM({
          messages,
          runName: `auto-discussion:${currentAgent}`,
          // 用 director 的 reasoning slot 跑就好；不指定 model，讓引擎路由決定。
          // temperature 略高讓不同精靈口吻有差別。
          temperature: 0.65,
          preferEngine: "auto",
          maxTokens: 600,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`auto-discussion timeout for ${currentAgent}`)),
            timeoutMs
          )
        ),
      ]);
      const choice = result.choices[0]?.message?.content;
      if (typeof choice === "string") {
        text = choice;
      } else if (Array.isArray(choice)) {
        text = choice
          .map(part =>
            part && typeof part === "object" && "type" in part && part.type === "text"
              ? ((part as { text?: string }).text ?? "")
              : ""
          )
          .join("");
      }
      text = text.trim();
    } catch (err) {
      logger.warn("auto_discussion_turn_failed", {
        collaborationId: input.collaborationId,
        agent: currentAgent,
        round,
        error: err instanceof Error ? err.message : String(err),
      });
      stoppedReason = "llm-error";
      break;
    }

    if (!text) {
      logger.warn("auto_discussion_empty_reply", {
        collaborationId: input.collaborationId,
        agent: currentAgent,
        round,
      });
      stoppedReason = "llm-error";
      break;
    }

    const turn: DiscussionTurn = {
      agent: currentAgent,
      nickname: getPrimaryNicknameForRole(currentAgent),
      text,
      startedAt,
      durationMs: Date.now() - startedAt,
    };
    turns.push(turn);
    spoken.push(currentAgent);
    await publishTurn(turn, input.collaborationId);

    // 決定下一棒；沒人可接就收尾
    const next = pickNextAgent(currentAgent, spoken, muted);
    if (!next) {
      stoppedReason = "no-handoff";
      break;
    }
    currentAgent = next;
  }

  const completedAt = Date.now();
  const startedAt = turns[0]?.startedAt ?? completedAt;
  await AgentCollaborationOrchestrator.completeCollaboration(input.collaborationId, {
    success: stoppedReason !== "llm-error",
    output: {
      turns: turns.map(t => ({
        agent: t.agent,
        nickname: t.nickname,
        text: t.text,
        durationMs: t.durationMs,
      })),
      stoppedReason,
    },
    participants: spoken,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    completedBy: spoken[spoken.length - 1] ?? input.initialAgent ?? "director",
  });

  return {
    collaborationId: input.collaborationId,
    turns,
    participatingAgents: spoken,
    stoppedReason,
  };
}
