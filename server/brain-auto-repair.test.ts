/**
 * Brain Auto-Repair Service — Vitest Tests
 * ────────────────────────────────────────────────────────────────────────────
 * Issue #165 acceptance criteria require a passing test suite, but the
 * 2k-line brainAutoRepair service was previously untested. These tests lock
 * in the regression-critical pure-logic paths: error classification, root
 * cause diagnosis, reflection proposal lifecycle, alert dismissal, web
 * research → learn-hub linkage, and the no-API-key safety branch of
 * runAccuracyTest. Network-bound functions are exercised through a stubbed
 * fetch so the suite is hermetic.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// ─── Module mocks (must be hoisted before importing under test) ─────────────

const reportEngineFailureMock = vi.fn();
const reportEngineRecoveryMock = vi.fn();
const getHealthSnapshotMock = vi.fn(
  () => ({}) as Record<string, { healthy: boolean; consecutiveFailures: number }>
);

vi.mock("./middleware/brainContext", () => ({
  reportEngineFailure: reportEngineFailureMock,
  reportEngineRecovery: reportEngineRecoveryMock,
  getHealthSnapshot: getHealthSnapshotMock,
  BrainAuditLogger: {
    configLoaded: vi.fn(),
    degradation: vi.fn(),
    engineFailure: vi.fn(),
    engineRecovery: vi.fn(),
  },
}));

const learnDocStore = new Map<string, unknown>();
const addLearnDocMock = vi.fn((doc: { id: string }) => {
  learnDocStore.set(doc.id, doc);
});
const hasLearnDocMock = vi.fn((id: string) => learnDocStore.has(id));

vi.mock("./routers/learnHub", () => ({
  addLearnDoc: addLearnDocMock,
  hasLearnDoc: hasLearnDocMock,
}));

vi.mock("./_core/env", () => ({
  ENV: {
    braveSearchApiKey: "",
    geminiApiKey: "",
  },
}));

vi.mock("./_core/env.validated", () => ({
  serverEnv: {
    NVIDIA_API: "",
    FAL_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    REPLICATE_API_TOKEN: "",
    GEMINI_API_KEY: "",
    GITHUB_TOKEN: "",
    GITHUB_REPO: "",
  },
}));

// ─── Fetch stub ─────────────────────────────────────────────────────────────

type FetchMock = Mock<typeof fetch>;

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: FetchMock;

beforeEach(() => {
  learnDocStore.clear();
  reportEngineFailureMock.mockClear();
  reportEngineRecoveryMock.mockClear();
  getHealthSnapshotMock.mockClear();
  addLearnDocMock.mockClear();
  hasLearnDocMock.mockClear();

  // Default: every fetch returns an empty result so autoSearchForFix
  // doesn't synthesise extra proposals during unrelated tests.
  fetchMock = vi.fn(async () => makeJsonResponse({})) as FetchMock;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  // Each test gets a fresh copy of the in-memory stores.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadModule() {
  return import("./services/brainAutoRepair");
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Error classification & root cause enrichment
// ════════════════════════════════════════════════════════════════════════════

describe("recordErrorTrace — error classification", () => {
  const cases: Array<{
    label: string;
    errorMessage: string;
    errorCode?: string;
    expectedCategory: string;
  }> = [
    {
      label: "rate_limit (429)",
      errorMessage: "429 Too Many Requests",
      expectedCategory: "rate_limit",
    },
    {
      label: "auth_failure (401)",
      errorMessage: "401 Unauthorized: API key invalid",
      expectedCategory: "auth_failure",
    },
    {
      label: "connection (ECONNREFUSED)",
      errorMessage: "fetch failed: ECONNREFUSED 127.0.0.1:443",
      expectedCategory: "connection",
    },
    {
      label: "timeout (ETIMEDOUT)",
      errorMessage: "Request aborted: ETIMEDOUT after 30s",
      expectedCategory: "timeout",
    },
    {
      label: "missing_api (model not found)",
      errorMessage: "404 model not found: foo",
      expectedCategory: "missing_api",
    },
    {
      label: "validation (400 bad request)",
      errorMessage: "400 Bad Request: required field missing",
      expectedCategory: "validation",
    },
    {
      label: "server_error (500)",
      errorMessage: "500 Internal Server Error from upstream",
      expectedCategory: "server_error",
    },
    {
      label: "quota_exceeded (billing)",
      errorMessage: "Billing: credit insufficient",
      expectedCategory: "quota_exceeded",
    },
    {
      label: "model_unavailable (deprecated)",
      errorMessage: "Model is deprecated and no longer served",
      expectedCategory: "model_unavailable",
    },
    {
      label: "broken_link (CDN unavailable)",
      errorMessage: "CDN error: resource unavailable at edge",
      expectedCategory: "broken_link",
    },
  ];

  for (const tc of cases) {
    it(`classifies "${tc.label}"`, async () => {
      const { recordErrorTrace } = await loadModule();
      const trace = recordErrorTrace({
        userId: 1,
        modality: "image",
        engine: "fal-ai/flux-pro/v1.1",
        prompt: "test",
        errorMessage: tc.errorMessage,
        errorCode: tc.errorCode,
      });

      expect(trace.errorCategory).toBe(tc.expectedCategory);
      expect(trace.rootCause).toBeDefined();
      expect(trace.rootCauseConfidence).toBe(85);
      expect(trace.suggestedSteps?.length).toBeGreaterThan(0);
    });
  }

  it("falls back to unknown category for unrecognised errors", async () => {
    const { recordErrorTrace } = await loadModule();
    const trace = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "test",
      errorMessage: "totally novel failure mode that nobody has seen before",
    });

    expect(trace.errorCategory).toBe("unknown");
    expect(trace.rootCauseConfidence).toBe(0);
    expect(trace.suggestedSteps).toBeUndefined();
  });

  it("assigns id and createdAt to new traces", async () => {
    const { recordErrorTrace } = await loadModule();
    const before = Date.now();
    const trace = recordErrorTrace({
      userId: 1,
      modality: "video",
      engine: "fal-ai/kling-video/v2.1/standard/text-to-video",
      prompt: "test",
      errorMessage: "429 rate limit",
    });
    expect(trace.id).toMatch(/^err_/);
    expect(trace.createdAt).toBeGreaterThanOrEqual(before);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. getErrorTraces / resolveErrorTrace
// ════════════════════════════════════════════════════════════════════════════

describe("error trace listing & resolution", () => {
  it("filters error traces by modality", async () => {
    const { recordErrorTrace, getErrorTraces } = await loadModule();
    recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "401 unauthorized",
    });
    recordErrorTrace({
      userId: 1,
      modality: "video",
      engine: "fal-ai/wan/v2.2-14b",
      prompt: "p",
      errorMessage: "500 server error",
    });

    const images = getErrorTraces(50, "image");
    const videos = getErrorTraces(50, "video");
    expect(images.every(t => t.modality === "image")).toBe(true);
    expect(videos.every(t => t.modality === "video")).toBe(true);
    expect(images.length).toBe(1);
    expect(videos.length).toBe(1);
  });

  it("respects the limit parameter", async () => {
    const { recordErrorTrace, getErrorTraces } = await loadModule();
    for (let i = 0; i < 5; i++) {
      recordErrorTrace({
        userId: 1,
        modality: "image",
        engine: "fal-ai/flux-pro/v1.1",
        prompt: "p",
        errorMessage: `error ${i}`,
      });
    }
    expect(getErrorTraces(3).length).toBe(3);
  });

  it("returns newest traces first", async () => {
    const { recordErrorTrace, getErrorTraces } = await loadModule();
    const first = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "first",
    });
    const second = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "second",
    });
    const traces = getErrorTraces();
    expect(traces[0].id).toBe(second.id);
    expect(traces[1].id).toBe(first.id);
  });

  it("resolveErrorTrace marks resolution & timestamp", async () => {
    const { recordErrorTrace, resolveErrorTrace, getErrorTraces } =
      await loadModule();
    const trace = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "401 unauthorized",
    });
    expect(resolveErrorTrace(trace.id, "rotated API key")).toBe(true);
    const stored = getErrorTraces().find(t => t.id === trace.id);
    expect(stored?.resolution).toBe("rotated API key");
    expect(stored?.resolvedAt).toBeTypeOf("number");
  });

  it("resolveErrorTrace returns false for unknown id", async () => {
    const { resolveErrorTrace } = await loadModule();
    expect(resolveErrorTrace("does-not-exist", "n/a")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. diagnoseError
// ════════════════════════════════════════════════════════════════════════════

describe("diagnoseError", () => {
  it("returns null for unknown trace id", async () => {
    const { diagnoseError } = await loadModule();
    expect(diagnoseError("err_missing")).toBeNull();
  });

  it("returns full diagnosis for a classified trace", async () => {
    const { recordErrorTrace, diagnoseError } = await loadModule();
    const trace = recordErrorTrace({
      userId: 1,
      modality: "llm",
      engine: "gemini-2.5-flash",
      prompt: "p",
      errorMessage: "429 rate limit exceeded",
    });
    const diagnosis = diagnoseError(trace.id);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis?.errorCategory).toBe("rate_limit");
    expect(diagnosis?.rootCauseConfidence).toBeGreaterThanOrEqual(85);
    expect(diagnosis?.suggestedSteps.length).toBeGreaterThan(0);
    expect(diagnosis?.searchQueries.length).toBeGreaterThan(0);
  });

  it("boosts confidence when several related traces exist", async () => {
    const { recordErrorTrace, diagnoseError } = await loadModule();
    // Three related rate-limit traces on the same engine increase confidence.
    for (let i = 0; i < 3; i++) {
      recordErrorTrace({
        userId: 1,
        modality: "llm",
        engine: "gemini-2.5-flash",
        prompt: "p",
        errorMessage: "429 too many requests",
      });
    }
    const target = recordErrorTrace({
      userId: 1,
      modality: "llm",
      engine: "gemini-2.5-flash",
      prompt: "p",
      errorMessage: "429 too many requests",
    });
    const diagnosis = diagnoseError(target.id);
    expect(diagnosis?.rootCauseConfidence).toBeGreaterThan(85);
    expect(diagnosis?.rootCauseConfidence).toBeLessThanOrEqual(95);
    expect(diagnosis?.relatedTraceIds.length).toBeGreaterThanOrEqual(2);
  });

  it("returns low confidence + generic steps for unknown errors", async () => {
    const { recordErrorTrace, diagnoseError } = await loadModule();
    const trace = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "completely unrecognised gobbledygook",
    });
    const diagnosis = diagnoseError(trace.id);
    expect(diagnosis?.errorCategory).toBe("unknown");
    expect(diagnosis?.rootCauseConfidence).toBe(30);
    expect(diagnosis?.suggestedSteps.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Reflection proposal lifecycle
// ════════════════════════════════════════════════════════════════════════════

describe("reflection proposals", () => {
  function baseProposalInput() {
    return {
      category: "prompt_optimization" as const,
      title: "Tighten storyteller prompt",
      description: "Reduce token usage by 20%",
      currentValue: "old prompt",
      proposedValue: "new prompt",
      reasoning: "Recent error rate dropped after pilot.",
      confidence: 72,
    };
  }

  it("createReflectionProposal produces a pending entry", async () => {
    const { createReflectionProposal } = await loadModule();
    const proposal = createReflectionProposal(baseProposalInput());
    expect(proposal.status).toBe("pending");
    expect(proposal.id).toMatch(/^prop_/);
    expect(proposal.createdAt).toBeTypeOf("number");
  });

  it("getProposals filters by status", async () => {
    const { createReflectionProposal, getProposals, approveProposal } =
      await loadModule();
    const p1 = createReflectionProposal(baseProposalInput());
    createReflectionProposal(baseProposalInput());
    await approveProposal(p1.id, 99);

    expect(getProposals("pending").length).toBe(1);
    expect(getProposals("approved").length).toBe(1);
    expect(getProposals().length).toBe(2);
  });

  it("approveProposal updates status and audit fields", async () => {
    const { createReflectionProposal, approveProposal, getProposals } =
      await loadModule();
    const proposal = createReflectionProposal(baseProposalInput());
    const result = await approveProposal(proposal.id, 7, "looks good");
    expect(result.ok).toBe(true);
    const stored = getProposals().find(p => p.id === proposal.id);
    expect(stored?.status).toBe("approved");
    expect(stored?.reviewedBy).toBe(7);
    expect(stored?.reviewedAt).toBeTypeOf("number");
    expect(stored?.appliedAt).toBeTypeOf("number");
    expect(stored?.adminNote).toBe("looks good");
  });

  it("rejectProposal updates status and clears appliedAt", async () => {
    const { createReflectionProposal, rejectProposal, getProposals } =
      await loadModule();
    const proposal = createReflectionProposal(baseProposalInput());
    expect(rejectProposal(proposal.id, 7, "risk too high")).toBe(true);
    const stored = getProposals().find(p => p.id === proposal.id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.adminNote).toBe("risk too high");
    expect(stored?.appliedAt).toBeUndefined();
  });

  it("approve/reject return false for non-pending or unknown proposals", async () => {
    const { createReflectionProposal, approveProposal, rejectProposal } =
      await loadModule();
    const proposal = createReflectionProposal(baseProposalInput());
    await approveProposal(proposal.id, 7);
    // Already approved → cannot approve or reject again.
    expect((await approveProposal(proposal.id, 7)).ok).toBe(false);
    expect(rejectProposal(proposal.id, 7)).toBe(false);
    expect((await approveProposal("prop_unknown", 7)).ok).toBe(false);
    expect(rejectProposal("prop_unknown", 7)).toBe(false);
  });

  it("createReflectionProposal dedups pending entries by dedupKey", async () => {
    const { createReflectionProposal, getProposals } = await loadModule();
    const first = createReflectionProposal({
      ...baseProposalInput(),
      title: "first",
      dedupKey: "test-dedup",
      severity: "medium",
    });
    const second = createReflectionProposal({
      ...baseProposalInput(),
      title: "second (updated)",
      dedupKey: "test-dedup",
      severity: "high",
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("second (updated)");
    expect(second.severity).toBe("high");
    expect(second.updatedAt).toBeTypeOf("number");
    expect(getProposals("pending").length).toBe(1);
  });

  it("getProposals sorts by severity (critical first)", async () => {
    const { createReflectionProposal, getProposals } = await loadModule();
    createReflectionProposal({ ...baseProposalInput(), severity: "low", title: "L" });
    createReflectionProposal({ ...baseProposalInput(), severity: "critical", title: "C" });
    createReflectionProposal({ ...baseProposalInput(), severity: "medium", title: "M" });

    const titles = getProposals().map(p => p.title);
    expect(titles[0]).toBe("C");
    expect(titles[titles.length - 1]).toBe("L");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Alerts (dismissAlert / getActiveAlertCount via runHealthPatrol)
// ════════════════════════════════════════════════════════════════════════════

describe("alert dismissal & summaries", () => {
  it("dismissAlert returns false for missing id", async () => {
    const { dismissAlert } = await loadModule();
    expect(dismissAlert("alert_missing", 1)).toBe(false);
  });

  it("getActiveAlertCount and getAlerts start at zero", async () => {
    const { getActiveAlertCount, getAlerts } = await loadModule();
    expect(getActiveAlertCount()).toBe(0);
    expect(getAlerts()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. ERROR_CATEGORY_LABELS
// ════════════════════════════════════════════════════════════════════════════

describe("ERROR_CATEGORY_LABELS", () => {
  it("provides a label for every known category", async () => {
    const { ERROR_CATEGORY_LABELS } = await loadModule();
    const expectedKeys = [
      "rate_limit",
      "auth_failure",
      "connection",
      "timeout",
      "missing_api",
      "broken_link",
      "validation",
      "server_error",
      "quota_exceeded",
      "model_unavailable",
      "unknown",
    ];
    for (const key of expectedKeys) {
      expect(
        ERROR_CATEGORY_LABELS[key as keyof typeof ERROR_CATEGORY_LABELS]
      ).toBeTruthy();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. webSearch + addResearchToLearnHub
// ════════════════════════════════════════════════════════════════════════════

describe("webSearch (GitHub fallback)", () => {
  it("returns GitHub repo entries when Brave key is unset", async () => {
    fetchMock.mockImplementationOnce(async () =>
      makeJsonResponse({
        items: [
          {
            full_name: "acme/repair-toolkit",
            description: "Auto-repair examples",
            html_url: "https://github.com/acme/repair-toolkit",
            stargazers_count: 250,
          },
        ],
      })
    );

    const { webSearch } = await loadModule();
    const results = await webSearch("test query", 1);
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("GitHub");
    expect(results[0].url).toBe("https://github.com/acme/repair-toolkit");
    expect(results[0].relevance).toBeGreaterThanOrEqual(50);
  });

  it("returns an empty array when fetch throws", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const { webSearch } = await loadModule();
    const results = await webSearch("anything", 1);
    expect(results).toEqual([]);
  });
});

describe("addResearchToLearnHub", () => {
  it("returns false for unknown research id", async () => {
    const { addResearchToLearnHub } = await loadModule();
    expect(addResearchToLearnHub("web_missing")).toBe(false);
  });

  it("adds a learn-hub doc for a freshly fetched research result", async () => {
    fetchMock.mockImplementationOnce(async () =>
      makeJsonResponse({
        items: [
          {
            full_name: "acme/diagnostics",
            description: "Diagnostics helpers",
            html_url: "https://github.com/acme/diagnostics",
            stargazers_count: 30,
          },
        ],
      })
    );

    const { webSearch, addResearchToLearnHub, getResearchResults } =
      await loadModule();
    const fetched = await webSearch("diagnostics", 1);
    expect(fetched.length).toBe(1);

    const stored = getResearchResults().find(r => r.id === fetched[0].id);
    expect(stored).toBeDefined();
    expect(addResearchToLearnHub(stored!.id)).toBe(true);
    // Second call is a no-op because addedToLearnHub is now true.
    expect(addResearchToLearnHub(stored!.id)).toBe(false);
    expect(addLearnDocMock).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. runAccuracyTest — no-API-key safety branch
// ════════════════════════════════════════════════════════════════════════════

describe("runAccuracyTest (no API key)", () => {
  it("returns score 0 with helpful suggestion when GEMINI_API_KEY is unset", async () => {
    const { runAccuracyTest, getAccuracyTests, getProposals } =
      await loadModule();
    const result = await runAccuracyTest(
      "gemini-2.5-flash",
      "response_quality",
      "describe a tree",
      "should describe a tree"
    );

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.actualResult).toContain("GEMINI_API_KEY");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(getAccuracyTests().length).toBe(1);
    // Failing tests automatically generate a proposal for admin review.
    expect(getProposals().length).toBeGreaterThanOrEqual(1);
    expect(result.proposal?.category).toBe("accuracy_fix");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. getSystemSummary
// ════════════════════════════════════════════════════════════════════════════

describe("getSystemSummary", () => {
  it("reports zeroed metrics on a fresh module", async () => {
    const { getSystemSummary } = await loadModule();
    const summary = getSystemSummary();
    expect(summary.activeAlerts).toBe(0);
    expect(summary.unresolvedErrors).toBe(0);
    expect(summary.pendingProposals).toBe(0);
    expect(summary.totalResearch).toBe(0);
    expect(summary.recentTestScore).toBeNull();
  });

  it("counts unresolved errors and pending proposals", async () => {
    const {
      recordErrorTrace,
      createReflectionProposal,
      getSystemSummary,
      resolveErrorTrace,
    } = await loadModule();

    const t1 = recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "429 rate limit",
    });
    recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      errorMessage: "401 unauthorized",
    });
    createReflectionProposal({
      category: "prompt_optimization",
      title: "x",
      description: "x",
      currentValue: "a",
      proposedValue: "b",
      reasoning: "x",
      confidence: 50,
    });
    resolveErrorTrace(t1.id, "fixed");

    const summary = getSystemSummary();
    expect(summary.unresolvedErrors).toBe(1);
    expect(summary.pendingProposals).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 10. runHealthPatrol — happy path with all providers reachable
// ════════════════════════════════════════════════════════════════════════════

describe("runHealthPatrol", () => {
  it("returns the count of checked engines+providers when all providers respond OK", async () => {
    fetchMock.mockImplementation(async () => makeJsonResponse({}, 200));
    getHealthSnapshotMock.mockReturnValueOnce({});

    const { runHealthPatrol } = await loadModule();
    const result = await runHealthPatrol();
    expect(result.checked).toBeGreaterThan(0);
    expect(result.alerts).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 11. getSystemSummary — new severity / source / scan / github fields
// ════════════════════════════════════════════════════════════════════════════

describe("getSystemSummary — extended fields", () => {
  it("exposes severity / source breakdown and github flag", async () => {
    const { createReflectionProposal, getSystemSummary } = await loadModule();
    createReflectionProposal({
      category: "security_fix",
      title: "x",
      description: "x",
      currentValue: "a",
      proposedValue: "b",
      reasoning: "y",
      confidence: 80,
      severity: "critical",
      source: "code_scan",
    });
    createReflectionProposal({
      category: "performance_fix",
      title: "y",
      description: "y",
      currentValue: "a",
      proposedValue: "b",
      reasoning: "y",
      confidence: 60,
      severity: "medium",
      source: "accuracy_test",
    });

    const summary = getSystemSummary();
    expect(summary.pendingBySeverity.critical).toBe(1);
    expect(summary.pendingBySeverity.medium).toBe(1);
    expect(summary.pendingBySource.code_scan).toBe(1);
    expect(summary.pendingBySource.accuracy_test).toBe(1);
    expect(summary.githubConfigured).toBe(false);
    expect(summary.lastScan).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 12. generateProposalsFromErrorTraces — recurring error → auto proposal
// ════════════════════════════════════════════════════════════════════════════

describe("generateProposalsFromErrorTraces", () => {
  it("emits a proposal when an engine hits the threshold", async () => {
    const {
      recordErrorTrace,
      generateProposalsFromErrorTraces,
      getProposals,
    } = await loadModule();

    for (let i = 0; i < 4; i++) {
      recordErrorTrace({
        userId: 1,
        modality: "image",
        engine: "fal-ai/flux-pro/v1.1",
        prompt: "p",
        errorMessage: "429 Too Many Requests",
      });
    }

    const result = generateProposalsFromErrorTraces({ threshold: 3 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const proposal = result[0];
    expect(proposal.source).toBe("error_trace");
    expect(proposal.dedupKey).toBe("errors:fal-ai/flux-pro/v1.1:rate_limit");
    expect(proposal.severity).toMatch(/medium|high|critical/);
    expect(getProposals("pending").length).toBeGreaterThanOrEqual(1);

    // Re-running should dedup (no new pending proposal).
    const before = getProposals("pending").length;
    generateProposalsFromErrorTraces({ threshold: 3 });
    expect(getProposals("pending").length).toBe(before);
  });

  it("ignores groups below threshold", async () => {
    const { recordErrorTrace, generateProposalsFromErrorTraces } =
      await loadModule();
    recordErrorTrace({
      userId: 1,
      modality: "image",
      engine: "engine-a",
      prompt: "p",
      errorMessage: "401 unauthorized",
    });
    const result = generateProposalsFromErrorTraces({ threshold: 3 });
    expect(result.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 13. proposalToIssueBody — markdown rendering for GitHub
// ════════════════════════════════════════════════════════════════════════════

describe("proposalToIssueBody", () => {
  it("renders severity, file path, snippet, and reasoning into Markdown", async () => {
    const { proposalToIssueBody } = await loadModule();
    const md = proposalToIssueBody({
      id: "prop_test",
      category: "security_fix",
      severity: "critical",
      source: "code_scan",
      title: "test",
      description: "Eval risk",
      currentValue: "eval(input)",
      proposedValue: "use JSON.parse",
      reasoning: "eval enables arbitrary code execution",
      confidence: 95,
      status: "pending",
      filePath: "server/foo.ts",
      lineNumber: 42,
      codeSnippet: "eval(userInput)",
      createdAt: 0,
    });
    expect(md).toContain("**嚴重度**：`CRITICAL`");
    expect(md).toContain("server/foo.ts");
    expect(md).toContain("eval(userInput)");
    expect(md).toContain("use JSON.parse");
  });
});
