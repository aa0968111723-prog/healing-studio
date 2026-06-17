// @vitest-environment jsdom
/**
 * ConnectionsPanel · ConnectorRow / PendingPill / CategoryCard（U-12 / AIDV-115 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有列/Badge＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit ProviderOption / Pill（進 .aidv-kit 範圍；測試/啟停控制項都保留）。
 * 只測純展示子元件；trpc/toast 以最小 mock 隔離。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Cloud } from "lucide-react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ConnectorRow, PendingPill, CategoryCard } from "./ConnectionsPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ConnectionsPanel · ConnectorRow（U-12 / AIDV-115 · /settings）", () => {
  it("旗標 OFF（預設）：既有列，名稱/狀態/控制項在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(
      <ConnectorRow name="Google Drive" status="active" onTest={() => {}} onToggle={() => {}} />,
    );
    expect(screen.getByText("Google Drive")).toBeTruthy();
    expect(screen.getByText("測試")).toBeTruthy();
    expect(screen.getByText("停用")).toBeTruthy(); // active → 可停用
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

  it("可建分類有連接：渲染連接列（provider 名稱）", () => {
    flags.chrome = false;
    render(
      <CategoryCard
        cat={cloud}
        connections={[{ id: 1, kind: "cloud", provider: "google_drive", status: "active" }]}
        onTest={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Google Drive")).toBeTruthy();
  });
});
