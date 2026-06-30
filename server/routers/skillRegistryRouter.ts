import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";
import {
  listSkills,
  getSkillEntry,
  installSkill,
  updateTrust,
  disableSkill,
  enableSkill,
} from "../services/skillRegistryService";
import { SkillManifestSchema } from "../../shared/skill-manifest";

export const skillRegistryRouter = router({
  listSkills: adminProcedure.query(async () => {
    return listSkills();
  }),

  getSkillById: adminProcedure
    .input(z.object({ skillId: z.string().min(1) }))
    .query(async ({ input }) => {
      return getSkillEntry(input.skillId);
    }),

  // AIDV-883: wire write operations — installSkill / updateSkillTrust / setSkillStatus

  installSkill: adminProcedure
    .input(z.object({
      manifestJson: z.string().min(2),
      trust: z.enum(["reviewed", "community"]).default("community"),
      source: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let manifest;
      try {
        manifest = SkillManifestSchema.parse(JSON.parse(input.manifestJson));
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Manifest 格式錯誤：${err instanceof Error ? err.message : String(err)}`,
        });
      }
      const result = await installSkill({
        manifest,
        installedBy: ctx.user.id,
        trust: input.trust,
        source: input.source,
      });
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return result.entry;
    }),

  updateSkillTrust: adminProcedure
    .input(z.object({
      skillId: z.string().min(1),
      trust: z.enum(["official", "reviewed", "community"]),
    }))
    .mutation(async ({ input }) => {
      const result = await updateTrust(input.skillId, input.trust);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { ok: true };
    }),

  setSkillStatus: adminProcedure
    .input(z.object({
      skillId: z.string().min(1),
      status: z.enum(["active", "disabled"]),
    }))
    .mutation(async ({ input }) => {
      const result = input.status === "active"
        ? await enableSkill(input.skillId)
        : await disableSkill(input.skillId);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return { ok: true };
    }),
});
