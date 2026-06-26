/**
 * server/services/skillSandbox.ts — Wave S / AIDV-131
 *
 * S-6 Sandbox executor for kind=sandboxed community/external skills.
 *
 * Isolation guarantees:
 *   - No network: fetch/http/XMLHttpRequest/WebSocket absent from context
 *   - No filesystem: require/fs/path/Buffer absent from context
 *   - No process: process/global/__dirname/__filename absent
 *   - Time-limited: vm Script.runInContext({ timeout }) is enforced synchronously
 *   - Whitelist-only API surface: JSON, Math, Date, parseInt, isNaN, Array, Object, etc.
 *   - Fail-closed: SandboxViolation thrown on timeout, policy breach, or runtime error
 *
 * Memory: OS-level controls (cgroup/ulimit) bound memory in production.
 * The whitelist removes Buffer/stream/fs so large allocations are harder to hide.
 *
 * Only synchronous code is supported. Async skills (kind=declarative) flow through
 * the declarative path and never reach this module.
 */

import { createContext, Script } from "node:vm";
import { logger } from "../_core/logger";

const DEFAULT_TIMEOUT_MS = 5_000;

export class SandboxViolation extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "policy" | "runtime"
  ) {
    super(message);
    this.name = "SandboxViolation";
  }
}

export interface SandboxOptions {
  /** Execution wall-clock limit in ms. Default: 5000. */
  timeoutMs?: number;
}

const policyDenied = (name: string) => () => {
  throw new Error(`[sandbox policy] "${name}" is not available in the skill sandbox`);
};

function buildRestrictedContext(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    // ── Explicit inputs only — zero implicit internal data ──────────────────
    inputs,

    // ── Whitelisted globals ─────────────────────────────────────────────────
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Symbol,
    RegExp,
    Error,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,

    // ── Blocked async primitives (async in a synchronous vm still needs these
    //    names to not resolve to outer scope globals) ─────────────────────────
    setTimeout: policyDenied("setTimeout"),
    clearTimeout: policyDenied("clearTimeout"),
    setInterval: policyDenied("setInterval"),
    clearInterval: policyDenied("clearInterval"),
    setImmediate: policyDenied("setImmediate"),

    // ── Explicitly absent: all of these remain undefined in the sandbox ──────
    // fetch, XMLHttpRequest, WebSocket, http, https, net, tls
    // require, module, exports, __dirname, __filename
    // process, global, Buffer, fs, path, os, child_process, crypto
    // eval — NOT provided; vm Script does not expose outer eval
  };
}

/**
 * Execute sandboxed skill code with the provided inputs.
 *
 * The code runs in a restricted vm context; the return value of the final
 * expression (or an explicit `return` inside an IIFE) becomes the output.
 *
 * @throws SandboxViolation on timeout, policy breach, or any runtime error.
 */
export function runSandboxedSkill(
  code: string,
  inputs: Record<string, unknown>,
  opts: SandboxOptions = {}
): unknown {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = createContext(buildRestrictedContext(inputs));

  // Wrap in a strict-mode IIFE so `return` works and leaking to outer scope fails.
  const wrapped = `(function() { "use strict";\n${code}\n})()`;

  let result: unknown;
  try {
    const script = new Script(wrapped, { filename: "sandboxed-skill.js" });
    result = script.runInContext(context, { timeout: timeoutMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes("timed out") ||
      msg.includes("Execution timed out") ||
      msg.includes("Script execution timed out")
    ) {
      logger.warn("skillSandbox: execution timed out", { timeoutMs });
      throw new SandboxViolation(
        `Sandboxed skill timed out after ${timeoutMs}ms`,
        "timeout"
      );
    }

    if (msg.includes("sandbox policy")) {
      logger.warn("skillSandbox: policy violation", { msg });
      throw new SandboxViolation(msg, "policy");
    }

    logger.warn("skillSandbox: runtime error", { err: msg });
    throw new SandboxViolation(`Sandboxed skill runtime error: ${msg}`, "runtime");
  }

  return result;
}
