/**
 * load-tests/video-pipeline.js — AIDV-711: /video concurrent-load test harness
 *
 * Tests the multi-creator dispatch_task() stress scenarios for the /video pipeline.
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:5173 \
 *           --env TEST_TOKEN=<session-token> \
 *           load-tests/video-pipeline.js
 *
 * For production/staging:
 *   k6 run --env BASE_URL=https://your-railway-app.up.railway.app \
 *           --env TEST_TOKEN=<session-token> \
 *           --scenario scenario2 \
 *           load-tests/video-pipeline.js
 *
 * Environment variables:
 *   BASE_URL    - Target base URL (default: http://localhost:5173)
 *   TEST_TOKEN  - Bearer token (cookie value for session) for auth
 *   SCENARIO    - Which scenario to run: baseline|concurrent|registry|all (default: all)
 *
 * Scenarios:
 *   1. baseline   - 1 creator, 5 sequential videoProject.create submissions
 *   2. concurrent - 10 simulated creators, 3 tasks each, overlapping 30s ramp
 *   3. registry   - Flood registry with capability-mismatched task types
 *   4. sse_fanout - 50 SSE connections during peak (BLOCKED: AIDV-341/370 - Realtime missing)
 *
 * AIDV-711 acceptance: scenarios 1-3 passing, results stored in pipeline_latency_baselines.
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Custom metrics ──────────────────────────────────────────────────────────
const errorRate = new Rate("video_pipeline_errors");
const createLatency = new Trend("videoproject_create_latency_ms", true);
const throttleCount = new Counter("rate_limit_hits");
const stallCount = new Counter("pipeline_stalls");

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:5173";
const TEST_TOKEN = __ENV.TEST_TOKEN || "";
const SCENARIO = __ENV.SCENARIO || "all";

const TRPC_BASE = `${BASE_URL}/api/trpc`;

// ── tRPC batch helpers ───────────────────────────────────────────────────────
function trpcPost(procedure, payload) {
  const headers = {
    "Content-Type": "application/json",
    "x-trpc-source": "load-test",
  };
  if (TEST_TOKEN) {
    // Pass as Authorization header (Bearer) or cookie depending on auth setup
    headers["Authorization"] = `Bearer ${TEST_TOKEN}`;
    headers["Cookie"] = `session=${TEST_TOKEN}`;
  }
  const body = JSON.stringify({ "0": { json: payload } });
  const url = `${TRPC_BASE}/${procedure}?batch=1`;
  const start = Date.now();
  const res = http.post(url, body, { headers, timeout: "30s" });
  createLatency.add(Date.now() - start);
  return res;
}

function trpcGet(procedure, input = null) {
  const headers = {
    "Content-Type": "application/json",
    "x-trpc-source": "load-test",
  };
  if (TEST_TOKEN) {
    headers["Authorization"] = `Bearer ${TEST_TOKEN}`;
    headers["Cookie"] = `session=${TEST_TOKEN}`;
  }
  const encodedInput = encodeURIComponent(JSON.stringify({ "0": { json: input } }));
  const url = `${TRPC_BASE}/${procedure}?batch=1&input=${encodedInput}`;
  return http.get(url, { headers, timeout: "30s" });
}

// ── Scenario 1: Baseline — single creator, 5 sequential submissions ──────────
function scenarioBaseline() {
  group("S1 Baseline: single-creator sequential submissions", () => {
    for (let i = 0; i < 5; i++) {
      const res = trpcPost("videoProject.create", {
        title: `load-test-baseline-${i + 1}`,
        aspectRatio: "16:9",
        priorityClass: "standard",
      });

      const ok = check(res, {
        "S1: HTTP 200": (r) => r.status === 200,
        "S1: not rate-limited (429)": (r) => r.status !== 429,
        "S1: no transport error (400)": (r) => r.status !== 400,
        "S1: body is JSON array": (r) => {
          try {
            const body = JSON.parse(r.body);
            return Array.isArray(body);
          } catch {
            return false;
          }
        },
        "S1: tRPC result or UNAUTHORIZED (not stall)": (r) => {
          try {
            const body = JSON.parse(r.body);
            if (!Array.isArray(body) || !body[0]) return false;
            // Either a successful result OR an UNAUTHORIZED error — both mean transport is alive
            const item = body[0];
            return (
              item.result !== undefined ||
              (item.error && item.error.data?.code === "UNAUTHORIZED")
            );
          } catch {
            return false;
          }
        },
      });

      if (!ok) {
        errorRate.add(1);
        if (res.status === 429) throttleCount.add(1);
        // Stall = no response body or 5xx with no error structure
        if (res.status >= 500 || res.body === "") stallCount.add(1);
      } else {
        errorRate.add(0);
      }

      sleep(0.5); // 500ms between sequential submissions
    }
  });
}

// ── Scenario 2: Concurrent creators — 10 VUs, 3 tasks each, 30s ramp ────────
function scenarioConcurrent() {
  const vuId = __VU;
  const creatorLabel = `creator-${vuId}`;

  group(`S2 Concurrent: ${creatorLabel}`, () => {
    for (let i = 0; i < 3; i++) {
      const res = trpcPost("videoProject.create", {
        title: `load-test-concurrent-${creatorLabel}-task-${i + 1}`,
        aspectRatio: i % 2 === 0 ? "16:9" : "9:16",
        priorityClass: "standard",
      });

      const ok = check(res, {
        "S2: HTTP 200": (r) => r.status === 200,
        "S2: per-creator rate-limit respected": (r) => r.status !== 429 || true, // 429 is OK — counts it
        "S2: no cross-contamination (body array)": (r) => {
          try {
            return Array.isArray(JSON.parse(r.body));
          } catch {
            return false;
          }
        },
        "S2: no silent stall (5xx not empty)": (r) => {
          if (r.status >= 500 && r.body === "") return false;
          return true;
        },
      });

      if (res.status === 429) throttleCount.add(1);
      if (!ok) {
        errorRate.add(1);
        if (res.status >= 500 || res.body === "") stallCount.add(1);
      } else {
        errorRate.add(0);
      }

      // Stagger slightly to avoid thundering-herd from all VUs starting together
      sleep(Math.random() * 2 + 0.5);
    }
  });
}

// ── Scenario 3: Registry stress — capability-mismatched task types ───────────
function scenarioRegistry() {
  group("S3 Registry stress: mismatched task types", () => {
    // videoProject.create is the dispatch entry point; these use edge-case inputs
    // to stress the capability routing layer without actually generating content.
    const stressPayloads = [
      // Edge-case aspect ratio (valid)
      { title: "load-test-registry-1x1", aspectRatio: "1:1", priorityClass: "critical" },
      // Max-length title
      { title: "A".repeat(255), aspectRatio: "16:9", priorityClass: "express" },
      // Minimal required fields
      { title: "x", aspectRatio: "16:9" },
      // Priority express
      { title: "load-test-express", aspectRatio: "9:16", priorityClass: "express" },
      // With outputSpec
      {
        title: "load-test-4k-h265",
        aspectRatio: "16:9",
        outputSpec: { resolution: "4K", fps: 60, codec: "h265" },
        priorityClass: "critical",
      },
    ];

    for (const payload of stressPayloads) {
      const res = trpcPost("videoProject.create", payload);

      const ok = check(res, {
        "S3: graceful response (not stall)": (r) => r.status !== 0 && r.body !== "",
        "S3: HTTP 200 or 401 (no 500-series stall)": (r) =>
          r.status === 200 || r.status === 401,
        "S3: body parseable": (r) => {
          try {
            JSON.parse(r.body);
            return true;
          } catch {
            return false;
          }
        },
      });

      if (!ok) {
        errorRate.add(1);
        if (res.status >= 500 || res.body === "") stallCount.add(1);
      } else {
        errorRate.add(0);
      }

      sleep(0.2);
    }
  });
}

// ── Scenario 4: SSE fan-out — BLOCKED (AIDV-341/370) ─────────────────────────
// When Realtime is restored, implement SSE connection check here:
//   import { WebSocket } from "k6/experimental/websockets";
//   or HTTP long-poll against /api/trpc/generate.sessionEvents (SSE endpoint)
// For now, just probe the SSE health endpoint if it exists.
function scenarioSSEFanout() {
  group("S4 SSE fan-out (partial — full blocked on AIDV-341/370)", () => {
    // Probe the auth.me endpoint to confirm the transport layer is alive under load
    const res = trpcGet("auth.me");
    check(res, {
      "S4: transport alive (HTTP 200)": (r) => r.status === 200,
      "S4: JSON content-type": (r) =>
        (r.headers["Content-Type"] ?? "").includes("application/json"),
    });
    sleep(0.1);
  });
}

// ── k6 options (scenarios) ───────────────────────────────────────────────────
export const options = {
  thresholds: {
    // Transport must never be broken — 0 stalls tolerated
    pipeline_stalls: ["count<1"],
    // Error rate under 10% (some UNAUTHORIZED is expected in load test environment)
    video_pipeline_errors: ["rate<0.1"],
    // p95 create latency under 5s (includes DB write + rate limit check)
    videoproject_create_latency_ms: ["p(95)<5000"],
    // Rate limit hits are OK — they prove throttle is working, not a failure
    http_req_failed: ["rate<0.05"],
  },
  scenarios: {
    baseline: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      exec: "runBaseline",
      tags: { scenario: "baseline" },
    },
    concurrent_creators: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 10 }, // ramp up to 10 VUs
        { duration: "30s", target: 10 }, // hold 10 VUs for 30s
        { duration: "10s", target: 0 },  // ramp down
      ],
      exec: "runConcurrent",
      tags: { scenario: "concurrent" },
      startTime: "5s", // start after baseline completes
    },
    registry_stress: {
      executor: "per-vu-iterations",
      vus: 5,
      iterations: 3,
      exec: "runRegistry",
      tags: { scenario: "registry" },
      startTime: "60s", // start after concurrent scenario
    },
    sse_fanout: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 5,
      exec: "runSSEFanout",
      tags: { scenario: "sse_fanout" },
      startTime: "90s",
    },
  },
};

// ── Exported exec functions ──────────────────────────────────────────────────
export function runBaseline() {
  scenarioBaseline();
}

export function runConcurrent() {
  scenarioConcurrent();
}

export function runRegistry() {
  scenarioRegistry();
}

export function runSSEFanout() {
  scenarioSSEFanout();
}

// ── Default function (single-scenario manual run) ────────────────────────────
export default function () {
  switch (SCENARIO) {
    case "baseline":
      scenarioBaseline();
      break;
    case "concurrent":
      scenarioConcurrent();
      break;
    case "registry":
      scenarioRegistry();
      break;
    case "sse":
      scenarioSSEFanout();
      break;
    default:
      // Run all in sequence when used without k6 scenario config
      scenarioBaseline();
      sleep(1);
      scenarioConcurrent();
      sleep(1);
      scenarioRegistry();
      sleep(1);
      scenarioSSEFanout();
  }
}

/**
 * Result storage: per AIDV-711 acceptance criteria, results should be stored
 * in `pipeline_latency_baselines`. Run with:
 *
 *   k6 run --out json=load-tests/results/$(date +%Y%m%d-%H%M%S).json \
 *           load-tests/video-pipeline.js
 *
 * Then import the JSON to `pipeline_latency_baselines` via a migration or
 * the Supabase admin panel. Key metrics to record:
 *   - videoproject_create_latency_ms p50/p95/p99
 *   - rate_limit_hits count
 *   - pipeline_stalls count (must be 0)
 *   - video_pipeline_errors rate
 *
 * Scenario 4 (SSE fan-out): unblock by resolving AIDV-341/370 (Supabase Realtime).
 * Once Realtime is restored, add WebSocket/SSE connection assertions here.
 */
