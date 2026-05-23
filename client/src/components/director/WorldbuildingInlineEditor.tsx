/**
 * WorldbuildingInlineEditor — 導演 AI 內嵌世界觀編輯器
 *
 * 設計目的：把世界觀的核心編輯動作（基本資訊 / 角色 / 場景 / AI 生成）
 * 直接內嵌到「導演 AI」頁面，避免使用者在 /director 與 /animation 之間跳頁。
 *
 * 範圍：
 *   - 基本資訊（名稱、類型、時代、描述、全域負面提示）
 *   - 角色：增 / 刪 / 改基本欄位（名稱、定位、外觀、個性、背景）+ AI 生成
 *   - 場景：增 / 刪 / 改基本欄位（名稱、環境、氛圍、光線）+ AI 生成
 *
 * 進階欄位（三視圖、表情包、穿衣集、口氣、配音、LoRA 連結、分鏡時間軸、
 * 製作管線、研究資料庫…）一律由底部的「進階編輯」連結帶到 /animation。
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sparkles,
  Users,
  MapPin,
  Plus,
  Trash2,
  Wand2,
  ExternalLink,
  Loader2,
  Save,
} from "lucide-react";
import {
  CHARACTER_ROLE_LABELS,
  GENRE_PRESETS,
  ERA_PRESETS,
  SCENE_MOOD_PRESETS,
  type WorldbuildingFrameworkData,
  type WorldCharacter,
  type WorldScene,
  type CharacterRole,
} from "../../../../shared/worldbuilding-types";

type LoadedFramework = WorldbuildingFrameworkData & {
  id: number;
  createdAt?: Date;
  updatedAt?: Date;
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const ROLE_OPTIONS: Array<{ value: CharacterRole; label: string }> = (
  Object.entries(CHARACTER_ROLE_LABELS) as Array<[CharacterRole, string]>
).map(([value, label]) => ({ value, label }));

// ─── 基本資訊 ─────────────────────────────────────────────────────────────

const BasicsSection = memo(function BasicsSection({
  world,
  onPatch,
}: {
  world: LoadedFramework;
  onPatch: (p: Partial<WorldbuildingFrameworkData>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] text-muted-foreground">名稱</Label>
          <Input
            value={world.name ?? ""}
            onChange={e => onPatch({ name: e.target.value })}
            placeholder="例如：苔森紀年"
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">類型 / 風格</Label>
          <Input
            value={world.genre ?? ""}
            onChange={e => onPatch({ genre: e.target.value })}
            placeholder="療癒奇幻、賽博龐克、日常…"
            className="h-8 text-xs"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {GENRE_PRESETS.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => onPatch({ genre: g })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  world.genre === g
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">時代背景</Label>
          <Input
            value={world.era ?? ""}
            onChange={e => onPatch({ era: e.target.value })}
            placeholder="中世紀、近未來、架空…"
            className="h-8 text-xs"
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {ERA_PRESETS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => onPatch({ era: e })}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition ${
                  world.era === e
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">
            全域負面提示
          </Label>
          <Input
            value={world.globalNegativePrompt ?? ""}
            onChange={e => onPatch({ globalNegativePrompt: e.target.value })}
            placeholder="所有 AI 生成都會附加（如：low quality, blurry）"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">
          描述（世界規則、基調、設定）
        </Label>
        <Textarea
          value={world.description ?? ""}
          onChange={e => onPatch({ description: e.target.value })}
          placeholder="這個世界的核心設定、規則、基調…"
          className="min-h-[60px] text-xs"
        />
      </div>
    </div>
  );
});

// ─── 角色卡（精簡版） ─────────────────────────────────────────────────────

const CharacterMiniCard = memo(function CharacterMiniCard({
  character,
  onChange,
  onDelete,
}: {
  character: WorldCharacter;
  onChange: (next: WorldCharacter) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={character.name}
          onChange={e => onChange({ ...character, name: e.target.value })}
          placeholder="角色名稱"
          className="h-7 text-xs flex-1"
        />
        <Select
          value={character.role}
          onValueChange={v =>
            onChange({ ...character, role: v as CharacterRole })
          }
        >
          <SelectTrigger className="h-7 text-xs w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map(r => (
              <SelectItem key={r.value} value={r.value} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="刪除角色"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          value={character.tagline ?? ""}
          onChange={e => onChange({ ...character, tagline: e.target.value })}
          placeholder="一句話描述"
          className="h-7 text-xs"
        />
        <Input
          value={character.personality ?? ""}
          onChange={e =>
            onChange({ ...character, personality: e.target.value })
          }
          placeholder="個性（樂觀、固執、害羞…）"
          className="h-7 text-xs"
        />
      </div>
      <Textarea
        value={character.appearance ?? ""}
        onChange={e => onChange({ ...character, appearance: e.target.value })}
        placeholder="外觀（髮型、瞳色、身高、特徵…）— AI 生成時會用到"
        className="min-h-[44px] text-xs"
      />
    </div>
  );
});

// ─── 場景卡（精簡版） ─────────────────────────────────────────────────────

const SceneMiniCard = memo(function SceneMiniCard({
  scene,
  onChange,
  onDelete,
}: {
  scene: WorldScene;
  onChange: (next: WorldScene) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={scene.name}
          onChange={e => onChange({ ...scene, name: e.target.value })}
          placeholder="場景名稱"
          className="h-7 text-xs flex-1"
        />
        <Input
          value={scene.mood ?? ""}
          onChange={e => onChange({ ...scene, mood: e.target.value })}
          placeholder="氛圍 / 情緒"
          className="h-7 text-xs w-[140px]"
          list={`scene-mood-${scene.id}`}
        />
        <datalist id={`scene-mood-${scene.id}`}>
          {SCENE_MOOD_PRESETS.map(m => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="刪除場景"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <Textarea
        value={scene.environment ?? ""}
        onChange={e => onChange({ ...scene, environment: e.target.value })}
        placeholder="環境描述（地點、季節、天氣、植被…）— AI 生成時會用到"
        className="min-h-[44px] text-xs"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          value={scene.lighting ?? ""}
          onChange={e => onChange({ ...scene, lighting: e.target.value })}
          placeholder="光線（晨光、黃昏、霓虹…）"
          className="h-7 text-xs"
        />
        <Input
          value={scene.tagline ?? ""}
          onChange={e => onChange({ ...scene, tagline: e.target.value })}
          placeholder="一句話氛圍標語"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
});

// ─── AI 生成迷你輸入框 ───────────────────────────────────────────────────

function AiGenerateRow({
  placeholder,
  buttonLabel,
  isPending,
  onGenerate,
}: {
  placeholder: string;
  buttonLabel: string;
  isPending: boolean;
  onGenerate: (description: string) => void;
}) {
  const [desc, setDesc] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Input
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs"
        disabled={isPending}
        onKeyDown={e => {
          if (e.key === "Enter" && desc.trim()) {
            onGenerate(desc.trim());
            setDesc("");
          }
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        className="h-7 text-xs gap-1 shrink-0"
        disabled={isPending || !desc.trim()}
        onClick={() => {
          if (!desc.trim()) return;
          onGenerate(desc.trim());
          setDesc("");
        }}
      >
        {isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Wand2 className="w-3 h-3" />
        )}
        {buttonLabel}
      </Button>
    </div>
  );
}

// ─── 主編輯器 ─────────────────────────────────────────────────────────────

export interface WorldbuildingInlineEditorProps {
  worldId: number;
  onCreateStoryboard?: () => void;
}

export default function WorldbuildingInlineEditor({
  worldId,
  onCreateStoryboard,
}: WorldbuildingInlineEditorProps) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const listQuery = trpc.worldbuilding.list.useQuery(undefined, {
    retry: false,
  });
  const server = useMemo(
    () =>
      (listQuery.data ?? []).find(w => w.id === worldId) as
        | LoadedFramework
        | undefined,
    [listQuery.data, worldId]
  );

  // 本地 draft + debounced save（與 /animation 一致的模式，避免每按鍵打 API）
  const [draft, setDraft] = useState<LoadedFramework | null>(null);
  const lastSyncedIdRef = useRef<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!server) {
      setDraft(null);
      lastSyncedIdRef.current = null;
      return;
    }
    if (lastSyncedIdRef.current !== server.id) {
      setDraft(server);
      lastSyncedIdRef.current = server.id;
    }
  }, [server]);

  const updateMut = trpc.worldbuilding.update.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      setSavedAt(Date.now());
      utils.worldbuilding.list.invalidate();
    },
    onError: e => {
      setIsSaving(false);
      toast.error(`儲存失敗：${e.message}`);
    },
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePatch = useCallback(
    (patch: Partial<WorldbuildingFrameworkData>) => {
      setDraft(prev => (prev ? { ...prev, ...patch } : prev));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setIsSaving(true);
      saveTimer.current = setTimeout(() => {
        setDraft(latest => {
          if (!latest?.id) {
            setIsSaving(false);
            return latest;
          }
          updateMut.mutate({
            id: latest.id,
            patch: {
              name: latest.name,
              description: latest.description,
              genre: latest.genre,
              era: latest.era,
              characters: latest.characters,
              scenes: latest.scenes,
              globalNegativePrompt: latest.globalNegativePrompt,
            },
          });
          return latest;
        });
      }, 600);
    },
    [updateMut]
  );

  // 卸載時若還有未送出的儲存，立刻 flush 一次。
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const generateCharacterMut =
    trpc.worldbuildingGeneration.generateCharacter.useMutation({
      onSuccess: data => {
        toast.success(`角色「${data.character.name}」已生成`);
        utils.worldbuilding.list.invalidate();
        // 同步進 draft（不等 refetch）
        setDraft(prev =>
          prev
            ? { ...prev, characters: [...(prev.characters ?? []), data.character] }
            : prev
        );
      },
      onError: e => toast.error(`生成失敗：${e.message}`),
    });

  const generateSceneMut =
    trpc.worldbuildingGeneration.generateScene.useMutation({
      onSuccess: data => {
        toast.success(`場景「${data.scene.name}」已生成`);
        utils.worldbuilding.list.invalidate();
        setDraft(prev =>
          prev
            ? { ...prev, scenes: [...(prev.scenes ?? []), data.scene] }
            : prev
        );
      },
      onError: e => toast.error(`生成失敗：${e.message}`),
    });

  if (listQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/30 p-6 text-center text-xs text-muted-foreground animate-pulse">
        載入世界觀…
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-50/40 dark:bg-amber-900/10 p-4 text-xs text-amber-700 dark:text-amber-300">
        找不到指定世界觀，可能已被刪除。請從上方列表重新選擇。
      </div>
    );
  }

  const characters = draft.characters ?? [];
  const scenes = draft.scenes ?? [];

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card/40 to-transparent overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/30 bg-card/40">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-semibold truncate">
            正在編輯：{draft.name || "(未命名世界觀)"}
          </span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
            {characters.length} 角色 · {scenes.length} 場景
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                儲存中…
              </>
            ) : savedAt ? (
              <>
                <Save className="w-3 h-3 text-primary" />
                已儲存
              </>
            ) : null}
          </span>
          {onCreateStoryboard && (
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={onCreateStoryboard}
            >
              <Sparkles className="w-3 h-3" />
              生成分鏡
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="basics" className="px-4 pt-3 pb-2">
        <TabsList className="bg-card/40 border border-border/30 rounded-lg h-8">
          <TabsTrigger value="basics" className="text-[11px] h-7 px-3 gap-1">
            <Sparkles className="w-3 h-3" /> 基本
          </TabsTrigger>
          <TabsTrigger
            value="characters"
            className="text-[11px] h-7 px-3 gap-1"
          >
            <Users className="w-3 h-3" /> 角色（{characters.length}）
          </TabsTrigger>
          <TabsTrigger value="scenes" className="text-[11px] h-7 px-3 gap-1">
            <MapPin className="w-3 h-3" /> 場景（{scenes.length}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="pt-3">
          <BasicsSection world={draft} onPatch={handlePatch} />
        </TabsContent>

        <TabsContent value="characters" className="pt-3 space-y-2.5">
          <AiGenerateRow
            placeholder="描述一個角色，例如：療癒系咖啡店老闆，溫柔但有秘密"
            buttonLabel="AI 生成角色"
            isPending={generateCharacterMut.isPending}
            onGenerate={description =>
              generateCharacterMut.mutate({ worldId, description })
            }
          />
          <ScrollArea className="max-h-[44vh] pr-1">
            <div className="space-y-2">
              {characters.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic text-center py-4">
                  還沒有角色。用上方輸入 AI 生成，或點下方按鈕手動新增。
                </p>
              ) : (
                characters.map(c => (
                  <CharacterMiniCard
                    key={c.id}
                    character={c}
                    onChange={next =>
                      handlePatch({
                        characters: characters.map(x =>
                          x.id === c.id ? next : x
                        ),
                      })
                    }
                    onDelete={() =>
                      handlePatch({
                        characters: characters.filter(x => x.id !== c.id),
                      })
                    }
                  />
                ))
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(
                  [
                    ["protagonist", "+ 主角"],
                    ["supporting", "+ 配角"],
                    ["antagonist", "+ 反派"],
                    ["npc", "+ NPC"],
                  ] as Array<[CharacterRole, string]>
                ).map(([role, label]) => (
                  <Button
                    key={role}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      handlePatch({
                        characters: [
                          ...characters,
                          { id: uid(), name: "", role },
                        ],
                      })
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="scenes" className="pt-3 space-y-2.5">
          <AiGenerateRow
            placeholder="描述一個場景，例如：深夜的便利商店，外面正在下雨"
            buttonLabel="AI 生成場景"
            isPending={generateSceneMut.isPending}
            onGenerate={description =>
              generateSceneMut.mutate({ worldId, description })
            }
          />
          <ScrollArea className="max-h-[44vh] pr-1">
            <div className="space-y-2">
              {scenes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic text-center py-4">
                  還沒有場景。用上方輸入 AI 生成，或點下方按鈕手動新增。
                </p>
              ) : (
                scenes.map(s => (
                  <SceneMiniCard
                    key={s.id}
                    scene={s}
                    onChange={next =>
                      handlePatch({
                        scenes: scenes.map(x => (x.id === s.id ? next : x)),
                      })
                    }
                    onDelete={() =>
                      handlePatch({
                        scenes: scenes.filter(x => x.id !== s.id),
                      })
                    }
                  />
                ))
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() =>
                  handlePatch({
                    scenes: [...scenes, { id: uid(), name: "" }],
                  })
                }
              >
                <Plus className="w-3 h-3 mr-1" /> 新增場景
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Footer：進階編輯入口 */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border/30 bg-card/20">
        <p className="text-[10px] text-muted-foreground">
          進階：三視圖、表情包、穿衣集、配音、LoRA、分鏡時間軸、製作管線…
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] gap-1"
          onClick={() => navigate(`/animation?worldId=${worldId}`)}
        >
          <ExternalLink className="w-3 h-3" />
          進階編輯
        </Button>
      </div>
    </div>
  );
}
