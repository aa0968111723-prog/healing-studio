// ============================================================================
// shells/video/drawers/ConsoleDrawers.tsx — 導演台疊層抽屜（split-view，不整頁離場）
// ----------------------------------------------------------------------------
// 以 Sheet（Radix Dialog 疊層）實作 drawer / split-view，避免 Next.js Parallel+Intercepting
//   Routes（本 repo 為 React 19 + Vite + Wouter，L1 禁 Next.js）。四個抽屜：
//   • workflow   2-17 工作流設定（WorkflowBuilder，本地狀態；後端 user_workflows 待補＝G10／W2-E）
//   • flowtv     2-12 Flow 電視牆 / 提示詞庫（promptLibrary.list/create/delete）
//   • playground 2-13 單模型遊樂場「統一目錄頁」（registry 為準＋catalog 情報層＋選型試生成）
//   • settings   2-18 影片系統設定（生成引擎＋per-引擎預設覆寫＋個人化＋鐵則；抽出 ./VideoSettings.tsx）
// ============================================================================
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowUp, ArrowDown, Trash2, Plus, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useDirectorConsole, type DrawerId } from "../DirectorConsoleProvider";
import { STEP_LIBRARY, freshDefaultWorkflow } from "../console/workflowSteps";
import { FlowTvBody } from "./FlowTv";
import { ModelCatalogBody } from "./ModelCatalog";
import { VideoSettingsBody } from "./VideoSettings";
import { RealEarthResearchBody } from "./RealEarthResearch";
import { PromptWorkbenchBody } from "./PromptWorkbench";
import { AgentCatalogBody } from "./AgentCatalog";
import { TeachingArchiveGroundingBody } from "./TeachingArchiveGrounding";
import { LoraCharactersBody } from "./LoraCharacters";

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
      {wrap("playground", "單模型遊樂場 · 統一目錄 · 2-13", "registry 為準的可用模型目錄（按領域）＋ catalog 情報層 enrich ＋ 選型試生成（→ fal）。", <ModelCatalogBody />, true)}
      {wrap("research", "真實地球研究 · I-5", "唯讀查真實歷史／地理／文化（realEarth）；複製參照為這段接地。Phase 1 零後端。", <RealEarthResearchBody />, true)}
      {wrap("prompts", "提示詞跨庫組合 · I-8", "庫＋收藏跨庫多選 → 合成組合提示詞 → 複製。Phase 1 零後端。", <PromptWorkbenchBody />, true)}
      {wrap("agents", "精靈能力 · 成本預估 · I-1", "選精靈 → 看可用 fal 模型＋預估成本（唯讀、不觸發生成）。Phase 1 零後端。", <AgentCatalogBody />, true)}
      {wrap("grounding", "教材庫接地 · I-4", "搜尋你的教材（向量＋關鍵字）→ 複製參照為這段劇本接地。Phase 1 零後端。", <TeachingArchiveGroundingBody />, true)}
      {wrap("lora", "角色 LoRA 一致性 · I-7", "看本專案角色的 LoRA 狀態＋你的模型庫（唯讀）；自動套用＝Phase 2。", <LoraCharactersBody />, true)}
      {wrap("settings", "影片系統設定 · 2-18", "生成引擎＋各模態 per-引擎預設（2-16）＋個人化（帳號層）＋鐵則。", <VideoSettingsBody />)}
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

// ── 2-13 單模型遊樂場「統一目錄頁」──────────────────────────────────────────
// W1-5：抽出獨立檔 ./ModelCatalog.tsx（registry 為準的領域目錄＋catalog 情報層 enrich
// ＋選型試生成）；這裡只負責 drawer 掛載。

// ── 2-18 影片系統設定 ───────────────────────────────────────────────────────
// W1-6：抽出獨立檔 ./VideoSettings.tsx（生成引擎＋per-引擎預設覆寫＋個人化完善）；
// 這裡只負責 drawer 掛載。

export default ConsoleDrawers;
