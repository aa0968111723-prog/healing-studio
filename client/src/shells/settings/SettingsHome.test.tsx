// @vitest-environment jsdom
/**
 * SettingsHome · TabStrip（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 radix TabsList＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SubTabs（進 .aidv-kit 範圍；分頁標籤都在、onSelect 可觸發）。
 * 只測 TabStrip（純展示＋回呼）；OFF 路徑用 radix Tabs 包裝（TabsTrigger 需 context）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Settings, Hand } from "lucide-react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { Tabs } from "@/components/ui/tabs";
import { TabStrip } from "./SettingsHome";

const TABS = [
  { key: "general", label: "一般", icon: Settings },
  { key: "provider", label: "生成引擎", icon: Hand },
] as const;

afterEach(() => { cleanup(); flags.chrome = false; });

describe("SettingsHome · TabStrip（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有 radix TabsList，分頁標籤在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(
      <Tabs value="general"><TabStrip tabs={TABS} active="general" onSelect={() => {}} /></Tabs>,
    );
    expect(screen.getByText("一般")).toBeTruthy();
    expect(screen.getByText("生成引擎")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SubTabs（進 .aidv-kit 範圍；標籤保留），onSelect 仍可觸發", () => {
    flags.chrome = true;
    const onSelect = vi.fn();
    const { container } = render(<TabStrip tabs={TABS} active="general" onSelect={onSelect} />);
    expect(screen.getByText("一般")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    fireEvent.click(screen.getByText("生成引擎"));
    expect(onSelect).toHaveBeenCalledWith("provider");
  });
});
