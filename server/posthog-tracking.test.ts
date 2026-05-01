/**
 * Tests for PostHog tracking script integration
 *
 * Validates:
 * 1. PostHog script is present in index.html
 * 2. Build-time placeholders for token + api_host are wired (commit 60b1082
 *    intentionally un-hardcoded these so the value is injected per
 *    deployment via VITE_POSTHOG_KEY / VITE_POSTHOG_HOST).
 * 3. Init call has the runtime guard that skips PostHog when the
 *    placeholder isn't substituted (still starts with `%`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const indexHtml = readFileSync(
  resolve(__dirname, "../client/index.html"),
  "utf-8"
);

describe("PostHog Tracking Script", () => {
  it("should contain PostHog bootstrap snippet in head", () => {
    expect(indexHtml).toContain("window.posthog");
    expect(indexHtml).toContain("posthog.init");
  });

  it("should declare a build-time placeholder for the PostHog token", () => {
    // commit 60b1082: token must NOT be hardcoded — it's injected at deploy time.
    expect(indexHtml).toContain("%VITE_POSTHOG_KEY%");
    expect(indexHtml).not.toMatch(/phc_[a-zA-Z0-9]{20,}/);
  });

  it("should declare a build-time placeholder for api_host", () => {
    expect(indexHtml).toContain("%VITE_POSTHOG_HOST%");
  });

  it("should guard posthog.init when the placeholder is unsubstituted", () => {
    // Without this guard, an un-substituted "%VITE_POSTHOG_KEY%" would init
    // PostHog with a literal string and pollute analytics.
    expect(indexHtml).toMatch(/__posthogKey\.charAt\(0\)\s*!==\s*["']%["']/);
  });

  it("should set person_profiles to identified_only", () => {
    expect(indexHtml).toContain("person_profiles");
    expect(indexHtml).toContain("identified_only");
  });

  it("should be placed inside the <head> tag", () => {
    const headMatch = indexHtml.match(/<head>([\s\S]*?)<\/head>/);
    expect(headMatch).toBeTruthy();
    const headContent = headMatch![1];
    expect(headContent).toContain("posthog.init");
  });

  it("should load the PostHog array.js script asynchronously", () => {
    expect(indexHtml).toContain("async");
    expect(indexHtml).toContain("/static/array.js");
  });
});
