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
}: {
  label: string;
  options: { value: T; label: string; desc: string; paidOnly?: boolean }[];
  selected: T;
  onSelect: (v: T) => void;
  isPaid: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
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
      />
      <Row
        label="幀率"
        options={FPS_OPTIONS}
        selected={value.fps}
        onSelect={v => onChange({ ...value, fps: v })}
        isPaid={isPaid}
      />
      <Row
        label="編碼"
        options={CODEC_OPTIONS}
        selected={value.codec}
        onSelect={v => onChange({ ...value, codec: v })}
        isPaid={isPaid}
      />
      {!isPaid && (
        <p className="text-[11px] text-muted-foreground">
          4K 解析度為付費方案專屬功能。升級後即可解鎖。
        </p>
      )}
    </div>
  );
}
