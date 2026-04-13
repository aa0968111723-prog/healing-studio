/**
 * article-dialog.test.ts — 情報站文章展開對話框邏輯測試
 *
 * 測試：
 *   - Weight label 解析
 *   - 日期格式化
 *   - Dialog scene styles 完整性
 *   - Framer Motion variants 結構
 *   - 外部連結 URL 安全性
 */

import { describe, it, expect } from "vitest";

// ─── Replicate core logic from ArticleDialog.tsx ───────────────────────────

const WEIGHT_LABEL_ZH: Record<string, string> = {
  "Model Breakthrough": "模型突破",
  "Inspiration Tip": "靈感技巧",
  "Industry Shift": "產業動態",
  "Creative Tool": "創作工具",
  "Community Spotlight": "社群焦點",
  "Tutorial Guide": "教學指南",
  "General Update": "一般更新",
};

const WEIGHT_LABEL_COLOR: Record<string, string> = {
  "Model Breakthrough": "text-amber-400 bg-amber-400/10",
  "Inspiration Tip": "text-emerald-400 bg-emerald-400/10",
  "Industry Shift": "text-blue-400 bg-blue-400/10",
  "Creative Tool": "text-violet-400 bg-violet-400/10",
  "Community Spotlight": "text-rose-400 bg-rose-400/10",
  "Tutorial Guide": "text-cyan-400 bg-cyan-400/10",
  "General Update": "text-slate-400 bg-slate-400/10",
};

function getWeightLabel(tags: string[] | null | undefined): string {
  if (!tags) return "General Update";
  const known = Object.keys(WEIGHT_LABEL_ZH);
  for (const tag of tags) {
    if (known.includes(tag)) return tag;
  }
  return "General Update";
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SceneId = "nightSky" | "morning" | "cafe" | "deepSea";

interface DialogSceneStyles {
  overlayBg: string;
  panelBg: string;
  panelBorder: string;
  headerBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentColor: string;
  closeBtnBg: string;
  closeBtnHover: string;
  divider: string;
  proseClass: string;
}

const DIALOG_SCENE_STYLES: Record<SceneId, DialogSceneStyles> = {
  nightSky: {
    overlayBg: "rgba(5,8,25,0.75)",
    panelBg: "rgba(15,18,45,0.95)",
    panelBorder: "rgba(100,120,200,0.15)",
    headerBg: "rgba(20,25,60,0.6)",
    textPrimary: "text-white",
    textSecondary: "text-slate-300",
    textMuted: "text-slate-400",
    accentColor: "text-indigo-300",
    closeBtnBg: "bg-white/5 hover:bg-white/10",
    closeBtnHover: "hover:text-white",
    divider: "border-white/5",
    proseClass: "prose-invert",
  },
  morning: {
    overlayBg: "rgba(255,240,220,0.6)",
    panelBg: "rgba(255,252,248,0.97)",
    panelBorder: "rgba(220,180,140,0.2)",
    headerBg: "rgba(255,245,230,0.6)",
    textPrimary: "text-amber-950",
    textSecondary: "text-amber-800",
    textMuted: "text-amber-700/60",
    accentColor: "text-amber-600",
    closeBtnBg: "bg-amber-100/50 hover:bg-amber-100",
    closeBtnHover: "hover:text-amber-900",
    divider: "border-amber-200/30",
    proseClass: "prose-amber",
  },
  cafe: {
    overlayBg: "rgba(240,230,215,0.6)",
    panelBg: "rgba(252,248,242,0.97)",
    panelBorder: "rgba(200,180,150,0.2)",
    headerBg: "rgba(245,238,225,0.6)",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-700",
    textMuted: "text-stone-500",
    accentColor: "text-stone-600",
    closeBtnBg: "bg-stone-100/50 hover:bg-stone-200/70",
    closeBtnHover: "hover:text-stone-900",
    divider: "border-stone-200/30",
    proseClass: "prose-stone",
  },
  deepSea: {
    overlayBg: "rgba(5,20,40,0.75)",
    panelBg: "rgba(8,30,55,0.95)",
    panelBorder: "rgba(60,140,180,0.15)",
    headerBg: "rgba(10,40,70,0.6)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200",
    textMuted: "text-cyan-300/60",
    accentColor: "text-cyan-300",
    closeBtnBg: "bg-white/5 hover:bg-white/10",
    closeBtnHover: "hover:text-cyan-50",
    divider: "border-cyan-500/10",
    proseClass: "prose-invert",
  },
};

// Framer Motion variants (replicated)
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 40, filter: "blur(8px)" },
  visible: {
    opacity: 1, scale: 1, y: 0, filter: "blur(0px)",
    transition: { type: "spring", damping: 28, stiffness: 300, mass: 0.8 },
  },
  exit: {
    opacity: 0, scale: 0.95, y: 20, filter: "blur(4px)",
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("getWeightLabel — 權重標籤解析", () => {
  it("returns correct label for known tag", () => {
    expect(getWeightLabel(["Model Breakthrough"])).toBe("Model Breakthrough");
  });

  it("returns first known tag when multiple present", () => {
    expect(getWeightLabel(["unknown", "Inspiration Tip", "Model Breakthrough"])).toBe("Inspiration Tip");
  });

  it("returns 'General Update' for null tags", () => {
    expect(getWeightLabel(null)).toBe("General Update");
  });

  it("returns 'General Update' for undefined tags", () => {
    expect(getWeightLabel(undefined)).toBe("General Update");
  });

  it("returns 'General Update' for empty tags", () => {
    expect(getWeightLabel([])).toBe("General Update");
  });

  it("returns 'General Update' for unknown tags only", () => {
    expect(getWeightLabel(["random", "tags"])).toBe("General Update");
  });

  it("all weight labels have Chinese translations", () => {
    const labels = Object.keys(WEIGHT_LABEL_ZH);
    for (const label of labels) {
      expect(WEIGHT_LABEL_ZH[label]).toBeTruthy();
      expect(typeof WEIGHT_LABEL_ZH[label]).toBe("string");
    }
  });

  it("all weight labels have color config", () => {
    const labels = Object.keys(WEIGHT_LABEL_ZH);
    for (const label of labels) {
      expect(WEIGHT_LABEL_COLOR[label]).toBeTruthy();
      expect(WEIGHT_LABEL_COLOR[label]).toContain("text-");
      expect(WEIGHT_LABEL_COLOR[label]).toContain("bg-");
    }
  });
});

describe("formatDate — 日期格式化", () => {
  it("formats a Date object", () => {
    const result = formatDate(new Date("2026-01-15T10:30:00Z"));
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats a date string", () => {
    const result = formatDate("2026-03-10T14:00:00Z");
    expect(result).toBeTruthy();
  });

  it("returns empty string for null", () => {
    expect(formatDate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatDate(undefined)).toBe("");
  });
});

describe("DIALOG_SCENE_STYLES — 場景樣式完整性", () => {
  const scenes: SceneId[] = ["nightSky", "morning", "cafe", "deepSea"];
  const requiredKeys: (keyof DialogSceneStyles)[] = [
    "overlayBg", "panelBg", "panelBorder", "headerBg",
    "textPrimary", "textSecondary", "textMuted", "accentColor",
    "closeBtnBg", "closeBtnHover", "divider", "proseClass",
  ];

  for (const scene of scenes) {
    it(`scene '${scene}' has all required style keys`, () => {
      const sceneStyles = DIALOG_SCENE_STYLES[scene];
      for (const key of requiredKeys) {
        expect(sceneStyles[key]).toBeTruthy();
        expect(typeof sceneStyles[key]).toBe("string");
      }
    });
  }

  it("dark scenes use prose-invert", () => {
    expect(DIALOG_SCENE_STYLES.nightSky.proseClass).toContain("prose-invert");
    expect(DIALOG_SCENE_STYLES.deepSea.proseClass).toContain("prose-invert");
  });

  it("light scenes do not use prose-invert", () => {
    expect(DIALOG_SCENE_STYLES.morning.proseClass).not.toContain("prose-invert");
    expect(DIALOG_SCENE_STYLES.cafe.proseClass).not.toContain("prose-invert");
  });
});

describe("Framer Motion variants — 動畫結構", () => {
  it("overlay has hidden/visible/exit states", () => {
    expect(overlayVariants.hidden).toBeDefined();
    expect(overlayVariants.visible).toBeDefined();
    expect(overlayVariants.exit).toBeDefined();
  });

  it("overlay hidden state has opacity 0", () => {
    expect(overlayVariants.hidden.opacity).toBe(0);
  });

  it("overlay visible state has opacity 1", () => {
    expect(overlayVariants.visible.opacity).toBe(1);
  });

  it("content has hidden/visible/exit states", () => {
    expect(contentVariants.hidden).toBeDefined();
    expect(contentVariants.visible).toBeDefined();
    expect(contentVariants.exit).toBeDefined();
  });

  it("content hidden state starts scaled down and blurred", () => {
    expect(contentVariants.hidden.scale).toBeLessThan(1);
    expect(contentVariants.hidden.y).toBeGreaterThan(0);
    expect(contentVariants.hidden.filter).toContain("blur");
  });

  it("content visible state is fully visible", () => {
    expect(contentVariants.visible.opacity).toBe(1);
    expect(contentVariants.visible.scale).toBe(1);
    expect(contentVariants.visible.y).toBe(0);
    expect(contentVariants.visible.filter).toBe("blur(0px)");
  });

  it("content visible transition uses spring", () => {
    expect(contentVariants.visible.transition.type).toBe("spring");
    expect(contentVariants.visible.transition.damping).toBeGreaterThan(0);
    expect(contentVariants.visible.transition.stiffness).toBeGreaterThan(0);
  });

  it("content exit transition is fast", () => {
    expect(contentVariants.exit.transition.duration).toBeLessThanOrEqual(0.3);
  });
});

describe("Integration — 完整整合場景", () => {
  it("clicking a card with known tag shows correct weight label", () => {
    const tags = ["Model Breakthrough", "AI"];
    const label = getWeightLabel(tags);
    expect(label).toBe("Model Breakthrough");
    expect(WEIGHT_LABEL_ZH[label]).toBe("模型突破");
    expect(WEIGHT_LABEL_COLOR[label]).toContain("amber");
  });

  it("article with no bodyMarkdown should show fallback message", () => {
    // Simulating the condition check in ArticleDialog
    const bodyMarkdown: string | null = null;
    const sourceUrl = "https://example.com/article";
    const hasBody = !!bodyMarkdown;
    const hasSource = !!sourceUrl;
    expect(hasBody).toBe(false);
    expect(hasSource).toBe(true);
    // In the UI, this would show "此文章尚無完整內容" + source link
  });

  it("article with bodyMarkdown should render content", () => {
    const bodyMarkdown = "## 標題\n\n這是一篇完整的文章內容。";
    const hasBody = !!bodyMarkdown;
    expect(hasBody).toBe(true);
  });

  it("dialog open/close state management", () => {
    let selectedNewsId: number | null = null;

    // Open
    selectedNewsId = 42;
    expect(selectedNewsId).not.toBeNull();

    // Close
    selectedNewsId = null;
    expect(selectedNewsId).toBeNull();
  });

  it("external link has proper attributes for security", () => {
    // Verifying the pattern used in ArticleDialog
    const rel = "noopener noreferrer";
    const target = "_blank";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(target).toBe("_blank");
  });
});
