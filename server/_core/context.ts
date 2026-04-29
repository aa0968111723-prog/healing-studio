import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./googleAuth";
import { getOrbTraceId } from "./logger";
import { randomUUID } from "node:crypto";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  orbTraceId: string;
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

  return {
    req: opts.req,
    res: opts.res,
    user,
    orbTraceId,
  };
}
