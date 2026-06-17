// ============================================================================
// components/home/LandingIconSet.tsx — U-10 design-kit icon set 區塊（門面）
// ----------------------------------------------------------------------------
// AIDV-119 / U-10：首頁 landing 的「能力 icon set」。把首頁敘事拆成四枚
// lucide-react icon 卡片（非 emoji），表達「一句話→成片」北極星路上的四個支點。
//
// 設計鐵則：
//   · lucide-react SVG（非 emoji）；每枚 icon 容器 role/aria-label 可辨識。
//   · 重用 design-kit primitives：Card（hover 浮起）＋ Eyebrow；包在 .aidv-kit。
//   · 全 token（var(--clay)/--clay-tint/--text/--muted/--line），零硬編 hex。
//   · 觸控目標 ≥44px：icon 容器 size-12（48px）。對比走 --text/--muted（≥4.5）。
//   · 純呈現、零後端、唯讀（不導航、不接 spine）。
// ============================================================================
import * as React from "react";
import {
  MessageSquareHeart,
  Wand2,
  Clapperboard,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";
import { Card, Eyebrow } from "@/components/design-kit/primitives";

export interface LandingIconItem {
  icon: LucideIcon;
  /** icon 的無障礙名稱（icon-only aria-label） */
  iconLabel: string;
  title: string;
  desc: string;
}

export const LANDING_ICONS: LandingIconItem[] = [
  {
    icon: MessageSquareHeart,
    iconLabel: "一句話",
    title: "一句話開始",
    desc: "把心裡的一句 logline 說出來，不用先想清楚整部片。",
  },
  {
    icon: Wand2,
    iconLabel: "導演企劃",
    title: "導演幫你想",
    desc: "光球導演把一句話展開成分鏡、節奏與畫面語言。",
  },
  {
    icon: Clapperboard,
    iconLabel: "成片",
    title: "一路到成片",
    desc: "從鏡頭到素材一條龍，慢慢把它變成看得見的影片。",
  },
  {
    icon: HeartHandshake,
    iconLabel: "平靜陪伴",
    title: "平靜地陪你",
    desc: "暖光的節奏，讓創作像呼吸一樣，不焦慮、不催促。",
  },
];

export function LandingIconSet({
  eyebrow = "從一句話到成片",
  items = LANDING_ICONS,
  className,
}: {
  eyebrow?: string;
  items?: LandingIconItem[];
  className?: string;
}) {
  return (
    <section
      className={["mx-auto w-full max-w-5xl px-4", className].filter(Boolean).join(" ")}
      aria-label="療癒影像工作室的四個支點"
      data-testid="landing-icon-set"
    >
      <div className="mb-4 flex justify-center">
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.title}>
              <Card pad hover className="h-full">
                <div
                  role="img"
                  aria-label={it.iconLabel}
                  className="mb-3 grid size-12 place-items-center rounded-[14px] bg-[var(--clay-tint)] text-[var(--clay)]"
                >
                  <Icon className="size-5" aria-hidden focusable={false} />
                </div>
                <h3 className="text-[14px] font-semibold text-[var(--text)]">{it.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">
                  {it.desc}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default LandingIconSet;
