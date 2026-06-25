/**
 * OrbMemoryDashboard.tsx — 光球記憶儀表板。
 *
 * PR #419 把多維反問的 picks 寫進 OrbMemory 但完全隱形。這個元件把 LLM 內部
 * 的偏好記憶搬到使用者眼前：
 *   - 風格 / 平台 / 用途 / 偏好模型 各一排 chips
 *   - 每張 chip 有 ✕，點選刪除單一偏好
 *   - 「全部清掉」按鈕一次重置
 *
 * 設計原則：建立信任感（看得見光球記得什麼）+ 控制感（可以隨時清掉）。
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, X, Sparkles, Layers, Target, Cpu, RefreshCw, BookOpen } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RowProps {
  label: string;
  icon: typeof Brain;
  values: string[];
  tone: string;
  onRemove: (value: string) => void;
}

function MemoryRow({ label, icon: Icon, values, tone, onRemove }: RowProps) {
  if (!values || values.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="w-3 h-3" />
        {label}
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground/70 normal-case tracking-normal">{values.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {values.map(v => (
            <motion.button
              key={v}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.18 }}
              onClick={() => onRemove(v)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:shadow-sm ${tone}`}
              data-testid="orb-memory-chip"
            >
              <span>{v}</span>
              <X className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface Props {
  /** Compact mode for inline panel embedding. */
  compact?: boolean;
}

export default function OrbMemoryDashboard({ compact }: Props) {
  const utils = trpc.useUtils();
  const memoryQuery = trpc.orbProxy.getRememberedPreferences.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const patternsQuery = trpc.orbProxy.listLearnedPatterns.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const removeOne = trpc.orbProxy.removePreferenceValue.useMutation({
    onSuccess: () => {
      void utils.orbProxy.getRememberedPreferences.invalidate();
    },
  });
  const clearAll = trpc.orbProxy.clearAllPreferenceMemory.useMutation({
    onSuccess: () => {
      void utils.orbProxy.getRememberedPreferences.invalidate();
    },
  });
  const [confirmClear, setConfirmClear] = useState(false);

  const data = memoryQuery.data;
  const profile = data?.profile;
  const hasAny =
    !!profile &&
    (profile.styles.length +
      profile.platforms.length +
      profile.outputs.length +
      profile.models.length) > 0;

  if (memoryQuery.isLoading) {
    return (
      <div
        className={`rounded-2xl border border-border/70 bg-card/80 backdrop-blur-sm p-3 ${
          compact ? "" : "shadow-sm"
        }`}
        data-testid="orb-memory-dashboard"
      >
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/70">
          <Brain className="w-3.5 h-3.5 animate-pulse" />
          整理光球記得的偏好…
        </div>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-border bg-muted/60 p-3 ${
          compact ? "" : ""
        }`}
        data-testid="orb-memory-dashboard"
      >
        <div className="flex items-start gap-2">
          <Brain className="w-4 h-4 text-muted-foreground/60 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-medium text-foreground/90">光球還沒記住你的偏好</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              聊幾次後，光球會記下你常用的風格、平台、用途，下次就不再重複問。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-2xl border border-cyan-200/40 bg-gradient-to-br from-white via-cyan-50/30 to-violet-50/30 p-3 ${
        compact ? "" : "shadow-sm"
      }`}
      data-testid="orb-memory-dashboard"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-[12px] font-semibold text-foreground/90">光球記得你</span>
          <span className="text-[10px] text-muted-foreground/70">
            · {profile!.evidenceCount} 條記憶
          </span>
        </div>
        {confirmClear ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                clearAll.mutate();
                setConfirmClear(false);
              }}
              disabled={clearAll.isPending}
              className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
            >
              確認清空
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-rose-500 transition"
            data-testid="orb-memory-clear-all"
            title="把所有偏好清掉，光球會重新詢問"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            重置
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <MemoryRow
          label="風格"
          icon={Sparkles}
          values={profile!.styles}
          tone="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200"
          onRemove={value => removeOne.mutate({ key: "styles", value })}
        />
        <MemoryRow
          label="平台 / 受眾"
          icon={Layers}
          values={profile!.platforms}
          tone="bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200"
          onRemove={value => removeOne.mutate({ key: "platforms", value })}
        />
        <MemoryRow
          label="用途"
          icon={Target}
          values={profile!.outputs}
          tone="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
          onRemove={value => removeOne.mutate({ key: "outputs", value })}
        />
        <MemoryRow
          label="偏好模型"
          icon={Cpu}
          values={profile!.models}
          tone="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
          onRemove={value => removeOne.mutate({ key: "models", value })}
        />
      </div>

      {(patternsQuery.data?.patterns.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <BookOpen className="w-3 h-3" />
            已從回答學習
          </div>
          <div className="flex flex-col gap-1">
            {patternsQuery.data!.patterns.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">{p.questionType}</span>
                {p.defaultPreference && (
                  <span className="text-[11px] font-medium text-foreground/80 truncate">{p.defaultPreference}</span>
                )}
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                  {Math.round(p.confidenceScore * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground/70 leading-snug">
        每次選了風格、平台、用途，光球會偷偷記下來。隨時點 ✕ 移除單一偏好，或按右上「重置」全部清掉。
      </p>
    </div>
  );
}
