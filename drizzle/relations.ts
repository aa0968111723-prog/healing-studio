import { relations } from "drizzle-orm";
import { users, refreshTokens, userWorkflows } from "./schema";

export const usersRelations = relations(users, ({ many, one }) => ({
  refreshTokens: many(refreshTokens),
  userWorkflow: one(userWorkflows, {
    fields: [users.id],
    references: [userWorkflows.userId],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const userWorkflowsRelations = relations(userWorkflows, ({ one }) => ({
  user: one(users, {
    fields: [userWorkflows.userId],
    references: [users.id],
  }),
}));
