import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
import { NextStepPanel } from "./NextStepPanel";

describe("layout components", () => {
  it("renders PageHeader", () => {
    render(<PageHeader title="世界觀系統" subtitle="subtitle" primaryAction={{ label: "繼續下一步" }} />);
    expect(screen.getByText("世界觀系統")).toBeTruthy();
    expect(screen.getByText("繼續下一步")).toBeTruthy();
  });

  it("renders NextStepPanel", () => {
    render(<NextStepPanel title="下一步" description="先完成角色" reason="避免分鏡缺漏" primaryAction={<button>開始</button>} />);
    expect(screen.getByText("下一步")).toBeTruthy();
    expect(screen.getByText(/避免分鏡缺漏/)).toBeTruthy();
  });
});
