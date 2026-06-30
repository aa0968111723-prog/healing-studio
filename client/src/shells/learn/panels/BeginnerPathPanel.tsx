// ============================================================================
// shells/learn/panels/BeginnerPathPanel.tsx — 新手 0→1 做中學路徑（AIDV-811）
// ----------------------------------------------------------------------------
// 5 步線性路徑卡，每步可勾完成、進度存 localStorage；
// 每步附對應深連結 CTA + 方法論文件推薦。
// 純前端，不新增後端；策展 learnContent.ts 既有素材。
// ============================================================================
import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Circle, ArrowRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { METHODOLOGY_DOCS, LEARN_CATEGORIES } from "../learnContent";

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

interface Step {
  id: string;
  title: string;
  learn: string;
  cta: string;
  href: string;
  docId: string;
  categoryKey: string;
}

const STEPS: Step[] = [
  {
    id: "read-prompt",
    title: "看懂提示怎麼寫",
    learn: "學會 CO-STAR 結構化提示，讓 AI 真正懂你的意圖。",
    cta: "看提示參考 →",
    href: "/learn?sub=hub",
    docId: "costar-rag",
    categoryKey: "getting-started",
  },
  {
    id: "first-image",
    title: "生出你的第一張圖",
    learn: "從一句話描述開始，生出第一張屬於自己的 AI 圖像。",
    cta: "去創作 →",
    href: "/create",
    docId: "six-agents",
    categoryKey: "getting-started",
  },
  {
    id: "refine",
    title: "微調，讓它更接近你想的",
    learn: "用靈感積木微調提示，反覆試到滿意。",
    cta: "繼續創作 →",
    href: "/create",
    docId: "confirm-gate",
    categoryKey: "workflow",
  },
  {
    id: "animate",
    title: "讓圖動起來",
    learn: "把靜態圖像轉成短影片，進入導演模式。",
    cta: "進影片殼 →",
    href: "/video",
    docId: "shot-pipeline",
    categoryKey: "generation",
  },
  {
    id: "voice",
    title: "配上聲音，作品完整了",
    learn: "為影片配上旁白或音樂，作品就完整了。",
    cta: "去配音 →",
    href: "/pro-studio",
    docId: "cost-ladder",
    categoryKey: "generation",
  },
];

export function BeginnerPathPanel() {
  const [, navigate] = useLocation();
  const [done, setDone] = useState<Set<string>>(loadDone);

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

  const doneCount = STEPS.filter((s) => done.has(s.id)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">🚀 新手路徑</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          跟著 5 步，從第一張圖到第一支會說話的短片
        </p>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {doneCount}/{STEPS.length}
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
        {STEPS.map((step, i) => {
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

      {doneCount === STEPS.length && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="font-semibold text-primary">🎉 恭喜完成新手路徑！</p>
          <p className="text-sm text-muted-foreground mt-1">
            你已經完成了從第一張圖到配音作品的完整旅程。繼續探索其他分頁深入學習吧！
          </p>
        </div>
      )}
    </div>
  );
}
