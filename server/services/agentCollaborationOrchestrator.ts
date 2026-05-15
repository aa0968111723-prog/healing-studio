/**
 * server/services/agentCollaborationOrchestrator.ts
 *
 * Orchestrates collaboration between multiple AI agents to complete complex tasks.
 * Manages agent handoffs, shared context, and multi-agent workflows.
 */

import {
  SPIRIT_COLLAB_PROTOCOL,
  pickBestHandoff,
  type AgentRole,
  type SpiritHandoff,
} from "../../shared/orb-agent-roles";
import { SpiritStatusMonitor } from "./spiritStatusMonitor";
import type {
  AgentMessage,
  AgentSharedContext,
  AgentCollaborationRequest,
  AgentCollaborationResult,
  AgentHandoff,
  AgentCapabilityDeclaration,
} from "../../shared/agent-communication-protocol";
import {
  createAgentMessage,
  createHandoffMessage,
  generateCollaborationId,
  agentHasCapability,
  type CollaborationSession,
} from "../../shared/agent-communication-protocol";
import {
  getSpecializedAgentCapability,
  findAgentForTool,
} from "../../shared/orb-specialized-agents";
import { AgentCommunicationBus } from "./agentCommunicationBus";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import {
  agentCollaborationSessions,
  agentCollaborationHandoffs,
  type InsertAgentCollaborationSession,
  type InsertAgentCollaborationHandoff,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// CollaborationSession is now defined in the shared protocol so the
// router and the orchestrator agree on the shape (the router imports
// the same type via `import { CollaborationSession }`). Keeping the
// orchestrator's behaviour identical — just removing the local copy
// of the interface.

class AgentCollaborationOrchestratorClass {
  private activeSessions: Map<string, CollaborationSession> = new Map();
  private agentCapabilities: Map<AgentRole, AgentCapabilityDeclaration> = new Map();

  constructor() {
    // Initialize with default capabilities for all agents
    this.initializeAgentCapabilities();
  }

  /**
   * Initialize agent capabilities registry
   */
  private initializeAgentCapabilities(): void {
    // Role-based agents
    this.registerAgentCapability({
      agentId: "director",
      capabilities: ["multi-step planning", "workflow design", "task decomposition"],
      availableTools: ["director.suggestPlan"],
      knowledgeDomains: ["project planning", "creative workflow", "narrative structure"],
      available: true,
    });

    // 編編 (composer) — 在當頁實際執行的執行員。tools 同時涵蓋
    // 「頁面動作 namespace」(page.*)＋「跨模態 fal 派遣前綴」(studio.*)，
    // 因為 SPIRIT_MODEL_CAPABILITIES.composer = ALL_CATEGORIES，編編的
    // dispatch 範圍真的橫跨所有 modality；只是大多時候是用 page.* 走 UI
    // 路徑，少數時候直接用 studio.* / spirit.invoke 打 fal.ai。
    this.registerAgentCapability({
      agentId: "composer",
      capabilities: [
        "page action dispatch",
        "model selection on current page",
        "parameter filling",
        "form submission",
        "submit + observe loop",
        "single-page workflow execution",
      ],
      availableTools: [
        "page.fillPrompt",
        "page.setModel",
        "page.setParam",
        "page.setTab",
        "page.setMode",
        "page.applyPreset",
        "page.submit",
        "page.runWorkflow",
        "studio.*",
      ],
      knowledgeDomains: [
        "studio operations",
        "parameter tuning",
        "page capabilities discovery",
        "fal model id mapping",
      ],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "critic",
      capabilities: ["review", "improvement suggestions", "quality assessment"],
      availableTools: [],
      knowledgeDomains: ["content critique", "quality standards"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "researcher",
      capabilities: ["information gathering", "comparison", "search"],
      availableTools: ["research.deepSearch", "inspiration.fetch"],
      knowledgeDomains: ["web research", "model comparison", "trend analysis"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "navigator",
      capabilities: ["page navigation", "UI guidance"],
      availableTools: [],
      knowledgeDomains: ["site navigation", "feature location"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "companion",
      capabilities: ["conversation", "emotional support", "intent clarification"],
      availableTools: [],
      knowledgeDomains: ["open conversation", "user intent"],
      available: true,
    });

    // Specialized agents - dynamically load from registry.
    // 靈靈 / 體體 之前漏在外面 → findBestAgentForTask 永遠選不到，
    // SPIRIT_COLLAB_PROTOCOL 寫「交給靈靈／體體」的 handoff 鏈直接斷掉。
    // 對應條目已在 shared/orb-specialized-agents.ts:242,267。
    const specializedAgents: AgentRole[] = [
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
      "learning-specialist",
      "inspiration-specialist",
      "anatomy-specialist",
    ];

    specializedAgents.forEach(agentId => {
      const capability = getSpecializedAgentCapability(agentId);
      if (capability) {
        this.registerAgentCapability({
          agentId: agentId as AgentRole,
          capabilities: capability.useCases,
          availableTools: capability.primaryTools,
          knowledgeDomains: capability.knowledgeDomains,
          available: true,
          specializations: this.mapToSpecializations(agentId),
        });
      }
    });

    // ── Proactive trio (財財 / 巧巧 / 守守) ─────────────────────────────
    // 之前只在 metadata 裡躺著，沒進 capability 註冊表 → 別的 agent 用
    // findBestAgentForTask 找不到他們，造成「被動的事永遠交給導導 / 編編」。
    this.registerAgentCapability({
      agentId: "accountant",
      capabilities: [
        "cost estimation",
        "budget tracking",
        "model price comparison",
        "spend forecasting",
        "workflow rollup",
        "month-end projection",
      ],
      availableTools: [
        "accountant.estimate",
        "accountant.compare",
        "accountant.usage",
        "accountant.savings",
        "accountant.workflowEstimate",
        "accountant.budgetForecast",
      ],
      knowledgeDomains: ["model pricing", "quota", "subscription tiers", "daily spend trends"],
      available: true,
    });
    this.registerAgentCapability({
      agentId: "quality-coach",
      capabilities: ["prompt rewriting", "output quality review", "iteration coaching"],
      availableTools: [],
      knowledgeDomains: ["prompt engineering", "image / video quality heuristics"],
      available: true,
    });
    this.registerAgentCapability({
      agentId: "inspector",
      capabilities: ["site health patrol", "broken link detection", "accessibility check", "performance triage"],
      availableTools: [],
      knowledgeDomains: ["broken links", "accessibility", "performance", "bug triage"],
      available: true,
    });

    // ── 8 位新增精靈：律律 / 安安 / 群群 / 總總 / 帶帶 / 記記 / 細細 / 步步 ──
    this.registerAgentCapability({
      agentId: "legal-advisor",
      capabilities: [
        "AI generation copyright check",
        "trademark / portrait risk detection",
        "license interpretation",
        "safe rewrite suggestion",
      ],
      availableTools: ["research.deepSearch"],
      knowledgeDomains: ["copyright law", "trademark", "fair use", "creative commons", "AI generation policy"],
      available: true,
      specializations: ["legal"],
    });
    this.registerAgentCapability({
      agentId: "security-guard",
      capabilities: [
        "credential leak detection",
        "phishing recognition",
        "account hardening guidance",
        "deepfake / voice-clone risk warning",
      ],
      availableTools: [],
      knowledgeDomains: ["account security", "API key management", "2FA", "phishing defence"],
      available: true,
      specializations: ["security"],
    });
    this.registerAgentCapability({
      agentId: "community-manager",
      capabilities: [
        "social platform strategy",
        "age-group audience analysis",
        "post copy + hashtag suggestion",
        "publishing cadence planning",
      ],
      availableTools: ["research.deepSearch", "studio.generateImage", "studio.generateVideo"],
      knowledgeDomains: ["IG", "TikTok", "YouTube", "小紅書", "Facebook", "social trends"],
      available: true,
      specializations: ["community"],
    });
    this.registerAgentCapability({
      agentId: "chief-orchestrator",
      capabilities: [
        "team status overview",
        "handoff routing",
        "multi-agent orchestration",
        "deadline + bottleneck surfacing",
      ],
      availableTools: [],
      knowledgeDomains: ["agent orchestration", "task queue", "team workload"],
      available: true,
      specializations: ["orchestration"],
    });
    this.registerAgentCapability({
      agentId: "onboarding-coach",
      capabilities: [
        "stuck-user detection",
        "step-by-step UI guidance",
        "pageElement focus assistance",
        "common pitfalls workaround",
      ],
      availableTools: [],
      knowledgeDomains: ["site UI", "onboarding flows", "common stuck points"],
      available: true,
      specializations: ["onboarding"],
    });
    this.registerAgentCapability({
      agentId: "notes-curator",
      capabilities: [
        "note creation + retrieval",
        "asset library curation",
        "schedule + todo",
        "tag / search organisation",
      ],
      availableTools: [],
      knowledgeDomains: ["notes", "calendar", "asset library"],
      available: true,
      specializations: ["notes"],
    });
    this.registerAgentCapability({
      agentId: "settings-detail",
      capabilities: [
        "preference adjustment",
        "settings page navigation",
        "side-effect explanation",
        "approval-required flagging on high-risk changes",
      ],
      availableTools: [],
      knowledgeDomains: ["settings surface", "preferences", "high-risk account changes"],
      available: true,
      specializations: ["settings"],
    });
    this.registerAgentCapability({
      agentId: "plan-executor",
      capabilities: [
        "multi-step workflow execution",
        "cross-page tool dispatch",
        "per-step status reporting",
        "failure recovery (retry / replan / abort)",
      ],
      availableTools: ["studio.*", "media.*", "research.deepSearch"],
      knowledgeDomains: ["multi-step orchestration", "tool dispatch", "step retries"],
      available: true,
      specializations: ["execution"],
    });
  }

  /**
   * Map agent ID to specializations
   */
  private mapToSpecializations(agentId: string): AgentCapabilityDeclaration["specializations"] {
    // `specializations` is `Array<...> | undefined`, so its element
    // type is `NonNullable<...>[number]` rather than `...[0]` (the
    // latter doesn't exist on the undefined branch and breaks tsc).
    type Spec = NonNullable<AgentCapabilityDeclaration["specializations"]>[number];
    const mapping: Record<string, Spec> = {
      "image-specialist": "image",
      "video-specialist": "video",
      "music-specialist": "audio",
      "voice-specialist": "voice",
      "training-specialist": "training",
      "learning-specialist": "learning",
      // 8 位新增精靈
      "legal-advisor": "legal",
      "security-guard": "security",
      "community-manager": "community",
      "chief-orchestrator": "orchestration",
      "onboarding-coach": "onboarding",
      "notes-curator": "notes",
      "settings-detail": "settings",
      "plan-executor": "execution",
      "inspiration-specialist": "inspiration",
      "anatomy-specialist": "anatomy",
    };
    const spec = mapping[agentId];
    return spec ? [spec] : undefined;
  }

  /**
   * Register an agent's capabilities
   */
  registerAgentCapability(capability: AgentCapabilityDeclaration): void {
    this.agentCapabilities.set(capability.agentId, capability);
    logger.debug("agent_capability_registered", {
      agentId: capability.agentId,
      capabilities: capability.capabilities,

    });
  }

  /**
   * Start a collaboration session
   */
  async startCollaboration(
    request: AgentCollaborationRequest
  ): Promise<CollaborationSession> {
    // 兩種 caller shape 都支援：protocol-style (task / context / requestingAgent)
    // 與 chat-router-style (taskDescription / sharedContext / initiatingAgent)。
    // 把它們收斂成一組 normalized 變數再用。
    const requestingAgent: AgentRole = request.requestingAgent ?? request.initiatingAgent ?? "director";
    const taskText: string = request.task ?? request.taskDescription ?? "(unspecified collaboration task)";
    const contextSource = (request.context ?? request.sharedContext ?? {}) as Partial<AgentSharedContext>;
    const sessionId = contextSource.sessionId ?? request.sessionId ?? `session_${Date.now()}`;
    const baseContext: AgentSharedContext = {
      ...(contextSource as AgentSharedContext),
      sessionId,
    };
    const collaborationId = baseContext.collaborationId || generateCollaborationId();
    const session: CollaborationSession = {
      collaborationId,
      userId: baseContext.userId ?? request.userId,
      sessionId,
      taskDescription: taskText,
      startedAt: Date.now(),
      currentAgent: requestingAgent,
      participatingAgents: [requestingAgent],
      sharedContext: {
        ...baseContext,
        collaborationId,
      },
      status: "active",
      completedSteps: [],
    };

    this.activeSessions.set(collaborationId, session);

    logger.info("collaboration_started", {
      collaborationId,
      taskDescription: taskText,
      requestingAgent,


    });

    // ─── Persist to database ────────────────────────────────────────────
    try {
      const dbSession: InsertAgentCollaborationSession = {
        collaborationId,
        userId: session.userId || 0,
        sessionId,
        taskDescription: session.taskDescription,
        status: session.status,
        initiatingAgent: requestingAgent,
        currentAgent: session.currentAgent,
        participatingAgents: session.participatingAgents,
        requiredCapabilities: request.requiredCapabilities || [],
        sharedContext: session.sharedContext as Record<string, unknown>,
        result: undefined,
        startedAt: session.startedAt,
        completedAt: undefined,
      };

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(agentCollaborationSessions).values(dbSession);

      logger.debug("collaboration_persisted", {
        collaborationId,


      });
    } catch (error) {
      logger.error("collaboration_persist_failed", {
        collaborationId,
        error: error instanceof Error ? error.message : String(error),

      });
      // Continue even if persistence fails - in-memory session is still valid
    }

    return session;
  }

  /**
   * Find the best agent for a specific task
   */
  findBestAgent(requirements: {
    tools?: string[];
    domains?: string[];
    // Use NonNullable<...>[number] for the same reason as
    // mapToSpecializations — index access on the optional array fails tsc.
    specialization?: NonNullable<AgentCapabilityDeclaration["specializations"]>[number];
    excludeAgents?: AgentRole[];
  }): AgentRole | null {
    const candidates: Array<{ agent: AgentRole; score: number }> = [];

    this.agentCapabilities.forEach((capability, agentId) => {
      // Skip excluded agents
      if (requirements.excludeAgents?.includes(agentId)) {
        return;
      }

      // Skip unavailable agents
      if (!capability.available) {
        return;
      }

      let score = 0;

      // Check tools match
      if (requirements.tools && requirements.tools.length > 0) {
        const matchingTools = requirements.tools.filter(tool =>
          capability.availableTools.some(availTool =>
            availTool === tool || availTool.includes("*")
          )
        );
        score += matchingTools.length * 10;
      }

      // Check domain match
      if (requirements.domains && requirements.domains.length > 0) {
        const matchingDomains = requirements.domains.filter(domain =>
          capability.knowledgeDomains.some(kd =>
            kd.toLowerCase().includes(domain.toLowerCase())
          )
        );
        score += matchingDomains.length * 5;
      }

      // Check specialization match
      if (requirements.specialization && capability.specializations) {
        if (capability.specializations.includes(requirements.specialization)) {
          score += 20;
        }
      }

      // Consider agent load (lower is better)
      if (capability.load !== undefined) {
        score -= capability.load / 10;
      }

      if (score > 0) {
        candidates.push({ agent: agentId, score });
      }
    });

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].agent : null;
  }

  /**
   * 15 精靈：依 SPIRIT_COLLAB_PROTOCOL 查 fromAgent 的下一棒建議。
   * 純 read-only — 給 UI 「他做完會交給誰」chip / chain runner 預設順序用。
   * 可選 mutedRoles，篩掉使用者靜音的精靈。
   */
  getProtocolHandoffsFor(
    fromAgent: AgentRole,
    options?: { mutedRoles?: ReadonlyArray<AgentRole> }
  ): SpiritHandoff[] {
    const spec = SPIRIT_COLLAB_PROTOCOL[fromAgent];
    if (!spec) return [];
    const muted = new Set<AgentRole>(options?.mutedRoles ?? []);
    return spec.handoffs.filter(h => !muted.has(h.to));
  }

  /**
   * 15 精靈：直接依 SPIRIT_COLLAB_PROTOCOL 把當前 session 交棒給下一位。
   * 使用情境：UI 顯示「他做完會交給編編 — 確定？」按下後 client 呼叫這裡，
   * orchestrator 真的把 session.currentAgent 切過去並寫進 handoffs DB。
   *
   * 匹配策略（簡單但夠用）：
   *   1. 若有 whenHint，先嘗試 substring match SpiritHandoff.when
   *   2. 找不到 → 回傳 handoffs[0]（protocol 裡列在最前面的就是預設）
   *   3. 整條 handoffs 都被 mute 過濾掉 → 回 null（呼叫端決定 fallback）
   */
  async executeProtocolHandoff(args: {
    collaborationId: string;
    fromAgent: AgentRole;
    whenHint?: string;
    /** 額外加分用的 hint token（例如使用者剛剛訊息的關鍵字） */
    hintTokens?: ReadonlyArray<string>;
    mutedRoles?: ReadonlyArray<AgentRole>;
    extraContext?: Record<string, unknown>;
  }): Promise<{ executed: boolean; handoff: SpiritHandoff | null; toAgent: AgentRole | null }> {
    const session = this.activeSessions.get(args.collaborationId)
      ?? Array.from(this.activeSessions.values()).find(
        s => s.collaborationId === args.collaborationId
      );

    // 用 SpiritStatusMonitor 拿目前 busy 的精靈，給 picker 扣分（不剔除，
    // 因為「全員都 busy」時還是要派人，扣分讓 idle 優先選即可）。
    const busyRoles = SpiritStatusMonitor.getAllStatuses()
      .filter(s => s.status === "busy")
      .map(s => s.spiritId);

    // session.recentHandoffTargets 給 cycle 防呆。沒 session（很罕見的早期
    // call）就傳空陣列。
    const recentRoles = session?.recentHandoffTargets ?? [];

    const picked = pickBestHandoff(args.fromAgent, {
      whenHint: args.whenHint,
      hintTokens: args.hintTokens,
      mutedRoles: args.mutedRoles,
      busyRoles,
      recentRoles,
    });

    if (!picked) {
      logger.debug("protocol_handoff_no_candidates", {
        fromAgent: args.fromAgent,
        muted: args.mutedRoles ?? [],
        busy: busyRoles,
      });
      return { executed: false, handoff: null, toAgent: null };
    }

    if (!session) {
      logger.warn("protocol_handoff_no_session", { collaborationId: args.collaborationId });
      return { executed: false, handoff: picked, toAgent: picked.to };
    }

    // 構造 AgentHandoff 並交給既有的 executeHandoff — 它會處理 DB 寫入、
    // bus publish、session.currentAgent 切換。我們不重複實作那段邏輯。
    // SpiritHandoff.when 透過 nextAction 帶下去（語意夠近 — 「他應該做什麼」），
    // executeHandoff 會把整個 context 寫進 contextTransferred JSON 欄位。
    const mergedContext = {
      ...session.sharedContext,
      ...(args.extraContext ?? {}),
    };
    const handoff: AgentHandoff = {
      fromAgent: args.fromAgent,
      toAgent: picked.to,
      reason: picked.reason,
      context: mergedContext,
      nextAction: picked.when,
    };
    await this.executeHandoff(handoff);

    // 推進 recentHandoffTargets 給下一輪 picker 的 cycle 防呆參考；保留
    // 末端 6 個。直接 mutate session 物件 — 它就在 activeSessions Map 內。
    session.recentHandoffTargets = [
      ...(session.recentHandoffTargets ?? []),
      picked.to,
    ].slice(-6);

    return { executed: true, handoff: picked, toAgent: picked.to };
  }

  /**
   * Execute agent handoff
   */
  async executeHandoff(handoff: AgentHandoff): Promise<void> {
    const session = Array.from(this.activeSessions.values()).find(
      s => s.sharedContext.collaborationId === handoff.context.collaborationId
    );

    if (!session) {
      logger.warn("handoff_no_session", {
        collaborationId: handoff.context.collaborationId,

      });
      return;
    }

    // Update session
    session.currentAgent = handoff.toAgent;
    if (!session.participatingAgents.includes(handoff.toAgent)) {
      session.participatingAgents.push(handoff.toAgent);
    }
    session.sharedContext = handoff.context;

    if (handoff.completedSteps) {
      session.completedSteps.push(...handoff.completedSteps);
    }

    // Send handoff message via bus
    const message = createHandoffMessage(handoff, session.collaborationId);
    await AgentCommunicationBus.publish(message);

    logger.info("agent_handoff", {
      collaborationId: session.collaborationId,
      fromAgent: handoff.fromAgent,
      toAgent: handoff.toAgent,
      reason: handoff.reason,


    });

    // ─── Persist handoff to database ────────────────────────────────────
    try {
      const dbHandoff: InsertAgentCollaborationHandoff = {
        handoffId: `handoff_${session.collaborationId}_${Date.now()}`,
        collaborationId: session.collaborationId,
        fromAgent: handoff.fromAgent,
        toAgent: handoff.toAgent,
        handoffReason: handoff.reason,
        contextTransferred: handoff.context as Record<string, unknown>,
        timestamp: Date.now(),
      };

      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(agentCollaborationHandoffs).values(dbHandoff);

      // Update session in database
      await db
        .update(agentCollaborationSessions)
        .set({
          currentAgent: session.currentAgent,
          participatingAgents: session.participatingAgents,
          sharedContext: session.sharedContext as Record<string, unknown>,
        })
        .where(eq(agentCollaborationSessions.collaborationId, session.collaborationId));

      logger.debug("handoff_persisted", {
        collaborationId: session.collaborationId,


      });
    } catch (error) {
      logger.error("handoff_persist_failed", {
        collaborationId: session.collaborationId,
        error: error instanceof Error ? error.message : String(error),

      });
    }
  }

  /**
   * Complete a collaboration session
   */
  async completeCollaboration(
    collaborationId: string,
    result: AgentCollaborationResult
  ): Promise<void> {
    const session = this.activeSessions.get(collaborationId);
    if (!session) {
      logger.warn("complete_collaboration_no_session", {
        collaborationId,

      });
      return;
    }

    session.status = result.success ? "completed" : "failed";
    session.result = result;

    logger.info("collaboration_completed", {
      collaborationId,
      success: result.success,
      duration: Date.now() - session.startedAt,
      participatingAgents: session.participatingAgents,
      completedBy: result.completedBy,


    });

    // ─── Persist completion to database ─────────────────────────────────
    try {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(agentCollaborationSessions)
        .set({
          status: session.status,
          result: result as unknown as Record<string, unknown>,
          completedAt: Date.now(),
        })
        .where(eq(agentCollaborationSessions.collaborationId, collaborationId));

      logger.debug("collaboration_completion_persisted", {
        collaborationId,


      });
    } catch (error) {
      logger.error("collaboration_completion_persist_failed", {
        collaborationId,
        error: error instanceof Error ? error.message : String(error),

      });
    }

    // Keep session for a while for history, then clean up
    setTimeout(() => {
      this.activeSessions.delete(collaborationId);
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Get active collaboration session
   */
  getSession(collaborationId: string): CollaborationSession | undefined {
    return this.activeSessions.get(collaborationId);
  }

  /**
   * Alias of `getSession` — agentCollaborationRouter calls this name
   * (it predates the rename); keep both pointing at the same store so
   * neither call site has to change.
   */
  getSessionStatus(collaborationId: string): CollaborationSession | undefined {
    return this.getSession(collaborationId);
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: number): CollaborationSession[] {
    return Array.from(this.activeSessions.values()).filter(
      s => s.userId === userId && s.status === "active"
    );
  }

  /**
   * Cancel a collaboration session
   */
  async cancelCollaboration(collaborationId: string, reason: string): Promise<void> {
    const session = this.activeSessions.get(collaborationId);
    if (session) {
      session.status = "cancelled";
      logger.info("collaboration_cancelled", {
        collaborationId,
        reason,

      });

      // ─── Persist cancellation to database ───────────────────────────────
      try {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db
          .update(agentCollaborationSessions)
          .set({
            status: "cancelled",
            completedAt: Date.now(),
          })
          .where(eq(agentCollaborationSessions.collaborationId, collaborationId));

        logger.debug("collaboration_cancellation_persisted", {
          collaborationId,


        });
      } catch (error) {
        logger.error("collaboration_cancellation_persist_failed", {
          collaborationId,
          error: error instanceof Error ? error.message : String(error),

        });
      }
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    activeSessions: number;
    totalAgents: number;
    availableAgents: number;
    sessionsByAgent: Record<string, number>;
  } {
    const sessionsByAgent: Record<string, number> = {};

    this.activeSessions.forEach(session => {
      session.participatingAgents.forEach(agent => {
        sessionsByAgent[agent] = (sessionsByAgent[agent] || 0) + 1;
      });
    });

    return {
      activeSessions: this.activeSessions.size,
      totalAgents: this.agentCapabilities.size,
      availableAgents: Array.from(this.agentCapabilities.values()).filter(
        c => c.available
      ).length,
      sessionsByAgent,
    };
  }
}

// Singleton instance
export const AgentCollaborationOrchestrator = new AgentCollaborationOrchestratorClass();

// Export for testing
export { AgentCollaborationOrchestratorClass };
