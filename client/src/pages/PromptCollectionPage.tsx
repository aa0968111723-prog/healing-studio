/**
 * PromptCollectionPage.tsx — 個人提示詞收集（嵌在 AssetsLibrary 內）
 *
 * 三個 tab：
 *   1) 我的收集    — listMine（含 private 與我 share 出去的）
 *   2) 團隊共享    — listTeam（我所屬 team 的 team_shared）
 *   3) 全站提示詞  — siteCatalog（25 位精靈 / 主動觸發 / 模型樣板 / ImageStudio）
 *
 * 為什麼放在 AssetsLibrary 而非 PromptLibrary：使用者要的是「比照數位資產
 * 的個人收藏 + 團隊共享」模型；PromptLibrary 走的是 isPublic 公開廣場
 * 路線，跟 team_shared 的權限邊界不同。獨立 page 避免兩種語意混在一張 UI 內。
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Plus,
  Search,
  Star,
  Trash2,
  Edit2,
  Copy,
  Globe,
  Lock,
  Sparkles,
  Library,
  Bookmark,
  BookmarkCheck,
  Users,
} from "lucide-react";

const CATEGORIES = [
  { value: "general", label: "🌐 通用" },
  { value: "image", label: "🖼️ 圖像" },
  { value: "video", label: "🎬 影片" },
  { value: "audio", label: "🎵 音訊" },
  { value: "voice", label: "🗣️ 語音" },
  { value: "story", label: "📖 故事" },
  { value: "system", label: "⚙️ 系統" },
] as const;

const SOURCE_TYPE_OPTIONS = [
  { value: "all", label: "全部來源" },
  { value: "agent_role", label: "🤖 精靈角色" },
  { value: "proactive_trigger", label: "💬 主動觸發" },
  { value: "model_template", label: "🎯 模型樣板" },
  { value: "image_studio", label: "🎨 ImageStudio" },
  { value: "manual", label: "✍️ 自輸入" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];
type Tab = "mine" | "team" | "catalog";
type SourceTypeFilter = (typeof SOURCE_TYPE_OPTIONS)[number]["value"];

interface ManualForm {
  title: string;
  content: string;
  category: Category;
  tags: string;
  notes: string;
}

const EMPTY_MANUAL: ManualForm = {
  title: "",
  content: "",
  category: "general",
  tags: "",
  notes: "",
};

interface EditForm {
  id: number;
  title: string;
  content: string;
  category: Category;
  tags: string;
  notes: string;
}

export default function PromptCollectionPage() {
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [filterSource, setFilterSource] = useState<SourceTypeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filterTeam, setFilterTeam] = useState<number | "all">("all");
  const [page, setPage] = useState(1);

  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualForm>(EMPTY_MANUAL);

  const [editTarget, setEditTarget] = useState<EditForm | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    id: number;
    title: string;
    currentVisibility: "private" | "team_shared";
    currentTeamId: number | null;
  } | null>(null);

  const utils = trpc.useUtils();
  const teamsQuery = trpc.teams.list.useQuery();

  const mineQuery = trpc.promptCollection.listMine.useQuery(
    {
      page,
      pageSize: 20,
      search: search || undefined,
      category: filterCategory !== "all" ? filterCategory : undefined,
      sourceType: filterSource !== "all" ? filterSource : undefined,
      favoritesOnly: favoritesOnly || undefined,
    },
    { enabled: tab === "mine" }
  );

  const teamQuery = trpc.promptCollection.listTeam.useQuery(
    {
      page,
      pageSize: 20,
      teamId: filterTeam !== "all" ? filterTeam : undefined,
      search: search || undefined,
      category: filterCategory !== "all" ? filterCategory : undefined,
      sourceType: filterSource !== "all" ? filterSource : undefined,
    },
    { enabled: tab === "team" }
  );

  const catalogQuery = trpc.promptCollection.siteCatalog.useQuery(
    {
      search: search || undefined,
      sourceType: filterSource !== "all" ? filterSource : undefined,
    },
    { enabled: tab === "catalog" }
  );

  const invalidateAll = () => {
    utils.promptCollection.listMine.invalidate();
    utils.promptCollection.listTeam.invalidate();
    utils.promptCollection.siteCatalog.invalidate();
  };

  const collectMut = trpc.promptCollection.collect.useMutation({
    onSuccess: () => {
      toast.success("已加入收集");
      invalidateAll();
    },
    onError: err => toast.error(`收集失敗：${err.message}`),
  });

  const updateMut = trpc.promptCollection.update.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      setEditTarget(null);
      invalidateAll();
    },
    onError: err => toast.error(`更新失敗：${err.message}`),
  });

  const deleteMut = trpc.promptCollection.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      invalidateAll();
    },
    onError: err => toast.error(`刪除失敗：${err.message}`),
  });

  const toggleFavMut = trpc.promptCollection.toggleFavorite.useMutation({
    onSuccess: () => invalidateAll(),
    onError: err => toast.error(`操作失敗：${err.message}`),
  });

  const incUseMut = trpc.promptCollection.incrementUseCount.useMutation();

  const setVisMut = trpc.promptCollection.setVisibility.useMutation({
    onSuccess: () => {
      toast.success("已更新分享狀態");
      setShareTarget(null);
      invalidateAll();
    },
    onError: err => toast.error(`分享失敗：${err.message}`),
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleCopy = (content: string, id: number) => {
    void copyToClipboard(content, "已複製到剪貼簿");
    incUseMut.mutate({ id });
  };

  const handleCollectManual = () => {
    if (!manualForm.title.trim() || !manualForm.content.trim()) {
      toast.error("標題與內容不可空白");
      return;
    }
    collectMut.mutate(
      {
        sourceType: "manual",
        title: manualForm.title.trim(),
        content: manualForm.content,
        category: manualForm.category,
        tags: manualForm.tags
          .split(",")
          .map(t => t.trim())
          .filter(Boolean),
        notes: manualForm.notes || undefined,
      },
      {
        onSuccess: () => {
          setIsManualOpen(false);
          setManualForm(EMPTY_MANUAL);
        },
      }
    );
  };

  const handleUpdate = () => {
    if (!editTarget) return;
    updateMut.mutate({
      id: editTarget.id,
      title: editTarget.title,
      content: editTarget.content,
      category: editTarget.category,
      tags: editTarget.tags
        .split(",")
        .map(t => t.trim())
        .filter(Boolean),
      notes: editTarget.notes || undefined,
    });
  };

  const handleShare = (visibility: "private" | "team_shared", teamId?: number) => {
    if (!shareTarget) return;
    setVisMut.mutate({
      id: shareTarget.id,
      visibility,
      teamId,
    });
  };

  // ─── Derived state ───────────────────────────────────────────────────────

  const teams = teamsQuery.data ?? [];

  const mineItems = mineQuery.data?.items ?? [];
  const teamItems = teamQuery.data?.items ?? [];
  const catalogItems = catalogQuery.data?.entries ?? [];

  const isLoading =
    tab === "mine"
      ? mineQuery.isLoading
      : tab === "team"
        ? teamQuery.isLoading
        : catalogQuery.isLoading;

  const mineTotalPages = mineQuery.data?.totalPages ?? 1;
  const teamTotalPages = teamQuery.data?.totalPages ?? 1;
  const showPagination = tab !== "catalog";
  const totalPages = tab === "mine" ? mineTotalPages : teamTotalPages;

  // 同一筆 prompt 在 catalog 是否「已被使用者收過」— siteCatalog 已附帶
  // alreadyCollected boolean，這層只是把布林反白用。
  const catalogCollected = useMemo(
    () => new Set(catalogItems.filter(c => c.alreadyCollected).map(c => `${c.sourceType}::${c.sourceRef}`)),
    [catalogItems]
  );

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="page-eyebrow">Prompt Collection</p>
          <h1 className="page-title flex items-center gap-2 !mb-0">
            <Bookmark className="w-6 h-6 text-primary" />
            個人提示詞收集
          </h1>
          <p className="page-subtitle mt-1">
            把全站可重用的提示詞（精靈系統提示、主動觸發、模型樣板、ImageStudio 模板）收進來，
            可選擇分享給團隊。
          </p>
        </div>
        <Dialog
          open={isManualOpen}
          onOpenChange={open => {
            setIsManualOpen(open);
            if (!open) setManualForm(EMPTY_MANUAL);
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> 自輸入提示詞
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>手動加入一段提示詞</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>標題</Label>
                <Input
                  value={manualForm.title}
                  onChange={e =>
                    setManualForm(f => ({ ...f, title: e.target.value }))
                  }
                  placeholder="為這段提示詞取個名字"
                />
              </div>
              <div>
                <Label>內容</Label>
                <Textarea
                  rows={6}
                  value={manualForm.content}
                  onChange={e =>
                    setManualForm(f => ({ ...f, content: e.target.value }))
                  }
                  placeholder="貼上完整提示詞…"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>分類</Label>
                  <Select
                    value={manualForm.category}
                    onValueChange={v =>
                      setManualForm(f => ({ ...f, category: v as Category }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>標籤 (逗號分隔)</Label>
                  <Input
                    value={manualForm.tags}
                    onChange={e =>
                      setManualForm(f => ({ ...f, tags: e.target.value }))
                    }
                    placeholder="電影感, 寫實"
                  />
                </div>
              </div>
              <div>
                <Label>備註（為何收這條）</Label>
                <Textarea
                  rows={2}
                  value={manualForm.notes}
                  onChange={e =>
                    setManualForm(f => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="選填：之後想搜尋時的關鍵字"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setIsManualOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleCollectManual} disabled={collectMut.isPending}>
                  收進來
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => {
            setTab("mine");
            setPage(1);
          }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "mine"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Lock className="w-3.5 h-3.5" /> 我的收集
        </button>
        <button
          onClick={() => {
            setTab("team");
            setPage(1);
          }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "team"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="w-3.5 h-3.5" /> 團隊共享
        </button>
        <button
          onClick={() => {
            setTab("catalog");
            setPage(1);
          }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "catalog"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" /> 全站提示詞
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={
              tab === "catalog"
                ? "搜尋全站提示詞…"
                : "搜尋標題…"
            }
            className="pl-9"
          />
        </div>
        <Select
          value={filterSource}
          onValueChange={v => {
            setFilterSource(v as SourceTypeFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tab !== "catalog" && (
          <Select
            value={filterCategory}
            onValueChange={v => {
              setFilterCategory(v as Category | "all");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="所有分類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有分類</SelectItem>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tab === "team" && teams.length > 0 && (
          <Select
            value={String(filterTeam)}
            onValueChange={v => {
              setFilterTeam(v === "all" ? "all" : Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="所有團隊" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有團隊</SelectItem>
              {teams.map(t => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tab === "mine" && (
          <Button
            variant={favoritesOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFavoritesOnly(v => !v);
              setPage(1);
            }}
            className="gap-1.5"
          >
            <Star className="w-3.5 h-3.5" />
            只看收藏
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : tab === "catalog" ? (
        catalogItems.length === 0 ? (
          <EmptyState
            icon={<Library className="w-12 h-12 mx-auto mb-3 opacity-30" />}
            title="沒有符合條件的站內提示詞"
            description="試試清空搜尋或切換來源篩選"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {catalogItems.map(entry => {
              const key = `${entry.sourceType}::${entry.sourceRef}`;
              const collected = catalogCollected.has(key);
              return (
                <CatalogCard
                  key={key}
                  entry={entry}
                  collected={collected}
                  pending={collectMut.isPending}
                  onCollect={() =>
                    collectMut.mutate({
                      sourceType: entry.sourceType as
                        | "agent_role"
                        | "proactive_trigger"
                        | "model_template"
                        | "image_studio"
                        | "site_prompt",
                      sourceRef: entry.sourceRef,
                    })
                  }
                  onCopy={() => {
                    void copyToClipboard(entry.content, "已複製到剪貼簿");
                  }}
                />
              );
            })}
          </div>
        )
      ) : tab === "mine" ? (
        mineItems.length === 0 ? (
          <EmptyState
            icon={<Bookmark className="w-12 h-12 mx-auto mb-3 opacity-30" />}
            title="還沒有收集任何提示詞"
            description="從「全站提示詞」分頁點 + 加入，或自輸入一段。"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mineItems.map(item => (
              <CollectionCard
                key={item.id}
                item={item}
                isOwn
                onCopy={() => handleCopy(item.content, item.id)}
                onEdit={() =>
                  setEditTarget({
                    id: item.id,
                    title: item.title,
                    content: item.content,
                    category: item.category as Category,
                    tags: (item.tags ?? []).join(", "),
                    notes: item.notes ?? "",
                  })
                }
                onDelete={() => {
                  if (confirm("確定要刪除這條收集？")) {
                    deleteMut.mutate({ id: item.id });
                  }
                }}
                onToggleFav={() => toggleFavMut.mutate({ id: item.id })}
                onShare={() =>
                  setShareTarget({
                    id: item.id,
                    title: item.title,
                    currentVisibility: item.visibility,
                    currentTeamId: item.teamId ?? null,
                  })
                }
              />
            ))}
          </div>
        )
      ) : teamItems.length === 0 ? (
        <EmptyState
          icon={<Users className="w-12 h-12 mx-auto mb-3 opacity-30" />}
          title="團隊還沒有任何共享提示詞"
          description={
            teams.length === 0
              ? "你還沒有加入任何團隊，到「團隊」頁面建立或受邀加入後就能在這裡看見共享提示詞。"
              : "請團隊成員把私人收集切成「團隊共享」，這裡就會出現。"
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teamItems.map(item => (
            <CollectionCard
              key={item.id}
              item={item}
              isOwn={false}
              onCopy={() => handleCopy(item.content, item.id)}
              onEdit={() => {}}
              onDelete={() => {}}
              onToggleFav={() => {}}
              onShare={() => {}}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {showPagination && totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            上一頁
          </Button>
          <span className="text-sm text-muted-foreground flex items-center px-2">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            下一頁
          </Button>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={open => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>編輯收集</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-3">
              <div>
                <Label>標題</Label>
                <Input
                  value={editTarget.title}
                  onChange={e =>
                    setEditTarget(t => (t ? { ...t, title: e.target.value } : t))
                  }
                />
              </div>
              <div>
                <Label>內容</Label>
                <Textarea
                  rows={6}
                  value={editTarget.content}
                  onChange={e =>
                    setEditTarget(t =>
                      t ? { ...t, content: e.target.value } : t
                    )
                  }
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>分類</Label>
                  <Select
                    value={editTarget.category}
                    onValueChange={v =>
                      setEditTarget(t =>
                        t ? { ...t, category: v as Category } : t
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>標籤</Label>
                  <Input
                    value={editTarget.tags}
                    onChange={e =>
                      setEditTarget(t =>
                        t ? { ...t, tags: e.target.value } : t
                      )
                    }
                  />
                </div>
              </div>
              <div>
                <Label>備註</Label>
                <Textarea
                  rows={2}
                  value={editTarget.notes}
                  onChange={e =>
                    setEditTarget(t =>
                      t ? { ...t, notes: e.target.value } : t
                    )
                  }
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setEditTarget(null)}>
                  取消
                </Button>
                <Button onClick={handleUpdate} disabled={updateMut.isPending}>
                  儲存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Share dialog */}
      <Dialog
        open={shareTarget !== null}
        onOpenChange={open => {
          if (!open) setShareTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>分享給團隊</DialogTitle>
          </DialogHeader>
          {shareTarget && (
            <ShareDialogContent
              target={shareTarget}
              teams={teams}
              pending={setVisMut.isPending}
              onClose={() => setShareTarget(null)}
              onConfirm={handleShare}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-20 text-muted-foreground">
      {icon}
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm mt-1 max-w-md mx-auto">{description}</p>
    </div>
  );
}

interface CatalogCardProps {
  entry: {
    sourceType: string;
    sourceRef: string;
    title: string;
    content: string;
    sourceLabel: string;
    category: string;
    tags: string[];
    description?: string;
  };
  collected: boolean;
  pending: boolean;
  onCollect: () => void;
  onCopy: () => void;
}

function CatalogCard({
  entry,
  collected,
  pending,
  onCollect,
  onCopy,
}: CatalogCardProps) {
  const catLabel =
    CATEGORIES.find(c => c.value === entry.category)?.label ?? entry.category;
  return (
    <div className="group relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight">{entry.title}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {entry.sourceLabel}
            </Badge>
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {catLabel}
            </Badge>
          </div>
        </div>
      </div>
      {entry.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {entry.description}
        </p>
      )}
      <p className="text-xs text-muted-foreground line-clamp-4 leading-relaxed font-mono bg-muted/50 rounded-lg p-2">
        {entry.content}
      </p>
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded-full"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-auto">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onCopy}
        >
          <Copy className="w-3.5 h-3.5" /> 複製
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={collected || pending}
          onClick={onCollect}
        >
          {collected ? (
            <>
              <BookmarkCheck className="w-3.5 h-3.5" /> 已收集
            </>
          ) : (
            <>
              <Bookmark className="w-3.5 h-3.5" /> 加入收集
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

interface CollectionCardItem {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string[] | null;
  notes: string | null;
  isFavorite: boolean;
  visibility: "private" | "team_shared";
  teamId: number | null;
  useCount: number;
  sourceType: string;
  sourceRef: string | null;
  sourceLabel: string | null;
}

interface CollectionCardProps {
  item: CollectionCardItem;
  isOwn: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFav: () => void;
  onShare: () => void;
}

function CollectionCard({
  item,
  isOwn,
  onCopy,
  onEdit,
  onDelete,
  onToggleFav,
  onShare,
}: CollectionCardProps) {
  const catLabel =
    CATEGORIES.find(c => c.value === item.category)?.label ?? item.category;

  return (
    <div className="group relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight">{item.title}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {catLabel}
            </Badge>
            {item.sourceLabel && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {item.sourceLabel}
              </Badge>
            )}
            {item.visibility === "team_shared" ? (
              <span title="團隊共享" className="text-emerald-500">
                <Users className="w-3 h-3" />
              </span>
            ) : (
              <Lock className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
        </div>
        {isOwn && (
          <button onClick={onToggleFav} className="shrink-0 mt-0.5">
            <Star
              className={`w-4 h-4 transition-colors ${
                item.isFavorite
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground hover:text-yellow-400"
              }`}
            />
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed font-mono bg-muted/50 rounded-lg p-2">
        {item.content}
      </p>
      {item.notes && (
        <p className="text-xs italic text-muted-foreground line-clamp-2">
          備註：{item.notes}
        </p>
      )}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded-full"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-auto">
        <span className="text-xs text-muted-foreground">
          複製過 {item.useCount} 次
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCopy}
            title="複製"
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          {isOwn && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onShare}
                title={
                  item.visibility === "team_shared" ? "改為私人" : "分享給團隊"
                }
              >
                {item.visibility === "team_shared" ? (
                  <Users className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Globe className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onEdit}
                title="編輯"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                onClick={onDelete}
                title="刪除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ShareDialogContentProps {
  target: {
    id: number;
    title: string;
    currentVisibility: "private" | "team_shared";
    currentTeamId: number | null;
  };
  teams: Array<{ id: number; name: string; role: string }>;
  pending: boolean;
  onClose: () => void;
  onConfirm: (visibility: "private" | "team_shared", teamId?: number) => void;
}

function ShareDialogContent({
  target,
  teams,
  pending,
  onClose,
  onConfirm,
}: ShareDialogContentProps) {
  const [selected, setSelected] = useState<number | null>(target.currentTeamId);
  const [shareOn, setShareOn] = useState(target.currentVisibility === "team_shared");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        將「{target.title}」分享給你所屬團隊的成員。改為私人後，僅你自己看得到。
      </p>
      <div className="flex items-center gap-2">
        <Switch checked={shareOn} onCheckedChange={setShareOn} />
        <Label className="cursor-pointer" onClick={() => setShareOn(v => !v)}>
          {shareOn ? "分享給團隊" : "保持私人"}
        </Label>
      </div>
      {shareOn && (
        <div>
          <Label>選擇團隊</Label>
          {teams.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              你還沒有加入任何團隊。請先到「團隊」頁面建立或受邀。
            </p>
          ) : (
            <Select
              value={selected !== null ? String(selected) : ""}
              onValueChange={v => setSelected(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="挑一個團隊" />
              </SelectTrigger>
              <SelectContent>
                {teams.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={pending || (shareOn && (selected === null || teams.length === 0))}
          onClick={() => {
            if (shareOn && selected !== null) {
              onConfirm("team_shared", selected);
            } else {
              onConfirm("private");
            }
          }}
        >
          確認
        </Button>
      </div>
    </div>
  );
}
