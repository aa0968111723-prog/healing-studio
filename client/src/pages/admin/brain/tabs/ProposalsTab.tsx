/**
 * AI 大腦組態 — 自我反省(Proposals)分頁
 * Owns proposals query + approve/reject mutations.
 */
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Check, X } from "lucide-react";
import { toast } from "sonner";

export function ProposalsTab({ active }: { active: boolean }) {
  const utils = trpc.useUtils();
  const proposalsQuery = trpc.brain.proposals.useQuery(undefined, {
    enabled: active,
    staleTime: 12_000,
    refetchInterval: 15_000,
  });
  const approveProposalMut = trpc.brain.approveProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已批准");
      void utils.brain.proposals.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`批准失敗:${err.message}`),
  });
  const rejectProposalMut = trpc.brain.rejectProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已拒絕");
      void utils.brain.proposals.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`拒絕失敗:${err.message}`),
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-yellow-500" />
          回饋自我反省優化系統
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          AI 自動分析系統表現,提出優化提案。所有修改需經管理員審核批准後才會套用。
        </p>
        {proposalsQuery.isLoading ? (
          <ZenSkeleton lines={4} />
        ) : (
          <div className="space-y-3">
            {(proposalsQuery.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                目前沒有優化提案
              </p>
            )}
            {(proposalsQuery.data ?? []).map(p => (
              <div
                key={p.id}
                className={`rounded-lg border p-3 text-xs ${
                  p.status === "pending"
                    ? "border-yellow-500/30 bg-yellow-500/5"
                    : p.status === "approved"
                      ? "border-emerald-500/30 bg-emerald-500/5 opacity-70"
                      : "border-red-500/20 bg-red-500/5 opacity-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[9px]">
                        {p.category}
                      </Badge>
                      <Badge
                        variant={
                          p.status === "approved"
                            ? "default"
                            : p.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[9px]"
                      >
                        {p.status === "pending"
                          ? "待審核"
                          : p.status === "approved"
                            ? "已批准"
                            : "已拒絕"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        信心度 {p.confidence}%
                      </span>
                    </div>
                    <p className="font-medium mb-1">{p.title}</p>
                    <p className="text-muted-foreground">
                      {p.description.slice(0, 200)}
                    </p>
                    <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground/60">
                      <span>現行:{p.currentValue}</span>
                      <span>→ 建議:{p.proposedValue.slice(0, 80)}</span>
                    </div>
                    {p.adminNote && (
                      <p className="text-[10px] text-blue-500/80 mt-1">
                        管理員備註:{p.adminNote}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(p.createdAt).toLocaleString("zh-TW")}
                    </p>
                  </div>
                  {p.status === "pending" && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        size="sm"
                        className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() =>
                          approveProposalMut.mutate({ proposalId: p.id })
                        }
                        disabled={approveProposalMut.isPending}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        批准
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7 text-red-600 hover:text-red-700"
                        onClick={() =>
                          rejectProposalMut.mutate({ proposalId: p.id })
                        }
                        disabled={rejectProposalMut.isPending}
                      >
                        <X className="w-3 h-3 mr-1" />
                        拒絕
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
