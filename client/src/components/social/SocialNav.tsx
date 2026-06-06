// ============================================================================
// components/social/SocialNav.tsx — /social shell 內部分頁導覽
// ----------------------------------------------------------------------------
// 對映設計 §7.1 路由地圖：/social(cockpit) · /social/studio · /social/brand · /social/publish。
// 用 wouter Link（與 repo 既有導覽一致）；ShellFrame 已提供外層 chrome，這層只是 sub-nav。
// ============================================================================
import { Link, useLocation } from "wouter";
import { LayoutGrid, Palette, Shield, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { path: "/social", label: "工作台", icon: LayoutGrid },
  { path: "/social/studio", label: "圖像台", icon: Palette },
  { path: "/social/brand", label: "品牌庫", icon: Shield },
  { path: "/social/publish", label: "發佈/精選", icon: Send },
] as const;

export function SocialNav({ className }: { className?: string }) {
  const [location] = useLocation();
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
