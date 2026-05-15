import { describe, expect, it, vi } from "vitest";

import {
  buildHelpMessage,
  resolvePagePathByQuery,
  runSlashCommand,
  type SlashCommandContext,
} from "../client/src/lib/slashCommandRunner";

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    sendMessage: vi.fn(async () => {}),
    navigate: vi.fn(),
    openChat: vi.fn(),
    toast: {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
    resetConversation: vi.fn(),
    createConversation: vi.fn(async () => "conv-id"),
    clearMemory: vi.fn(async () => ({ removed: 0 })),
    showMemory: vi.fn(),
    exportChatPdf: vi.fn(),
    shareLastWorkflow: vi.fn(),
    openCommandPalette: vi.fn(),
    ...overrides,
  };
}

describe("slashCommandRunner.runSlashCommand", () => {
  it("returns not-a-command for plain prompts", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("你好光球", ctx);
    expect(result.status).toBe("not-a-command");
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  it("warns and bails on unknown commands", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/whatever", ctx);
    expect(result.status).toBe("unknown-command");
    expect(ctx.toast.error).toHaveBeenCalled();
  });

  it("blocks when an argument-requiring command has no argument", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/plan", ctx);
    expect(result.status).toBe("missing-argument");
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a message with the requested mode for /plan", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/plan 拍片計畫", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.sendMessage).toHaveBeenCalledWith(
      "拍片計畫",
      [],
      { requestedMode: "plan" }
    );
  });

  it("converts spirit slash commands to @nickname prompts", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/image 賽博龐克貓咪", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.sendMessage).toHaveBeenCalledWith("@圖圖 賽博龐克貓咪");
  });

  it("navigates for static path commands", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/home", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.navigate).toHaveBeenCalledWith("/");
  });

  it("/go resolves a page query against the registry", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/go image-studio", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.navigate).toHaveBeenCalledWith("/image-studio");
  });

  it("/go reports an error when the page can't be resolved", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/go 不存在的頁", ctx);
    expect(result.status).toBe("error");
    expect(ctx.toast.error).toHaveBeenCalled();
  });

  it("client actions like /clear call resetConversation without sending a message", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/clear", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.resetConversation).toHaveBeenCalled();
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  it("/new creates a new conversation", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/new", ctx);
    expect(ctx.createConversation).toHaveBeenCalled();
  });

  it("/export triggers PDF export", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/export", ctx);
    expect(ctx.exportChatPdf).toHaveBeenCalled();
  });

  it("/share triggers shareLastWorkflow", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/share", ctx);
    expect(ctx.shareLastWorkflow).toHaveBeenCalled();
  });

  it("/memory opens memory dashboard", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/memory", ctx);
    expect(ctx.showMemory).toHaveBeenCalled();
  });

  it("/search routes to orb-phrase with prefix", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/search 森林背景", ctx);
    expect(ctx.openChat).toHaveBeenCalled();
    expect(ctx.sendMessage).toHaveBeenCalledWith("找我之前的素材：森林背景");
  });

  it("/help sends a curated help message in ask-feature mode", async () => {
    const ctx = makeCtx();
    await runSlashCommand("/help", ctx);
    expect(ctx.sendMessage).toHaveBeenCalled();
    const [text, , options] = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof text).toBe("string");
    expect(text).toContain("Slash");
    expect(options).toEqual({ requestedMode: "ask-feature" });
  });

  it("Chinese aliases work end-to-end", async () => {
    const ctx = makeCtx();
    const result = await runSlashCommand("/計畫 本週影片", ctx);
    expect(result.status).toBe("ran");
    expect(ctx.sendMessage).toHaveBeenCalledWith(
      "本週影片",
      [],
      { requestedMode: "plan" }
    );
  });

  it("captures runtime errors thrown by sendMessage", async () => {
    const ctx = makeCtx({
      sendMessage: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const result = await runSlashCommand("/plan 任何事", ctx);
    expect(result.status).toBe("error");
    expect(ctx.toast.error).toHaveBeenCalled();
  });
});

describe("resolvePagePathByQuery", () => {
  it("matches an exact path", () => {
    expect(resolvePagePathByQuery("/image-studio")).toBe("/image-studio");
  });

  it("matches a path without leading slash", () => {
    expect(resolvePagePathByQuery("image-studio")).toBe("/image-studio");
  });

  it("matches a page id", () => {
    expect(resolvePagePathByQuery("image-studio")).toBe("/image-studio");
  });

  it("returns null for blank input", () => {
    expect(resolvePagePathByQuery("")).toBeNull();
    expect(resolvePagePathByQuery("   ")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(resolvePagePathByQuery("totally-not-a-page-xyz")).toBeNull();
  });
});

describe("buildHelpMessage", () => {
  it("includes all command groups", () => {
    const text = buildHelpMessage();
    expect(text).toContain("代理模式");
    expect(text).toContain("精靈呼叫");
    expect(text).toContain("頁面跳轉");
    expect(text).toContain("/plan");
    expect(text).toContain("/image");
  });
});
