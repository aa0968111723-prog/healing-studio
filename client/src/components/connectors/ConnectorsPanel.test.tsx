// @vitest-environment jsdom
/**
 * AIDV-115 / U-12：連接器治理面板（/settings/connections＋ACL＋BYOMCP）行為測試。
 * 守住：render＋四態出口＋a11y（dot/role/aria-label）＋ACL Toggle 互動回呼，
 *      且純元件不接後端（mock 驅動）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { ConnectorsPanel, ConnectorCard, AclRow } from "./ConnectorsPanel";
import { MOCK_CONNECTORS, type Connector } from "./connectorsTypes";

afterEach(() => cleanup());

const oneConnector: Connector = {
  id: "x1",
  name: "Hugging Face",
  category: "model",
  status: "connected",
  health: "healthy",
  detail: "預設 provider",
  acl: [
    { role: "owner", visible: true },
    { role: "viewer", visible: false },
  ],
};

describe("連接器治理面板（AIDV-115 / U-12）", () => {
  it("render：5 類治理分組標題齊備（mock）", () => {
    render(<ConnectorsPanel connectors={MOCK_CONNECTORS} />);
    expect(screen.getByRole("region", { name: "連接器治理面板" })).toBeTruthy();
    for (const label of ["模型供應商", "儲存", "資料源", "個人資料庫"]) {
      expect(screen.getByRole("region", { name: `治理分組 ${label}` })).toBeTruthy();
    }
  });

  it("四態 · loading：顯示載入態", () => {
    render(<ConnectorsPanel loading connectors={MOCK_CONNECTORS} />);
    expect(screen.getByText("載入連接器治理面板…")).toBeTruthy();
  });

  it("四態 · error：role=alert＋重試觸發 onRetry", () => {
    const onRetry = vi.fn();
    render(<ConnectorsPanel error="讀取失敗" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("重試"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("四態 · empty：空清單顯示空態＋動作鈕觸發 onAddConnector", () => {
    const onAddConnector = vi.fn();
    render(<ConnectorsPanel connectors={[]} onAddConnector={onAddConnector} />);
    expect(screen.getByText("尚未連接任何服務")).toBeTruthy();
    fireEvent.click(screen.getByText("新增連接器"));
    expect(onAddConnector).toHaveBeenCalledTimes(1);
  });

  it("ConnectorCard：狀態 dot 有無障礙標籤＋健康 Pill 文字", () => {
    render(<ConnectorCard connector={oneConnector} />);
    expect(screen.getByRole("img", { name: "已連線" })).toBeTruthy();
    expect(screen.getByText("健康")).toBeTruthy();
    expect(screen.getByRole("group", { name: "連接器 Hugging Face" })).toBeTruthy();
  });

  it("狀態 dot：三態（connected/disconnected/error）各有對應 aria-label", () => {
    const states = [
      { status: "connected" as const, label: "已連線" },
      { status: "disconnected" as const, label: "未連線" },
      { status: "error" as const, label: "連線錯誤" },
    ];
    for (const s of states) {
      const { unmount } = render(
        <ConnectorCard connector={{ ...oneConnector, status: s.status }} />,
      );
      expect(screen.getByRole("img", { name: s.label })).toBeTruthy();
      unmount();
    }
  });

  it("ACL 列：role=switch＋aria-checked 反映可見性，點擊回呼 next 值", () => {
    const onToggle = vi.fn();
    render(
      <AclRow
        connectorName="Hugging Face"
        entry={{ role: "viewer", visible: false }}
        onToggle={onToggle}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Hugging Face · 檢視者 可見性" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith("viewer", true);
  });

  it("ACL Toggle：面板層回呼帶 connectorId＋role＋next（純視覺唯讀）", () => {
    const onToggleAcl = vi.fn();
    render(
      <ConnectorsPanel connectors={[oneConnector]} onToggleAcl={onToggleAcl} />,
    );
    const card = screen.getByRole("group", { name: "連接器 Hugging Face" });
    const ownerSwitch = within(card).getByRole("switch", {
      name: "Hugging Face · 擁有者 可見性",
    });
    fireEvent.click(ownerSwitch); // owner 目前 visible=true → 點擊轉 false
    expect(onToggleAcl).toHaveBeenCalledWith("x1", "owner", false);
  });
});
