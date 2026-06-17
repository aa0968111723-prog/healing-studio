// ============================================================================
// components/social/SocialJourneyStepper.tsx — /social 九步旅程（S1–S9）步進指示
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §1.3（旅程）。把 cockpit 原本的純文字
//   旅程行（「意圖 → 套品牌 → … → 發佈」）升級成 design-kit 亮色暖光步進指示：
//   九步 S1–S9，標出「目前第幾步（current）」與每步的「就緒態（done/current/todo）」。
//
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 九步旅程視覺實裝：
//   純展示、props 驅動（current/steps 由呼叫端傳入）＝零後端、可回滾。元件本身不讀旗標；
//   呼叫端（cockpit）以 SOCIAL_JOURNEY_STEPPER 決定掛不掛＝OFF 預設零變化。
//   色彩/圓角一律走 .aidv-kit scope 的 CSS 變數（var(--clay)/--ok/--line/--muted…），不寫死 hex。
//
// 設計門（ui-ux-pro-max）：
//   · 色彩非唯一資訊(High)——每步皆有 S# 序號＋文字標籤＋狀態文字（done/目前/待辦），
//     不單靠顏色；目前步另以 aria-current="step" 標記，輔具可讀。
//   · 對比/觸控——序號徽章 ≥ 24px，列表項以語意 li 呈現，焦點不需（純展示）。
//   · 動效——僅 token 既有的 200ms transition，尊重 prefers-reduced-motion（design-kit token 已含）。
// ============================================================================
import * as React from "react";
import { Check } from "lucide-react";
import { AidvKit, Eyebrow, cn } from "@/components/design-kit";

/** 旅程九步（S1–S9）。對映設計 §1.3 旅程：意圖→品牌→內容→生成→多尺寸→發佈。 */
export interface JourneyStep {
  /** 序號鍵（S1…S9），用於 key 與徽章顯示。 */
  id: string;
  /** 步驟標籤（中文短語）。 */
  label: string;
}

/** /social 旅程九步預設（S1–S9）。可由呼叫端覆寫。 */
export const SOCIAL_JOURNEY_STEPS: JourneyStep[] = [
  { id: "S1", label: "意圖" },
  { id: "S2", label: "套品牌" },
  { id: "S3", label: "文案" },
  { id: "S4", label: "選題" },
  { id: "S5", label: "版型" },
  { id: "S6", label: "生成" },
  { id: "S7", label: "多尺寸" },
  { id: "S8", label: "發佈" },
  { id: "S9", label: "精選/回顧" },
];

type StepState = "done" | "current" | "todo";

const STATE_LABEL: Record<StepState, string> = {
  done: "已完成",
  current: "目前",
  todo: "待辦",
};

function badgeClass(state: StepState): string {
  // 序號徽章：done＝珊瑚橘實心、current＝珊瑚橘描邊高亮、todo＝中性描邊。皆走 .aidv-kit token。
  switch (state) {
    case "done":
      return "bg-[var(--clay)] text-[var(--on-clay)] border-transparent";
    case "current":
      return "bg-[var(--clay-tint)] text-[var(--clay)] border-[var(--clay)]";
    default:
      return "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--line)]";
  }
}

export interface SocialJourneyStepperProps {
  /** 目前所在步（1-based，1…9）。超界自動夾住。 */
  current: number;
  /** 步驟清單（預設九步 S1–S9）。 */
  steps?: JourneyStep[];
  className?: string;
}

/**
 * 九步旅程步進指示（S1–S9）。純展示：依 current 推導每步 done/current/todo。
 * 包在 <AidvKit>（.aidv-kit）內，token 才解析成設計套件原義（亮色暖光）。
 */
export function SocialJourneyStepper({
  current,
  steps = SOCIAL_JOURNEY_STEPS,
  className,
}: SocialJourneyStepperProps) {
  const total = steps.length;
  const cur = Math.max(1, Math.min(total, Math.round(current)));

  return (
    <AidvKit
      as="nav"
      aria-label={`社群九步旅程，目前第 ${cur} 步，共 ${total} 步`}
      className={cn("space-y-2", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>旅程 S1–S9</Eyebrow>
        <span className="text-[11px] font-semibold text-[var(--muted)]">
          第 {cur} / {total} 步
        </span>
      </div>

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {steps.map((step, i) => {
          const n = i + 1;
          const state: StepState = n < cur ? "done" : n === cur ? "current" : "todo";
          const isLast = n === total;
          return (
            <li
              key={step.id}
              className="flex items-center gap-1"
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex size-6 flex-none items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-200",
                  badgeClass(state),
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span>{step.id}</span>
                )}
              </span>
              <span
                className={cn(
                  "text-[12px] font-medium",
                  state === "current"
                    ? "text-[var(--clay)]"
                    : state === "done"
                      ? "text-[var(--text-soft)]"
                      : "text-[var(--muted)]",
                )}
              >
                {step.label}
                {/* 狀態以文字呈現＝色彩非唯一資訊；目前步顯式標「目前」，其餘給輔具 sr-only。 */}
                {state === "current" ? (
                  <span className="ml-1 text-[10px] text-[var(--muted)]">（目前）</span>
                ) : (
                  <span className="sr-only">{STATE_LABEL[state]}</span>
                )}
              </span>
              {!isLast && (
                <span aria-hidden className="mx-0.5 text-[var(--line-strong)]">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </AidvKit>
  );
}

export default SocialJourneyStepper;
