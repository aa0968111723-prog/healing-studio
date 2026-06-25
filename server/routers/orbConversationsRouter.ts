import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  orbConversations,
  orbConversationMessages,
} from "../../drizzle/schema";
import { orbConversationEnhancer } from "../services/orbConversationEnhancer";

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

type AppendMessageInput = z.infer<typeof MessageInputSchema>;
type OrbConversationRow = typeof orbConversations.$inferSelect;
type OrbDb = Awaited<ReturnType<typeof getDbOrThrow>>;

/**
 * AIDV-157:把「找不到對話就 throw」換成「scoped + idempotent 的 lazy create」。
 *
 * 回傳一定屬於 caller 的 conversation 列。三種情形:
 *   1. 列已存在且 userId === caller → 原樣回傳(既有正常路徑,行為不變)。
 *   2. 列已存在但 userId !== caller → 丟 FORBIDDEN(防 IDOR,絕不附加到別人對話)。
 *   3. 列不存在 → 為 caller 建立一列(尊重 per-user 上限),回傳新列。
 *
 * **Idempotent**:conversationId 是主鍵。情形 3 與另一個併發請求競態時,後到者的
 * insert 會撞主鍵;此處吞掉重複鍵錯誤並回讀,保證最終只有一列、且必屬於先寫入者。
 * 若回讀後該列屬於別人(理論上幾乎不可能,client id 帶 Date.now()+random),
 * 一樣以 FORBIDDEN 收尾,不洩漏也不污染他人資料。
 */
async function loadOrLazyCreateConversation(
  db: OrbDb,
  conversationId: string,
  userId: number,
  messages: AppendMessageInput[]
): Promise<OrbConversationRow> {
  // 以 PK 查列(不帶 userId)以同時涵蓋「我的」與「別人占用同 id」兩種情形。
  const readByPk = async (): Promise<OrbConversationRow | undefined> => {
    const [row] = await db
      .select()
      .from(orbConversations)
      .where(eq(orbConversations.conversationId, conversationId))
      .limit(1);
    return row;
  };

  const existing = await readByPk();
  if (existing) {
    if (existing.userId !== userId) {
      // 防 IDOR:別人的對話,絕不附加。typed error,而非裸 500。
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Conversation not found",
      });
    }
    return existing;
  }

  // 列不存在 → lazy create。先檢查 per-user 上限,避免 runaway client 灌爆表。
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(orbConversations)
    .where(eq(orbConversations.userId, userId));
  if (Number(count) >= MAX_CONVERSATIONS_PER_USER) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `已達對話數量上限（${MAX_CONVERSATIONS_PER_USER}），請先刪除或封存舊對話。`,
    });
  }

  // 標題:用第一則 user 訊息前 24 字當名稱,否則用預設占位符(沿用 appendMessages
  // 既有 auto-title 規則,讓 lazy-create 出來的列名稱與正常建立一致)。
  const firstUserMsg = messages.find(m => m.role === "user");
  const derivedTitle =
    firstUserMsg && firstUserMsg.text.trim()
      ? firstUserMsg.text.trim().replace(/\s+/g, " ").slice(0, 24)
      : "新對話";

  try {
    await db.insert(orbConversations).values({
      conversationId,
      userId,
      title: derivedTitle,
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      messageCount: 0,
    });
  } catch {
    // Idempotent:併發競態下另一請求已建立同 PK 列,insert 撞主鍵。吞掉並回讀。
    const raced = await readByPk();
    if (!raced) throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create conversation",
    });
    if (raced.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Conversation not found",
      });
    }
    return raced;
  }

  const created = await readByPk();
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create conversation",
    });
  }
  return created;
}

export const orbConversationsRouter = router({
  /**
   * List the user's conversations, newest-updated first. Archived rows are
   * excluded by default; pinned ones float to the top regardless of update
   * time.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDbOrThrow();
      const limit = input?.limit ?? DEFAULT_LIST_LIMIT;
      // M8 修復:archivedAt 必須在 SQL where 過濾,不能 LIMIT 後在 JS filter。
      // 原本 includeArchived=false 時先 LIMIT 30 再 JS 過濾,使用者有 30+ 條
      // 已封存對話時 LIMIT 取的全是 archived 列,JS 過濾完變空陣列,UI 看起
      // 來像「所有對話被刪了」。
      const whereClause = input?.includeArchived
        ? eq(orbConversations.userId, ctx.user.id)
        : and(
            eq(orbConversations.userId, ctx.user.id),
            isNull(orbConversations.archivedAt)
          );
      const rows = await db
        .select({
          conversationId: orbConversations.conversationId,
          title: orbConversations.title,
          pinned: orbConversations.pinned,
          archivedAt: orbConversations.archivedAt,
          lastMessageAt: orbConversations.lastMessageAt,
          messageCount: orbConversations.messageCount,
          createdAt: orbConversations.createdAt,
          updatedAt: orbConversations.updatedAt,
        })
        .from(orbConversations)
        .where(whereClause)
        .orderBy(
          desc(orbConversations.pinned),
          desc(orbConversations.updatedAt)
        )
        .limit(limit);

      return { conversations: rows };
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
      const db = await getDbOrThrow();
      // Authorization gate — cheap query that verifies ownership
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

      const limit = input.limit ?? 200;
      const conditions = [
        eq(orbConversationMessages.conversationId, input.conversationId),
        eq(orbConversationMessages.userId, ctx.user.id),
      ];
      if (typeof input.beforeAt === "number") {
        conditions.push(lt(orbConversationMessages.at, input.beforeAt));
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
        .where(and(...conditions))
        .orderBy(asc(orbConversationMessages.at))
        .limit(limit);
      return { messages: rows };
    }),

  /**
   * Append one or more messages to a conversation in a single round-trip.
   * Updates the parent row's `lastMessageAt`, `messageCount`, and (when the
   * title is still the default placeholder) auto-derives a title from the
   * first user turn.
   *
   * AIDV-157 修復:**append 時若 conversation 列不存在,自動建立(lazy create)**。
   *
   * 根因:client 端(GlobalOrbChatContext)在使用者尚無任何 server 對話時,會用
   * client 端 `conv_*` id 先樂觀建立本地 tab(bootstrap / 舊版 migration 路徑),
   * 但這個 id 從未跑過 server `create`。隨後 persist effect 會對這個「只存在於本地」
   * 的 id 呼叫 appendMessages → 舊版直接丟 `NOT_FOUND "Conversation not found"`,
   * 對使用者表現為「打字送出後 AI 永遠不回 + console 連兩筆 500」(載入一筆、送出一筆)。
   *
   * 修法:把「找不到就 throw」改成「找不到就 scoped 到 user+conversationId 自動建立」。
   *   - **Scoped(防 IDOR)**:conversationId 是 PK。先以 PK 查列;若已被「別的 user」
   *     占用,絕不附加到別人的對話,改丟 FORBIDDEN(typed error,非裸 500)。
   *   - **Idempotent**:重送 / 併發兩個 mutation 時,PK 唯一性保證只會有一列;
   *     insert 撞 PK 一律當「已被建立」吞掉並回讀。
   *   - 既有正常路徑(列已存在且屬於 caller)行為與改動前完全相同。
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

      const conv = await loadOrLazyCreateConversation(
        db,
        input.conversationId,
        ctx.user.id,
        input.messages
      );

      // L14 修復:重試 / 雙擊送出時 client 會把同一批訊息再 push 一次,
      // 沒去重的話 DB 留兩份。schema 沒 unique constraint(避開 migration),
      // 改用「at 已存在就跳過」 — at 是 client-side ms timestamp,同訊息
      // 重送會帶相同值;新訊息會帶新值。
      // 競態空窗極小(同用戶連送兩個 mutation 之間 ms 級),保險 OK。
      const atsToInsert = input.messages.map(m => m.at);
      const existingAts = atsToInsert.length
        ? await db
            .select({ at: orbConversationMessages.at })
            .from(orbConversationMessages)
            .where(
              and(
                eq(orbConversationMessages.conversationId, input.conversationId),
                inArray(orbConversationMessages.at, atsToInsert)
              )
            )
        : [];
      const existingAtSet = new Set(existingAts.map(r => r.at));
      const newMessages = input.messages.filter(m => !existingAtSet.has(m.at));
      const rows = newMessages.map(m => ({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        role: m.role,
        text: m.text.slice(0, MAX_TEXT_LENGTH),
        at: m.at,
        metadata: m.metadata,
      }));
      if (rows.length > 0) {
        await db.insert(orbConversationMessages).values(rows);
      }

      const lastAt = Math.max(...input.messages.map(m => m.at));
      // Snapshot before the update — the update mutates the conv object in tests.
      const prevCount = conv.messageCount ?? 0;

      // Auto-title: derive from already-fetched conv; safe pre-check before update.
      let autoTitle: string | undefined;
      if (conv.title === "新對話") {
        const firstUserMsg = input.messages.find(m => m.role === "user");
        if (firstUserMsg?.text.trim()) {
          autoTitle = firstUserMsg.text.trim().replace(/\s+/g, " ").slice(0, 24);
        }
      }

      // Atomic SQL increment prevents concurrent-write race on messageCount.
      const setFields: Record<string, unknown> = {
        lastMessageAt: new Date(lastAt),
      };
      if (rows.length > 0) {
        setFields.messageCount = sql`${orbConversations.messageCount} + ${rows.length}`;
      }
      if (autoTitle !== undefined) {
        setFields.title = autoTitle;
      }
      await db
        .update(orbConversations)
        .set(setFields)
        .where(
          and(
            eq(orbConversations.conversationId, input.conversationId),
            eq(orbConversations.userId, ctx.user.id)
          )
        );

      // Fire-and-forget: extract memories and learn from this turn.
      // Never blocks the client response; errors stay silent.
      const lastUserMsg = [...input.messages].reverse().find(m => m.role === "user");
      if (lastUserMsg) {
        const lastAsstMsg = [...input.messages].reverse().find(m => m.role === "orb");
        orbConversationEnhancer.processConversationTurn({
          userId: ctx.user.id,
          conversationId: input.conversationId,
          userInput: lastUserMsg.text,
          orbResponse: lastAsstMsg?.text,
        }).catch((e: unknown) => {
          console.warn("[orbConversations] enhancer bg failed:", e instanceof Error ? e.message : e);
        });
      }

      return { ok: true as const, messageCount: prevCount + rows.length };
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
