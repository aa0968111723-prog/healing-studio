import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb,
  getConversationWithMessages,
  listConversationsCursor,
} from "../db";
import {
  orbConversations,
  orbConversationMessages,
} from "../../drizzle/schema";

async function getDbOrThrow() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  }
  return db;
}

/**
 * Multi-session orb conversations.
 *
 * Backs the "tabs" UI on /agent — each tab is one row in `orb_conversations`,
 * its messages live in `orb_conversation_messages`. The chat mutation itself
 * (`ai.chat`) stays stateless; the client persists each turn through this
 * router so history survives reloads and device switches.
 */

const MAX_CONVERSATIONS_PER_USER = 50;
const DEFAULT_LIST_LIMIT = 30;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_LENGTH = 32_000;

function generateConversationId(): string {
  // 24-char URL-safe id; long enough for ~10^14 conversations without collision risk
  return `conv_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizeTitle(raw: string | undefined | null): string {
  if (!raw) return "新對話";
  const trimmed = raw.trim();
  if (!trimmed) return "新對話";
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

const MessageInputSchema = z.object({
  role: z.enum(["user", "orb"]),
  text: z.string().max(MAX_TEXT_LENGTH),
  at: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const orbConversationsRouter = router({
  /**
   * List the user's conversations, newest-updated first. Archived rows are
   * excluded by default; pinned ones float to the top regardless of update
   * time.
   *
   * Supports cursor-based pagination via `cursor` (ISO timestamp of the last
   * seen row's `updatedAt`). When `cursor` is provided the response also
   * includes `nextCursor` for the following page.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          includeArchived: z.boolean().optional(),
          cursor: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = await listConversationsCursor(ctx.user.id, {
        limit: input?.limit ?? DEFAULT_LIST_LIMIT,
        includeArchived: input?.includeArchived,
        cursor: input?.cursor,
      });
      return { conversations: items, nextCursor };
    }),

  /** Create a new (empty) conversation and return its summary row. */
  create: protectedProcedure
    .input(
      z
        .object({
          title: z.string().max(MAX_TITLE_LENGTH).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDbOrThrow();

      // Per-user soft cap so a runaway client can't fill the table
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orbConversations)
        .where(eq(orbConversations.userId, ctx.user.id));
      if (Number(count) >= MAX_CONVERSATIONS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `已達對話數量上限（${MAX_CONVERSATIONS_PER_USER}），請先刪除或封存舊對話。`,
        });
      }

      const conversationId = generateConversationId();
      const title = normalizeTitle(input?.title);
      await db.insert(orbConversations).values({
        conversationId,
        userId: ctx.user.id,
        title,
        pinned: false,
        archivedAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });
      const [row] = await db
        .select()
        .from(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        )
        .limit(1);
      return { conversation: row };
    }),

  /** Rename or pin/unpin an existing conversation. */
  update: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(48),
        title: z.string().max(MAX_TITLE_LENGTH).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDbOrThrow();
      const updates: Record<string, unknown> = {};
      if (typeof input.title === "string") {
        updates.title = normalizeTitle(input.title);
      }
      if (typeof input.pinned === "boolean") {
        updates.pinned = input.pinned;
      }
      if (typeof input.archived === "boolean") {
        updates.archivedAt = input.archived ? new Date() : null;
      }
      if (Object.keys(updates).length === 0) {
        return { ok: true as const };
      }

      const result = await db
        .update(orbConversations)
        .set(updates)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        );
      const affected = (result as unknown as { affectedRows?: number })
        .affectedRows;
      if (typeof affected === "number" && affected === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      return { ok: true as const };
    }),

  /** Hard-delete a conversation and all its messages. */
  delete: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1).max(48) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbOrThrow();
      // Authorize first by user-scoped select; avoids deleting another user's
      // conversation if the id was guessed.
      const [owned] = await db
        .select({ id: orbConversations.conversationId })
        .from(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!owned) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      await db
        .delete(orbConversationMessages)
        .where(
          and(
            eq(orbConversationMessages.conversationId, input.conversationId),
            eq(orbConversationMessages.userId, ctx.user.id)
          )
        );
      await db
        .delete(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        );
      return { ok: true as const };
    }),

  /** Page the messages for one conversation in chronological order. */
  getMessages: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(48),
        limit: z.number().int().min(1).max(500).optional(),
        beforeAt: z.number().int().nonnegative().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 200;

      // Fast path: when no beforeAt cursor is provided, use the optimised
      // batched query that fetches ownership + messages in parallel.
      if (typeof input.beforeAt !== "number") {
        const result = await getConversationWithMessages(
          input.conversationId,
          ctx.user.id,
          limit
        );
        if (!result) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found",
          });
        }
        return { messages: result.messages };
      }

      // Slow path: beforeAt cursor requires an extra filter — fall back to
      // the two-query pattern so the ownership check is still enforced.
      const db = await getDbOrThrow();
      const [owned] = await db
        .select({ id: orbConversations.conversationId })
        .from(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!owned) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const rows = await db
        .select({
          messageId: orbConversationMessages.messageId,
          role: orbConversationMessages.role,
          text: orbConversationMessages.text,
          at: orbConversationMessages.at,
          metadata: orbConversationMessages.metadata,
        })
        .from(orbConversationMessages)
        .where(
          and(
            eq(orbConversationMessages.conversationId, input.conversationId),
            eq(orbConversationMessages.userId, ctx.user.id),
            lt(orbConversationMessages.at, input.beforeAt)
          )
        )
        .orderBy(asc(orbConversationMessages.at))
        .limit(limit);
      return { messages: rows };
    }),

  /**
   * Append one or more messages to a conversation in a single round-trip.
   * Updates the parent row's `lastMessageAt`, `messageCount`, and (when the
   * title is still the default placeholder) auto-derives a title from the
   * first user turn.
   */
  appendMessages: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(48),
        messages: z.array(MessageInputSchema).min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDbOrThrow();

      const [conv] = await db
        .select()
        .from(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const rows = input.messages.map(m => ({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        role: m.role,
        text: m.text.slice(0, MAX_TEXT_LENGTH),
        at: m.at,
        metadata: m.metadata,
      }));
      await db.insert(orbConversationMessages).values(rows);

      const lastAt = Math.max(...input.messages.map(m => m.at));
      const newCount = (conv.messageCount ?? 0) + rows.length;
      const updates: Record<string, unknown> = {
        lastMessageAt: new Date(lastAt),
        messageCount: newCount,
      };

      // Auto-title: if the row still uses the default placeholder, take the
      // first user turn's first ~24 chars as the conversation name.
      if (conv.title === "新對話") {
        const firstUserMsg = input.messages.find(m => m.role === "user");
        if (firstUserMsg && firstUserMsg.text.trim()) {
          const cleaned = firstUserMsg.text.trim().replace(/\s+/g, " ");
          updates.title = cleaned.slice(0, 24);
        }
      }
      await db
        .update(orbConversations)
        .set(updates)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        );

      return { ok: true as const, messageCount: newCount };
    }),

  /** Wipe every message in one conversation but keep the row (and tab) alive. */
  clearMessages: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1).max(48) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbOrThrow();
      const [owned] = await db
        .select({ id: orbConversations.conversationId })
        .from(orbConversations)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!owned) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      await db
        .delete(orbConversationMessages)
        .where(
          and(
            eq(orbConversationMessages.conversationId, input.conversationId),
            eq(orbConversationMessages.userId, ctx.user.id)
          )
        );
      await db
        .update(orbConversations)
        .set({ messageCount: 0, lastMessageAt: null })
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        );
      return { ok: true as const };
    }),
});
