/**
 * tests/unit/shared/global-agent-registry-drift.test.ts
 *
 * 守住 dynamic PageAgentSnapshot 與 static APP_PAGE_REGISTRY 的同步:
 * 任何頁面同時宣告兩處時,pageId / pagePath / supportsPageAgent 必須一致。
 * 若一致性破了,orb 的 static-fallback 路由會把動作丟到錯的頁面、或
 * 完全找不到頁面,結果是「明明 chat 說要去設定頁,點下去卻去了首頁」
 * 這種使用者層級的 bug。
 */

import { describe, expect, it } from "vitest";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import { APP_PAGE_REGISTRY } from "../../../shared/appRegistry";
import {
  GlobalAgentRegistry,
  detectSnapshotDrift,
} from "../../../shared/global-agent-registry";

function buildSnapshot(
  overrides: Partial<PageAgentSnapshot> &
    Pick<PageAgentSnapshot, "pageId" | "pagePath" | "pageLabel">
): PageAgentSnapshot {
  return {
    capabilities: [],
    ...overrides,
  };
}

describe("detectSnapshotDrift", () => {
  it("snapshot 對齊 registry 時回傳 null", () => {
    const home = APP_PAGE_REGISTRY.find(p => p.id === "home");
    expect(home).toBeDefined();
    if (!home) return;
    const snapshot = buildSnapshot({
      pageId: home.id,
      pagePath: home.path,
      pageLabel: home.label,
    });
    expect(detectSnapshotDrift(snapshot)).toBeNull();
  });

  it("pageId 不在 registry 時回報 pageId-not-in-registry", () => {
    const snapshot = buildSnapshot({
      pageId: "definitely-not-in-registry",
      pagePath: "/imaginary",
      pageLabel: "虛構頁",
    });
    const finding = detectSnapshotDrift(snapshot);
    expect(finding?.reason).toBe("pageId-not-in-registry");
    expect(finding?.pageId).toBe("definitely-not-in-registry");
  });

  it("pagePath 與 registry 不一致時回報 pagePath-mismatch", () => {
    const home = APP_PAGE_REGISTRY.find(p => p.id === "home");
    if (!home) return;
    const snapshot = buildSnapshot({
      pageId: home.id,
      pagePath: "/wrong-path",
      pageLabel: home.label,
    });
    const finding = detectSnapshotDrift(snapshot);
    expect(finding?.reason).toBe("pagePath-mismatch");
    expect(finding?.registryPath).toBe(home.path);
    expect(finding?.snapshotPath).toBe("/wrong-path");
  });

  it("APP_PAGE_REGISTRY 內每個 supportsPageAgent=true 的條目都被視為合法 snapshot 來源", () => {
    const offenders: Array<{ id: string; reason: string }> = [];
    for (const page of APP_PAGE_REGISTRY) {
      if (!page.supportsPageAgent) continue;
      const snapshot = buildSnapshot({
        pageId: page.id,
        pagePath: page.path,
        pageLabel: page.label,
      });
      const finding = detectSnapshotDrift(snapshot);
      if (finding) offenders.push({ id: page.id, reason: finding.reason });
    }
    expect(offenders).toEqual([]);
  });

  it("registry 把 supportsPageAgent 設成 false 時回報 pageAgent-disabled-in-registry", () => {
    const disabled = APP_PAGE_REGISTRY.find(p => !p.supportsPageAgent);
    if (!disabled) {
      // 如果未來所有頁都啟用 pageAgent,這個 case 變得 vacuous - 不影響其他驗證
      return;
    }
    const snapshot = buildSnapshot({
      pageId: disabled.id,
      pagePath: disabled.path,
      pageLabel: disabled.label,
    });
    expect(detectSnapshotDrift(snapshot)?.reason).toBe(
      "pageAgent-disabled-in-registry"
    );
  });
});

describe("GlobalAgentRegistry.register", () => {
  it("仍然把 snapshot 寫入索引(drift 警告不擋註冊)", () => {
    const reg = new GlobalAgentRegistry();
    const offending = buildSnapshot({
      pageId: "ghost-page",
      pagePath: "/ghost",
      pageLabel: "幽靈頁",
    });
    // 在 dev 模式會 console.warn 但不應該 throw
    expect(() => reg.register(offending)).not.toThrow();
    expect(reg.get("ghost-page")).toEqual(offending);
  });

  it("registry 對齊的 snapshot 仍可註冊與查詢", () => {
    const reg = new GlobalAgentRegistry();
    const home = APP_PAGE_REGISTRY.find(p => p.id === "home");
    if (!home) return;
    const snapshot = buildSnapshot({
      pageId: home.id,
      pagePath: home.path,
      pageLabel: home.label,
    });
    reg.register(snapshot);
    expect(reg.findByPath(home.path)?.pageId).toBe(home.id);
  });
});
