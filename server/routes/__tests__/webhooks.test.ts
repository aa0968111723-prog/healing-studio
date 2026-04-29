import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plannerMock = vi.fn();
const orchestratorMock = vi.fn();

vi.mock("../../services/agentPlanner", () => ({
  runSchemaFirstAgentPlanner: (...args: unknown[]) => plannerMock(...args),
}));

vi.mock("../../services/orbTaskOrchestrator", () => ({
  executeCurrentStepTools: (...args: unknown[]) => orchestratorMock(...args),
}));

vi.mock("../../config/orbToolRegistry", () => ({
  getOrbToolRegistry: () => [],
}));

import { webhooksRouter } from "../webhooks";

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhooksRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("webhooks /api/webhooks/orb", () => {
  beforeEach(() => {
    process.env.ORB_WEBHOOK_SECRET = "correct-secret";
    plannerMock.mockReset();
    orchestratorMock.mockReset();
    plannerMock.mockResolvedValue({ status: "tasked", task: { taskId: "plan-task", intent: "x", steps: [{ id: "s1", label: "step", uiActions: [], toolCalls: [] }], needsApproval: false } });
    orchestratorMock.mockResolvedValue({ attempted: false, toolResults: [], ok: true });
  });

  afterEach(() => {
    delete process.env.ORB_WEBHOOK_SECRET;
  });

  it("returns 401 for wrong secret", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhooks/orb`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookSecret: "wrong", userId: 1, taskDescription: "do thing" }),
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it("returns 202 and taskId for correct secret", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhooks/orb`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookSecret: "correct-secret", userId: 1, taskDescription: "do thing" }),
    });
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(typeof body.taskId).toBe("string");
    expect(body.taskId.length).toBeGreaterThan(0);
    server.close();
  });

  it("includes rate limit headers", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhooks/orb`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookSecret: "correct-secret", userId: 1, taskDescription: "do thing" }),
    });
    expect(res.headers.get("ratelimit-limit")).toBeTruthy();
    server.close();
  });
});
