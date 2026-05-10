/**
 * Tests for the shared `dispatchToStudio` helper. Before this helper, every
 * "發送到工作室" callsite (DirectorAI, HistoryPage, SharedSpace) hand-rolled
 * its own modality→route mapping and most of them always navigated to
 * `/studio` regardless of modality. These tests pin the routing rules so a
 * future regression doesn't quietly send all 圖片 dispatches to the
 * generic page again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDIO_SESSION_KEY,
  dispatchToStudio,
  routeForBatch,
  routeForModality,
  studioRouteLabel,
} from "../../../client/src/lib/send-to-studio";

class StorageStub {
  private store = new Map<string, string>();
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe("routeForModality", () => {
  it("maps each canonical modality to the right studio path", () => {
    expect(routeForModality("image")).toBe("/image-studio");
    expect(routeForModality("video")).toBe("/video-studio");
    expect(routeForModality("audio")).toBe("/pro-studio");
    expect(routeForModality("voice")).toBe("/pro-studio");
    expect(routeForModality("sfx")).toBe("/pro-studio");
    expect(routeForModality("music")).toBe("/pro-studio");
    expect(routeForModality("text")).toBe("/studio");
  });

  it("normalizes prefixes (imageGeneration, videoEdit, audioBgm)", () => {
    expect(routeForModality("imageGeneration")).toBe("/image-studio");
    expect(routeForModality("videoEdit")).toBe("/video-studio");
    expect(routeForModality("audioBgm")).toBe("/pro-studio");
    expect(routeForModality("voiceClone")).toBe("/pro-studio");
  });

  it("falls back to /studio for unknown / empty modalities", () => {
    expect(routeForModality(undefined)).toBe("/studio");
    expect(routeForModality("")).toBe("/studio");
    expect(routeForModality("unknown-future-modality")).toBe("/studio");
  });
});

describe("routeForBatch", () => {
  it("returns the modality-specific route when all tasks share a family", () => {
    expect(
      routeForBatch([
        { generationType: "image" },
        { generationType: "image" },
      ])
    ).toBe("/image-studio");
    expect(
      routeForBatch([
        { generationType: "audio" },
        { generationType: "voice" },
      ])
    ).toBe("/pro-studio");
  });

  it("falls back to /studio when the batch mixes families", () => {
    expect(
      routeForBatch([
        { generationType: "image" },
        { generationType: "video" },
      ])
    ).toBe("/studio");
  });

  it("returns /studio for an empty batch", () => {
    expect(routeForBatch([])).toBe("/studio");
  });
});

describe("dispatchToStudio", () => {
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    const stub = new StorageStub();
    Object.defineProperty(globalThis, "window", {
      value: { sessionStorage: stub },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: stub,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalSessionStorage !== undefined) {
      Object.defineProperty(globalThis, "sessionStorage", {
        value: originalSessionStorage,
        configurable: true,
        writable: true,
      });
    }
    if (originalWindow !== undefined) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  it("persists the payload under STUDIO_SESSION_KEY and navigates to the modality route", () => {
    const navigate = vi.fn();
    const route = dispatchToStudio({
      payload: {
        prompt: "a cat in a tree",
        generationType: "image",
        overrideEngine: "fal-flux-schnell",
        source: "director_ai",
      },
      navigate,
    });

    expect(route).toBe("/image-studio");
    expect(navigate).toHaveBeenCalledWith("/image-studio");
    const raw = sessionStorage.getItem(STUDIO_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.overrideEngine).toBe("fal-flux-schnell");
    expect(parsed.source).toBe("director_ai");
  });

  it("uses batch routing when batchTasks is provided", () => {
    const navigate = vi.fn();
    const route = dispatchToStudio({
      payload: {
        prompt: "scene",
        generationType: "image",
        source: "director_ai",
        batchTasks: [
          { generationType: "image", prompt: "shot 1" },
          { generationType: "video", prompt: "shot 2" },
        ],
      },
      navigate,
    });
    // Mixed batch → /studio.
    expect(route).toBe("/studio");
    expect(navigate).toHaveBeenCalledWith("/studio");
  });

  it("respects forcePath override (e.g. SharedSpace forcing /studio)", () => {
    const navigate = vi.fn();
    const route = dispatchToStudio({
      payload: {
        prompt: "x",
        generationType: "image",
        source: "shared_space",
      },
      navigate,
      forcePath: "/studio",
    });
    expect(route).toBe("/studio");
    expect(navigate).toHaveBeenCalledWith("/studio");
  });

  it("invokes beforeNavigate hook with payload + resolved route", () => {
    const navigate = vi.fn();
    const beforeNavigate = vi.fn();
    dispatchToStudio({
      payload: {
        prompt: "x",
        generationType: "video",
        source: "history",
      },
      navigate,
      beforeNavigate,
    });
    expect(beforeNavigate).toHaveBeenCalledTimes(1);
    expect(beforeNavigate.mock.calls[0][1]).toBe("/video-studio");
  });
});

describe("studioRouteLabel", () => {
  it("returns Chinese labels for known routes", () => {
    expect(studioRouteLabel("/image-studio")).toBe("圖片工作室");
    expect(studioRouteLabel("/video-studio")).toBe("影片工作室");
    expect(studioRouteLabel("/pro-studio")).toBe("音訊工作室");
    expect(studioRouteLabel("/studio")).toBe("通用工作室");
  });

  it("falls back to a generic label for unknown routes", () => {
    expect(studioRouteLabel("/unknown")).toBe("工作室");
  });
});
