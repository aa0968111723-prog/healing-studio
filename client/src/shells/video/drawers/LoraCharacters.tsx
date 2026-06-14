// ============================================================================
// shells/video/drawers/LoraCharacters.tsx — I-7 角色 LoRA 一致性（唯讀 Phase 1，AIDV-85）
// ----------------------------------------------------------------------------
// 唯讀面板：把「本專案角色的 LoRA 狀態」＋「你訓練好的 LoRA 模型庫」攤開來看。
//   • 角色有訓練好的 LoRA → 標「已就緒」（Phase 2 生成時自動套用）。
//   • 角色未訓練 → 標「可訓練」提示（＝驗收的『無 LoRA 時提示可訓練』半部）。
//   • 模型庫＝worldbuilding.linkableModels（fine_tuned_models status=ready/training）。
// Phase 1 純唯讀、不改生成、無需旗標（資料來源：脊椎 project.characters ＋ 既有 query）。
//   真正「生成時自動注入 loraUrl/loraScale」＝Phase 2（需擴座艙生成接縫合約端到端）。
// ============================================================================
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";

/** 脊椎 Character.loraStatus（未訓練/排隊中/訓練中/已完成）→ 顯示。trained＝Phase 2 可自動套用。 */
const LORA_STATUS: Record<string, { label: string; trained: boolean }> = {
  "已完成": { label: "LoRA 已就緒", trained: true },
  "訓練中": { label: "訓練中", trained: false },
  "排隊中": { label: "排隊中", trained: false },
  "未訓練": { label: "未訓練", trained: false },
};

export function LoraCharactersBody() {
  const { project } = useProjectSpine();
  const characters = project?.characters ?? [];
  const models = trpc.worldbuilding.linkableModels.useQuery(undefined, { staleTime: 60_000 });
  const list = models.data ?? [];

  return (
    <div className="space-y-4 pt-4">
      {/* 本專案角色 × LoRA 狀態 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">本專案角色 · LoRA 狀態</div>
        {characters.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            尚未載入專案或此專案無角色。先在世界觀建立角色，這裡就會列出。
          </p>
        ) : (
          <div className="space-y-2">
            {characters.map((c) => {
              // 權威訊號＝linkedModelId（已連結訓練好的 LoRA）；loraStatus="已完成" 為輔。
              const trained = c.linkedModelId != null || c.loraStatus === "已完成";
              const label = trained ? "LoRA 已就緒" : (LORA_STATUS[c.loraStatus]?.label ?? c.loraStatus);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/60 px-2.5 py-2">
                  <span className="text-xs font-medium">{c.emoji} {c.name}</span>
                  <Badge variant={trained ? "secondary" : "outline"} className="text-[9px]">{label}</Badge>
                  {trained ? (
                    <span className="ml-auto text-[10px] text-muted-foreground">Phase 2 將於生成時自動套用</span>
                  ) : (
                    <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">可訓練 LoRA（前往模型訓練中心）</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 你的 LoRA 模型庫 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">你的 LoRA 模型庫（可連結到角色）</div>
        {models.isLoading ? (
          <PanelLoading count={3} className="h-12 rounded-lg" label="讀取 LoRA 模型…" />
        ) : models.isError ? (
          <PanelError message="LoRA 模型讀取失敗（worldbuilding.linkableModels）。" onRetry={() => void models.refetch()} />
        ) : list.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            還沒有訓練好的 LoRA。到模型訓練中心訓練一個角色 LoRA，這裡就會出現、之後可自動套用。
          </p>
        ) : (
          <div className="space-y-2">
            {list.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/60 px-2.5 py-2">
                <span className="text-xs font-medium">{m.name}</span>
                <Badge variant="outline" className="text-[9px]">{m.modelType}</Badge>
                <Badge variant={m.status === "ready" ? "secondary" : "outline"} className="text-[9px]">
                  {m.status === "ready" ? "可用" : m.status}
                </Badge>
                {m.triggerWord && <span className="font-mono text-[10px] text-muted-foreground">{m.triggerWord}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        Phase 1（唯讀）：只顯示角色 LoRA 狀態與你的模型庫、無 LoRA 時提示可訓練。
        <span className="font-medium">生成時自動套用 LoRA（loraUrl／loraScale 注入）＝Phase 2 後端待補</span>——
        需擴座艙生成接縫合約端到端帶 lora 參數＋角色→loraUrl 解析（後端 fal lora 派工已就緒）。
      </p>
    </div>
  );
}

export default LoraCharactersBody;
