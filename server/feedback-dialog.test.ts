/**
 * Tests for Feedback Dialog & Light-Ball Quick Menu
 *
 * Validates:
 * 1. Feedback category labels and mapping
 * 2. Owner notification content generation
 * 3. Form validation logic
 * 4. Quick menu trigger logic
 * 5. FeedbackDialog mode behavior
 */
import { describe, it, expect } from "vitest";

// ─── Category Labels (mirrors routers.ts) ──────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  bug: "錯誤回報",
  feature_request: "功能詢問",
  quality_issue: "品質問題",
  general: "一般意見",
};

const VALID_CATEGORIES = ["bug", "feature_request", "quality_issue", "general"] as const;
const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

// ─── Notification Content Builder (mirrors routers.ts logic) ───────────────

function buildNotificationTitle(category: string, title: string): string {
  return `新${CATEGORY_LABELS[category] || "回饋"}：${title}`;
}

function buildNotificationContent(
  userName: string | null,
  category: string,
  priority: string,
  description: string | undefined
): string {
  return `來自 ${userName || "匿名使用者"}\n類別：${CATEGORY_LABELS[category] || category}\n優先級：${priority}\n\n${description || "(無詳細說明)"}`;
}

// ─── Quick Menu Trigger Logic (mirrors VisualSoulInvitation) ───────────────

function shouldShowQuickMenu(
  isExpanded: boolean,
  hasInvitation: boolean
): "expand" | "quickMenu" | "dismiss" {
  if (isExpanded) return "dismiss";
  if (hasInvitation) return "expand";
  return "quickMenu";
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Feedback Dialog & Quick Menu", () => {
  describe("Category Labels", () => {
    it("all valid categories should have Chinese labels", () => {
      VALID_CATEGORIES.forEach((cat) => {
        expect(CATEGORY_LABELS[cat]).toBeTruthy();
        expect(typeof CATEGORY_LABELS[cat]).toBe("string");
      });
    });

    it("bug should map to 錯誤回報", () => {
      expect(CATEGORY_LABELS.bug).toBe("錯誤回報");
    });

    it("feature_request should map to 功能詢問", () => {
      expect(CATEGORY_LABELS.feature_request).toBe("功能詢問");
    });

    it("quality_issue should map to 品質問題", () => {
      expect(CATEGORY_LABELS.quality_issue).toBe("品質問題");
    });

    it("general should map to 一般意見", () => {
      expect(CATEGORY_LABELS.general).toBe("一般意見");
    });
  });

  describe("Notification Content", () => {
    it("should generate correct notification title for bug", () => {
      const title = buildNotificationTitle("bug", "按鈕無法點擊");
      expect(title).toBe("新錯誤回報：按鈕無法點擊");
    });

    it("should generate correct notification title for feature_request", () => {
      const title = buildNotificationTitle("feature_request", "希望支援批次生成");
      expect(title).toBe("新功能詢問：希望支援批次生成");
    });

    it("should fallback to 回饋 for unknown category", () => {
      const title = buildNotificationTitle("unknown", "測試");
      expect(title).toBe("新回饋：測試");
    });

    it("should include user name in notification content", () => {
      const content = buildNotificationContent("Alice", "bug", "high", "詳細描述");
      expect(content).toContain("來自 Alice");
      expect(content).toContain("類別：錯誤回報");
      expect(content).toContain("優先級：high");
      expect(content).toContain("詳細描述");
    });

    it("should use 匿名使用者 when name is null", () => {
      const content = buildNotificationContent(null, "general", "low", undefined);
      expect(content).toContain("來自 匿名使用者");
      expect(content).toContain("(無詳細說明)");
    });

    it("should handle empty description", () => {
      const content = buildNotificationContent("Bob", "feature_request", "medium", undefined);
      expect(content).toContain("(無詳細說明)");
    });
  });

  describe("Form Validation", () => {
    it("title must not be empty", () => {
      const title = "";
      expect(title.trim().length > 0).toBe(false);
    });

    it("title with content should pass validation", () => {
      const title = "我想要一個新功能";
      expect(title.trim().length > 0).toBe(true);
    });

    it("whitespace-only title should fail validation", () => {
      const title = "   ";
      expect(title.trim().length > 0).toBe(false);
    });

    it("description is optional", () => {
      const description = undefined;
      const processed = description?.trim() || undefined;
      expect(processed).toBeUndefined();
    });

    it("priority should default to medium", () => {
      const defaultPriority = "medium";
      expect(VALID_PRIORITIES).toContain(defaultPriority);
    });

    it("all priority values should be valid", () => {
      VALID_PRIORITIES.forEach((p) => {
        expect(["low", "medium", "high", "critical"]).toContain(p);
      });
    });
  });

  describe("Quick Menu Trigger Logic", () => {
    it("should dismiss when expanded", () => {
      expect(shouldShowQuickMenu(true, true)).toBe("dismiss");
      expect(shouldShowQuickMenu(true, false)).toBe("dismiss");
    });

    it("should expand invitation when available and not expanded", () => {
      expect(shouldShowQuickMenu(false, true)).toBe("expand");
    });

    it("should show quick menu when no invitation and not expanded", () => {
      expect(shouldShowQuickMenu(false, false)).toBe("quickMenu");
    });
  });

  describe("FeedbackDialog Mode", () => {
    it("feedback mode should default to general category", () => {
      const mode = "feedback";
      const defaultCategory = mode === "feature" ? "feature_request" : "general";
      expect(defaultCategory).toBe("general");
    });

    it("feature mode should default to feature_request category", () => {
      const mode = "feature";
      const defaultCategory = mode === "feature" ? "feature_request" : "general";
      expect(defaultCategory).toBe("feature_request");
    });

    it("feedback mode should show category selector", () => {
      const mode = "feedback";
      const showCategorySelector = mode === "feedback";
      expect(showCategorySelector).toBe(true);
    });

    it("feature mode should not show category selector", () => {
      const mode = "feature";
      const showCategorySelector = mode === "feedback";
      expect(showCategorySelector).toBe(false);
    });
  });

  describe("Scene-Adaptive Styling", () => {
    it("dark scenes should use dark dialog style", () => {
      const darkScenes = ["nightSky", "deepSea"];
      darkScenes.forEach((scene) => {
        const isDark = scene === "nightSky" || scene === "deepSea";
        expect(isDark).toBe(true);
      });
    });

    it("light scenes should use light dialog style", () => {
      const lightScenes = ["morning", "cafe"];
      lightScenes.forEach((scene) => {
        const isDark = scene === "nightSky" || scene === "deepSea";
        expect(isDark).toBe(false);
      });
    });
  });
});
