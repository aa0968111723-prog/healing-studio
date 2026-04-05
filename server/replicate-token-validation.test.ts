/**
 * Validate REPLICATE_API_TOKEN by calling a lightweight Replicate API endpoint.
 */
import { describe, it, expect } from "vitest";

describe("Replicate API Token Validation", () => {
  it("REPLICATE_API_TOKEN should be set", () => {
    const key = process.env.REPLICATE_API_TOKEN;
    expect(key).toBeTruthy();
    expect(key!.startsWith("r8_")).toBe(true);
  });

  it("REPLICATE_API_TOKEN should authenticate with Replicate API", async () => {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) {
      console.warn("REPLICATE_API_TOKEN not set, skipping");
      return;
    }

    const resp = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toBeTruthy();
    // Account endpoint returns username or type
    expect(data.username || data.type || data.github_url).toBeTruthy();
  });

  it("should be able to access the LoRA trainer model", async () => {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) {
      console.warn("REPLICATE_API_TOKEN not set, skipping");
      return;
    }

    const resp = await fetch(
      "https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer",
      { headers: { Authorization: `Bearer ${key}` } }
    );

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.name).toBe("flux-dev-lora-trainer");
    expect(data.owner).toBe("ostris");
  });
});
