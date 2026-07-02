/**
 * persona-learning-docs.test.ts — 核心人格教材補完（AIDV-966）結構鎖
 * ----------------------------------------------------------------------------
 * 鎖住三份新教材（接案者／內容編輯／品牌方）的內容契約：
 *   1) METHODOLOGY_DOCS 註冊三個 scenario-* 條目，格式對齊 AIDV-813 既有教材
 *      （入門指南／入門難度／summary 含 上手路徑・常見卡關・推薦功能）。
 *   2) PERSONA_LEARNING_DOCS 每份恰 5 步：每步一個可點動作（cta＋href）
 *      ＋一句「這步學到什麼」（learn）。
 *   3) 每份 ≥4 組前後對照（弱→強）提示，全部可在 PROMPT_REFERENCE_LIBRARY
 *      解析到，且掛回 /learn?sub=hub&docId=<docId> 的 deep-link；三份合計 ≥12 組。
 *   4) 卡關自救微文案齊備並帶推薦功能 deep-link。
 *   5) deep-link 可達性鎖（修補輪新增）：
 *      a. 所有 href/featureHref/references[].href 的 pathname 必須在站內已知路由
 *         白名單（自 client/src/App.tsx <Route path> 與 shellRouteTable 靜態抽取）。
 *      b. 所有 /learn?docId=<id> 的 id 必須存在於實際可達的文件來源
 *         （server learnHub SEED_DOCS；getById 由它解析），不只驗字串存在。
 * 純資料契約測試，不觸任何執行期邏輯。
 */
import { describe, expect, it } from "vitest";
import {
  METHODOLOGY_DOCS,
  PERSONA_LEARNING_DOCS,
} from "../../../client/src/shells/learn/learnContent";
import { PROMPT_REFERENCE_LIBRARY } from "../../../shared/promptReferenceLibrary";
import { SEED_DOCS } from "../../../server/routers/learnHub.seed";

const NEW_DOC_IDS = [
  "scenario-freelancer-delivery",
  "scenario-editor-batch",
  "scenario-brand-consistency",
] as const;

/**
 * 站內已知路由白名單（pathname 層級；query 不計）。
 * 來源：client/src/App.tsx 的 <Route path>（頂層路由，4SHELL OFF 回滾路徑）
 * ＋ client/src/shells/shellRouteTable.ts 的 SHELL_SUBROUTES（4SHELL ON 生產路徑）。
 * 新增教材 deep-link 若指到不在此清單的 pathname，即為指錯頁（AIDV-966 修補輪鎖）。
 */
const KNOWN_ROUTE_PATHS = new Set<string>([
  // App.tsx 頂層（節選：教材會用到的）
  "/studio", "/image-studio", "/video-studio", "/pro-studio", "/light-orb-studio",
  "/director", "/animation", "/worldbuilding", "/vault", "/assets", "/models",
  "/history", "/learn", "/lora-trainer", "/background-tasks", "/credits",
  "/prompt-library", "/prompt-collection", "/teaching-archive", "/dashboard",
  "/create", "/playground", "/focus-flow", "/notes", "/calendar",
  // shellRouteTable（4SHELL ON 生產路徑）
  "/video/director", "/video/create", "/video/studio", "/video/image", "/video/video", "/video/pro",
  "/social", "/social/studio", "/social/brand", "/social/publish",
  "/learn/ai-models", "/learn/my-brain", "/learn/teaching-archive",
]);

/** 取站內 href 的 pathname（去 query/hash）。 */
function pathnameOf(href: string): string {
  return href.split(/[?#]/)[0];
}

/** 取 /learn?docId=<id> 的 docId（無則 null）。 */
function docIdOf(href: string): string | null {
  const q = href.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get("docId");
}

/** 實際可達的文件來源：server learnHub SEED_DOCS（getById 由它解析）。 */
const RESOLVABLE_DOC_IDS = new Set(SEED_DOCS.map((d) => d.id));

describe("AIDV-966 · METHODOLOGY_DOCS 註冊", () => {
  it("三份新教材都註冊在 METHODOLOGY_DOCS，格式對齊 AIDV-813", () => {
    for (const id of NEW_DOC_IDS) {
      const doc = METHODOLOGY_DOCS.find((d) => d.id === id);
      expect(doc, `缺少教材 ${id}`).toBeDefined();
      expect(doc!.category).toBe("入門指南");
      expect(doc!.difficulty).toBe("入門");
      expect(doc!.minutes).toBeGreaterThan(0);
      // 對齊 813 教材 summary 三段式：上手路徑／常見卡關／推薦功能
      expect(doc!.summary).toContain("上手路徑");
      expect(doc!.summary).toContain("常見卡關");
      expect(doc!.summary).toContain("推薦功能");
    }
  });

  it("METHODOLOGY_DOCS id 不重複（註冊不撞 813 既有教材）", () => {
    const ids = METHODOLOGY_DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("AIDV-966 · PERSONA_LEARNING_DOCS 教材結構", () => {
  it("恰好三份教材，docId 對映 METHODOLOGY_DOCS", () => {
    expect(PERSONA_LEARNING_DOCS.map((d) => d.docId).sort()).toEqual(
      [...NEW_DOC_IDS].sort(),
    );
    for (const doc of PERSONA_LEARNING_DOCS) {
      expect(METHODOLOGY_DOCS.some((m) => m.id === doc.docId)).toBe(true);
      expect(doc.persona.length).toBeGreaterThan(0);
    }
  });

  it("每份恰 5 步：每步一個可點動作（cta＋href）＋一句學到什麼（learn）", () => {
    for (const doc of PERSONA_LEARNING_DOCS) {
      expect(doc.steps.length, `${doc.docId} 需 5 步`).toBe(5);
      doc.steps.forEach((s, i) => {
        expect(s.step).toBe(i + 1);
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.learn.length, `${doc.docId} 第 ${s.step} 步缺「學到什麼」`).toBeGreaterThan(5);
        expect(s.cta.length, `${doc.docId} 第 ${s.step} 步缺可點動作文案`).toBeGreaterThan(5);
        expect(s.href.startsWith("/"), `${doc.docId} 第 ${s.step} 步 href 需為站內 deep-link`).toBe(true);
      });
    }
  });

  it("每份都有卡關自救微文案，並帶推薦功能 deep-link", () => {
    for (const doc of PERSONA_LEARNING_DOCS) {
      expect(doc.rescues.length, `${doc.docId} 缺卡關自救`).toBeGreaterThanOrEqual(3);
      for (const r of doc.rescues) {
        expect(r.stuck.length).toBeGreaterThan(5);
        expect(r.rescue.length).toBeGreaterThan(5);
        expect(r.featureLabel.length).toBeGreaterThan(0);
        expect(r.featureHref.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("AIDV-966 · 前後對照提示組（弱→強）", () => {
  it("每份 ≥4 組、全卡合計 ≥12 組，且都能在 PROMPT_REFERENCE_LIBRARY 解析", () => {
    let total = 0;
    for (const doc of PERSONA_LEARNING_DOCS) {
      expect(doc.promptRefIds.length, `${doc.docId} 需 ≥4 組前後對照`).toBeGreaterThanOrEqual(4);
      total += doc.promptRefIds.length;
      for (const refId of doc.promptRefIds) {
        const entry = PROMPT_REFERENCE_LIBRARY.find((p) => p.id === refId);
        expect(entry, `${doc.docId} 引用的 ${refId} 不在提示參考庫`).toBeDefined();
        // 弱→強 前後對照格式（對齊 AIDV-813 onboard-* 條目）
        expect(entry!.prompt).toContain("弱提示：");
        expect(entry!.prompt).toContain("強提示：");
        expect(entry!.prompt).toContain("▷ 為什麼更好");
        expect(entry!.tags).toContain("前後對照");
        // deep-link 掛回教材本體（sub=hub：rich shell 開文件中心分頁；
        // docId：回滾 LearnHub 直開文件 modal）
        const hrefs = (entry!.references ?? []).map((r) => r.href);
        expect(
          hrefs.includes(`/learn?sub=hub&docId=${doc.docId}`),
          `${refId} 缺回連 /learn?sub=hub&docId=${doc.docId}`,
        ).toBe(true);
      }
    }
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it("PROMPT_REFERENCE_LIBRARY id 全庫唯一（新組不撞既有條目）", () => {
    const ids = PROMPT_REFERENCE_LIBRARY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("AIDV-966 · deep-link 可達性（修補輪：不只驗字串，驗指到的頁真的存在）", () => {
  /** 收集本卡全部 deep-link：教材步驟 href＋自救 featureHref＋12 組新條目的 references[].href。 */
  function collectCardHrefs(): Array<{ where: string; href: string }> {
    const out: Array<{ where: string; href: string }> = [];
    for (const doc of PERSONA_LEARNING_DOCS) {
      for (const s of doc.steps) out.push({ where: `${doc.docId} step${s.step}`, href: s.href });
      doc.rescues.forEach((r, i) => out.push({ where: `${doc.docId} rescue${i + 1}`, href: r.featureHref }));
      for (const refId of doc.promptRefIds) {
        const entry = PROMPT_REFERENCE_LIBRARY.find((p) => p.id === refId);
        for (const ref of entry?.references ?? []) {
          out.push({ where: `${refId} reference`, href: ref.href });
        }
      }
    }
    return out;
  }

  it("所有 href 的 pathname 都在站內已知路由白名單（抓「指錯頁」）", () => {
    for (const { where, href } of collectCardHrefs()) {
      const path = pathnameOf(href);
      expect(
        KNOWN_ROUTE_PATHS.has(path),
        `${where} 的 href「${href}」pathname「${path}」不在已知站內路由白名單`,
      ).toBe(true);
    }
  });

  it("所有 /learn?docId=<id> 都能在 server learnHub SEED_DOCS 解析（抓死連結）", () => {
    for (const { where, href } of collectCardHrefs()) {
      const docId = docIdOf(href);
      if (!docId) continue;
      expect(
        RESOLVABLE_DOC_IDS.has(docId),
        `${where} 的 deep-link docId「${docId}」不存在於 learnHub SEED_DOCS（getById 會 NOT_FOUND）`,
      ).toBe(true);
    }
  });

  it("六份 scenario-* 教材（813 三份＋966 三份）都註冊進 SEED_DOCS，且摘要對齊 METHODOLOGY_DOCS", () => {
    const scenarioDocs = METHODOLOGY_DOCS.filter((d) => d.id.startsWith("scenario-"));
    expect(scenarioDocs.length).toBeGreaterThanOrEqual(6);
    for (const m of scenarioDocs) {
      const seeded = SEED_DOCS.find((d) => d.id === m.id);
      expect(seeded, `SEED_DOCS 缺 ${m.id}（/learn?docId=${m.id} 會 NOT_FOUND）`).toBeDefined();
      expect(seeded!.category).toBe("getting-started");
      expect(seeded!.difficulty).toBe("beginner");
      expect(seeded!.title).toBe(m.title);
      expect(seeded!.content.length).toBeGreaterThan(200);
    }
  });
});
