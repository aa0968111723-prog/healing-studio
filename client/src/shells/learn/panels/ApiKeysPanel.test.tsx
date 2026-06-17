// @vitest-environment jsdom
/**
 * ApiKeysPanel · KeyStatusRow（U-7 / AIDV-97 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑（平台金鑰唯讀，無 test/delete）：
 *   · 旗標 OFF（預設）＝既有圖示＋Badge（「已設定」/「未設定」），不進 .aidv-kit 範圍。
 *   · 旗標 ON       ＝design-kit KeyRow（進 .aidv-kit 範圍；isSet→「已連」、未設→「未測」）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { KeyStatusRow } from "./ApiKeysPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ApiKeysPanel · KeyStatusRow（U-7 / AIDV-97 · /learn）", () => {
  it("旗標 OFF（預設）：既有 Badge 文案（已設定/未設定），未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(
      <KeyStatusRow name="openai" label="OpenAI" module="llm" isSet />,
    );
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("已設定")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit KeyRow（進 .aidv-kit 範圍；已設→已連、未設→未測）", () => {
    flags.chrome = true;
    const { container, rerender } = render(
      <KeyStatusRow name="openai" label="OpenAI" isSet />,
    );
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("已連")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();

    rerender(<KeyStatusRow name="fal" label="Fal" isSet={false} />);
    expect(screen.getByText("未測")).toBeTruthy();
  });
});
