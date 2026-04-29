import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
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
                            <dd className="font-mono">
                              {new Date(node.metrics.updatedAt).toLocaleString(
                                "zh-TW"
                              )}
                            </dd>
                          </>
                        )}
                      </dl>
                      {node.metrics.lastError && (
                        <p className="text-[11px] mt-2 font-mono bg-slate-50 dark:bg-slate-900 p-2 rounded border break-all">
                          {node.metrics.lastError}
                        </p>
                      )}
                    </section>
                  )}

                {node.relatedFiles && node.relatedFiles.length > 0 && (
                  <section>
                    <h3 className="font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      📁 相關檔案
                    </h3>
                    <ul className="space-y-1 text-xs font-mono">
                      {node.relatedFiles.map(f => (
                        <li
                          key={f}
                          className="bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded border break-all"
                        >
                          {f}
                        </li>
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
