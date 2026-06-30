import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  listSkills,
  getSkillEntry,
} from "../services/skillRegistryService";

export const skillRegistryRouter = router({
  listSkills: adminProcedure.query(async () => {
    return listSkills();
  }),

  getSkillById: adminProcedure
    .input(z.object({ skillId: z.string().min(1) }))
    .query(async ({ input }) => {
      return getSkillEntry(input.skillId);
    }),
});
