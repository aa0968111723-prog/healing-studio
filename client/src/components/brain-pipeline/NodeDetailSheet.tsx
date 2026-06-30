import { useCallback, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy, Check, ExternalLink, Github } from "lucide-react";
import { useLocation } from "wouter";
import { fileToGithubUrl } from "@/lib/github-url";
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
                    <h3 className="font-semibold mb-1 text-foreground/90">
                      說明
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {node.description}
                    </p>
                  </section>
                )}

                {node.reason && (
                  <section>
                    <h3 className="font-semibold mb-1 text-foreground/90">
                      ⚠ 為什麼出問題
                    </h3>
                    <p className="text-muted-foreground leading-relaxed bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                      {node.reason}
                    </p>
                  </section>
                )}

                {node.recommendation && (
                  <section>
                    <h3 className="font-semibold mb-1 text-foreground/90">
                      💡 建議怎麼修
                    </h3>
                    <p className="text-muted-foreground leading-relaxed bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
                      {node.recommendation}
                    </p>
                  </section>
                )}

                {node.metrics &&
                  Object.values(node.metrics).some(v => v !== undefined) && (
                    <section>
                      <h3 className="font-semibold mb-1 text-foreground/90">
                        📊 指標
                      </h3>
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        {node.metrics.consecutiveFailures !== undefined && (
                          <>
                            <dt className="text-muted-foreground">連續失敗</dt>
                            <dd className="font-mono">
                              {node.metrics.consecutiveFailures}
                            </dd>
                          </>
                        )}
                        {node.metrics.recentErrorCount !== undefined && (
                          <>
                            <dt className="text-muted-foreground">近期錯誤</dt>
                            <dd className="font-mono">
                              {node.metrics.recentErrorCount}
                            </dd>
                          </>
                        )}
                        {node.metrics.updatedAt && (
                          <>
                            <dt className="text-muted-foreground">最後更新</dt>
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
                      <h3 className="font-semibold mb-1 text-foreground/90">
                        🧭 節點排查線索
                      </h3>
                      <dl className="grid grid-cols-1 gap-2 text-xs">
                        {node.diagnostics.frontendPath && (
                          <DiagnosticRow
                            label="前端檔案"
                            value={node.diagnostics.frontendPath}
                            linkable
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
                    <h3 className="font-semibold mb-1 text-foreground/90">
                      📁 相關檔案
                    </h3>
                    <ul className="space-y-1 text-xs">
                      {node.relatedFiles.map(f => (
                        <CopyableBlock
                          key={f}
                          value={f}
                          as="li"
                          className="font-mono break-all"
                          linkable
                        />
                      ))}
                    </ul>
                  </section>
                )}

                <section className="text-xs text-muted-foreground/70 pt-2 border-t">
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

function DiagnosticRow({
  label,
  value,
  linkable = false,
}: {
  label: string;
  value: string;
  /** 若為真實 repo 檔案路徑，渲染 GitHub 連結圖示 */
  linkable?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <CopyableBlock
          value={value}
          className="font-mono break-all"
          linkable={linkable}
        />
      </dd>
    </div>
  );
}

function TraceSampleRow({ traceIds }: { traceIds: string[] }) {
  const [, navigate] = useLocation();
  return (
    <div>
      <dt className="text-muted-foreground flex items-center gap-1">
        Trace Samples
        <span className="text-[10px] text-muted-foreground/70">（點擊跳到錯誤追蹤）</span>
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
            className="font-mono text-[11px] bg-muted hover:bg-muted px-2 py-1 rounded border break-all transition-colors inline-flex items-center gap-1"
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
  /** 若為真實 repo 檔案路徑且 VITE_GITHUB_REPO 有設，會多顯示一個 GitHub 連結按鈕 */
  linkable?: boolean;
}

function CopyableBlock({
  value,
  className,
  as = "div",
  linkable = false,
}: CopyableBlockProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // error toast shown by copyToClipboard
    }
  }, [value]);

  // 只有「實際看起來像 repo 檔案路徑」才產出 URL；
  // 例如 trpc 命名空間或 ".env (FAL_API_KEY)" 不會被連到 GitHub。
  const githubUrl = linkable ? fileToGithubUrl(value) : null;

  const Wrapper = as === "li" ? "li" : "div";
  const trailingPad = githubUrl ? "pr-14" : "pr-7";

  return (
    <Wrapper
      className={`group relative bg-muted px-2 py-1 ${trailingPad} rounded border ${className ?? ""}`}
    >
      <span>{value}</span>
      {githubUrl && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          asChild
          aria-label="在 GitHub 開啟"
          title={`在 GitHub 開啟 ${value}`}
          className="absolute right-7 top-0.5 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <a href={githubUrl} target="_blank" rel="noopener noreferrer">
            <Github className="h-3 w-3" />
          </a>
        </Button>
      )}
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
