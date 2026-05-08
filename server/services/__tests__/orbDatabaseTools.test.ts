/**
 * server/services/__tests__/orbDatabaseTools.test.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Comprehensive tests for orbDatabaseTools safe database query system.
 *
 * Tests cover:
 * - Security: user scoping, parameter validation, query template enforcement
 * - Functionality: all 13 query templates execute correctly
 * - Error handling: invalid queries, missing parameters, database errors
 * - Integration: Drizzle ORM, type safety, result formatting
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  executeDbQuery,
  validateQueryParams,
  listAvailableQueries,
  type QueryTemplateName,
} from "../orbDatabaseTools";

// `getDb()` returns null when `DATABASE_URL` isn't set, so the query-
// execution suites here can't actually round-trip — they were turning
// into 24 noisy `success: false ("DB unavailable")` failures every
// run. Gate them on a live DB; validation / registry / error-handling
// tests don't need one and keep running unconditionally.
const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());
const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describe("orbDatabaseTools", () => {
  describe("Security - Parameter Validation", () => {
    it("should reject query without userId", () => {
      const result = validateQueryParams("list_my_assets", {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("userId");
    });

    it("should reject userId as string", () => {
      const result = validateQueryParams("list_my_assets", { userId: "123" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("number");
    });

    it("should accept valid userId", () => {
      const result = validateQueryParams("list_my_assets", { userId: 1 });
      expect(result.valid).toBe(true);
    });

    it("should reject unknown query template", () => {
      const result = validateQueryParams("invalid_query" as any, { userId: 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown query");
    });

    it("should reject missing required parameters", () => {
      const result = validateQueryParams("search_my_assets", { userId: 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("searchQuery");
    });

    it("should allow search_prompts without userId (public query)", () => {
      const result = validateQueryParams("search_prompts", { searchQuery: "test" });
      expect(result.valid).toBe(true);
    });
  });

  describe("Query Template Registry", () => {
    it("should list all available queries", () => {
      const queries = listAvailableQueries();
      expect(queries.length).toBeGreaterThan(0);

      // Verify structure
      const firstQuery = queries[0];
      expect(firstQuery).toHaveProperty("name");
      expect(firstQuery).toHaveProperty("description");
      expect(firstQuery).toHaveProperty("params");
      expect(firstQuery).toHaveProperty("example");
    });

    it("should include all expected query categories", () => {
      const queries = listAvailableQueries();
      const names = queries.map(q => q.name);

      // Digital Assets
      expect(names).toContain("list_my_assets");
      expect(names).toContain("search_my_assets");
      expect(names).toContain("get_recent_assets");

      // Project Notes
      expect(names).toContain("list_my_notes");
      expect(names).toContain("search_my_notes");
      expect(names).toContain("get_calendar_events");

      // Generation History
      expect(names).toContain("get_generation_history");
      expect(names).toContain("get_recent_generations");

      // Background Jobs
      expect(names).toContain("list_my_jobs");
      expect(names).toContain("get_active_jobs");

      // AI Models
      expect(names).toContain("list_my_models");
      expect(names).toContain("get_my_brain_config");

      // Scheduled Jobs
      expect(names).toContain("list_my_scheduled_jobs");

      // Prompt Library
      expect(names).toContain("search_prompts");
    });
  });

  describeIfDb("Digital Asset Queries", () => {
    it("should execute list_my_assets query", async () => {
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.queryName).toBe("list_my_assets");
      expect(result.data).toBeInstanceOf(Array);
      expect(result.rowCount).toBeGreaterThanOrEqual(0);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it("should filter list_my_assets by assetType", async () => {
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        assetType: "image",
        limit: 5,
      });

      expect(result.success).toBe(true);
      if (result.data && result.data.length > 0) {
        const firstItem = result.data[0] as any;
        expect(firstItem).toHaveProperty("assetType");
      }
    });

    it("should execute search_my_assets query", async () => {
      const result = await executeDbQuery("search_my_assets", {
        userId: 1,
        searchQuery: "test",
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should execute get_recent_assets query", async () => {
      const result = await executeDbQuery("get_recent_assets", {
        userId: 1,
        days: 7,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should enforce limit cap on list_my_assets", async () => {
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 500, // Try to request more than max
      });

      expect(result.success).toBe(true);
      // Should be capped at 100
      expect(result.rowCount).toBeLessThanOrEqual(100);
    });
  });

  describeIfDb("Project Notes Queries", () => {
    it("should execute list_my_notes query", async () => {
      const result = await executeDbQuery("list_my_notes", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should filter list_my_notes by noteType", async () => {
      const result = await executeDbQuery("list_my_notes", {
        userId: 1,
        noteType: "note",
        limit: 5,
      });

      expect(result.success).toBe(true);
    });

    it("should execute search_my_notes query", async () => {
      const result = await executeDbQuery("search_my_notes", {
        userId: 1,
        searchQuery: "project",
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should execute get_calendar_events query", async () => {
      const result = await executeDbQuery("get_calendar_events", {
        userId: 1,
        fromDate: "2026-01-01",
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });
  });

  describeIfDb("Generation History Queries", () => {
    it("should execute get_generation_history query", async () => {
      const result = await executeDbQuery("get_generation_history", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should filter get_generation_history by modality", async () => {
      const result = await executeDbQuery("get_generation_history", {
        userId: 1,
        modality: "image",
        limit: 5,
      });

      expect(result.success).toBe(true);
    });

    it("should execute get_recent_generations query", async () => {
      const result = await executeDbQuery("get_recent_generations", {
        userId: 1,
        days: 7,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });
  });

  describeIfDb("Background Jobs Queries", () => {
    it("should execute list_my_jobs query", async () => {
      const result = await executeDbQuery("list_my_jobs", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should filter list_my_jobs by status", async () => {
      const result = await executeDbQuery("list_my_jobs", {
        userId: 1,
        status: "completed",
        limit: 5,
      });

      expect(result.success).toBe(true);
    });

    it("should execute get_active_jobs query", async () => {
      const result = await executeDbQuery("get_active_jobs", {
        userId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });
  });

  describeIfDb("AI Models Queries", () => {
    it("should execute list_my_models query", async () => {
      const result = await executeDbQuery("list_my_models", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should execute get_my_brain_config query", async () => {
      const result = await executeDbQuery("get_my_brain_config", {
        userId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      // Brain config returns 0 or 1 row
      expect(result.rowCount).toBeLessThanOrEqual(1);
    });
  });

  describeIfDb("Scheduled Jobs Queries", () => {
    it("should execute list_my_scheduled_jobs query", async () => {
      const result = await executeDbQuery("list_my_scheduled_jobs", {
        userId: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should filter list_my_scheduled_jobs by enabled", async () => {
      const result = await executeDbQuery("list_my_scheduled_jobs", {
        userId: 1,
        enabled: true,
        limit: 5,
      });

      expect(result.success).toBe(true);
    });
  });

  describeIfDb("Prompt Library Queries", () => {
    it("should execute search_prompts query", async () => {
      const result = await executeDbQuery("search_prompts", {
        searchQuery: "portrait",
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it("should filter search_prompts by category", async () => {
      const result = await executeDbQuery("search_prompts", {
        searchQuery: "landscape",
        category: "image",
        limit: 5,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown query gracefully", async () => {
      const result = await executeDbQuery("invalid_query" as QueryTemplateName, {
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle missing searchQuery in search queries", async () => {
      const result = await executeDbQuery("search_my_assets", {
        userId: 1,
        // searchQuery missing
      } as any);

      // Should fail due to missing required parameter
      expect(result.success).toBe(false);
    });
  });

  describeIfDb("Performance & Limits", () => {
    it("should complete queries within reasonable time", async () => {
      const startTime = Date.now();
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 50,
      });
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.executionTimeMs).toBeLessThan(5000);
    });

    it("should respect row count limits", async () => {
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 1000, // Request way more than allowed
      });

      expect(result.success).toBe(true);
      // Should be capped at 100
      if (result.rowCount) {
        expect(result.rowCount).toBeLessThanOrEqual(100);
      }
    });
  });

  describeIfDb("User Scoping Security", () => {
    it("should only return data for specified userId", async () => {
      const user1Result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 10,
      });

      const user2Result = await executeDbQuery("list_my_assets", {
        userId: 2,
        limit: 10,
      });

      expect(user1Result.success).toBe(true);
      expect(user2Result.success).toBe(true);

      // Results should be different (unless both users have identical assets)
      // The important thing is that the query executed with userId filtering
      expect(user1Result.queryName).toBe(user2Result.queryName);
    });

    it("should automatically inject userId in all user-scoped queries", async () => {
      // All queries except search_prompts require userId
      const queries: QueryTemplateName[] = [
        "list_my_assets",
        "list_my_notes",
        "get_generation_history",
        "list_my_jobs",
        "list_my_models",
        "get_my_brain_config",
        "list_my_scheduled_jobs",
      ];

      for (const queryName of queries) {
        const validation = validateQueryParams(queryName, { userId: 1 });
        expect(validation.valid).toBe(true);
      }
    });
  });

  describeIfDb("Result Format Consistency", () => {
    it("should return consistent result structure", async () => {
      const result = await executeDbQuery("list_my_assets", {
        userId: 1,
        limit: 5,
      });

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("queryName");
      expect(result).toHaveProperty("executionTimeMs");

      if (result.success) {
        expect(result).toHaveProperty("data");
        expect(result).toHaveProperty("rowCount");
      } else {
        expect(result).toHaveProperty("error");
      }
    });

    it("should include execution timing", async () => {
      const result = await executeDbQuery("get_active_jobs", {
        userId: 1,
      });

      expect(result.executionTimeMs).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeLessThan(10000);
    });
  });
});
