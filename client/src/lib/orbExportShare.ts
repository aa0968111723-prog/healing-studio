/**
 * orbExportShare.ts — 客戶端 export / share 動作執行器。
 *
 * 兩個動作不需要伺服器：
 *   - exportChatPdf：開新分頁渲染對話成 HTML，自動觸發列印 → 使用者另存 PDF
 *   - shareViaLink：把 workflow 或聊天歷史打包成 process-spec，產生連結並複製到剪貼簿
 *
 * 純前端，不引入新依賴（避開 jspdf / puppeteer）。
 */

import {
  workflowActionToProcessSpec,
  buildProcessUrl,
  normalizeProcessSpec,
  type ProcessSpec,
  type ProcessStep,
} from "../../../shared/orb-process-link";
import type { RunWorkflowAction } from "../../../shared/agent-actions";
import { getPageLabelByPath } from "@/lib/orbChatHelpers";

export interface ChatMessageForExport {
  role: "user" | "orb";
  text: string;
  at: number;
  intent?: string;
  pagePath?: string;
}

export type ExportScope = "all" | "today" | "this-week";

export interface ExportChatPdfOptions {
  messages: ChatMessageForExport[];
  scope?: ExportScope;
  title?: string;
}

export interface ExportChatPdfResult {
  ok: boolean;
  reason?: string;
  /** Number of messages included in the export. */
  count?: number;
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_RE, ch => HTML_ESCAPE_MAP[ch] ?? ch);
}

function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfThisWeek(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // Monday-start week. JS getDay(): Sun=0, Mon=1, ..., Sat=6
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function filterMessagesByScope(
  messages: ChatMessageForExport[],
  scope: ExportScope = "all",
  now = Date.now()
): ChatMessageForExport[] {
  if (scope === "all") return [...messages];
  const cutoff = scope === "today" ? startOfToday(now) : startOfThisWeek(now);
  return messages.filter(m => m.at >= cutoff);
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export function buildChatExportHtml(
  options: ExportChatPdfOptions,
  now = Date.now()
): { html: string; count: number; title: string } {
  const filtered = filterMessagesByScope(options.messages, options.scope ?? "all", now);
  const title = options.title?.trim() || "光球聊天記錄";
  const scopeLabel =
    options.scope === "today"
      ? "今天"
      : options.scope === "this-week"
      ? "本週"
      : "全部";

  const headerSubtitle = `匯出於 ${formatTime(now)}　·　範圍：${scopeLabel}　·　共 ${filtered.length} 則訊息`;

  const messagesHtml = filtered
    .map(msg => {
      const roleLabel = msg.role === "user" ? "你" : "光球";
      const pageBadge = msg.pagePath
        ? `<span class="page">${escapeHtml(getPageLabelByPath(msg.pagePath) ?? msg.pagePath)}</span>`
        : "";
      const intentBadge = msg.intent
        ? `<div class="intent">意圖：${escapeHtml(msg.intent)}</div>`
        : "";
      return `
        <article class="msg msg-${escapeHtml(msg.role)}">
          <header>
            <span class="role">${escapeHtml(roleLabel)}</span>
            <span class="time">${escapeHtml(formatTime(msg.at))}</span>
            ${pageBadge}
          </header>
          <div class="body">${escapeHtml(msg.text)}</div>
          ${intentBadge}
        </article>
      `;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", -apple-system, system-ui, sans-serif;
      color: #1f2937;
      background: #ffffff;
      margin: 0;
      padding: 32px 40px;
      line-height: 1.6;
    }
    h1 { font-size: 22px; margin: 0 0 4px; color: #0f172a; }
    .subtitle { color: #64748b; font-size: 12px; margin-bottom: 24px; }
    .msg {
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 14px 18px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .msg-user { background: #f8fafc; }
    .msg-orb { background: #fefce8; border-color: #fde68a; }
    .msg header {
      display: flex;
      gap: 10px;
      align-items: center;
      font-size: 12px;
      color: #475569;
      margin-bottom: 6px;
    }
    .msg .role { font-weight: 600; color: #0f172a; }
    .msg .time { color: #94a3b8; }
    .msg .page {
      background: #e0f2fe;
      color: #075985;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 11px;
    }
    .msg .body { white-space: pre-wrap; word-break: break-word; }
    .msg .intent {
      margin-top: 8px;
      padding: 6px 10px;
      background: rgba(15, 23, 42, 0.04);
      border-radius: 8px;
      font-size: 12px;
      color: #475569;
    }
    @media print {
      body { padding: 16mm 14mm; }
      .actions { display: none !important; }
    }
    .actions {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
    }
    .actions button {
      background: #0ea5e9;
      color: #fff;
      border: 0;
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(14, 165, 233, 0.25);
    }
    .actions button.secondary {
      background: #e2e8f0;
      color: #0f172a;
      box-shadow: none;
    }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">列印 / 另存 PDF</button>
    <button class="secondary" onclick="window.close()">關閉</button>
  </div>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(headerSubtitle)}</div>
  ${messagesHtml || '<p style="color:#94a3b8">這個範圍內沒有訊息可以匯出。</p>'}
  <script>
    // 自動帶起列印對話框 — 使用者可選 PDF 印表機另存。
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 350);
    });
  </script>
</body>
</html>`;

  return { html, count: filtered.length, title };
}

export function exportChatToPdf(options: ExportChatPdfOptions): ExportChatPdfResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "no window" };
  }
  const built = buildChatExportHtml(options);
  if (built.count === 0) {
    return { ok: false, reason: "no-messages-in-scope", count: 0 };
  }
  const win = window.open("", "_blank", "noopener=yes,noreferrer=yes,width=820,height=1080");
  if (!win) {
    return { ok: false, reason: "popup-blocked" };
  }
  win.document.open();
  win.document.write(built.html);
  win.document.close();
  return { ok: true, count: built.count };
}

// ─── Share via process link ────────────────────────────────────────────────

export interface ShareViaLinkOptions {
  /** Workflow to share when target = "lastWorkflow". */
  workflow?: RunWorkflowAction | null;
  /** Chat-derived steps when target = "currentChat". */
  chatMessages?: ChatMessageForExport[];
  title?: string;
  /** Origin to prepend (defaults to current origin). */
  origin?: string;
  target: "lastWorkflow" | "currentChat";
}

export interface ShareViaLinkResult {
  ok: boolean;
  reason?: string;
  url?: string;
  copied?: boolean;
  /** Steps actually included in the spec. */
  stepCount?: number;
}

function chatMessagesToProcessSpec(
  messages: ChatMessageForExport[],
  title: string
): ProcessSpec {
  // Pull the orb's structured replies as steps, falling back to user prompts
  // when the orb has nothing concrete. Cap to 12 steps to stay well under the
  // process-spec URL limit (~6 KB JSON).
  const steps: ProcessStep[] = [];
  for (const msg of messages.slice(-30)) {
    if (steps.length >= 12) break;
    const cleaned = msg.text.trim();
    if (!cleaned) continue;
    const stepTitle =
      msg.intent?.trim() ||
      cleaned.split(/[\n。!?！？]/)[0].slice(0, 60) ||
      (msg.role === "user" ? "我說" : "光球回應");
    steps.push({
      title: stepTitle,
      detail: cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned,
      ...(msg.pagePath ? { path: msg.pagePath } : {}),
    });
  }
  return normalizeProcessSpec({
    title: title || "光球對話流程",
    summary: `從聊天記錄整理出的 ${steps.length} 個步驟，可分享給其他人或之後重跑。`,
    emoji: "💬",
    source: "光球 / 全站代理",
    kind: "howto",
    steps,
  });
}

export async function shareViaProcessLink(
  options: ShareViaLinkOptions
): Promise<ShareViaLinkResult> {
  if (typeof window === "undefined") {
    return { ok: false, reason: "no window" };
  }
  let spec: ProcessSpec | null = null;
  if (options.target === "lastWorkflow") {
    if (!options.workflow) {
      return { ok: false, reason: "no-workflow-to-share" };
    }
    spec = workflowActionToProcessSpec(options.workflow, {
      summary: options.title?.trim() || undefined,
    });
  } else {
    const messages = options.chatMessages ?? [];
    if (messages.length === 0) {
      return { ok: false, reason: "no-chat-history-to-share" };
    }
    spec = chatMessagesToProcessSpec(messages, options.title ?? "光球對話流程");
  }

  let url: string;
  try {
    url = buildProcessUrl(spec, {
      origin: options.origin ?? window.location.origin,
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch {
    copied = false;
  }

  return { ok: true, url, copied, stepCount: spec.steps.length };
}
