import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrbToolRegistryCenter } from "./services/orbToolRegistryCenter";
import { resetOrbToolRegistryForTest } from "./config/orbToolRegistry";

describe("OrbToolRegistryCenter", () => {
  beforeEach(() => {
    resetOrbToolRegistryForTest();
  });

  afterEach(() => {
    delete process.env.ORB_TOOL_REGISTRY_JSON;
    resetOrbToolRegistryForTest();
  });

  it("bootstraps from env registry when no persistence file", () => {
    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      {
        name: "crm.lookup",
        description: "lookup",
        method: "GET",
        endpoint: "https://api.example.com/customers",
      },
    ]);
    const center = new OrbToolRegistryCenter();
    const list = center.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.enabled).toBe(true);
  });

  it("supports upsert, enable/disable and delete with persistence", () => {
    const dir = mkdtempSync(join(tmpdir(), "orb-registry-center-"));
    const file = join(dir, "tools.json");
    try {
      const center = new OrbToolRegistryCenter(file);
      center.upsert({
        name: "ticket.create",
        description: "create ticket",
        method: "POST",
        endpoint: "https://api.example.com/tickets",
        enabled: true,
        owner: "ops",
      });
      center.setEnabled("ticket.create", false);
      let active = center.activeTools();
      expect(active).toHaveLength(0);
      center.setEnabled("ticket.create", true);
      active = center.activeTools();
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe("ticket.create");
      expect(center.remove("ticket.create")).toBe(true);
      expect(center.list()).toHaveLength(0);

      const reloaded = new OrbToolRegistryCenter(file);
      expect(reloaded.list()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
