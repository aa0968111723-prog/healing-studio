/**
 * PersonalDatabasePanel.tsx — 學習中心「個人資料庫」面板
 *
 * 入口 + 詳細資訊一站式整合：
 *  - 上方總覽：總數 + 7 種媒體類型分布 + 可見性分布
 *  - 中間：最近 5 筆上傳（含轉文字 / OCR 狀態）
 *  - 右側：快速操作（上傳、瀏覽全部、團隊管理）
 *  - 底部：RAG 引用機制說明
 *
 * 資料源：trpc.teachingArchive.list（個人視野），對未登入者顯示功能介紹卡。
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Database,
  Upload,
  FileText,
  FileType2,
  Image as ImageIcon,
  Film,
  Music,
  Presentation,
  Sparkles,
  Lock,
  Users,
  Globe2,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Brain,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const MEDIA_META: Record<
  string,
  { label: string; icon: any; color: string; bg: string }
> = {
  text: { label: "純文字", icon: FileText, color: "text-slate-600 dark:text-slate-300", bg: "bg-slate-100 dark:bg-slate-900/60" },
  pdf: { label: "PDF", icon: FileType2, color: "text-rose-600 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-950/40" },
  document: { label: "Word/TXT", icon: FileText, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-950/40" },
  image: { label: "圖片", icon: ImageIcon, color: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  video: { label: "影片", icon: Film, color: "text-indigo-600 dark:text-indigo-300", bg: "bg-indigo-50 dark:bg-indigo-950/40" },
  audio: { label: "語音", icon: Music, color: "text-cyan-600 dark:text-cyan-300", bg: "bg-cyan-50 dark:bg-cyan-950/40" },
  presentation: { label: "簡報", icon: Presentation, color: "text-orange-600 dark:text-orange-300", bg: "bg-orange-50 dark:bg-orange-950/40" },
};

const MEDIA_ORDER = ["pdf", "document", "image", "video", "audio", "presentation", "text"] as const;

const VISIBILITY_META = {
  private: { label: "私人", icon: Lock, color: "text-slate-600 dark:text-slate-300" },
  team_shared: { label: "團隊", icon: Users, color: "text-blue-600 dark:text-blue-300" },
  public_disciples: { label: "公開", icon: Globe2, color: "text-emerald-600 dark:text-emerald-300" },
} as const;

function relativeTimeZh(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "剛剛";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小時前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return date.toLocaleDateString("zh-TW");
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (status === "completed") {
    return (
      <span className="text-[10px] flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-2.5 h-2.5" />
        已索引
      </span>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <span className="text-[10px] flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        處理中
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-[10px] flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
        <AlertCircle className="w-2.5 h-2.5" />
        失敗
      </span>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────────────────────────────────────

export default function PersonalDatabasePanel() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAuthed = !!user;

  // 只在登入時查資料；未登入顯示功能介紹卡
  const listQuery = trpc.teachingArchive.list.useQuery(
    {},
    { enabled: isAuthed, staleTime: 30_000 }
  );
  const items = listQuery.data ?? [];

  const stats = useMemo(() => {
    const byMedia: Record<string, number> = {};
    const byVisibility: Record<string, number> = { private: 0, team_shared: 0, public_disciples: 0 };
    let indexed = 0;
    let pending = 0;
    for (const item of items) {
      byMedia[item.mediaType] = (byMedia[item.mediaType] ?? 0) + 1;
      byVisibility[item.visibility] = (byVisibility[item.visibility] ?? 0) + 1;
      if (item.transcriptionStatus === "completed") indexed += 1;
      if (item.transcriptionStatus === "pending" || item.transcriptionStatus === "processing") pending += 1;
    }
    return { byMedia, byVisibility, total: items.length, indexed, pending };
  }, [items]);

  const recent = useMemo(() => items.slice(0, 5), [items]);

  // ── 未登入：純介紹卡 ──────────────────────────────────────
  if (!isAuthed) {
    return (
      <UnauthedIntro onLogin={() => navigate("/login")} />
    );
  }

  // ── 已登入但無資料：歡迎卡 ────────────────────────────────
  if (!listQuery.isLoading && items.length === 0) {
    return <EmptyState onUpload={() => navigate("/teaching-archive?openUpload=1")} onLearn={() => navigate("/learn?docId=deep-cross-modal")} />;
  }

  // ── 已登入且有資料：完整面板 ──────────────────────────────
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/70 via-orange-50/40 to-rose-50/30 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-rose-950/15 overflow-hidden"
    >
      {/* Header strip */}
      <div className="px-5 py-4 border-b border-amber-200/40 dark:border-amber-900/30 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/60 shrink-0">
            <Database className="w-5 h-5 text-amber-700 dark:text-amber-300" />
          </div>
          <div className="min-w-0">
            <h2 className="hs-h3 !mb-0 text-foreground">個人資料庫</h2>
            <p className="hs-small !mb-0 text-muted-foreground">
              你的 RAG 訓練素材庫 · 上傳即可被 AI 引用回答
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/teaching-archive?openUpload=1")}
            className="gap-1.5 rounded-full"
          >
            <Upload className="w-4 h-4" />
            上傳新素材
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/teaching-archive")}
            className="gap-1.5 rounded-full"
          >
            進入資料庫
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        {/* ─── 左 / 中：總覽 + 媒體分布 + 最近上傳 ─── */}
        <div className="lg:col-span-2 p-5 space-y-5 border-b lg:border-b-0 lg:border-r border-amber-200/40 dark:border-amber-900/30">
          {/* 統計列 */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="總筆數"
              value={stats.total}
              suffix="件"
              icon={Database}
              tone="amber"
            />
            <StatCard
              label="已索引"
              value={stats.indexed}
              suffix={`/ ${stats.total}`}
              icon={CheckCircle2}
              tone="emerald"
            />
            <StatCard
              label="處理中"
              value={stats.pending}
              suffix="件"
              icon={Loader2}
              tone="blue"
              animate={stats.pending > 0}
            />
          </div>

          {/* 媒體類型分布 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              媒體類型分布
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {MEDIA_ORDER.map(mt => {
                const meta = MEDIA_META[mt];
                const Icon = meta.icon;
                const count = stats.byMedia[mt] ?? 0;
                return (
                  <button
                    key={mt}
                    onClick={() => navigate(`/teaching-archive?mediaType=${mt}`)}
                    className={`rounded-xl border p-2.5 text-left transition-all hover:shadow-sm hover:-translate-y-0.5 ${
                      count > 0
                        ? `${meta.bg} border-transparent`
                        : "bg-muted/30 border-border/40"
                    }`}
                    title={`篩選 ${meta.label}`}
                  >
                    <Icon className={`w-3.5 h-3.5 mb-1 ${count > 0 ? meta.color : "text-muted-foreground/40"}`} />
                    <div className={`text-[11px] font-medium ${count > 0 ? meta.color : "text-muted-foreground/60"}`}>
                      {meta.label}
                    </div>
                    <div className={`text-sm font-bold ${count > 0 ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {count}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 可見性分布 */}
          {stats.total > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-muted-foreground">可見性：</span>
              {(["private", "team_shared", "public_disciples"] as const).map(v => {
                const meta = VISIBILITY_META[v];
                const Icon = meta.icon;
                const count = stats.byVisibility[v] ?? 0;
                if (count === 0) return null;
                return (
                  <button
                    key={v}
                    onClick={() => navigate(`/teaching-archive?scope=${v === "private" ? "mine" : v === "team_shared" ? "team" : "public"}`)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-card/70 border border-border/40 hover:bg-card transition-colors"
                  >
                    <Icon className={`w-3 h-3 ${meta.color}`} />
                    <span className="text-foreground/80">{meta.label}</span>
                    <span className="font-semibold text-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 最近上傳 */}
          {recent.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                最近上傳
              </h3>
              <ul className="space-y-1.5">
                {recent.map(item => {
                  const meta = MEDIA_META[item.mediaType] ?? MEDIA_META.text;
                  const Icon = meta.icon;
                  const vis = VISIBILITY_META[item.visibility as keyof typeof VISIBILITY_META] ?? VISIBILITY_META.private;
                  const VisIcon = vis.icon;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2.5 rounded-lg bg-card/70 border border-border/40 px-3 py-2 hover:bg-card hover:border-border transition-colors cursor-pointer"
                      onClick={() => navigate(`/teaching-archive?openId=${item.id}`)}
                    >
                      <div className={`p-1.5 rounded-md ${meta.bg} shrink-0`}>
                        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {item.title}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
                          <span>{meta.label}</span>
                          <span>·</span>
                          <span>{relativeTimeZh(item.createdAt)}</span>
                          <VisIcon className={`w-2.5 h-2.5 ${vis.color}`} />
                        </div>
                      </div>
                      <StatusBadge status={item.transcriptionStatus} />
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* ─── 右：RAG 引用 + 操作 ─── */}
        <div className="p-5 space-y-4 bg-gradient-to-b from-transparent to-amber-100/30 dark:to-amber-950/20">
          {/* RAG 說明 */}
          <div className="rounded-xl bg-card/80 border border-amber-200/50 dark:border-amber-900/40 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60">
                <Brain className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">AI 自動引用機制</h3>
            </div>
            <p className="text-[11px] text-muted-foreground/90 leading-relaxed">
              上傳後系統會自動：
            </p>
            <ol className="text-[11px] text-foreground/85 leading-relaxed space-y-1 pl-4 list-decimal">
              <li>PDF / Word 抽取文字</li>
              <li>語音 / 影片 WhisperX 轉字</li>
              <li>切片並嵌入 Pinecone 向量索引</li>
              <li>光球回答時自動檢索 Top-3 相關段落注入</li>
            </ol>
            <button
              onClick={() => navigate("/learn?docId=api-pinecone-rag")}
              className="text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 mt-1"
            >
              <Sparkles className="w-3 h-3" />
              Pinecone RAG 系統詳解
            </button>
          </div>

          {/* 支援檔案類型 */}
          <div className="rounded-xl bg-card/60 border border-border/40 p-3.5">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">支援格式</h3>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-start gap-2">
                <FileType2 className="w-3 h-3 text-rose-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">PDF</strong>：講義、稿件、報告</span>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="w-3 h-3 text-blue-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">文件</strong>：Word / TXT / Markdown</span>
              </div>
              <div className="flex items-start gap-2">
                <ImageIcon className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">圖片</strong>：照片、圖像、截圖</span>
              </div>
              <div className="flex items-start gap-2">
                <Film className="w-3 h-3 text-indigo-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">影片</strong>：自動轉字幕</span>
              </div>
              <div className="flex items-start gap-2">
                <Music className="w-3 h-3 text-cyan-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">語音</strong>：講座、訪談、錄音</span>
              </div>
              <div className="flex items-start gap-2">
                <Presentation className="w-3 h-3 text-orange-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">簡報</strong>：PPT / PPTX</span>
              </div>
            </div>
          </div>

          {/* 隱私三層級 */}
          <div className="rounded-xl bg-card/60 border border-border/40 p-3.5">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">隱私三層級</h3>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <Lock className="w-3 h-3 text-slate-600 shrink-0" />
                <span><strong className="text-foreground">私人</strong>：僅本人 + AI 引用</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-3 h-3 text-blue-600 shrink-0" />
                <span><strong className="text-foreground">團隊共享</strong>：同團隊成員可見</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe2 className="w-3 h-3 text-emerald-600 shrink-0" />
                <span><strong className="text-foreground">全 workspace</strong>：所有用戶可見</span>
              </div>
            </div>
            <button
              onClick={() => navigate("/teams")}
              className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-1 mt-2"
            >
              <Users className="w-3 h-3" />
              管理我的團隊
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 子元件
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  tone,
  animate,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: any;
  tone: "amber" | "emerald" | "blue";
  animate?: boolean;
}) {
  const toneCls = {
    amber: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
    emerald: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
    blue: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
  }[tone];
  return (
    <div className="rounded-xl bg-card/70 border border-border/40 p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1 rounded-md ${toneCls}`}>
          <Icon className={`w-3 h-3 ${animate ? "animate-spin" : ""}`} />
        </div>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
        {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function EmptyState({ onUpload, onLearn }: { onUpload: () => void; onLearn: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-3xl border border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/70 to-orange-50/40 dark:from-amber-950/30 dark:to-orange-950/20 p-6 space-y-4"
    >
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-amber-100 dark:bg-amber-900/60 shrink-0">
          <Database className="w-7 h-7 text-amber-700 dark:text-amber-300" />
        </div>
        <div className="flex-1">
          <h2 className="hs-h3 !mb-0 text-foreground">個人資料庫</h2>
          <p className="hs-small !mb-0 text-muted-foreground mt-1">
            上傳你的 PDF / 文件 / 圖片 / 影片 / 語音 / 簡報，AI 助理會自動引用內容回答你的問題。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FeatureBullet icon={Upload} title="一鍵上傳" desc="拖拉檔案或選取，自動分類保存" />
        <FeatureBullet icon={Brain} title="自動轉字 / 抽文" desc="PDF / 語音 / 影片自動可搜尋" />
        <FeatureBullet icon={Sparkles} title="AI 引用回答" desc="光球從你的資料庫檢索答案" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onUpload} className="gap-1.5 rounded-full">
          <Upload className="w-4 h-4" />
          立刻上傳第一份素材
        </Button>
        <Button variant="outline" onClick={onLearn} className="gap-1.5 rounded-full">
          <Sparkles className="w-4 h-4" />
          看 RAG 串接教學
        </Button>
      </div>
    </motion.section>
  );
}

function FeatureBullet({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-card/80 border border-border/40 p-3">
      <Icon className="w-4 h-4 text-amber-600 mb-1.5" />
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
    </div>
  );
}

function UnauthedIntro({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="rounded-3xl border border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/70 to-orange-50/40 dark:from-amber-950/30 dark:to-orange-950/20 p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-amber-100 dark:bg-amber-900/60 shrink-0">
          <Database className="w-7 h-7 text-amber-700 dark:text-amber-300" />
        </div>
        <div>
          <h2 className="hs-h3 !mb-0 text-foreground">個人資料庫（需登入）</h2>
          <p className="hs-small !mb-0 text-muted-foreground mt-1">
            上傳 PDF / 文件 / 圖片 / 影片 / 語音 / 簡報，AI 助理可引用內容回答。登入後即可使用。
          </p>
        </div>
      </div>
      <Button onClick={onLogin} className="gap-1.5 rounded-full">
        登入以使用個人資料庫
        <ArrowRight className="w-4 h-4" />
      </Button>
    </section>
  );
}
