/**
 * ProcessViewerPage.tsx — `/process` shareable step-by-step viewer
 *
 * Reads a process spec from `?spec=<base64url>` and renders a clean,
 * step-by-step guide. Used by the global orb to hand back shareable links
 * for any process it explains (workflows, how-to topics, onboarding paths).
 *
 * Three actions are exposed at the bottom:
 *   - Copy link (so the user can share)
 *   - Open this in chat (drops the link into the orb input as context)
 *   - Run with orb (only for kind="workflow", asks orb to actually execute)
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  ListChecks,
  Play,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { decodeProcessSpec, type ProcessSpec } from "../../../shared/orb-process-link";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
} from "@/contexts/PageAgentContext";

function readSpecFromUrl(): { spec?: ProcessSpec; reason?: string } {
  if (typeof window === "undefined") return { reason: "no-window" };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("spec");
  if (!raw) return { reason: "missing spec param" };
  const result = decodeProcessSpec(raw);
  if (!result.ok) return { reason: result.reason ?? "invalid spec" };
  return { spec: result.spec };
}

export default function ProcessViewerPage() {
  const [, navigate] = useLocation();
  const orbChat = useGlobalOrbChat();
  const [completed, setCompleted] = useState<Set<number>>(() => new Set());
  const { spec, reason } = useMemo(readSpecFromUrl, []);

  // Reset completion when spec changes (e.g. user opens a different link).
  useEffect(() => {
    setCompleted(new Set());
  }, [spec?.title]);

  // ── Derived values + helpers (kept above the conditional render so
  // every hook below sees the same identity on every render) ────────────
  const total = spec?.steps.length ?? 0;
  const doneCount = completed.size;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const toggleStep = (index: number) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("連結已複製，可分享給朋友");
    } catch {
      toast.error("複製失敗，請手動複製網址列");
    }
  };

  const handleOpenInChat = () => {
    if (!spec) return;
    orbChat.open();
    const summary = spec.summary ? `（${spec.summary}）` : "";
    orbChat.setInput(
      `這是我剛看的流程「${spec.title}」${summary}。請依這個流程帶我一步步做下去。`
    );
    navigate("/agent");
  };

  const handleRunWithOrb = () => {
    if (!spec) return;
    if (spec.kind !== "workflow") return handleOpenInChat();
    orbChat.open();
    orbChat.setInput(`請依「${spec.title}」這個流程，幫我跨頁執行 ${total} 個步驟。`);
    navigate("/agent");
  };

  // ── PageAgent 接入 ───────────────────────────────────────────────────
  // 讓 director 產出的流程連結被打開時，learning / navigator 精靈能直接
  // 驅動「打勾下一步、跳到對應頁、整段交給光球執行」。
  //
  // 1. NAV_ALLOWLIST 動態包含 spec 裡每個步驟的 path（光球只能跳到流程
  //    宣告過的頁）+ 兩個共用入口（/、/agent）。
  // 2. setParam key="completed" value=<index> → 切換指定步驟完成狀態。
  // 3. setParam key="cursor" value=<index>     → 跳到該步驟對應頁面。
  // 4. submit → 讓光球執行（僅 workflow），其餘 kind 退化為 openInChat。
  // 5. reset → 清空所有完成標記。
  //
  // 所有 hook 都在 spec 缺失時也會被呼叫（值用 fallback 撐住），
  // useRegisterPageAgent 的 enabled 會在 spec 不存在時關閉註冊。
  const stepPaths = useMemo<string[]>(
    () => spec?.steps.map(s => s.path).filter((p): p is string => !!p) ?? [],
    [spec]
  );
  const PROCESS_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set<string>(["/", "/agent", ...stepPaths]),
    [stepPaths]
  );
  const nextStepIndex = useMemo<number>(() => {
    if (!spec) return -1;
    for (let i = 0; i < spec.steps.length; i++) {
      if (!completed.has(i)) return i;
    }
    return -1;
  }, [completed, spec]);
  const nextStep = spec && nextStepIndex >= 0 ? spec.steps[nextStepIndex] : null;

  useRegisterPageAgent({
    pageId: "process-viewer",
    pageLabel: "流程說明檢視器",
    pagePath: "/process",
    enabled: !!spec,
    capabilities: [
      {
        action: "navigate",
        label: "跳到流程內某一步的頁面",
        options: stepPaths.map(p => ({ id: p, label: p })),
        hint: "只允許 spec.steps 宣告過的路徑 + / 與 /agent",
      },
      {
        action: "setParam",
        label: "勾選 / 取消勾選完成的步驟",
        hint: "key='completed' value=<step index, 0-based>；key='cursor' value=<index> 跳到該步驟頁",
      },
      {
        action: "submit",
        label: "讓光球執行整個流程",
        hint: "僅 kind=workflow 時生效；否則退化為「把流程帶入聊天」",
      },
      {
        action: "reset",
        label: "清空所有勾選",
        hint: "重新從第一步開始",
      },
    ],
    state: {
      title: spec?.title ?? null,
      summary: spec?.summary ?? null,
      kind: spec?.kind ?? "howto",
      totalSteps: total,
      completedCount: doneCount,
      percent,
      nextStepIndex,
      nextStepTitle: nextStep?.title ?? null,
      nextStepPath: nextStep?.path ?? null,
      hasUnfinishedSteps: nextStepIndex >= 0,
      stepPathCount: stepPaths.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (!spec) {
        return { ok: false, reason: "process: 沒有有效的流程資料" };
      }
      switch (action.type) {
        case "navigate": {
          const path = String(action.path ?? "");
          if (!PROCESS_NAV_ALLOWLIST.has(path)) {
            return { ok: false, reason: `process: 不在流程允許清單：${path}` };
          }
          navigate(path);
          return { ok: true, message: `跳到 ${path}` };
        }
        case "setParam": {
          if (action.key === "completed") {
            const idx = Number(action.value);
            if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
              return { ok: false, reason: `process: 步驟索引超界：${action.value}` };
            }
            toggleStep(idx);
            return {
              ok: true,
              message: completed.has(idx) ? `取消勾選步驟 ${idx + 1}` : `勾選步驟 ${idx + 1}`,
              data: { toggledIndex: idx },
            };
          }
          if (action.key === "cursor") {
            const idx = Number(action.value);
            if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
              return { ok: false, reason: `process: 步驟索引超界：${action.value}` };
            }
            const targetPath = spec.steps[idx]?.path;
            if (!targetPath) {
              return { ok: false, reason: `process: 步驟 ${idx + 1} 沒有對應頁面` };
            }
            if (!PROCESS_NAV_ALLOWLIST.has(targetPath)) {
              return { ok: false, reason: `process: 步驟頁不在允許清單：${targetPath}` };
            }
            navigate(targetPath);
            return {
              ok: true,
              message: `跳到步驟 ${idx + 1}：${spec.steps[idx]?.title ?? ""}`,
              data: { cursorIndex: idx, cursorPath: targetPath },
            };
          }
          return { ok: false, reason: `process: 未知 setParam key：${action.key}` };
        }
        case "submit": {
          handleRunWithOrb();
          return { ok: true, message: "已把流程交給光球" };
        }
        case "reset": {
          setCompleted(new Set());
          return { ok: true, message: "已清空所有勾選" };
        }
        default:
          return { ok: false, reason: `process: unsupported action "${action.type}"` };
      }
    },
  });

  if (!spec) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-lg shadow-lg border-0 bg-white/85 backdrop-blur-sm">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="flex justify-center">
              <ListChecks className="h-12 w-12 text-muted-foreground/70" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">看不到流程內容</h1>
            <p className="text-sm text-muted-foreground">
              這個分享連結沒有附上完整的流程資料{reason ? `（${reason}）` : ""}。
              <br />
              你可以回首頁，請光球幫你重新產生一個。
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Button onClick={() => navigate("/")} variant="default">
                回首頁
              </Button>
              <Button
                onClick={() => {
                  orbChat.open();
                  navigate("/agent");
                }}
                variant="outline"
              >
                打開光球
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-muted/40 via-background to-cyan-500/5">
      <div className="page-shell page-shell-narrow !max-w-3xl page-shell-pad space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            回首頁
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1">
            <Share2 className="w-4 h-4" />
            分享連結
          </Button>
        </div>

        <Card className="border-0 shadow-md bg-white/85 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {spec.emoji && <span className="text-2xl">{spec.emoji}</span>}
                  <CardTitle className="text-2xl sm:text-3xl text-foreground">
                    {spec.title}
                  </CardTitle>
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                    {spec.kind === "workflow" ? "可執行流程" : "步驟說明"}
                  </Badge>
                </div>
                {spec.summary && (
                  <p className="text-sm text-muted-foreground leading-6">{spec.summary}</p>
                )}
                {spec.source && (
                  <p className="text-xs text-muted-foreground/70">來源 · {spec.source}</p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>進度</span>
                <span>
                  {doneCount}/{total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* Steps */}
            <ol className="space-y-2">
              {spec.steps.map((step, index) => {
                const done = completed.has(index);
                return (
                  <li key={`${index}-${step.title}`}>
                    <button
                      type="button"
                      onClick={() => toggleStep(index)}
                      className={`w-full text-left rounded-2xl border p-3.5 sm:p-4 transition-all flex gap-3 group ${
                        done
                          ? "border-emerald-200 bg-emerald-50/60"
                          : "border-border bg-card hover:border-cyan-300 hover:shadow-sm"
                      }`}
                      aria-pressed={done}
                    >
                      <span className="shrink-0 mt-0.5">
                        {done ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground/60 group-hover:text-cyan-400" />
                        )}
                      </span>
                      <span className="flex-1 space-y-1.5 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground/70 font-mono">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`text-sm sm:text-[15px] font-medium ${
                              done ? "text-emerald-800 line-through decoration-emerald-300" : "text-foreground"
                            }`}
                          >
                            {step.title}
                          </span>
                        </div>
                        {step.detail && (
                          <p className="text-xs sm:text-sm text-muted-foreground leading-5">{step.detail}</p>
                        )}
                        {step.path && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => {
                              e.stopPropagation();
                              navigate(step.path!);
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate(step.path!);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs text-cyan-700 hover:text-cyan-800 hover:underline cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {step.path}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {total === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6">
                這個流程還沒有列出任何步驟。
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action bar */}
        <Card className="border-0 shadow-sm bg-cyan-50/60">
          <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-foreground/90">
              <Sparkles className="w-4 h-4 text-cyan-500" />
              想直接讓光球帶你做？
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleCopy} className="gap-1">
                <Copy className="w-4 h-4" />
                複製連結
              </Button>
              <Button variant="outline" onClick={handleOpenInChat} className="gap-1">
                打開光球聊天
              </Button>
              {spec.kind === "workflow" && (
                <Button onClick={handleRunWithOrb} className="gap-1">
                  <Play className="w-4 h-4" />
                  讓光球執行流程
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
