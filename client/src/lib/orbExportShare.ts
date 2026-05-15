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
import type {
  PageAgentSnapshot,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
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
  /**
   * Page agent snapshot to read when target = "studioState".
   * The studio page registers prompt / modality / model / per-modality
   * params under `snapshot.state` — we package those into the spec
   * without needing the LLM round-trip.
   */
  studioSnapshot?: PageAgentSnapshot | null;
  title?: string;
  /** Origin to prepend (defaults to current origin). */
  origin?: string;
  target: "lastWorkflow" | "currentChat" | "studioState";
}

export interface ShareViaLinkResult {
  ok: boolean;
  reason?: string;
  url?: string;
  copied?: boolean;
  /** Steps actually included in the spec. */
  stepCount?: number;
}

const STUDIO_MODALITY_LABEL: Record<
  string,
  { label: string; emoji: string }
> = {
  image: { label: "圖片", emoji: "🎨" },
  video: { label: "影片", emoji: "🎬" },
  audio: { label: "音樂", emoji: "🎵" },
  voice: { label: "配音", emoji: "🎤" },
};

function stateString(state: Record<string, unknown>, key: string): string | null {
  const value = state[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "(空)" || trimmed === "(無)") return null;
    return trimmed;
  }
  return null;
}

function stateNumber(state: Record<string, unknown>, key: string): number | null {
  const value = state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stateBoolean(state: Record<string, unknown>, key: string): boolean | null {
  const value = state[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Build a process spec describing the studio's current setup so the user can
 * share / bookmark it without first having to run a workflow. Reads
 * `snapshot.state` (registered by `Studio.tsx`'s `useRegisterPageAgent`) for
 * the prompt, modality, model and per-modality parameters.
 *
 * Returns the spec even when most fields are empty — the viewer will surface
 * the gaps explicitly (e.g. "提示詞：(尚未輸入)") so the recipient knows what
 * to fill in.
 */
export function studioSnapshotToProcessSpec(
  snapshot: PageAgentSnapshot | null | undefined,
  title?: string
): ProcessSpec {
  const state = (snapshot?.state ?? {}) as Record<string, unknown>;
  const rawModality = stateString(state, "activeModality") ?? "image";
  const mod = STUDIO_MODALITY_LABEL[rawModality] ?? STUDIO_MODALITY_LABEL.image;
  const pagePath = snapshot?.pagePath ?? "/studio";

  const steps: ProcessStep[] = [];

  steps.push({
    title: `${mod.emoji} 模態：${mod.label}`,
    detail: `當前模態為${mod.label}（${rawModality}）`,
    path: pagePath,
  });

  const prompt = stateString(state, "promptPreview") ?? stateString(state, "prompt");
  steps.push({
    title: "📝 提示詞",
    detail: prompt ?? "(尚未輸入)",
  });

  const model = stateString(state, "selectedModelId") ?? stateString(state, "activeModel");
  if (model) {
    steps.push({ title: "🧠 模型", detail: model });
  }

  const mode = stateString(state, "mode");
  if (mode) steps.push({ title: "⚡ 生成模式", detail: mode });
  const creativeMode = stateString(state, "creativeMode");
  if (creativeMode) steps.push({ title: "🎚️ 創作層級", detail: creativeMode });

  if (rawModality === "image") {
    const aspectRatio = stateString(state, "aspectRatio");
    if (aspectRatio) steps.push({ title: "📐 畫面比例", detail: aspectRatio });
    const negativePrompt = stateString(state, "negativePrompt");
    if (negativePrompt) steps.push({ title: "🚫 負面提示", detail: negativePrompt });
  } else if (rawModality === "video") {
    const duration = stateNumber(state, "duration");
    if (duration !== null) steps.push({ title: "⏱️ 時長", detail: `${duration} 秒` });
    const pan = stateString(state, "cameraPan");
    if (pan) steps.push({ title: "🎥 鏡頭 - 平移", detail: pan });
    const zoom = stateString(state, "cameraZoom");
    if (zoom) steps.push({ title: "🎥 鏡頭 - 縮放", detail: zoom });
    const tilt = stateString(state, "cameraTilt");
    if (tilt) steps.push({ title: "🎥 鏡頭 - 俯仰", detail: tilt });
  } else if (rawModality === "audio") {
    const style = stateString(state, "musicStyle");
    if (style) steps.push({ title: "🎼 音樂風格", detail: style });
    const duration = stateNumber(state, "duration");
    if (duration !== null) steps.push({ title: "⏱️ 時長", detail: `${duration} 秒` });
    const energy = stateString(state, "energy");
    if (energy) steps.push({ title: "🔥 能量", detail: energy });
    const isInstrumental = stateBoolean(state, "isInstrumental");
    if (isInstrumental !== null) {
      steps.push({
        title: "🎙️ 純樂器",
        detail: isInstrumental ? "是（沒有歌詞）" : "否（包含歌詞）",
      });
    }
  } else if (rawModality === "voice") {
    const voiceActor = stateString(state, "voiceActorId");
    if (voiceActor) steps.push({ title: "🗣️ 語音角色", detail: voiceActor });
    const speed = stateNumber(state, "speed");
    if (speed !== null) steps.push({ title: "🐇 語速", detail: String(speed) });
    const stability = stateNumber(state, "stability");
    if (stability !== null) steps.push({ title: "🪨 穩定度", detail: String(stability) });
    const emotion = stateString(state, "emotionType");
    if (emotion) steps.push({ title: "💗 情緒", detail: emotion });
    const intensity = stateNumber(state, "emotionIntensity");
    if (intensity !== null) {
      steps.push({ title: "📈 情緒強度", detail: String(intensity) });
    }
  }

  const temperature = stateNumber(state, "temperature");
  if (temperature !== null) {
    steps.push({ title: "🌡️ 溫度", detail: String(temperature) });
  }
  const seed = stateString(state, "seed");
  if (seed && seed !== "(隨機)") {
    steps.push({ title: "🌱 種子", detail: seed });
  }
  const loraWeight = stateNumber(state, "loraWeight");
  if (loraWeight !== null && loraWeight !== 1) {
    steps.push({ title: "🎛️ LoRA 權重", detail: String(loraWeight) });
  }

  return normalizeProcessSpec({
    title: title?.trim() || `${mod.label}創作參數`,
    summary: `創作工作室目前的 ${mod.label}生成設定。開啟連結可以照著步驟還原參數，也能分享給其他人。`,
    emoji: mod.emoji,
    source: "創作工作室 / API 深度連結",
    kind: "howto",
    steps,
  });
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
  } else if (options.target === "studioState") {
    spec = studioSnapshotToProcessSpec(options.studioSnapshot ?? null, options.title);
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
