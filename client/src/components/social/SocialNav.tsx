// ============================================================================
// components/social/SocialNav.tsx — /social shell 內部分頁導覽
// ----------------------------------------------------------------------------
// 對映設計 §7.1 路由地圖：/social(cockpit) · /social/studio · /social/brand · /social/publish。
// 用 wouter Link（與 repo 既有導覽一致）；ShellFrame 已提供外層 chrome，這層只是 sub-nav。
//
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 視覺實裝第 1 片：
//   旗標 ON 時，這條子導覽列改用 design-kit 亮色暖光 SubTabs（殼內子分頁語意）；
//   OFF（預設）＝沿用既有 wouter Link 版＝零變化（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）。
//   設計門依 ui-ux-pro-max「色彩非唯一資訊（High）」：兩版皆保留文字標籤＋選取態語意；
//   ON 版導覽改走 wouter navigate（client-side，不碰 window.location，過 check:navigation）。
// ============================================================================
import { Link, useLocation } from "wouter";
import { LayoutGrid, Palette, Shield, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SubTabs } from "@/components/design-kit";

const TABS = [
  { path: "/social", label: "工作台", icon: LayoutGrid },
  { path: "/social/studio", label: "圖像台", icon: Palette },
  { path: "/social/brand", label: "品牌庫", icon: Shield },
  { path: "/social/publish", label: "發佈/精選", icon: Send },
] as const;

export function SocialNav({ className }: { className?: string }) {
  const [location, navigate] = useLocation();

  // 旗標 ON：design-kit 亮色暖光子分頁（SubTabs 自帶 tablist/tab + aria-selected 與選取態）。
  // 以 <AidvKit as="nav"> 維持導覽地標與可及名稱；點擊走 wouter navigate（client-side）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="nav" aria-label="社群分頁" className={className}>
        <SubTabs
          tabs={TABS.map((t) => ({ id: t.path, label: t.label }))}
          active={location}
          onSelect={(id) => navigate(id)}
        />
      </AidvKit>
    );
  }

  return (
    <nav className={cn("flex flex-wrap gap-1 border-b pb-2", className)} aria-label="社群分頁">
      {TABS.map((t) => {
        const active = location === t.path;
        const Icon = t.icon;
        return (
          <Link
            key={t.path}
            href={t.path}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default SocialNav;
