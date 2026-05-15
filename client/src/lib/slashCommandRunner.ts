/**
 * client/src/lib/slashCommandRunner.ts — slash command 客戶端執行器
 *
 * 把 shared/slash-commands.ts 裡的 SlashCommandKind 翻譯成既有 context
 * 上的 method call。所有需要與後端對話的指令最終都會走 globalChat.sendMessage
 * 跟既有 mode／spirit 機制，不再開另一條 pipeline。
 *
 * 設計重點：
 *   - context（globalChat / navigate / toast / clearMemory）由 caller 注入 →
 *     便於 unit test，也讓 runner 不直接 import GlobalOrbChatContext（避免循環）
 *   - 解析錯誤、空 argument、未匹配指令的處理都集中在這裡，呼叫端只要
 *     `runSlashCommand(input, ctx)` 並看回傳的 result
 */

import type { OrbChatAttachment as ChatAttachment } from "../../../shared/orb-chat-multimodal";
import {
  findSlashCommand,
  parseSlashInput,
  SLASH_COMMANDS,
  SLASH_GROUP_LABELS,
  type SlashClientAction,
  type SlashCommandMode,
} from "../../../shared/slash-commands";
import { APP_PAGE_REGISTRY } from "../../../shared/appRegistry";

// ─── 上下文型別（caller 注入） ─────────────────────────────────────────────

/**
 * 從 GlobalOrbChat / wouter / trpc 注入的最小依賴。Runner 不關心其他
 * context 欄位，介面越窄越好搬到 web worker / SSR 場景。
 */
export interface SlashCommandContext {
  /**
   * 送一則訊息給光球（透過既有 sendMessage pipeline）。runner 在
   * `send-with-mode` / `send-as-spirit` / `orb-phrase` 都會走這個。
   */
  sendMessage: (
    text: string,
    attachments?: ChatAttachment[],
    options?: { requestedMode?: SlashCommandMode }
  ) => Promise<void>;
  /** 跳路由（wouter setLocation）。 */
  navigate: (path: string) => void;
  /** 打開全站聊天 panel／頁。 */
  openChat: () => void;
  /** 客戶端 toast — 用 sonner 的 wrapper。 */
  toast: {
    info: (msg: string) => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
  /** 清除目前對話訊息（保留分頁）。 */
  resetConversation: () => void;
  /** 新增一個對話分頁（回傳新分頁 id）。 */
  createConversation: (title?: string) => Promise<string>;
  /** 觸發後端清掉偏好記憶；返回 Promise 讓 runner 等到結果。 */
  clearMemory: () => Promise<{ removed: number }>;
  /** 開記憶儀表板（透過 orb-phrase 觸發既有「光球記得我什麼」流程）。 */
  showMemory: () => void;
  /** 列印對話（用 globalChat 內建匯出 PDF action）。 */
  exportChatPdf: () => void;
  /** 分享上一個 workflow（轉接到既有 orb-phrase 流程）。 */
  shareLastWorkflow: () => void;
  /** 開 ⌘K palette（給 / 找不到匹配時的 fallback）。 */
  openCommandPalette: () => void;
}

// ─── 執行結果 ─────────────────────────────────────────────────────────────

export type SlashCommandResult =
  | { status: "ran"; commandName: string }
  | { status: "not-a-command" }
  | { status: "unknown-command"; rawName: string }
  | { status: "missing-argument"; commandName: string; hint: string }
  | { status: "error"; commandName: string; reason: string };

// ─── 工具 ──────────────────────────────────────────────────────────────────

/**
 * 把 /go xxx 的 xxx 比對到 APP_PAGE_REGISTRY 的 path。允許：
 *   - 直接打 path（"/image-studio" / "image-studio"）
 *   - 打 alias 中的關鍵字（"圖像" / "image"）
 *   - 打 label 的前綴
 */
export function resolvePagePathByQuery(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // 1) 直接吻合 path
  const direct = APP_PAGE_REGISTRY.find(
    page => page.path === query || page.path === `/${query}`
  );
  if (direct) return direct.path;
  // 2) id / alias / label 精確比對
  for (const page of APP_PAGE_REGISTRY) {
    if (page.id.toLowerCase() === q) return page.path;
    if (page.label.toLowerCase() === q) return page.path;
    for (const alias of page.aliases) {
      if (alias.toLowerCase() === q) return page.path;
    }
  }
  // 3) 開頭比對（fallback）
  for (const page of APP_PAGE_REGISTRY) {
    if (page.id.toLowerCase().startsWith(q)) return page.path;
    if (page.label.toLowerCase().startsWith(q)) return page.path;
    if (page.aliases.some(alias => alias.toLowerCase().startsWith(q))) {
      return page.path;
    }
  }
  return null;
}

/**
 * 把指令清單分組整理成 markdown 列表 — 給 /help 用。
 * runner 直接把這段塞進 chat 訊息（保持單一資料來源，不另外開 Dialog）。
 */
export function buildHelpMessage(): string {
  const byGroup = new Map<string, typeof SLASH_COMMANDS[number][]>();
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.hidden) continue;
    const list = byGroup.get(cmd.group) ?? [];
    list.push(cmd);
    byGroup.set(cmd.group, list);
  }
  const sections: string[] = ["**Slash 指令清單**"];
  for (const [group, cmds] of byGroup) {
    sections.push(`\n### ${SLASH_GROUP_LABELS[group as keyof typeof SLASH_GROUP_LABELS] ?? group}`);
    for (const cmd of cmds) {
      sections.push(`- \`${cmd.name}\` — ${cmd.description}`);
    }
  }
  sections.push("\n_提示：打 `/` 開啟自動完成；@暱稱 也能直接呼叫精靈。_");
  return sections.join("\n");
}

// ─── 主入口 ───────────────────────────────────────────────────────────────

/**
 * 解析並執行一段使用者輸入。返回值告知呼叫端要不要清掉輸入框 / 顯示錯誤。
 *
 *   - 非指令（不以 / 開頭）→ status: "not-a-command"。caller 自行送 prompt。
 *   - 找不到指令 → 顯示 toast 並回 "unknown-command"。
 *   - 缺參數 → 不執行，回 "missing-argument" 並提示。
 *   - 成功 → 回 "ran"。
 */
export async function runSlashCommand(
  rawInput: string,
  ctx: SlashCommandContext
): Promise<SlashCommandResult> {
  const parsed = parseSlashInput(rawInput);
  if (!parsed.isCommand) {
    return { status: "not-a-command" };
  }
  const cmd = parsed.matched;
  if (!cmd) {
    ctx.toast.error(`找不到指令 /${parsed.rawName}。打 /help 看完整清單。`);
    return { status: "unknown-command", rawName: parsed.rawName };
  }

  if (cmd.takesArgument && !parsed.argument) {
    const hint = cmd.argumentHint ?? "請補上參數";
    ctx.toast.info(`${cmd.name} 需要參數：${hint}`);
    return { status: "missing-argument", commandName: cmd.name, hint };
  }

  try {
    switch (cmd.action.kind) {
      case "send-with-mode": {
        await ctx.sendMessage(parsed.argument, [], {
          requestedMode: cmd.action.mode,
        });
        return { status: "ran", commandName: cmd.name };
      }
      case "send-as-spirit": {
        // 走既有「@暱稱 + 一句話」的 sendMessage pipeline，這樣 server 端
        // selectRoleForIntent + spirit.invoke 都能照舊運作。
        const text = `@${cmd.action.nickname} ${parsed.argument}`;
        await ctx.sendMessage(text);
        return { status: "ran", commandName: cmd.name };
      }
      case "navigate": {
        // /home, /agent, /settings 都是 fixed path；/go 才會用 argument 解析
        let path = cmd.action.path;
        if (!path && parsed.argument) {
          const resolved = resolvePagePathByQuery(parsed.argument);
          if (!resolved) {
            ctx.toast.error(`找不到頁面「${parsed.argument}」。打 /help 看可用頁面。`);
            return {
              status: "error",
              commandName: cmd.name,
              reason: "page-not-found",
            };
          }
          path = resolved;
        }
        if (!path) {
          ctx.toast.error(`${cmd.name} 需要指定頁面`);
          return {
            status: "missing-argument",
            commandName: cmd.name,
            hint: cmd.argumentHint ?? "頁面 id 或關鍵字",
          };
        }
        ctx.navigate(path);
        return { status: "ran", commandName: cmd.name };
      }
      case "orb-phrase": {
        // 確保 chat 是開的，避免使用者只看到 toast 卻沒看到回覆
        ctx.openChat();
        const phrase = parsed.argument
          ? `${cmd.action.phrase}${parsed.argument}`
          : cmd.action.phrase;
        await ctx.sendMessage(phrase);
        return { status: "ran", commandName: cmd.name };
      }
      case "client-action": {
        await runClientAction(cmd.action.action, ctx, parsed.argument);
        return { status: "ran", commandName: cmd.name };
      }
      case "info": {
        ctx.openChat();
        // 直接把 help 內容當成 user 訊息送進對話，再讓 sendMessage 把它顯示出來
        // 不行 — 那會送給 LLM。改成走 orb-phrase 觸發既有「ask-feature」流程。
        if (cmd.action.topic === "help") {
          await ctx.sendMessage(buildHelpMessage(), [], {
            requestedMode: "ask-feature",
          });
        } else if (cmd.action.topic === "spirits") {
          await ctx.sendMessage("列出全部精靈與他們專精的事", [], {
            requestedMode: "ask-feature",
          });
        } else {
          ctx.toast.info("這個自助主題還沒實作");
        }
        return { status: "ran", commandName: cmd.name };
      }
      default: {
        // 編譯期 never check
        const _exhaustive: never = cmd.action;
        return {
          status: "error",
          commandName: cmd.name,
          reason: `unhandled action kind: ${JSON.stringify(_exhaustive)}`,
        };
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    ctx.toast.error(`執行 ${cmd.name} 失敗：${reason}`);
    return { status: "error", commandName: cmd.name, reason };
  }
}

async function runClientAction(
  action: SlashClientAction,
  ctx: SlashCommandContext,
  _argument: string
): Promise<void> {
  switch (action) {
    case "clear-history":
    case "reset-conversation":
      ctx.resetConversation();
      ctx.toast.success("已清空目前對話");
      return;
    case "new-conversation": {
      const id = await ctx.createConversation();
      ctx.toast.success(id ? "已開新對話" : "已開新對話（離線模式）");
      return;
    }
    case "clear-memory": {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "確定要清掉光球記住的所有偏好（風格／平台／用途／模型）嗎？這會讓光球下次重新詢問。"
        );
        if (!ok) return;
      }
      const result = await ctx.clearMemory();
      ctx.toast.success(
        result.removed > 0
          ? `已清掉 ${result.removed} 條偏好記憶，光球會重新詢問`
          : "光球本來就還沒記住任何偏好"
      );
      return;
    }
    case "show-memory":
      ctx.showMemory();
      return;
    case "export-pdf":
      ctx.exportChatPdf();
      return;
    case "share-workflow":
      ctx.shareLastWorkflow();
      return;
    case "open-palette":
      ctx.openCommandPalette();
      return;
    case "open-settings":
      ctx.navigate("/settings");
      return;
    default: {
      const _exhaustive: never = action;
      throw new Error(`未知的客戶端動作: ${String(_exhaustive)}`);
    }
  }
}

export { findSlashCommand };
