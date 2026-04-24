import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOrbToolRegistry,
  resetOrbToolRegistryForTest,
} from "./config/orbToolRegistry";

describe("getOrbToolRegistry", () => {
  afterEach(() => {
    delete process.env.ORB_TOOL_REGISTRY_JSON;
    resetOrbToolRegistryForTest();
  });

  it("returns [] when env is missing", () => {
    expect(getOrbToolRegistry()).toEqual([]);
  });

  it("parses valid registry json", () => {
    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      {
        name: "crm.lookup",
        description: "查詢 CRM",
        method: "GET",
        endpoint: "https://api.example.com/customers",
      },
    ]);

    expect(getOrbToolRegistry()).toEqual([
      {
        name: "crm.lookup",
        description: "查詢 CRM",
        method: "GET",
        endpoint: "https://api.example.com/customers",
      },
    ]);
  });

  it("falls back to [] for invalid json", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ORB_TOOL_REGISTRY_JSON = "{bad-json";
    expect(getOrbToolRegistry()).toEqual([]);
    spy.mockRestore();
  });
});
