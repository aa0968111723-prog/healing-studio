import { test, expect } from "@playwright/test";

/**
 * AIDV-606: tRPC transport-layer smoke tests.
 *
 * Guard against middleware regressions where express.json is absent, causing
 * all tRPC mutations to return HTTP 400 instead of a tRPC-level error
 * (AIDV-572 regression: express.json missing → full site mutations broke for
 * 5 QA cycles before detection).
 *
 * Contract:
 *   - HTTP 400 = transport broken (express.json or body-parser missing)
 *   - HTTP 200 + tRPC-level error = transport OK, auth/logic handled above
 *   - HTTP 401 from Express/middleware = also transport broken
 *
 * These tests do NOT require a logged-in session. Unauthed mutation calls are
 * expected to return HTTP 200 with a tRPC UNAUTHORIZED payload — that is the
 * correct wired state.
 */
test.describe("tRPC transport-layer smoke (AIDV-606)", () => {
  test("POST mutation returns HTTP 200, not 400 (express.json guard)", async ({
    request,
  }) => {
    // Unauthenticated mutation call — should get tRPC UNAUTHORIZED (HTTP 200),
    // not HTTP 400 (body-parser missing).
    const res = await request.post("/api/trpc/videoProject.create?batch=1", {
      headers: {
        "Content-Type": "application/json",
        "x-trpc-source": "react",
      },
      data: JSON.stringify({ "0": { json: { title: "smoke-test" } } }),
    });

    // 400 = express.json missing → AIDV-572 regression
    expect(
      res.status(),
      "tRPC mutation returned HTTP 400 — likely express.json missing"
    ).not.toBe(400);

    // tRPC always responds with 200 for UNAUTHORIZED, not a 4xx HTTP error
    expect(res.status()).toBe(200);
  });

  test("GET query endpoint returns HTTP 200 with JSON body", async ({
    request,
  }) => {
    const input = encodeURIComponent(JSON.stringify({ "0": { json: null } }));
    const res = await request.get(
      `/api/trpc/auth.me?batch=1&input=${input}`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    // tRPC always responds with an array in batch mode
    expect(Array.isArray(body)).toBe(true);
  });

  test("tRPC endpoint sends application/json content-type", async ({
    request,
  }) => {
    const input = encodeURIComponent(JSON.stringify({ "0": { json: null } }));
    const res = await request.get(
      `/api/trpc/credits.pricingCatalog?batch=1&input=${input}`
    );
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toContain("application/json");
  });
});
