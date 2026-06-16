// @vitest-environment jsdom
/**
 * ApiKeysPanel · KeyStatusRow（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 *   · 旗標 OFF（預設）＝既有卡（label＋module＋已設定/未設定徽章）＝零變化（不進 .aidv-kit）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 KeyRow（進 .aidv-kit；name＋狀態點，設計刻意精簡）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { KeyStatusRow } from "./ApiKeysPanel";

const KEY = { name: "OPENAI_API_KEY", label: "OpenAI", module: "llm", isSet: true };

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ApiKeysPanel · KeyStatusRow（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有卡，label/module/徽章在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<KeyStatusRow k={KEY} />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("llm")).toBeTruthy();
    expect(screen.getByText("已設定")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit KeyRow（進 .aidv-kit；name 保留）", () => {
    flags.chrome = true;
    const { container } = render(<KeyStatusRow k={KEY} />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
