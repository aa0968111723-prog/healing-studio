// @vitest-environment jsdom
/**
 * ConnectionsPanel · ConnectorRow / PendingPill / CategoryCard / AclRulesSummary /
 * statusPillKind / healthCheckLabel（U-12 / AIDV-115 Phase 1 · AIDV-148 Phase 2 整併版）行為測試。
 * 守住路徑：
 *   · 旗標 OFF＝既有列/Badge（不進 .aidv-kit 範圍）；旗標 ON＝design-kit ProviderOption / Pill。
 *   · AIDV-148 合流精華：四值狀態 Pill 映射、狀態 dot a11y、刪除動作、上次健檢時間、
 *     ACL 規則唯讀摘要（AclRulesSummary 純展示、離線可驗）。
 * 只測純展示子元件與純函式；trpc/toast 以最小 mock 隔離。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Cloud } from "lucide-react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import {
  ConnectorRow,
  PendingPill,
  CategoryCard,
  AclRulesSummary,
  statusPillKind,
  healthCheckLabel,
} from "./ConnectionsPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ConnectionsPanel · statusPillKind（AIDV-148 · greenfield HEALTH_PILL 合流）", () => {
  it("真實 status enum 四值映射：active→ok / pending→warn / error→bad / disabled→mute", () => {
    expect(statusPillKind("active")).toBe("ok");
    expect(statusPillKind("pending")).toBe("warn");
    expect(statusPillKind("error")).toBe("bad");
    expect(statusPillKind("disabled")).toBe("mute");
  });
  it("未知 / 缺值 → mute（安全預設）", () => {
    expect(statusPillKind(undefined)).toBe("mute");
    expect(statusPillKind("whatever")).toBe("mute");
  });
});

describe("ConnectionsPanel · healthCheckLabel（上次健檢時間）", () => {
  it("有效 ISO → 帶「上次健檢」前綴", () => {
    const label = healthCheckLabel("2026-07-01T08:00:00.000Z");
    expect(label).toMatch(/^上次健檢 /);
  });
  it("缺值 / 無效 → null（不渲染）", () => {
    expect(healthCheckLabel(null)).toBeNull();
    expect(healthCheckLabel(undefined)).toBeNull();
    expect(healthCheckLabel("not-a-date")).toBeNull();
  });
});

describe("ConnectionsPanel · ConnectorRow（U-12 / AIDV-115 · /settings）", () => {
  it("旗標 OFF：既有列，名稱/狀態/控制項在、未進設計套件範圍；狀態 dot 具 a11y 標籤", () => {
    flags.chrome = false;
    const { container } = render(
      <ConnectorRow name="Google Drive" status="active" onTest={() => {}} onToggle={() => {}} />,
    );
    expect(screen.getByText("Google Drive")).toBeTruthy();
    expect(screen.getByText("測試")).toBeTruthy();
    expect(screen.getByText("停用")).toBeTruthy(); // active → 可停用
    expect(screen.getByRole("img", { name: "啟用中" })).toBeTruthy(); // AIDV-148 a11y dot
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit ProviderOption（進 .aidv-kit 範圍），測試/啟停可觸發", () => {
    flags.chrome = true;
    const onTest = vi.fn();
    const onToggle = vi.fn();
    const { container } = render(
      <ConnectorRow name="Notion" status="disabled" onTest={onTest} onToggle={onToggle} />,
    );
    expect(screen.getByText("Notion")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    fireEvent.click(screen.getByText("測試"));
    expect(onTest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("啟用")); // disabled → 可啟用
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("旗標 ON：四值狀態 Pill 顯示真實狀態文案（error → 連線異常）", () => {
    flags.chrome = true;
    render(<ConnectorRow name="Notion" status="error" onTest={() => {}} onToggle={() => {}} />);
    expect(screen.getByText("連線異常")).toBeTruthy();
  });

  it("刪除動作（AIDV-148 曝露 dataConnections.delete）：有 onDelete 才渲染、點擊觸發（兩版）", () => {
    for (const chrome of [false, true]) {
      cleanup();
      flags.chrome = chrome;
      const onDelete = vi.fn();
      render(
        <ConnectorRow name="Notion" status="active" onTest={() => {}} onToggle={() => {}} onDelete={onDelete} />,
      );
      const btn = screen.getByRole("button", { name: "刪除連接 Notion" });
      fireEvent.click(btn);
      expect(onDelete).toHaveBeenCalledTimes(1);
    }
  });

  it("無 onDelete：不渲染刪除按鈕（加性、預設不變）", () => {
    flags.chrome = false;
    render(<ConnectorRow name="Notion" status="active" onTest={() => {}} onToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: "刪除連接 Notion" })).toBeNull();
  });

  it("lastHealthCheckAt：有值顯示「上次健檢」、缺值不渲染", () => {
    flags.chrome = false;
    render(
      <ConnectorRow
        name="Google Drive"
        status="active"
        lastHealthCheckAt="2026-07-01T08:00:00.000Z"
        onTest={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(/上次健檢/)).toBeTruthy();
    cleanup();
    render(<ConnectorRow name="Google Drive" status="active" onTest={() => {}} onToggle={() => {}} />);
    expect(screen.queryByText(/上次健檢/)).toBeNull();
  });
});

describe("ConnectionsPanel · PendingPill（待接標示）", () => {
  it("旗標 OFF：既有 Badge（待接 · 文案）", () => {
    flags.chrome = false;
    const { container } = render(<PendingPill text="桌機版待建" />);
    expect(screen.getByText(/桌機版待建/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit Pill（進 .aidv-kit 範圍）", () => {
    flags.chrome = true;
    const { container } = render(<PendingPill text="桌機版待建" />);
    expect(screen.getByText("桌機版待建")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

describe("ConnectionsPanel · CategoryCard（5 類）", () => {
  const cloud = { id: "cloud", label: "Google 雲端", icon: Cloud, kind: "cloud", auth: "OAuth", desc: "雲端文件（唯讀）", pending: null };
  const local = { id: "local", label: "本機檔案", icon: Cloud, kind: null, auth: "限桌面 App", desc: "桌機", pending: "桌機版待建" };

  it("待建分類（kind=null）：整類標待接，不渲染連接列", () => {
    flags.chrome = false;
    render(<CategoryCard cat={local} connections={[]} onTest={() => {}} onToggle={() => {}} />);
    expect(screen.getByText("本機檔案")).toBeTruthy();
    expect(screen.getByText(/桌機版待建/)).toBeTruthy();
  });

  it("可建分類但無連接：顯示空狀態", () => {
    flags.chrome = false;
    render(<CategoryCard cat={cloud} connections={[]} onTest={() => {}} onToggle={() => {}} />);
    expect(screen.getByText("尚未連接")).toBeTruthy();
  });

  it("可建分類有連接：渲染連接列（provider 名稱），刪除回呼帶連接 id", () => {
    flags.chrome = false;
    const onDelete = vi.fn();
    render(
      <CategoryCard
        cat={cloud}
        connections={[{ id: 7, kind: "cloud", provider: "google_drive", status: "active" }]}
        onTest={() => {}}
        onToggle={() => {}}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText("Google Drive")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刪除連接 Google Drive" }));
    expect(onDelete).toHaveBeenCalledWith(7);
  });
});

describe("ConnectionsPanel · AclRulesSummary（AIDV-148 · project_data_access_rules 唯讀摘要）", () => {
  it("空規則：中性提示（非錯誤）", () => {
    render(<AclRulesSummary rules={[]} />);
    expect(screen.getByRole("status").textContent).toContain("尚未設定全站");
  });

  it("團隊預設規則：顯示 accessLevel 中文標籤（summary_only → 僅摘要）", () => {
    render(
      <AclRulesSummary
        rules={[{ id: 1, materialId: null, connectionId: null, accessLevel: "summary_only" }]}
      />,
    );
    expect(screen.getByText("團隊預設層級")).toBeTruthy();
    expect(screen.getByText("僅摘要")).toBeTruthy();
  });

  it("連接級規則：顯示「連接 #id」＋層級；素材級規則彙總為條數", () => {
    render(
      <AclRulesSummary
        rules={[
          { id: 1, materialId: null, connectionId: null, accessLevel: "full_reference" },
          { id: 2, materialId: null, connectionId: 42, accessLevel: "none" },
          { id: 3, materialId: 9, connectionId: null, accessLevel: "chunk_access" },
          { id: 4, materialId: 10, connectionId: null, accessLevel: "chunk_access" },
        ]}
      />,
    );
    expect(screen.getByText("連接 #42")).toBeTruthy();
    expect(screen.getByText("不開放")).toBeTruthy();
    expect(screen.getByText(/另有 2 條素材級規則/)).toBeTruthy();
  });

  it("無團隊預設但有其他規則：標示沿用預設", () => {
    render(
      <AclRulesSummary
        rules={[{ id: 2, materialId: null, connectionId: 42, accessLevel: "none" }]}
      />,
    );
    expect(screen.getByText(/未設定，沿用預設/)).toBeTruthy();
  });
});
