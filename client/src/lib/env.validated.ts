/**
 * env.validated.ts — Client-side Zod environment variable validation
 *
 * Validates all VITE_* environment variables at app startup.
 * Missing variables produce friendly OARS-style console warnings
 * instead of cryptic runtime errors.
 *
 * Usage: import { clientEnv } from "@/lib/env.validated";
 */

import { z } from "zod";

// ─── Schema ────────────────────────────────────────────────────────────────

const clientSchema = z.object({
  VITE_APP_ID: z.string().min(1).optional().default(""),
  VITE_APP_TITLE: z.string().optional().default(""),
  VITE_APP_LOGO: z.string().optional().default(""),
  VITE_OAUTH_PORTAL_URL: z.string().optional().default(""),
  VITE_API_BASE_URL: z.string().optional().default(""),
  VITE_ANALYTICS_ENDPOINT: z.string().optional().default(""),
  VITE_ANALYTICS_WEBSITE_ID: z.string().optional().default(""),
  VITE_ENABLE_GLOBAL_ORB_EXECUTOR: z.string().optional().default("true"),
  VITE_ENABLE_ORB_MEMORY_PANEL: z.string().optional().default("false"),
  VITE_ENABLE_CLAUDE_CODE_TASKS: z.string().optional().default("true"),
  // ── PostHog 前端追蹤 ─────────────────────────────────────────
  // 兩者皆由 vite.config.ts 在 build time 注入並由 index.html 讀取；
  // 未設定時 init() 會用空字串 → PostHog SDK 會自動跳過 capture
  VITE_POSTHOG_KEY: z.string().optional().default(""),
  VITE_POSTHOG_HOST: z.string().optional().default("https://us.i.posthog.com"),
  // ── 大腦推理鏈視覺化：節點檔案連到 GitHub 原始碼 ───────────────
  // VITE_GITHUB_REPO  例：aa0968111723-prog/healing-studio
  // VITE_GITHUB_REF   分支或 commit SHA；未設則使用 "main"
  VITE_GITHUB_REPO: z
    .string()
    .optional()
    .default("aa0968111723-prog/healing-studio"),
  VITE_GITHUB_REF: z.string().optional().default("main"),
});

// ─── Validation ────────────────────────────────────────────────────────────

function validateClientEnv() {
  const raw = {
    VITE_APP_ID: import.meta.env.VITE_APP_ID,
    VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
    VITE_APP_LOGO: import.meta.env.VITE_APP_LOGO,
    VITE_OAUTH_PORTAL_URL: import.meta.env.VITE_OAUTH_PORTAL_URL,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_ANALYTICS_ENDPOINT: import.meta.env.VITE_ANALYTICS_ENDPOINT,
    VITE_ANALYTICS_WEBSITE_ID: import.meta.env.VITE_ANALYTICS_WEBSITE_ID,
    VITE_ENABLE_GLOBAL_ORB_EXECUTOR: import.meta.env.VITE_ENABLE_GLOBAL_ORB_EXECUTOR,
    VITE_ENABLE_ORB_MEMORY_PANEL: import.meta.env.VITE_ENABLE_ORB_MEMORY_PANEL,
    VITE_ENABLE_CLAUDE_CODE_TASKS: import.meta.env.VITE_ENABLE_CLAUDE_CODE_TASKS,
    VITE_POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY,
    VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
    VITE_GITHUB_REPO: import.meta.env.VITE_GITHUB_REPO,
    VITE_GITHUB_REF: import.meta.env.VITE_GITHUB_REF,
  };

  const result = clientSchema.safeParse(raw);
  const env = result.success ? result.data : clientSchema.parse({});

  // Note: VITE_APP_ID and VITE_OAUTH_PORTAL_URL are legacy Manus OAuth vars.
  // Google OAuth is now the primary auth method and does not require these.

  return env;
}

/** Validated client environment — safe to destructure */
export const clientEnv = validateClientEnv();
