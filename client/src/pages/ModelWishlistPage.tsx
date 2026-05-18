/**
 * ModelWishlistPage.tsx — 模型許願池
 *
 * 使用者可以許願希望平台支援的 AI 模型，其他人可以投票表態。
 * 管理員可以更新狀態（評估中 / 規劃中 / 已支援 / 不接收）並寫管理備註。
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAIState } from "@/contexts/AIStateContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Plus,
  Sparkles,
  ThumbsUp,
  ExternalLink,
  Trash2,
  ShieldCheck,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────

const MODALITY_OPTIONS: Array<{ value: ModalityValue; label: string }> = [
  { value: "text", label: "文字 / 對話" },
  { value: "image", label: "圖像生成" },
  { value: "video", label: "影片生成" },
  { value: "audio", label: "音樂 / 音效" },
  { value: "voice", label: "語音 / TTS" },
  { value: "3d", label: "3D / 模型" },
  { value: "multimodal", label: "多模態" },
  { value: "embedding", label: "Embedding" },
  { value: "other", label: "其他" },
];

type ModalityValue =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "3d"
  | "multimodal"
  | "embedding"
  | "other";

const MODALITY_LABEL = Object.fromEntries(
  MODALITY_OPTIONS.map(o => [o.value, o.label])
) as Record<ModalityValue, string>;

type StatusValue =
  | "pending"
  | "under_review"
  | "planned"
  | "added"
  | "rejected";

const STATUS_INFO: Record<
  StatusValue,
  { label: string; className: string }
> = {
  pending: {
    label: "待評估",
    className: "bg-muted/40 text-muted-foreground",
  },
  under_review: {
    label: "評估中",
    className: "bg-zen-sky/30 text-blue-700",
  },
  planned: {
    label: "已規劃",
    className: "bg-zen-peach/30 text-amber-700",
  },
  added: {
    label: "已支援",
    className: "bg-zen-sage/30 text-green-700",
  },
  rejected: {
    label: "暫不採納",
    className: "bg-zen-blush/30 text-rose-700",
  },
};

const SORT_OPTIONS = [
  { value: "votes", label: "依票數" },
  { value: "latest", label: "最新優先" },
] as const;

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ModelWishlistPage() {
  const { user, isAuthenticated } = useAuth();
  const { personality } = useAIState();

  const isAdmin = user?.role === "admin";

  const [modalityFilter, setModalityFilter] = useState<ModalityValue | "all">(
    "all"
  );
  const [statusFilter, setStatusFilter] = useState<StatusValue | "all">("all");
  const [sort, setSort] = useState<"votes" | "latest">("votes");

  const [showCreate, setShowCreate] = useState(false);
  const [modelName, setModelName] = useState("");
  const [provider, setProvider] = useState("");
  const [modality, setModality] = useState<ModalityValue>("other");
  const [reason, setReason] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");

  const listQuery = trpc.modelWishes.list.useQuery(
    {
      modality: modalityFilter,
      status: statusFilter,
      sort,
    },
    { retry: false }
  );

  const createWish = trpc.modelWishes.create.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setShowCreate(false);
      setModelName("");
      setProvider("");
      setModality("other");
      setReason("");
      setReferenceUrl("");
      toast.success("已送出許願 ✨");
    },
    onError: e => toast.error(e.message),
  });

  const voteMutation = trpc.modelWishes.vote.useMutation({
    onSuccess: () => listQuery.refetch(),
    onError: e => toast.error(e.message),
  });
  const unvoteMutation = trpc.modelWishes.unvote.useMutation({
    onSuccess: () => listQuery.refetch(),
    onError: e => toast.error(e.message),
  });
  const deleteMutation = trpc.modelWishes.delete.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      toast.success("已刪除許願");
    },
    onError: e => toast.error(e.message),
  });
  const updateStatusMutation = trpc.modelWishes.updateStatus.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      toast.success("狀態已更新");
    },
    onError: e => toast.error(e.message),
  });

  const items = listQuery.data?.items ?? [];
  const totalVotes = useMemo(
    () => items.reduce((sum, w) => sum + (w.voteCount ?? 0), 0),
    [items]
  );

  const canSubmit = modelName.trim().length > 0 && !createWish.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <header className="page-header !mb-0">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-muted-foreground" />
            <h1 className="page-title !mb-0">模型許願池</h1>
          </div>
          <p className="hs-small !mb-0 text-muted-foreground mt-1">
            想要的模型還沒被支援?來許願,讓大家投票把它推上去。
          </p>
        </header>

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button
              className="rounded-xl gap-1.5 text-sm"
              disabled={!isAuthenticated}
              title={isAuthenticated ? "提交一個新的模型許願" : "請先登入再許願"}
            >
              <Plus className="w-4 h-4" /> 我要許願
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>許願一個新模型</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input
                placeholder="模型名稱（例如：GPT-5、Sora 2、Suno v5）"
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                className="rounded-xl"
                maxLength={191}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="廠商（可選）"
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  className="rounded-xl"
                  maxLength={128}
                />
                <Select
                  value={modality}
                  onValueChange={v => setModality(v as ModalityValue)}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="模態" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALITY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder="為什麼想要這個模型?它能解決什麼問題?(可選)"
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="rounded-xl"
                rows={3}
                maxLength={2000}
              />
              <Input
                placeholder="參考連結（可選，例如官方公告 / 論文）"
                value={referenceUrl}
                onChange={e => setReferenceUrl(e.target.value)}
                className="rounded-xl"
                maxLength={2048}
                type="url"
              />
              <Button
                className="w-full rounded-xl"
                onClick={() =>
                  createWish.mutate({
                    modelName: modelName.trim(),
                    provider: provider.trim() || undefined,
                    modality,
                    reason: reason.trim() || undefined,
                    referenceUrl: referenceUrl.trim() || undefined,
                  })
                }
                disabled={!canSubmit}
              >
                {createWish.isPending ? "送出中..." : "送出許願"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={modalityFilter}
          onValueChange={v => setModalityFilter(v as typeof modalityFilter)}
        >
          <SelectTrigger className="rounded-xl w-40">
            <SelectValue placeholder="模態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模態</SelectItem>
            {MODALITY_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={v => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="rounded-xl w-40">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            {(Object.keys(STATUS_INFO) as StatusValue[]).map(s => (
              <SelectItem key={s} value={s}>
                {STATUS_INFO[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={v => setSort(v as typeof sort)}>
          <SelectTrigger className="rounded-xl w-32">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {items.length} 個許願 · 共 {totalVotes} 票
        </div>
      </div>

      {/* List */}
      {listQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <GlassCard key={i} hover={false}>
              <ZenSkeleton lines={3} />
            </GlassCard>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VisualSoul size="lg" personality={personality} />
          <h3 className="hs-h3 !mb-0 mt-6">許願池還是空的</h3>
          <p className="hs-small !mb-0 text-muted-foreground mt-2 max-w-sm">
            想看的模型還沒人提?點「我要許願」第一個發起。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(wish => {
            const statusInfo =
              STATUS_INFO[wish.status as StatusValue] ?? STATUS_INFO.pending;
            const modalityLabel =
              MODALITY_LABEL[wish.modality as ModalityValue] ?? wish.modality;
            const isOwner = user?.id === wish.userId;
            return (
              <motion.div
                key={wish.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard>
                  <div className="flex items-start gap-4">
                    {/* Vote column */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!isAuthenticated) {
                          toast.error("請先登入後再投票");
                          return;
                        }
                        if (wish.hasVoted) {
                          unvoteMutation.mutate({ id: wish.id });
                        } else {
                          voteMutation.mutate({ id: wish.id });
                        }
                      }}
                      disabled={
                        voteMutation.isPending || unvoteMutation.isPending
                      }
                      className={`flex flex-col items-center justify-center min-w-14 rounded-xl px-2 py-2 border transition-colors ${
                        wish.hasVoted
                          ? "bg-zen-peach/30 border-zen-peach text-amber-700"
                          : "bg-muted/30 border-transparent hover:bg-muted/50 text-muted-foreground"
                      }`}
                      title={wish.hasVoted ? "取消投票" : "投我一票"}
                    >
                      <ThumbsUp className="w-4 h-4" />
                      <span className="text-sm font-semibold mt-0.5">
                        {wish.voteCount}
                      </span>
                    </button>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="hs-small !mb-0 font-semibold truncate">
                          {wish.modelName}
                        </p>
                        {wish.provider && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted/30 text-muted-foreground">
                            {wish.provider}
                          </span>
                        )}
                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-zen-sage/20 text-muted-foreground">
                          {modalityLabel}
                        </span>
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${statusInfo.className}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>
                      {wish.reason && (
                        <p className="hs-small !mb-0 text-muted-foreground mt-1.5 whitespace-pre-line">
                          {wish.reason}
                        </p>
                      )}
                      {wish.adminNote && (
                        <div className="mt-2 rounded-lg border border-zen-sage/40 bg-zen-sage/10 px-3 py-2">
                          <div className="flex items-center gap-1 text-[11px] font-medium text-green-800">
                            <ShieldCheck className="w-3 h-3" /> 站方回覆
                          </div>
                          <p className="hs-small !mb-0 text-muted-foreground mt-1 whitespace-pre-line">
                            {wish.adminNote}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] text-muted-foreground">
                        <span>
                          來自 {wish.userName || "匿名使用者"} ·{" "}
                          {new Date(wish.createdAt).toLocaleDateString("zh-TW")}
                        </span>
                        {wish.referenceUrl && (
                          <a
                            href={wish.referenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-zen-sky-foreground hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" /> 參考連結
                          </a>
                        )}
                      </div>

                      {/* Admin controls */}
                      {isAdmin && (
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <Select
                            value={wish.status}
                            onValueChange={v =>
                              updateStatusMutation.mutate({
                                id: wish.id,
                                status: v as StatusValue,
                              })
                            }
                          >
                            <SelectTrigger className="rounded-xl h-8 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(STATUS_INFO) as StatusValue[]).map(
                                s => (
                                  <SelectItem key={s} value={s}>
                                    {STATUS_INFO[s].label}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                          <AdminNoteEditor
                            current={wish.adminNote}
                            onSave={note =>
                              updateStatusMutation.mutate({
                                id: wish.id,
                                status: wish.status as StatusValue,
                                adminNote: note,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>

                    {/* Delete column */}
                    {(isOwner || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `確定要刪除許願「${wish.modelName}」?`
                            )
                          ) {
                            deleteMutation.mutate({ id: wish.id });
                          }
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="刪除許願"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Admin Note Editor ─────────────────────────────────────────────────────

function AdminNoteEditor({
  current,
  onSave,
}: {
  current: string | null;
  onSave: (note: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) setDraft(current ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl h-8 text-xs"
        >
          {current ? "編輯回覆" : "撰寫回覆"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>站方回覆</DialogTitle>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={5}
          maxLength={2000}
          className="rounded-xl"
          placeholder="例如：已加入 Q3 規劃 / 因授權問題暫不支援..."
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              onSave(null);
              setOpen(false);
            }}
          >
            清除
          </Button>
          <Button
            className="rounded-xl"
            onClick={() => {
              onSave(draft.trim() ? draft.trim() : null);
              setOpen(false);
            }}
          >
            儲存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
