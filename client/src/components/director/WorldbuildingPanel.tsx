/**
 * WorldbuildingPanel — 導演 AI 的自訂世界觀架構器（第 4 個分頁）
 *
 * 功能：
 *   - 多角色（主角／配角／反派／NPC），各自有
 *     喜好、興趣、穿著、樣貌、隨身物件、個性
 *   - 多場景，每個場景含環境、植被（花草樹木）、動物、物件、
 *     光線、氛圍、環境變化
 *   - 角色與場景可下拉連結到「模型訓練中心」已訓練完成的 LoRA
 *   - CRUD 透過 trpc.worldbuilding.* — 草稿即時暫存於 localStorage
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlassCard } from "@/components/ZenCoPilot";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Users,
  Palette,
  MapPin,
  Sparkles,
  Link2,
  X,
  FolderOpen,
  Wand2,
} from "lucide-react";
import {
  CHARACTER_ROLE_LABELS,
  ENVIRONMENT_CHANGE_PRESETS,
  ERA_PRESETS,
  GENRE_PRESETS,
  PERSONALITY_TRAIT_PRESETS,
  SCENE_LIGHTING_PRESETS,
  SCENE_MOOD_PRESETS,
  type CharacterRole,
  type WorldCharacter,
  type WorldScene,
  type WorldbuildingFrameworkData,
} from "../../../../shared/worldbuilding-types";

const DRAFT_KEY = "hs.director.worldbuildingDraft.v1";

// ─── Quick-pick chip rows ───────────────────────────────────────────────────

/** 單選：點擊填入單一文字欄位（覆蓋現值或保留） */
function QuickPickRow({
  presets,
  active,
  onPick,
  ariaLabel,
}: {
  presets: readonly string[];
  active?: string;
  onPick: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1"
    >
      {presets.map(p => {
        const isActive = active === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className={`px-2 py-0.5 rounded-full text-[10.5px] border transition ${
              isActive
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60 hover:text-foreground"
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

/** 多選：點擊追加到 string[]（chip 集合） */
function QuickAppendRow({
  presets,
  values,
  onAppend,
  ariaLabel,
}: {
  presets: readonly string[];
  values: string[];
  onAppend: (next: string[]) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1"
    >
      {presets.map(p => {
        const isActive = values.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() =>
              onAppend(
                isActive ? values.filter(v => v !== p) : [...values, p]
              )
            }
            className={`px-2 py-0.5 rounded-full text-[10.5px] border transition ${
              isActive
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60 hover:text-foreground"
            }`}
          >
            {isActive ? "✓ " : "+ "}
            {p}
          </button>
        );
      })}
    </div>
  );
}

type LinkableModel = {
  id: number;
  name: string;
  modelType: string;
  status: string;
  triggerWord: string | null;
};

type LoadedFramework = WorldbuildingFrameworkData & { id: number };

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyCharacter(role: CharacterRole = "supporting"): WorldCharacter {
  return {
    id: uid(),
    name: "",
    role,
    tagline: "",
    personality: "",
    likes: [],
    interests: [],
    outfit: "",
    appearance: "",
    signatureItems: [],
    backstory: "",
    linkedModelId: null,
    triggerWord: "",
    notes: "",
  };
}

function emptyScene(): WorldScene {
  return {
    id: uid(),
    name: "",
    tagline: "",
    environment: "",
    flora: [],
    fauna: [],
    props: [],
    lighting: "",
    mood: "",
    environmentChanges: [],
    linkedModelId: null,
    triggerWord: "",
    notes: "",
  };
}

function emptyDraft(): WorldbuildingFrameworkData {
  return {
    name: "",
    description: "",
    genre: "",
    era: "",
    characters: [emptyCharacter("protagonist")],
    scenes: [emptyScene()],
    objects: [],
    linkedModelIds: [],
    tags: [],
    isActive: true,
  };
}

// ─── Chip-style multi-value input ───────────────────────────────────────────

function ChipListInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.map(v => (
          <Badge
            key={v}
            variant="secondary"
            className="gap-1 pr-1 font-normal"
          >
            <span>{v}</span>
            <button
              type="button"
              aria-label={`移除 ${v}`}
              onClick={() => onChange(values.filter(x => x !== v))}
              className="rounded-sm opacity-60 hover:opacity-100 transition"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        aria-label={ariaLabel}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </div>
  );
}

// ─── Character Card ─────────────────────────────────────────────────────────

const CharacterCard = memo(function CharacterCard({
  character,
  models,
  onChange,
  onDelete,
}: {
  character: WorldCharacter;
  models: LinkableModel[];
  onChange: (next: WorldCharacter) => void;
  onDelete: () => void;
}) {
  const patch = useCallback(
    (p: Partial<WorldCharacter>) => onChange({ ...character, ...p }),
    [character, onChange]
  );
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">
          {CHARACTER_ROLE_LABELS[character.role]}
        </Badge>
        <Input
          value={character.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="角色名稱"
          className="h-8 flex-1 text-sm font-medium"
        />
        <Select
          value={character.role}
          onValueChange={v => patch({ role: v as CharacterRole })}
        >
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(CHARACTER_ROLE_LABELS) as Array<
                [CharacterRole, string]
              >
            ).map(([id, label]) => (
              <SelectItem key={id} value={id} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          aria-label="刪除角色"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Input
        value={character.tagline ?? ""}
        onChange={e => patch({ tagline: e.target.value })}
        placeholder="一句話描述（例如：被遺忘的森林守護者）"
        className="h-8 text-xs"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">樣貌</Label>
          <Textarea
            value={character.appearance ?? ""}
            onChange={e => patch({ appearance: e.target.value })}
            placeholder="髮型、瞳色、身高、特徵…"
            className="min-h-[60px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">穿著</Label>
          <Textarea
            value={character.outfit ?? ""}
            onChange={e => patch({ outfit: e.target.value })}
            placeholder="服裝風格、配色、細節…"
            className="min-h-[60px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">個性</Label>
          <Textarea
            value={character.personality ?? ""}
            onChange={e => patch({ personality: e.target.value })}
            placeholder="性格、行為模式、口頭禪…"
            className="min-h-[60px] text-xs"
          />
          <QuickPickRow
            presets={PERSONALITY_TRAIT_PRESETS}
            onPick={v => {
              const current = (character.personality ?? "").trim();
              const next = current.includes(v)
                ? current
                : current
                  ? `${current}、${v}`
                  : v;
              patch({ personality: next });
            }}
            ariaLabel="快選 個性特質"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">背景</Label>
          <Textarea
            value={character.backstory ?? ""}
            onChange={e => patch({ backstory: e.target.value })}
            placeholder="出身、經歷、動機…"
            className="min-h-[60px] text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">喜好</Label>
          <ChipListInput
            values={character.likes ?? []}
            onChange={v => patch({ likes: v })}
            placeholder="按 Enter 新增"
            ariaLabel="新增喜好"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">興趣</Label>
          <ChipListInput
            values={character.interests ?? []}
            onChange={v => patch({ interests: v })}
            placeholder="按 Enter 新增"
            ariaLabel="新增興趣"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">隨身物件</Label>
          <ChipListInput
            values={character.signatureItems ?? []}
            onChange={v => patch({ signatureItems: v })}
            placeholder="按 Enter 新增"
            ariaLabel="新增物件"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/30">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Link2 className="w-3 h-3" /> 連結 LoRA 模型
          </Label>
          <Select
            value={character.linkedModelId?.toString() ?? "none"}
            onValueChange={v =>
              patch({
                linkedModelId: v === "none" ? null : Number(v),
                triggerWord:
                  v === "none"
                    ? ""
                    : (models.find(m => m.id === Number(v))?.triggerWord ??
                      character.triggerWord ??
                      ""),
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="（未連結）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">
                （未連結）
              </SelectItem>
              {models.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  尚未有訓練完成的 LoRA — 請至「模型訓練中心」訓練
                </div>
              ) : (
                models.map(m => (
                  <SelectItem
                    key={m.id}
                    value={m.id.toString()}
                    className="text-xs"
                  >
                    {m.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {m.modelType}
                      {m.status !== "ready" ? ` · ${m.status}` : ""}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Trigger word（生成時插入）
          </Label>
          <Input
            value={character.triggerWord ?? ""}
            onChange={e => patch({ triggerWord: e.target.value })}
            placeholder="例如：sks_alice"
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
});

// ─── Scene Card ─────────────────────────────────────────────────────────────

const SceneCard = memo(function SceneCard({
  scene,
  models,
  onChange,
  onDelete,
}: {
  scene: WorldScene;
  models: LinkableModel[];
  onChange: (next: WorldScene) => void;
  onDelete: () => void;
}) {
  const patch = useCallback(
    (p: Partial<WorldScene>) => onChange({ ...scene, ...p }),
    [scene, onChange]
  );
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase gap-1">
          <MapPin className="w-3 h-3" /> 場景
        </Badge>
        <Input
          value={scene.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="場景名稱（例如：晨霧中的療癒森林）"
          className="h-8 flex-1 text-sm font-medium"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          aria-label="刪除場景"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Input
        value={scene.tagline ?? ""}
        onChange={e => patch({ tagline: e.target.value })}
        placeholder="一句話氛圍（例如：濕潤、靜謐、有微光穿過樹葉）"
        className="h-8 text-xs"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">環境</Label>
          <Textarea
            value={scene.environment ?? ""}
            onChange={e => patch({ environment: e.target.value })}
            placeholder="地點、季節、天氣、時間…"
            className="min-h-[60px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">光線</Label>
          <Textarea
            value={scene.lighting ?? ""}
            onChange={e => patch({ lighting: e.target.value })}
            placeholder="光源方向、色溫、明暗對比…"
            className="min-h-[60px] text-xs"
          />
          <QuickPickRow
            presets={SCENE_LIGHTING_PRESETS}
            onPick={v => {
              const current = (scene.lighting ?? "").trim();
              const next = current.includes(v)
                ? current
                : current
                  ? `${current}、${v}`
                  : v;
              patch({ lighting: next });
            }}
            ariaLabel="快選 光線"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">氛圍</Label>
          <Textarea
            value={scene.mood ?? ""}
            onChange={e => patch({ mood: e.target.value })}
            placeholder="情緒、節奏、聲音…"
            className="min-h-[60px] text-xs"
          />
          <QuickPickRow
            presets={SCENE_MOOD_PRESETS}
            onPick={v => {
              const current = (scene.mood ?? "").trim();
              const next = current.includes(v)
                ? current
                : current
                  ? `${current}、${v}`
                  : v;
              patch({ mood: next });
            }}
            ariaLabel="快選 氛圍"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">備註</Label>
          <Textarea
            value={scene.notes ?? ""}
            onChange={e => patch({ notes: e.target.value })}
            placeholder="鏡位、運鏡、特殊安排…"
            className="min-h-[60px] text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            花草樹木
          </Label>
          <ChipListInput
            values={scene.flora ?? []}
            onChange={v => patch({ flora: v })}
            placeholder="松樹、苔蘚…"
            ariaLabel="新增植被"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            動物 / 生物
          </Label>
          <ChipListInput
            values={scene.fauna ?? []}
            onChange={v => patch({ fauna: v })}
            placeholder="螢火蟲、鹿…"
            ariaLabel="新增生物"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">物件</Label>
          <ChipListInput
            values={scene.props ?? []}
            onChange={v => patch({ props: v })}
            placeholder="石燈、木橋…"
            ariaLabel="新增物件"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">
          環境變化（晝夜、季節、突發事件）
        </Label>
        <ChipListInput
          values={scene.environmentChanges ?? []}
          onChange={v => patch({ environmentChanges: v })}
          placeholder="例如：黃昏時起霧"
          ariaLabel="新增環境變化"
        />
        <QuickAppendRow
          presets={ENVIRONMENT_CHANGE_PRESETS}
          values={scene.environmentChanges ?? []}
          onAppend={v => patch({ environmentChanges: v })}
          ariaLabel="快選 環境變化"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/30">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Link2 className="w-3 h-3" /> 連結 LoRA 模型
          </Label>
          <Select
            value={scene.linkedModelId?.toString() ?? "none"}
            onValueChange={v =>
              patch({
                linkedModelId: v === "none" ? null : Number(v),
                triggerWord:
                  v === "none"
                    ? ""
                    : (models.find(m => m.id === Number(v))?.triggerWord ??
                      scene.triggerWord ??
                      ""),
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="（未連結）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">
                （未連結）
              </SelectItem>
              {models.map(m => (
                <SelectItem
                  key={m.id}
                  value={m.id.toString()}
                  className="text-xs"
                >
                  {m.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {m.modelType}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Trigger word（生成時插入）
          </Label>
          <Input
            value={scene.triggerWord ?? ""}
            onChange={e => patch({ triggerWord: e.target.value })}
            placeholder="例如：scn_forest"
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
});

// ─── Main Panel ─────────────────────────────────────────────────────────────

export default function WorldbuildingPanel() {
  const utils = trpc.useUtils();
  const listQuery = trpc.worldbuilding.list.useQuery(undefined, {
    retry: false,
  });
  const modelsQuery = trpc.worldbuilding.linkableModels.useQuery(undefined, {
    retry: false,
  });
  const createMutation = trpc.worldbuilding.create.useMutation({
    onSuccess: () => {
      utils.worldbuilding.list.invalidate();
      toast.success("世界觀已建立");
    },
    onError: e => toast.error(`建立失敗：${e.message}`),
  });
  const updateMutation = trpc.worldbuilding.update.useMutation({
    onSuccess: () => {
      utils.worldbuilding.list.invalidate();
      toast.success("已儲存");
    },
    onError: e => toast.error(`儲存失敗：${e.message}`),
  });
  const deleteMutation = trpc.worldbuilding.delete.useMutation({
    onSuccess: () => {
      utils.worldbuilding.list.invalidate();
      toast.success("已刪除");
    },
    onError: e => toast.error(`刪除失敗：${e.message}`),
  });

  // currentId === null → 編輯中為「新世界觀」草稿；> 0 → 編輯既有
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [draft, setDraft] = useState<WorldbuildingFrameworkData>(() => {
    // 從 localStorage 復原草稿
    if (typeof window === "undefined") return emptyDraft();
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return emptyDraft();
      const parsed = JSON.parse(raw) as WorldbuildingFrameworkData;
      if (parsed && Array.isArray(parsed.characters) && Array.isArray(parsed.scenes)) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return emptyDraft();
  });

  // 草稿 → localStorage（只在新建模式時儲存，避免覆蓋既有編輯）
  useEffect(() => {
    if (currentId !== null) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore quota errors
    }
  }, [draft, currentId]);

  const models: LinkableModel[] = useMemo(
    () => (modelsQuery.data ?? []) as LinkableModel[],
    [modelsQuery.data]
  );

  const frameworks: LoadedFramework[] = useMemo(
    () => ((listQuery.data ?? []) as unknown as LoadedFramework[]),
    [listQuery.data]
  );

  const loadFramework = useCallback((fw: LoadedFramework) => {
    setCurrentId(fw.id);
    setDraft({
      name: fw.name,
      description: fw.description ?? "",
      genre: fw.genre ?? "",
      era: fw.era ?? "",
      characters: fw.characters ?? [],
      scenes: fw.scenes ?? [],
      objects: fw.objects ?? [],
      linkedModelIds: fw.linkedModelIds ?? [],
      tags: fw.tags ?? [],
      isActive: fw.isActive ?? true,
    });
  }, []);

  const resetToNewDraft = useCallback(() => {
    setCurrentId(null);
    setDraft(emptyDraft());
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }, []);

  // ── Mutators ──
  const updateChar = useCallback(
    (id: string, next: WorldCharacter) => {
      setDraft(d => ({
        ...d,
        characters: d.characters.map(c => (c.id === id ? next : c)),
      }));
    },
    []
  );
  const addCharacter = (role: CharacterRole) =>
    setDraft(d => ({ ...d, characters: [...d.characters, emptyCharacter(role)] }));
  const removeCharacter = (id: string) =>
    setDraft(d => ({ ...d, characters: d.characters.filter(c => c.id !== id) }));

  const updateScene = useCallback((id: string, next: WorldScene) => {
    setDraft(d => ({
      ...d,
      scenes: d.scenes.map(s => (s.id === id ? next : s)),
    }));
  }, []);
  const addScene = () =>
    setDraft(d => ({ ...d, scenes: [...d.scenes, emptyScene()] }));
  const removeScene = (id: string) =>
    setDraft(d => ({ ...d, scenes: d.scenes.filter(s => s.id !== id) }));

  // ── Save ──
  const linkedModelIdSet = useMemo(() => {
    const ids = new Set<number>();
    for (const c of draft.characters)
      if (c.linkedModelId != null) ids.add(c.linkedModelId);
    for (const s of draft.scenes)
      if (s.linkedModelId != null) ids.add(s.linkedModelId);
    return Array.from(ids);
  }, [draft.characters, draft.scenes]);

  const canSave = draft.name.trim().length > 0 && draft.characters.length > 0;

  const handleSave = () => {
    if (!canSave) {
      toast.error("請至少填寫世界觀名稱與一位角色");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
      genre: draft.genre?.trim() || undefined,
      era: draft.era?.trim() || undefined,
      characters: draft.characters,
      scenes: draft.scenes,
      objects: draft.objects ?? [],
      linkedModelIds: linkedModelIdSet,
      tags: draft.tags ?? [],
      isActive: draft.isActive ?? true,
    };
    if (currentId == null) {
      createMutation.mutate(payload, {
        onSuccess: ({ id }) => {
          setCurrentId(id);
          try {
            localStorage.removeItem(DRAFT_KEY);
          } catch {
            // ignore
          }
        },
      });
    } else {
      updateMutation.mutate({ id: currentId, patch: payload });
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm("確定刪除此世界觀？")) return;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          if (currentId === id) resetToNewDraft();
        },
      }
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex gap-5">
      {/* Left: Editor */}
      <div className="flex-1 min-w-0 space-y-4">
        <GlassCard hover={false}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="hs-h3 !mb-0 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              {currentId == null ? "新世界觀草稿" : `編輯：${draft.name || "（未命名）"}`}
            </h3>
            <div className="flex items-center gap-2">
              {currentId != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetToNewDraft}
                  className="text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> 新增
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={!canSave || isSaving}
                size="sm"
                className="text-xs"
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                {isSaving ? "儲存中…" : currentId == null ? "建立" : "儲存"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                世界觀名稱 *
              </Label>
              <Input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="例如：苔森紀年"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                風格 / 類型
              </Label>
              <Input
                value={draft.genre ?? ""}
                onChange={e => setDraft(d => ({ ...d, genre: e.target.value }))}
                placeholder="療癒奇幻、賽博龐克、日常…"
                className="h-9"
              />
              <QuickPickRow
                presets={GENRE_PRESETS}
                active={draft.genre ?? ""}
                onPick={v => setDraft(d => ({ ...d, genre: v }))}
                ariaLabel="快選 風格類型"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[11px] text-muted-foreground">
                時代背景
              </Label>
              <Input
                value={draft.era ?? ""}
                onChange={e => setDraft(d => ({ ...d, era: e.target.value }))}
                placeholder="例如：中世紀、近未來、架空…"
                className="h-9"
              />
              <QuickPickRow
                presets={ERA_PRESETS}
                active={draft.era ?? ""}
                onPick={v => setDraft(d => ({ ...d, era: v }))}
                ariaLabel="快選 時代背景"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[11px] text-muted-foreground">描述</Label>
              <Textarea
                value={draft.description ?? ""}
                onChange={e =>
                  setDraft(d => ({ ...d, description: e.target.value }))
                }
                placeholder="這個世界的核心設定、規則、基調…"
                className="min-h-[60px]"
              />
            </div>
          </div>

          {linkedModelIdSet.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2 text-xs text-muted-foreground">
              <Link2 className="w-3.5 h-3.5" />
              已連結模型訓練中心 LoRA：
              <Badge variant="secondary" className="text-[10px]">
                {linkedModelIdSet.length} 個
              </Badge>
            </div>
          )}
        </GlassCard>

        {/* Characters */}
        <GlassCard hover={false}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="hs-h3 !mb-0 flex items-center gap-2">
              <Users className="w-4 h-4" /> 角色（{draft.characters.length}）
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                Object.entries(CHARACTER_ROLE_LABELS) as Array<
                  [CharacterRole, string]
                >
              ).map(([role, label]) => (
                <Button
                  key={role}
                  variant="outline"
                  size="sm"
                  onClick={() => addCharacter(role)}
                  className="h-7 text-[11px] gap-1"
                >
                  <Plus className="w-3 h-3" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {draft.characters.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                還沒有角色 — 從上方按鈕新增一位主角開始
              </div>
            ) : (
              draft.characters.map(c => (
                <CharacterCard
                  key={c.id}
                  character={c}
                  models={models}
                  onChange={next => updateChar(c.id, next)}
                  onDelete={() => removeCharacter(c.id)}
                />
              ))
            )}
          </div>
        </GlassCard>

        {/* Scenes */}
        <GlassCard hover={false}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="hs-h3 !mb-0 flex items-center gap-2">
              <Palette className="w-4 h-4" /> 場景（{draft.scenes.length}）
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={addScene}
              className="h-7 text-[11px] gap-1"
            >
              <Plus className="w-3 h-3" /> 新增場景
            </Button>
          </div>
          <div className="space-y-3">
            {draft.scenes.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                還沒有場景 — 新增一個讓導演 AI 知道故事發生在哪裡
              </div>
            ) : (
              draft.scenes.map(s => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  models={models}
                  onChange={next => updateScene(s.id, next)}
                  onDelete={() => removeScene(s.id)}
                />
              ))
            )}
          </div>
        </GlassCard>
      </div>

      {/* Right: Library */}
      <div className="hidden md:block w-[280px] shrink-0">
        <GlassCard hover={false} className="sticky top-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="hs-h3 !mb-0 flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              我的世界觀
            </h3>
            <Badge variant="secondary" className="text-[10px]">
              {frameworks.length}
            </Badge>
          </div>

          <div className="mb-3 rounded-lg border border-border/30 bg-card/30 p-2.5 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground/80">
              <Wand2 className="w-3 h-3" /> 連結模型訓練中心
            </div>
            <div>
              可連結 LoRA：
              <Badge variant="outline" className="ml-1 text-[10px]">
                {models.length}
              </Badge>
            </div>
            {models.length === 0 && (
              <div className="text-amber-700 dark:text-amber-300">
                尚未有訓練完成的模型 — 前往「模型訓練中心」訓練後即可在角色／場景下拉選用
              </div>
            )}
          </div>

          <ScrollArea className="h-[calc(100vh-380px)]">
            {frameworks.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">
                還沒有儲存的世界觀
              </div>
            ) : (
              <div className="space-y-1.5 pr-2">
                {frameworks.map(fw => (
                  <div
                    key={fw.id}
                    className={`rounded-lg border p-2 text-xs cursor-pointer transition ${
                      currentId === fw.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border/30 bg-card/30 hover:bg-card/60"
                    }`}
                    onClick={() => loadFramework(fw)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{fw.name}</div>
                        {fw.genre && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {fw.genre}
                          </div>
                        )}
                        <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
                          <span>{fw.characters?.length ?? 0} 角色</span>
                          <span>·</span>
                          <span>{fw.scenes?.length ?? 0} 場景</span>
                          {(fw.linkedModelIds?.length ?? 0) > 0 && (
                            <>
                              <span>·</span>
                              <span>{fw.linkedModelIds!.length} LoRA</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="刪除"
                        onClick={e => {
                          e.stopPropagation();
                          handleDelete(fw.id);
                        }}
                        className="text-muted-foreground/60 hover:text-destructive transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </GlassCard>
      </div>
    </div>
  );
}
