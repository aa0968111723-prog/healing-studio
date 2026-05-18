/**
 * TeachingArchive.tsx — 資料庫（training-data feature）
 *
 * 讓使用者上傳 PDF、文件、圖片、影片、語音、簡報等素材並做分類保存。
 * 未來會接 Phase 2 的 RAG ingestion 切片並做向量檢索。
 */

import { useCallback, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import {
  shortErrorMsg,
  uploadFileToS3WithProgress,
  detectMediaTypeFromFile,
  deriveTitleFromFileName,
  type DetectedMediaType,
} from "@/lib/upload";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BookOpen,
  Upload,
  FileText,
  FileType2,
  Image as ImageIcon,
  Film,
  Music,
  Presentation,
  Trash2,
  Plus,
  Loader2,
  Search,
  Filter,
  X,
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Users,
  ShieldCheck,
  Lock,
  Globe2,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useLocation } from "wouter";

// ─── 常數 — 與 server/routers/teachingArchive.ts 保持同步 ────────────────────

const MEDIA_TYPES = [
  { value: "text", label: "純文字", icon: FileText, hint: "直接輸入文字，不需上傳" },
  { value: "pdf", label: "PDF", icon: FileType2, hint: "文件、講義、稿件" },
  { value: "document", label: "Word / TXT", icon: FileText, hint: "Word/純文字/Markdown" },
  { value: "image", label: "圖片", icon: ImageIcon, hint: "照片、圖像" },
  { value: "video", label: "影片", icon: Film, hint: "影片檔案" },
  { value: "audio", label: "語音 / 錄音", icon: Music, hint: "錄音檔、講座音檔" },
  { value: "presentation", label: "簡報", icon: Presentation, hint: "PPT / PPTX" },
] as const;

type MediaType = (typeof MEDIA_TYPES)[number]["value"];

const SOURCE_TYPES: Array<{ value: SourceType; label: string }> = [
  { value: "discourse", label: "講述" },
  { value: "group_practice", label: "團體練習" },
  { value: "class", label: "課程" },
  { value: "ceremony", label: "活動" },
  { value: "publication", label: "出版品" },
  { value: "interview", label: "訪談" },
  { value: "other", label: "其他" },
];

type SourceType =
  | "discourse"
  | "group_practice"
  | "class"
  | "ceremony"
  | "publication"
  | "interview"
  | "other";

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string }> = [
  { value: "private", label: "僅自己" },
  { value: "team_shared", label: "團隊共享" },
  { value: "public_disciples", label: "全 workspace 可見" },
];

type Visibility = "private" | "team_shared" | "public_disciples";

const DEFAULT_SPEAKER = "";

// ─── 媒體類型對應的可接受 MIME 與檔案 input accept ──────────────────────────
const ACCEPT_BY_MEDIA: Partial<Record<MediaType, string>> = {
  pdf: "application/pdf",
  document: ".doc,.docx,.txt,.md,.rtf",
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  presentation: ".ppt,.pptx",
};

function getMediaLabel(value: string): string {
  return MEDIA_TYPES.find(m => m.value === value)?.label ?? value;
}

function getMediaIcon(value: string) {
  return MEDIA_TYPES.find(m => m.value === value)?.icon ?? FileText;
}

function getSourceLabel(value: string): string {
  return SOURCE_TYPES.find(s => s.value === value)?.label ?? value;
}

// ─── 主元件 ─────────────────────────────────────────────────────────────────

export default function TeachingArchive() {
  const [filters, setFilters] = useState<{
    mediaType?: MediaType;
    sourceType?: SourceType;
    lineage?: string;
    topic?: string;
    search?: string;
    scope?: "mine" | "team" | "public";
  }>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [trainOpen, setTrainOpen] = useState(false);

  const listQuery = trpc.teachingArchive.list.useQuery(
    {
      mediaType: filters.mediaType,
      sourceType: filters.sourceType,
      lineage: filters.lineage,
      topic: filters.topic,
      search: filters.search?.trim() || undefined,
      scope: filters.scope,
    },
    {
      staleTime: 5_000,
      // 有 pending / processing 的列就快速輪詢 — 自動抽文 / 轉文字完成
      // 後狀態會自動翻新，不用使用者按重新整理。React Query v5 把 Query
      // 物件傳進來，需要從 .state.data 取資料而不是 callback 的第一個參數。
      refetchInterval: query => {
        const list = query.state.data as MaterialItem[] | undefined;
        if (!list) return false;
        const hasPending = list.some(
          row =>
            row.transcriptionStatus === "pending" ||
            row.transcriptionStatus === "processing"
        );
        return hasPending ? 3_000 : false;
      },
    }
  );
  const lineagesQuery = trpc.teachingArchive.lineages.useQuery();
  const topicsQuery = trpc.teachingArchive.topics.useQuery();
  const teamsQuery = trpc.teams.list.useQuery();

  const items = listQuery.data ?? [];
  const teams = teamsQuery.data ?? [];

  const selectedImageItems = items.filter(
    i => selectedIds.has(i.id) && i.mediaType === "image" && i.fileUrl
  );

  const refetchAll = useCallback(() => {
    listQuery.refetch();
    lineagesQuery.refetch();
    topicsQuery.refetch();
  }, [listQuery, lineagesQuery, topicsQuery]);

  function toggleSelected(id: number, isImage: boolean) {
    if (!isImage) return; // 訓練只看圖片，非圖片卡片不可選
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  return (
    <div className="page-shell space-y-6">
      <header className="page-header">
        <p className="page-eyebrow">Database</p>
        <h1 className="page-title flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          資料庫
        </h1>
        <p className="page-subtitle">
          上傳 PDF、文件、圖片、影片、語音、簡報等素材並分類保存。
          PDF 自動抽文、語音／影片自動轉文字後，AI 助理就能引用內容回答。
        </p>
      </header>

      {/* 視野切換 — 我的 / 團隊 / 全 workspace 公開 */}
      <div className="flex flex-wrap gap-2 items-center">
        <ScopeChip
          icon={Filter}
          label="全部"
          active={!filters.scope}
          onClick={() => setFilters(f => ({ ...f, scope: undefined }))}
        />
        <ScopeChip
          icon={Lock}
          label="我的（私人）"
          active={filters.scope === "mine"}
          onClick={() => setFilters(f => ({ ...f, scope: "mine" }))}
        />
        <ScopeChip
          icon={Users}
          label="團隊共享"
          active={filters.scope === "team"}
          onClick={() => setFilters(f => ({ ...f, scope: "team" }))}
          badge={teams.length > 0 ? `${teams.length}` : undefined}
        />
        <ScopeChip
          icon={Globe2}
          label="全 workspace 公開"
          active={filters.scope === "public"}
          onClick={() => setFilters(f => ({ ...f, scope: "public" }))}
        />
        <a
          href="/teams"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          <ShieldCheck className="w-3 h-3 inline mr-1" />
          管理團隊
        </a>
      </div>

      {/* 過濾列 */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="search" className="text-xs text-muted-foreground mb-1 block">
            <Search className="inline w-3 h-3 mr-1" />
            搜尋標題 / 描述 / 內文
          </Label>
          <Input
            id="search"
            value={filters.search ?? ""}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="例：關鍵字"
          />
        </div>
        <FilterSelect
          label="檔案類型"
          value={filters.mediaType}
          onChange={v => setFilters(f => ({ ...f, mediaType: v as MediaType }))}
          options={MEDIA_TYPES.map(m => ({ value: m.value, label: m.label }))}
        />
        <FilterSelect
          label="來源"
          value={filters.sourceType}
          onChange={v =>
            setFilters(f => ({ ...f, sourceType: v as SourceType }))
          }
          options={SOURCE_TYPES.map(s => ({ value: s.value, label: s.label }))}
        />
        <FilterSelect
          label="分類"
          value={filters.lineage}
          onChange={v => setFilters(f => ({ ...f, lineage: v }))}
          options={(lineagesQuery.data ?? []).map(l => ({ value: l, label: l }))}
        />
        <FilterSelect
          label="主題"
          value={filters.topic}
          onChange={v => setFilters(f => ({ ...f, topic: v }))}
          options={(topicsQuery.data ?? []).map(t => ({ value: t, label: t }))}
        />
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            <Filter className="w-4 h-4 mr-1" />
            清除
          </Button>
        )}
        <div className="flex gap-2 ml-auto">
          <Button
            variant={selectionMode ? "default" : "outline"}
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
          >
            <GraduationCap className="w-4 h-4 mr-1" />
            {selectionMode ? "結束選取" : "選圖訓練 LoRA"}
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            新增資料
          </Button>
        </div>
      </div>

      {/* 清單 */}
      {listQuery.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>還沒有任何資料。點右上「新增資料」開始建立你的素材庫。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <MaterialCard
              key={item.id}
              item={item}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() =>
                toggleSelected(item.id, item.mediaType === "image")
              }
              onClick={() => {
                if (selectionMode) {
                  toggleSelected(item.id, item.mediaType === "image");
                } else {
                  setDetailId(item.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* 多選浮動 footer：選了圖片就出現 */}
      {selectionMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full border bg-card shadow-lg px-5 py-3 flex items-center gap-4">
          <span className="text-sm">
            已選 <strong>{selectedImageItems.length}</strong> 張圖片
            {selectedIds.size > selectedImageItems.length && (
              <span className="text-muted-foreground">
                （非圖片素材已忽略）
              </span>
            )}
          </span>
          <Button
            size="sm"
            disabled={selectedImageItems.length < 4}
            onClick={() => setTrainOpen(true)}
          >
            <GraduationCap className="w-4 h-4 mr-1" />
            訓練 LoRA（需 4 張以上）
          </Button>
          <Button size="sm" variant="ghost" onClick={exitSelectionMode}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={refetchAll}
        teams={teams}
      />

      {detailId !== null && (
        <DetailDialog
          id={detailId}
          onClose={() => setDetailId(null)}
          onMutated={refetchAll}
        />
      )}

      {trainOpen && (
        <TrainLoraDialog
          imageItems={selectedImageItems}
          onClose={() => setTrainOpen(false)}
          onStarted={() => {
            setTrainOpen(false);
            exitSelectionMode();
          }}
        />
      )}
    </div>
  );
}

// ─── 子元件：過濾下拉 ──────────────────────────────────────────────────────

function ScopeChip({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: typeof Filter;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card hover:bg-muted"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge && (
        <span
          className={`ml-0.5 rounded-full px-1.5 text-xs ${
            active ? "bg-primary-foreground/20" : "bg-muted-foreground/20"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function VisibilityChip({
  visibility,
}: {
  visibility: MaterialItem["visibility"];
}) {
  if (visibility === "private") {
    return (
      <Badge variant="outline" className="gap-1">
        <Lock className="w-3 h-3" />
        私人
      </Badge>
    );
  }
  if (visibility === "team_shared") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Users className="w-3 h-3" />
        團隊
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Globe2 className="w-3 h-3" />
      公開
    </Badge>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-[140px]">
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Select
        // shadcn Select doesn't allow undefined as the controlled value. We
        // map "" ⇄ undefined and use the sentinel "__all" to mean "no filter".
        value={value ?? "__all"}
        onValueChange={v => onChange(v === "__all" ? undefined : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="全部" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">全部</SelectItem>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── 子元件：卡片 ──────────────────────────────────────────────────────────

type MaterialItem = inferRouterOutputs<AppRouter>["teachingArchive"]["list"][number];

function MaterialCard({
  item,
  selectionMode,
  selected,
  onToggleSelect,
  onClick,
}: {
  item: MaterialItem;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const Icon = getMediaIcon(item.mediaType);
  const isImage = item.mediaType === "image";
  const selectable = selectionMode && isImage;
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border bg-card hover:shadow-md transition-shadow p-4 space-y-2 relative ${
        selected ? "ring-2 ring-primary" : ""
      } ${selectionMode && !isImage ? "opacity-50" : ""}`}
    >
      {selectable && (
        <div
          className="absolute top-3 right-3 z-10"
          onClick={e => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          <Checkbox checked={selected} />
        </div>
      )}
      <div className="flex items-start gap-2">
        <Icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{item.title}</h3>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {item.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="secondary">{getMediaLabel(item.mediaType)}</Badge>
        <Badge variant="outline">{getSourceLabel(item.sourceType)}</Badge>
        {item.lineage && <Badge variant="outline">{item.lineage}</Badge>}
        {item.topic && <Badge variant="outline">{item.topic}</Badge>}
        <TranscriptionBadge status={item.transcriptionStatus} />
        <VisibilityChip visibility={item.visibility} />
      </div>
      {(item.speaker || item.sourceDate) && (
        <div className="text-xs text-muted-foreground">
          {item.speaker ?? ""}
          {item.speaker && item.sourceDate ? " · " : ""}
          {formatDateOnly(item.sourceDate)}
        </div>
      )}
    </button>
  );
}

function TranscriptionBadge({
  status,
}: {
  status: MaterialItem["transcriptionStatus"];
}) {
  if (status === "not_applicable") return null;
  if (status === "completed") {
    return (
      <Badge variant="outline" className="gap-1">
        <CheckCircle2 className="w-3 h-3 text-green-600" />
        已抽文
      </Badge>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === "pending" ? "排隊中" : "抽文中"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-destructive">
      <AlertCircle className="w-3 h-3" />
      抽文失敗
    </Badge>
  );
}


// ─── 子元件：上傳 / 新增 Dialog（支援批次 + 拖拉 + 進度 + 連續新增） ────────

type FileEntryStatus =
  | "queued"
  | "uploading"
  | "saving"
  | "done"
  | "error";

type FileEntry = {
  /** 純前端用的本地 id，避免 React 鍵衝突 */
  uid: string;
  file: File;
  detectedMediaType: DetectedMediaType;
  title: string;
  progress: number;
  status: FileEntryStatus;
  errorMessage?: string;
  createdRowId?: number;
};

function isAllSettled(entries: FileEntry[]): boolean {
  if (entries.length === 0) return false;
  return entries.every(e => e.status === "done" || e.status === "error");
}

function UploadDialog({
  open,
  onOpenChange,
  onCreated,
  teams,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  teams: Array<{ id: number; name: string; role: "owner" | "admin" | "member" }>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);

  // 共用分類欄位（兩種模式共用）
  const [shared, setShared] = useState({
    description: "",
    lineage: "",
    sourceType: "discourse" as SourceType,
    sourceDate: "",
    sourceLocation: "",
    topic: "",
    speaker: DEFAULT_SPEAKER,
    tagsInput: "",
    visibility: "private" as Visibility,
    /** null = 個人池；數字 = 該團隊 id */
    teamId: null as number | null,
  });

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [textForm, setTextForm] = useState({
    title: "",
    textContent: "",
  });

  const createMut = trpc.teachingArchive.create.useMutation();

  function resetEntriesOnly() {
    setEntries([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetTextOnly() {
    setTextForm({ title: "", textContent: "" });
  }

  function resetAll() {
    setShared({
      description: "",
      lineage: "",
      sourceType: "discourse",
      sourceDate: "",
      sourceLocation: "",
      topic: "",
      speaker: DEFAULT_SPEAKER,
      tagsInput: "",
      visibility: "private",
      teamId: null,
    });
    resetEntriesOnly();
    resetTextOnly();
    setMode("file");
  }

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const newEntries: FileEntry[] = list.map(f => ({
      uid: nanoid(8),
      file: f,
      detectedMediaType: detectMediaTypeFromFile(f),
      title: deriveTitleFromFileName(f.name),
      progress: 0,
      status: "queued",
    }));
    setEntries(prev => [...prev, ...newEntries]);
  }

  function removeEntry(uid: string) {
    setEntries(prev => prev.filter(e => e.uid !== uid));
  }

  function patchEntry(uid: string, patch: Partial<FileEntry>) {
    setEntries(prev =>
      prev.map(e => (e.uid === uid ? { ...e, ...patch } : e))
    );
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function buildTags(): string[] | undefined {
    const tags = shared.tagsInput
      .split(/[,，、\s]+/)
      .map(t => t.trim())
      .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }

  function buildSharedClassification() {
    return {
      description: shared.description.trim() || undefined,
      lineage: shared.lineage.trim() || undefined,
      sourceType: shared.sourceType,
      sourceDate: shared.sourceDate || undefined,
      sourceLocation: shared.sourceLocation.trim() || undefined,
      topic: shared.topic.trim() || undefined,
      speaker: shared.speaker.trim() || undefined,
      tags: buildTags(),
      visibility: shared.visibility,
      teamId: shared.teamId ?? undefined,
    };
  }

  async function handleSubmit() {
    if (mode === "text") {
      if (!textForm.title.trim()) {
        toast.error("請輸入標題");
        return;
      }
      if (!textForm.textContent.trim()) {
        toast.error("純文字資料需要填寫內文");
        return;
      }
      setSubmitting(true);
      try {
        await createMut.mutateAsync({
          title: textForm.title.trim(),
          mediaType: "text",
          textContent: textForm.textContent.trim(),
          ...buildSharedClassification(),
        });
        toast.success("已儲存");
        onCreated();
        if (continuousMode) {
          resetTextOnly();
        } else {
          resetAll();
          onOpenChange(false);
        }
      } catch (err) {
        toast.error(shortErrorMsg(err, 120));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── 檔案模式：逐個上傳 + 建立紀錄 ────────────────────────────────────
    if (entries.length === 0) {
      toast.error("請選擇要上傳的檔案，或拖拉到下方框內");
      return;
    }
    setSubmitting(true);
    const sharedClassification = buildSharedClassification();
    let successCount = 0;
    let errorCount = 0;

    for (const entry of entries) {
      if (entry.status === "done") continue;
      try {
        patchEntry(entry.uid, { status: "uploading", progress: 0 });
        const { url, fileKey } = await uploadFileToS3WithProgress(
          entry.file,
          pct => patchEntry(entry.uid, { progress: pct })
        );
        patchEntry(entry.uid, { status: "saving" });
        const created = await createMut.mutateAsync({
          title: entry.title.trim() || entry.file.name,
          mediaType: entry.detectedMediaType,
          fileUrl: url,
          fileKey,
          fileName: entry.file.name,
          mimeType: entry.file.type,
          fileSizeBytes: entry.file.size,
          ...sharedClassification,
        });
        patchEntry(entry.uid, {
          status: "done",
          progress: 100,
          createdRowId: created.id,
        });
        successCount++;
      } catch (err) {
        errorCount++;
        patchEntry(entry.uid, {
          status: "error",
          errorMessage: shortErrorMsg(err, 80),
        });
      }
    }

    setSubmitting(false);
    if (successCount > 0) {
      toast.success(`已新增 ${successCount} 筆資料`);
      onCreated();
    }
    if (errorCount === 0) {
      if (continuousMode) {
        resetEntriesOnly();
      } else {
        resetAll();
        onOpenChange(false);
      }
    }
    // 有錯誤就保留 entries 在畫面上，使用者可以看哪幾筆失敗、移除後再試。
  }

  function handleDialogChange(v: boolean) {
    if (submitting) return;
    if (!v) {
      resetAll();
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增資料</DialogTitle>
          <DialogDescription>
            拖拉檔案到下方一次上傳多份；或切到「純文字」直接貼上內文。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={v => setMode(v as "file" | "text")}
          className="mt-2"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">
              <Upload className="w-4 h-4 mr-1" />
              上傳檔案（支援批次）
            </TabsTrigger>
            <TabsTrigger value="text">
              <FileText className="w-4 h-4 mr-1" />
              純文字輸入
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4 mt-4">
            <div
              onDragOver={e => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/60"
              }`}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                把檔案拖到這裡，或點擊選擇
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                支援圖片 / 影片 / 語音 / PDF / Word / PPT — 可一次選多個
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {entries.length > 0 && (
              <div className="space-y-2">
                {entries.map(entry => (
                  <FileEntryRow
                    key={entry.uid}
                    entry={entry}
                    disabled={submitting}
                    onTitleChange={t => patchEntry(entry.uid, { title: t })}
                    onMediaTypeChange={m =>
                      patchEntry(entry.uid, { detectedMediaType: m })
                    }
                    onRemove={() => removeEntry(entry.uid)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="text" className="space-y-4 mt-4">
            <Field label="標題" required>
              <Input
                value={textForm.title}
                onChange={e =>
                  setTextForm(f => ({ ...f, title: e.target.value }))
                }
                placeholder="例：簡介文件"
              />
            </Field>
            <Field label="內文" required>
              <Textarea
                value={textForm.textContent}
                onChange={e =>
                  setTextForm(f => ({ ...f, textContent: e.target.value }))
                }
                placeholder="直接貼上內文……"
                rows={10}
              />
            </Field>
          </TabsContent>
        </Tabs>

        <div className="border-t pt-4 mt-4 space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            分類資訊（本批次 / 本筆共用）
          </p>

          <Field label="描述">
            <Textarea
              value={shared.description}
              onChange={e =>
                setShared(s => ({ ...s, description: e.target.value }))
              }
              placeholder="這批資料的背景或重點"
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="分類">
              <Input
                value={shared.lineage}
                onChange={e =>
                  setShared(s => ({ ...s, lineage: e.target.value }))
                }
                placeholder="例：分類名稱"
              />
            </Field>
            <Field label="來源類型">
              <Select
                value={shared.sourceType}
                onValueChange={v =>
                  setShared(s => ({ ...s, sourceType: v as SourceType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="日期">
              <Input
                type="date"
                value={shared.sourceDate}
                onChange={e =>
                  setShared(s => ({ ...s, sourceDate: e.target.value }))
                }
              />
            </Field>
            <Field label="講授地點">
              <Input
                value={shared.sourceLocation}
                onChange={e =>
                  setShared(s => ({ ...s, sourceLocation: e.target.value }))
                }
                placeholder="例：地點名稱"
              />
            </Field>
            <Field label="主題">
              <Input
                value={shared.topic}
                onChange={e =>
                  setShared(s => ({ ...s, topic: e.target.value }))
                }
                placeholder="例：主題"
              />
            </Field>
            <Field label="講者">
              <Input
                value={shared.speaker}
                onChange={e =>
                  setShared(s => ({ ...s, speaker: e.target.value }))
                }
              />
            </Field>
          </div>

          <Field label="標籤（以逗號、頓號或空白分隔）">
            <Input
              value={shared.tagsInput}
              onChange={e =>
                setShared(s => ({ ...s, tagsInput: e.target.value }))
              }
              placeholder="標籤A, 標籤B"
            />
          </Field>

          <Field label="可見範圍">
            <Select
              value={shared.visibility}
              onValueChange={v =>
                setShared(s => ({
                  ...s,
                  visibility: v as Visibility,
                  // 切到非 team_shared 時，把暫存的 teamId 清掉避免送出時 server reject
                  teamId: v === "team_shared" ? s.teamId : null,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* 只有 team_shared 才需要選 team；其他可見範圍隱藏 */}
          {shared.visibility === "team_shared" && (
            <Field label="共享給哪個團隊" required>
              {teams.length === 0 ? (
                <p className="text-xs text-muted-foreground border rounded-md p-2 bg-muted/30">
                  你還沒有任何團隊。請先到{" "}
                  <a
                    href="/teams"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    團隊管理
                  </a>{" "}
                  建立或加入一個團隊。
                </p>
              ) : (
                <Select
                  value={shared.teamId ? String(shared.teamId) : ""}
                  onValueChange={v =>
                    setShared(s => ({ ...s, teamId: parseInt(v, 10) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選擇團隊…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}（{t.role}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch
              checked={continuousMode}
              onCheckedChange={setContinuousMode}
            />
            <span>連續新增（保留分類欄位、不關閉視窗）</span>
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                resetAll();
                onOpenChange(false);
              }}
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  處理中…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  {mode === "file" && entries.length > 1
                    ? `儲存 ${entries.length} 筆`
                    : "儲存"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileEntryRow({
  entry,
  disabled,
  onTitleChange,
  onMediaTypeChange,
  onRemove,
}: {
  entry: FileEntry;
  disabled: boolean;
  onTitleChange: (t: string) => void;
  onMediaTypeChange: (m: DetectedMediaType) => void;
  onRemove: () => void;
}) {
  const Icon = getMediaIcon(entry.detectedMediaType);
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-1 text-primary shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Input
            value={entry.title}
            onChange={e => onTitleChange(e.target.value)}
            placeholder="標題"
            disabled={disabled || entry.status === "done"}
          />
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <span className="truncate flex-1">
              {entry.file.name} · {(entry.file.size / 1024 / 1024).toFixed(2)}{" "}
              MB
            </span>
            <Select
              value={entry.detectedMediaType}
              onValueChange={v => onMediaTypeChange(v as DetectedMediaType)}
              disabled={disabled || entry.status === "done"}
            >
              <SelectTrigger className="w-[130px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_TYPES.filter(m => m.value !== "text").map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {entry.status !== "done" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={disabled && entry.status !== "queued"}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      {entry.status !== "queued" && (
        <div className="space-y-1">
          <Progress value={entry.progress} className="h-1.5" />
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {entry.status === "uploading" && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                上傳中 {entry.progress}%
              </>
            )}
            {entry.status === "saving" && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                儲存中…
              </>
            )}
            {entry.status === "done" && (
              <>
                <CheckCircle2 className="w-3 h-3 text-green-600" />
                完成（自動抽文 / 轉文字會在背景進行）
              </>
            )}
            {entry.status === "error" && (
              <>
                <AlertCircle className="w-3 h-3 text-destructive" />
                {entry.errorMessage ?? "上傳失敗"}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 子元件：訓練 LoRA Dialog（B4 — 把選取的圖片送進 loraTrainer） ─────────

function TrainLoraDialog({
  imageItems,
  onClose,
  onStarted,
}: {
  imageItems: Array<{ id: number; fileUrl: string | null; title: string }>;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [, navigate] = useLocation();
  const [modelName, setModelName] = useState("圖片 LoRA");
  const [triggerWord, setTriggerWord] = useState("STYLE");
  const [modelType, setModelType] = useState<
    "image_subject" | "style_lora" | "scene_lora" | "portrait_lora"
  >("portrait_lora");
  const [steps, setSteps] = useState(1000);

  const trainMut = trpc.loraTrainer.trainWithReplicate.useMutation();

  const validImageUrls = imageItems
    .map(i => i.fileUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  async function handleStart() {
    if (validImageUrls.length < 4) {
      toast.error("至少需要 4 張圖片");
      return;
    }
    if (!modelName.trim()) {
      toast.error("請輸入模型名稱");
      return;
    }
    if (!triggerWord.trim()) {
      toast.error("請輸入觸發詞");
      return;
    }
    try {
      const result = await trainMut.mutateAsync({
        modelName: modelName.trim(),
        modelType,
        triggerWord: triggerWord.trim(),
        steps,
        imageUrls: validImageUrls,
      });
      toast.success(
        `已送出訓練（trainingId: ${result.trainingId.slice(0, 8)}…）`
      );
      onStarted();
      navigate(`/models`);
    } catch (err) {
      toast.error(shortErrorMsg(err, 160));
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5" />
            用選取的圖片訓練 LoRA
          </DialogTitle>
          <DialogDescription>
            從資料庫挑出的 <strong>{validImageUrls.length}</strong> 張圖片會打包成
            訓練資料集，送進 Replicate 的 flux-dev-lora-trainer。完成後可在
            「角色鍛造所」使用這個 LoRA。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="模型名稱" required>
            <Input
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="例：圖片 LoRA"
            />
          </Field>
          <Field label="觸發詞（trigger word）" required>
            <Input
              value={triggerWord}
              onChange={e => setTriggerWord(e.target.value)}
              placeholder="只允許英數，建議大寫便於辨識"
            />
          </Field>
          <Field label="模型類型">
            <Select
              value={modelType}
              onValueChange={v =>
                setModelType(
                  v as
                    | "image_subject"
                    | "style_lora"
                    | "scene_lora"
                    | "portrait_lora"
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait_lora">
                  肖像（portrait_lora） — 適合人像
                </SelectItem>
                <SelectItem value="image_subject">
                  主題（image_subject）
                </SelectItem>
                <SelectItem value="style_lora">
                  風格（style_lora）
                </SelectItem>
                <SelectItem value="scene_lora">
                  場景（scene_lora）
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="訓練步數">
            <Input
              type="number"
              min={100}
              max={10_000}
              value={steps}
              onChange={e => setSteps(parseInt(e.target.value, 10) || 1000)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            訓練要花 15~40 分鐘，期間可關掉這頁。狀態到「角色鍛造所」看。
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={trainMut.isPending}
          >
            取消
          </Button>
          <Button
            onClick={handleStart}
            disabled={trainMut.isPending || validImageUrls.length < 4}
          >
            {trainMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                送出中…
              </>
            ) : (
              <>
                <GraduationCap className="w-4 h-4 mr-2" />
                開始訓練
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 子元件：明細 Dialog ───────────────────────────────────────────────────

function DetailDialog({
  id,
  onClose,
  onMutated,
}: {
  id: number;
  onClose: () => void;
  onMutated: () => void;
}) {
  const itemQuery = trpc.teachingArchive.get.useQuery(
    { id },
    {
      // 自動抽文 / 轉文字進行中時，每 3 秒回拉一次狀態
      refetchInterval: query => {
        const row = query.state.data as
          | { transcriptionStatus?: string }
          | undefined;
        const s = row?.transcriptionStatus;
        return s === "pending" || s === "processing" ? 3_000 : false;
      },
    }
  );
  const deleteMut = trpc.teachingArchive.delete.useMutation();
  const reingestMut = trpc.teachingArchive.triggerIngestion.useMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!itemQuery.data) return null;
  const item = itemQuery.data;
  const Icon = getMediaIcon(item.mediaType);

  return (
    <>
      <Dialog open onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="w-5 h-5" />
              {item.title}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap gap-1.5 mt-2">
              <Badge variant="secondary">{getMediaLabel(item.mediaType)}</Badge>
              <Badge variant="outline">{getSourceLabel(item.sourceType)}</Badge>
              {item.lineage && <Badge variant="outline">{item.lineage}</Badge>}
              {item.topic && <Badge variant="outline">{item.topic}</Badge>}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            {item.description && (
              <section>
                <h4 className="text-muted-foreground text-xs mb-1">描述</h4>
                <p className="whitespace-pre-wrap">{item.description}</p>
              </section>
            )}

            {item.mediaType === "text" && item.textContent && (
              <section>
                <h4 className="text-muted-foreground text-xs mb-1">內文</h4>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {item.textContent}
                </p>
              </section>
            )}

            {item.fileUrl && (
              <section>
                <h4 className="text-muted-foreground text-xs mb-1">檔案</h4>
                <FilePreview
                  url={item.fileUrl}
                  mediaType={item.mediaType}
                  fileName={item.fileName ?? "檔案"}
                />
              </section>
            )}

            {/* 自動抽文 / 轉文字結果 — 給 PDF / 音檔 / 影片 */}
            {item.mediaType !== "text" && (
              <section>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-muted-foreground text-xs">
                    抽文 / 轉文字
                  </h4>
                  {(item.transcriptionStatus === "failed" ||
                    item.transcriptionStatus === "completed") &&
                    (item.mediaType === "pdf" ||
                      item.mediaType === "audio" ||
                      item.mediaType === "video") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reingestMut.isPending}
                        onClick={async () => {
                          try {
                            await reingestMut.mutateAsync({ id });
                            toast.success("已重新排程抽文");
                            itemQuery.refetch();
                          } catch (err) {
                            toast.error(shortErrorMsg(err, 120));
                          }
                        }}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        重跑
                      </Button>
                    )}
                </div>
                <TranscriptionSection
                  status={item.transcriptionStatus}
                  textContent={item.textContent}
                />
              </section>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {item.speaker && (
                <Pair label="講者" value={item.speaker} />
              )}
              {item.sourceDate && (
                <Pair label="日期" value={formatDateOnly(item.sourceDate)} />
              )}
              {item.sourceLocation && (
                <Pair label="地點" value={item.sourceLocation} />
              )}
              {item.fileSizeBytes != null && (
                <Pair
                  label="檔案大小"
                  value={`${(item.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`}
                />
              )}
              <Pair label="可見範圍" value={visibilityLabel(item.visibility)} />
              <Pair
                label="建立時間"
                value={new Date(item.createdAt).toLocaleString()}
              />
            </dl>

            {item.tags && item.tags.length > 0 && (
              <section>
                <h4 className="text-muted-foreground text-xs mb-1">標籤</h4>
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map(t => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {/* 存取稽核 — 給 owner / team admin 看誰最近碰過這份素材。
                錯誤情況（403）下 useQuery 會 fail，UI 就什麼都不顯示。 */}
            <AccessLogSection materialId={id} />
          </div>

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              刪除
            </Button>
            <Button variant="outline" onClick={onClose}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除這份資料嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              這個動作無法復原。檔案本體仍會保留在儲存空間，只會移除 metadata
              紀錄。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await deleteMut.mutateAsync({ id });
                  toast.success("已刪除");
                  setConfirmingDelete(false);
                  onClose();
                  onMutated();
                } catch (err) {
                  toast.error(shortErrorMsg(err, 120));
                }
              }}
            >
              確定刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FilePreview({
  url,
  mediaType,
  fileName,
}: {
  url: string;
  mediaType: string;
  fileName: string;
}) {
  if (mediaType === "image") {
    return (
      <img
        src={url}
        alt={fileName}
        className="rounded-lg max-h-96 w-auto"
      />
    );
  }
  if (mediaType === "video") {
    return <video src={url} controls className="rounded-lg max-h-96 w-full" />;
  }
  if (mediaType === "audio") {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-primary hover:underline"
    >
      <FileType2 className="w-4 h-4" />
      {fileName}（開新分頁檢視）
    </a>
  );
}

function AccessLogSection({ materialId }: { materialId: number }) {
  const [expanded, setExpanded] = useState(false);
  // 用 enabled gating：使用者主動展開才打 endpoint，省 traffic 也避免每張卡都 403。
  const logQuery = trpc.teachingArchive.accessLog.useQuery(
    { id: materialId, limit: 20 },
    { enabled: expanded, retry: false }
  );

  // 沒權限（403）就完全不顯示這個 section
  if (
    expanded &&
    logQuery.error &&
    logQuery.error.data?.code === "FORBIDDEN"
  ) {
    return null;
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ShieldCheck className="w-3 h-3" />
        {expanded ? "隱藏" : "查看"}存取紀錄
      </button>
      {expanded && (
        <div className="mt-2 rounded-lg border bg-muted/20 p-2 max-h-48 overflow-y-auto text-xs">
          {logQuery.isLoading ? (
            <p className="text-muted-foreground">載入中…</p>
          ) : logQuery.error ? (
            <p className="text-destructive">
              {shortErrorMsg(logQuery.error, 120)}
            </p>
          ) : !logQuery.data || logQuery.data.length === 0 ? (
            <p className="text-muted-foreground">尚無存取紀錄</p>
          ) : (
            <ul className="space-y-1">
              {logQuery.data.map(log => (
                <li
                  key={log.id}
                  className="flex justify-between gap-2 font-mono"
                >
                  <span>
                    使用者 #{log.userId} · {log.action}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function TranscriptionSection({
  status,
  textContent,
}: {
  status: MaterialItem["transcriptionStatus"];
  textContent: string | null;
}) {
  if (status === "not_applicable") {
    return (
      <p className="text-xs text-muted-foreground italic">
        此類型不會自動抽文。
      </p>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === "pending" ? "排隊中…" : "正在抽取，可能需要 1–3 分鐘…"}
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="text-xs text-destructive">
        抽取失敗。可以點右上「重跑」再試。
      </p>
    );
  }
  if (!textContent || textContent.trim().length === 0) {
    return <p className="text-xs text-muted-foreground italic">（無內容）</p>;
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        展開全文（{textContent.length.toLocaleString()} 字）
      </summary>
      <p className="whitespace-pre-wrap leading-relaxed mt-2 max-h-80 overflow-y-auto p-2 rounded bg-muted/30">
        {textContent}
      </p>
    </details>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function visibilityLabel(v: string): string {
  return VISIBILITY_OPTIONS.find(o => o.value === v)?.label ?? v;
}

/**
 * Drizzle `date()` 欄位回來會是 Date 物件（過 superjson）或 'YYYY-MM-DD' 字串
 * （直接走 JSON），統一渲染成 YYYY-MM-DD。
 */
function formatDateOnly(d: string | Date | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ─── 共用 form field 容器 ───────────────────────────────────────────────────
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}
