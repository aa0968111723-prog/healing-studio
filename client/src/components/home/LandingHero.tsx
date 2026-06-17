// ============================================================================
// components/home/LandingHero.tsx — U-10 首頁 landing 門面 KV（主視覺 hero）
// ----------------------------------------------------------------------------
// AIDV-119 / U-10：greenfield 首頁 landing 門面。亮色暖光（黏土／珊瑚橘）主視覺：
// 一句話 logline → 成片的「北極星敘事」，配 calm orb 平靜光球與 design-kit
// icon set 區塊。範圍一句話：把首頁變成「一句話開始、平靜地走到成片」的暖光門面。
//
// 設計鐵則：
//   · SSOT＝design-kit 亮色暖光；包在 <AidvKit>（.aidv-kit）內，token 才解析成原義。
//   · 重用 primitives：Button（primary/ghost）、Pill、Eyebrow；全 token、零硬編 hex。
//   · 旗標：LANDING_KV_ENABLED（預設 ON、可 env 秒回滾）關閉時整塊不渲染＝零回歸。
//     calm orb 另由 LANDING_CALM_ORB_ENABLED 控制（隸屬門面）。
//   · a11y：主 CTA 焦點環（Button 內建）；觸控 ≥44px（Button md=38px → 此處用 block
//     並排，CTA 容器 py 足量）；對比走 --text/--muted（≥4.5）。動效尊重 reduced-motion
//     （由 LandingCalmOrb 自身守則處理）。
//   · 純前端、零後端、唯讀：CTA 以 props 回呼交給掛載端（預設無回呼＝不導航）。
// ============================================================================
import * as React from "react";
import { AidvKit } from "@/components/design-kit/AidvKit";
import { Button, Pill, Eyebrow } from "@/components/design-kit/primitives";
import { LandingCalmOrb } from "./LandingCalmOrb";
import { LandingIconSet } from "./LandingIconSet";
import { LANDING_KV_ENABLED, LANDING_CALM_ORB_ENABLED } from "./landingFlags";

export interface LandingHeroProps {
  /** 主標 logline（北極星一句話） */
  headline?: React.ReactNode;
  /** 副述 */
  sub?: React.ReactNode;
  /** 主 CTA 文案＋回呼（省略回呼＝純展示、不導航） */
  primaryCta?: string;
  onPrimary?: () => void;
  /** 次 CTA */
  secondaryCta?: string;
  onSecondary?: () => void;
  /** 旗標覆寫（測試用；省略則讀建置時旗標） */
  enabled?: boolean;
  showOrb?: boolean;
  className?: string;
}

export function LandingHero({
  headline = "說一句話，我們陪你慢慢把它變成一部影片。",
  sub = "療癒影像工作室——從一句 logline 到成片，暖光導演陪你一步步走，不焦慮、不催促。",
  primaryCta = "說出你的一句話",
  onPrimary,
  secondaryCta = "先逛逛看",
  onSecondary,
  enabled,
  showOrb,
  className,
}: LandingHeroProps) {
  const on = enabled ?? LANDING_KV_ENABLED;
  if (!on) return null; // 旗標關閉 → 整塊門面不渲染（零回歸、秒回滾）
  const orbOn = showOrb ?? LANDING_CALM_ORB_ENABLED;

  return (
    <AidvKit
      as="section"
      className={["relative w-full overflow-hidden", className].filter(Boolean).join(" ")}
      aria-label="首頁門面"
      data-testid="landing-hero"
    >
      {/* 暖光底 wash（token、純裝飾） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, var(--clay-tint), transparent 60%), var(--wash)",
        }}
      />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-16 sm:py-20">
        {/* 北極星敘事：一句話 → 成片 */}
        <div className="flex flex-col items-center gap-4 text-center">
          <Eyebrow>一句話 · 到成片的北極星</Eyebrow>

          {orbOn && <LandingCalmOrb size="md" className="my-2" />}

          <h1 className="max-w-3xl text-balance text-[28px] font-semibold leading-tight text-[var(--text)] sm:text-[36px]">
            {headline}
          </h1>
          <p className="max-w-2xl text-[14.5px] leading-relaxed text-[var(--text-soft)] sm:text-[16px]">
            {sub}
          </p>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5 py-1">
            <Button variant="primary" size="md" onClick={onPrimary}>
              {primaryCta}
            </Button>
            <Button variant="ghost" size="md" onClick={onSecondary}>
              {secondaryCta}
            </Button>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Pill kind="ok" dot>
              平靜不催促
            </Pill>
            <Pill kind="info" dot>
              暖光導演陪走
            </Pill>
          </div>
        </div>

        {/* design-kit icon set 區塊：四個支點 */}
        <LandingIconSet className="mt-2" />
      </div>
    </AidvKit>
  );
}

export default LandingHero;
