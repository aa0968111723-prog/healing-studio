import { useCallback, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  STATUS_LABEL,
  STATUS_DESCRIPTION,
  type PipelineNode,
  type PipelineNodeStatus,
} from "@shared/brain-pipeline";

const STATUS_BADGE_CLASS: Record<PipelineNodeStatus, string> = {
  healthy: "bg-emerald-500 text-white",
  needs_optimization: "bg-yellow-500 text-white",
  broken: "bg-red-500 text-white",
  abnormal: "bg-orange-500 text-white",
};

interface Props {
  node: PipelineNode | null;
  onClose: () => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "剛剛";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  return `${Math.round(hr / 24)} 天前`;
}

export function NodeDetailSheet({ node, onClose }: Props) {
  return (
    <Sheet open={!!node} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-6 overflow-hidden flex flex-col">
        {node && (
          <>
            <SheetHeader className="px-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={STATUS_BADGE_CLASS[node.status]}>
                  {STATUS_LABEL[node.status]}
                </Badge>
                <Badge variant="outline">{node.layer}</Badge>
                <Badge variant="outline">{node.kind}</Badge>
              </div>
              <SheetTitle className="text-xl mt-2">{node.label}</SheetTitle>
              <SheetDescription>{STATUS_DESCRIPTION[node.status]}</SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 mt-4 pr-3">
              <div className="space-y-4 text-sm">
                {node.description && (
                  <section>
                    <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      說明
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      {node.description}
                    </p>
                  </section>
                )}

                {node.reason && (
                  <section>
                    <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      ⚠ 為什麼出問題
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                      {node.reason}
                    </p>
                  </section>
                )}

                {node.recommendation && (
                  <section>
                    <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      💡 建議怎麼修
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
                      {node.recommendation}
                    </p>
                  </section>
                )}

                {node.metrics &&
                  Object.values(node.metrics).some(v => v !== undefined) && (
                    <section>
                      <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                        📊 指標
                      </h3>
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        {node.metrics.consecutiveFailures !== undefined && (
                          <>
                            <dt className="text-slate-500">連續失敗</dt>
                            <dd className="font-mono">
                              {node.metrics.consecutiveFailures}
                            </dd>
                          </>
                        )}
                        {node.metrics.recentErrorCount !== undefined && (
                          <>
                            <dt className="text-slate-500">近期錯誤</dt>
                            <dd className="font-mono">
                              {node.metrics.recentErrorCount}
                            </dd>
                          </>
                        )}
                        {node.metrics.updatedAt && (
                          <>
                            <dt className="text-slate-500">最後更新</dt>
                            <dd
                              className="font-mono"
                              title={new Date(
                                node.metrics.updatedAt
                              ).toLocaleString("zh-TW")}
                            >
                              {formatRelative(node.metrics.updatedAt)}
                            </dd>
                          </>
                        )}
                      </dl>
                      {node.metrics.lastError && (
                        <CopyableBlock
                          value={node.metrics.lastError}
                          className="text-[11px] mt-2 break-all"
                        />
                      )}
                    </section>
                  )}


                {node.diagnostics &&
                  (node.diagnostics.frontendPath ||
                    node.diagnostics.backendRoute ||
                    node.diagnostics.serviceFunction ||
                    (node.diagnostics.traceSampleIds && node.diagnostics.traceSampleIds.length > 0)) && (
                    <section>
                      <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                        🧭 節點排查線索
                      </h3>
                      <dl className="grid grid-cols-1 gap-2 text-xs">
                        {node.diagnostics.frontendPath && (
                          <DiagnosticRow
                            label="前端檔案"
                            value={node.diagnostics.frontendPath}
                          />
                        )}
                        {node.diagnostics.backendRoute && (
                          <DiagnosticRow
                            label="後端路由 / Procedure"
                            value={node.diagnostics.backendRoute}
                          />
                        )}
                        {node.diagnostics.serviceFunction && (
                          <DiagnosticRow
                            label="服務函式"
                            value={node.diagnostics.serviceFunction}
                          />
                        )}
                        {node.diagnostics.traceSampleIds &&
                          node.diagnostics.traceSampleIds.length > 0 && (
                            <TraceSampleRow
                              traceIds={node.diagnostics.traceSampleIds}
                            />
                          )}
                      </dl>
                    </section>
                  )}
                {node.relatedFiles && node.relatedFiles.length > 0 && (
                  <section>
                    <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      📁 相關檔案
                    </h3>
                    <ul className="space-y-1 text-xs">
                      {node.relatedFiles.map(f => (
                        <CopyableBlock
                          key={f}
                          value={f}
                          as="li"
                          className="font-mono break-all"
                        />
                      ))}
                    </ul>
                  </section>
                )}

                <section className="text-xs text-slate-400 pt-2 border-t">
                  節點 ID：<code className="font-mono">{node.id}</code>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd>
        <CopyableBlock value={value} className="font-mono break-all" />
      </dd>
    </div>
  );
}

function TraceSampleRow({ traceIds }: { traceIds: string[] }) {
  const [, navigate] = useLocation();
  return (
    <div>
      <dt className="text-slate-500 flex items-center gap-1">
        Trace Samples
        <span className="text-[10px] text-slate-400">（點擊跳到錯誤追蹤）</span>
      </dt>
      <dd className="flex flex-wrap gap-1.5 mt-1">
        {traceIds.map(id => (
          <button
            key={id}
            type="button"
            onClick={() =>
              navigate(
                `/admin?section=brain&brainTab=errors&trace=${encodeURIComponent(id)}`
              )
            }
            className="font-mono text-[11px] bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1 rounded border break-all transition-colors inline-flex items-center gap-1"
            title="點擊跳到 AI 大腦 → 錯誤追蹤分頁，並自動聚焦此 trace"
          >
            {id}
            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
          </button>
        ))}
      </dd>
    </div>
  );
}

interface CopyableBlockProps {
  value: string;
  className?: string;
  as?: "div" | "li";
}

function CopyableBlock({ value, className, as = "div" }: CopyableBlockProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 忽略：某些瀏覽器/權限下可能失敗
    }
  }, [value]);

  const Wrapper = as === "li" ? "li" : "div";

  return (
    <Wrapper
      className={`group relative bg-slate-50 dark:bg-slate-900 px-2 py-1 pr-7 rounded border ${className ?? ""}`}
    >
      <span>{value}</span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={handleCopy}
        aria-label="複製"
        className="absolute right-0.5 top-0.5 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </Wrapper>
  );
}
