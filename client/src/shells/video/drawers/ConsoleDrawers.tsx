// ============================================================================
// shells/video/drawers/ConsoleDrawers.tsx — 導演台疊層抽屜（split-view，不整頁離場）
// ----------------------------------------------------------------------------
// 以 Sheet（Radix Dialog 疊層）實作 drawer / split-view，避免 Next.js Parallel+Intercepting
//   Routes（本 repo 為 React 19 + Vite + Wouter，L1 禁 Next.js）。四個抽屜：
//   • workflow   2-17 工作流設定（WorkflowBuilder，本地狀態；後端 user_workflows 待補＝G10／W2-E）
//   • flowtv     2-12 Flow 電視牆 / 提示詞庫（promptLibrary.list/create/delete）
//   • playground 2-13 單模型遊樂場（aiModels.list ＋ 既有 Generation 接縫試生成 → fal）
//   • settings   2-18 影片系統設定（生成引擎 / 顯隱 / 自動存草稿 ＋ 鐵則；全站設定在 /settings）
// ============================================================================
import { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ArrowUp, ArrowDown, Trash2, Plus, RotateCcw, Loader2, ImagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSpine } from "@/providers/SpineProvider";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole, type DrawerId } from "../DirectorConsoleProvider";
import { STEP_LIBRARY, freshDefaultWorkflow } from "../console/workflowSteps";
import { FlowTvBody } from "./FlowTv";
import { frameStyle } from "@/spine/seedVisual";
import type { ProviderId } from "@/spine/types";

export function ConsoleDrawers() {
  const console_ = useDirectorConsole();
  const close = () => console_.openDrawer(null);
  const wrap = (id: DrawerId, title: string, desc: string, body: React.ReactNode, wide?: boolean) => (
    <Sheet open={console_.drawer === id} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className={cn("overflow-y-auto", wide ? "sm:max-w-xl" : "sm:max-w-md")}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{desc}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">{body}</div>
      </SheetContent>
    </Sheet>
  );

  return (
    <>
      {wrap("workflow", "工作流設定 · 2-17", "步驟可新增／刪除／重排／啟用停用；必經步驟不可刪。", <WorkflowBuilderBody />)}
      {wrap("flowtv", "Flow 電視牆 · 提示詞庫 · 2-12", "存庫 → 重用：promptLibrary。生成的提示詞可在此再生成 / 複製編輯。", <FlowTvBody />, true)}
      {wrap("playground", "單模型遊樂場 · 2-13", "aiModels.list 模型情報 ＋ 既有 Generation 接縫試生成（→ fal）。", <PlaygroundBody />, true)}
      {wrap("settings", "影片系統設定 · 2-18", "生成引擎 / 介面顯隱 / 自動存草稿 ＋ 鐵則。帳號層設定在 /settings。", <VideoSettingsBody />)}
    </>
  );
}

// ── 2-17 WorkflowBuilder（本地狀態，後端待補=G10/W2-E）──────────────────────
function WorkflowBuilderBody() {
  const console_ = useDirectorConsole();
  const steps = console_.steps;

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    console_.setSteps(next);
  };
  const toggle = (i: number) => {
    const s = steps[i];
    if (s.required && s.enabled) { toast.warning("必經步驟不可停用"); return; }
    const next = [...steps];
    next[i] = { ...s, enabled: !s.enabled };
    console_.setSteps(next);
  };
  const remove = (i: number) => {
    if (steps[i].required) { toast.warning("必經步驟不可刪除"); return; }
    console_.setSteps(steps.filter((_, k) => k !== i));
  };
  const add = (lib: (typeof STEP_LIBRARY)[number]) => {
    if (steps.some((s) => s.id === lib.id)) { toast.warning("此步驟已在工作流中"); return; }
    console_.setSteps([...steps, { id: lib.id, name: lib.name, required: false, enabled: true, canvasMode: lib.canvasMode, pending: lib.pending }]);
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-2">
            <span className="text-sm font-medium">{s.name}</span>
            {s.required ? <Badge variant="secondary" className="text-[9px]">必經</Badge> : <Badge variant="outline" className="text-[9px]">可選</Badge>}
            {s.pending && <Badge variant="outline" className="text-[9px] text-amber-600 dark:text-amber-400">待後端</Badge>}
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" className="size-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移"><ArrowUp className="size-3.5" /></Button>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="下移"><ArrowDown className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => toggle(i)}>{s.enabled ? "啟用" : "停用"}</Button>
              <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => remove(i)} disabled={s.required} aria-label="移除"><Trash2 className="size-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">從步驟庫加入</div>
        <div className="flex flex-wrap gap-1.5">
          {STEP_LIBRARY.map((lib) => (
            <Button key={lib.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => add(lib)} disabled={console_.steps.some((s) => s.id === lib.id)}>
              <Plus className="size-3.5" /> {lib.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
        步驟自訂持久化＝後端待補（建議表 <span className="font-mono">user_workflows / workflow_steps</span>，候選接點 workflowEngine.* / planExecutor.*）。Wave 0 先以前端狀態示意。
      </div>

      <Button size="sm" variant="outline" onClick={() => { console_.setSteps(freshDefaultWorkflow()); toast("已重設回預設工作流範本"); }}>
        <RotateCcw className="size-4" /> 重設回預設範本
      </Button>
    </div>
  );
}

// ── 2-12 Flow TV / 提示詞庫 ──────────────────────────────────────────────────
// W1-4 放映皮後抽出獨立檔 ./FlowTv.tsx（全屏播放器＋頻道＋格狀/清單）；
// 這裡只負責 drawer 掛載。

// ── 2-13 單模型遊樂場（aiModels.list ＋ Generation 接縫）─────────────────────
const MODALITIES = ["image", "video", "audio", "text"];

function PlaygroundBody() {
  const sp = useSpine();
  const [modality, setModality] = useState("image");
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);

  const models = trpc.aiModels.list.useQuery({ modality }, { staleTime: 5 * 60_000 });

  const run = async () => {
    if (!prompt.trim() || busy) return;
    const s = 1000 + Math.floor(Math.random() * 9000);
    setBusy(true);
    setSeed(null);
    try {
      const res = await sp.adapters.generation.generate({
        kind: "image", prompt: prompt.trim(), seed: s, provider: sp.provider, model: selected ?? undefined,
      });
      setSeed(res.seedUsed);
      toast.success("試生成完成", { description: `${res.model} · seed ${res.seedUsed} · ${res.provider}` });
    } catch (e) {
      toast.error("試生成失敗", { description: e instanceof Error ? e.message : "Generation 接縫無回應" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap gap-1.5">
        {MODALITIES.map((m) => (
          <Button key={m} size="sm" variant={modality === m ? "default" : "outline"} className="h-7 text-xs" onClick={() => { setModality(m); setSelected(null); }}>{m}</Button>
        ))}
      </div>

      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {models.isLoading ? (
          <div className="py-4 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></div>
        ) : (models.data?.models ?? []).length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">此模態暫無模型情報（aiModels.list）</div>
        ) : (
          (models.data?.models ?? []).slice(0, 30).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(m.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-healing",
                selected === m.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{m.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{m.provider} · {m.tagline}</span>
              </span>
              <Badge variant="outline" className="shrink-0 text-[9px]">{m.tier}</Badge>
            </button>
          ))
        )}
      </div>

      {modality === "image" ? (
        <>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="提示詞 · 試生成一張（走既有 Generation 接縫 → fal）" className="min-h-[64px] text-sm" />
          <Button size="sm" onClick={() => void run()} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 試生成{selected ? `（${selected}）` : ""}
          </Button>
          {seed !== null && (
            <div className="flex items-center gap-3 rounded-xl border bg-card/60 p-2.5">
              <div className="size-16 shrink-0 rounded-lg" style={{ background: frameStyle(seed, 0) }} />
              <div className="font-mono text-[10px] text-muted-foreground">seed {seed} · {sp.provider}</div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-[11px] text-muted-foreground">
          {modality} 模態的試生成 Wave 0 走對應 studio（{modality === "video" ? "videoStudio.*（session 狀態機 M3 待後端）" : modality === "audio" ? "proStudio.*（見「配音/配樂」畫布）" : "director.chat"}）。此處先提供模型情報瀏覽。
        </div>
      )}
    </div>
  );
}

// ── 2-18 影片系統設定 ───────────────────────────────────────────────────────
const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "hf", label: "Hugging Face" },
  { id: "gemini", label: "Gemini 2.5" },
  { id: "fal", label: "fal" },
  { id: "mock", label: "Mock（離線）" },
];

function VideoSettingsBody() {
  const console_ = useDirectorConsole();
  const spine = useProjectSpine();
  const defaults = trpc.director.generationModels.useQuery(undefined, { staleTime: 5 * 60_000 });

  return (
    <div className="space-y-4 pt-4">
      {/* 生成引擎 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">生成引擎（GENERATION_PROVIDER）</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDERS.map((pv) => (
            <button
              key={pv.id}
              type="button"
              onClick={() => spine.setProvider(pv.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-healing",
                spine.provider === pv.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50",
              )}
            >
              {pv.label}
            </button>
          ))}
        </div>
      </div>

      {/* 介面 toggles */}
      <div className="space-y-2">
        <label className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs">
          <span>顯示 Context Sidecar（右欄）</span>
          <Switch checked={console_.showSidecar} onCheckedChange={console_.setShowSidecar} />
        </label>
        <label className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs">
          <span>自動存草稿（prompt ≥4 字自動入庫）</span>
          <Switch checked={console_.autoSaveDraft} onCheckedChange={console_.setAutoSaveDraft} />
        </label>
      </div>

      {/* 預設模型（brain defaults） */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">各模態預設引擎（brain defaults）</div>
        {defaults.isLoading ? (
          <div className="text-xs text-muted-foreground">讀取中…</div>
        ) : (
          <ul className="space-y-1">
            {Object.entries(defaults.data?.brainDefaults ?? {}).map(([cat, model]) => (
              <li key={cat} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground">{cat}</span>
                <span className="font-mono">{model ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本。<br />
        帳號／權限／觀測等全站設定在 <span className="font-mono">/settings</span> shell。
      </div>
    </div>
  );
}

export default ConsoleDrawers;
