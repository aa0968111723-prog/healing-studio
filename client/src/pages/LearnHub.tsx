/**
 * LearnHub.tsx — 學習文件中心
 *
 * 功能：
 *  - 三大子頁面：文件中心 / 影片學習區 / 學習測驗區
 *  - 搜尋 + 分類篩選 + 難度篩選
 *  - 文件卡片 Grid（精選置頂）
 *  - 文件詳情 Modal（Markdown 渲染）
 *  - 影片學習區：影片卡片 + 播放器 Modal
 *  - 學習測驗區：測驗卡片 + 互動式作答
 *  - 管理員可新增/編輯/刪除文件、影片、測驗
 *  - 整合 usePageTour（自動觸發新手引導）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAIState } from "@/contexts/AIStateContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import VisualSoul from "@/components/VisualSoul";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BookOpen,
  Search,
  Star,
  Clock,
  ExternalLink,
  Plus,
  Edit2,
  Trash2,
  ChevronRight,
  Loader2,
  GraduationCap,
  Cpu,
  FileText,
  Newspaper,
  Workflow,
  ArrowLeft,
  CheckCircle2,
  Info,
  Zap,
  Video,
  Play,
  ClipboardCheck,
  Trophy,
  XCircle,
  Box,
  Download,
  Upload,
  Image as ImageIcon,
  FileAudio,
  FileVideo,
  File,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePageTour } from "@/contexts/SiteOnboardingContext";

// ─── Category Config ──────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: "all",
    label: "全部",
    icon: BookOpen,
    color: "text-gray-600",
    bg: "bg-gray-100",
  },
  {
    id: "getting-started",
    label: "入門指南",
    icon: GraduationCap,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    id: "model-guide",
    label: "模型說明",
    icon: Cpu,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    id: "technique",
    label: "生成技術",
    icon: Zap,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    id: "workflow",
    label: "創作流程",
    icon: Workflow,
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    id: "api-docs",
    label: "API 文件",
    icon: FileText,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  {
    id: "ai-news",
    label: "AI 新聞",
    icon: Newspaper,
    color: "text-pink-600",
    bg: "bg-pink-50",
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const DIFFICULTIES = [
  { id: "all", label: "所有難度" },
  { id: "beginner", label: "入門" },
  { id: "intermediate", label: "進階" },
  { id: "advanced", label: "高級" },
] as const;

type DifficultyId = (typeof DIFFICULTIES)[number]["id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIFF_BADGE: Record<string, { label: string; cls: string }> = {
  beginner: { label: "入門", cls: "bg-emerald-100 text-emerald-700" },
  intermediate: { label: "進階", cls: "bg-blue-100 text-blue-700" },
  advanced: { label: "高級", cls: "bg-purple-100 text-purple-700" },
};

function getCategoryConfig(id: string) {
  return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[0];
}

// Simple Markdown → HTML renderer (no heavy dependency)
// Includes HTML tag stripping to prevent XSS from user-supplied content.
function stripHtmlTags(str: string): string {
  // Remove any raw HTML tags to prevent XSS — we only allow markdown syntax.
  // This strips <script>, <img onerror=...>, <style>, etc.
  return str.replace(/<[^>]*>/g, "");
}

function renderMarkdown(md: string): string {
  // First, strip raw HTML tags to neutralise embedded scripts/event handlers
  const safe = stripHtmlTags(md);

  return (
    safe
      // Code blocks
      .replace(
        /```[\w]*\n([\s\S]*?)```/g,
        '<pre class="bg-gray-900 text-green-300 p-4 rounded-xl text-xs overflow-x-auto my-3"><code>$1</code></pre>'
      )
      // Inline code
      .replace(
        /`([^`]+)`/g,
        '<code class="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
      )
      // Headers
      .replace(
        /^#### (.+)$/gm,
        '<h4 class="text-sm font-bold text-gray-800 mt-4 mb-1">$1</h4>'
      )
      .replace(
        /^### (.+)$/gm,
        '<h3 class="hs-h3 !mb-0 text-gray-800 mt-5 mb-2">$1</h3>'
      )
      .replace(
        /^## (.+)$/gm,
        '<h2 class="hs-h2 !mb-0 text-gray-900 mt-6 mb-3 border-b pb-1">$1</h2>'
      )
      .replace(
        /^# (.+)$/gm,
        '<h1 class="text-xl font-bold text-gray-900 mt-2 mb-4">$1</h1>'
      )
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      // Tables (simple)
      .replace(/^\|(.+)\|$/gm, match => {
        if (match.includes("---")) return "";
        const cells = match
          .split("|")
          .filter(Boolean)
          .map(c => c.trim());
        const isHeader = false;
        return `<tr>${cells.map(c => `<td class="px-3 py-2 border-b border-gray-100 text-sm">${c}</td>`).join("")}</tr>`;
      })
      // Horizontal rules
      .replace(/^---$/gm, '<hr class="my-4 border-gray-200" />')
      // Unordered list items
      .replace(
        /^- (.+)$/gm,
        '<li class="ml-4 text-sm text-gray-700 list-disc mb-1">$1</li>'
      )
      // Ordered list items
      .replace(
        /^\d+\. (.+)$/gm,
        '<li class="ml-4 text-sm text-gray-700 list-decimal mb-1">$1</li>'
      )
      // Paragraphs (double newlines)
      .replace(/\n\n/g, '</p><p class="hs-p !mb-0 text-gray-700 mb-3">')
      // Single newlines
      .replace(/\n/g, "<br />")
  );
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
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}
            >
              {diffBadge.label}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {doc.title}
        </h3>

        {/* Summary */}
        <p className="hs-small !mb-0 text-gray-500 line-clamp-2 mb-3">
          {doc.summary}
        </p>

        {/* Tags */}
        {doc.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {doc.tags.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full"
              >
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
                  onClick={e => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDelete();
                  }}
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
  const attachments: Array<{ type: string; url: string; title?: string }> = Array.isArray(
    doc.attachments
  )
    ? doc.attachments
    : [];

  const handleDownloadDoc = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.id ?? "learn-doc"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              <Badge variant="outline" className="text-[10px]">
                {catConfig.label}
              </Badge>
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}
              >
                {diffBadge.label}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <Clock className="w-3 h-3" />
                {doc.readingMinutes} 分鐘
              </span>
            </div>
            <h2 className="hs-h2 !mb-0 text-gray-900">{doc.title}</h2>
            <p className="hs-small !mb-0 text-gray-500 mt-1">{doc.summary}</p>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto p-6 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{
            __html: `<p class="hs-p !mb-0 text-gray-700 mb-3">${html}</p>`,
          }}
        />
        {attachments.length > 0 && (
          <div className="px-6 pb-4">
            <h3 className="text-sm font-semibold mb-2">附件資源</h3>
            <div className="space-y-3">
              {attachments.map((asset, idx) => (
                <div key={`${asset.url}-${idx}`} className="rounded-xl border p-3 bg-white">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {asset.type === "image" && <ImageIcon className="w-3.5 h-3.5" />}
                      {asset.type === "video" && <FileVideo className="w-3.5 h-3.5" />}
                      {asset.type === "audio" && <FileAudio className="w-3.5 h-3.5" />}
                      {asset.type === "pdf" && <File className="w-3.5 h-3.5" />}
                      {asset.title ?? asset.type.toUpperCase()}
                    </span>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      下載 / 開啟
                    </a>
                  </div>
                  {asset.type === "image" && (
                    <img src={asset.url} alt={asset.title ?? "attachment"} className="rounded-lg max-h-60 w-full object-cover" />
                  )}
                  {asset.type === "video" && (
                    <video src={asset.url} controls className="rounded-lg max-h-60 w-full" />
                  )}
                  {asset.type === "audio" && <audio src={asset.url} controls className="w-full" />}
                </div>
              ))}
            </div>
          </div>
        )}

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
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadDoc}
              className="text-xs rounded-full"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              下載文件 JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs rounded-full"
            >
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
  const [category, setCategory] = useState(
    initial?.category ?? "getting-started"
  );
  const [difficulty, setDifficulty] = useState(
    initial?.difficulty ?? "beginner"
  );
  const [readingMinutes, setReadingMinutes] = useState(
    initial?.readingMinutes ?? 5
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [externalUrl, setExternalUrl] = useState(initial?.externalUrl ?? "");
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");
  const [attachmentsText, setAttachmentsText] = useState(
    JSON.stringify(initial?.attachments ?? [], null, 2)
  );

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      toast.error("標題和內容為必填");
      return;
    }
    let attachments: Array<{
      type: "image" | "video" | "pdf" | "audio";
      url: string;
      title?: string;
    }> = [];
    try {
      const parsed = JSON.parse(attachmentsText || "[]");
      if (!Array.isArray(parsed)) {
        toast.error("附件格式需為 JSON 陣列");
        return;
      }
      attachments = parsed as Array<{
        type: "image" | "video" | "pdf" | "audio";
        url: string;
        title?: string;
      }>;
    } catch {
      toast.error("附件格式需為合法 JSON");
      return;
    }
    onSave({
      title: title.trim(),
      summary: summary.trim(),
      content: content.trim(),
      category,
      difficulty,
      readingMinutes: Number(readingMinutes),
      tags: tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean),
      featured,
      externalUrl: externalUrl.trim() || undefined,
      authorName: authorName.trim() || undefined,
      attachments,
    });
  };

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">標題 *</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="文件標題"
            className="mt-1"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">摘要 *</Label>
          <Textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="一句話說明文件內容"
            className="mt-1 resize-none"
            rows={2}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">分類</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.filter(c => c.id !== "all").map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">難度</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">入門</SelectItem>
              <SelectItem value="intermediate">進階</SelectItem>
              <SelectItem value="advanced">高級</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            閱讀時間（分鐘）
          </Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={readingMinutes}
            onChange={e => setReadingMinutes(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            標籤（逗號分隔）
          </Label>
          <Input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="Kling, 影片, 入門"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">作者名稱</Label>
          <Input
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            placeholder="Healing Studio Team"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            外部連結（選填）
          </Label>
          <Input
            value={externalUrl}
            onChange={e => setExternalUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1"
          />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <Switch
            checked={featured}
            onCheckedChange={setFeatured}
            id="doc-featured"
          />
          <Label htmlFor="doc-featured" className="text-xs cursor-pointer">
            設為精選文件
          </Label>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">
            附件 JSON（支援 image / video / pdf / audio）
          </Label>
          <Textarea
            value={attachmentsText}
            onChange={e => setAttachmentsText(e.target.value)}
            placeholder={`[
  {"type":"image","url":"https://...","title":"參考圖"},
  {"type":"video","url":"https://...","title":"示範影片"},
  {"type":"pdf","url":"https://...","title":"教材 PDF"},
  {"type":"audio","url":"https://...","title":"語音講解"}
]`}
            className="mt-1 font-mono text-xs"
            rows={6}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">
            內容（Markdown）*
          </Label>
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
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              儲存中...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              儲存文件
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ─── VideoCard ────────────────────────────────────────────────────────────────

function VideoCard({
  video,
  onOpen,
  onEdit,
  onDelete,
  isAdmin,
}: {
  video: any;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isAdmin: boolean;
}) {
  const diffBadge = DIFF_BADGE[video.difficulty] ?? DIFF_BADGE.beginner;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="cursor-pointer rounded-2xl border border-gray-200/70 bg-white hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden group"
    >
      {video.featured && (
        <div className="h-0.5 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400" />
      )}

      {/* Thumbnail / Video Preview */}
      <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-primary/80 transition-colors">
            <Play className="w-6 h-6 text-white ml-0.5" />
          </div>
        </div>
        <Video className="w-10 h-10 text-gray-300" />
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-md">
          {video.durationMinutes} 分鐘
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {video.featured && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              <Star className="w-2.5 h-2.5 fill-amber-500" />
              精選
            </span>
          )}
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}
          >
            {diffBadge.label}
          </span>
        </div>

        <h3 className="hs-h3 !mb-0 text-gray-900 mb-1.5 line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </h3>
        <p className="hs-small !mb-0 text-gray-500 line-clamp-2 mb-2">
          {video.summary}
        </p>

        {video.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {video.tags.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <Video className="w-3 h-3" />
            影片教學
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDelete();
                  }}
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

// ─── VideoPlayerModal ─────────────────────────────────────────────────────────

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com"
    ) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${encodeURIComponent(v)}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

function VideoPlayerModal({
  video,
  onClose,
}: {
  video: any;
  onClose: () => void;
}) {
  const diffBadge = DIFF_BADGE[video.difficulty] ?? DIFF_BADGE.beginner;
  const embedUrl = getYouTubeEmbedUrl(video.videoUrl);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl">
        {video.featured && (
          <div className="h-1 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 shrink-0" />
        )}

        {/* Video Player */}
        <div className="aspect-video bg-black shrink-0">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title={video.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-white gap-3">
              <Video className="w-12 h-12 text-white/50" />
              <a
                href={video.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200 underline"
              >
                <ExternalLink className="w-4 h-4" />
                在新分頁中觀看影片
              </a>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}
            >
              {diffBadge.label}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <Clock className="w-3 h-3" />
              {video.durationMinutes} 分鐘
            </span>
          </div>
          <h2 className="hs-h2 !mb-0 text-gray-900">{video.title}</h2>
          <p className="hs-small !mb-0 text-gray-500">{video.summary}</p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t shrink-0 flex items-center justify-between bg-gray-50/50">
          <div className="text-xs text-gray-400">
            {video.authorName && <span>作者：{video.authorName}　</span>}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs rounded-full"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            返回列表
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AdminVideoForm ───────────────────────────────────────────────────────────

function AdminVideoForm({
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
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [category, setCategory] = useState(
    initial?.category ?? "getting-started"
  );
  const [difficulty, setDifficulty] = useState(
    initial?.difficulty ?? "beginner"
  );
  const [durationMinutes, setDurationMinutes] = useState(
    initial?.durationMinutes ?? 10
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");

  const handleSave = () => {
    if (!title.trim() || !videoUrl.trim()) {
      toast.error("標題和影片網址為必填");
      return;
    }
    onSave({
      title: title.trim(),
      summary: summary.trim(),
      videoUrl: videoUrl.trim(),
      category,
      difficulty,
      durationMinutes: Number(durationMinutes),
      tags: tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean),
      featured,
      authorName: authorName.trim() || undefined,
    });
  };

  const VIDEO_CATEGORIES = CATEGORIES.filter(
    c => c.id !== "all" && c.id !== "api-docs"
  );

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">標題 *</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="影片標題"
            className="mt-1"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">摘要</Label>
          <Textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="一句話說明影片內容"
            className="mt-1 resize-none"
            rows={2}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">
            影片網址（YouTube 等）*
          </Label>
          <Input
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">分類</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_CATEGORIES.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">難度</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">入門</SelectItem>
              <SelectItem value="intermediate">進階</SelectItem>
              <SelectItem value="advanced">高級</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            影片長度（分鐘）
          </Label>
          <Input
            type="number"
            min={1}
            max={600}
            value={durationMinutes}
            onChange={e => setDurationMinutes(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            標籤（逗號分隔）
          </Label>
          <Input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="教學, 入門, Prompt"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">作者名稱</Label>
          <Input
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            placeholder="Healing Studio Team"
            className="mt-1"
          />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <Switch
            checked={featured}
            onCheckedChange={setFeatured}
            id="video-featured"
          />
          <Label htmlFor="video-featured" className="text-xs cursor-pointer">
            設為精選影片
          </Label>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button onClick={handleSave} disabled={isSaving} className="flex-1">
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              儲存中...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              儲存影片
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ─── Quiz Category Config ─────────────────────────────────────────────────────

const QUIZ_FILTER_CATEGORIES = [
  { id: "all", label: "全部", icon: BookOpen },
  { id: "getting-started", label: "入門指南", icon: GraduationCap },
  { id: "model-guide", label: "模型說明", icon: Cpu },
  { id: "technique", label: "生成技術", icon: Zap },
  { id: "workflow", label: "創作流程", icon: Workflow },
  { id: "pro-studio", label: "音訊影片", icon: Video },
  { id: "director-ai", label: "導演模式", icon: FileText },
  { id: "3d-modeling", label: "3D 建模", icon: Box },
  { id: "tools-features", label: "工具功能", icon: ClipboardCheck },
  { id: "safety-privacy", label: "安全隱私", icon: Info },
] as const;

type QuizCategoryId = (typeof QUIZ_FILTER_CATEGORIES)[number]["id"];

// ─── QuizCard ─────────────────────────────────────────────────────────────────

function QuizCard({
  quiz,
  onOpen,
  onEdit,
  onDelete,
  isAdmin,
}: {
  quiz: any;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isAdmin: boolean;
}) {
  const diffBadge = DIFF_BADGE[quiz.difficulty] ?? DIFF_BADGE.beginner;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="cursor-pointer rounded-2xl border border-gray-200/70 bg-white hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden group"
    >
      {quiz.featured && (
        <div className="h-0.5 bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400" />
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="p-2 rounded-xl bg-green-50 shrink-0">
            <ClipboardCheck className="w-4 h-4 text-green-600" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {quiz.featured && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <Star className="w-2.5 h-2.5 fill-amber-500" />
                精選
              </span>
            )}
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${diffBadge.cls}`}
            >
              {diffBadge.label}
            </span>
          </div>
        </div>

        <h3 className="hs-h3 !mb-0 text-gray-900 mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {quiz.title}
        </h3>
        <p className="hs-small !mb-0 text-gray-500 line-clamp-2 mb-3">
          {quiz.summary}
        </p>

        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium">
            {quiz.questions?.length ?? 0} 題
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
            約 {quiz.estimatedMinutes} 分鐘
          </span>
        </div>

        {quiz.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {quiz.tags.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <ClipboardCheck className="w-3 h-3" />
            {QUIZ_FILTER_CATEGORIES.find(c => c.id === quiz.category)?.label ?? "學習測驗"}
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDelete();
                  }}
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

// ─── QuizPlayerModal ──────────────────────────────────────────────────────────

function QuizPlayerModal({
  quiz,
  onClose,
}: {
  quiz: any;
  onClose: () => void;
}) {
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(
    new Array(quiz.questions?.length ?? 0).fill(null)
  );

  const questions = quiz.questions ?? [];
  const q = questions[currentQ];
  const totalQ = questions.length;

  const handleSelectAnswer = (idx: number) => {
    if (showExplanation) return;
    setSelectedAnswer(idx);
    setShowExplanation(true);
    const newAnswers = [...answers];
    newAnswers[currentQ] = idx;
    setAnswers(newAnswers);
    if (idx === q.correctIndex) {
      setScore(s => s + 1);
    }
  };

  const handleNext = () => {
    if (currentQ < totalQ - 1) {
      setCurrentQ(c => c + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      setFinished(true);
    }
  };

  if (finished) {
    const pct = Math.round((score / totalQ) * 100);
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md rounded-3xl">
          <div className="text-center py-6 space-y-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto">
              <Trophy className="w-10 h-10 text-white" />
            </div>
            <h2 className="hs-h2 !mb-0 text-foreground">測驗完成！🎉</h2>
            <div className="text-4xl font-bold text-primary">
              {score}/{totalQ}
            </div>
            <p className="hs-small !mb-0 text-muted-foreground">
              {pct >= 80
                ? "太棒了！你的表現非常出色 🌟"
                : pct >= 50
                  ? "不錯哦！繼續加油 💪"
                  : "沒關係，學習是一個過程 🌱 多看看相關文件再試試吧！"}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCurrentQ(0);
                  setSelectedAnswer(null);
                  setShowExplanation(false);
                  setScore(0);
                  setFinished(false);
                  setAnswers(new Array(totalQ).fill(null));
                }}
                className="rounded-full"
              >
                重新作答
              </Button>
              <Button onClick={onClose} className="rounded-full">
                返回列表
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 rounded-3xl">
        {/* Progress */}
        <div className="h-1 bg-gray-100 shrink-0">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-300"
            style={{ width: `${((currentQ + 1) / totalQ) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="p-5 border-b shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="hs-h3 !mb-0 text-foreground">{quiz.title}</h2>
            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
              第 {currentQ + 1} / {totalQ} 題
            </span>
          </div>
        </div>

        {/* Question */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <h3 className="hs-h3 !mb-0 text-gray-900">{q.question}</h3>

          <div className="space-y-2 mt-4">
            {q.options.map((opt: string, idx: number) => {
              const isSelected = selectedAnswer === idx;
              const isCorrect = idx === q.correctIndex;
              let optClass =
                "border-gray-200 bg-white hover:border-primary/40 hover:bg-primary/5";
              if (showExplanation) {
                if (isCorrect) {
                  optClass = "border-green-400 bg-green-50";
                } else if (isSelected && !isCorrect) {
                  optClass = "border-red-400 bg-red-50";
                } else {
                  optClass = "border-gray-200 bg-gray-50 opacity-60";
                }
              } else if (isSelected) {
                optClass = "border-primary bg-primary/10";
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectAnswer(idx)}
                  disabled={showExplanation}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${optClass}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full border-2 border-current flex items-center justify-center text-xs font-semibold shrink-0">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-sm">{opt}</span>
                    {showExplanation && isCorrect && (
                      <CheckCircle2 className="w-5 h-5 text-green-600 ml-auto shrink-0" />
                    )}
                    {showExplanation && isSelected && !isCorrect && (
                      <XCircle className="w-5 h-5 text-red-500 ml-auto shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {showExplanation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-blue-50 border border-blue-200 mt-4"
            >
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-blue-700 mb-1">
                    解說
                  </p>
                  <p className="text-sm text-blue-800">{q.explanation}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t shrink-0 flex items-center justify-between bg-gray-50/50">
          <span className="text-xs text-gray-400">
            得分：{score} / {totalQ}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs rounded-full"
            >
              退出測驗
            </Button>
            {showExplanation && (
              <Button
                size="sm"
                onClick={handleNext}
                className="text-xs rounded-full"
              >
                {currentQ < totalQ - 1 ? "下一題" : "查看結果"}
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AdminQuizForm ────────────────────────────────────────────────────────────

function AdminQuizForm({
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
  const [category, setCategory] = useState(
    initial?.category ?? "getting-started"
  );
  const [difficulty, setDifficulty] = useState(
    initial?.difficulty ?? "beginner"
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    initial?.estimatedMinutes ?? 5
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");
  const [questionsJson, setQuestionsJson] = useState(
    initial?.questions
      ? JSON.stringify(initial.questions, null, 2)
      : `[
  {
    "id": "q1",
    "question": "題目？",
    "options": ["選項 A", "選項 B", "選項 C", "選項 D"],
    "correctIndex": 0,
    "explanation": "解說文字"
  }
]`
  );

  const QUIZ_CATEGORIES = [
    { id: "getting-started", label: "入門指南" },
    { id: "model-guide", label: "模型說明" },
    { id: "technique", label: "生成技術" },
    { id: "workflow", label: "創作流程" },
    { id: "pro-studio", label: "音訊影片" },
    { id: "director-ai", label: "導演模式" },
    { id: "3d-modeling", label: "3D 建模" },
    { id: "tools-features", label: "工具功能" },
    { id: "safety-privacy", label: "安全隱私" },
  ];

  const handleSave = () => {
    if (!title.trim()) {
      toast.error("標題為必填");
      return;
    }
    let questions;
    try {
      questions = JSON.parse(questionsJson);
    } catch {
      toast.error("題目 JSON 格式不正確");
      return;
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      toast.error("至少需要一道題目");
      return;
    }
    onSave({
      title: title.trim(),
      summary: summary.trim(),
      questions,
      category,
      difficulty,
      estimatedMinutes: Number(estimatedMinutes),
      tags: tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean),
      featured,
      authorName: authorName.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">標題 *</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="測驗標題"
            className="mt-1"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">摘要</Label>
          <Textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="一句話說明測驗內容"
            className="mt-1 resize-none"
            rows={2}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">分類</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUIZ_CATEGORIES.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">難度</Label>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="mt-1 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">入門</SelectItem>
              <SelectItem value="intermediate">進階</SelectItem>
              <SelectItem value="advanced">高級</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            預估時間（分鐘）
          </Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={estimatedMinutes}
            onChange={e => setEstimatedMinutes(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            標籤（逗號分隔）
          </Label>
          <Input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="入門, Prompt, 測驗"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">作者名稱</Label>
          <Input
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            placeholder="Healing Studio Team"
            className="mt-1"
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={featured}
            onCheckedChange={setFeatured}
            id="quiz-featured"
          />
          <Label htmlFor="quiz-featured" className="text-xs cursor-pointer">
            設為精選測驗
          </Label>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">
            題目（JSON 格式）*
          </Label>
          <Textarea
            value={questionsJson}
            onChange={e => setQuestionsJson(e.target.value)}
            className="mt-1 font-mono text-xs resize-y"
            rows={12}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button onClick={handleSave} disabled={isSaving} className="flex-1">
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              儲存中...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              儲存測驗
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎬 VideoLearningTab
// ═══════════════════════════════════════════════════════════════════════════════

function VideoLearningTab({ isAdmin }: { isAdmin: boolean }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<DifficultyId>("all");
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingVideo, setEditingVideo] = useState<any | null>(null);

  const { data, isLoading, refetch } = trpc.learnHub.videoList.useQuery({
    search: searchQuery || undefined,
    difficulty:
      selectedDifficulty === "all" ? undefined : (selectedDifficulty as any),
    limit: 50,
  });

  const { data: openVideoData } = trpc.learnHub.videoGetById.useQuery(
    { id: openVideoId! },
    { enabled: !!openVideoId, retry: false }
  );

  const createMut = trpc.learnHub.videoCreate.useMutation({
    onSuccess: () => {
      toast.success("影片已新增！");
      setShowCreateForm(false);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.learnHub.videoUpdate.useMutation({
    onSuccess: () => {
      toast.success("影片已更新！");
      setEditingVideo(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.learnHub.videoDelete.useMutation({
    onSuccess: () => {
      toast.success("影片已刪除");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const videos = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="hs-small !mb-0 text-muted-foreground">
            觀看影片教學，輕鬆學習 AI 創作技巧 · 共 {total} 部影片
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowCreateForm(true)}
            size="sm"
            className="gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            新增影片
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜尋影片標題或標籤..."
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

      {/* Difficulty filter */}
      <div className="flex gap-2 flex-wrap">
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedDifficulty(d.id as DifficultyId)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium ${
              selectedDifficulty === d.id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Video Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-2xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <Video className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground hs-small !mb-0">找不到相關影片</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {videos.map((video: any, i: number) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <VideoCard
                  video={video}
                  onOpen={() => setOpenVideoId(video.id)}
                  onEdit={() => setEditingVideo(video)}
                  onDelete={() => {
                    if (confirm(`確定刪除「${video.title}」？`)) {
                      deleteMut.mutate({ id: video.id });
                    }
                  }}
                  isAdmin={isAdmin}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Video Player Modal */}
      {openVideoId && openVideoData && (
        <VideoPlayerModal
          video={openVideoData}
          onClose={() => setOpenVideoId(null)}
        />
      )}

      {/* Admin Create Dialog */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              新增學習影片
            </DialogTitle>
          </DialogHeader>
          <AdminVideoForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowCreateForm(false)}
            isSaving={createMut.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Admin Edit Dialog */}
      <Dialog
        open={!!editingVideo}
        onOpenChange={v => !v && setEditingVideo(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5" />
              編輯學習影片
            </DialogTitle>
          </DialogHeader>
          {editingVideo && (
            <AdminVideoForm
              initial={editingVideo}
              onSave={data =>
                updateMut.mutate({ id: editingVideo.id, ...data })
              }
              onCancel={() => setEditingVideo(null)}
              isSaving={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 QuizLearningTab
// ═══════════════════════════════════════════════════════════════════════════════

function QuizLearningTab({ isAdmin }: { isAdmin: boolean }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<DifficultyId>("all");
  const [selectedCategory, setSelectedCategory] =
    useState<QuizCategoryId>("all");
  const [openQuizId, setOpenQuizId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<any | null>(null);

  const { data, isLoading, refetch } = trpc.learnHub.quizList.useQuery({
    search: searchQuery || undefined,
    category:
      selectedCategory === "all" ? undefined : selectedCategory,
    difficulty:
      selectedDifficulty === "all" ? undefined : (selectedDifficulty as any),
    limit: 50,
  });

  const { data: openQuizData } = trpc.learnHub.quizGetById.useQuery(
    { id: openQuizId! },
    { enabled: !!openQuizId, retry: false }
  );

  const createMut = trpc.learnHub.quizCreate.useMutation({
    onSuccess: () => {
      toast.success("測驗已新增！");
      setShowCreateForm(false);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.learnHub.quizUpdate.useMutation({
    onSuccess: () => {
      toast.success("測驗已更新！");
      setEditingQuiz(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.learnHub.quizDelete.useMutation({
    onSuccess: () => {
      toast.success("測驗已刪除");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const quizzes = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="hs-small !mb-0 text-muted-foreground">
            透過互動測驗檢測你的學習成果 · 共 {total} 個測驗
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowCreateForm(true)}
            size="sm"
            className="gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            新增測驗
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜尋測驗標題或標籤..."
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

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {QUIZ_FILTER_CATEGORIES.map(c => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id as QuizCategoryId)}
              className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium flex items-center gap-1.5 ${
                selectedCategory === c.id
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              <Icon className="w-3 h-3" />
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Difficulty filter */}
      <div className="flex gap-2 flex-wrap">
        {DIFFICULTIES.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedDifficulty(d.id as DifficultyId)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium ${
              selectedDifficulty === d.id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Quiz Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-52 rounded-2xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <ClipboardCheck className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground hs-small !mb-0">找不到相關測驗</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {quizzes.map((quiz: any, i: number) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <QuizCard
                  quiz={quiz}
                  onOpen={() => setOpenQuizId(quiz.id)}
                  onEdit={() => setEditingQuiz(quiz)}
                  onDelete={() => {
                    if (confirm(`確定刪除「${quiz.title}」？`)) {
                      deleteMut.mutate({ id: quiz.id });
                    }
                  }}
                  isAdmin={isAdmin}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Quiz Player Modal */}
      {openQuizId && openQuizData && (
        <QuizPlayerModal
          quiz={openQuizData}
          onClose={() => setOpenQuizId(null)}
        />
      )}

      {/* Admin Create Dialog */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              新增學習測驗
            </DialogTitle>
          </DialogHeader>
          <AdminQuizForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowCreateForm(false)}
            isSaving={createMut.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Admin Edit Dialog */}
      <Dialog
        open={!!editingQuiz}
        onOpenChange={v => !v && setEditingQuiz(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5" />
              編輯學習測驗
            </DialogTitle>
          </DialogHeader>
          {editingQuiz && (
            <AdminQuizForm
              initial={editingQuiz}
              onSave={data =>
                updateMut.mutate({ id: editingQuiz.id, ...data })
              }
              onCancel={() => setEditingQuiz(null)}
              isSaving={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🏠 LearnHub 主頁面
// ═══════════════════════════════════════════════════════════════════════════════

export default function LearnHub() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Auto tour
  usePageTour("learn");

  // ── AI Agent Integration ──
  const { aiState, setPageContext, personality } = useAIState();

  // Active tab
  const [activeTab, setActiveTab] = useState("docs");

  // Filter state (docs tab)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>("all");
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<DifficultyId>("all");

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({ pageId: "learn", pageLabel: "學習文件中心" });
    return () => setPageContext(null);
  }, [setPageContext]);

  // Document detail
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  // Admin form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // tRPC
  const { data, isLoading, refetch } = trpc.learnHub.list.useQuery({
    category: selectedCategory === "all" ? undefined : selectedCategory,
    search: searchQuery || undefined,
    difficulty:
      selectedDifficulty === "all" ? undefined : (selectedDifficulty as any),
    limit: 50,
  });

  const { data: openDocData } = trpc.learnHub.getById.useQuery(
    { id: openDocId! },
    { enabled: !!openDocId, retry: false }
  );

  const { data: categoryData } = trpc.learnHub.categories.useQuery();

  const createMut = trpc.learnHub.create.useMutation({
    onSuccess: () => {
      toast.success("文件已新增！");
      setShowCreateForm(false);
      refetch();
    },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.learnHub.update.useMutation({
    onSuccess: () => {
      toast.success("文件已更新！");
      setEditingDoc(null);
      refetch();
    },
    onError: e => toast.error(e.message),
  });
  const deleteMut = trpc.learnHub.delete.useMutation({
    onSuccess: () => {
      toast.success("文件已刪除");
      refetch();
    },
    onError: e => toast.error(e.message),
  });
  const importDocsMut = trpc.learnHub.importDocs.useMutation({
    onSuccess: res => {
      toast.success(`已匯入 ${res.count} 篇文件`);
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  const handleImportDocs = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = Array.isArray(parsed) ? parsed : parsed.docs;
      if (!Array.isArray(normalized) || normalized.length === 0) {
        toast.error("匯入檔案格式錯誤，需為 docs 陣列");
        return;
      }
      importDocsMut.mutate({ docs: normalized });
    } catch {
      toast.error("匯入失敗：請確認 JSON 格式");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const docs = data?.items ?? [];
  const total = data?.total ?? 0;

  // Featured docs for hero section
  const featuredDocs = docs.filter(d => d.featured).slice(0, 3);

  // ─── PageAgent 註冊（Phase 4b：學習中心接入光球） ────────────────────────
  // 光球可：切 docs/videos/quizzes 子分頁、挑分類、挑難度、下搜尋、清空條件。
  const LEARN_TAB_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "docs", label: "文件中心", meta: { bestFor: "系統化學習", tip: "先讀核心概念再實作" } },
      { id: "videos", label: "影片學習區", meta: { bestFor: "快速上手", tip: "搭配筆記同步整理重點" } },
      { id: "quizzes", label: "學習測驗區", meta: { bestFor: "檢核理解", tip: "每學完一章就做測驗" } },
    ],
    []
  );
  const LEARN_CATEGORY_OPTIONS = useMemo<AgentCapability["options"]>(
    () =>
      CATEGORIES.map(c => ({
        id: c.id,
        label: c.label,
        meta: { bestFor: c.label, tip: "先選與當前任務最相關的類別" },
      })),
    []
  );
  const LEARN_DIFFICULTY_OPTIONS = useMemo<AgentCapability["options"]>(
    () =>
      DIFFICULTIES.map(d => ({
        id: `difficulty:${d.id}`,
        label: `難度：${d.label}`,
        meta: { bestFor: `${d.label}程度`, tip: "依當前可投入時間選擇難度" },
      })),
    []
  );
  const learnAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換子頁",
        currentId: activeTab,
        options: LEARN_TAB_OPTIONS,
        hint: "切到 docs / videos / quizzes",
      },
      {
        action: "setParam",
        label: "分類 / 難度",
        options: [...(LEARN_CATEGORY_OPTIONS ?? []), ...(LEARN_DIFFICULTY_OPTIONS ?? [])],
        hint: "setParam key='category' value=<CategoryId>；key='difficulty' value=all|beginner|intermediate|advanced",
      },
      {
        action: "search",
        label: "搜尋文件",
        hint: "搜尋文件標題或內容",
      },
      {
        action: "reset",
        label: "清空條件",
        hint: "分類還原 all、難度還原 all、搜尋清空",
      },
    ],
    [activeTab, LEARN_TAB_OPTIONS, LEARN_CATEGORY_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "learn",
    pageLabel: "學習文件中心",
    pagePath: "/learn",
    capabilities: learnAgentCapabilities,
    state: {
      activeTab,
      selectedCategory,
      selectedDifficulty,
      searchQuery,
      totalDocs: total,
      visibleDocs: docs.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const allowed = ["docs", "videos", "quizzes"];
          if (!allowed.includes(action.tabId)) {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setActiveTab(action.tabId);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "setParam": {
          if (action.key === "category") {
            const v = String(action.value ?? "");
            const allowed = CATEGORIES.map(c => c.id);
            if (!allowed.includes(v as CategoryId)) {
              return { ok: false, reason: `unknown category: ${v}` };
            }
            setSelectedCategory(v as CategoryId);
            return { ok: true, message: `分類切到「${v}」` };
          }
          if (action.key === "difficulty") {
            const v = String(action.value ?? "");
            const allowed = DIFFICULTIES.map(d => d.id);
            if (!allowed.includes(v as DifficultyId)) {
              return { ok: false, reason: `unknown difficulty: ${v}` };
            }
            setSelectedDifficulty(v as DifficultyId);
            return { ok: true, message: `難度切到「${v}」` };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "search": {
          setSearchQuery(action.query);
          return { ok: true, message: "已套用搜尋" };
        }
        case "reset": {
          setSelectedCategory("all");
          setSelectedDifficulty("all");
          setSearchQuery("");
          return { ok: true, message: "已清空條件" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on learn: ${action.type}`,
          };
      }
    },
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* ── 頁面標題 ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-200/40">
            <BookOpen className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <h1 className="hs-h1 !mb-0 text-foreground">學習文件中心</h1>
            <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
              文件教學、影片學習、互動測驗 — 全站知識補充都在學習文件中心
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => navigate("/learn/tutorial-overview")}
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            教學總覽
          </Button>
        </div>
      </div>

      {/* ── 子頁面 Tabs ────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1 flex-nowrap overflow-x-auto h-auto gap-1 w-full justify-start">
          <TabsTrigger
            value="docs"
            className="rounded-lg gap-1.5 text-xs shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            文件中心
          </TabsTrigger>
          <TabsTrigger
            value="videos"
            className="rounded-lg gap-1.5 text-xs shrink-0"
          >
            <Video className="w-3.5 h-3.5" />
            影片學習區
          </TabsTrigger>
          <TabsTrigger
            value="quizzes"
            className="rounded-lg gap-1.5 text-xs shrink-0"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            學習測驗區
          </TabsTrigger>
        </TabsList>

        {/* ═══ Tab 1: 文件中心 ═══ */}
        <TabsContent value="docs" className="mt-4 space-y-6">
          {/* Stats */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
              共 {total} 篇文件
            </span>
            {categoryData && Object.keys(categoryData).length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                {Object.keys(categoryData).length} 個分類
              </span>
            )}
            {isAdmin && (
              <div className="ml-auto flex items-center gap-2">
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={e => handleImportDocs(e.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  onClick={() => importInputRef.current?.click()}
                  className="gap-2 shrink-0"
                  size="sm"
                >
                  <Upload className="w-4 h-4" />
                  匯入文件
                </Button>
                <Button
                  onClick={() => setShowCreateForm(true)}
                  className="gap-2 shrink-0"
                  size="sm"
                >
                  <Plus className="w-4 h-4" />
                  新增文件
                </Button>
              </div>
            )}
          </div>

          {/* ── 搜尋列 ─────────────────────────────────────────────── */}
          <div id="learn-search" className="relative">
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
              const count =
                cat.id === "all" ? total : (categoryData?.[cat.id] ?? 0);

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id as CategoryId)}
                  className={`
                    flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all
                    ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                  `}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-primary/10 text-primary"}`}
                    >
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
                  ${
                    selectedDifficulty === d.id
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
          {featuredDocs.length > 0 &&
            !searchQuery &&
            selectedCategory === "all" &&
            selectedDifficulty === "all" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                  <h2 className="hs-h3 !mb-0 text-foreground">精選文件</h2>
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
            {!searchQuery &&
              selectedCategory === "all" &&
              selectedDifficulty === "all" && (
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  <h2 className="hs-h3 !mb-0 text-foreground">所有文件</h2>
                </div>
              )}
            {(searchQuery ||
              selectedCategory !== "all" ||
              selectedDifficulty !== "all") && (
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <h2 className="hs-h3 !mb-0 text-foreground">
                  搜尋結果 · {total} 篇
                </h2>
              </div>
            )}

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-52 rounded-2xl bg-muted/40 animate-pulse"
                  />
                ))}
              </div>
            ) : docs.length === 0 ? (
              <div className="py-20 text-center space-y-3">
                <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                <p className="text-muted-foreground hs-small !mb-0">
                  找不到相關文件
                </p>
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                  >
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
              <p>
                學習文件中心會持續新增 API 文件、模型教學和 AI
                技術新聞。如有建議主題，歡迎在<strong>回饋中心</strong>提交！
              </p>
              {isAdmin && (
                <p className="text-blue-600 mt-2">
                  🛡️
                  管理員：點擊右上角「新增文件」按鈕可新增文件；點擊文件卡片右下角的編輯/刪除圖示可管理文件。
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ Tab 2: 影片學習區 ═══ */}
        <TabsContent value="videos" className="mt-4">
          <VideoLearningTab isAdmin={isAdmin} />
        </TabsContent>

        {/* ═══ Tab 3: 學習測驗區 ═══ */}
        <TabsContent value="quizzes" className="mt-4">
          <QuizLearningTab isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>

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
