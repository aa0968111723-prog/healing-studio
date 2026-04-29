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

import { serverEnv } from "../_core/env.validated";

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

/** 是否已設定 GitHub 整合 */
export function isGithubConfigured(): boolean {
  return Boolean(serverEnv.GITHUB_TOKEN) && Boolean(serverEnv.GITHUB_REPO);
}

/**
 * 在指定 repo 建立 GitHub Issue。
 * 失敗會回傳結構化結果（不拋例外），方便上游記錄但仍標記 proposal 為 approved。
 */
export async function createGithubIssue(
  req: GithubIssueRequest
): Promise<GithubIssueResult> {
  const token = req.token ?? serverEnv.GITHUB_TOKEN;
  const repo = req.repo ?? serverEnv.GITHUB_REPO;

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
