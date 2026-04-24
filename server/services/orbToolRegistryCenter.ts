import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { OrbApiTool } from "./agentToolExecutor";
import { getOrbToolRegistry } from "../config/orbToolRegistry";

export interface ManagedOrbTool extends OrbApiTool {
  enabled: boolean;
  owner?: string;
  createdAt: number;
  updatedAt: number;
}

const managedToolSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().min(1).max(240),
  method: z.enum(["GET", "POST"]),
  endpoint: z.string().url(),
  version: z.string().min(1).max(32).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  allowedRoles: z.array(z.string().min(1).max(32)).max(8).optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(3).optional(),
      backoffMs: z.number().int().min(50).max(2000).optional(),
    })
    .optional(),
  fallbackTools: z.array(z.string().min(2).max(64)).max(3).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  requireConfirmation: z.boolean().optional(),
  enabled: z.boolean().default(true),
  owner: z.string().min(1).max(64).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const managedRegistrySchema = z.array(managedToolSchema).max(256);

function toManaged(tool: OrbApiTool, now: number): ManagedOrbTool {
  return {
    ...tool,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export class OrbToolRegistryCenter {
  constructor(private readonly persistenceFile?: string) {
    this.bootstrap();
  }

  private registry = new Map<string, ManagedOrbTool>();

  private bootstrap(): void {
    const now = Date.now();
    let loaded = false;
    if (this.persistenceFile && existsSync(this.persistenceFile)) {
      try {
        const raw = readFileSync(this.persistenceFile, "utf8");
        const parsed = managedRegistrySchema.parse(JSON.parse(raw) as unknown);
        this.registry = new Map(parsed.map(t => [t.name, t]));
        loaded = true;
      } catch (err) {
        console.error("[OrbToolRegistryCenter] Failed to load persistence file:", err);
      }
    }

    if (!loaded) {
      const envTools = getOrbToolRegistry();
      this.registry = new Map(envTools.map(tool => [tool.name, toManaged(tool, now)]));
      this.persist();
    }
  }

  private persist(): void {
    if (!this.persistenceFile) return;
    try {
      writeFileSync(
        this.persistenceFile,
        JSON.stringify(Array.from(this.registry.values())),
        "utf8"
      );
    } catch (err) {
      console.error("[OrbToolRegistryCenter] Failed to persist registry:", err);
    }
  }

  list(includeDisabled = true): ManagedOrbTool[] {
    const all = Array.from(this.registry.values());
    if (includeDisabled) return all;
    return all.filter(tool => tool.enabled);
  }

  activeTools(): OrbApiTool[] {
    return this.list(false).map(tool => ({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      endpoint: tool.endpoint,
      version: tool.version,
      riskLevel: tool.riskLevel,
      allowedRoles: tool.allowedRoles,
      retryPolicy: tool.retryPolicy,
      fallbackTools: tool.fallbackTools,
      headers: tool.headers,
      requireConfirmation: tool.requireConfirmation,
    }));
  }

  upsert(
    input: Omit<ManagedOrbTool, "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }
  ): ManagedOrbTool {
    const now = Date.now();
    const prev = this.registry.get(input.name);
    const next = managedToolSchema.parse({
      ...prev,
      ...input,
      createdAt: prev?.createdAt ?? input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    });
    this.registry.set(next.name, next);
    this.persist();
    return next;
  }

  setEnabled(name: string, enabled: boolean): ManagedOrbTool | null {
    const tool = this.registry.get(name);
    if (!tool) return null;
    const next = { ...tool, enabled, updatedAt: Date.now() };
    this.registry.set(name, next);
    this.persist();
    return next;
  }

  remove(name: string): boolean {
    const ok = this.registry.delete(name);
    if (ok) this.persist();
    return ok;
  }
}

export const orbToolRegistryCenter = new OrbToolRegistryCenter(
  process.env.ORB_TOOL_REGISTRY_FILE?.trim() || undefined
);
