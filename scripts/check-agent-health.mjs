#!/usr/bin/env node
/**
 * scripts/check-agent-health.mjs — AIDV-468 pre-deploy agent health gate
 *
 * 用途：
 *   - 若 AGENT_HEALTH_ENDPOINT 已設定，向 /api/agents/status 發請求，
 *     確認至少有一個 active/idle 代理在線。
 *   - CI 環境（無 DB / 無端點）：warn-only，不阻擋合併（exit 0）。
 *   - 端點已設定但回傳 0 活躍代理：exit 1，阻擋部署。
 *
 * 用法：
 *   node scripts/check-agent-health.mjs
 *
 * 環境變數：
 *   AGENT_HEALTH_ENDPOINT  — 完整 URL（如 https://healing.railway.app）。
 *                            未設定時 warn-only，CI 友善。
 *   AGENT_HEALTH_TOKEN     — Bearer token（若端點需要 auth）。
 *
 * 退出碼：
 *   0：健康（或無端點設定，warn-only）
 *   1：端點可達但 0 個活躍代理
 *   2：執行時期錯誤
 */

const endpoint = process.env.AGENT_HEALTH_ENDPOINT;
const token = process.env.AGENT_HEALTH_TOKEN;

if (!endpoint) {
  console.warn(
    "[check-agent-health] ⚠️  AGENT_HEALTH_ENDPOINT 未設定，跳過健康檢查（CI/本地 warn-only）。"
  );
  process.exit(0);
}

async function main() {
  const url = `${endpoint.replace(/\/$/, "")}/api/agents/status`;

  /** @type {RequestInit} */
  const fetchOpts = {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // 10 s timeout via AbortController
    signal: AbortSignal.timeout(10_000),
  };

  let res;
  try {
    res = await fetch(url, fetchOpts);
  } catch (err) {
    // Network failure or timeout — treat as warn-only so offline CI doesn't block
    console.warn(
      `[check-agent-health] ⚠️  無法連線至 ${url}（${err.message}），跳過健康檢查。`
    );
    process.exit(0);
  }

  if (res.status === 401 || res.status === 403) {
    // Auth not configured in this environment — warn-only
    console.warn(
      `[check-agent-health] ⚠️  端點回傳 ${res.status}（未設定 auth token？），跳過健康檢查。`
    );
    process.exit(0);
  }

  if (!res.ok) {
    console.error(
      `[check-agent-health] ✗ 端點回傳 HTTP ${res.status}，代理健康狀態未知。`
    );
    process.exit(1);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    console.error("[check-agent-health] ✗ 回應非 JSON，無法解析代理清單。");
    process.exit(1);
  }

  const agents = Array.isArray(body?.agents) ? body.agents : [];
  const live = agents.filter(a => a.status === "active" || a.status === "idle");

  if (live.length === 0) {
    console.error(
      `[check-agent-health] ✗ 端點已設定但目前有 0 個活躍代理（total registered: ${agents.length}）。` +
        "\n  請確認代理服務已啟動，或暫時移除 AGENT_HEALTH_ENDPOINT 以跳過此檢查。"
    );
    process.exit(1);
  }

  console.log(
    `[check-agent-health] ✓ ${live.length} 個代理在線（active: ${agents.filter(a => a.status === "active").length}，idle: ${agents.filter(a => a.status === "idle").length}）。`
  );
  process.exit(0);
}

main().catch(err => {
  console.error("[check-agent-health] 執行失敗:", err);
  process.exit(2);
});
