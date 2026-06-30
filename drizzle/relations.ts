import { relations } from "drizzle-orm";
import {
  users,
  refreshTokens,
  userWorkflows,
  agentPreferences,
  backgroundJobs,
  digitalAssetLibrary,
  fineTunedModels,
  userFeedbackReports,
  apiUsageLogs,
  generationHistory,
  systemSettings,
  userAiBrain,
  loginHistory,
  promptLibrary,
  promptAssets,
  promptCollection,
  userSubscriptions,
  modelTrainingConsents,
  fineTunedModelConsents,
  featuredShowcase,
  featuredShowcaseComments,
  orbConversations,
  orbConversationMessages,
  studioRecipes,
  studioVersions,
  orbLongTermMemories,
  orbMemoryAssociations,
  orbIntentLogs,
  orbWorkflowTemplates,
  orbWorkflowExecutions,
  orbWorkflowStepExecutions,
  orbWorkflowTemplateRatings,
  agentCollaborationSessions,
  agentCollaborationSteps,
  agentCollaborationMessages,
  agentCollaborationHandoffs,
  teams,
  teamMemberships,
  teachingMaterials,
  teachingMaterialAccessLog,
  videoProjects,
  projectSnapshots,
  webhookSubscriptions,
  webhookDeliveryHistory,
  creativeProjects,
  orbFeedbackEvents,
  modelWishes,
  modelWishVotes,
} from "./schema";

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  refreshTokens: many(refreshTokens),
  userWorkflow: one(userWorkflows, {
    fields: [users.id],
    references: [userWorkflows.userId],
  }),
  agentPreferences: one(agentPreferences, {
    fields: [users.id],
    references: [agentPreferences.userId],
  }),
  systemSettings: one(systemSettings, {
    fields: [users.id],
    references: [systemSettings.userId],
  }),
  userAiBrain: one(userAiBrain, {
    fields: [users.id],
    references: [userAiBrain.userId],
  }),
  userSubscriptions: one(userSubscriptions, {
    fields: [users.id],
    references: [userSubscriptions.userId],
  }),
  backgroundJobs: many(backgroundJobs),
  digitalAssetLibrary: many(digitalAssetLibrary),
  fineTunedModels: many(fineTunedModels),
  userFeedbackReports: many(userFeedbackReports),
  apiUsageLogs: many(apiUsageLogs),
  generationHistory: many(generationHistory),
  loginHistory: many(loginHistory),
  promptLibrary: many(promptLibrary),
  promptCollection: many(promptCollection),
  modelTrainingConsents: many(modelTrainingConsents),
  fineTunedModelConsents: many(fineTunedModelConsents),
  orbConversations: many(orbConversations),
  studioRecipes: many(studioRecipes),
  studioVersions: many(studioVersions),
  orbLongTermMemories: many(orbLongTermMemories),
  orbIntentLogs: many(orbIntentLogs),
  orbWorkflowExecutions: many(orbWorkflowExecutions),
  orbWorkflowTemplateRatings: many(orbWorkflowTemplateRatings),
  orbFeedbackEvents: many(orbFeedbackEvents),
  agentCollaborationSessions: many(agentCollaborationSessions),
  teamMemberships: many(teamMemberships),
  ownedTeams: many(teams, { relationName: "teamOwner" }),
  teachingMaterials: many(teachingMaterials),
  videoProjects: many(videoProjects),
  creativeProjects: many(creativeProjects),
  webhookSubscriptions: many(webhookSubscriptions),
  modelWishes: many(modelWishes),
  modelWishVotes: many(modelWishVotes),
}));

// ── Refresh Tokens ────────────────────────────────────────────────────────────
export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// ── User Workflows ────────────────────────────────────────────────────────────
export const userWorkflowsRelations = relations(userWorkflows, ({ one }) => ({
  user: one(users, {
    fields: [userWorkflows.userId],
    references: [users.id],
  }),
}));

// ── Agent Preferences ─────────────────────────────────────────────────────────
export const agentPreferencesRelations = relations(agentPreferences, ({ one }) => ({
  user: one(users, {
    fields: [agentPreferences.userId],
    references: [users.id],
  }),
}));

// ── Background Jobs ───────────────────────────────────────────────────────────
export const backgroundJobsRelations = relations(backgroundJobs, ({ one }) => ({
  user: one(users, {
    fields: [backgroundJobs.userId],
    references: [users.id],
  }),
}));

// ── Digital Asset Library ─────────────────────────────────────────────────────
export const digitalAssetLibraryRelations = relations(digitalAssetLibrary, ({ one, many }) => ({
  user: one(users, {
    fields: [digitalAssetLibrary.userId],
    references: [users.id],
  }),
  promptAssets: many(promptAssets),
}));

// ── Fine-Tuned Models ─────────────────────────────────────────────────────────
export const fineTunedModelsRelations = relations(fineTunedModels, ({ one }) => ({
  user: one(users, {
    fields: [fineTunedModels.userId],
    references: [users.id],
  }),
}));

// ── User Feedback Reports ─────────────────────────────────────────────────────
export const userFeedbackReportsRelations = relations(userFeedbackReports, ({ one }) => ({
  user: one(users, {
    fields: [userFeedbackReports.userId],
    references: [users.id],
  }),
}));

// ── API Usage Logs ────────────────────────────────────────────────────────────
export const apiUsageLogsRelations = relations(apiUsageLogs, ({ one }) => ({
  user: one(users, {
    fields: [apiUsageLogs.userId],
    references: [users.id],
  }),
}));

// ── Generation History ────────────────────────────────────────────────────────
export const generationHistoryRelations = relations(generationHistory, ({ one }) => ({
  user: one(users, {
    fields: [generationHistory.userId],
    references: [users.id],
  }),
}));

// ── Login History ─────────────────────────────────────────────────────────────
export const loginHistoryRelations = relations(loginHistory, ({ one }) => ({
  user: one(users, {
    fields: [loginHistory.userId],
    references: [users.id],
  }),
}));

// ── System Settings ───────────────────────────────────────────────────────────
export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  user: one(users, {
    fields: [systemSettings.userId],
    references: [users.id],
  }),
}));

// ── User AI Brain ─────────────────────────────────────────────────────────────
export const userAiBrainRelations = relations(userAiBrain, ({ one }) => ({
  user: one(users, {
    fields: [userAiBrain.userId],
    references: [users.id],
  }),
}));

// ── Prompt Library ────────────────────────────────────────────────────────────
export const promptLibraryRelations = relations(promptLibrary, ({ one, many }) => ({
  user: one(users, {
    fields: [promptLibrary.userId],
    references: [users.id],
  }),
  promptAssets: many(promptAssets),
}));

// ── Prompt Assets (junction: promptLibrary ←→ digitalAssetLibrary) ────────────
export const promptAssetsRelations = relations(promptAssets, ({ one }) => ({
  prompt: one(promptLibrary, {
    fields: [promptAssets.promptId],
    references: [promptLibrary.id],
  }),
  asset: one(digitalAssetLibrary, {
    fields: [promptAssets.assetId],
    references: [digitalAssetLibrary.id],
  }),
}));

// ── Prompt Collection ─────────────────────────────────────────────────────────
export const promptCollectionRelations = relations(promptCollection, ({ one }) => ({
  user: one(users, {
    fields: [promptCollection.userId],
    references: [users.id],
  }),
}));

// ── User Subscriptions ────────────────────────────────────────────────────────
export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [userSubscriptions.userId],
    references: [users.id],
  }),
}));

// ── Model Training Consents ───────────────────────────────────────────────────
export const modelTrainingConsentsRelations = relations(modelTrainingConsents, ({ one }) => ({
  user: one(users, {
    fields: [modelTrainingConsents.userId],
    references: [users.id],
  }),
}));

// ── Fine-Tuned Model Consents ─────────────────────────────────────────────────
export const fineTunedModelConsentsRelations = relations(fineTunedModelConsents, ({ one }) => ({
  user: one(users, {
    fields: [fineTunedModelConsents.userId],
    references: [users.id],
  }),
}));

// ── Featured Showcase ─────────────────────────────────────────────────────────
export const featuredShowcaseRelations = relations(featuredShowcase, ({ one, many }) => ({
  curator: one(users, {
    fields: [featuredShowcase.curatorUserId],
    references: [users.id],
  }),
  comments: many(featuredShowcaseComments),
}));

// ── Featured Showcase Comments ────────────────────────────────────────────────
export const featuredShowcaseCommentsRelations = relations(featuredShowcaseComments, ({ one }) => ({
  showcase: one(featuredShowcase, {
    fields: [featuredShowcaseComments.showcaseId],
    references: [featuredShowcase.id],
  }),
  user: one(users, {
    fields: [featuredShowcaseComments.userId],
    references: [users.id],
  }),
}));

// ── Orb Conversations ─────────────────────────────────────────────────────────
export const orbConversationsRelations = relations(orbConversations, ({ one, many }) => ({
  user: one(users, {
    fields: [orbConversations.userId],
    references: [users.id],
  }),
  messages: many(orbConversationMessages),
}));

// ── Orb Conversation Messages ─────────────────────────────────────────────────
export const orbConversationMessagesRelations = relations(orbConversationMessages, ({ one }) => ({
  conversation: one(orbConversations, {
    fields: [orbConversationMessages.conversationId],
    references: [orbConversations.conversationId],
  }),
  user: one(users, {
    fields: [orbConversationMessages.userId],
    references: [users.id],
  }),
}));

// ── Studio Recipes ────────────────────────────────────────────────────────────
export const studioRecipesRelations = relations(studioRecipes, ({ one }) => ({
  user: one(users, {
    fields: [studioRecipes.userId],
    references: [users.id],
  }),
}));

// ── Studio Versions ───────────────────────────────────────────────────────────
export const studioVersionsRelations = relations(studioVersions, ({ one }) => ({
  user: one(users, {
    fields: [studioVersions.userId],
    references: [users.id],
  }),
}));

// ── Orb Long-Term Memories ────────────────────────────────────────────────────
export const orbLongTermMemoriesRelations = relations(orbLongTermMemories, ({ one, many }) => ({
  user: one(users, {
    fields: [orbLongTermMemories.userId],
    references: [users.id],
  }),
  fromAssociations: many(orbMemoryAssociations, { relationName: "fromMemory" }),
  toAssociations: many(orbMemoryAssociations, { relationName: "toMemory" }),
}));

// ── Orb Memory Associations (self-referential via orbLongTermMemories) ─────────
export const orbMemoryAssociationsRelations = relations(orbMemoryAssociations, ({ one }) => ({
  fromMemory: one(orbLongTermMemories, {
    fields: [orbMemoryAssociations.fromMemoryId],
    references: [orbLongTermMemories.id],
    relationName: "fromMemory",
  }),
  toMemory: one(orbLongTermMemories, {
    fields: [orbMemoryAssociations.toMemoryId],
    references: [orbLongTermMemories.id],
    relationName: "toMemory",
  }),
}));

// ── Orb Intent Logs ───────────────────────────────────────────────────────────
export const orbIntentLogsRelations = relations(orbIntentLogs, ({ one }) => ({
  user: one(users, {
    fields: [orbIntentLogs.userId],
    references: [users.id],
  }),
}));

// ── Orb Workflow Templates ────────────────────────────────────────────────────
export const orbWorkflowTemplatesRelations = relations(orbWorkflowTemplates, ({ one, many }) => ({
  creator: one(users, {
    fields: [orbWorkflowTemplates.creatorUserId],
    references: [users.id],
  }),
  executions: many(orbWorkflowExecutions),
  ratings: many(orbWorkflowTemplateRatings),
}));

// ── Orb Workflow Executions ───────────────────────────────────────────────────
export const orbWorkflowExecutionsRelations = relations(orbWorkflowExecutions, ({ one, many }) => ({
  template: one(orbWorkflowTemplates, {
    fields: [orbWorkflowExecutions.templateId],
    references: [orbWorkflowTemplates.id],
  }),
  user: one(users, {
    fields: [orbWorkflowExecutions.userId],
    references: [users.id],
  }),
  stepExecutions: many(orbWorkflowStepExecutions),
}));

// ── Orb Workflow Step Executions ──────────────────────────────────────────────
export const orbWorkflowStepExecutionsRelations = relations(orbWorkflowStepExecutions, ({ one }) => ({
  execution: one(orbWorkflowExecutions, {
    fields: [orbWorkflowStepExecutions.executionId],
    references: [orbWorkflowExecutions.id],
  }),
}));

// ── Orb Workflow Template Ratings ─────────────────────────────────────────────
export const orbWorkflowTemplateRatingsRelations = relations(orbWorkflowTemplateRatings, ({ one }) => ({
  template: one(orbWorkflowTemplates, {
    fields: [orbWorkflowTemplateRatings.templateId],
    references: [orbWorkflowTemplates.id],
  }),
  user: one(users, {
    fields: [orbWorkflowTemplateRatings.userId],
    references: [users.id],
  }),
}));

// ── Agent Collaboration Sessions ──────────────────────────────────────────────
export const agentCollaborationSessionsRelations = relations(agentCollaborationSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [agentCollaborationSessions.userId],
    references: [users.id],
  }),
  steps: many(agentCollaborationSteps),
  messages: many(agentCollaborationMessages),
  handoffs: many(agentCollaborationHandoffs),
}));

// ── Agent Collaboration Steps ─────────────────────────────────────────────────
export const agentCollaborationStepsRelations = relations(agentCollaborationSteps, ({ one }) => ({
  session: one(agentCollaborationSessions, {
    fields: [agentCollaborationSteps.collaborationId],
    references: [agentCollaborationSessions.collaborationId],
  }),
}));

// ── Agent Collaboration Messages ──────────────────────────────────────────────
export const agentCollaborationMessagesRelations = relations(agentCollaborationMessages, ({ one }) => ({
  session: one(agentCollaborationSessions, {
    fields: [agentCollaborationMessages.collaborationId],
    references: [agentCollaborationSessions.collaborationId],
  }),
}));

// ── Agent Collaboration Handoffs ──────────────────────────────────────────────
export const agentCollaborationHandoffsRelations = relations(agentCollaborationHandoffs, ({ one }) => ({
  session: one(agentCollaborationSessions, {
    fields: [agentCollaborationHandoffs.collaborationId],
    references: [agentCollaborationSessions.collaborationId],
  }),
}));

// ── Orb Feedback Events ───────────────────────────────────────────────────────
export const orbFeedbackEventsRelations = relations(orbFeedbackEvents, ({ one }) => ({
  user: one(users, {
    fields: [orbFeedbackEvents.userId],
    references: [users.id],
  }),
}));

// ── Teams ─────────────────────────────────────────────────────────────────────
export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, {
    fields: [teams.ownerId],
    references: [users.id],
    relationName: "teamOwner",
  }),
  memberships: many(teamMemberships),
  teachingMaterials: many(teachingMaterials),
}));

// ── Team Memberships ──────────────────────────────────────────────────────────
export const teamMembershipsRelations = relations(teamMemberships, ({ one }) => ({
  team: one(teams, {
    fields: [teamMemberships.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMemberships.userId],
    references: [users.id],
  }),
  inviter: one(users, {
    fields: [teamMemberships.invitedBy],
    references: [users.id],
    relationName: "membershipInviter",
  }),
}));

// ── Teaching Materials ────────────────────────────────────────────────────────
export const teachingMaterialsRelations = relations(teachingMaterials, ({ one, many }) => ({
  user: one(users, {
    fields: [teachingMaterials.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teachingMaterials.teamId],
    references: [teams.id],
  }),
  accessLogs: many(teachingMaterialAccessLog),
}));

// ── Teaching Material Access Log ──────────────────────────────────────────────
export const teachingMaterialAccessLogRelations = relations(teachingMaterialAccessLog, ({ one }) => ({
  material: one(teachingMaterials, {
    fields: [teachingMaterialAccessLog.materialId],
    references: [teachingMaterials.id],
  }),
  user: one(users, {
    fields: [teachingMaterialAccessLog.userId],
    references: [users.id],
  }),
}));

// ── Creative Projects ─────────────────────────────────────────────────────────
export const creativeProjectsRelations = relations(creativeProjects, ({ one, many }) => ({
  user: one(users, {
    fields: [creativeProjects.userId],
    references: [users.id],
  }),
  videoProjects: many(videoProjects),
}));

// ── Video Projects ────────────────────────────────────────────────────────────
export const videoProjectsRelations = relations(videoProjects, ({ one, many }) => ({
  user: one(users, {
    fields: [videoProjects.userId],
    references: [users.id],
  }),
  creativeProject: one(creativeProjects, {
    fields: [videoProjects.creativeProjectId],
    references: [creativeProjects.id],
  }),
  snapshots: many(projectSnapshots),
}));

// ── Project Snapshots ─────────────────────────────────────────────────────────
export const projectSnapshotsRelations = relations(projectSnapshots, ({ one }) => ({
  project: one(videoProjects, {
    fields: [projectSnapshots.projectId],
    references: [videoProjects.id],
  }),
}));

// ── Webhook Subscriptions ─────────────────────────────────────────────────────
export const webhookSubscriptionsRelations = relations(webhookSubscriptions, ({ one, many }) => ({
  user: one(users, {
    fields: [webhookSubscriptions.userId],
    references: [users.id],
  }),
  deliveryHistory: many(webhookDeliveryHistory),
}));

// ── Webhook Delivery History ──────────────────────────────────────────────────
export const webhookDeliveryHistoryRelations = relations(webhookDeliveryHistory, ({ one }) => ({
  subscription: one(webhookSubscriptions, {
    fields: [webhookDeliveryHistory.subscriptionId],
    references: [webhookSubscriptions.id],
  }),
}));

// ── Model Wishes ──────────────────────────────────────────────────────────────
export const modelWishesRelations = relations(modelWishes, ({ one, many }) => ({
  user: one(users, {
    fields: [modelWishes.userId],
    references: [users.id],
  }),
  votes: many(modelWishVotes),
}));

// ── Model Wish Votes ──────────────────────────────────────────────────────────
export const modelWishVotesRelations = relations(modelWishVotes, ({ one }) => ({
  wish: one(modelWishes, {
    fields: [modelWishVotes.wishId],
    references: [modelWishes.id],
  }),
  user: one(users, {
    fields: [modelWishVotes.userId],
    references: [users.id],
  }),
}));
