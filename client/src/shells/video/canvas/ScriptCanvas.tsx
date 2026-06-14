// ============================================================================
// shells/video/canvas/ScriptCanvas.tsx — 中欄畫布：2-1 腳本意圖（接真實 director.*）
// ----------------------------------------------------------------------------
// 真實 procedure（typed trpc hooks，tsc 對 AppRouter 強型別）：
//   director.videoScriptTypes（query）→ 腳本類型下拉
//   director.generateVideoScript（mutation）→ 由 brief 生成腳本初稿
//   director.importScript（mutation）→ 貼長腳本匯入
//   director.listSessions / loadSession / saveSession → 腳本專案資料庫（續作）
// 拆片→分鏡（GATE handoff）走既有 GuidedJourney（analyzeScriptOverview + generateVideoScript
//   + worldStoryboard.createFromSegments；正式 director.breakdown 為 M3 待後端）。
// I-3（AIDV-81）劇本→自動分鏡骨架：腳本有 N 段 → 一鍵 worldStoryboard.seedSkeleton 產生
//   與段落數一致的 N 格空白分鏡（autoSave，續到 /animation 補對白／圖楨）。worldId 取自
//   脊椎當前專案的 worldFrameworkId；未連結世界觀則提示先建。純使用者觸發、零自動行為。
// ============================================================================
import { useState } from "react";
import { FileText, Sparkles, Import, Save, FolderOpen, Wand2, Loader2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { PanelEmpty, PanelError, PanelLoading } from "@/shells/_shared/PanelState";

export function ScriptCanvas({ onGuided }: { onGuided: () => void }) {
  const { project } = useProjectSpine();
  const worldFrameworkId = project?.worldFrameworkId ?? null;
  const types = trpc.director.videoScriptTypes.useQuery(undefined, { staleTime: 5 * 60_000 });
  const sessions = trpc.director.listSessions.useQuery(undefined, { staleTime: 30_000 });
  const generate = trpc.director.generateVideoScript.useMutation();
  const importScript = trpc.director.importScript.useMutation();
  const saveSession = trpc.director.saveSession.useMutation();
  const seedSkeleton = trpc.worldStoryboard.seedSkeleton.useMutation();

  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<"brief" | "paste">("brief");
  const [result, setResult] = useState<{ title: string; rawContent: string; segments: number } | null>(null);

  const selectedType = types.data?.find((t) => t.id === typeId) ?? types.data?.[0];

  const runGenerate = () => {
    if (!brief.trim() || !title.trim() || !selectedType) return;
    generate.mutate(
      { brief: brief.trim(), title: title.trim(), type: selectedType.id },
      {
        onSuccess: (r) => {
          setResult({ title: r.title, rawContent: r.rawContent, segments: r.segments?.length ?? 0 });
          toast.success("腳本初稿已生成", { description: `${r.typeLabel} · ${r.segments?.length ?? 0} 段` });
        },
        onError: (e) => toast.error("生成腳本失敗", { description: e.message }),
      },
    );
  };

  const runImport = () => {
    if (!brief.trim() || !title.trim()) return;
    importScript.mutate(
      { rawContent: brief.trim(), title: title.trim() },
      {
        onSuccess: (r) => {
          setResult({ title: r.title, rawContent: r.rawContent, segments: r.segments?.length ?? 0 });
          toast.success("腳本已匯入", { description: `${r.segments?.length ?? 0} 段` });
        },
        onError: (e) => toast.error("匯入腳本失敗", { description: e.message }),
      },
    );
  };

  const runSave = () => {
    if (!result) return;
    saveSession.mutate(
      { title: result.title || title || "未命名腳本", sessionData: JSON.stringify(result) },
      {
        onSuccess: () => { toast.success("已存為腳本專案"); void sessions.refetch(); },
        onError: (e) => toast.error("存檔失敗", { description: e.message }),
      },
    );
  };

  // I-3：把目前腳本的段落數 → 對應格數的空白分鏡骨架（worldStoryboard.seedSkeleton）。
  const runSkeleton = () => {
    if (!result) return;
    if (!worldFrameworkId) {
      toast.error("尚未連結世界觀", { description: "請先在世界觀為此專案建立角色／場景，再自動分鏡。" });
      return;
    }
    const sceneCount = Math.min(60, Math.max(1, result.segments || 1));
    seedSkeleton.mutate(
      {
        worldId: worldFrameworkId,
        totalDurationSec: Math.min(60 * 60 * 6, Math.max(5, sceneCount * 8)),
        sceneCount,
        autoSave: true,
        name: `${result.title || "未命名"} · 分鏡骨架`,
      },
      {
        onSuccess: () => toast.success(`已建立 ${sceneCount} 格分鏡骨架`, { description: "到 /animation 動畫工作室續編對白與圖楨。" }),
        onError: (e) => toast.error("建立分鏡骨架失敗", { description: e.message }),
      },
    );
  };

  const busy = generate.isPending || importScript.isPending;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5 text-primary" /> 腳本意圖 · 只記錄想法，不會立即生成或產生費用
      </div>

      {/* 模式切換 */}
      <div className="flex gap-1.5">
        <Button size="sm" variant={mode === "brief" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setMode("brief")}>
          <Sparkles className="size-3.5" /> 一句話生成初稿
        </Button>
        <Button size="sm" variant={mode === "paste" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setMode("paste")}>
          <Import className="size-3.5" /> 貼長腳本匯入
        </Button>
      </div>

      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="腳本標題（必填）" className="h-9 text-sm" />

      {mode === "brief" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">類型</span>
          {types.isError ? (
            <PanelError compact message="腳本類型讀取失敗（director.videoScriptTypes）" onRetry={() => types.refetch()} />
          ) : (
            <Select value={selectedType?.id} onValueChange={setTypeId}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue placeholder={types.isLoading ? "載入類型…" : "選擇腳本類型"} />
              </SelectTrigger>
              <SelectContent>
                {types.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <Textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder={mode === "brief"
          ? "例：幫我規劃一支關於放下與呼吸的三分鐘療癒短片"
          : "貼上你的長腳本…系統會拆段成腳本結構"}
        className="min-h-[120px] resize-none text-sm"
      />

      <div className="flex items-center gap-2">
        {mode === "brief" ? (
          <Button size="sm" onClick={runGenerate} disabled={busy || !brief.trim() || !title.trim() || !selectedType}>
            {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} 生成腳本初稿
          </Button>
        ) : (
          <Button size="sm" onClick={runImport} disabled={busy || !brief.trim() || !title.trim()}>
            {importScript.isPending ? <Loader2 className="size-4 animate-spin" /> : <Import className="size-4" />} 匯入腳本
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onGuided}>
          <Wand2 className="size-4" /> 引導式拆片 → 分鏡
        </Button>
      </div>

      {/* 結果 */}
      {result && (
        <div className="rounded-xl border bg-card/60 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold">{result.title}</span>
            <Badge variant="secondary" className="text-[10px]">{result.segments} 段</Badge>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs"
              onClick={runSkeleton}
              disabled={seedSkeleton.isPending || !result.segments}
              title={worldFrameworkId ? undefined : "此專案尚未連結世界觀"}
            >
              {seedSkeleton.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <LayoutGrid className="size-3.5" />} 自動分鏡骨架（{result.segments} 格）
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={runSave} disabled={saveSession.isPending}>
              <Save className="size-3.5" /> 存為腳本專案
            </Button>
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
            {result.rawContent}
          </pre>
        </div>
      )}

      {/* 腳本專案資料庫 */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FolderOpen className="size-3.5" /> 腳本專案資料庫
        </div>
        {sessions.isLoading ? (
          <PanelLoading count={3} className="h-8 rounded-lg" label="載入腳本專案…" />
        ) : sessions.isError ? (
          <PanelError compact message="腳本專案讀取失敗（director.listSessions）" onRetry={() => sessions.refetch()} />
        ) : (sessions.data?.length ?? 0) === 0 ? (
          <PanelEmpty
            className="rounded-lg border border-dashed py-4"
            title={<span className="text-xs">還沒有腳本專案</span>}
            hint="從一句話開始，或貼上長腳本"
          />
        ) : (
          <ul className="space-y-1">
            {sessions.data?.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ScriptCanvas;
