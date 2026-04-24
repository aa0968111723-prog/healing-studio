import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface OrbToolCallAuditEvent {
  id: string;
  requestId: string;
  userId: number;
  userRole: string;
  taskId?: string;
  stepId?: string;
  toolName: string;
  usedTool?: string;
  ok: boolean;
  status?: number;
  error?: string;
  attempts?: number;
  startedAt: number;
  endedAt: number;
}

const MAX_EVENTS = 5_000;

function makeId(now: number): string {
  return `tool_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OrbToolCallLogStore {
  constructor(private readonly persistenceFile?: string) {
    this.loadFromDisk();
  }

  private events: OrbToolCallAuditEvent[] = [];

  private loadFromDisk(): void {
    if (!this.persistenceFile || !existsSync(this.persistenceFile)) return;
    try {
      const raw = readFileSync(this.persistenceFile, "utf8");
      const parsed = JSON.parse(raw) as OrbToolCallAuditEvent[];
      if (Array.isArray(parsed)) {
        this.events = parsed.slice(-MAX_EVENTS);
      }
    } catch (err) {
      console.error("[OrbToolCallLogStore] Failed to load persistence file:", err);
    }
  }

  private persist(): void {
    if (!this.persistenceFile) return;
    try {
      writeFileSync(this.persistenceFile, JSON.stringify(this.events), "utf8");
    } catch (err) {
      console.error("[OrbToolCallLogStore] Failed to persist logs:", err);
    }
  }

  append(
    event: Omit<OrbToolCallAuditEvent, "id"> & { id?: string }
  ): OrbToolCallAuditEvent {
    const next: OrbToolCallAuditEvent = {
      ...event,
      id: event.id ?? makeId(event.endedAt),
    };
    this.events.push(next);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    this.persist();
    return next;
  }

  list(opts?: {
    userId?: number;
    taskId?: string;
    requestId?: string;
    limit?: number;
  }): OrbToolCallAuditEvent[] {
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    return this.events
      .filter(event => {
        if (opts?.userId && event.userId !== opts.userId) return false;
        if (opts?.taskId && event.taskId !== opts.taskId) return false;
        if (opts?.requestId && event.requestId !== opts.requestId) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }
}

export const orbToolCallLogStore = new OrbToolCallLogStore(
  process.env.ORB_TOOL_CALL_LOG_FILE?.trim() || undefined
);
