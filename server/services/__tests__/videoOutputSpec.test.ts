/**
 * videoOutputSpec.test.ts — AIDV-255 純函式層窮盡測試
 *
 * 覆蓋研究測試矩陣的純函式可驗證部分：
 *  - mapOutputSpecToFalParams：各模型能力、4K 降級、fps clamp、codec 永不注入、未知模型 no-op
 *  - assertResolutionAllowed：4K × 付費/免費/查無方案 守門
 *  - 笛卡兒積（resolution × fps × codec）對映射的確定性
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  mapOutputSpecToFalParams,
  assertResolutionAllowed,
} from "../videoOutputSpec";
import {
  VIDEO_OUTPUT_SPEC_DEFAULT,
  type VideoOutputSpec,
} from "../../../drizzle/schema";

const RES: VideoOutputSpec["resolution"][] = ["720p", "1080p", "4K"];
const FPS: VideoOutputSpec["fps"][] = [24, 30, 60];
const CODEC: VideoOutputSpec["codec"][] = ["h264", "h265", "vp9"];

function spec(p: Partial<VideoOutputSpec>): VideoOutputSpec {
  return { ...VIDEO_OUTPUT_SPEC_DEFAULT, ...p };
}

describe("mapOutputSpecToFalParams — 不支援能力的模型一律 no-op（不 throw）", () => {
  it("Kling 解析度由 tier 隱含 → 回空物件", () => {
    expect(
      mapOutputSpecToFalParams(
        "fal-ai/kling-video/v2.1/standard/text-to-video",
        spec({ resolution: "1080p", fps: 30 })
      )
    ).toEqual({});
  });

  it("MiniMax 解析度/fps 鎖死 → 回空物件", () => {
    expect(
      mapOutputSpecToFalParams(
        "fal-ai/minimax/hailuo-02/pro/text-to-video",
        spec({ resolution: "1080p", fps: 60 })
      )
    ).toEqual({});
  });

  it("完全未知模型 → 回空物件，不 throw", () => {
    expect(() =>
      mapOutputSpecToFalParams("fal-ai/some-unknown-model", spec({}))
    ).not.toThrow();
    expect(mapOutputSpecToFalParams("fal-ai/some-unknown-model", spec({}))).toEqual({});
  });

  it("非影片類別 modelId（image）也回空物件", () => {
    expect(mapOutputSpecToFalParams("fal-ai/flux/dev", spec({}))).toEqual({});
  });
});

describe("mapOutputSpecToFalParams — codec 永不注入（所有模型）", () => {
  const models = [
    "fal-ai/wan-t2v",
    "fal-ai/veo3",
    "fal-ai/kling-video/v2.1/standard/text-to-video",
    "fal-ai/minimax/hailuo-02/pro/text-to-video",
  ];
  for (const m of models) {
    for (const codec of CODEC) {
      it(`${m} + codec=${codec} → 結果不含 codec key`, () => {
        const out = mapOutputSpecToFalParams(m, spec({ codec }));
        expect(out).not.toHaveProperty("codec");
        expect(out).not.toHaveProperty("bitrate");
      });
    }
  }
});

describe("mapOutputSpecToFalParams — Wan 系 resolution + fps 可控", () => {
  it("wan-t2v(v2.1) 注入 resolution + frames_per_second，fps clamp 至 5–24", () => {
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "720p", fps: 30 })))
      .toEqual({ resolution: "720p", frames_per_second: 24 });
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "720p", fps: 60 })))
      .toEqual({ resolution: "720p", frames_per_second: 24 });
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "720p", fps: 24 })))
      .toEqual({ resolution: "720p", frames_per_second: 24 });
  });

  it("wan v2.2 fps clamp 至 4–60（60 可達）", () => {
    expect(
      mapOutputSpecToFalParams("fal-ai/wan/v2.2-a14b/text-to-video", spec({ resolution: "720p", fps: 60 }))
    ).toEqual({ resolution: "720p", frames_per_second: 60 });
  });

  it("Wan 4K 降級為模型最高支援解析度 720p（不謊報 4K）", () => {
    const out = mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "4K", fps: 30 }));
    expect(out.resolution).toBe("720p");
    expect(out.resolution).not.toBe("4K");
  });

  it("Wan 1080p 不在接受集合 → 降級為 720p", () => {
    expect(
      mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "1080p", fps: 24 })).resolution
    ).toBe("720p");
  });

  it("fps 為整數型別", () => {
    const out = mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ fps: 30 }));
    expect(Number.isInteger(out.frames_per_second)).toBe(true);
  });
});

describe("mapOutputSpecToFalParams — Veo3 resolution 可控、fps no-op", () => {
  it("veo3 720p/1080p 直接注入 resolution，無 frames_per_second", () => {
    expect(mapOutputSpecToFalParams("fal-ai/veo3", spec({ resolution: "720p", fps: 60 })))
      .toEqual({ resolution: "720p" });
    expect(mapOutputSpecToFalParams("fal-ai/veo3", spec({ resolution: "1080p", fps: 24 })))
      .toEqual({ resolution: "1080p" });
  });

  it("veo3 4K 降級為 1080p（其最高支援）", () => {
    expect(mapOutputSpecToFalParams("fal-ai/veo3", spec({ resolution: "4K" })).resolution).toBe("1080p");
  });

  it("veo3/pro 同樣可控 resolution", () => {
    expect(mapOutputSpecToFalParams("fal-ai/veo3/pro", spec({ resolution: "1080p" })))
      .toEqual({ resolution: "1080p" });
  });

  it("veo3 不注入 fps key", () => {
    expect(mapOutputSpecToFalParams("fal-ai/veo3", spec({ fps: 60 }))).not.toHaveProperty(
      "frames_per_second"
    );
  });
});

describe("mapOutputSpecToFalParams — 笛卡兒積確定性（27 組合）", () => {
  for (const resolution of RES) {
    for (const fps of FPS) {
      for (const codec of CODEC) {
        it(`組合 ${resolution}/${fps}/${codec} 對所有模型均不 throw 且確定性`, () => {
          const s = spec({ resolution, fps, codec });
          for (const m of [
            "fal-ai/wan-t2v",
            "fal-ai/veo3",
            "fal-ai/kling-video/v2.1/standard/text-to-video",
            "fal-ai/minimax/hailuo-02/pro/text-to-video",
          ]) {
            const a = mapOutputSpecToFalParams(m, s);
            const b = mapOutputSpecToFalParams(m, s);
            expect(a).toEqual(b); // 同輸入同輸出
            expect(a).not.toHaveProperty("codec");
          }
        });
      }
    }
  }
});

describe("assertResolutionAllowed — 4K 付費守門", () => {
  it("720p / 1080p 一律放行（免費方案也可）", () => {
    expect(() => assertResolutionAllowed("720p", null)).not.toThrow();
    expect(() => assertResolutionAllowed("1080p", { planId: "free", status: "active" })).not.toThrow();
  });

  it("4K + 付費方案（active）→ 放行", () => {
    expect(() => assertResolutionAllowed("4K", { planId: "premium", status: "active" })).not.toThrow();
    expect(() => assertResolutionAllowed("4K", { planId: "ultra", status: "active" })).not.toThrow();
  });

  it("4K + trialing 付費方案 → 放行", () => {
    expect(() => assertResolutionAllowed("4K", { planId: "pro", status: "trialing" })).not.toThrow();
  });

  it("4K + 免費方案 → FORBIDDEN", () => {
    expect(() => assertResolutionAllowed("4K", { planId: "free", status: "active" })).toThrow(TRPCError);
    try {
      assertResolutionAllowed("4K", { planId: "free", status: "active" });
    } catch (e) {
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("4K + 付費方案但 status=cancelled → FORBIDDEN（非 active/trialing）", () => {
    expect(() => assertResolutionAllowed("4K", { planId: "premium", status: "cancelled" })).toThrow(
      TRPCError
    );
  });

  it("4K + 查無方案（null）→ fail-closed → FORBIDDEN", () => {
    expect(() => assertResolutionAllowed("4K", null)).toThrow(TRPCError);
    expect(() => assertResolutionAllowed("4K", undefined)).toThrow(TRPCError);
  });

  it("4K + status=null → FORBIDDEN", () => {
    expect(() => assertResolutionAllowed("4K", { planId: "premium", status: null })).toThrow(TRPCError);
  });
});
