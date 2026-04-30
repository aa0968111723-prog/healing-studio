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
  parseRepoFromUrl,
  detectRepoFromPackageJson,
  getEffectiveRepo,
  getGithubConfigStatus,
  testGithubConnection,
  _resetRepoDetection,
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

// ════════════════════════════════════════════════════════════════════════════
// parseRepoFromUrl — accepts the most common git URL formats
// ════════════════════════════════════════════════════════════════════════════

describe("parseRepoFromUrl", () => {
  it("parses https URL with .git suffix", () => {
    expect(parseRepoFromUrl("https://github.com/owner/repo.git")).toBe(
      "owner/repo"
    );
  });
  it("parses git+https URL", () => {
    expect(parseRepoFromUrl("git+https://github.com/owner/repo.git")).toBe(
      "owner/repo"
    );
  });
  it("parses SSH URL", () => {
    expect(parseRepoFromUrl("git@github.com:owner/repo.git")).toBe(
      "owner/repo"
    );
  });
  it("parses URL without .git", () => {
    expect(parseRepoFromUrl("https://github.com/owner/repo")).toBe(
      "owner/repo"
    );
  });
  it("returns null for non-github URL", () => {
    expect(parseRepoFromUrl("https://example.com/foo/bar")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// detectRepoFromPackageJson — reads from package.json#repository
// ════════════════════════════════════════════════════════════════════════════

describe("detectRepoFromPackageJson", () => {
  it("reads owner/repo from package.json#repository.url", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ghdetect-"));
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "x",
        repository: { type: "git", url: "git+https://github.com/foo/bar.git" },
      })
    );
    _resetRepoDetection();
    expect(detectRepoFromPackageJson(tmp)).toBe("foo/bar");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns null when no package.json present", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ghdetect-empty-"));
    _resetRepoDetection();
    expect(detectRepoFromPackageJson(tmp)).toBeNull();
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getEffectiveRepo / getGithubConfigStatus — merge env + auto-detect
// ════════════════════════════════════════════════════════════════════════════

describe("getEffectiveRepo / getGithubConfigStatus", () => {
  it("falls back to package.json repository when env is empty", () => {
    _resetRepoDetection();
    // Running from repo root → package.json#repository is set → detectedRepo
    // is non-null. This proves auto-detect works for production deployments
    // where users only need to set GITHUB_TOKEN.
    const status = getGithubConfigStatus();
    expect(status.hasToken).toBe(false);
    expect(status.envRepo).toBeNull();
    expect(status.detectedRepo).toMatch(/.+\/.+/);
    expect(status.effectiveRepo).toBe(status.detectedRepo);
    // configured still false because token is missing
    expect(status.configured).toBe(false);
    expect(getEffectiveRepo()).toBe(status.detectedRepo);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// testGithubConnection — validates token + repo permissions
// ════════════════════════════════════════════════════════════════════════════

describe("testGithubConnection", () => {
  it("fails fast when no token", async () => {
    const result = await testGithubConnection({});
    expect(result.success).toBe(false);
  });

  it("returns login + repoAccess on success", async () => {
    let calls = 0;
    setIssueClientFetcher(
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        calls++;
        if (url.endsWith("/user")) {
          return new Response(JSON.stringify({ login: "octocat" }), {
            status: 200,
          });
        }
        if (url.includes("/repos/")) {
          return new Response(
            JSON.stringify({
              has_issues: true,
              permissions: { push: true, admin: false },
            }),
            { status: 200 }
          );
        }
        return new Response("not mocked", { status: 500 });
      }) as unknown as typeof fetch
    );

    const result = await testGithubConnection({
      token: "ghp_test",
      repo: "octocat/hello",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.login).toBe("octocat");
      expect(result.repoAccess).toBe(true);
      expect(result.effectiveRepo).toBe("octocat/hello");
    }
    expect(calls).toBe(2);
  });

  it("propagates 401 from /user", async () => {
    setIssueClientFetcher(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Bad credentials" }), {
            status: 401,
          })
      ) as unknown as typeof fetch
    );
    const result = await testGithubConnection({
      token: "ghp_bad",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(401);
    }
  });
});
