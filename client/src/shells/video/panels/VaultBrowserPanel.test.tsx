// @vitest-environment jsdom
/**
 * VaultBrowserPanel（U-9 / AIDV-99 · /video 提示詞庫採用 第1片）行為測試。
 * 守住：
 *   · 四態鐵律——loading→ready（真實列出）、empty（庫空）、error（list 失敗 + 重試）。
 *   · 重用——「插入素材」把 prompt 帶回 onReuse 出口、並 incrementUseCount（使用次數 +1）。
 *   · 接縫——只透過 useSpine().adapters.promptVault 呼叫，不直呼 procedure。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { PromptVaultItem, PromptVaultPage } from "@/adapters/types";

const vault = vi.hoisted(() => ({
  listPrompts: vi.fn(),
  incrementUseCount: vi.fn(),
}));

vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({ adapters: { promptVault: vault } }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

import { VaultBrowserPanel } from "./VaultBrowserPanel";

function item(over: Partial<PromptVaultItem> = {}): PromptVaultItem {
  return {
    id: 5, title: "雪山·晨光", content: "snow mountain at dawn, warm light",
    category: "image", tags: ["風景"], isFavorite: false, useCount: 3, ...over,
  };
}
function page(items: PromptVaultItem[]): PromptVaultPage {
  return { items, total: items.length, page: 1, pageSize: 24, totalPages: 1 };
}

beforeEach(() => {
  vault.listPrompts.mockReset();
  vault.incrementUseCount.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("VaultBrowserPanel（U-9 / AIDV-99 · /video）", () => {
  it("ready：真實列出提示詞、進設計套件範圍（.aidv-kit）", async () => {
    vault.listPrompts.mockResolvedValue(page([item()]));
    const { container } = render(<VaultBrowserPanel />);
    await waitFor(() => expect(screen.getByText("snow mountain at dawn, warm light")).toBeTruthy());
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(vault.listPrompts).toHaveBeenCalled();
  });

  it("empty：庫空顯示空態出口（提示去存）", async () => {
    vault.listPrompts.mockResolvedValue(page([]));
    render(<VaultBrowserPanel />);
    await waitFor(() => expect(screen.getByText("還沒有存過提示詞")).toBeTruthy());
  });

  it("error：list 失敗顯示錯誤態 + 重試", async () => {
    vault.listPrompts.mockRejectedValue(new Error("tRPC down"));
    render(<VaultBrowserPanel />);
    await waitFor(() => expect(screen.getByText("提示詞庫載入失敗")).toBeTruthy());
    expect(screen.getByText("重試")).toBeTruthy();
  });

  it("重用·插入：帶回 onReuse 出口並 incrementUseCount（使用次數 +1）", async () => {
    vault.listPrompts.mockResolvedValue(page([item()]));
    const onReuse = vi.fn();
    render(<VaultBrowserPanel onReuse={onReuse} />);
    await waitFor(() => expect(screen.getByText("插入素材")).toBeTruthy());
    fireEvent.click(screen.getByText("插入素材"));
    expect(onReuse).toHaveBeenCalledWith("snow mountain at dawn, warm light");
    expect(vault.incrementUseCount).toHaveBeenCalledWith(5);
  });
});
