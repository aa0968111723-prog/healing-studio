// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  AskOrbSection,
  ContinueProjectSection,
  DEFAULT_QUICK_START_ENTRIES,
  QuickStartSection,
} from "./CreationHubSections";
import type { Project } from "@/types/projects";

afterEach(() => {
  cleanup();
});

function renderWithRouter(ui: React.ReactNode) {
  const { hook } = memoryLocation({ path: "/" });
  return render(<Router hook={hook}>{ui}</Router>);
}

const SAMPLE_PROJECT: Project = {
  id: "proj-test",
  title: "禪修短片企劃",
  type: "video",
  status: "active",
  progress: 42,
  currentStep: "完成第一版分鏡。",
  nextAction: "用配音 / 音樂創作室產出 30 秒環境音 demo。",
  createdAt: "2026-04-28T01:30:00.000Z",
  updatedAt: "2026-05-19T09:12:00.000Z",
};

describe("ContinueProjectSection", () => {
  it("shows the create-project CTA when there is no active project", () => {
    renderWithRouter(<ContinueProjectSection activeProject={null} />);
    expect(screen.getByTestId("continue-project-empty")).toBeTruthy();
    expect(screen.getByText("建立創作專案")).toBeTruthy();
  });

  it("shows the active project card with title + next-action", () => {
    renderWithRouter(
      <ContinueProjectSection activeProject={SAMPLE_PROJECT} />,
    );
    expect(screen.getByTestId("continue-project-active")).toBeTruthy();
    expect(screen.getByText("禪修短片企劃")).toBeTruthy();
    expect(
      screen.getByText(/用配音 \/ 音樂創作室產出 30 秒環境音 demo/),
    ).toBeTruthy();
    expect(screen.getByText(/目前步驟：完成第一版分鏡/)).toBeTruthy();
  });

  it("renders a loading placeholder while data is in flight", () => {
    renderWithRouter(
      <ContinueProjectSection activeProject={null} loading />,
    );
    expect(screen.getByTestId("continue-project-loading")).toBeTruthy();
  });
});

describe("QuickStartSection", () => {
  it("renders the 區塊標題 / 副標 pair", () => {
    renderWithRouter(<QuickStartSection />);
    expect(screen.getByText("快速開始")).toBeTruthy();
    expect(screen.getByText("今天想創作什麼？")).toBeTruthy();
  });

  it("renders every quick-start entry", () => {
    renderWithRouter(<QuickStartSection />);
    expect(screen.getByTestId("quick-start-list")).toBeTruthy();
    for (const entry of DEFAULT_QUICK_START_ENTRIES) {
      expect(
        screen.getByTestId(`quick-start-${entry.id}`),
        `${entry.id} should render`,
      ).toBeTruthy();
    }
  });

  it("includes the six requested entry labels", () => {
    renderWithRouter(<QuickStartSection />);
    for (const label of [
      "做一支影片",
      "做一張海報 / 文宣",
      "產生圖片",
      "產生配音 / 音樂",
      "整理素材",
      "訓練模型",
    ]) {
      expect(screen.getByText(label), `${label} should render`).toBeTruthy();
    }
  });

  it("renders a per-card button with its own verb label", () => {
    renderWithRouter(<QuickStartSection />);
    const expected: Array<[string, string]> = [
      ["video", "開始製作"],
      ["poster", "開始設計"],
      ["image", "前往圖像"],
      ["audio", "前往聲音"],
      ["assets", "整理資料"],
      ["train", "開始訓練"],
    ];
    for (const [id, label] of expected) {
      const btn = screen.getByTestId(`quick-start-${id}-button`);
      expect(btn, `${id} button should render`).toBeTruthy();
      expect(btn.textContent ?? "", `${id} button should show "${label}"`).toContain(
        label,
      );
    }
  });
});

describe("AskOrbSection", () => {
  it("renders the orb tagline and submit form", () => {
    renderWithRouter(
      <AskOrbSection onSubmit={() => {}} onOpenAgent={() => {}} />,
    );
    expect(screen.getByTestId("ask-orb-form")).toBeTruthy();
    expect(
      screen.getByText("告訴光球你的目標，它會幫你定位到正確系統。"),
    ).toBeTruthy();
  });

  it("forwards typed prompts to onSubmit and clears the input", () => {
    const onSubmit = vi.fn();
    const onOpenAgent = vi.fn();
    renderWithRouter(
      <AskOrbSection onSubmit={onSubmit} onOpenAgent={onOpenAgent} />,
    );
    const input = screen.getByTestId("ask-orb-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "幫我做一支 30 秒短片" } });
    fireEvent.submit(screen.getByTestId("ask-orb-form"));
    expect(onSubmit).toHaveBeenCalledWith("幫我做一支 30 秒短片");
    expect(onOpenAgent).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("opens the agent without a prompt when the field is empty", () => {
    const onSubmit = vi.fn();
    const onOpenAgent = vi.fn();
    renderWithRouter(
      <AskOrbSection onSubmit={onSubmit} onOpenAgent={onOpenAgent} />,
    );
    fireEvent.submit(screen.getByTestId("ask-orb-form"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
  });
});
