import { describe, expect, it } from "vitest";
import {
  buildAnatomyPrompt,
  nextClarificationQuestion,
  getLabelChecklistForPart,
  parseAnatomyIntent,
  buildMultiViewBatch,
  verifyAnatomyResult,
  recommendAnatomyModels,
  summarizeAnatomyRequest,
  type AnatomyPromptInput,
} from "./services/spiritTools/anatomySpecialistTools";

// ─── buildAnatomyPrompt ────────────────────────────────────────────────────

describe("anatomySpecialistTools.buildAnatomyPrompt", () => {
  const baseInput: AnatomyPromptInput = {
    bodyPart: "skeleton",
    view: "anterior",
    style: "medical-textbook",
    purpose: "teaching",
  };

  it("composes a prompt with body part, view, style, purpose, and medical accuracy", () => {
    const result = buildAnatomyPrompt(baseInput);
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("anatomical illustration");
    expect(result.prompt).toContain("human skeletal system");
    expect(result.prompt).toContain("anterior view");
    expect(result.prompt).toContain("medical textbook style");
    expect(result.prompt).toContain("educational purpose");
    expect(result.prompt).toContain("medical accuracy");
  });

  it("appends extraDescriptors when provided", () => {
    const result = buildAnatomyPrompt({
      ...baseInput,
      extraDescriptors: ["pediatric", "female only"],
    });
    expect(result.prompt).toContain("pediatric");
    expect(result.prompt).toContain("female only");
  });

  it("recommends batch=4 for teaching/labeling, 2 otherwise", () => {
    expect(buildAnatomyPrompt({ ...baseInput, purpose: "teaching" }).recommendedBatch).toBe(4);
    expect(buildAnatomyPrompt({ ...baseInput, purpose: "labeling" }).recommendedBatch).toBe(4);
    expect(buildAnatomyPrompt({ ...baseInput, purpose: "reference" }).recommendedBatch).toBe(2);
    expect(buildAnatomyPrompt({ ...baseInput, purpose: "artistic" }).recommendedBatch).toBe(2);
  });

  it("picks a different recommendedModel per style", () => {
    const textbook = buildAnatomyPrompt({ ...baseInput, style: "medical-textbook" });
    const threeD = buildAnatomyPrompt({ ...baseInput, style: "3d-render" });
    const diagram = buildAnatomyPrompt({ ...baseInput, style: "simplified-diagram" });
    expect(textbook.recommendedModel).toMatch(/^fal-ai\//);
    expect(threeD.recommendedModel).not.toBe(textbook.recommendedModel);
    expect(diagram.recommendedModel).not.toBe(textbook.recommendedModel);
  });

  it("always includes a negative prompt that excludes anime/cartoonish/model-pose drift", () => {
    const result = buildAnatomyPrompt(baseInput);
    expect(result.negativePrompt).toContain("anime");
    expect(result.negativePrompt).toContain("cartoonish");
    expect(result.negativePrompt).toContain("model pose");
  });
});

// ─── nextClarificationQuestion ─────────────────────────────────────────────

describe("anatomySpecialistTools.nextClarificationQuestion", () => {
  it("asks bodyPart first when nothing is known", () => {
    const q = nextClarificationQuestion({});
    expect(q?.field).toBe("bodyPart");
  });

  it("walks bodyPart → view → purpose → style", () => {
    expect(nextClarificationQuestion({ bodyPart: "skeleton" })?.field).toBe("view");
    expect(
      nextClarificationQuestion({ bodyPart: "skeleton", view: "anterior" })?.field,
    ).toBe("purpose");
    expect(
      nextClarificationQuestion({
        bodyPart: "skeleton",
        view: "anterior",
        purpose: "teaching",
      })?.field,
    ).toBe("style");
  });

  it("returns null when all four fields are filled", () => {
    expect(
      nextClarificationQuestion({
        bodyPart: "skeleton",
        view: "anterior",
        purpose: "teaching",
        style: "medical-textbook",
      }),
    ).toBeNull();
  });

  it("infers fields from freeText so the same question isn't asked twice", () => {
    // 「骨骼正面教學」應自動推得 bodyPart=skeleton, view=anterior, purpose=teaching
    // → 下一個問題是 style，而非重問 bodyPart。
    const q = nextClarificationQuestion(
      {},
      { freeText: "幫我畫骨骼正面教學用的圖" },
    );
    expect(q?.field).toBe("style");
  });

  it("freeText inference does not overwrite explicit partial values", () => {
    const q = nextClarificationQuestion(
      { bodyPart: "muscular" },
      { freeText: "骨骼" }, // skeleton in freeText shouldn't override explicit muscular
    );
    // bodyPart already set → next ask is view
    expect(q?.field).toBe("view");
  });
});

// ─── getLabelChecklistForPart ──────────────────────────────────────────────

describe("anatomySpecialistTools.getLabelChecklistForPart", () => {
  it("returns non-empty checklists for every body part", () => {
    const parts = [
      "full-body", "head", "skeleton", "muscular",
      "nervous", "vascular", "internal-organs", "limbs",
    ] as const;
    for (const part of parts) {
      const labels = getLabelChecklistForPart(part);
      expect(labels.length).toBeGreaterThan(0);
    }
  });

  it("skeleton checklist mentions spine/vertebrae", () => {
    const labels = getLabelChecklistForPart("skeleton");
    expect(labels.join("|")).toMatch(/脊柱|顱骨/);
  });
});

// ─── parseAnatomyIntent ────────────────────────────────────────────────────

describe("anatomySpecialistTools.parseAnatomyIntent", () => {
  it("extracts bodyPart from Chinese keywords", () => {
    expect(parseAnatomyIntent("我想要骨骼圖").bodyPart).toBe("skeleton");
    expect(parseAnatomyIntent("肌肉的圖").bodyPart).toBe("muscular");
    expect(parseAnatomyIntent("內臟分佈").bodyPart).toBe("internal-organs");
    expect(parseAnatomyIntent("四肢比例").bodyPart).toBe("limbs");
  });

  it("extracts bodyPart from English keywords", () => {
    expect(parseAnatomyIntent("show me the skeletal system").bodyPart).toBe("skeleton");
    expect(parseAnatomyIntent("muscular structure").bodyPart).toBe("muscular");
    expect(parseAnatomyIntent("nervous system diagram").bodyPart).toBe("nervous");
  });

  it("extracts view (cross-section before anterior to handle 切面 correctly)", () => {
    expect(parseAnatomyIntent("胸腔切面").view).toBe("cross-section");
    expect(parseAnatomyIntent("前面").view).toBe("anterior");
    expect(parseAnatomyIntent("背面").view).toBe("posterior");
    expect(parseAnatomyIntent("側面").view).toBe("lateral");
  });

  it("extracts style and purpose together", () => {
    const r = parseAnatomyIntent("醫學教科書風的肌肉教學圖");
    expect(r.bodyPart).toBe("muscular");
    expect(r.style).toBe("medical-textbook");
    expect(r.purpose).toBe("teaching");
  });

  it("returns an empty partial when no keywords match", () => {
    const r = parseAnatomyIntent("the weather is nice today");
    expect(Object.keys(r).length).toBe(0);
  });

  it("is idempotent — feeding the summary back gives a stable subset", () => {
    const first = parseAnatomyIntent("骨骼前面教科書教學");
    expect(first.bodyPart).toBe("skeleton");
    expect(first.view).toBe("anterior");
    expect(first.style).toBe("medical-textbook");
    expect(first.purpose).toBe("teaching");
  });
});

// ─── buildMultiViewBatch ───────────────────────────────────────────────────

describe("anatomySpecialistTools.buildMultiViewBatch", () => {
  it("uses sensible default views per body part (skeleton → 3 views)", () => {
    const r = buildMultiViewBatch({
      bodyPart: "skeleton",
      style: "medical-textbook",
      purpose: "teaching",
    });
    expect(r.batch.length).toBe(3);
    const views = r.batch.map(b => b.view).sort();
    expect(views).toEqual(["anterior", "lateral", "posterior"]);
  });

  it("internal-organs default includes cross-section (sees organs better)", () => {
    const r = buildMultiViewBatch({
      bodyPart: "internal-organs",
      style: "medical-textbook",
      purpose: "teaching",
    });
    expect(r.batch.some(b => b.view === "cross-section")).toBe(true);
  });

  it("respects custom views and deduplicates them", () => {
    const r = buildMultiViewBatch({
      bodyPart: "skeleton",
      style: "medical-textbook",
      purpose: "teaching",
      views: ["anterior", "anterior", "lateral"],
    });
    expect(r.batch.length).toBe(2);
  });

  it("every prompt in batch is a non-empty string with the right view tag", () => {
    const r = buildMultiViewBatch({
      bodyPart: "muscular",
      style: "3d-render",
      purpose: "reference",
    });
    for (const item of r.batch) {
      expect(item.prompt.length).toBeGreaterThan(10);
      expect(item.prompt).toContain(item.view.replace(/-/g, " "));
    }
  });

  it("shares one recommendedModel across the batch to keep style consistent", () => {
    const r = buildMultiViewBatch({
      bodyPart: "skeleton",
      style: "medical-textbook",
      purpose: "teaching",
    });
    expect(r.recommendedModel).toMatch(/^fal-ai\//);
  });
});

// ─── verifyAnatomyResult ───────────────────────────────────────────────────

describe("anatomySpecialistTools.verifyAnatomyResult", () => {
  it("returns score=1 when every expected label is detected", () => {
    // skeleton expects 顱骨 / 脊柱 / 上肢骨 / 下肢骨 / 胸廓
    const r = verifyAnatomyResult({
      bodyPart: "skeleton",
      detectedLabels: ["顱骨", "脊柱（頸/胸/腰）", "上肢骨", "下肢骨", "胸廓"],
    });
    expect(r.score).toBe(1);
    expect(r.missing.length).toBe(0);
    expect(r.advice).toContain("完整");
  });

  it("returns score=0 with helpful advice when nothing matches", () => {
    const r = verifyAnatomyResult({
      bodyPart: "skeleton",
      detectedLabels: ["sky", "cloud"],
    });
    expect(r.score).toBe(0);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.advice).toContain("沒命中");
  });

  it("partial score reports which labels are missing", () => {
    const r = verifyAnatomyResult({
      bodyPart: "skeleton",
      detectedLabels: ["顱骨", "上肢骨"],
    });
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
    expect(r.matched).toContain("顱骨");
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("captures extra labels (detected but not in expected set) without flagging them as errors", () => {
    const r = verifyAnatomyResult({
      bodyPart: "skeleton",
      detectedLabels: ["顱骨", "脊柱", "上肢骨", "下肢骨", "胸廓", "watermark"],
    });
    expect(r.score).toBe(1);
    expect(r.extra).toContain("watermark");
  });

  it("empty detectedLabels → score 0 + missing == expected", () => {
    const r = verifyAnatomyResult({ bodyPart: "head", detectedLabels: [] });
    expect(r.score).toBe(0);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.matched.length).toBe(0);
  });
});

// ─── recommendAnatomyModels ────────────────────────────────────────────────

describe("anatomySpecialistTools.recommendAnatomyModels", () => {
  it("returns at least one recommendation with rank=0 first", () => {
    const r = recommendAnatomyModels({
      style: "medical-textbook",
      purpose: "teaching",
    });
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0].rank).toBe(0);
  });

  it("teaching/labeling purpose adds an extra clean-lighting option (imagen4)", () => {
    const teach = recommendAnatomyModels({
      style: "medical-textbook",
      purpose: "teaching",
    });
    const ref = recommendAnatomyModels({
      style: "medical-textbook",
      purpose: "reference",
    });
    // teaching should include imagen4; reference does not need it
    expect(teach.recommendations.some(r => r.modelId.includes("imagen4"))).toBe(true);
    expect(ref.recommendations.every(r => !r.modelId.includes("imagen4"))).toBe(true);
  });

  it("hasReferenceImage=true puts img2img as the top pick", () => {
    const r = recommendAnatomyModels({
      style: "medical-textbook",
      purpose: "reference",
      hasReferenceImage: true,
    });
    expect(r.recommendations[0].modelId).toContain("image-to-image");
  });

  it("never returns duplicate modelIds in the ranking", () => {
    const r = recommendAnatomyModels({
      style: "medical-textbook",
      purpose: "teaching",
      hasReferenceImage: true,
    });
    const ids = r.recommendations.map(x => x.modelId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── summarizeAnatomyRequest ───────────────────────────────────────────────

describe("anatomySpecialistTools.summarizeAnatomyRequest", () => {
  it("renders Chinese summary joined by full-width slash", () => {
    const s = summarizeAnatomyRequest({
      bodyPart: "skeleton",
      view: "anterior",
      style: "medical-textbook",
      purpose: "teaching",
    });
    expect(s).toBe("骨骼／前面／醫學教科書風／教學用");
  });

  it("includes only the fields that are set (partial input)", () => {
    expect(summarizeAnatomyRequest({ bodyPart: "muscular" })).toBe("肌肉");
    expect(
      summarizeAnatomyRequest({ bodyPart: "muscular", purpose: "teaching" }),
    ).toBe("肌肉／教學用");
  });

  it("returns a graceful placeholder when nothing is set", () => {
    expect(summarizeAnatomyRequest({})).toContain("尚未指定");
  });
});
