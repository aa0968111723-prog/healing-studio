/**
 * LearnHub.tsx — 學習文件中心
 *
 * 功能：
 *  - 搜尋 + 分類篩選 + 難度篩選
 *  - 文件卡片 Grid（精選置頂）
 *  - 文件詳情 Modal（Markdown 渲染）
 *  - 管理員可新增/編輯/刪除文件
 *  - 整合 usePageTour（自動觸發新手引導）
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BookOpen, Search, Star, Clock, Tag, ExternalLink,
  Plus, Edit2, Trash2, ChevronRight, Sparkles, Loader2,
  GraduationCap, Cpu, FileText, Newspaper, Workflow, ArrowLeft,
  CheckCircle2, Info, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePageTour } from "@/contexts/SiteOnboardingContext";

// ─── Category Config ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "all",             label: "全部",       icon: BookOpen,      color: "text-gray-600",   bg: "bg-gray-100" },
  { id: "getting-started", label: "入門指南",   icon: GraduationCap, color: "text-emerald-600", bg: "bg-emerald-50" },
  { id: "model-guide",     label: "模型說明",   icon: Cpu,           color: "text-blue-600",   bg: "bg-blue-50" },
  { id: "technique",       label: "生成技術",   icon: Zap,           color: "text-purple-600", bg: "bg-purple-50" },
  { id: "workflow",        label: "創作流程",   icon: Workflow,      color: "text-orange-600", bg: "bg-orange-50" },
  { id: "api-docs",        label: "API 文件",   icon: FileText,      color: "text-indigo-600", bg: "bg-indigo-50" },
  { id: "ai-news",         label: "AI 新聞",    icon: Newspaper,     color: "text-pink-600",   bg: "bg-pink-50" },
] as const;

type CategoryId = typeof CATEGORIES[number]["id"];

const DIFFICULTIES = [
  { id: "all",           label: "所有難度" },
  { id: "beginner",      label: "入門" },
  { id: "intermediate",  label: "進階" },
  { id: "advanced",      label: "高級" },
] as const;

type DifficultyId = typeof DIFFICULTIES[number]["id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIFF_BADGE: Record<string, { label: string; cls: string }> = {
  beginner:     { label: "入門",  cls: "bg-emerald-100 text-emerald-700" },
  intermediate: { label: "進階",  cls: "bg-blue-100 text-blue-700" },
  advanced:     { label: "高級",  cls: "bg-purple-100 text-purple-700" },
};

function getCategoryConfig(id: string) {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[0];
}

// Simple Markdown → HTML renderer (no heavy dependency)
function renderMarkdown(md: string): string {
  return md
    // Code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, "<pre class=\"bg-gray-900 text-green-300 p-4 rounded-xl text-xs overflow-x-auto my-3\"><code>$1</code></pre>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code class=\"bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono\">$1</code>")
    // Headers
    .replace(/^#### (.+)$/gm, "<h4 class=\"text-sm font-bold text-gray-800 mt-4 mb-1\">$1</h4>")
    .replace(/^### (.+)$/gm, "<h3 class=\"text-base font-bold text-gray-800 mt-5 mb-2\">$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class=\"text-lg font-bold text-gray-900 mt-6 mb-3 border-b pb-1\">$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class=\"text-xl font-bold text-gray-900 mt-2 mb-4\">$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong class=\"font-semibold\">$1</strong>")
    // Tables (simple)
    .replace(/^\|(.+)\|$/gm, (match) => {
      if (match.includes("---")) return "";
      const cells = match.split("|").filter(Boolean).map(c => c.trim());
      const isHeader = false;
      return `<tr>${cells.map(c => `<td class="px-3 py-2 border-b border-gray-100 text-sm">${c}</td>`).join("")}</tr>`;
    })
    // Horizontal rules
    .replace(/^---$/gm, "<hr class=\"my-4 border-gray-200\" />")
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li class=\"ml-4 text-sm text-gray-700 list-disc mb-1\">$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li class=\"ml-4 text-sm text-gray-700 list-decimal mb-1\">$1</li>")
    // Paragraphs (double newlines)
    .replace(/\n\n/g, "</p><p class=\"text-sm text-gray-700 leading-relaxed mb-3\">")
    // Single newlines
    .replace(/\n/g, "<br />");
}

// ─── DocCard ─────────────────────────────────────────────────────────────────

function DocCard({
  doc,
  onOpen,
  onEdit,
  onDelete,
  isAdmin,
}: {
  doc: any;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isAdmin: boolean;
}) {
  const catConfig = getCategoryConfig(doc.category);
  const CatIcon = catConfig.icon;
  const diffBadge = DIFF_BADGE[doc.difficulty] ?? DIFF_BADGE.beginner;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="cursor-pointer rounded-2xl border border-gray-200/70 bg-white hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden group"
    >
      {/* Featured top bar */}
      {doc.featured && (
        <div className="h-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400" />
      )}

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className={`p-2 rounded-xl ${catConfig.bg} shrink-0`}>
            <CatIcon className={`w-4 h-4 ${catConfig.color}`} />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {doc.featured && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <Star className="w-2.5 h-2.5 fill-amber-500" />
                精選
              </span>
            )}
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}>
              {diffBadge.label}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-sm text-gray-900 mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {doc.title}
        </h3>

        {/* Summary */}
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">
          {doc.summary}
        </p>

        {/* Tags */}
        {doc.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {doc.tags.slice(0, 3).map((tag: string) => (
              <span key={tag} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <Clock className="w-3 h-3" />
            {doc.readingMinutes} 分鐘閱讀
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); onEdit(); }}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(); }}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── DocDetailModal ───────────────────────────────────────────────────────────

function DocDetailModal({ doc, onClose }: { doc: any; onClose: () => void }) {
  const catConfig = getCategoryConfig(doc.category);
  const CatIcon = catConfig.icon;
  const diffBadge = DIFF_BADGE[doc.difficulty] ?? DIFF_BADGE.beginner;

  const html = renderMarkdown(doc.content ?? "");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl">
        {/* Featured bar */}
        {doc.featured && (
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 shrink-0" />
        )}

        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4 border-b shrink-0">
          <div className={`p-2.5 rounded-xl ${catConfig.bg} shrink-0`}>
            <CatIcon className={`w-5 h-5 ${catConfig.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="outline" className="text-[10px]">{catConfig.label}</Badge>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}>
                {diffBadge.label}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <Clock className="w-3 h-3" />{doc.readingMinutes} 分鐘
              </span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">{doc.title}</h2>
            <p className="text-sm text-gray-500 mt-1">{doc.summary}</p>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto p-6 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: `<p class="text-sm text-gray-700 leading-relaxed mb-3">${html}</p>` }}
        />

        {/* Footer */}
        <div className="p-4 border-t shrink-0 flex items-center justify-between bg-gray-50/50">
          <div className="text-xs text-gray-400">
            {doc.authorName && <span>作者：{doc.authorName}　</span>}
            更新於 {new Date(doc.updatedAt).toLocaleDateString("zh-TW")}
          </div>
          <div className="flex items-center gap-2">
            {doc.externalUrl && (
              <a
                href={doc.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                原文連結
              </a>
            )}
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs rounded-full">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              返回列表
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AdminDocForm ─────────────────────────────────────────────────────────────

function AdminDocForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: any;
  onSave: (data: any) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState(initial?.category ?? "getting-started");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "beginner");
  const [readingMinutes, setReadingMinutes] = useState(initial?.readingMinutes ?? 5);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [externalUrl, setExternalUrl] = useState(initial?.externalUrl ?? "");
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      toast.error("標題和內容為必填");
      return;
    }
    onSave({
      title: title.trim(),
      summary: summary.trim(),
      content: content.trim(),
      category,
      difficulty,
      readingMinutes: Number(readingMinutes),
      tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean),
      featured,
      externalUrl: externalUrl.trim() || undefined,
      authorName: authorName.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">標題 *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="文件標題" className="mt-1" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">摘要 *</Label>
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="一句話說明文件內容" className="mt-1 resize-none" rows={2} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">分類</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1 text-sm h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.filter(c => c.id !== "all").map(c => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">難度</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="mt-1 text-sm h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">入門</SelectItem>
              <SelectItem value="intermediate">進階</SelectItem>
              <SelectItem value="advanced">高級</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">閱讀時間（分鐘）</Label>
          <Input type="number" min={1} max={120} value={readingMinutes} onChange={e => setReadingMinutes(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">標籤（逗號分隔）</Label>
          <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="Kling, 影片, 入門" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">作者名稱</Label>
          <Input value={authorName} onChange={e => setAuthorName(e.target.value)} placeholder="Healing Studio Team" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">外部連結（選填）</Label>
          <Input value={externalUrl} onChange={e => setExternalUrl(e.target.value)} placeholder="https://..." className="mt-1" />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <Switch checked={featured} onCheckedChange={setFeatured} id="doc-featured" />
          <Label htmlFor="doc-featured" className="text-xs cursor-pointer">設為精選文件</Label>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">內容（Markdown）*</Label>
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="# 標題&#10;&#10;正文內容，支援 Markdown 格式..."
            className="mt-1 font-mono text-xs resize-y"
            rows={12}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button onClick={handleSave} disabled={isSaving} className="flex-1">
          {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />儲存中...</> : <><CheckCircle2 className="w-4 h-4 mr-2" />儲存文件</>}
        </Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🏠 LearnHub 主頁面
// ═══════════════════════════════════════════════════════════════════════════════

export default function LearnHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Auto tour
  usePageTour("learn");

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyId>("all");

  // Document detail
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  // Admin form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);

  // tRPC
  const { data, isLoading, refetch } = trpc.learnHub.list.useQuery({
    category: selectedCategory === "all" ? undefined : selectedCategory,
    search: searchQuery || undefined,
    difficulty: selectedDifficulty === "all" ? undefined : selectedDifficulty as any,
    limit: 50,
  });

  const { data: openDocData } = trpc.learnHub.getById.useQuery(
    { id: openDocId! },
    { enabled: !!openDocId, retry: false }
  );

  const { data: categoryData } = trpc.learnHub.categories.useQuery();

  const createMut = trpc.learnHub.create.useMutation({
    onSuccess: () => { toast.success("文件已新增！"); setShowCreateForm(false); refetch(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.learnHub.update.useMutation({
    onSuccess: () => { toast.success("文件已更新！"); setEditingDoc(null); refetch(); },
    onError: e => toast.error(e.message),
  });
  const deleteMut = trpc.learnHub.delete.useMutation({
    onSuccess: () => { toast.success("文件已刪除"); refetch(); },
    onError: e => toast.error(e.message),
  });

  const docs = data?.items ?? [];
  const total = data?.total ?? 0;

  // Featured docs for hero section
  const featuredDocs = docs.filter(d => d.featured).slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* ── 頁面標題 ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-200/40">
            <BookOpen className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">學習文件中心</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              AI 生成技術教學、模型說明、API 文件和最新 AI 新聞
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                共 {total} 篇文件
              </span>
              {categoryData && Object.keys(categoryData).length > 0 && (
                <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {Object.keys(categoryData).length} 個分類
                </span>
              )}
            </div>
          </div>
        </div>

        {isAdmin && (
          <Button
            onClick={() => setShowCreateForm(true)}
            className="gap-2 shrink-0"
            size="sm"
          >
            <Plus className="w-4 h-4" />
            新增文件
          </Button>
        )}
      </div>

      {/* ── 搜尋列 ─────────────────────────────────────────────── */}
      <div
        id="learn-search"
        className="relative"
      >
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜尋文件標題、內容或標籤..."
          className="pl-10 pr-4 py-2.5 rounded-xl bg-muted/30 border-muted text-sm"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── 分類篩選 ────────────────────────────────────────────── */}
      <div id="learn-category-filter" className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const isActive = selectedCategory === cat.id;
          const count = cat.id === "all"
            ? total
            : (categoryData?.[cat.id] ?? 0);

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id as CategoryId)}
              className={`
                flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all
                ${isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── 難度篩選 ────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedDifficulty(d.id as DifficultyId)}
            className={`
              text-xs px-3 py-1.5 rounded-full transition-all font-medium
              ${selectedDifficulty === d.id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }
            `}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* ── 精選文件（Hero Section）────────────────────────────── */}
      {featuredDocs.length > 0 && !searchQuery && selectedCategory === "all" && selectedDifficulty === "all" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
            <h2 className="text-sm font-semibold text-foreground">精選文件</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredDocs.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc}
                onOpen={() => setOpenDocId(doc.id)}
                onEdit={() => setEditingDoc(doc)}
                onDelete={() => {
                  if (confirm(`確定刪除「${doc.title}」？`)) {
                    deleteMut.mutate({ id: doc.id });
                  }
                }}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 所有文件 Grid ──────────────────────────────────────── */}
      <div className="space-y-3">
        {(!searchQuery && selectedCategory === "all" && selectedDifficulty === "all") && (
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">所有文件</h2>
          </div>
        )}
        {(searchQuery || selectedCategory !== "all" || selectedDifficulty !== "all") && (
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              搜尋結果 · {total} 篇
            </h2>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 rounded-2xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground text-sm">找不到相關文件</p>
            {searchQuery && (
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
                清除搜尋
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {docs.map((doc, i) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <DocCard
                    doc={doc}
                    onOpen={() => setOpenDocId(doc.id)}
                    onEdit={() => setEditingDoc(doc)}
                    onDelete={() => {
                      if (confirm(`確定刪除「${doc.title}」？`)) {
                        deleteMut.mutate({ id: doc.id });
                      }
                    }}
                    isAdmin={isAdmin}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── 底部說明 ─────────────────────────────────────────────── */}
      <div className="mt-8 p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 flex items-start gap-3">
        <Info className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-xs text-emerald-700 space-y-1">
          <p className="font-semibold">📚 持續更新中</p>
          <p>學習文件中心會持續新增 API 文件、模型教學和 AI 技術新聞。如有建議主題，歡迎在<strong>回饋中心</strong>提交！</p>
          {isAdmin && (
            <p className="text-blue-600 mt-2">🛡️ 管理員：點擊右上角「新增文件」按鈕可新增文件；點擊文件卡片右下角的編輯/刪除圖示可管理文件。</p>
          )}
        </div>
      </div>

      {/* ── Document Detail Modal ──────────────────────────────── */}
      {openDocId && openDocData && (
        <DocDetailModal doc={openDocData} onClose={() => setOpenDocId(null)} />
      )}

      {/* ── Admin Create Dialog ─────────────────────────────────── */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              新增學習文件
            </DialogTitle>
          </DialogHeader>
          <AdminDocForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowCreateForm(false)}
            isSaving={createMut.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* ── Admin Edit Dialog ───────────────────────────────────── */}
      <Dialog open={!!editingDoc} onOpenChange={v => !v && setEditingDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5" />
              編輯學習文件
            </DialogTitle>
          </DialogHeader>
          {editingDoc && (
            <AdminDocForm
              initial={editingDoc}
              onSave={data => updateMut.mutate({ id: editingDoc.id, ...data })}
              onCancel={() => setEditingDoc(null)}
              isSaving={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
