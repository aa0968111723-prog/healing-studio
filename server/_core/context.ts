import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./googleAuth";
import { getOrbTraceId, getRequestId } from "./logger";
import { randomUUID } from "node:crypto";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  orbTraceId: string;
  /** AIDV-289: x-request-id correlation header — echoed in response, available to all procedures. */
  requestId: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  const headerOrbTraceId = opts.req.header("x-orb-trace-id")?.trim();
  const orbTraceId = headerOrbTraceId || getOrbTraceId() || `orb_${randomUUID()}`;

  // AIDV-289: read x-request-id (or fall back to orbTraceId so it's always set).
  const requestId = opts.req.header("x-request-id")?.trim() || getRequestId() || orbTraceId;

  return {
    req: opts.req,
    res: opts.res,
    user,
    orbTraceId,
    requestId,
  };
}
