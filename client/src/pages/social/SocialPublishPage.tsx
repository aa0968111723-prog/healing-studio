// ============================================================================
// pages/social/SocialPublishPage.tsx — 發佈/精選（多尺寸 → 內容行事曆〔分頁〕→ 排程/發佈）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §6（排程與發佈）/ §7.1 / §7.2。
//   多尺寸包就緒 → 選通道 → 立即發 / 排程（內容行事曆，重用 project_notes_calendar +
//   orb_scheduled_jobs，零新表）→ mock PostingProvider 標 posted / 回 permalink → 精選牆。
// 第 6 條接縫：usePosting()（預設 mock；翻 VITE_POSTING_PROVIDER=postiz 接真實，UI 不改）。
// ============================================================================
import { useMemo, useState } from "react";
import { Send, CalendarDays, Globe, Link2, Loader2, CircleCheck, CircleX } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { usePosting } from "@/social/usePosting";
import { useBrandKit } from "@/social/useBrandKit";
import { DEFAULT_EXPORT_BUNDLE, getPreset } from "@/social/sizePresets";
import { composeLayout, svgToDataUrl } from "@/social/composeLayout";
import { SocialNav } from "@/components/social/SocialNav";
import {
  CHANNEL_LABEL, type PostingChannel, type PostingEvent, type ExternalRef,
} from "@/adapters/posting.types";

const CHANNELS: PostingChannel[] = ["ig", "fb", "threads", "x", "line"];

export default function SocialPublishPage() {
  const { posting, meta } = usePosting();
  const brand = useBrandKit();
  const [channels, setChannels] = useState<PostingChannel[]>(["ig", "fb"]);
  const [events, setEvents] = useState<PostingEvent[]>([]);
  const [refs, setRefs] = useState<ExternalRef[]>([]);
  const [busy, setBusy] = useState(false);

  // 多尺寸包預覽（取核心匯出包）。
  const bundle = useMemo(
    () =>
      DEFAULT_EXPORT_BUNDLE.map((id) => getPreset(id)!).map((preset) => {
        const { svg } = composeLayout({ brandKit: brand.kit, slots: { headline: "放下，即是自在。", badge: brand.kit.voice.tone }, preset, brandLocked: brand.locked });
        return { preset, dataUrl: svgToDataUrl(svg) };
      }),
    [brand.kit, brand.locked],
  );

  const toggleChannel = (c: PostingChannel) =>
    setChannels((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  async function publish(scheduledAt?: string) {
    if (channels.length === 0) {
      toast.warning("先選至少一個通道");
      return;
    }
    setBusy(true);
    setEvents([]);
    setRefs([]);
    try {
      for (const channel of channels) {
        const res = await posting.publish(
          {
            postId: "post_demo",
            channel,
            copy: { headline: "放下，即是自在。", hashtags: ["#療癒誌", "#正念"], cta: "閱讀更多" },
            assets: bundle.map((b) => ({ assetId: `asset_${b.preset.id}`, assetUrl: b.dataUrl, ratioPreset: b.preset.id })),
            scheduledAt,
          },
          (e) => setEvents((prev) => [...prev, e]),
        );
        setRefs((prev) => [...prev, res.ref]);
        if (res.status === "failed") {
          toast.error(`${CHANNEL_LABEL[channel]} 發佈失敗`, { description: "平台限流/拒件 — 絕不靜默當成功" });
        } else {
          toast.success(`${CHANNEL_LABEL[channel]} ${res.status === "scheduled" ? "已排程" : "已發佈"}`, {
            description: res.ref.permalink ?? "（mock permalink）",
          });
        }
      }
    } catch (err) {
      toast.error("發佈中止", { description: (err as Error)?.message });
    } finally {
      setBusy(false);
    }
  }

  // 內容行事曆：簡化月視圖（本週 7 天），對映 project_notes_calendar（Tier-0 零新表）。
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });
  }, []);
  const [slot, setSlot] = useState<number | null>(null);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <SocialNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">發佈 / 精選</h1>
          <p className="text-sm text-muted-foreground">多尺寸包 → 內容行事曆 → 排程/發佈（PostingProvider）</p>
        </div>
        <Badge variant="outline" className="gap-1">
          接縫 posting：{meta.posting}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,380px)]">
        {/* 左：多尺寸包 + 通道 + 行事曆 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">多尺寸包（master → variants）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {bundle.map(({ preset, dataUrl }) => (
                  <div key={preset.id} className="overflow-hidden rounded-lg border">
                    <img src={dataUrl} alt={preset.platform} className="aspect-square w-full object-contain bg-muted" draggable={false} />
                    <div className="px-1.5 py-1 text-[10px] text-muted-foreground">{preset.platform}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4" /> 內容行事曆（重用 project_notes_calendar · 零新表）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => setSlot(slot === i ? null : i)}
                    className={cn(
                      "rounded-lg border p-2 text-center text-xs transition",
                      slot === i ? "border-primary bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <div className="text-muted-foreground">{["日", "一", "二", "三", "四", "五", "六"][d.getDay()]}</div>
                    <div className="text-sm font-medium">{d.getDate()}</div>
                    {slot === i && <div className="mt-1 text-[9px] text-primary">排這天</div>}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                到點觸發＝orb_scheduled_jobs + background_jobs（換頁/重整不中斷，完成 toast）。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 右：通道選擇 + 發佈動作 + 事件 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">發佈通道</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggleChannel(c)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs transition",
                      channels.includes(c) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {CHANNEL_LABEL[c]}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => publish()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} 立即發佈
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => publish(slot != null ? days[slot].toISOString() : new Date(Date.now() + 86400000).toISOString())}
                  disabled={busy}
                >
                  <CalendarDays className="h-4 w-4" /> 排程
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                mock 發佈：標 posted、回假 permalink、成本 0（不污染真實帳）。翻 VITE_POSTING_PROVIDER=postiz 接真實（28+ 通道），UI 不改。
              </p>
            </CardContent>
          </Card>

          {events.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">發佈事件</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1 text-xs">
                  {events.map((e, i) => (
                    <li key={i} className="flex items-center gap-2">
                      {e.type === "posted" ? (
                        <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
                      ) : e.type === "failed" ? (
                        <CircleX className="h-3.5 w-3.5 text-rose-500" />
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="font-mono">{describePosting(e)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {refs.some((r) => r.permalink) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Globe className="h-3.5 w-3.5" /> 精選牆（featured_showcase）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {refs.filter((r) => r.permalink).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <Badge variant="outline">{CHANNEL_LABEL[r.channel]}</Badge>
                    <span className="flex items-center gap-1 truncate font-mono text-muted-foreground">
                      <Link2 className="h-3 w-3" /> {r.permalink}
                    </span>
                  </div>
                ))}
                <Separator className="my-2" />
                <Button variant="outline" size="sm" className="w-full" onClick={() => toast.success("已發佈到精選", { description: "寫入 featured_showcase（showcase.*）" })}>
                  <Globe className="h-4 w-4" /> 發佈到精選牆
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function describePosting(e: PostingEvent): string {
  switch (e.type) {
    case "queued":
      return `${CHANNEL_LABEL[e.channel]} 排入 · ${e.idempotencyKey}`;
    case "attempt":
      return `${CHANNEL_LABEL[e.channel]} 嘗試（${e.provider}）`;
    case "retry":
      return `${CHANNEL_LABEL[e.channel]} 退避重試 · ${e.reason}`;
    case "posted":
      return `${CHANNEL_LABEL[e.channel]} 成功 · ${e.ref.permalink ?? e.ref.externalId}`;
    case "failed":
      return `${CHANNEL_LABEL[e.channel]} 失敗 · ${e.reason}`;
    default:
      return "";
  }
}
