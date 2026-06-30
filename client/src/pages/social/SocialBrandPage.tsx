// ============================================================================
// pages/social/SocialBrandPage.tsx — 品牌/風格庫（brand_kits 管理 + 鎖定閘門 | block_combos 風格）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §2 / §3.3 / §7.1。
//   左＝BrandKitPanel（品牌身份 + 鎖定閘門，Tier-0 重用 block_combos+vault）；
//   右＝風格庫（block_combos 風格模板，與品牌正交：品牌管套用、風格管「怎麼生」）。
// 三者分工：block_combos=生成風格、showcase 範本=排版骨架、brand kit=品牌套用（§3.3）。
// ============================================================================
import { useState } from "react";
import { Plus, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useBrandKit } from "@/social/useBrandKit";
import { useCreativeProject } from "@/spine/useCreativeProject";
import { SocialNav } from "@/components/social/SocialNav";
import { BrandKitPanel } from "@/components/social/BrandKitPanel";
import { PosterPreview } from "@/components/social/PosterPreview";
import { getPreset } from "@/social/sizePresets";

// 風格庫（block_combos 風格咒語）：與品牌正交，管「怎麼生」（§3.3）。
const STYLE_COMBOS = [
  { id: "combo_jinqing", label: "青金漸層", text: "navy→gold soft gradient, calm, film grain" },
  { id: "combo_morning", label: "晨光霧感", text: "soft morning haze, warm light, gentle bokeh" },
  { id: "combo_ink", label: "水墨留白", text: "ink wash, negative space, zen minimal" },
  { id: "combo_paper", label: "溫潤紙感", text: "warm paper texture, matte, editorial" },
];

export default function SocialBrandPage() {
  const brand = useBrandKit();
  const active = useCreativeProject() as { activeProject?: { name?: string } | null };
  const [newName, setNewName] = useState("");
  const previewPreset = getPreset("ig_square")!;

  const onSave = () => {
    const block = brand.save(); // Tier-0：序列化成 block_combos 形狀（real→blockCombos.create/update）
    toast.success("品牌已儲存（Tier-0）", { description: `序列化為 block_combos「${block.label}」` });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <SocialNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">品牌 / 風格庫</h1>
          <p className="text-sm text-muted-foreground">品牌身份管套用（色彩 / 字體 / logo）</p>
        </div>
        <Badge variant="outline">{active?.activeProject?.name ?? "跨頁共用"}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
        {/* 左：品牌身份 + 鎖定 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">品牌身份 Brand Kit</CardTitle>
            <Button size="sm" variant="outline" onClick={onSave}>
              <Save className="h-4 w-4" /> 儲存
            </Button>
          </CardHeader>
          <CardContent>
            <BrandKitPanel brand={brand} affectedPosts={3} />
          </CardContent>
        </Card>

        {/* 右：品牌套用預覽 + 新建品牌 + 風格庫 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">套用預覽</CardTitle>
            </CardHeader>
            <CardContent>
              <PosterPreview
                brandKit={brand.kit}
                slots={{ headline: "放下，即是自在。", badge: brand.kit.voice.tone, cta: "閱讀更多" }}
                preset={previewPreset}
                brandLocked={brand.locked}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">新建品牌（活動子品牌）</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="品牌名稱" />
              <Button
                variant="secondary"
                onClick={() => {
                  if (!newName.trim()) return;
                  brand.update({ name: newName.trim(), lockState: "draft", version: 1 });
                  toast.success("已建立草稿品牌", { description: newName.trim() });
                  setNewName("");
                }}
              >
                <Plus className="h-4 w-4" /> 建立
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Palette className="h-3.5 w-3.5" /> 風格版型庫
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {STYLE_COMBOS.map((c) => (
                <Badge key={c.id} variant="outline" className="cursor-default" title={c.text}>
                  🧩 {c.label}
                </Badge>
              ))}
              <p className="mt-2 text-[11px] text-muted-foreground">
                風格與品牌正交：品牌管套用（色/字/logo），風格管生成咒語（光感/色調/構圖）。選一個 combo 帶入生成 prompt，generation_history 記下來源。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
