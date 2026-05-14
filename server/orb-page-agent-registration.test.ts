/**
 * orb-page-agent-registration.test.ts
 *
 * Contract tests for the page-agent registration layer:
 *
 * 1. Every entry in APP_PAGE_REGISTRY has required string fields.
 * 2. Pages with supportsPageAgent=true appear in GLOBAL_AGENT_CAPABILITY_REGISTRY.
 * 3. The tutorial-overview page is correctly registered (added in this fix cycle).
 * 4. GLOBAL_AGENT_CAPABILITY_REGISTRY has no duplicate capability IDs.
 * 5. All destructive capability action types expose a non-empty label.
 * 6. All core user-facing pages have supportsPageAgent=true.
 */

import { describe, expect, it } from "vitest";
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";
import {
  GLOBAL_AGENT_CAPABILITY_REGISTRY,
  validateCapabilityRegistry,
} from "../shared/global-agent-capabilities";

// Destructive actions that must always have a non-empty label.
const DESTRUCTIVE_ACTION_TYPES = new Set(["submit", "reset", "applyPreset"]);

// Core pages that must have supportsPageAgent=true.
const REQUIRED_AGENT_PAGES: Array<{ id: string; path: string }> = [
  { id: "home", path: "/" },
  { id: "studio", path: "/studio" },
  { id: "director", path: "/director" },
  { id: "image-studio", path: "/image-studio" },
  { id: "video-studio", path: "/video-studio" },
  { id: "pro-studio", path: "/pro-studio" },
  { id: "tutorial-overview", path: "/tutorial" },
];

// ── APP_PAGE_REGISTRY ────────────────────────────────────────────────────────

describe("APP_PAGE_REGISTRY shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(APP_PAGE_REGISTRY)).toBe(true);
    expect(APP_PAGE_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every entry has required string fields: id, label, path", () => {
    for (const entry of APP_PAGE_REGISTRY) {
      expect(typeof entry.id, `id missing in entry with label="${entry.label}"`).toBe("string");
      expect(entry.id.length, `empty id in entry with label="${entry.label}"`).toBeGreaterThan(0);
      expect(typeof entry.label, `label missing for id="${entry.id}"`).toBe("string");
      expect(entry.label.length, `empty label for id="${entry.id}"`).toBeGreaterThan(0);
      expect(typeof entry.path, `path missing for id="${entry.id}"`).toBe("string");
      expect(entry.path, `path must start with / for id="${entry.id}"`).toMatch(/^\//);
    }
  });

  it("every entry has a boolean supportsPageAgent field", () => {
    for (const entry of APP_PAGE_REGISTRY) {
      expect(typeof entry.supportsPageAgent, `supportsPageAgent must be boolean for id="${entry.id}"`).toBe("boolean");
    }
  });

  it("tutorial-overview is registered with correct path", () => {
    const found = APP_PAGE_REGISTRY.find(e => e.id === "tutorial-overview");
    expect(found, "tutorial-overview must be in APP_PAGE_REGISTRY").toBeDefined();
    expect(found?.path).toBe("/tutorial-overview");
    expect(found?.supportsPageAgent).toBe(true);
  });

  it("each id is unique across the registry", () => {
    const ids = APP_PAGE_REGISTRY.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── Required core pages ──────────────────────────────────────────────────────

describe("Core pages have supportsPageAgent=true", () => {
  for (const { id, path } of REQUIRED_AGENT_PAGES) {
    it(`${id} (${path}) has supportsPageAgent=true`, () => {
      const entry = APP_PAGE_REGISTRY.find(e => e.id === id);
      expect(entry, `${id} not found in APP_PAGE_REGISTRY`).toBeDefined();
      expect(entry?.supportsPageAgent, `${id} must have supportsPageAgent=true`).toBe(true);
    });
  }
});

// ── GLOBAL_AGENT_CAPABILITY_REGISTRY ────────────────────────────────────────

describe("GLOBAL_AGENT_CAPABILITY_REGISTRY", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(GLOBAL_AGENT_CAPABILITY_REGISTRY)).toBe(true);
    expect(GLOBAL_AGENT_CAPABILITY_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has no duplicate capability IDs", () => {
    const { ok, duplicates } = validateCapabilityRegistry(GLOBAL_AGENT_CAPABILITY_REGISTRY);
    expect(duplicates, `Duplicate capability IDs found: ${duplicates.join(", ")}`).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it("every entry has non-empty id, pageId, pagePath, actionType, label", () => {
    for (const cap of GLOBAL_AGENT_CAPABILITY_REGISTRY) {
      expect(cap.id.length, `empty id for cap "${cap.actionType}"`).toBeGreaterThan(0);
      expect(cap.pageId.length, `empty pageId for cap "${cap.id}"`).toBeGreaterThan(0);
      expect(cap.pagePath, `pagePath must start with / for cap "${cap.id}"`).toMatch(/^\//);
      expect(cap.actionType.length, `empty actionType for cap "${cap.id}"`).toBeGreaterThan(0);
      expect(cap.label.length, `empty label for cap "${cap.id}"`).toBeGreaterThan(0);
    }
  });

  it("destructive action types have requiresApproval=true", () => {
    for (const cap of GLOBAL_AGENT_CAPABILITY_REGISTRY) {
      if (DESTRUCTIVE_ACTION_TYPES.has(cap.actionType)) {
        expect(
          cap.requiresApproval,
          `${cap.id} (${cap.actionType}) must have requiresApproval=true`
        ).toBe(true);
      }
    }
  });

  it("includes capability entries for tutorial-overview", () => {
    const tutorialCaps = GLOBAL_AGENT_CAPABILITY_REGISTRY.filter(c => c.pageId === "tutorial-overview");
    expect(tutorialCaps.length, "tutorial-overview should have at least one capability").toBeGreaterThan(0);
  });

  it("every agent-supporting page has at least one capability entry", () => {
    const agentPages = APP_PAGE_REGISTRY.filter(p => p.supportsPageAgent);
    const capPageIds = new Set(GLOBAL_AGENT_CAPABILITY_REGISTRY.map(c => c.pageId));
    for (const page of agentPages) {
      expect(
        capPageIds.has(page.id),
        `${page.id} has supportsPageAgent=true but no entry in GLOBAL_AGENT_CAPABILITY_REGISTRY`
      ).toBe(true);
    }
  });
});

// ── supportedActions ↔ capability drift guard ────────────────────────────────
//
// 這些測試防的是「真實 PageAgent handler 接得了某個 action，但 appRegistry 的
// supportedActions 沒宣告」這種靜默失敗。static-fallback router 用
// supportedActions 決定哪個頁面能處理某個 action；若漂移就會出現「光球說
// 沒人接得了」的假錯誤訊息。詳見 audit-studio-orb-2026-05-14.md O-M3。
describe("supportedActions ↔ capability drift guard", () => {
  it("core agent pages have non-empty supportedActions", () => {
    for (const { id } of REQUIRED_AGENT_PAGES) {
      const entry = APP_PAGE_REGISTRY.find(e => e.id === id);
      expect(entry, `${id} missing from registry`).toBeDefined();
      expect(
        entry!.supportedActions.length,
        `${id} has supportsPageAgent=true but supportedActions is empty — static-fallback router will skip it`
      ).toBeGreaterThan(0);
    }
  });

  it("real-page useRegisterPageAgent capabilities are declared in supportedActions", async () => {
    // 靜態掃描所有 client 頁面的 useRegisterPageAgent({ pageId, capabilities })
    // 呼叫，把每個 capability action 對應回 appRegistry，確認 supportedActions
    // 確實包含該 action。GLOBAL_AGENT_CAPABILITY_REGISTRY 是 cross-product
    // 形式（每頁 × 所有可能動作），無法區分「實際 handler 接得了」與「只是
    // 宣告」；要抓真正的 drift 必須讀 .tsx 原始檔。
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { glob } = await import("glob");
    const REPO_ROOT = path.resolve(__dirname, "..");
    const PAGES_GLOB = path.join(REPO_ROOT, "client/src/pages/**/*.tsx");
    const files = await glob(PAGES_GLOB);
    // navigate / focusElement 由 PageAgentContext 短路（runDispatch 一律先處理
    // navigate / focusElement，不會走 page handler）；其餘必須出現在 supportedActions。
    const SHORT_CIRCUITED = new Set(["navigate", "focusElement"]);
    // 已記載的「intentional exclusion」：頁面 runtime handler 真的接得了某個 action，
    // 但 appRegistry 的 supportedActions 故意不宣告，以免 static-fallback ranker
    // 把該 action 路由到 Hub 而不是真正的目的地。新增條目前請務必在 appRegistry.ts
    // 對應 entry 的註解中說明理由（grep "NOT listed here"）。
    const INTENTIONAL_EXCLUSIONS = new Set([
      "create.setTab",
      "playground.setTab",
    ]);
    const missing: string[] = [];

    for (const file of files) {
      const src = await fs.readFile(file, "utf8");
      // 抓 pageId
      const pageIdMatch = src.match(/useRegisterPageAgent\([^)]*?pageId:\s*["']([^"']+)["']/s);
      if (!pageIdMatch) continue;
      const pageId = pageIdMatch[1];
      const entry = APP_PAGE_REGISTRY.find(p => p.id === pageId);
      if (!entry) {
        missing.push(`${file}: useRegisterPageAgent({pageId:"${pageId}"}) 但 APP_PAGE_REGISTRY 沒這個 id`);
        continue;
      }
      // 抓所有 capabilities[].action — 容忍多種寫法（單引號 / 雙引號 / 雙空白）
      const actionRegex = /\baction:\s*["']([a-zA-Z]+)["']/g;
      let m: RegExpExecArray | null;
      const declared = new Set<string>();
      while ((m = actionRegex.exec(src)) !== null) declared.add(m[1]);
      for (const action of declared) {
        if (SHORT_CIRCUITED.has(action)) continue;
        if (INTENTIONAL_EXCLUSIONS.has(`${pageId}.${action}`)) continue;
        if (!(entry.supportedActions as readonly string[]).includes(action)) {
          missing.push(
            `${pageId} (${path.relative(REPO_ROOT, file)}): handler 宣告 action="${action}" ` +
              `但 appRegistry.supportedActions=${JSON.stringify(entry.supportedActions)} 沒這個 action`
          );
        }
      }
    }

    expect(
      missing,
      `發現 ${missing.length} 處 useRegisterPageAgent / supportedActions 漂移：\n` +
        missing.join("\n")
    ).toEqual([]);
  });
});
