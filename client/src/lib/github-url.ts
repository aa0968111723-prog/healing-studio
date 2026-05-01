/**
 * GitHub blob URL resolver — turns repo-relative file paths emitted by the
 * brain pipeline graph into clickable GitHub source links.
 *
 * Configured via `VITE_GITHUB_REPO` (e.g. "aa0968111723-prog/healing-studio")
 * and `VITE_GITHUB_REF` (branch name or commit SHA, defaults to "main").
 *
 * The graph emits paths in repo-relative form (e.g. "server/routers/brain.ts");
 * this helper builds `https://github.com/<repo>/blob/<ref>/<path>` and supports
 * optional line-range fragments (`#L42-L60`).
 */

import { clientEnv } from "@/lib/env.validated";

const GITHUB_BASE = "https://github.com";

/** Returns true when GitHub linking is configured. */
export function isGithubLinkingEnabled(): boolean {
  return Boolean(clientEnv.VITE_GITHUB_REPO);
}

/**
 * Build a GitHub blob URL for a repo-relative file path.
 *
 * Returns `null` when:
 * - The repo env var is unset (rendering should fall back to plain text)
 * - The path looks like a non-file marker (e.g. `.env (FAL_API_KEY)`,
 *   `trpc.imageStudio.*`) — these are diagnostic strings, not source files.
 */
export function fileToGithubUrl(
  pathOrMarker: string,
  opts?: { line?: number; endLine?: number }
): string | null {
  if (!isGithubLinkingEnabled()) return null;
  if (!isLikelyRepoFilePath(pathOrMarker)) return null;

  const repo = clientEnv.VITE_GITHUB_REPO;
  const ref = clientEnv.VITE_GITHUB_REF || "main";
  const cleanPath = pathOrMarker.replace(/^\/+/, "");

  let url = `${GITHUB_BASE}/${repo}/blob/${ref}/${cleanPath}`;
  if (opts?.line) {
    url += `#L${opts.line}`;
    if (opts.endLine && opts.endLine !== opts.line) {
      url += `-L${opts.endLine}`;
    }
  }
  return url;
}

/**
 * Heuristic: paths that look like real repo files vs. diagnostic markers.
 * Excludes things like `.env (FAL_API_KEY)`, `trpc.foo.*`, `unmapped service`.
 */
function isLikelyRepoFilePath(value: string): boolean {
  if (!value) return false;
  if (value.includes(" ")) return false; // diagnostic string with parenthetical
  if (value.startsWith("trpc.")) return false; // tRPC namespace
  if (!value.includes("/")) return false; // bare token, not a path
  if (!/\.[a-zA-Z0-9]+$/.test(value)) return false; // must end with extension
  return true;
}

/** GitHub-friendly link to the repo root (sidebar / footer use). */
export function repoRootUrl(): string | null {
  if (!isGithubLinkingEnabled()) return null;
  return `${GITHUB_BASE}/${clientEnv.VITE_GITHUB_REPO}`;
}

/** Link to the current branch tree (for "see live source" CTAs). */
export function currentRefUrl(): string | null {
  if (!isGithubLinkingEnabled()) return null;
  const repo = clientEnv.VITE_GITHUB_REPO;
  const ref = clientEnv.VITE_GITHUB_REF || "main";
  return `${GITHUB_BASE}/${repo}/tree/${ref}`;
}
