/**
 * Tests for PostHog tracking script integration
 *
 * Validates:
 * 1. PostHog script is present in index.html
 * 2. Correct token is used
 * 3. Correct api_host is configured
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

  it("should use the correct PostHog token", () => {
    expect(indexHtml).toContain(
      "phc_piqMEmDCK3tPRPgvjsueARaP3DE7SScZqc3LFLchS94"
    );
  });

  it("should use the correct api_host", () => {
    expect(indexHtml).toContain("https://us.i.posthog.com");
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
