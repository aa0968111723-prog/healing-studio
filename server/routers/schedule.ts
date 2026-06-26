import { nanoid } from "nanoid";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Schedule (ICS feed) ──────────────────────────────────────────────────────
// The actual `.ics` payload is served by an Express route at
// /api/ics/<token>.ics — phone calendars (Apple Calendar, Google Calendar,
// Outlook) subscribe to that URL. tRPC just manages the token.

export const scheduleRouter = router({
  icsFeed: protectedProcedure.query(async ({ ctx }) => {
    let token = await db.getUserIcsFeedToken(ctx.user.id);
    if (!token) {
      token = nanoid(32);
      await db.setUserIcsFeedToken(ctx.user.id, token);
    }
    return { token, url: `/api/ics/${token}.ics` };
  }),

  rotateIcsFeed: protectedProcedure.mutation(async ({ ctx }) => {
    const token = nanoid(32);
    await db.setUserIcsFeedToken(ctx.user.id, token);
    return { token, url: `/api/ics/${token}.ics` };
  }),

  revokeIcsFeed: protectedProcedure.mutation(async ({ ctx }) => {
    await db.setUserIcsFeedToken(ctx.user.id, null);
    return { success: true };
  }),
});
