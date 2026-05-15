import { describe, expect, it } from "vitest";

import {
  findSlashCommand,
  parseSlashInput,
  SLASH_COMMANDS,
  SLASH_GROUP_LABELS,
  SPIRIT_COMMANDS,
  suggestSlashCommands,
} from "../shared/slash-commands";

describe("shared/slash-commands", () => {
  describe("SLASH_COMMANDS registry", () => {
    it("contains all 4 agent modes", () => {
      const modes = SLASH_COMMANDS.filter(c => c.group === "mode").map(c => c.name);
      expect(modes).toEqual(expect.arrayContaining(["/auto", "/plan", "/nav", "/ask"]));
    });

    it("contains all 25 spirits as commands", () => {
      const spirits = SLASH_COMMANDS.filter(c => c.group === "spirit");
      expect(spirits.length).toBe(SPIRIT_COMMANDS.length);
      expect(spirits.length).toBe(25);
    });

    it("uses unique command names", () => {
      const names = SLASH_COMMANDS.map(c => c.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("has labels for every group", () => {
      for (const cmd of SLASH_COMMANDS) {
        expect(SLASH_GROUP_LABELS[cmd.group]).toBeTruthy();
      }
    });

    it("marks argument-taking commands explicitly", () => {
      const planCmd = findSlashCommand("/plan");
      expect(planCmd?.takesArgument).toBe(true);
      const homeCmd = findSlashCommand("/home");
      expect(homeCmd?.takesArgument).toBe(false);
    });
  });

  describe("parseSlashInput", () => {
    it("flags non-slash input as non-command", () => {
      const parsed = parseSlashInput("你好光球");
      expect(parsed.isCommand).toBe(false);
      expect(parsed.argument).toBe("你好光球");
      expect(parsed.matched).toBeNull();
    });

    it("matches a known command with arguments", () => {
      const parsed = parseSlashInput("/plan 拍片計畫");
      expect(parsed.isCommand).toBe(true);
      expect(parsed.rawName).toBe("plan");
      expect(parsed.argument).toBe("拍片計畫");
      expect(parsed.matched?.name).toBe("/plan");
    });

    it("matches a command without arguments", () => {
      const parsed = parseSlashInput("/home");
      expect(parsed.matched?.name).toBe("/home");
      expect(parsed.argument).toBe("");
    });

    it("trims surrounding whitespace from arguments", () => {
      const parsed = parseSlashInput("/plan    拍片計畫   ");
      expect(parsed.argument).toBe("拍片計畫");
    });

    it("returns matched=null when the name is unknown but still tags as command", () => {
      const parsed = parseSlashInput("/xyz123 hello");
      expect(parsed.isCommand).toBe(true);
      expect(parsed.matched).toBeNull();
      expect(parsed.rawName).toBe("xyz123");
    });

    it("resolves spirit nickname aliases", () => {
      const parsed = parseSlashInput("/圖圖 賽博龐克貓咪");
      expect(parsed.matched?.action.kind).toBe("send-as-spirit");
      expect(parsed.argument).toBe("賽博龐克貓咪");
    });

    it("resolves Chinese mode aliases", () => {
      const parsed = parseSlashInput("/計畫 這週影片");
      expect(parsed.matched?.name).toBe("/plan");
    });
  });

  describe("suggestSlashCommands", () => {
    it("returns the full list (up to limit) for empty queries", () => {
      const all = suggestSlashCommands("", 100);
      expect(all.length).toBeGreaterThan(20);
      expect(all.length).toBeLessThanOrEqual(SLASH_COMMANDS.length);
    });

    it("ranks prefix matches before substring matches", () => {
      const hits = suggestSlashCommands("pla", 5);
      expect(hits[0]?.name).toBe("/plan");
    });

    it("finds spirit commands by nickname", () => {
      const hits = suggestSlashCommands("圖圖", 5);
      expect(hits[0]?.name).toBe("/image");
    });

    it("finds commands by description keyword", () => {
      const hits = suggestSlashCommands("匯出", 5);
      expect(hits.some(c => c.name === "/export")).toBe(true);
    });

    it("respects the limit argument", () => {
      const hits = suggestSlashCommands("", 3);
      expect(hits.length).toBe(3);
    });
  });

  describe("findSlashCommand", () => {
    it("returns the command object for an exact name", () => {
      expect(findSlashCommand("/plan")?.name).toBe("/plan");
    });

    it("accepts names without the / prefix", () => {
      expect(findSlashCommand("plan")?.name).toBe("/plan");
    });

    it("returns null for unknown commands", () => {
      expect(findSlashCommand("/definitely-not-real")).toBeNull();
    });

    it("matches an alias", () => {
      expect(findSlashCommand("multi-step")?.name).toBe("/auto");
    });
  });
});
