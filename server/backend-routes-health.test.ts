import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

describe("Backend Routes Health Check", () => {
  it("should expose all critical top-level route namespaces", () => {
    const routeRecord = (appRouter as any)?._def?.record ?? {};
    const routeKeys = Object.keys(routeRecord);

    const expectedNamespaces = [
      "system",
      "news",
      "showcase",
      "sense",
      "brain",
      "proStudio",
      "imageStudio",
      "videoStudio",
      "learnHub",
      "loraTrainer",
      "promptLibrary",
      "externalServices",
      "apiUsage",
      "auth",
      "credits",
      "generate",
      "history",
      "vault",
      "models",
    ];

    for (const ns of expectedNamespaces) {
      expect(routeKeys).toContain(ns);
    }
  });

  it("should have a non-empty flattened procedure registry", () => {
    const procedures = (appRouter as any)?._def?.procedures ?? {};
    const procedureKeys = Object.keys(procedures);
    expect(procedureKeys.length).toBeGreaterThan(0);

    for (const key of procedureKeys) {
      expect(procedures[key]).toBeTruthy();
    }
  });

  it("public routes should be callable without runtime route-link errors", async () => {
    const caller = appRouter.createCaller({
      req: { cookies: {}, headers: {} },
      res: { cookie: () => {}, clearCookie: () => {} },
      user: null,
    } as any);

    await expect(caller.auth.me()).resolves.toBeNull();
    await expect(caller.credits.pricingCatalog()).resolves.toBeTruthy();
  });
});

