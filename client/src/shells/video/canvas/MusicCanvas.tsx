// ============================================================================
// shells/video/canvas/MusicCanvas.tsx — 中欄畫布：2-6 配樂（接真實 proStudio.textToMusic）
// ----------------------------------------------------------------------------
// 真實 procedure：proStudio.textToMusic（fal.ai：sonauto / ace-step / stable-audio / musicgen；
//   無需額外金鑰，預設引擎由 brain audioEngine 決定）。成本原子性：先 generate.estimateCost 估點
//   → 確認 → 提交（伺服器先扣、失敗全額退）→ background_jobs 非同步佇列。
//   註：並無 Suno 接點（proStudio.generateMusicSuno 不存在），配樂統一走 textToMusic。
// ============================================================================
import { useState } from "react";
import { Music, Loader2, Coins, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MODELS = ["ace-step", "sonauto", "stable-audio", "musicgen"] as const;

export function MusicCanvas() {
  const utils = trpc.useUtils();
  const music = trpc.proStudio.textToMusic.useMutation();

  const [prompt, setPrompt] = useState("");
  const [tags, setTags] = useState("ambient, healing, warm");
  const [duration, setDuration] = useState(30);
  const [instrumental, setInstrumental] = useState(true);
  const [model, setModel] = useState<(typeof MODELS)[number]>("ace-step");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<{ requestId: string; credits: number } | null>(null);

  const doEstimate = async () => {
    if (!prompt.trim()) return;
    setSubmitted(null);
    try {
      const r = await utils.generate.estimateCost.fetch({ generationType: "audio", durationSec: duration });
      const pts = readPts(r);
      setEstimate(pts);
      toast(`估算成本：約 ${pts} pts`, { description: "確認後先扣後生成 · 失敗全額退還" });
    } catch (e) {
      toast.error("估算失敗", { description: e instanceof Error ? e.message : "generate.estimateCost 無回應" });
    }
  };

  const doSubmit = async () => {
    if (!prompt.trim()) return;
    try {
      const res = await music.mutateAsync({
        prompt: prompt.trim(),
        tags: tags.trim() || undefined,
        instrumental,
        duration,
        model,
      });
      setSubmitted({ requestId: res.request_id, credits: res.estimated_credits });
      toast.success("已送出配樂佇列", { description: `${res.model} · 已扣 ${res.estimated_credits} pts（失敗全額退還）` });
    } catch (e) {
      toast.error("送出失敗", { description: e instanceof Error ? e.message : "proStudio.textToMusic 無回應" });
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Music className="size-3.5 text-primary" /> 配樂 · proStudio.textToMusic → fal.ai
      </div>

      <Textarea
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setEstimate(null); }}
        placeholder="描述配樂風格情緒（如：禪意空靈、緩慢呼吸節奏、暖色木質音色）…"
        className="min-h-[80px] resize-none text-sm"
        maxLength={2000}
      />
      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="風格標籤（逗號分隔）" className="h-8 text-xs" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">引擎</span>
          <Select value={model} onValueChange={(v) => setModel(v as (typeof MODELS)[number])}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">秒數</span>
          <Input
            type="number"
            value={duration}
            min={1}
            max={300}
            onChange={(e) => { setDuration(Math.max(1, Math.min(300, Number(e.target.value) || 30))); setEstimate(null); }}
            className="h-8 w-20 text-xs"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={instrumental} onCheckedChange={setInstrumental} /> 純配樂
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void doEstimate()} disabled={music.isPending || !prompt.trim()}>
          <Coins className="size-4" /> 估算成本
        </Button>
        {estimate !== null && <Badge variant="secondary" className="text-[10px]">約 {estimate} pts</Badge>}
        <Button size="sm" className="ml-auto" onClick={() => void doSubmit()} disabled={music.isPending || !prompt.trim()}>
          {music.isPending ? <Loader2 className="size-4 animate-spin" /> : <Music className="size-4" />} 確認生成
        </Button>
      </div>

      {submitted && (
        <div className="flex items-center gap-2 rounded-xl border bg-card/60 p-3 text-xs">
          <CircleCheck className="size-4 text-emerald-500" />
          <span className="flex-1">
            已送出佇列 · <span className="font-mono text-[10px] text-muted-foreground">{submitted.requestId.slice(0, 18)}…</span>
            <span className="ml-1 text-muted-foreground">已扣 {submitted.credits} pts · 完成後在資產庫</span>
          </span>
        </div>
      )}
    </div>
  );
}

function readPts(r: unknown): number {
  const o = r as { pointsCost?: number; points?: number; pointsBreakdown?: { total?: number } } | null;
  return Math.round(o?.pointsCost ?? o?.points ?? o?.pointsBreakdown?.total ?? 0);
}

export default MusicCanvas;
