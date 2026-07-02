// ============================================================================
// shells/learn/panels/BeginnerPathPanel.tsx — 新手 0→1 做中學路徑（AIDV-811）
// ----------------------------------------------------------------------------
// 線性路徑卡，每步可勾完成、進度存 localStorage；
// 每步附對應深連結 CTA + 方法論文件推薦。
// 純前端，不新增後端；策展 learnContent.ts 既有素材。
//
// AIDV-965：頂部加 persona 意圖選擇器（電商賣家/教育者/接案者/品牌方/通用），
// 選擇存 localStorage `learn:beginner-path:persona`；每 persona 一組 STEPS、
// 完成文案客製（STEPS/文案定義在 ../beginnerPathPersonas 純模組）。
// 【HARD】旗標 FEATURE_BEGINNER_PATH_PERSONAS OFF 或未選 persona →
// 與現行（AIDV-811 預設 5 步）100% 一致（零回歸，測試釘住）。
// ============================================================================
import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Circle, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { METHODOLOGY_DOCS, LEARN_CATEGORIES } from "../learnContent";
import { FEATURE_BEGINNER_PATH_PERSONAS } from "@/config/featureFlags";
import {
  PERSONAS,
  DEFAULT_STEPS,
  getStepsForPersona,
  getPathSubtitle,
  getCompletionCopy,
  loadPersona,
  savePersona,
  type PersonaKey,
} from "../beginnerPathPersonas";

const LS_KEY = "learn:beginner-path:done";

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...done]));
  } catch { /* 私密模式忽略 */ }
}

export function BeginnerPathPanel() {
  const [, navigate] = useLocation();
  const [done, setDone] = useState<Set<string>>(loadDone);
  // AIDV-965：persona 選擇（旗標 OFF 時恆為 null＝現行行為）
  const [persona, setPersona] = useState<PersonaKey | null>(() =>
    FEATURE_BEGINNER_PATH_PERSONAS ? loadPersona() : null,
  );

  const selectPersona = (key: PersonaKey | null) => {
    setPersona(key);
    savePersona(key);
  };

  // 旗標 OFF → 恆為現行 5 步（零回歸）；ON 且未選 persona → 同樣是 DEFAULT_STEPS。
  const steps = FEATURE_BEGINNER_PATH_PERSONAS ? getStepsForPersona(persona) : DEFAULT_STEPS;
  const subtitle = FEATURE_BEGINNER_PATH_PERSONAS ? getPathSubtitle(persona) : getPathSubtitle(null);
  const completion = FEATURE_BEGINNER_PATH_PERSONAS ? getCompletionCopy(persona) : getCompletionCopy(null);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveDone(next);
      return next;
    });
  };

  const reset = () => {
    setDone(new Set());
    saveDone(new Set());
  };

  const doneCount = steps.filter((s) => done.has(s.id)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">🚀 新手路徑</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {subtitle}
        </p>

        {/* AIDV-965：persona 意圖選擇器（僅旗標 ON 顯示；再點一次取消回預設路徑） */}
        {FEATURE_BEGINNER_PATH_PERSONAS && (
          <div
            role="tablist"
            aria-label="選擇你的創作身分"
            className="flex flex-wrap gap-2 mt-3"
          >
            {PERSONAS.map((p) => {
              const selected = persona === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectPersona(selected ? null : p.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  {p.emoji} {p.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {doneCount}/{steps.length}
          </span>
          {doneCount > 0 && (
            <button
              onClick={reset}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="重置進度"
            >
              <RotateCcw className="h-3 w-3" />
              重置
            </button>
          )}
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((step, i) => {
          const isDone = done.has(step.id);
          const doc = METHODOLOGY_DOCS.find((d) => d.id === step.docId);
          const cat = LEARN_CATEGORIES.find((c) => c.key === step.categoryKey);

          return (
            <li
              key={step.id}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                isDone ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-primary/20",
              )}
            >
              <div className="flex gap-3">
                <button
                  onClick={() => toggle(step.id)}
                  aria-label={isDone ? `取消完成第${i + 1}步` : `標記第${i + 1}步完成`}
                  className="mt-0.5 shrink-0 text-primary transition-colors"
                >
                  {isDone ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">第 {i + 1} 步</span>
                    {isDone && (
                      <span className="text-xs text-primary font-medium">完成 ✓</span>
                    )}
                  </div>
                  <h3 className={cn("font-semibold mt-0.5", isDone && "line-through text-muted-foreground")}>
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">{step.learn}</p>

                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <Button
                      size="sm"
                      variant={isDone ? "outline" : "default"}
                      onClick={() => navigate(step.href)}
                      className="h-7 text-xs"
                    >
                      {step.cta}
                    </Button>
                    {doc && (
                      <button
                        type="button"
                        aria-label={`查看文件：${doc.title}`}
                        onClick={() => navigate("/learn?sub=hub")}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        <span className="underline underline-offset-2">{doc.title}</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    {cat && (
                      <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5">
                        {cat.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {doneCount === steps.length && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="font-semibold text-primary">{completion.title}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {completion.body}
          </p>
        </div>
      )}
    </div>
  );
}
