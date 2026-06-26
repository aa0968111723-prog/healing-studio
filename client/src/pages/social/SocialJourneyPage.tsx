// ============================================================================
// pages/social/SocialJourneyPage.tsx — /social/journey 九步社群創作旅程（S1–S9 完整視覺實裝）
// ----------------------------------------------------------------------------
// AIDV-96 U-6 · /social 九步旅程視覺實裝（量大 XL）。
//
// 九步依序：
//   S1 設計類型（TemplateCardGrid）
//   S2 五問 brief（BriefForm + AI 代寫）
//   S3 收集素材（SourceSelector + HOLD gate）
//   S4 創作生成（GenerationConsole + 成本先估）
//   S5 修改與預覽（PosterPreview + 核准門）
//   S6 圖層合成（stub · social.composeLayout 待建）
//   S7 Canva·Adobe 往返（stub · MCP 待接）
//   S8 反覆修正（版本列 + stale 標記 + 批次重生）
//   S9 完成（A 品牌鎖閘門 · B 多尺寸匯出 · C 發佈排程 stub）
//
// 鐵律：
//   · S6/S7/S9-C 依賴新後端 → flag-gated 殼 + Pill「待建/整合點」不杜撰 procedure。
//   · 旗標 ENABLE_AIDV_CHROME OFF=既有樣式零變化；ON=design-kit 暖光（零新旗標）。
//   · 導航一律走 wouter navigate，不碰 window.location。
//   · 六 adapter seam：DataStore / Generation / Commander / Storage / promptVault（面板不直呼 procedure）。
// ============================================================================
import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSocialPost } from "@/social/useSocialPost";
import { useBrandKit } from "@/social/useBrandKit";
import { getPreset } from "@/social/sizePresets";
import { SocialNav } from "@/components/social/SocialNav";
import { SocialJourneyStepper } from "@/components/social/SocialJourneyStepper";
import { TemplateCardGrid } from "@/components/social/TemplateCard";
import { BriefForm, type BriefData } from "@/components/social/BriefForm";
import { SourceSelector } from "@/components/social/SourceSelector";
import { GenerationConsole } from "@/components/social/GenerationConsole";
import { PosterPreview } from "@/components/social/PosterPreview";
import { ExportRatioGrid } from "@/components/social/ExportRatioCard";
import { AidvKit, Pill, Eyebrow } from "@/components/design-kit";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";

// S6/S7/S9-C 的 stub 面板：殼已實裝，後端程序另行開卡。
function StubPanel({ step, label, pillText }: { step: string; label: string; pillText: string }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit className="flex flex-col items-center gap-4 py-10 text-center">
        <div>
          <Eyebrow>{step} · {label}</Eyebrow>
        </div>
        <Pill kind="warn">{pillText}</Pill>
        <p className="max-w-sm text-sm text-[var(--muted)]">
          此步驟依賴新後端程序，另行開卡實作。UX 殼已就位，等後端接縫就緒後直接接入。
        </p>
      </AidvKit>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <p className="font-medium">{step} · {label}</p>
      <span className="rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-700">
        {pillText}
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">
        此步驟依賴新後端程序，另行開卡實作。
      </p>
    </div>
  );
}

// S8 版本列（以 post.exports 做版本歷程展示）
function S8VersionList({ exports: exps, onBatchRegen }: { exports: { presetId: string; contentHash: string }[]; onBatchRegen: () => void }) {
  if (exps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        尚無匯出版本。完成 S9 匯出後，可在此批次重生或釘選版本。
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {exps.map((exp) => (
          <div key={exp.presetId} className="flex items-center gap-2 rounded-md border bg-card p-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            <span className="flex-1 font-medium">{exp.presetId}</span>
            <span className="font-mono text-xs text-muted-foreground">{exp.contentHash?.slice(0, 8) ?? "—"}</span>
            {ENABLE_AIDV_CHROME ? (
              <Pill kind="ok">已釘選</Pill>
            ) : (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">已釘選</span>
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={onBatchRegen}>
        批次重生全部版本
      </Button>
    </div>
  );
}

export default function SocialJourneyPage() {
  const postState = useSocialPost();
  const { post } = postState;
  const brand = useBrandKit();
  const [currentStep, setCurrentStep] = useState(1);
  const [brief, setBrief] = useState<BriefData>({
    purpose: "",
    audience: "",
    voice: brand.kit.voice.tone,
    message: "",
    direction: "",
  });
  const [sourceHold, setSourceHold] = useState(false);

  const previewPreset = getPreset("ig_square")!;
  const layoutBase = {
    templateId: post.templateId ?? undefined,
    brandKit: brand.kit,
    slots: {
      headline: post.copy.headline,
      subhead: post.copy.subhead,
      body: post.copy.body,
      cta: post.copy.cta,
      badge: brand.kit.voice.tone,
    },
    backgroundAssetUrl: post.background?.assetUrl,
    seed: post.background?.seed ?? 0,
    brandLocked: post.brandLock && brand.locked,
  };

  function canAdvance(): boolean {
    switch (currentStep) {
      case 1: return !!post.templateId;
      case 2: return !!(brief.purpose || brief.message);
      case 3: return !sourceHold;
      default: return true;
    }
  }

  function handleNext() {
    if (!canAdvance()) {
      const msg =
        currentStep === 1 ? "請先選擇一個設計類型"
        : currentStep === 2 ? "請至少填寫「目的」或「關鍵訊息」"
        : "外部素材授權未確認，解除所有 HOLD 後繼續";
      toast.warning(msg);
      return;
    }
    setCurrentStep((prev) => Math.min(9, prev + 1));
  }

  function handlePrev() {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }

  function renderStep() {
    switch (currentStep) {
      case 1:
        return (
          <TemplateCardGrid
            value={post.templateId}
            onChange={(id) => {
              postState.setTemplate(id);
              toast.message("已選版型", { description: id });
            }}
          />
        );

      case 2:
        return <BriefForm value={brief} onChange={setBrief} />;

      case 3:
        return <SourceSelector onHoldChange={setSourceHold} />;

      case 4:
        return (
          <div className="space-y-3">
            {ENABLE_AIDV_CHROME && (
              <AidvKit>
                <div>
                  <Eyebrow>S4 · 創作生成</Eyebrow>
                </div>
              </AidvKit>
            )}
            <GenerationConsole
              prompt={`${brief.direction || brief.message || post.copy.headline} | template=${post.templateId ?? "—"} | brand=${brand.kit.name}`}
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
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            {ENABLE_AIDV_CHROME && (
              <AidvKit>
                <div>
                  <Eyebrow>S5 · 修改與預覽</Eyebrow>
                </div>
              </AidvKit>
            )}
            {!post.background ? (
              <p className="text-sm text-muted-foreground">請先回到 S4 生成主視覺。</p>
            ) : (
              <PosterPreview {...layoutBase} preset={previewPreset} showHash />
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={post.approval === "approved" ? "secondary" : "default"}
                disabled={post.approval !== "generated" && post.approval !== "approved"}
                onClick={() => {
                  postState.approve();
                  toast.success("單張已核准", { description: "可進入多尺寸匯出（S9）" });
                }}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {post.approval === "approved" ? "已核准" : "核准單張"}
              </Button>
            </div>
            {post.approval === "pending" && (
              <p className="text-xs text-muted-foreground">出圖後可核准單張，核准後方可匯出多尺寸。</p>
            )}
          </div>
        );

      case 6:
        return <StubPanel step="S6" label="圖層拼接合成" pillText="待建 · social.composeLayout" />;

      case 7:
        return <StubPanel step="S7" label="Canva · Adobe 往返" pillText="整合點 · MCP 待接" />;

      case 8:
        return (
          <div className="space-y-4">
            {ENABLE_AIDV_CHROME && (
              <AidvKit>
                <div>
                  <Eyebrow>S8 · 反覆修正</Eyebrow>
                </div>
              </AidvKit>
            )}
            <S8VersionList
              exports={post.exports}
              onBatchRegen={() => toast.message("批次重生", { description: "generation.* 接縫實裝後可真實重生" })}
            />
          </div>
        );

      case 9:
        return (
          <div className="space-y-4">
            {/* A：品牌鎖閘門 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">A · 品牌鎖閘門</CardTitle>
              </CardHeader>
              <CardContent>
                {brand.locked ? (
                  ENABLE_AIDV_CHROME ? (
                    <Pill kind="ok" dot>品牌已鎖定 · 可批量匯出</Pill>
                  ) : (
                    <span className="text-sm font-medium text-emerald-600">✓ 品牌已鎖定 · 可批量匯出</span>
                  )
                ) : (
                  ENABLE_AIDV_CHROME ? (
                    <Pill kind="warn">品牌未鎖定（{brand.kit.lockState}）· 僅可單張試做</Pill>
                  ) : (
                    <span className="text-sm text-amber-600">品牌未鎖定 · 僅可單張試做</span>
                  )
                )}
              </CardContent>
            </Card>

            {/* B：多尺寸匯出 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">B · 多尺寸匯出（IG / Stories / LinkedIn / TikTok / FB / Twitter）</CardTitle>
              </CardHeader>
              <CardContent>
                {!post.background && (
                  <p className="mb-3 text-xs text-muted-foreground">請先在 S4 生成主視覺，再匯出多尺寸。</p>
                )}
                <ExportRatioGrid
                  disabled={!post.background || post.approval !== "approved"}
                  onExport={(specId) => {
                    postState.recordExport({ presetId: specId, assetUrl: `data:image/png;mock,${specId}`, contentHash: specId });
                    toast.success("已匯出", { description: specId });
                  }}
                />
                {post.approval !== "approved" && post.background && (
                  <p className="mt-2 text-xs text-muted-foreground">請先在 S5 核准單張，再批量匯出。</p>
                )}
              </CardContent>
            </Card>

            {/* C：發佈排程（stub） */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">C · 發佈排程</CardTitle>
              </CardHeader>
              <CardContent>
                <StubPanel step="S9-C" label="發佈排程" pillText="待建 · posting + exportSizes" />
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <SocialNav />

      <div>
        <h1 className="text-xl font-semibold">社群創作旅程</h1>
        <p className="text-sm text-muted-foreground">S1 設計類型 → S9 完成發佈（九步全流程）</p>
        <SocialJourneyStepper current={currentStep} className="mt-2" />
      </div>

      <Card>
        <CardContent className="pt-5">{renderStep()}</CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={handlePrev} disabled={currentStep === 1} aria-label="上一步">
          <ArrowLeft className="h-4 w-4" aria-hidden /> 上一步
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          第 {currentStep} / 9 步
        </span>
        {currentStep < 9 ? (
          <Button onClick={handleNext} aria-label="下一步">
            下一步 <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => toast.success("旅程完成！", { description: "九步全程已走完 ✅" })}
          >
            完成旅程 ✅
          </Button>
        )}
      </div>
    </div>
  );
}
