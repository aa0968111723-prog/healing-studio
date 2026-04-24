import type { OrbTask } from "../../shared/orb-agent-contract";
import { orbTaskStore, type CreateOrbTaskInput, type ReportStepInput } from "../services/orbTaskStore";

export interface OrbTaskSyncMeta {
  latestEventId: string | null;
  etag: string | null;
}

export interface OrbTimelineEvent {
  type: "task_created" | "step_approved" | "step_reported";
  eventId: string;
  schemaVersion: 1;
  at: number;
  source: "ui" | "tool" | "system";
  actor: "user" | "agent" | "system";
  stepId?: string;
  ok?: boolean;
  detail?: string;
  errorCode?: string;
}

export interface OrbTaskRepository {
  create(input: CreateOrbTaskInput): OrbTask;
  get(taskId: string, userId: number, now?: number): OrbTask | null;
  getTaskSyncMeta(taskId: string, userId: number, now?: number): OrbTaskSyncMeta;
  approve(taskId: string, userId: number, approved: boolean, now?: number): OrbTask | null;
  approveStep(taskId: string, userId: number, stepId: string, approved: boolean, now?: number): OrbTask | null;
  isStepApproved(taskId: string, userId: number, stepId: string, token: string | undefined, now?: number): boolean;
  reportStep(input: ReportStepInput, userId: number, now?: number): OrbTask | null;
  getTimelinePage(
    taskId: string,
    userId: number,
    opts?: {
      now?: number;
      from?: number;
      to?: number;
      cursor?: number;
      limit?: number;
      types?: Array<"task_created" | "step_approved" | "step_reported">;
      order?: "asc" | "desc";
    }
  ): { events: OrbTimelineEvent[]; nextCursor: number | null };
}

export const orbTaskRepository: OrbTaskRepository = orbTaskStore;
