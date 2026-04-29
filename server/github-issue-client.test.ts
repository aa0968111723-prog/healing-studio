/**
 * GitHub Issue Client — Vitest tests
 * ────────────────────────────────────────────────────────────────────────────
 * Hermetic：透過 setIssueClientFetcher 注入 mock，不會碰真網路。
 *
 * 驗證：
 *   - GITHUB_TOKEN / GITHUB_REPO 未設定 → 回傳結構化 failure（不拋例外）
 *   - 成功路徑解析 number / html_url
 *   - 非 2xx 回應記錄 status & error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./_core/env.validated", () => ({
  serverEnv: {
    GITHUB_TOKEN: "",
    GITHUB_REPO: "",
  },
}));

import {
  createGithubIssue,
  isGithubConfigured,
  setIssueClientFetcher,
} from "./services/githubIssueClient";

afterEach(() => {
  setIssueClientFetcher(null);
});

describe("isGithubConfigured", () => {
  it("returns false when env values are empty", () => {
    expect(isGithubConfigured()).toBe(false);
  });
});

describe("createGithubIssue — failure paths", () => {
  it("returns structured failure when token missing", async () => {
    const result = await createGithubIssue({
      title: "x",
      body: "y",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/GITHUB_TOKEN/);
    }
  });

  it("rejects malformed repo", async () => {
    const result = await createGithubIssue({
      title: "x",
      body: "y",
      token: "ghp_test",
      repo: "not-a-valid-format",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/GITHUB_REPO/);
    }
  });

  it("rejects empty title", async () => {
    const result = await createGithubIssue({
      title: "",
      body: "y",
      token: "ghp_test",
      repo: "owner/repo",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/標題/);
    }
  });

  it("returns status & error when GitHub responds 401", async () => {
    setIssueClientFetcher(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Bad credentials" }), {
            status: 401,
          })
      ) as unknown as typeof fetch
    );
    const result = await createGithubIssue({
      title: "x",
      body: "y",
      token: "ghp_test",
      repo: "owner/repo",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(401);
      expect(result.error).toContain("401");
    }
  });
});

describe("createGithubIssue — success path", () => {
  beforeEach(() => {
    setIssueClientFetcher(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              number: 42,
              url: "https://api.github.com/repos/o/r/issues/42",
              html_url: "https://github.com/o/r/issues/42",
            }),
            { status: 201 }
          )
      ) as unknown as typeof fetch
    );
  });

  it("parses number and html_url from response", async () => {
    const result = await createGithubIssue({
      title: "[AI] fix eval risk",
      body: "## Detail",
      labels: ["ai-proposal", "severity:critical"],
      token: "ghp_test",
      repo: "owner/repo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.number).toBe(42);
      expect(result.htmlUrl).toBe("https://github.com/o/r/issues/42");
    }
  });
});
