/**
 * TeachingArchive.tsx — 法脈傳承教材庫（Phase 1 of training-data feature）
 *
 * 讓使用者上傳師父開示、共修錄音、社課 PPT、法相照片等素材，依「法脈 / 來源 /
 * 主題」分類，未來會被 Phase 2 的 RAG ingestion 切片並做向量檢索。
 */

import { useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { uploadFileToS3, shortErrorMsg } from "@/lib/upload";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

// ─── 常數 — 與 server/routers/teachingArchive.ts 保持同步 ────────────────────

const MEDIA_TYPES = [
  { value: "text", label: "文字開示", icon: FileText, hint: "直接輸入文字，不需上傳" },
  { value: "pdf", label: "PDF", icon: FileType2, hint: "開示稿、講義" },
  { value: "document", label: "Word / TXT", icon: FileText, hint: "Word/純文字/Markdown" },
  { value: "image", label: "圖片", icon: ImageIcon, hint: "法相、活動照片" },
  { value: "video", label: "影片", icon: Film, hint: "開示影片" },
  { value: "audio", label: "語音 / 錄音", icon: Music, hint: "共修錄音、講座音檔" },
  { value: "presentation", label: "簡報", icon: Presentation, hint: "PPT / PPTX" },
] as const;

type MediaType = (typeof MEDIA_TYPES)[number]["value"];

const SOURCE_TYPES: Array<{ value: SourceType; label: string }> = [
  { value: "discourse", label: "開示" },
  { value: "group_practice", label: "共修" },
  { value: "class", label: "社課" },
  { value: "ceremony", label: "法會" },
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
  { value: "public_disciples", label: "弟子可見" },
];

type Visibility = "private" | "team_shared" | "public_disciples";

const DEFAULT_SPEAKER = "悟覺妙天禪師";

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
  }>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.teachingArchive.list.useQuery(
    {
      mediaType: filters.mediaType,
      sourceType: filters.sourceType,
      lineage: filters.lineage,
      topic: filters.topic,
      search: filters.search?.trim() || undefined,
    },
    { staleTime: 5_000 }
  );
  const lineagesQuery = trpc.teachingArchive.lineages.useQuery();
  const topicsQuery = trpc.teachingArchive.topics.useQuery();

  const items = listQuery.data ?? [];

  return (
    <div className="page-shell space-y-6">
      <header className="page-header">
        <p className="page-eyebrow">Teaching Archive</p>
        <h1 className="page-title flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          法脈傳承教材庫
        </h1>
        <p className="page-subtitle">
          上傳師父開示、共修錄音、社課 PPT、法相照片等素材，依法脈與主題分類保存。
          未來會接上 RAG 檢索，讓 AI 助理直接引用師父的話回答。
        </p>
      </header>

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
            placeholder="例：印心禪法、生活禪"
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
          label="法脈"
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
        <Button onClick={() => setUploadOpen(true)} className="ml-auto">
          <Plus className="w-4 h-4 mr-1" />
          新增教材
        </Button>
      </div>

      {/* 清單 */}
      {listQuery.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>還沒有任何教材。點右上「新增教材」開始建立法脈典藏。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <MaterialCard
              key={item.id}
              item={item}
              onClick={() => setDetailId(item.id)}
            />
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={() => {
          listQuery.refetch();
          lineagesQuery.refetch();
          topicsQuery.refetch();
        }}
      />

      {detailId !== null && (
        <DetailDialog
          id={detailId}
          onClose={() => setDetailId(null)}
          onMutated={() => {
            listQuery.refetch();
            lineagesQuery.refetch();
            topicsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── 子元件：過濾下拉 ──────────────────────────────────────────────────────

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
  onClick,
}: {
  item: MaterialItem;
  onClick: () => void;
}) {
  const Icon = getMediaIcon(item.mediaType);
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card hover:shadow-md transition-shadow p-4 space-y-2"
    >
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

// ─── 子元件：上傳 / 新增 Dialog ────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    mediaType: "text" as MediaType,
    textContent: "",
    lineage: "",
    sourceType: "discourse" as SourceType,
    sourceDate: "",
    sourceLocation: "",
    topic: "",
    speaker: DEFAULT_SPEAKER,
    tagsInput: "",
    visibility: "private" as Visibility,
  });
  const [pickedFile, setPickedFile] = useState<File | null>(null);

  const createMut = trpc.teachingArchive.create.useMutation();

  function reset() {
    setForm({
      title: "",
      description: "",
      mediaType: "text",
      textContent: "",
      lineage: "",
      sourceType: "discourse",
      sourceDate: "",
      sourceLocation: "",
      topic: "",
      speaker: DEFAULT_SPEAKER,
      tagsInput: "",
      visibility: "private",
    });
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast.error("請輸入標題");
      return;
    }
    if (form.mediaType === "text") {
      if (!form.textContent.trim()) {
        toast.error("文字開示需要填寫內文");
        return;
      }
    } else if (!pickedFile) {
      toast.error("請選擇要上傳的檔案");
      return;
    }

    setSubmitting(true);
    try {
      let fileMeta:
        | {
            fileUrl: string;
            fileKey: string;
            fileName: string;
            mimeType: string;
            fileSizeBytes: number;
          }
        | undefined;
      if (pickedFile) {
        const { url, fileKey } = await uploadFileToS3(pickedFile);
        fileMeta = {
          fileUrl: url,
          fileKey,
          fileName: pickedFile.name,
          mimeType: pickedFile.type,
          fileSizeBytes: pickedFile.size,
        };
      }

      const tags = form.tagsInput
        .split(/[,，、\s]+/)
        .map(t => t.trim())
        .filter(Boolean);

      await createMut.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        mediaType: form.mediaType,
        textContent:
          form.textContent.trim() || undefined,
        lineage: form.lineage.trim() || undefined,
        sourceType: form.sourceType,
        sourceDate: form.sourceDate || undefined,
        sourceLocation: form.sourceLocation.trim() || undefined,
        topic: form.topic.trim() || undefined,
        speaker: form.speaker.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        visibility: form.visibility,
        ...(fileMeta ?? {}),
      });

      toast.success("教材已新增");
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(shortErrorMsg(err, 120));
    } finally {
      setSubmitting(false);
    }
  }

  const accept = ACCEPT_BY_MEDIA[form.mediaType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增教材</DialogTitle>
          <DialogDescription>
            純文字開示可直接輸入內容；其他類型需先上傳檔案。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="標題" required>
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="例：印心禪法初階開示"
            />
          </Field>

          <Field label="描述">
            <Textarea
              value={form.description}
              onChange={e =>
                setForm(f => ({ ...f, description: e.target.value }))
              }
              placeholder="簡短描述這份教材的內容、緣起或重點"
              rows={2}
            />
          </Field>

          <Field label="檔案類型" required>
            <Select
              value={form.mediaType}
              onValueChange={v => {
                setForm(f => ({ ...f, mediaType: v as MediaType }));
                setPickedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_TYPES.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label} — <span className="text-muted-foreground">{m.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.mediaType === "text" ? (
            <Field label="開示內文" required>
              <Textarea
                value={form.textContent}
                onChange={e =>
                  setForm(f => ({ ...f, textContent: e.target.value }))
                }
                placeholder="直接貼上師父的開示文字……"
                rows={8}
              />
            </Field>
          ) : (
            <Field label="檔案" required>
              <Input
                ref={fileInputRef}
                type="file"
                accept={accept}
                onChange={e => setPickedFile(e.target.files?.[0] ?? null)}
              />
              {pickedFile && (
                <p className="text-xs text-muted-foreground mt-1">
                  已選：{pickedFile.name} ·{" "}
                  {(pickedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                上限：圖片 10MB、語音 20MB、影片 40MB、PDF 12MB、簡報/Word 25MB
              </p>
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="法脈">
              <Input
                value={form.lineage}
                onChange={e => setForm(f => ({ ...f, lineage: e.target.value }))}
                placeholder="例：悟覺妙天禪師、印心禪法"
              />
            </Field>
            <Field label="來源類型">
              <Select
                value={form.sourceType}
                onValueChange={v =>
                  setForm(f => ({ ...f, sourceType: v as SourceType }))
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
            <Field label="開示日期">
              <Input
                type="date"
                value={form.sourceDate}
                onChange={e =>
                  setForm(f => ({ ...f, sourceDate: e.target.value }))
                }
              />
            </Field>
            <Field label="講授地點">
              <Input
                value={form.sourceLocation}
                onChange={e =>
                  setForm(f => ({ ...f, sourceLocation: e.target.value }))
                }
                placeholder="例：台北道場"
              />
            </Field>
            <Field label="主題">
              <Input
                value={form.topic}
                onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                placeholder="例：禪修方法、生活禪"
              />
            </Field>
            <Field label="講者">
              <Input
                value={form.speaker}
                onChange={e => setForm(f => ({ ...f, speaker: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="標籤（以逗號、頓號或空白分隔）">
            <Input
              value={form.tagsInput}
              onChange={e =>
                setForm(f => ({ ...f, tagsInput: e.target.value }))
              }
              placeholder="入門, 心法, 共修"
            />
          </Field>

          <Field label="可見範圍">
            <Select
              value={form.visibility}
              onValueChange={v =>
                setForm(f => ({ ...f, visibility: v as Visibility }))
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
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
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
                上傳中…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                儲存
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
  const itemQuery = trpc.teachingArchive.get.useQuery({ id });
  const deleteMut = trpc.teachingArchive.delete.useMutation();
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
            <AlertDialogTitle>確定要刪除這份教材嗎？</AlertDialogTitle>
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
