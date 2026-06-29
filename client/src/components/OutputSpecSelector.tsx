/**
 * OutputSpecSelector — 影片輸出規格選擇器（AIDV-255）
 *
 * 讓使用者在新建影片專案時選擇 resolution / fps / codec。
 * - 4K 解析度為付費方案專屬：非付費方案顯示鎖定圖示＋停用＋升級提示。
 * - 沿用 VideoProjectCreateDialog 的暖色 active-button-group 視覺
 *   （border-primary / bg-primary/5），不自造 token。
 *
 * 受控元件：value + onChange，預設值與後端 VIDEO_OUTPUT_SPEC_DEFAULT 一致
 *（1080p / 30 / h264，最高相容性）。
 */

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type OutputResolution = "720p" | "1080p" | "4K";
export type OutputFps = 24 | 30 | 60;
export type OutputCodec = "h264" | "h265" | "vp9";

export interface OutputSpecValue {
  resolution: OutputResolution;
  fps: OutputFps;
  codec: OutputCodec;
}

/** 與後端 VIDEO_OUTPUT_SPEC_DEFAULT 對齊。 */
export const OUTPUT_SPEC_DEFAULT: OutputSpecValue = {
  resolution: "1080p",
  fps: 30,
  codec: "h264",
};

/**
 * AIDV-255 單一真實來源：把輸出規格收斂到「使用者方案實際可用」的安全值。
 * 非付費方案選了 4K（理論上 selector 已停用，仍做送出前防呆）→ 退回 1080p，
 * 與後端 fail-closed 的 4K 守門一致，避免前端送出後吃到 FORBIDDEN。
 * 純函式，供 VideoProjectCreateDialog 與 VideoStudio 共用，消除重複的方案判定。
 */
export function clampOutputSpecToPlan(
  spec: OutputSpecValue,
  isPaid: boolean,
): OutputSpecValue {
  if (!isPaid && spec.resolution === "4K") {
    return { ...spec, resolution: "1080p" };
  }
  return spec;
}

/** 兩個輸出規格三欄是否完全相同。 */
export function isSameOutputSpec(a: OutputSpecValue, b: OutputSpecValue): boolean {
  return a.resolution === b.resolution && a.fps === b.fps && a.codec === b.codec;
}

/**
 * AIDV-255 生成路徑專用：把選擇器的值轉成「要送給生成 mutation 的 outputSpec」。
 * 關鍵安全性（HARD SAFETY #1）：當（套方案守門後的）規格等於後端預設時回 undefined，
 * 讓後端走「未帶 outputSpec → fal payload 位元零變化」路徑，使「使用者沒動選擇器」的
 * 既有生成完全不受影響（避免對 Veo3 等可控解析度模型多注入 resolution=1080p 造成回歸）。
 * 只有使用者真正改成非預設（如 720p / 4K）時才帶上規格。
 */
export function outputSpecForGeneration(
  spec: OutputSpecValue,
  isPaid: boolean,
): OutputSpecValue | undefined {
  const clamped = clampOutputSpecToPlan(spec, isPaid);
  return isSameOutputSpec(clamped, OUTPUT_SPEC_DEFAULT) ? undefined : clamped;
}

const RESOLUTION_OPTIONS: { value: OutputResolution; label: string; desc: string; paidOnly?: boolean }[] = [
  { value: "720p", label: "720p", desc: "HD · 快速" },
  { value: "1080p", label: "1080p", desc: "Full HD · 推薦" },
  { value: "4K", label: "4K", desc: "Ultra HD · 付費", paidOnly: true },
];

const FPS_OPTIONS: { value: OutputFps; label: string; desc: string }[] = [
  { value: 24, label: "24 fps", desc: "電影感" },
  { value: 30, label: "30 fps", desc: "標準" },
  { value: 60, label: "60 fps", desc: "流暢" },
];

const CODEC_OPTIONS: { value: OutputCodec; label: string; desc: string }[] = [
  { value: "h264", label: "H.264", desc: "最高相容" },
  { value: "h265", label: "H.265", desc: "高壓縮" },
  { value: "vp9", label: "VP9", desc: "WebM" },
];

/**
 * 各維度對「生成輸出」的實際生效性（對齊後端 mapper 能力矩陣）：
 *  - 解析度：僅部分模型（如 Veo3）透過 outputSpec 生效，其餘由模型/方案隱含。
 *  - 幀率：僅部分模型可控；多數模型由平台預設，選擇可能被調整或忽略。
 *  - 編碼：所有文生影模型皆不暴露 codec → 僅作專案標註，不影響實際輸出。
 * 在此明確標示，避免承諾無法兌現的「假功能」。
 */
const DIMENSION_NOTES = {
  resolution: "部分模型支援；其餘由模型/方案決定，可能自動調整",
  fps: "部分模型支援；其餘以平台預設輸出，可能被調整",
  codec: "目前僅作專案標註，不影響實際生成輸出",
} as const;

interface Props {
  value: OutputSpecValue;
  onChange: (next: OutputSpecValue) => void;
  /** 使用者是否為付費方案；false → 4K 鎖定停用。 */
  isPaid: boolean;
  className?: string;
}

function Row<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
  isPaid,
  note,
}: {
  label: string;
  options: { value: T; label: string; desc: string; paidOnly?: boolean }[];
  selected: T;
  onSelect: (v: T) => void;
  isPaid: boolean;
  note?: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1.5">
        {label}
        {note && (
          <span className="ml-1.5 font-normal text-[10px] text-muted-foreground/70">
            （{note}）
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {options.map(opt => {
          const locked = !!opt.paidOnly && !isPaid;
          const isActive = selected === opt.value && !locked;
          return (
            <button
              key={String(opt.value)}
              type="button"
              disabled={locked}
              aria-disabled={locked}
              title={locked ? "4K 為付費方案專屬功能，請升級後使用" : undefined}
              onClick={() => !locked && onSelect(opt.value)}
              className={cn(
                "flex-1 rounded-lg border-2 px-2 py-2 text-center transition-all",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40",
                locked && "opacity-50 cursor-not-allowed hover:border-border"
              )}
            >
              <div className="flex items-center justify-center gap-1 text-sm font-medium">
                {locked && <Lock className="size-3" />}
                {opt.label}
              </div>
              <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OutputSpecSelector({ value, onChange, isPaid, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Row
        label="解析度"
        options={RESOLUTION_OPTIONS}
        selected={value.resolution}
        onSelect={v => onChange({ ...value, resolution: v })}
        isPaid={isPaid}
        note={DIMENSION_NOTES.resolution}
      />
      <Row
        label="幀率"
        options={FPS_OPTIONS}
        selected={value.fps}
        onSelect={v => onChange({ ...value, fps: v })}
        isPaid={isPaid}
        note={DIMENSION_NOTES.fps}
      />
      <Row
        label="編碼"
        options={CODEC_OPTIONS}
        selected={value.codec}
        onSelect={v => onChange({ ...value, codec: v })}
        isPaid={isPaid}
        note={DIMENSION_NOTES.codec}
      />
      {!isPaid && (
        <p className="text-[11px] text-muted-foreground">
          4K 解析度為付費方案專屬功能。升級後即可解鎖。
        </p>
      )}
    </div>
  );
}
