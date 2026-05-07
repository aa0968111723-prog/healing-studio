/**
 * server/services/agentCommunicationBus.ts
 *
 * Central message bus for inter-agent communication.
 * Handles routing, queuing, delivery, and history of messages between all agents.
 */

import type {
  AgentMessage,
  AgentMessageType,
  AgentQuery,
  AgentQueryResponse,
} from "../../shared/agent-communication-protocol";
import type { AgentRole } from "../../shared/orb-agent-roles";
import { serializeAgentMessage } from "../../shared/agent-communication-protocol";
import { logger } from "../_core/logger";
import { db } from "../db";
import {
  agentCollaborationMessages,
  type InsertAgentCollaborationMessage,
} from "../../drizzle/schema";

type MessageHandler = (message: AgentMessage) => Promise<void> | void;

interface BusSubscription {
  agentId: AgentRole;
  handler: MessageHandler;
  messageTypes?: AgentMessageType[];
}

class AgentCommunicationBusClass {
  private subscriptions: Map<AgentRole, MessageHandler[]> = new Map();
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize = 1000;
  private readonly HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Subscribe an agent to receive messages
   */
  subscribe(
    agentId: AgentRole,
    handler: MessageHandler,
    options?: { messageTypes?: AgentMessageType[] }
  ): () => void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, []);
    }

    // Wrap handler to filter by message type if specified
    const wrappedHandler: MessageHandler = options?.messageTypes
      ? async (msg: AgentMessage) => {
          if (options.messageTypes!.includes(msg.messageType)) {
            await handler(msg);
          }
        }
      : handler;

    this.subscriptions.get(agentId)!.push(wrappedHandler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(agentId);
      if (handlers) {
        const index = handlers.indexOf(wrappedHandler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Publish a message to the bus
   */
  async publish(message: AgentMessage): Promise<void> {
    // Store in history
    this.addToHistory(message);

    // Log the message
    logger.debug({
      event: "agent_message_published",
      messageId: message.messageId,
      from: message.fromAgent,
      to: message.toAgent,
      type: message.messageType,
      priority: message.priority,
      correlation: message.correlationId,
    });

    // ─── Persist message to database ────────────────────────────────────
    try {
      const toAgentString = Array.isArray(message.toAgent)
        ? message.toAgent.join(",")
        : message.toAgent;

      const dbMessage: InsertAgentCollaborationMessage = {
        messageId: message.messageId,
        collaborationId: message.content.context?.collaborationId || null,
        fromAgent: message.fromAgent,
        toAgent: toAgentString,
        messageType: message.messageType,
        priority: message.priority,
        content: {
          action: message.content.action,
          data: message.content.data,
          reason: message.content.reason,
          responseFormat: message.content.responseFormat,
        },
        correlationId: message.correlationId || null,
        timestamp: message.timestamp,
      };

      await db.insert(agentCollaborationMessages).values(dbMessage);

      logger.debug({
        event: "agent_message_persisted",
        messageId: message.messageId,
      });
    } catch (error) {
      logger.error({
        event: "agent_message_persist_failed",
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue even if persistence fails - in-memory delivery proceeds
    }

    // Route message to recipients
    if (message.toAgent === "broadcast") {
      await this.broadcastToAll(message);
    } else if (Array.isArray(message.toAgent)) {
      await this.deliverToMultiple(message, message.toAgent);
    } else {
      await this.deliverToAgent(message, message.toAgent);
    }
  }

  /**
   * Deliver message to a specific agent
   */
  private async deliverToAgent(
    message: AgentMessage,
    agentId: AgentRole
  ): Promise<void> {
    const handlers = this.subscriptions.get(agentId);
    if (!handlers || handlers.length === 0) {
      logger.warn({
        event: "agent_message_no_subscriber",
        messageId: message.messageId,
        targetAgent: agentId,
        message: `No handler registered for agent: ${agentId}`,
      });
      return;
    }

    // Deliver to all handlers for this agent
    await Promise.all(
      handlers.map(async handler => {
        try {
          await handler(message);
        } catch (error) {
          logger.error({
            event: "agent_message_handler_error",
            messageId: message.messageId,
            targetAgent: agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );
  }

  /**
   * Deliver message to multiple agents
   */
  private async deliverToMultiple(
    message: AgentMessage,
    agentIds: AgentRole[]
  ): Promise<void> {
    await Promise.all(
      agentIds.map(agentId => this.deliverToAgent(message, agentId))
    );
  }

  /**
   * Broadcast message to all subscribed agents
   */
  private async broadcastToAll(message: AgentMessage): Promise<void> {
    const allAgents = Array.from(this.subscriptions.keys());
    // Don't send broadcast back to sender
    const recipients = allAgents.filter(id => id !== message.fromAgent);
    await this.deliverToMultiple(message, recipients);
  }

  /**
   * Add message to history
   */
  private addToHistory(message: AgentMessage): void {
    this.messageHistory.push(message);

    // Trim history if too large
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // Clean up expired messages
    this.cleanupExpiredMessages();
  }

  /**
   * Clean up expired messages from history
   */
  private cleanupExpiredMessages(): void {
    const now = Date.now();
    const retentionThreshold = now - this.HISTORY_RETENTION_MS;

    this.messageHistory = this.messageHistory.filter(msg => {
      // Remove if expired by expiresAt
      if (msg.expiresAt && msg.expiresAt < now) {
        return false;
      }
      // Remove if older than retention period
      if (msg.timestamp < retentionThreshold) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get message history for a specific agent
   */
  getHistory(options?: {
    agentId?: AgentRole;
    correlationId?: string;
    messageType?: AgentMessageType;
    limit?: number;
  }): AgentMessage[] {
    let filtered = [...this.messageHistory];

    if (options?.agentId) {
      filtered = filtered.filter(
        msg =>
          msg.fromAgent === options.agentId ||
          msg.toAgent === options.agentId ||
          (Array.isArray(msg.toAgent) && msg.toAgent.includes(options.agentId))
      );
    }

    if (options?.correlationId) {
      filtered = filtered.filter(
        msg => msg.correlationId === options.correlationId
      );
    }

    if (options?.messageType) {
      filtered = filtered.filter(
        msg => msg.messageType === options.messageType
      );
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Get conversation thread by correlation ID
   */
  getConversationThread(correlationId: string): AgentMessage[] {
    return this.messageHistory
      .filter(msg => msg.correlationId === correlationId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear message history
   */
  clearHistory(options?: { agentId?: AgentRole; olderThanMs?: number }): void {
    if (!options) {
      this.messageHistory = [];
      return;
    }

    const now = Date.now();
    this.messageHistory = this.messageHistory.filter(msg => {
      if (options.agentId) {
        const involvedInMessage =
          msg.fromAgent === options.agentId ||
          msg.toAgent === options.agentId ||
          (Array.isArray(msg.toAgent) && msg.toAgent.includes(options.agentId));
        if (!involvedInMessage) return true; // Keep messages not involving this agent
      }

      if (options.olderThanMs) {
        const threshold = now - options.olderThanMs;
        if (msg.timestamp >= threshold) return true; // Keep recent messages
      }

      return false; // Remove this message
    });
  }

  /**
   * Get statistics about message bus usage
   */
  getStats(): {
    totalMessages: number;
    messagesByAgent: Record<string, number>;
    messagesByType: Record<string, number>;
    activeSubscriptions: number;
  } {
    const messagesByAgent: Record<string, number> = {};
    const messagesByType: Record<string, number> = {};

    this.messageHistory.forEach(msg => {
      messagesByAgent[msg.fromAgent] = (messagesByAgent[msg.fromAgent] || 0) + 1;
      messagesByType[msg.messageType] = (messagesByType[msg.messageType] || 0) + 1;
    });

    return {
      totalMessages: this.messageHistory.length,
      messagesByAgent,
      messagesByType,
      activeSubscriptions: this.subscriptions.size,
    };
  }

  /**
   * Send a query from one agent to another
   */
  async query(query: AgentQuery, toAgent: AgentRole): Promise<AgentQueryResponse | null> {
    return new Promise((resolve) => {
      const timeoutMs = 5000; // 5 second timeout
      let resolved = false;

      // Subscribe to responses
      const unsubscribe = this.subscribe(
        query.fromAgent,
        async (message: AgentMessage) => {
          if (
            message.messageType === "response" &&
            message.fromAgent === toAgent &&
            !resolved
          ) {
            resolved = true;
            unsubscribe();
            resolve(message.content.data as AgentQueryResponse);
          }
        },
        { messageTypes: ["response"] }
      );

      // Send query
      const queryMessage: AgentMessage = {
        messageId: `query_${Date.now()}`,
        fromAgent: query.fromAgent,
        toAgent,
        messageType: "query",
        priority: "normal",
        content: {
          action: query.queryType,
          data: query.params,
        },
        timestamp: Date.now(),
        correlationId: `query_${Date.now()}`,
      };

      void this.publish(queryMessage);

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          unsubscribe();
          resolve(null);
        }
      }, timeoutMs);
    });
  }
}

// Singleton instance
export const AgentCommunicationBus = new AgentCommunicationBusClass();

// Export for testing
export { AgentCommunicationBusClass };
