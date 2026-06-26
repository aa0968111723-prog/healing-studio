import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import * as db from "../db";

export const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
  updateAvatar: protectedProcedure
    .input(
      z.object({
        // null = clear; "preset:<id>" | http(s) URL | data URL ≤ 64 KB.
        avatarUrl: z
          .string()
          .max(64 * 1024)
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const value = input.avatarUrl;
      if (value !== null) {
        const looksLikePreset = value.startsWith("preset:");
        const looksLikeUrl = /^https?:\/\//i.test(value);
        const looksLikeDataUrl = value.startsWith("data:image/");
        if (!looksLikePreset && !looksLikeUrl && !looksLikeDataUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "avatarUrl must be a preset id, https URL, or data URL",
          });
        }
      }
      await db.updateUserAvatar(ctx.user.id, value);
      return { ok: true as const, avatarUrl: value };
    }),
});
