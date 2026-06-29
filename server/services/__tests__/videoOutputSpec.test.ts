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
  mapOutputSpecWithMeta,
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

describe("mapOutputSpecToFalParams — Wan 版本差異（v2.1 no-op、v2.2 可控）", () => {
  it("wan-t2v(v2.1) 全 no-op：真實 schema 無 frames_per_second，resolution 由端點自帶 → 回空物件", () => {
    // v2.1 的幀率由 num_frames 控制、resolution 由端點 enum 控制（router basePayload
    // 永遠勝出），故 mapper 對 v2.1 不該注入任何 key，避免謊報能力 / 送非該端點參數。
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "720p", fps: 30 }))).toEqual({});
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "4K", fps: 60 }))).toEqual({});
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ resolution: "1080p", fps: 24 }))).toEqual({});
  });

  it("wan-t2v(v2.1) 不注入 frames_per_second（HARD SAFETY 回歸守護）", () => {
    const out = mapOutputSpecToFalParams("fal-ai/wan-t2v", spec({ fps: 30 }));
    expect(out).not.toHaveProperty("frames_per_second");
    expect(out).not.toHaveProperty("resolution");
  });

  it("wan v2.2 注入 resolution + frames_per_second，fps clamp 至 4–60（60 可達）", () => {
    expect(
      mapOutputSpecToFalParams("fal-ai/wan/v2.2-a14b/text-to-video", spec({ resolution: "720p", fps: 60 }))
    ).toEqual({ resolution: "720p", frames_per_second: 60 });
  });

  it("wan v2.2 4K 降級為模型最高支援解析度 720p（不謊報 4K）", () => {
    const out = mapOutputSpecToFalParams("fal-ai/wan/v2.2-a14b/text-to-video", spec({ resolution: "4K", fps: 30 }));
    expect(out.resolution).toBe("720p");
    expect(out.resolution).not.toBe("4K");
  });

  it("wan v2.2 1080p 不在接受集合 → 降級為 720p", () => {
    expect(
      mapOutputSpecToFalParams("fal-ai/wan/v2.2-a14b/text-to-video", spec({ resolution: "1080p", fps: 24 })).resolution
    ).toBe("720p");
  });

  it("wan v2.2 fps 為整數型別", () => {
    const out = mapOutputSpecToFalParams("fal-ai/wan/v2.2-a14b/text-to-video", spec({ fps: 30 }));
    expect(Number.isInteger(out.frames_per_second)).toBe(true);
  });

  it("版本偵測收緊：裸 '2.2' 子字串（如日期/build tag）不誤命中 v2.2，仍走 v2.1 no-op", () => {
    // 例如未來變體 modelId 含 '2.2' 但非真正的 wan v2.2 端點。
    expect(mapOutputSpecToFalParams("fal-ai/wan-t2v-build-2024.2.2", spec({ fps: 60 }))).toEqual({});
    expect(mapOutputSpecToFalParams("fal-ai/wan-something-2.2-foo", spec({ fps: 60 }))).toEqual({});
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

describe("mapOutputSpecWithMeta — 回報被靜默調整的維度（不謊報）", () => {
  it("無調整 → downgrades 為 undefined", () => {
    const r = mapOutputSpecWithMeta("fal-ai/veo3", spec({ resolution: "720p" }));
    expect(r.downgrades).toBeUndefined();
    expect(r.params).toEqual({ resolution: "720p" });
  });

  it("veo3 4K → 降級 1080p 並回報 resolution downgrade", () => {
    const r = mapOutputSpecWithMeta("fal-ai/veo3", spec({ resolution: "4K" }));
    expect(r.params.resolution).toBe("1080p");
    expect(r.downgrades?.resolution).toEqual({ requested: "4K", applied: "1080p" });
  });

  it("wan v2.2 fps 60→24（v2.1 範圍時）/ 4K 降級皆回報", () => {
    const r = mapOutputSpecWithMeta("fal-ai/wan/v2.2-a14b/text-to-video", spec({ resolution: "4K", fps: 60 }));
    // v2.2 fps 60 在範圍內不夾擠；resolution 4K→720p 應回報。
    expect(r.downgrades?.resolution).toEqual({ requested: "4K", applied: "720p" });
    expect(r.downgrades?.fps).toBeUndefined();
  });

  it("wan-t2v(v2.1) no-op → params 空、downgrades undefined", () => {
    const r = mapOutputSpecWithMeta("fal-ai/wan-t2v", spec({ resolution: "4K", fps: 60 }));
    expect(r.params).toEqual({});
    expect(r.downgrades).toBeUndefined();
  });
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
