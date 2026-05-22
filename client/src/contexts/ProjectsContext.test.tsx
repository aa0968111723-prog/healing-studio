// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProjectsProvider, useProjects } from "./ProjectsContext";
import { MOCK_PROJECTS } from "@/data/mockProjects";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectsProvider>{children}</ProjectsProvider>;
}

describe("ProjectsContext", () => {
  it("exposes mock projects to consumers", () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.projects).toHaveLength(MOCK_PROJECTS.length);
    expect(result.current.projects[0]).toMatchObject({
      id: MOCK_PROJECTS[0].id,
      title: MOCK_PROJECTS[0].title,
    });
  });

  it("falls back to the latest-updated project when no id is pinned", () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    // proj-voice-test 是 mock 裡 updatedAt 最新的（2026-05-20）。
    expect(result.current.activeProject?.id).toBe("proj-voice-test");
    expect(result.current.activeProjectId).toBe(null);
  });

  it("honours an explicitly pinned active project id", () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    act(() => {
      result.current.setActiveProjectId("proj-club-poster");
    });
    expect(result.current.activeProjectId).toBe("proj-club-poster");
    expect(result.current.activeProject?.id).toBe("proj-club-poster");
  });

  it("clears stale active id (not in projects) on mount", () => {
    window.localStorage.setItem(
      "creation-hub-active-project-id",
      "does-not-exist",
    );
    const { result } = renderHook(() => useProjects(), { wrapper });
    // The cleanup effect runs on mount and clears the stored id.
    expect(result.current.activeProjectId).toBe(null);
    // activeProject still resolves via latestProject fallback so the home
    // never lands on a 「沒有專案」 state when there's stored junk.
    expect(result.current.activeProject?.id).toBe("proj-voice-test");
  });

  it("looks up a project by id", () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.getProjectById("proj-zen-short")?.title).toBe(
      "禪修短片企劃",
    );
    expect(result.current.getProjectById("does-not-exist")).toBeUndefined();
  });

  it("createProject appends a new project and pins it as active", () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    const before = result.current.projects.length;
    let createdId = "";
    act(() => {
      const created = result.current.createProject({
        title: "新影片企劃",
        type: "video",
        worldFramework: "新世界觀",
      });
      createdId = created.id;
    });
    expect(result.current.projects.length).toBe(before + 1);
    expect(result.current.activeProjectId).toBe(createdId);
    const created = result.current.getProjectById(createdId);
    expect(created?.title).toBe("新影片企劃");
    expect(created?.type).toBe("video");
    expect(created?.status).toBe("draft");
    expect(created?.binding?.worldFramework).toBe("新世界觀");
  });
});
