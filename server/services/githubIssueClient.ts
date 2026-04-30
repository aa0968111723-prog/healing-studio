/**
 * GitHub Issue Client
 * ────────────────────────────────────────────────────────────────────────────
 * 將 ReflectionProposal 自動建立成 GitHub Issue 的最小客戶端。
 *
 * 環境變數：
 *  - GITHUB_TOKEN：fine-grained PAT 或 GitHub App installation token，需要
 *    Issues: Read & write 權限
 *  - GITHUB_REPO：目標 repository，格式 "owner/repo"
 *
 * 設計：
 *  - 只用 fetch（無 octokit 依賴），保留輕量並避免 Cloudflare Workers / Edge 不相容
 *  - 失敗時回傳結構化結果 { success: false, error }，呼叫者自行決定如何記錄
 *  - 暴露 setIssueClientFetcher 供測試注入（vitest 可避開真網路）
 *
 * 安全：
 *  - 不在錯誤訊息中回傳 token
 *  - 標題與 body 經過長度上限防止 abuse
 */

import * as fs from "fs";
import path from "path";
import { serverEnv } from "../_core/env.validated";

/**
 * 解析 git URL 為 "owner/repo" 格式。
 * 支援：
 *  - https://github.com/owner/repo.git
 *  - git+https://github.com/owner/repo.git
 *  - git@github.com:owner/repo.git
 *  - github.com/owner/repo
 */
export function parseRepoFromUrl(url: string): string | null {
  const cleaned = url.trim().replace(/^git\+/, "").replace(/\.git$/, "");
  // SSH 格式：git@github.com:owner/repo
  const sshMatch = cleaned.match(/^git@[^:]+:([^/]+)\/(.+)$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  // HTTPS / 純路徑格式
  const httpsMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/?#]+)/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
  return null;
}

let cachedDetectedRepo: string | null | undefined = undefined;

/**
 * 嘗試從 package.json 的 repository 欄位偵測 owner/repo。Railway runtime 不會帶
 * `.git` 目錄，但 package.json 一定存在。結果會 cache 在記憶體。
 */
export function detectRepoFromPackageJson(cwd: string = process.cwd()): string | null {
  if (cachedDetectedRepo !== undefined) return cachedDetectedRepo;
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) {
      cachedDetectedRepo = null;
      return null;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      repository?: string | { url?: string };
    };
    const url =
      typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository?.url;
    if (!url) {
      cachedDetectedRepo = null;
      return null;
    }
    cachedDetectedRepo = parseRepoFromUrl(url);
    return cachedDetectedRepo;
  } catch {
    cachedDetectedRepo = null;
    return null;
  }
}

/** 取得目前生效的 repo（env 優先，其次 package.json 自動偵測） */
export function getEffectiveRepo(): string | null {
  if (serverEnv.GITHUB_REPO && serverEnv.GITHUB_REPO.includes("/")) {
    return serverEnv.GITHUB_REPO;
  }
  return detectRepoFromPackageJson();
}

/** 測試用：清掉偵測快取 */
export function _resetRepoDetection(): void {
  cachedDetectedRepo = undefined;
}

export interface GithubIssueRequest {
  title: string;
  body: string;
  labels?: string[];
  /** 可覆寫預設環境的 owner/repo（測試或多 repo 場景） */
  repo?: string;
  /** 覆寫 token（測試用） */
  token?: string;
}

export interface GithubIssueSuccess {
  success: true;
  number: number;
  url: string;
  htmlUrl: string;
}

export interface GithubIssueFailure {
  success: false;
  error: string;
  status?: number;
}

export type GithubIssueResult = GithubIssueSuccess | GithubIssueFailure;

const MAX_TITLE_LEN = 240;
const MAX_BODY_LEN = 60_000; // GitHub 上限 65536，預留 buffer

type Fetcher = typeof fetch;
let injectedFetcher: Fetcher | null = null;

/** 測試注入 — 設為 null 還原真實 fetch */
export function setIssueClientFetcher(fn: Fetcher | null): void {
  injectedFetcher = fn;
}

function getFetcher(): Fetcher {
  return injectedFetcher ?? fetch;
}

/** 是否已設定 GitHub 整合（token + 可解析的 repo） */
export function isGithubConfigured(): boolean {
  return Boolean(serverEnv.GITHUB_TOKEN) && Boolean(getEffectiveRepo());
}

/** 取得管理員用的設定狀態（給 UI 顯示） */
export function getGithubConfigStatus(): {
  hasToken: boolean;
  envRepo: string | null;
  detectedRepo: string | null;
  effectiveRepo: string | null;
  configured: boolean;
} {
  const detectedRepo = detectRepoFromPackageJson();
  const envRepo =
    serverEnv.GITHUB_REPO && serverEnv.GITHUB_REPO.includes("/")
      ? serverEnv.GITHUB_REPO
      : null;
  const effectiveRepo = envRepo ?? detectedRepo;
  return {
    hasToken: Boolean(serverEnv.GITHUB_TOKEN),
    envRepo,
    detectedRepo,
    effectiveRepo,
    configured: Boolean(serverEnv.GITHUB_TOKEN) && Boolean(effectiveRepo),
  };
}

/**
 * 測試 GitHub 連線：嘗試 GET /user 確認 token 是否有效。
 * 用於管理員介面的「測試連線」按鈕。
 */
export async function testGithubConnection(opts?: {
  token?: string;
  repo?: string;
}): Promise<
  | { success: true; login: string; repoAccess: boolean; effectiveRepo: string | null }
  | { success: false; error: string; status?: number }
> {
  const token = opts?.token ?? serverEnv.GITHUB_TOKEN;
  const repo = opts?.repo ?? getEffectiveRepo();
  if (!token) {
    return { success: false, error: "GITHUB_TOKEN 未設定" };
  }
  try {
    const userRes = await getFetcher()("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "HealingStudio-AI-Director/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userRes.ok) {
      const text = await userRes.text().catch(() => "");
      return {
        success: false,
        status: userRes.status,
        error: `GitHub /user 回應 ${userRes.status}: ${text.slice(0, 200)}`,
      };
    }
    const userData = (await userRes.json()) as { login?: string };
    const login = userData.login ?? "(unknown)";

    // 順便驗證 repo 是否可寫入 issues
    let repoAccess = false;
    if (repo && repo.includes("/")) {
      const repoRes = await getFetcher()(
        `https://api.github.com/repos/${repo}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "HealingStudio-AI-Director/1.0",
          },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (repoRes.ok) {
        const repoData = (await repoRes.json()) as {
          permissions?: { push?: boolean; admin?: boolean };
          has_issues?: boolean;
        };
        repoAccess =
          (repoData.has_issues ?? true) &&
          Boolean(repoData.permissions?.push || repoData.permissions?.admin);
      }
    }
    return { success: true, login, repoAccess, effectiveRepo: repo ?? null };
  } catch (err) {
    return {
      success: false,
      error: `連線例外：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 在指定 repo 建立 GitHub Issue。
 * 失敗會回傳結構化結果（不拋例外），方便上游記錄但仍標記 proposal 為 approved。
 */
export async function createGithubIssue(
  req: GithubIssueRequest
): Promise<GithubIssueResult> {
  const token = req.token ?? serverEnv.GITHUB_TOKEN;
  const repo = req.repo ?? getEffectiveRepo();

  if (!token) {
    return {
      success: false,
      error: "GITHUB_TOKEN 未設定，跳過 GitHub Issue 建立",
    };
  }
  if (!repo || !repo.includes("/")) {
    return {
      success: false,
      error: "GITHUB_REPO 未設定或格式錯誤（應為 owner/repo）",
    };
  }

  const title = (req.title ?? "").slice(0, MAX_TITLE_LEN).trim();
  const body = (req.body ?? "").slice(0, MAX_BODY_LEN);
  const labels = (req.labels ?? []).filter(Boolean).slice(0, 10);

  if (!title) {
    return { success: false, error: "Issue 標題為空" };
  }

  const url = `https://api.github.com/repos/${repo}/issues`;

  try {
    const res = await getFetcher()(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "HealingStudio-AI-Director/1.0",
      },
      body: JSON.stringify({ title, body, labels }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        status: res.status,
        error: `GitHub API ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as {
      number?: number;
      url?: string;
      html_url?: string;
    };
    if (typeof data.number !== "number" || !data.html_url) {
      return {
        success: false,
        status: res.status,
        error: "GitHub API 回傳格式異常（缺少 number / html_url）",
      };
    }

    return {
      success: true,
      number: data.number,
      url: data.url ?? data.html_url,
      htmlUrl: data.html_url,
    };
  } catch (err) {
    return {
      success: false,
      error: `GitHub API 例外：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
