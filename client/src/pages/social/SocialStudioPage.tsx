// ============================================================================
// pages/social/SocialStudioPage.tsx — 圖像台：版型→品牌鎖→生成→多尺寸匯出（核心 flow）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3（生成流程）/ §3.4（多尺寸）/ §7.2。
//
// 這是 Bruce 指定的核心動線一頁到底：
//   STEP 1 版型庫（TemplatePicker，重用 block_combos）
//   STEP 2 品牌鎖（useBrandKit 閘門；未鎖 → 批量/匯出受限，單張可試做）
//   STEP 3 文字插槽 + 生成背景（GenerationConsole，provider 可選 + 回退鏈）
//   STEP 4 多尺寸匯出（SizeExportGrid，master→variants；匯出寫資產）
//   即時預覽：PosterPreview（composeLayout 確定性文字層，疊在生成背景上）
//
// 全程接 P0 接縫：generation（出圖）、storage.recordGenResult（匯出寫資產）。零金鑰用 mock。
// ============================================================================
import { useMemo, useState } from "react";
import { Lock, Unlock, CheckCircle2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSpine } from "@/providers/SpineProvider";
import { useBrandKit } from "@/social/useBrandKit";
import { useSocialPost, canExportOrPublish } from "@/social/useSocialPost";
import { getPreset, DEFAULT_EXPORT_BUNDLE } from "@/social/sizePresets";
import { SocialNav } from "@/components/social/SocialNav";
import { TemplatePicker } from "@/components/social/TemplatePicker";
import { GenerationConsole } from "@/components/social/GenerationConsole";
import { PosterPreview } from "@/components/social/PosterPreview";
import { SizeExportGrid } from "@/components/social/SizeExportGrid";
import { PromptVaultAdoption } from "@/components/promptVault";
import { ENABLE_PROMPT_VAULT } from "@/config/promptVaultFlags";

export default function SocialStudioPage() {
  const spine = useSpine();
  const brand = useBrandKit();
  const postState = useSocialPost();
  const { post } = postState;
  const [selected, setSelected] = useState<string[]>(DEFAULT_EXPORT_BUNDLE);

  // 預覽用 preset：依版型比例挑一個代表（方形預設）。
  const previewPreset = getPreset("ig_square")!;
  const slots = useMemo(
    () => ({
      headline: post.copy.headline,
      subhead: post.copy.subhead,
      body: post.copy.body,
      cta: post.copy.cta,
      badge: brand.kit.voice.tone,
    }),
    [post.copy, brand.kit.voice.tone],
  );

  const layoutBase = {
    templateId: post.templateId ?? undefined,
    brandKit: brand.kit,
    slots,
    backgroundAssetUrl: post.background?.assetUrl,
    seed: post.background?.seed ?? 0,
    brandLocked: post.brandLock && brand.locked,
  };

  const exportReady = canExportOrPublish(post);
  const exportDisabledReason = !post.background
    ? "先在 STEP 3 生成主視覺。"
    : post.approval !== "approved"
      ? "先核准單張（確認門等價物）才能匯出多尺寸。"
      : !post.sourceConfirmed
        ? "請先確認素材來源（你有使用權）。"
        : post.brandLock && !brand.locked
          ? "品牌鎖開啟但品牌未鎖：請到品牌庫鎖定，或關閉品牌鎖做單張試做。"
          : undefined;

  async function handleExport(presetId: string, dataUrl: string, contentHash: string) {
    // 匯出即資產：寫 digital_asset_library（真實 procedure generate.recordGenResult）。
    try {
      await spine.adapters.storage.recordGenResult({
        projectId: undefined,
        kind: "image",
        provider: post.background?.provider as never ?? spine.provider,
        model: "social.composeLayout+reframe",
        costUsd: 0,
        assetUrl: dataUrl,
      });
    } catch {
      /* 寫資產失敗不阻斷下載；由 Storage seam / 背景修復補償 */
    }
    postState.recordExport({ presetId, assetUrl: dataUrl, contentHash });
    const p = getPreset(presetId);
    toast.success("已匯出", { description: `${p?.platform} ${p?.ratioLabel} · 已掛回貼文` });
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <SocialNav />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">圖像台</h1>
          <p className="text-sm text-muted-foreground">版型 → 品牌鎖 → 生成 → 多尺寸匯出</p>
        </div>
        <Badge variant="outline" className="gap-1">
          接縫 generation：{spine.adapters.meta.generation}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        {/* 左欄：STEP 1–3 控制 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">STEP 1 · 版型庫</CardTitle>
            </CardHeader>
            <CardContent>
              <TemplatePicker value={post.templateId} onChange={postState.setTemplate} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {post.brandLock && brand.locked ? <Lock className="h-4 w-4 text-emerald-500" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <div className="text-sm font-medium">STEP 2 · 品牌鎖 Brand Lock</div>
                    <p className="text-xs text-muted-foreground">套品牌色/字/logo（{brand.kit.name} v{brand.kit.version}）</p>
                  </div>
                </div>
                <Switch checked={post.brandLock} onCheckedChange={postState.toggleBrandLock} aria-label="品牌鎖" />
              </div>
              {post.brandLock && !brand.locked && (
                <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  品牌尚未鎖定（{brand.kit.lockState}）。可到品牌庫鎖定以解禁批量匯出。
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">STEP 3 · 文字 + 生成</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="headline" className="text-xs">標題</Label>
                <Input id="headline" value={post.copy.headline} onChange={(e) => postState.setCopy({ headline: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brief" className="text-xs">Brief（餵 Claude 文案 / 組生成 prompt）</Label>
                <Textarea id="brief" rows={3} value={post.brief} onChange={(e) => postState.setBrief(e.target.value)} />
              </div>
              <GenerationConsole
                prompt={`${post.brief} | template=${post.templateId ?? "—"} | brandLock=${post.brandLock}`}
                kind="image"
                onDone={(res) =>
                  postState.setBackground({
                    assetUrl: res.assetUrl,
                    seed: res.seedUsed,
                    provider: res.provider,
                    model: res.model,
                    costUsd: res.costUsd,
                    kind: "image",
                  })
                }
              />
            </CardContent>
          </Card>
          {ENABLE_PROMPT_VAULT && (
            <PromptVaultAdoption
              sourceWorkflow="social"
              payload={post.brief ? { title: "社群 Brief", content: post.brief, category: "social" } : null}
              onApply={(entry) => postState.setBrief(entry.prompt)}
            />
          )}
        </div>

        {/* 右欄：預覽 + 核准 + STEP 4 匯出 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" /> 輸出預覽（composeLayout 文字層）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <PosterPreview {...layoutBase} preset={previewPreset} showHash />
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {post.background ? `已生成 · seed ${post.background.seed} · ${post.background.model}` : "尚未生成主視覺（STEP 3）"}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={post.approval === "approved" ? "secondary" : "default"}
                    disabled={post.approval !== "generated" && post.approval !== "approved"}
                    onClick={() => {
                      postState.approve();
                      toast.success("單張已核准", { description: "可進入多尺寸匯出 / 排程發佈。" });
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" /> {post.approval === "approved" ? "已核准" : "核准單張"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">STEP 4 · 多尺寸匯出</CardTitle>
            </CardHeader>
            <CardContent>
              <Separator className="mb-3" />
              <SizeExportGrid
                {...layoutBase}
                selected={selected}
                onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                onExport={(preset, variant) => handleExport(preset.id, variant.dataUrl, variant.contentHash)}
                disabled={!exportReady}
                disabledReason={exportDisabledReason}
              />
              {post.exports.length > 0 && (
                <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
                  已匯出 {post.exports.length} 個尺寸變體，皆掛回此貼文。前往「發佈/精選」排程或發佈。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
