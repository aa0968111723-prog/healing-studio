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
  VITE_ANALYTICS_ENDPOINT: z.string().optional().default(""),
  VITE_ANALYTICS_WEBSITE_ID: z.string().optional().default(""),
  VITE_ENABLE_GLOBAL_ORB_EXECUTOR: z.string().optional().default("true"),
  VITE_ENABLE_ORB_MEMORY_PANEL: z.string().optional().default("false"),
  VITE_ENABLE_CLAUDE_CODE_TASKS: z.string().optional().default("true"),
});

// ─── Validation ────────────────────────────────────────────────────────────

function validateClientEnv() {
  const raw = {
    VITE_APP_ID: import.meta.env.VITE_APP_ID,
    VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
    VITE_APP_LOGO: import.meta.env.VITE_APP_LOGO,
    VITE_OAUTH_PORTAL_URL: import.meta.env.VITE_OAUTH_PORTAL_URL,
    VITE_ANALYTICS_ENDPOINT: import.meta.env.VITE_ANALYTICS_ENDPOINT,
    VITE_ANALYTICS_WEBSITE_ID: import.meta.env.VITE_ANALYTICS_WEBSITE_ID,
    VITE_ENABLE_GLOBAL_ORB_EXECUTOR: import.meta.env.VITE_ENABLE_GLOBAL_ORB_EXECUTOR,
    VITE_ENABLE_ORB_MEMORY_PANEL: import.meta.env.VITE_ENABLE_ORB_MEMORY_PANEL,
    VITE_ENABLE_CLAUDE_CODE_TASKS: import.meta.env.VITE_ENABLE_CLAUDE_CODE_TASKS,
  };

  const result = clientSchema.safeParse(raw);
  const env = result.success ? result.data : clientSchema.parse({});

  // Warn about critical missing client vars
  const criticalVars: Array<[string, string, string]> = [
    ["VITE_APP_ID", env.VITE_APP_ID, "OAuth 登入功能"],
    ["VITE_OAUTH_PORTAL_URL", env.VITE_OAUTH_PORTAL_URL, "OAuth 登入跳轉"],
  ];

  const missing = criticalVars.filter(([, value]) => !value);
  if (missing.length > 0 && import.meta.env.DEV) {
    console.warn(
      "%c⚠️ 前端環境變數缺失提醒",
      "color: #f59e0b; font-weight: bold; font-size: 14px;"
    );
    for (const [name, , module] of missing) {
      console.warn(
        `  ◦ %c${name}%c — ${module} 將無法正常運作`,
        "color: #ef4444; font-weight: bold;",
        "color: inherit;"
      );
    }
    console.warn(
      "  💡 請在 Manus 管理介面「Settings → Secrets」中設定，或於 .env 檔案中配置。"
    );
  }

  return env;
}

/** Validated client environment — safe to destructure */
export const clientEnv = validateClientEnv();
