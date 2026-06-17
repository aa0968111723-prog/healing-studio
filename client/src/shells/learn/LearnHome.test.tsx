// @vitest-environment jsdom
/**
 * LearnHome · TabStrip（U-7 / AIDV-97 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 radix TabsList＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SubTabs（進 .aidv-kit 範圍；分頁標籤都在、onSelect 可觸發）。
 * 只測 TabStrip（純展示＋回呼）；OFF 路徑用 radix Tabs 包裝（TabsTrigger 需 context）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Globe, Cpu } from "lucide-react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { Tabs } from "@/components/ui/tabs";
import { TabStrip } from "./LearnHome";

const TABS = [
  { key: "research", label: "研究代理", icon: Globe },
  { key: "models", label: "模型情報", icon: Cpu },
] as const;

afterEach(() => { cleanup(); flags.chrome = false; });

describe("LearnHome · TabStrip（U-7 / AIDV-97 · /learn）", () => {
  it("旗標 OFF（預設）：既有 radix TabsList，分頁標籤在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(
      <Tabs value="research"><TabStrip tabs={TABS} active="research" onSelect={() => {}} /></Tabs>,
    );
    expect(screen.getByText("研究代理")).toBeTruthy();
    expect(screen.getByText("模型情報")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SubTabs（進 .aidv-kit 範圍；標籤保留），onSelect 仍可觸發", () => {
    flags.chrome = true;
    const onSelect = vi.fn();
    const { container } = render(<TabStrip tabs={TABS} active="research" onSelect={onSelect} />);
    expect(screen.getByText("研究代理")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    fireEvent.click(screen.getByText("模型情報"));
    expect(onSelect).toHaveBeenCalledWith("models");
  });
});
