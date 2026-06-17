// @vitest-environment jsdom
// ============================================================================
// PromptVaultAdoption.test — U-9 共用採用閉環元件單測（adapter 以 fake 注入）
// 覆蓋：render（.aidv-kit scope）＋ a11y（區塊 labelledby、icon-only aria-label）
//       ＋ 四態（ready/empty/error）＋ 互動（存庫→saved、重用→onApply、閉環/單側分流）。
// ============================================================================
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { PromptVaultAdoption } from "./PromptVaultAdoption";
import type {
  PromptVaultAdapter,
  PromptVaultItem,
  PromptVaultPage,
} from "@/adapters/types";

afterEach(cleanup);

function makeItem(over: Partial<PromptVaultItem> = {}): PromptVaultItem {
  return {
    id: 1,
    title: "晚安雨聲",
    content: "lo-fi 治癒夜雨",
    category: "audio",
    tags: ["治癒", "雨"],
    isFavorite: false,
    useCount: 2,
    modelHint: "fal",
    ...over,
  };
}

function page(items: PromptVaultItem[]): PromptVaultPage {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 };
}

function fakeAdapter(over: Partial<PromptVaultAdapter> = {}): PromptVaultAdapter {
  return {
    listPrompts: vi.fn(async () => page([makeItem()])),
    getPrompt: vi.fn(async () => null),
    createPrompt: vi.fn(async () => ({ id: 9 })),
    incrementUseCount: vi.fn(async () => undefined),
    listLinkedAssets: vi.fn(async () => []),
    listLinkedPrompts: vi.fn(async () => []),
    ...over,
  };
}

describe("PromptVaultAdoption — render ＋ a11y", () => {
  it("掛在 .aidv-kit scope 內，且區塊以 heading 標示（aria-labelledby）", async () => {
    const adapter = fakeAdapter();
    const { container } = render(
      <PromptVaultAdoption sourceWorkflow="video" adapter={adapter} closedLoop />
    );
    // 設計鐵則：元件必須在 .aidv-kit scope 內 token 才解析。
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    const section = screen.getByRole("region", { name: "提示詞庫 · 存庫與重用" });
    expect(section).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "再生成" })).toBeTruthy()
    );
  });

  it("自動存草稿 Toggle 為 icon-only 但有可存取名稱（aria-label）", async () => {
    const adapter = fakeAdapter();
    render(<PromptVaultAdoption sourceWorkflow="social" adapter={adapter} closedLoop />);
    expect(screen.getByRole("switch", { name: "自動存草稿" })).toBeTruthy();
  });
});

describe("PromptVaultAdoption — 四態", () => {
  it("ready：有 entries → 顯示卡片與重用動作", async () => {
    const adapter = fakeAdapter();
    render(<PromptVaultAdoption sourceWorkflow="video" adapter={adapter} closedLoop />);
    await waitFor(() => expect(screen.getByText("lo-fi 治癒夜雨")).toBeTruthy());
    expect(screen.getByRole("button", { name: "插入素材" })).toBeTruthy();
  });

  it("empty：空清單 → 顯示「還沒有存過提示詞」", async () => {
    const adapter = fakeAdapter({ listPrompts: vi.fn(async () => page([])) });
    render(<PromptVaultAdoption sourceWorkflow="video" adapter={adapter} closedLoop />);
    await waitFor(() => expect(screen.getByText("還沒有存過提示詞")).toBeTruthy());
  });

  it("error：列表丟錯 → 顯示載入失敗與重試", async () => {
    const adapter = fakeAdapter({
      listPrompts: vi.fn(async () => {
        throw new Error("tRPC down");
      }),
    });
    render(<PromptVaultAdoption sourceWorkflow="video" adapter={adapter} closedLoop />);
    await waitFor(() => expect(screen.getByText("提示詞庫載入失敗")).toBeTruthy());
    expect(screen.getByRole("button", { name: "重試" })).toBeTruthy();
  });
});

describe("PromptVaultAdoption — 互動", () => {
  it("存庫：按「＋ 存入提示詞庫」→ createPrompt 被呼叫、轉「已存入」", async () => {
    const adapter = fakeAdapter();
    render(
      <PromptVaultAdoption
        sourceWorkflow="social"
        adapter={adapter}
        closedLoop
        payload={{ title: "新詞", content: "全新的 prompt 內容" }}
      />
    );
    await waitFor(() => expect(screen.getByText("lo-fi 治癒夜雨")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "＋ 存入提示詞庫" }));
    await waitFor(() => expect(adapter.createPrompt).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已存入提示詞庫 · 可重用")).toBeTruthy();
  });

  it("重用：按「再生成」→ incrementUseCount + onApply 回呼", async () => {
    const adapter = fakeAdapter();
    const onApply = vi.fn();
    render(
      <PromptVaultAdoption
        sourceWorkflow="video"
        adapter={adapter}
        closedLoop
        onApply={onApply}
      />
    );
    await waitFor(() => expect(screen.getByText("lo-fi 治癒夜雨")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "再生成" }));
    await waitFor(() => expect(adapter.incrementUseCount).toHaveBeenCalledWith(1));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("payload=null：按存庫鈕為 no-op（不呼叫 createPrompt）", async () => {
    const adapter = fakeAdapter();
    render(
      <PromptVaultAdoption sourceWorkflow="social" adapter={adapter} closedLoop payload={null} />
    );
    await waitFor(() => expect(screen.getByText("lo-fi 治癒夜雨")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "＋ 存入提示詞庫" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.createPrompt).not.toHaveBeenCalled();
  });
});

describe("PromptVaultAdoption — 旗標分流（閉環/單側）", () => {
  it("closedLoop=false + only=save：只渲染存庫側，不載入清單", async () => {
    const adapter = fakeAdapter();
    render(
      <PromptVaultAdoption
        sourceWorkflow="video"
        adapter={adapter}
        closedLoop={false}
        only="save"
        payload={{ title: "t", content: "c" }}
      />
    );
    expect(screen.getByRole("button", { name: "＋ 存入提示詞庫" })).toBeTruthy();
    // 單側存庫不應觸發瀏覽列表（autoLoad=false）。
    expect(adapter.listPrompts).not.toHaveBeenCalled();
    // 不渲染瀏覽器搜尋框。
    expect(screen.queryByPlaceholderText("搜尋 prompt、模型、標籤…")).toBeNull();
  });

  it("closedLoop=false + only=browse：只渲染瀏覽側，無存庫鈕", async () => {
    const adapter = fakeAdapter();
    render(
      <PromptVaultAdoption
        sourceWorkflow="social"
        adapter={adapter}
        closedLoop={false}
        only="browse"
      />
    );
    await waitFor(() => expect(adapter.listPrompts).toHaveBeenCalled());
    const search = screen.getByPlaceholderText("搜尋 prompt、模型、標籤…");
    expect(within(search.closest("div")!).queryByText("＋ 存入提示詞庫")).toBeNull();
  });
});
