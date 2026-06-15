// @vitest-environment jsdom
/**
 * WorldLinkPicker（I-6 Phase 2b 世界連結，AIDV-100）行為測試。
 *
 * 守住：
 *   1. 有世界清單 → 點一個 → 呼叫 spine.linkWorld(id)。
 *   2. 無世界 → 顯示提示、不呼叫 linkWorld（零誤寫）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listWorlds: vi.fn(),
  linkWorld: vi.fn(),
}));

vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ listWorlds: h.listWorlds, linkWorld: h.linkWorld }),
}));

import { WorldLinkPicker } from "./WorldLinkPicker";

beforeEach(() => {
  h.listWorlds.mockReset();
  h.linkWorld.mockReset();
  h.linkWorld.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("WorldLinkPicker（I-6 Phase 2b / AIDV-100）", () => {
  it("有世界清單 → 選一個 → 呼叫 linkWorld(id)", async () => {
    h.listWorlds.mockResolvedValue([{ id: 7, name: "雪山世界" }, { id: 8, name: "森林世界" }]);
    render(<WorldLinkPicker />);
    fireEvent.click(await screen.findByText("雪山世界"));
    await waitFor(() => expect(h.linkWorld).toHaveBeenCalledWith(7));
  });

  it("無世界 → 顯示提示、不呼叫 linkWorld", async () => {
    h.listWorlds.mockResolvedValue([]);
    render(<WorldLinkPicker />);
    expect(await screen.findByText(/尚無世界/)).toBeTruthy();
    expect(h.linkWorld).not.toHaveBeenCalled();
  });
});
