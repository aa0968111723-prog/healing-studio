import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../_core/env.validated.js", () => ({
  serverEnv: { AGENT_SIGNING_KEY: "" },
}));

import * as envMod from "../_core/env.validated.js";

import {
  isAgentAuthConfigured,
  issueAgentToken,
  verifyAgentToken,
  parseAgentChainHeader,
  formatAgentChainHeader,
  AGENT_ISSUER,
  AGENT_AUDIENCE_PREFIX,
  AGENT_TOKEN_EXPIRES_SECONDS,
} from "./agentToken.js";

function setKey(key: string) {
  (envMod.serverEnv as Record<string, unknown>).AGENT_SIGNING_KEY = key;
}

describe("isAgentAuthConfigured", () => {
  afterEach(() => setKey(""));

  it("returns false when key is empty string", () => {
    setKey("");
    expect(isAgentAuthConfigured()).toBe(false);
  });

  it("returns true when key is set", () => {
    setKey("supersecret32charskeyXXXXXXXXXX");
    expect(isAgentAuthConfigured()).toBe(true);
  });
});

describe("issueAgentToken / verifyAgentToken", () => {
  const KEY = "testkey-32chars-exactly-XXXXXXXXX";

  beforeEach(() => setKey(KEY));
  afterEach(() => setKey(""));

  it("throws PRECONDITION_FAILED when key not configured", async () => {
    setKey("");
    await expect(
      issueAgentToken({ issuerId: "orch", targetAgentId: "script-agent", taskId: "t1" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("verifyAgentToken throws PRECONDITION_FAILED when key not configured", async () => {
    const token = await issueAgentToken({ issuerId: "orch", targetAgentId: "script-agent", taskId: "t1" });
    setKey("");
    await expect(verifyAgentToken(token, "script-agent")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("issues a JWT and verifies it successfully", async () => {
    const token = await issueAgentToken({
      issuerId: "orchestrator",
      targetAgentId: "script-agent",
      taskId: "task-42",
      existingChain: ["upstream"],
    });

    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const result = await verifyAgentToken(token, "script-agent");
    expect(result.issuerId).toBe("orchestrator");
    expect(result.targetAgentId).toBe("script-agent");
    expect(result.taskId).toBe("task-42");
    expect(result.chain).toEqual(["upstream", "orchestrator"]);
  });

  it("builds chain correctly when existingChain is omitted", async () => {
    const token = await issueAgentToken({
      issuerId: "orch",
      targetAgentId: "agent-b",
      taskId: "t99",
    });
    const result = await verifyAgentToken(token, "agent-b");
    expect(result.chain).toEqual(["orch"]);
  });

  it("throws on wrong audience", async () => {
    const token = await issueAgentToken({
      issuerId: "orch",
      targetAgentId: "agent-a",
      taskId: "t1",
    });
    await expect(verifyAgentToken(token, "agent-b")).rejects.toThrow();
  });

  it("throws on tampered token", async () => {
    const token = await issueAgentToken({
      issuerId: "orch",
      targetAgentId: "agent-a",
      taskId: "t1",
    });
    const parts = token.split(".");
    const tampered = parts[0] + "." + parts[1] + ".invalidsig";
    await expect(verifyAgentToken(tampered, "agent-a")).rejects.toThrow();
  });

  it("throws on expired token", async () => {
    vi.useFakeTimers();
    const token = await issueAgentToken({ issuerId: "orch", targetAgentId: "agent-x", taskId: "t1" });
    vi.advanceTimersByTime((AGENT_TOKEN_EXPIRES_SECONDS + 10) * 1000);
    await expect(verifyAgentToken(token, "agent-x")).rejects.toThrow();
    vi.useRealTimers();
  });
});

describe("parseAgentChainHeader / formatAgentChainHeader", () => {
  it("returns [] for undefined", () => {
    expect(parseAgentChainHeader(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseAgentChainHeader("")).toEqual([]);
  });

  it("parses comma-separated chain", () => {
    expect(parseAgentChainHeader("orchestrator, script-agent, sub-agent")).toEqual([
      "orchestrator",
      "script-agent",
      "sub-agent",
    ]);
  });

  it("round-trips format→parse", () => {
    const chain = ["a", "b", "c"];
    expect(parseAgentChainHeader(formatAgentChainHeader(chain))).toEqual(chain);
  });
});

describe("constants", () => {
  it("AGENT_TOKEN_EXPIRES_SECONDS is 300", () => {
    expect(AGENT_TOKEN_EXPIRES_SECONDS).toBe(300);
  });

  it("AGENT_ISSUER matches expected value", () => {
    expect(AGENT_ISSUER).toBe("healing-studio:agent-orchestrator");
  });

  it("AGENT_AUDIENCE_PREFIX is a2a:", () => {
    expect(AGENT_AUDIENCE_PREFIX).toBe("a2a:");
  });
});
