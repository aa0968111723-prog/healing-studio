import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import {
  getValidDriveAccessToken,
  getDriveFolder,
  listDriveFolder,
  parseDriveFolderId,
} from "../services/googleDrive";

// ─── Google Drive Asset Library ───────────────────────────────────────────────
// Browse user's Drive folders and pin them as outdoor / personal asset
// libraries. OAuth happens via /api/oauth/google/drive/start so it can
// redirect to Google; the rest is plain tRPC.

export const driveRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const token = await db.getGoogleOauthToken(ctx.user.id, "drive");
    if (!token) {
      return { connected: false as const };
    }
    return {
      connected: true as const,
      scope: token.scope,
      expiresAt: token.expiresAt ? new Date(token.expiresAt).getTime() : null,
      hasRefreshToken: !!token.refreshToken,
    };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await db.deleteGoogleOauthToken(ctx.user.id, "drive");
    return { success: true };
  }),

  listLibraries: protectedProcedure.query(async ({ ctx }) => {
    return db.getDriveLibrariesByUser(ctx.user.id);
  }),

  addLibrary: protectedProcedure
    .input(
      z.object({
        label: z.string().min(1).max(128),
        kind: z.enum(["shoot", "personal", "other"]).default("shoot"),
        folderInput: z.string().min(1).max(2048),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const folderId = parseDriveFolderId(input.folderInput);
      if (!folderId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "無法從輸入辨識出 Drive 資料夾 ID 或網址",
        });
      }
      const accessToken = await getValidDriveAccessToken(ctx.user.id);
      if (!accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "尚未連結 Google Drive，或授權已失效",
        });
      }
      let folderName: string | null = null;
      try {
        const meta = await getDriveFolder(accessToken, folderId);
        if (meta.mimeType !== "application/vnd.google-apps.folder") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "此 Drive 項目不是資料夾",
          });
        }
        folderName = meta.name ?? null;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `無法存取此資料夾：${(err as Error).message}`,
        });
      }
      const id = await db.createDriveLibrary({
        userId: ctx.user.id,
        label: input.label,
        kind: input.kind,
        driveFolderId: folderId,
        driveFolderName: folderName,
      });
      return { id, driveFolderId: folderId, driveFolderName: folderName };
    }),

  removeLibrary: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteDriveLibrary(input.id, ctx.user.id);
      return { success: true };
    }),

  listFolder: protectedProcedure
    .input(
      z.object({
        folderId: z.string().min(1).max(128),
        pageToken: z.string().optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const accessToken = await getValidDriveAccessToken(ctx.user.id);
      if (!accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "尚未連結 Google Drive，或授權已失效",
        });
      }
      try {
        return await listDriveFolder(accessToken, input.folderId, {
          pageToken: input.pageToken,
          pageSize: input.pageSize,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Drive API 失敗：${(err as Error).message}`,
        });
      }
    }),
});
