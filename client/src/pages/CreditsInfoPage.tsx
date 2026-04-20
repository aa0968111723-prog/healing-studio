import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";
import {
  Coins,
  Gift,
  ShieldCheck,
  RotateCcw,
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
  Image,
  Film,
  Music,
  Mic,
  Box,
  Cpu,
  Brain,
  HelpCircle,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

// ─── Tier Config ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  free: {
    label: "免費",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  economy: {
    label: "經濟",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  standard: {
    label: "標準",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  premium: {
    label: "進階",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  ultra: {
    label: "頂級",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode }> =
  {
    "text-to-image": { label: "文字生圖", icon: <Image className="w-4 h-4" /> },
    "image-to-image": {
      label: "圖片轉換",
      icon: <Image className="w-4 h-4" />,
    },
    "text-to-video": {
      label: "文字生影片",
      icon: <Film className="w-4 h-4" />,
    },
    "image-to-video": {
      label: "圖片生影片",
      icon: <Film className="w-4 h-4" />,
    },
    "video-to-video": { label: "影片轉換", icon: <Film className="w-4 h-4" /> },
    "text-to-audio": {
      label: "音樂/音效生成",
      icon: <Music className="w-4 h-4" />,
    },
    "video-to-audio": {
      label: "影片配音",
      icon: <Music className="w-4 h-4" />,
    },
    "text-to-speech": {
      label: "語音合成 (TTS)",
      icon: <Mic className="w-4 h-4" />,
    },
    "image-to-3d": { label: "圖片轉 3D", icon: <Box className="w-4 h-4" /> },
    "text-to-3d": { label: "文字生 3D", icon: <Box className="w-4 h-4" /> },
    "video-to-text": { label: "語音辨識", icon: <Mic className="w-4 h-4" /> },
    training: { label: "模型訓練", icon: <Cpu className="w-4 h-4" /> },
    reasoning: { label: "AI 推理", icon: <Brain className="w-4 h-4" /> },
    llm: { label: "LLM 對話", icon: <Brain className="w-4 h-4" /> },
    "image-to-json": { label: "圖片分析", icon: <Brain className="w-4 h-4" /> },
    embedding: { label: "向量嵌入", icon: <Brain className="w-4 h-4" /> },
    json: { label: "JSON 生成", icon: <Brain className="w-4 h-4" /> },
    "text-to-json": { label: "文字分析", icon: <Brain className="w-4 h-4" /> },
  };

// Priority order for categories
const CATEGORY_ORDER = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "video-to-video",
  "text-to-audio",
  "video-to-audio",
  "text-to-speech",
  "image-to-3d",
  "text-to-3d",
  "video-to-text",
  "training",
  "reasoning",
  "llm",
  "image-to-json",
];

// ─── Collapsible Category Table ────────────────────────────────────────────

function CategoryTable({
  category,
  models,
  defaultOpen,
}: {
  category: string;
  models: Array<{
    label: string;
    tier: string;
    basePoints: number;
    unit: string;
    minPoints: number;
    maxPoints: number;
    pointsPerSecond?: number;
    pointsPer1kChars?: number;
    pointsPerStep?: number;
  }>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = CATEGORY_META[category] ?? {
    label: category,
    icon: <Sparkles className="w-4 h-4" />,
  };

  return (
    <GlassCard className="overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {meta.icon}
          <span className="font-semibold text-sm">{meta.label}</span>
          <Badge variant="outline" className="text-[10px] ml-1">
            {models.length} 個模型
          </Badge>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b">
                <th className="py-2 pr-3">模型</th>
                <th className="py-2 pr-3">等級</th>
                <th className="py-2 pr-3 text-right">基礎積分</th>
                <th className="py-2 pr-3">單位</th>
                <th className="py-2 pr-3 text-right">範圍</th>
                {models.some(m => m.pointsPerSecond) && (
                  <th className="py-2 pr-3 text-right">每秒加收</th>
                )}
                {models.some(m => m.pointsPer1kChars) && (
                  <th className="py-2 pr-3 text-right">每千字符</th>
                )}
                {models.some(m => m.pointsPerStep) && (
                  <th className="py-2 pr-3 text-right">每步驟</th>
                )}
              </tr>
            </thead>
            <tbody>
              {models.map(m => {
                const tier = TIER_LABELS[m.tier] ?? TIER_LABELS.standard;
                return (
                  <tr
                    key={m.label}
                    className="border-b border-border/30 hover:bg-accent/20 transition-colors"
                  >
                    <td className="py-2 pr-3 font-medium">{m.label}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${tier.color}`}
                      >
                        {tier.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                      {m.basePoints}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {m.unit}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {m.minPoints}–{m.maxPoints}
                    </td>
                    {models.some(m2 => m2.pointsPerSecond) && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.pointsPerSecond ? `${m.pointsPerSecond} pts/s` : "—"}
                      </td>
                    )}
                    {models.some(m2 => m2.pointsPer1kChars) && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.pointsPer1kChars ? `${m.pointsPer1kChars} pts` : "—"}
                      </td>
                    )}
                    {models.some(m2 => m2.pointsPerStep) && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.pointsPerStep ? `${m.pointsPerStep} pts` : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}

// ─── FAQ Item ──────────────────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/30 last:border-0">
      <button
        type="button"
        className="w-full flex items-start justify-between px-4 py-3 text-left hover:bg-accent/20 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-medium pr-4">{q}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 text-sm text-muted-foreground">{a}</div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function CreditsInfoPage() {
  const [, navigate] = useLocation();
  const {
    data: catalog,
    isLoading,
    error: catalogError,
  } = trpc.credits.pricingCatalog.useQuery();
  const { data: balance, isLoading: balanceLoading } =
    trpc.credits.myBalance.useQuery(undefined, {
      retry: false,
    });

  const sortedCategories = catalog
    ? CATEGORY_ORDER.filter(cat => cat in catalog).concat(
        Object.keys(catalog).filter(cat => !CATEGORY_ORDER.includes(cat))
      )
    : [];

  // ─── PageAgent 註冊（Phase 4b：積分說明接入光球） ────────────────────────
  // 積分頁本身唯讀，光球主要用處：把 remaining / 模型費率摘要送進 LLM 上下文，
  // 另外提供「前往學習文件」「前往儀表板」「前往分享空間賺積分」快捷 navigate。
  const CREDITS_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/learn", "/dashboard", "/shared", "/assets"]),
    []
  );
  const creditsAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "跳到相關頁面",
        options: [
          { id: "/learn", label: "學習文件中心", meta: { bestFor: "降耗學習", tip: "先學低成本試稿流程" } },
          { id: "/dashboard", label: "儀表板", meta: { bestFor: "成本監控", tip: "追蹤單次生成成本變化" } },
          { id: "/shared", label: "共享空間", meta: { bestFor: "分享賺積分", tip: "高品質可復用資產優先分享" } },
          { id: "/assets", label: "數位資產庫", meta: { bestFor: "資產盤點", tip: "清理重複素材避免浪費生成" } },
        ],
        hint: "navigate path='/learn'（文件）| '/dashboard'（看用量）| '/shared'（分享賺積分）| '/assets'（我的資產）",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "credits",
    pageLabel: "積分說明",
    pagePath: "/credits",
    capabilities: creditsAgentCapabilities,
    state: {
      remainingCredits: balance?.remaining ?? null,
      categoriesLoaded: sortedCategories.length,
      hasCatalog: !!catalog,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate") {
        const path = String(action.path ?? "");
        if (!CREDITS_NAV_ALLOWLIST.has(path)) {
          return { ok: false, reason: `不在允許跳轉清單：${path}` };
        }
        navigate(path);
        return { ok: true, message: `跳到 ${path}` };
      }
      return {
        ok: false,
        reason: `unsupported on credits: ${action.type}`,
      };
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-2">
          <Coins className="w-7 h-7 text-primary" />
          <h1 className="hs-h1 !mb-0">積分說明</h1>
        </div>
        <p className="hs-p !mb-0 text-muted-foreground">
          Healing Studio 使用「平台積分」作為所有 AI 生成的計費單位。
          <strong className="text-foreground">
            {" "}
            不需要信用卡，不涉及任何真實金錢交易。
          </strong>
        </p>
      </motion.div>

      {/* Balance Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <GlassCard className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              我的積分餘額
            </p>
            {balanceLoading ? (
              <ZenSkeleton className="h-9 w-32 mt-1 rounded" />
            ) : balance != null ? (
              <p className="text-3xl font-bold tabular-nums mt-1 text-primary">
                {balance.remaining}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  pts
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                請登入後查看餘額
              </p>
            )}
          </div>
          <Zap className="w-10 h-10 text-primary/30" />
        </GlassCard>
      </motion.div>

      {/* Key Info Cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="w-5 h-5 text-primary" />
            <h3 className="hs-h3 !mb-0">積分取得方式</h3>
          </div>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                新帳號註冊：自動獲得{" "}
                <strong className="text-foreground">50 積分</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                首次分享數位資產：
                <strong className="text-foreground">+2 積分</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                首次分享訓練模型：
                <strong className="text-foreground">+3 積分</strong>
                （模型需已完成）
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>管理員手動加分</span>
            </li>
          </ul>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h3 className="hs-h3 !mb-0">安全保障</h3>
          </div>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                <strong className="text-foreground">先扣後生成</strong>
                ：積分在生成前原子扣除
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                <strong className="text-foreground">失敗全額退還</strong>
                ：任何生成失敗自動退回積分
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                最小扣除 <strong className="text-foreground">1 pts</strong>
                ，安全上限 <strong className="text-foreground">500 pts</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold mt-px">•</span>
              <span>
                積分永久有效，
                <strong className="text-foreground">不需要信用卡</strong>
              </span>
            </li>
          </ul>
        </GlassCard>
      </motion.div>

      {/* Refund Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <RotateCcw className="w-5 h-5 text-primary" />
            <h3 className="hs-h3 !mb-0">退還機制</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground text-xs border-b">
                  <th className="py-2 pr-3">情境</th>
                  <th className="py-2 text-center">是否退還</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {[
                  { scenario: "安全檢查未通過", refund: true },
                  { scenario: "圖片生成 API 錯誤", refund: true },
                  { scenario: "影片生成 API 錯誤", refund: true },
                  { scenario: "音樂生成 API 錯誤", refund: true },
                  { scenario: "語音生成 API 錯誤", refund: true },
                  { scenario: "任務逾時（Timeout）", refund: true },
                  { scenario: "生成成功", refund: false },
                ].map(row => (
                  <tr key={row.scenario} className="border-b border-border/30">
                    <td className="py-2 pr-3">{row.scenario}</td>
                    <td className="py-2 text-center">
                      {row.refund ? (
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          ✅ 全額退還
                        </span>
                      ) : (
                        <span className="text-muted-foreground">❌ 不退還</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </motion.div>

      {/* No Real Money Banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.22 }}
      >
        <GlassCard className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-foreground mb-1">
                🚫 不使用真實金錢
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Healing Studio
                的積分系統完全獨立於真實貨幣。你不需要綁定信用卡、不需要付費購買積分。
                所有積分均由平台免費發放（註冊贈送、分享獎勵、管理員調整）。
                積分僅用於平衡平台 AI 資源的使用，確保每位用戶都能公平享用。
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Pricing Catalog */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.25 }}
        className="space-y-3"
      >
        <h2 className="hs-h2 !mb-0 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          完整模型費率表
        </h2>
        <p className="hs-small !mb-0 text-muted-foreground mb-3">
          點擊分類展開查看各模型的詳細積分費率。積分範圍表示該模型的最低到最高單次扣除上限。
        </p>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <ZenSkeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        )}

        {catalogError && (
          <GlassCard className="p-4 border-destructive/30">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p>無法載入費率表，請稍後重試。</p>
            </div>
          </GlassCard>
        )}

        {catalog &&
          sortedCategories.map((cat, idx) => (
            <CategoryTable
              key={cat}
              category={cat}
              models={catalog[cat] ?? []}
              defaultOpen={idx < 3}
            />
          ))}
      </motion.div>

      {/* Formula */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <GlassCard className="p-4">
          <h3 className="hs-h3 !mb-0 flex items-center gap-2 mb-3">
            <HelpCircle className="w-4 h-4 text-primary" />
            計費公式
          </h3>
          <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs leading-relaxed">
            <p>最終積分 = max(最低積分, min(最高積分,</p>
            <p className="pl-4">
              基礎積分 + 時長加收 + 字符加收 + 批次加收 + 步驟加收
            </p>
            <p>))</p>
          </div>
          <p className="hs-small !mb-0 text-muted-foreground mt-2">
            每個模型都有最低和最高積分限制，防止異常計費。計費前會先預估並顯示費用供確認。
          </p>
        </GlassCard>
      </motion.div>

      {/* FAQ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.35 }}
      >
        <h2 className="hs-h2 !mb-0 mb-3">常見問題</h2>
        <GlassCard className="overflow-hidden">
          <FAQItem
            q="積分用完了怎麼辦？"
            a="可以透過分享作品獲得獎勵積分（首次分享資產 +2 pts，首次分享模型 +3 pts），或聯繫平台管理員申請加分。"
          />
          <FAQItem
            q="生成失敗會扣積分嗎？"
            a="不會！所有失敗的生成任務（包含安全檢查失敗、API 錯誤、逾時等）都會自動全額退還已扣除的積分。"
          />
          <FAQItem
            q="積分有使用期限嗎？"
            a="目前沒有使用期限，積分永久有效。"
          />
          <FAQItem
            q="需要付費或綁定信用卡嗎？"
            a="完全不需要！本平台所有功能均以免費積分運作，不涉及任何真實金錢交易，也不需要綁定任何支付方式。"
          />
          <FAQItem
            q="示範模式（Demo）會扣積分嗎？"
            a="不會。示範模式使用範例素材展示功能，不消耗任何積分。"
          />
          <FAQItem
            q="在哪裡查看我的積分餘額？"
            a="側邊欄下方的「剩餘配額」卡片即可即時查看，也可以在本頁面頂部看到你的餘額。"
          />
          <FAQItem
            q="分享作品可以重複獲得獎勵嗎？"
            a="不行。每個作品或模型僅在首次分享至共享空間時獲得一次獎勵，之後切換回私人再重新分享不會再次加分。"
          />
        </GlassCard>
      </motion.div>

      {/* Learn More Link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        className="text-center pt-4"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/learn">前往學習文件中心查看更多說明 →</Link>
        </Button>
      </motion.div>
    </div>
  );
}
