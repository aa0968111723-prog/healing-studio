/**
 * AI 大腦組態 — 自動修復(Alerts)分頁
 * Owns auto-repair config + alerts query + toggle/dismiss mutations.
 */
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Shield, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";

export function AlertsTab({ active }: { active: boolean }) {
  const utils = trpc.useUtils();
  const autoRepairConfigQuery = trpc.brain.autoRepairConfig.useQuery(undefined, {
    enabled: active,
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
  const alertsQuery = trpc.brain.alerts.useQuery(undefined, {
    enabled: active,
    staleTime: 8_000,
    refetchInterval: 10_000,
  });
  const toggleAutoRepairMut = trpc.brain.toggleAutoRepair.useMutation({
    onSuccess: data => {
      toast.success(`自動修復已${data.enabled ? "啟用" : "停用"}`);
      void utils.brain.autoRepairConfig.invalidate();
    },
    onError: err => toast.error(`切換失敗:${err.message}`),
  });
  const setMonitorIntervalMut = trpc.brain.setMonitorInterval.useMutation({
    onSuccess: data => {
      toast.success(`巡檢間隔已設為 ${data.intervalMinutes} 分鐘`);
      void utils.brain.autoRepairConfig.invalidate();
    },
    onError: err => toast.error(`更新失敗:${err.message}`),
  });
  const dismissAlertMut = trpc.brain.dismissAlert.useMutation({
    onSuccess: () => {
      void utils.brain.alerts.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`關閉失敗:${err.message}`),
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-500" />
          自動除錯設定
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">啟用自動除錯</Label>
              <p className="hs-small !mb-0 text-muted-foreground">
                開啟後系統將定時自動巡檢 API 並嘗試修復故障引擎
              </p>
            </div>
            <Switch
              checked={autoRepairConfigQuery.data?.enabled ?? true}
              onCheckedChange={checked =>
                toggleAutoRepairMut.mutate({ enabled: checked })
              }
              disabled={toggleAutoRepairMut.isPending}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium">巡檢間隔</Label>
              <span className="text-xs font-mono text-muted-foreground">
                {autoRepairConfigQuery.data?.intervalMinutes ?? 3} 分鐘
              </span>
            </div>
            <Slider
              min={1}
              max={60}
              step={1}
              value={[autoRepairConfigQuery.data?.intervalMinutes ?? 3]}
              onValueCommit={v =>
                setMonitorIntervalMut.mutate({ minutes: v[0] })
              }
              disabled={
                setMonitorIntervalMut.isPending ||
                !(autoRepairConfigQuery.data?.enabled ?? true)
              }
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1">
              <span>1 分鐘</span>
              <span>30 分鐘</span>
              <span>60 分鐘</span>
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          自動修復 API + 提醒管理
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          系統每 {autoRepairConfigQuery.data?.intervalMinutes ?? 3} 分鐘自動巡檢所有
          API provider,偵測到故障時自動切換備援引擎,無法修復時通知管理員。
        </p>
        {alertsQuery.isLoading ? (
          <ZenSkeleton lines={4} />
        ) : (
          <div className="space-y-2">
            {(alertsQuery.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                ✅ 目前沒有警報,所有 API 正常運作
              </p>
            )}
            {(alertsQuery.data ?? []).map(alert => (
              <div
                key={alert.id}
                className={`rounded-lg border p-3 text-xs ${
                  alert.dismissedAt
                    ? "opacity-50 border-muted"
                    : alert.severity === "critical"
                      ? "border-red-500/30 bg-red-500/5"
                      : alert.severity === "warning"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-emerald-500/30 bg-emerald-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${
                          alert.severity === "critical"
                            ? "text-red-600 border-red-500/30"
                            : alert.severity === "warning"
                              ? "text-amber-600 border-amber-500/30"
                              : "text-emerald-600 border-emerald-500/30"
                        }`}
                      >
                        {alert.severity}
                      </Badge>
                      <span className="font-medium">{alert.engine}</span>
                      {alert.autoRepaired && (
                        <Badge variant="secondary" className="text-[9px]">
                          已自動修復
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">{alert.message}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(alert.createdAt).toLocaleString("zh-TW")}
                      {alert.repairedWith &&
                        ` · 備援: ${alert.repairedWith}`}
                    </p>
                  </div>
                  {!alert.dismissedAt && alert.severity !== "info" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 shrink-0"
                      onClick={() =>
                        dismissAlertMut.mutate({ alertId: alert.id })
                      }
                      disabled={dismissAlertMut.isPending}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      關閉
                    </Button>
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
