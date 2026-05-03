/**
 * agentOSRouter — tRPC gateway in front of the hollow-agentOS FastAPI service
 * (running as a side-car container on the internal docker network).
 *
 * Phase 1 scope: `health` smoke test only. Subsequent phases will add agent
 * management, task submission, and (admin-gated) txn / fs / shell endpoints.
 *
 * Security: every procedure goes through `protectedProcedure` and the
 * upstream bearer token is injected server-side; the token never reaches
 * the browser. A fixed endpoint allowlist is preferred over a generic proxy.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { agentOSHealth, isAgentOSEnabled } from "../services/agentOSClient";

export const agentOSRouter = router({
  health: protectedProcedure.query(async () => {
    if (!isAgentOSEnabled()) {
      return {
        enabled: false,
        ok: false,
        status: "AGENT_OS_DISABLED",
        details: {
          message:
            "hollow-agentOS integration is disabled. Set AGENT_OS_ENABLED=true to opt in.",
        },
      } as const;
    }
    const result = await agentOSHealth();
    return {
      enabled: true,
      ok: result.ok,
      status: result.status ?? null,
      details: result.details ?? null,
    } as const;
  }),
});
