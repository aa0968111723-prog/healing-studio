/**
 * voice-style-catalog.test.ts — AIDV-254 /video 旁白語音風格目錄測試
 * ----------------------------------------------------------------------------
 * Source-anchored：直接匯入真實模組（voiceStyleCatalog ↔ elevenLabsExtended），
 * 逐項驗證目錄是「既有清單的忠實映射」而非硬寫死的平行清單——
 * elevenLabsExtended.ELEVENLABS_BUILTIN_VOICES 任何增刪改（id/名稱/性別/描述）
 * 都會讓對應斷言變紅。
 */
import { describe, it, expect } from "vitest";
import {
  getVoiceStyleCatalog,
  QWEN_BUILTIN_VOICES,
  type VoiceStyleOption,
} from "./services/voiceStyleCatalog";
import { ELEVENLABS_BUILTIN_VOICES } from "./services/elevenLabsExtended";

describe("voiceStyleCatalog（AIDV-254）", () => {
  const catalog = getVoiceStyleCatalog();

  describe("ElevenLabs 分組 — 錨定 ELEVENLABS_BUILTIN_VOICES", () => {
    it("逐一映射：數量、順序、id、名稱、性別、描述皆與來源常數一致", () => {
      expect(catalog.elevenlabs).toHaveLength(ELEVENLABS_BUILTIN_VOICES.length);
      catalog.elevenlabs.forEach((opt, i) => {
        const src = ELEVENLABS_BUILTIN_VOICES[i];
        expect(opt.id).toBe(src.voiceId);
        expect(opt.name).toBe(src.name);
        expect(opt.gender).toBe(src.gender);
        expect(opt.description).toBe(src.description);
      });
    });

    it("語言提示由 accent 推導：British → 英式、其餘 → 美式", () => {
      catalog.elevenlabs.forEach((opt, i) => {
        const src = ELEVENLABS_BUILTIN_VOICES[i];
        expect(opt.language).toBe(src.accent === "British" ? "英文（英式）" : "英文（美式）");
      });
    });

    it("elevenLabsTTS 既有預設敘事聲線 Bella（voiceCompiler 預設 voiceId）在目錄內可選", () => {
      // 錨定 voiceCompiler.synthesizeSpeech 的預設 voiceId "EXAVITQu4vr4xnSDxMaL"。
      expect(catalog.elevenlabs.some((v) => v.id === "EXAVITQu4vr4xnSDxMaL")).toBe(true);
    });
  });

  describe("Qwen 分組 — 錨定 repo 既有出貨清單", () => {
    it("包含 ProStudio qwenVoicePresets 四聲線（Vivian/Dylan/Chelsie/Ethan）", () => {
      const ids = catalog.qwen.map((v) => v.id);
      for (const name of ["Vivian", "Dylan", "Chelsie", "Ethan"]) {
        expect(ids).toContain(name);
      }
    });

    it("包含後端 qwenTTS 未帶 voice 時的預設聲線 Vivian，且描述標示為預設", () => {
      const vivian = catalog.qwen.find((v) => v.id === "Vivian");
      expect(vivian).toBeDefined();
      expect(vivian!.description).toContain("預設");
    });

    it("getVoiceStyleCatalog().qwen 即 QWEN_BUILTIN_VOICES（單一來源，不複製第二份）", () => {
      expect(catalog.qwen).toBe(QWEN_BUILTIN_VOICES);
    });
  });

  describe("目錄整體品質（漏洞卡驗收：至少 5 種可用 AI 語音選項）", () => {
    it("兩組合計至少 5 個選項", () => {
      expect(catalog.elevenlabs.length + catalog.qwen.length).toBeGreaterThanOrEqual(5);
    });

    it("每個選項欄位齊全（id/name/description/language 非空、gender 合法）", () => {
      const all: VoiceStyleOption[] = [...catalog.elevenlabs, ...catalog.qwen];
      for (const v of all) {
        expect(v.id.trim().length).toBeGreaterThan(0);
        expect(v.name.trim().length).toBeGreaterThan(0);
        expect(v.description.trim().length).toBeGreaterThan(0);
        expect(v.language.trim().length).toBeGreaterThan(0);
        expect(["male", "female"]).toContain(v.gender);
      }
    });

    it("組內 id 不重複（選擇器 key / 傳參值唯一）", () => {
      for (const group of [catalog.elevenlabs, catalog.qwen]) {
        const ids = group.map((v) => v.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });
});
