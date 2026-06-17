// @vitest-environment jsdom
/**
 * ApiKeysPanel · KeyGrid（U-7 / AIDV-97 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 shadcn 列＝零變化（不進 .aidv-kit 範圍；label/module 雙段在）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 KeyRow（進 .aidv-kit 範圍；label/module 併入零損失、
 *                     已設定→「已連」Pill、未設定→「未測」Pill）。
 * 只測 KeyGrid（純展示）；面板的 trpc/RBAC 不在本測涵蓋。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { KeyGrid } from "./ApiKeysPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

const KEYS = [
  { name: "openai", label: "OpenAI", module: "llm", isSet: true },
  { name: "brave", label: "Brave Search", module: "search", isSet: false },
];

describe("ApiKeysPanel · KeyGrid（U-7 / AIDV-97 · /learn）", () => {
  it("旗標 OFF（預設）：既有 shadcn 列，label/module 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<KeyGrid keys={KEYS} />);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("llm")).toBeTruthy();
    expect(screen.getByText("已設定")).toBeTruthy();
    expect(screen.getByText("未設定")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit KeyRow（進 .aidv-kit；label·module 併入、狀態 Pill 對映 isSet）", () => {
    flags.chrome = true;
    const { container } = render(<KeyGrid keys={KEYS} />);
    expect(screen.getByText(/OpenAI · llm/)).toBeTruthy();
    expect(screen.getByText(/Brave Search · search/)).toBeTruthy();
    // KeyRow Pill：ok→「已連」、idle→「未測」。
    expect(screen.getByText("已連")).toBeTruthy();
    expect(screen.getByText("未測")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
