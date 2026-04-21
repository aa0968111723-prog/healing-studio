/**
 * PromptLibraryPage.tsx — 提示詞庫頁面
 * 路由：/prompt-library
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Star,
  Trash2,
  Edit2,
  Copy,
  Globe,
  Lock,
  Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "general", label: "🌐 通用" },
  { value: "image", label: "🖼️ 圖像" },
  { value: "video", label: "🎬 影片" },
  { value: "audio", label: "🎵 音訊" },
  { value: "voice", label: "🗣️ 語音" },
  { value: "story", label: "📖 故事" },
  { value: "system", label: "⚙️ 系統" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

interface PromptForm {
  title: string;
  content: string;
  category: Category;
  tags: string;
  isPublic: boolean;
  modelHint: string;
}

const EMPTY_FORM: PromptForm = {
  title: "",
  content: "",
  category: "general",
  tags: "",
  isPublic: false,
  modelHint: "",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PromptLibraryPage() {
  const [tab, setTab] = useState<"mine" | "public">("mine");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [form, setForm] = useState<PromptForm>(EMPTY_FORM);

  // ── tRPC ──────────────────────────────────────────────────────────────────

  const listQuery = trpc.promptLibrary.list.useQuery(
    {
      page,
      pageSize: 20,
      search: search || undefined,
      category: filterCategory !== "all" ? filterCategory : undefined,
      favoritesOnly: favoritesOnly || undefined,
    },
    { enabled: tab === "mine" }
  );

  const publicQuery = trpc.promptLibrary.listPublic.useQuery(
    {
      page,
      pageSize: 20,
      search: search || undefined,
      category: filterCategory !== "all" ? filterCategory : undefined,
    },
    { enabled: tab === "public" }
  );

  const utils = trpc.useUtils();

  const createMut = trpc.promptLibrary.create.useMutation({
    onSuccess: () => {
      toast.success("提示詞已新增");
      setIsCreateOpen(false);
      setForm(EMPTY_FORM);
      utils.promptLibrary.list.invalidate();
    },
    onError: err => toast.error(`新增失敗：${err.message}`),
  });

  const updateMut = trpc.promptLibrary.update.useMutation({
    onSuccess: () => {
      toast.success("提示詞已更新");
      setEditTarget(null);
      setForm(EMPTY_FORM);
      utils.promptLibrary.list.invalidate();
    },
    onError: err => toast.error(`更新失敗：${err.message}`),
  });

  const deleteMut = trpc.promptLibrary.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.promptLibrary.list.invalidate();
    },
    onError: err => toast.error(`刪除失敗：${err.message}`),
  });

  const toggleFavMut = trpc.promptLibrary.toggleFavorite.useMutation({
    onSuccess: () => utils.promptLibrary.list.invalidate(),
    onError: err => toast.error(`操作失敗：${err.message}`),
  });

  const incUseMut = trpc.promptLibrary.incrementUseCount.useMutation();

  // ─── PageAgent 註冊（Phase 4a：提示詞庫接入光球） ────────────────────────
  // 光球可幫使用者：切 mine/public 分頁、挑分類、搜尋、切只看收藏、清空條件。
  const TAB_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "mine", label: "我的", meta: { bestFor: "個人模板沉澱", tip: "先整理高成功率模板" } },
      { id: "public", label: "公開", meta: { bestFor: "靈感探索", tip: "先借鑑結構再客製化" } },
    ],
    []
  );
  const CATEGORY_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "all", label: "全部分類", meta: { bestFor: "跨任務比對", tip: "觀察不同類型 prompt 結構差異" } },
      ...CATEGORIES.map(c => ({
        id: c.value,
        label: c.label,
        meta: {
          bestFor: c.label,
          tip: "可搭配負向詞與參數模板一起保存",
        },
      })),
    ],
    []
  );
  const agentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換分頁",
        currentId: tab,
        options: TAB_OPTIONS,
        hint: "切換我的提示詞 / 公開提示詞",
      },
      {
        action: "setParam",
        label: "分類 / 搜尋 / 只看收藏",
        hint: "setParam key='category' value=<id>；key='search' value=<關鍵字>；key='favoritesOnly' value=true|false",
      },
      {
        action: "reset",
        label: "清空條件",
        hint: "分類還原 all、搜尋清空、favoritesOnly=false、page=1",
      },
    ],
    [tab, TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "prompt-library",
    pageLabel: "提示詞庫",
    pagePath: "/prompt-library",
    capabilities: agentCapabilities,
    state: {
      tab,
      filterCategory,
      search,
      favoritesOnly,
      page,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          if (action.tabId !== "mine" && action.tabId !== "public") {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setTab(action.tabId);
          setPage(1);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "setParam": {
          if (action.key === "search") {
            setSearch(typeof action.value === "string" ? action.value : "");
            setPage(1);
            return { ok: true, message: "已套用搜尋" };
          }
          if (action.key === "category") {
            const allowed = ["all", ...CATEGORIES.map(c => c.value)];
            const v = String(action.value ?? "");
            if (!allowed.includes(v)) {
              return { ok: false, reason: `unknown category: ${v}` };
            }
            setFilterCategory(v as Category | "all");
            setPage(1);
            return { ok: true, message: `分類切到「${v}」` };
          }
          if (action.key === "favoritesOnly") {
            setFavoritesOnly(Boolean(action.value));
            setPage(1);
            return { ok: true, message: "已套用收藏篩選" };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "reset": {
          setFilterCategory("all");
          setSearch("");
          setFavoritesOnly(false);
          setPage(1);
          return { ok: true, message: "已清空條件" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on prompt-library: ${action.type}`,
          };
      }
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleCopy(content: string, id: number) {
    navigator.clipboard.writeText(content);
    toast.success("提示詞已複製到剪貼簿");
    incUseMut.mutate({ id });
  }

  function handleSubmit() {
    const tags = form.tags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    if (editTarget !== null) {
      updateMut.mutate({
        id: editTarget,
        title: form.title,
        content: form.content,
        category: form.category,
        tags,
        isPublic: form.isPublic,
        modelHint: form.modelHint || undefined,
      });
    } else {
      createMut.mutate({
        title: form.title,
        content: form.content,
        category: form.category,
        tags,
        isPublic: form.isPublic,
        modelHint: form.modelHint || undefined,
      });
    }
  }

  function openEdit(item: {
    id: number;
    title: string;
    content: string;
    category: string;
    tags: string[] | null;
    isPublic: boolean;
    modelHint: string | null;
  }) {
    setEditTarget(item.id);
    setForm({
      title: item.title,
      content: item.content,
      category: item.category as Category,
      tags: (item.tags ?? []).join(", "),
      isPublic: item.isPublic,
      modelHint: item.modelHint ?? "",
    });
    setIsCreateOpen(true);
  }

  const items = tab === "mine" ? listQuery.data?.items ?? [] : publicQuery.data?.items ?? [];
  const totalPages =
    tab === "mine" ? listQuery.data?.totalPages ?? 1 : publicQuery.data?.totalPages ?? 1;
  const isLoading = tab === "mine" ? listQuery.isLoading : publicQuery.isLoading;

  // ─── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            提示詞庫
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理、收藏、分享你的 AI 提示詞
          </p>
        </div>
        <Dialog
          open={isCreateOpen}
          onOpenChange={open => {
            setIsCreateOpen(open);
            if (!open) {
              setEditTarget(null);
              setForm(EMPTY_FORM);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              新增提示詞
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editTarget !== null ? "編輯提示詞" : "新增提示詞"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>標題</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="為這個提示詞取個名字"
                />
              </div>
              <div>
                <Label>提示詞內容</Label>
                <Textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="輸入完整的提示詞…"
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>分類</Label>
                  <Select
                    value={form.category}
                    onValueChange={v => setForm(f => ({ ...f, category: v as Category }))}
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
                  <Label>建議模型（選填）</Label>
                  <Input
                    value={form.modelHint}
                    onChange={e => setForm(f => ({ ...f, modelHint: e.target.value }))}
                    placeholder="e.g. fal-ai/wan"
                  />
                </div>
              </div>
              <div>
                <Label>標籤（逗號分隔）</Label>
                <Input
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="e.g. 電影感, 寫實, 高品質"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isPublic}
                  onCheckedChange={v => setForm(f => ({ ...f, isPublic: v }))}
                />
                <Label>公開分享（其他用戶可在廣場看到）</Label>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!form.title || !form.content || createMut.isPending || updateMut.isPending}
                >
                  {editTarget !== null ? "更新" : "新增"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-4 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab("mine"); setPage(1); }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "mine" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          我的提示詞
        </button>
        <button
          onClick={() => { setTab("public"); setPage(1); }}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "public" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Globe className="w-3.5 h-3.5 inline mr-1" />
          公開廣場
        </button>
      </div>

      <AssetModelSubpageGuide page="prompt-library" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜尋提示詞標題…"
            className="pl-9"
          />
        </div>
        <Select
          value={filterCategory}
          onValueChange={v => { setFilterCategory(v as Category | "all"); setPage(1); }}
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
        {tab === "mine" && (
          <Button
            variant={favoritesOnly ? "default" : "outline"}
            size="sm"
            onClick={() => { setFavoritesOnly(v => !v); setPage(1); }}
            className="gap-1.5"
          >
            <Star className="w-3.5 h-3.5" />
            只看收藏
          </Button>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">還沒有提示詞</p>
          <p className="text-sm mt-1">點擊右上角「新增提示詞」開始建立</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => (
            <PromptCard
              key={item.id}
              item={item}
              isOwn={tab === "mine"}
              onCopy={() => handleCopy(item.content, item.id)}
              onEdit={() => openEdit(item)}
              onDelete={() => {
                if (confirm("確定要刪除此提示詞？")) deleteMut.mutate({ id: item.id });
              }}
              onToggleFav={() => toggleFavMut.mutate({ id: item.id })}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            上一頁
          </Button>
          <span className="text-sm text-muted-foreground flex items-center px-2">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            下一頁
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── PromptCard Component ─────────────────────────────────────────────────────

interface PromptCardProps {
  item: {
    id: number;
    title: string;
    content: string;
    category: string;
    tags: string[] | null;
    isFavorite: boolean;
    isPublic: boolean;
    useCount: number;
    modelHint: string | null;
  };
  isOwn: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFav: () => void;
}

function PromptCard({ item, isOwn, onCopy, onEdit, onDelete, onToggleFav }: PromptCardProps) {
  const catLabel = CATEGORIES.find(c => c.value === item.category)?.label ?? item.category;

  return (
    <div className="group relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight truncate">{item.title}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {catLabel}
            </Badge>
            {item.isPublic ? (
              <Globe className="w-3 h-3 text-muted-foreground" />
            ) : (
              <Lock className="w-3 h-3 text-muted-foreground" />
            )}
            {item.modelHint && (
              <span className="text-xs text-muted-foreground truncate max-w-24">
                {item.modelHint}
              </span>
            )}
          </div>
        </div>
        {isOwn && (
          <button
            onClick={onToggleFav}
            className="shrink-0 mt-0.5"
          >
            <Star
              className={`w-4 h-4 transition-colors ${item.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground hover:text-yellow-400"}`}
            />
          </button>
        )}
      </div>

      {/* Content Preview */}
      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed font-mono bg-muted/50 rounded-lg p-2">
        {item.content}
      </p>

      {/* Tags */}
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
          {item.tags.length > 4 && (
            <span className="text-xs text-muted-foreground">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto">
        <span className="text-xs text-muted-foreground">使用 {item.useCount} 次</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCopy} title="複製">
            <Copy className="w-3.5 h-3.5" />
          </Button>
          {isOwn && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="編輯">
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
