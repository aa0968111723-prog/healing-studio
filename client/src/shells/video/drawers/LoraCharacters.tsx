// ============================================================================
// shells/video/drawers/LoraCharacters.tsx — I-7 角色 LoRA 一致性（Phase 2，AIDV-85）
// ----------------------------------------------------------------------------
// Phase 2（生圖自動建議套用）：
//   • 角色有 linkedModelId 且 model status=ready → 解析 trainedLoraUrl，
//     顯示 LoRA URL、觸發詞、可調 scale（0–2），一鍵複製到剪貼板。
//   • 角色無 LoRA → 「可訓練」提示（同 Phase 1）。
//   • 模型庫 = worldbuilding.linkableModels（含 trainedLoraUrl）。
// ============================================================================
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { Check, Copy, Link2 } from "lucide-react";

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1800);
    });
  };
  return { copiedKey, copy };
}

/** 每個有 LoRA 就緒角色的可調 scale — 本地 UI state，不影響後端。 */
type ScaleMap = Record<string, number>;

export function LoraCharactersBody() {
  const { project } = useProjectSpine();
  const characters = project?.characters ?? [];
  const models = trpc.worldbuilding.linkableModels.useQuery(undefined, { staleTime: 60_000 });
  const list = models.data ?? [];
  const { copiedKey, copy } = useCopy();
  const [scales, setScales] = useState<ScaleMap>({});

  const getScale = (charId: string) => scales[charId] ?? 1.0;
  const setScale = (charId: string, v: number) =>
    setScales(prev => ({ ...prev, [charId]: v }));

  return (
    <div className="space-y-4 pt-4">
      {/* 本專案角色 × LoRA 狀態 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">本專案角色 · LoRA 一致性</div>
        {characters.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            尚未載入專案或此專案無角色。先在世界觀建立角色，這裡就會列出。
          </p>
        ) : (
          <div className="space-y-2">
            {characters.map((c) => {
              const linkedModel = c.linkedModelId != null
                ? list.find(m => m.id === c.linkedModelId)
                : null;
              const isReady = linkedModel?.status === "ready" && !!linkedModel.trainedLoraUrl;
              const scale = getScale(c.id);

              return (
                <div key={c.id} className="rounded-lg border bg-card/60 px-2.5 py-2 space-y-2">
                  {/* header row */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{c.emoji} {c.name}</span>
                    {isReady ? (
                      <Badge variant="secondary" className="text-[9px]">LoRA 已就緒</Badge>
                    ) : linkedModel?.status === "training" ? (
                      <Badge variant="outline" className="text-[9px]">訓練中</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-600">未訓練</Badge>
                    )}
                    {!isReady && !linkedModel && (
                      <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">
                        可訓練 LoRA（前往模型訓練中心）
                      </span>
                    )}
                  </div>

                  {/* Phase 2: LoRA 詳情 + 操作（僅 ready 模型顯示） */}
                  {isReady && linkedModel && (
                    <div className="space-y-2 border-t pt-2">
                      {/* LoRA URL row */}
                      <div className="flex items-center gap-1.5">
                        <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono text-[9px] text-muted-foreground max-w-[180px]">
                          {linkedModel.trainedLoraUrl}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-auto min-h-[44px] min-w-[44px] shrink-0"
                          title="複製 LoRA URL"
                          aria-label="複製 LoRA URL"
                          onClick={() => copy(linkedModel.trainedLoraUrl!, `url:${c.id}`)}
                        >
                          {copiedKey === `url:${c.id}`
                            ? <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                            : <Copy className="h-3 w-3" aria-hidden="true" />}
                        </Button>
                      </div>

                      {/* 觸發詞 row */}
                      {linkedModel.triggerWord && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-muted-foreground">觸發詞：</span>
                          <span className="font-mono text-[9px]">{linkedModel.triggerWord}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto min-h-[44px] min-w-[44px] shrink-0"
                            title="複製觸發詞"
                            aria-label="複製觸發詞"
                            onClick={() => copy(linkedModel.triggerWord!, `tw:${c.id}`)}
                          >
                            {copiedKey === `tw:${c.id}`
                              ? <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                              : <Copy className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                        </div>
                      )}

                      {/* Scale 滑桿 */}
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[9px] text-muted-foreground">
                          強度 {scale.toFixed(1)}
                        </span>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={[scale]}
                          onValueChange={([v]) => setScale(c.id, v!)}
                          className="h-3"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 shrink-0 px-2 text-[9px]"
                          title="複製生成參數（loraUrl + loraScale）"
                          onClick={() =>
                            copy(
                              JSON.stringify({ lora_path: linkedModel.trainedLoraUrl, lora_scale: scale }),
                              `params:${c.id}`,
                            )
                          }
                        >
                          {copiedKey === `params:${c.id}` ? "✓ 已複製" : "複製參數"}
                        </Button>
                      </div>
                    </div>
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
                {m.status === "ready" && m.trainedLoraUrl && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto min-h-[44px] min-w-[44px]"
                    title="複製 LoRA URL"
                    aria-label="複製 LoRA URL"
                    onClick={() => copy(m.trainedLoraUrl!, `lib:${m.id}`)}
                  >
                    {copiedKey === `lib:${m.id}`
                      ? <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                      : <Copy className="h-3 w-3" aria-hidden="true" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default LoraCharactersBody;
