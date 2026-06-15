// ============================================================================
// components/social/BrandKitPanel.tsx — 品牌庫面板（brand-lock 閘門 UI）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §2.1 / §2.2 / §2.4。
//   顯示 logo/色票/字體/voice，鎖定狀態徽章與閘門旗標（missing_*/low_contrast），
//   鎖定/解鎖按鈕（解鎖＝version++、提示「將影響 N 篇既有貼文」→ 下游 stale）。
// Tier-0：品牌身份來自 useBrandKit（記憶體＋block_combos 序列化就緒）；鎖定閘門語意
//   對映 consistency_vault（兩條創作線共用品管脊椎）。
// ============================================================================
import { Lock, Unlock, ShieldCheck, ShieldAlert, Palette, Type, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 視覺實裝第 4 片：
//   品牌閘門旗標列（缺 logo／色票不足／對比未達 AA…）旗標 ON 時改用 design-kit Pill，
//   OFF（預設）＝沿用既有 Badge＝零變化（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, Pill } from "@/components/design-kit";
import type { UseBrandKitResult } from "@/social/useBrandKit";
import type { BrandGateFlag } from "@/social/brandKit";

const FLAG_LABEL: Record<BrandGateFlag, string> = {
  missing_logo: "缺 logo",
  missing_palette: "色票不足（需 ≥2）",
  missing_font: "缺字體",
  low_contrast: "對比未達 AA（可覆寫）",
  superseded: "版本已被取代",
};

/**
 * 品牌閘門旗標列（缺件/對比警告）。U-6/AIDV-96 逐殼採用第 4 片：
 *   旗標 ON＝design-kit Pill（low_contrast＝warn 金、其餘＝bad 珊瑚紅，帶狀態點）；
 *   OFF（預設）＝既有 Badge＝零變化。純展示、props 驅動＝零後端、可回滾。
 *   設計門 ui-ux-pro-max「色彩非唯一資訊(High)」：兩版皆有文字標籤，不單靠顏色。
 */
export function BrandGateFlags({ flags }: { flags: BrandGateFlag[] }) {
  if (flags.length === 0) return null;
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="div" className="flex flex-wrap gap-1.5">
        {flags.map((f) => (
          <Pill key={f} kind={f === "low_contrast" ? "warn" : "bad"} dot>
            {FLAG_LABEL[f]}
          </Pill>
        ))}
      </AidvKit>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <Badge key={f} variant={f === "low_contrast" ? "secondary" : "destructive"} className="text-[10px]">
          {FLAG_LABEL[f]}
        </Badge>
      ))}
    </div>
  );
}

interface BrandKitPanelProps {
  brand: UseBrandKitResult;
  /** 受此品牌影響的貼文數（解鎖警告用；Tier-0 由呼叫端估算）。 */
  affectedPosts?: number;
  className?: string;
}

export function BrandKitPanel({ brand, affectedPosts = 0, className }: BrandKitPanelProps) {
  const { kit, gate, locked } = brand;

  const onLock = () => {
    if (gate.state === "blocked") {
      toast.error("無法鎖定品牌", { description: "請先補齊：" + gate.flags.map((f) => FLAG_LABEL[f]).join("、") });
      return;
    }
    brand.lock();
    toast.success("品牌已鎖定", { description: "批量出圖／匯出／發佈已解禁（consistency_vault）。" });
  };

  const onUnlock = () => {
    brand.unlock();
    toast.message("品牌已解鎖（version++）", {
      description: affectedPosts > 0 ? `將影響 ${affectedPosts} 篇既有貼文 → 標 stale，可選擇性重生。` : "後續貼文將用新版品牌。",
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* 標頭 + 鎖定狀態 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{kit.name}</span>
          <Badge variant="outline" className="text-[10px]">
            v{kit.version}
          </Badge>
        </div>
        {locked ? (
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" /> 已鎖定
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <ShieldAlert className="h-3.5 w-3.5" /> {kit.lockState === "draft" ? "草稿" : "已配置（未鎖）"}
          </Badge>
        )}
      </div>

      {/* 閘門旗標 */}
      <BrandGateFlags flags={gate.flags} />

      <Separator />

      {/* 色票 */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Palette className="h-3.5 w-3.5" /> 品牌色
        </div>
        <div className="flex flex-wrap gap-2">
          {kit.palette.map((s) => (
            <div key={s.role} className="w-16">
              <div className="h-12 rounded-lg border" style={{ background: s.hex }} />
              <div className="mt-1 text-[9px] text-muted-foreground">{s.role}</div>
              <div className="font-mono text-[9px] text-muted-foreground">{s.hex}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 字體 */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Type className="h-3.5 w-3.5" /> 字體
        </div>
        <div className="text-sm">
          <span style={{ fontFamily: kit.typography.heading.family, fontWeight: kit.typography.heading.weight }}>
            標題 {kit.typography.heading.family.split(",")[0].replace(/['"]/g, "")}
          </span>
          <span className="mx-2 text-muted-foreground">·</span>
          <span style={{ fontFamily: kit.typography.body.family }}>內文 {kit.typography.body.family.split(",")[0].replace(/['"]/g, "")}</span>
        </div>
      </section>

      {/* voice & tone */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" /> 口吻 Voice（餵給文案 system 約束）
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline">{kit.voice.tone}</Badge>
          {kit.voice.preferredWords.slice(0, 4).map((w) => (
            <span key={w} className="text-muted-foreground">
              {w}
            </span>
          ))}
          <span className="text-muted-foreground">· emoji：{kit.voice.emojiPolicy}</span>
        </div>
      </section>

      <Separator />

      {/* 鎖定 / 解鎖 */}
      {locked ? (
        <Button variant="outline" className="w-full" onClick={onUnlock}>
          <Unlock className="h-4 w-4" /> 解鎖品牌（version++）
        </Button>
      ) : (
        <Button className="w-full" onClick={onLock} disabled={gate.state === "blocked"}>
          <Lock className="h-4 w-4" /> 鎖定品牌
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        品牌鎖定後，所有社群生成都會套用上述色票與字標，跨貼文一致。品牌未鎖時批量出圖／發佈會被閘門擋下（單張試做可放行）。
      </p>
    </div>
  );
}

export default BrandKitPanel;
