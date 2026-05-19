/**
 * PromptReferenceTab.tsx — 學習中心「提示詞庫」子分頁
 *
 * 多模態 + 代理人呼叫的精選提示詞參考庫。
 *  - 模態 / 難度 / 語言 篩選 + 搜尋
 *  - 一鍵複製到剪貼簿
 *  - 一鍵儲存到個人提示詞庫（呼叫 trpc.promptLibrary.create）
 *  - 連動學習文件（references → /learn?docId=...）
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Search,
  Copy,
  Star,
  ExternalLink,
  Sparkles,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Wand2,
  Library,
  Filter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

import {
  PROMPT_REFERENCE_LIBRARY,
  PROMPT_MODALITY_META,
  PROMPT_REFERENCE_MODALITIES,
  promptCategoryForLibrary,
  type PromptModality,
  type PromptReference,
} from "@/data/promptReferenceLibrary";

const DIFFICULTY_BADGES: Record<
  PromptReference["difficulty"],
  { label: string; cls: string }
> = {
  beginner: { label: "入門", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  intermediate: { label: "進階", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  advanced: { label: "高級", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" },
};

const LANGUAGE_LABEL: Record<PromptReference["language"], string> = {
  zh: "中",
  en: "EN",
  mixed: "中/EN",
};

// ─────────────────────────────────────────────────────────────────────────────
// PromptCard
// ─────────────────────────────────────────────────────────────────────────────

function PromptCard({
  prompt,
  onSaveToLibrary,
  savingId,
  isAuthed,
}: {
  prompt: PromptReference;
  onSaveToLibrary: (p: PromptReference) => void;
  savingId: string | null;
  isAuthed: boolean;
}) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const meta = PROMPT_MODALITY_META[prompt.modality];
  const diff = DIFFICULTY_BADGES[prompt.difficulty];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      toast.success("已複製到剪貼簿");
    } catch {
      toast.error("複製失敗，請手動選取");
    }
  };

  const handleCopyNegative = async () => {
    if (!prompt.negativePrompt) return;
    try {
      await navigator.clipboard.writeText(prompt.negativePrompt);
      toast.success("已複製負面提示詞");
    } catch {
      toast.error("複製失敗");
    }
  };

  const isLong = prompt.prompt.length > 240;
  const displayed = expanded || !isLong ? prompt.prompt : `${prompt.prompt.slice(0, 240)}…`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border ${meta.border} bg-card hover:shadow-md transition-shadow overflow-hidden flex flex-col`}
    >
      {/* Header strip */}
      <div className={`${meta.bg} px-4 py-3 border-b ${meta.border} flex items-start justify-between gap-2`}>
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-lg leading-none mt-0.5">{meta.emoji}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] ${meta.color} border-current/30 bg-card/60`}>
                {meta.label}
              </Badge>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${diff.cls}`}>
                {diff.label}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {LANGUAGE_LABEL[prompt.language]}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-foreground mt-1.5 line-clamp-1">{prompt.title}</h3>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <p className="hs-small !mb-0 text-muted-foreground line-clamp-2">{prompt.summary}</p>

        {/* Prompt content */}
        <div className="rounded-xl bg-muted/40 dark:bg-muted/20 border border-border/60 p-3">
          <pre className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap font-mono">{displayed}</pre>
          {isLong && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-2 text-[11px] text-primary hover:underline flex items-center gap-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  收合
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  顯示完整提示詞
                </>
              )}
            </button>
          )}
        </div>

        {/* Negative prompt */}
        {prompt.negativePrompt && (
          <details className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-3">
            <summary className="text-[11px] font-medium text-rose-700 dark:text-rose-300 cursor-pointer flex items-center gap-1">
              <Filter className="w-3 h-3" />
              負面提示詞（Negative Prompt）
            </summary>
            <pre className="text-[11px] mt-2 text-rose-900/90 dark:text-rose-200/90 whitespace-pre-wrap font-mono">
              {prompt.negativePrompt}
            </pre>
            <button
              onClick={handleCopyNegative}
              className="mt-2 text-[11px] text-rose-700 dark:text-rose-300 hover:underline"
            >
              複製負面提示詞
            </button>
          </details>
        )}

        {/* Meta — model hint, references */}
        <div className="flex flex-wrap gap-1.5 items-center text-[10px]">
          {prompt.modelHint && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              <Wand2 className="w-3 h-3" />
              {prompt.modelHint}
            </span>
          )}
          {prompt.tags.slice(0, 4).map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>

        {/* Example output */}
        {prompt.example?.expectedOutput && (
          <div className="rounded-lg border border-dashed border-border/60 p-2.5 text-[11px]">
            <p className="text-muted-foreground font-medium mb-1">範例輸出：</p>
            <pre className="font-mono text-foreground/80 whitespace-pre-wrap">{prompt.example.expectedOutput}</pre>
          </div>
        )}

        {/* References */}
        {prompt.references && prompt.references.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {prompt.references.map(ref => (
              <button
                key={ref.href}
                onClick={() => navigate(ref.href)}
                className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/5 text-primary hover:bg-primary/10"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                {ref.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t bg-muted/30 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy} className="text-xs gap-1.5 h-8 rounded-full flex-1">
          <Copy className="w-3.5 h-3.5" />
          複製提示詞
        </Button>
        {isAuthed && (
          <Button
            size="sm"
            variant="default"
            disabled={savingId === prompt.id}
            onClick={() => onSaveToLibrary(prompt)}
            className="text-xs gap-1.5 h-8 rounded-full flex-1"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            {savingId === prompt.id ? "儲存中…" : "存到我的詞庫"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptReferenceTab — 主元件
// ─────────────────────────────────────────────────────────────────────────────

export default function PromptReferenceTab() {
  const { user } = useAuth();
  const isAuthed = !!user;
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [selectedModality, setSelectedModality] = useState<"all" | PromptModality>("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState<
    "all" | PromptReference["difficulty"]
  >("all");
  const [savingId, setSavingId] = useState<string | null>(null);

  const createMut = trpc.promptLibrary.create.useMutation({
    onMutate: vars => {
      // vars.title is not the id; we track via the calling fn
      void vars;
    },
    onSuccess: () => {
      toast.success("已加入個人提示詞庫");
      setSavingId(null);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "儲存失敗");
      setSavingId(null);
    },
  });

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return PROMPT_REFERENCE_LIBRARY.filter(p => {
      if (selectedModality !== "all" && p.modality !== selectedModality) return false;
      if (selectedDifficulty !== "all" && p.difficulty !== selectedDifficulty) return false;
      if (!lowered) return true;
      return (
        p.title.toLowerCase().includes(lowered) ||
        p.summary.toLowerCase().includes(lowered) ||
        p.prompt.toLowerCase().includes(lowered) ||
        p.tags.some(t => t.toLowerCase().includes(lowered))
      );
    });
  }, [search, selectedModality, selectedDifficulty]);

  const modalityCounts = useMemo(() => {
    const map: Record<string, number> = { all: PROMPT_REFERENCE_LIBRARY.length };
    for (const m of PROMPT_REFERENCE_MODALITIES) {
      map[m] = PROMPT_REFERENCE_LIBRARY.filter(p => p.modality === m).length;
    }
    return map;
  }, []);

  const handleSaveToLibrary = (p: PromptReference) => {
    if (!isAuthed) {
      toast.error("請先登入才能儲存到個人提示詞庫");
      return;
    }
    setSavingId(p.id);
    createMut.mutate({
      title: p.title,
      content: p.prompt,
      category: promptCategoryForLibrary(p.modality),
      tags: p.tags.slice(0, 10),
      isPublic: false,
      modelHint: p.modelHint?.slice(0, 128),
      language: p.language === "en" ? "en" : "zh",
    });
  };

  return (
    <div className="space-y-5">
      {/* ── Section heading ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-purple-500/10 border border-fuchsia-200/50 dark:border-fuchsia-900/40 shrink-0">
            <Sparkles className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-300" />
          </div>
          <div>
            <h2 className="hs-h3 !mb-0 text-foreground">提示詞庫 · 深度收錄</h2>
            <p className="hs-small !mb-0 text-muted-foreground">
              {PROMPT_REFERENCE_LIBRARY.length} 條多模態 / 代理人呼叫 / 系統提示詞，可一鍵複製或存到個人詞庫
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/prompt-library")}
          className="gap-1.5 rounded-full"
        >
          <Library className="w-4 h-4" />
          我的提示詞庫
        </Button>
      </div>

      {/* ── Search ──────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋提示詞標題、內容或標籤…"
          className="pl-10 pr-4 py-2.5 rounded-xl bg-muted/30 border-muted text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Modality filter ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedModality("all")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
            selectedModality === "all"
              ? "bg-primary text-primary-foreground shadow-md"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          全部
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${selectedModality === "all" ? "bg-card/20" : "bg-primary/10 text-primary"}`}
          >
            {modalityCounts.all}
          </span>
        </button>
        {PROMPT_REFERENCE_MODALITIES.map(m => {
          const meta = PROMPT_MODALITY_META[m];
          const active = selectedModality === m;
          return (
            <button
              key={m}
              onClick={() => setSelectedModality(m)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                active
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span>{meta.emoji}</span>
              {meta.label}
              {modalityCounts[m] > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-card/20" : "bg-primary/10 text-primary"}`}
                >
                  {modalityCounts[m]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Difficulty filter ───────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "beginner", "intermediate", "advanced"] as const).map(d => (
          <button
            key={d}
            onClick={() => setSelectedDifficulty(d)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium ${
              selectedDifficulty === d ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {d === "all" ? "所有難度" : d === "beginner" ? "入門" : d === "intermediate" ? "進階" : "高級"}
          </button>
        ))}
      </div>

      {/* ── Grid ────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground hs-small !mb-0">找不到符合條件的提示詞</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {filtered.map(p => (
              <PromptCard
                key={p.id}
                prompt={p}
                onSaveToLibrary={handleSaveToLibrary}
                savingId={savingId}
                isAuthed={isAuthed}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Bottom info ─────────────────────────────────────────── */}
      <div className="mt-8 p-4 rounded-2xl bg-gradient-to-br from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/20 border border-fuchsia-100 dark:border-fuchsia-900/40 flex items-start gap-3">
        <Star className="w-4 h-4 text-fuchsia-500 fill-fuchsia-300 mt-0.5 shrink-0" />
        <div className="text-xs text-fuchsia-700 dark:text-fuchsia-200 space-y-1">
          <p className="font-semibold">關於提示詞庫</p>
          <p>
            本庫是策展的<strong>參考範例</strong>，按模態與代理人呼叫類型分類。
            點「存到我的詞庫」會複製到 <button onClick={() => navigate("/prompt-library")} className="underline">/prompt-library</button>，你可以再編輯、收藏、設定公開。
          </p>
        </div>
      </div>
    </div>
  );
}
