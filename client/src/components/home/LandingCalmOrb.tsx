// ============================================================================
// components/home/LandingCalmOrb.tsx — U-10 calm orb 平靜光球（門面裝飾）
// ----------------------------------------------------------------------------
// AIDV-119 / U-10：首頁 landing 門面的「平靜光球」。亮色暖光（黏土／珊瑚橘）的
// 低耗呼吸光球，作為 hero 的視覺錨點，傳達「平靜、療癒、慢下來」的氛圍。
//
// 設計鐵則：
//   · 全 design-kit token（var(--clay)/--gold/--surface…），零硬編 hex。
//   · 純前端、純呈現、零後端、唯讀（不接 spine / 不導航）。
//   · 動效低耗：只用 transform/opacity（GPU 合成層），150–300ms 之外為長呼吸，
//     不觸發 layout/paint；prefers-reduced-motion 時完全靜止（animate 全關）。
//   · a11y：純裝飾，aria-hidden；不搶焦點、不擋觸控（pointer-events-none）。
//
// 動效以 inline <style> 注入 @keyframes + @media (prefers-reduced-motion) 守則，
// 不碰共用 design-kit.css（隔離鐵則）。class 名前綴 lk-orb- 避免全站碰撞。
// ============================================================================
import * as React from "react";

export type CalmOrbSize = "sm" | "md" | "lg";

const SIZE_PX: Record<CalmOrbSize, number> = { sm: 160, md: 260, lg: 360 };

const ORB_CSS = `
@keyframes lk-orb-breathe {
  0%, 100% { transform: scale(1); opacity: 0.92; }
  50%      { transform: scale(1.045); opacity: 1; }
}
@keyframes lk-orb-halo {
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50%      { transform: scale(1.12); opacity: 0.28; }
}
.lk-orb-breathe { animation: lk-orb-breathe 7s ease-in-out infinite; will-change: transform, opacity; }
.lk-orb-halo    { animation: lk-orb-halo 7s ease-in-out infinite; will-change: transform, opacity; }
@media (prefers-reduced-motion: reduce) {
  .lk-orb-breathe, .lk-orb-halo { animation: none; }
}
`;

export function LandingCalmOrb({
  size = "md",
  className,
  label,
}: {
  size?: CalmOrbSize;
  /** 額外 class（定位等） */
  className?: string;
  /** 給螢幕閱讀器的描述；省略＝純裝飾（aria-hidden） */
  label?: string;
}) {
  const px = SIZE_PX[size];
  return (
    <div
      className={["relative grid place-items-center", className].filter(Boolean).join(" ")}
      style={{ width: px, height: px }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      data-testid="landing-calm-orb"
    >
      <style>{ORB_CSS}</style>

      {/* 外暈光環（慢呼吸、低不透明，reduced-motion 靜止） */}
      <span
        className="lk-orb-halo pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, var(--clay-tint-2), var(--clay-tint) 45%, transparent 72%)",
        }}
      />

      {/* 主光球（暖光漸層＋柔邊；只動 transform/opacity） */}
      <span
        className="lk-orb-breathe pointer-events-none relative rounded-full"
        style={{
          width: "62%",
          height: "62%",
          background:
            "radial-gradient(circle at 38% 32%, var(--surface), var(--clay-soft) 38%, var(--clay) 78%, var(--clay-deep) 100%)",
          boxShadow:
            "0 18px 48px -18px var(--clay-ring), inset 0 2px 12px var(--surface)",
        }}
      >
        {/* 高光點（靜態，提升立體感） */}
        <span
          className="absolute rounded-full"
          style={{
            top: "16%",
            left: "22%",
            width: "26%",
            height: "26%",
            background:
              "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--surface) 90%, transparent), transparent 70%)",
            filter: "blur(1px)",
          }}
        />
      </span>
    </div>
  );
}

export default LandingCalmOrb;
