import { z } from "zod";
import type { OrbApiTool } from "../services/agentToolExecutor";

const toolSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().min(1).max(240),
  method: z.enum(["GET", "POST"]),
  endpoint: z.string().url(),
  version: z.string().min(1).max(32).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  allowedRoles: z.array(z.string().min(1).max(32)).max(8).optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(3).default(0),
      backoffMs: z.number().int().min(50).max(2000).default(200),
    })
    .optional(),
  fallbackTools: z.array(z.string().min(2).max(64)).max(3).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  requireConfirmation: z.boolean().optional(),
});

const registrySchema = z.array(toolSchema).max(64);

let cached: OrbApiTool[] | null = null;

/**
 * ORB_TOOL_REGISTRY_JSON 範例：
 * [
 *   {"name":"crm.lookup","description":"查 CRM 客戶資料","method":"GET","endpoint":"https://api.example.com/customers"},
 *   {"name":"ticket.create","description":"建立客服工單","method":"POST","endpoint":"https://api.example.com/tickets","requireConfirmation":true}
 * ]
 */
export function getOrbToolRegistry(): OrbApiTool[] {
  if (cached) return cached;
  const raw = process.env.ORB_TOOL_REGISTRY_JSON?.trim();
  if (!raw) {
    cached = [];
    return cached;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    cached = registrySchema.parse(parsed);
    return cached;
  } catch (err) {
    console.error("[Orb] Invalid ORB_TOOL_REGISTRY_JSON:", err);
    cached = [];
    return cached;
  }
}

export function resetOrbToolRegistryForTest(): void {
  cached = null;
}
