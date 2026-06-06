// ============================================================================
// shells/settings/admin/DataRepairTab.tsx — 資料修復（治理）
// ----------------------------------------------------------------------------
// 對映模擬 admin「資料修復」。誠實標示現況（adapter 對應表 §6）：
//   - admin 14 procedure **無 dataRepair** → 修復動作目前無單一後端入口（標待建）。
//   - 可做的真實事：用 admin.allBackgroundJobs 撈出「卡住 / 失敗」任務攤開（診斷）。
//   - 重壓 Context Packet＝contextPacket.compileProject（需 projectId）→ 導去專案頁操作。
//   - 修孤兒資產＝依賴 project_asset_links（❌ M2 待建）→ 按鈕禁用＋里程碑註記。
// 不假裝有不存在的 procedure（嚴格加法 + 不誤導）。
// ============================================================================
import { Wrench, Layers, RefreshCw, AlertTriangle, Database } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function DataRepairTab() {
  const jobsQ = trpc.admin.allBackgroundJobs.useQuery({ limit: 100 }, { retry: false });
  const all: any[] = (jobsQ.data as any[]) ?? (jobsQ.data as any)?.items ?? [];
  const stuck = all.filter((j) => {
    const s = String(j.status ?? "");
    return s === "failed" || s === "running" || s === "queued";
  });

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Wrench className="h-4 w-4" />資料修復動作</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <RepairAction
            icon={<Layers className="h-4 w-4" />}
            label="重建 Context Packet"
            note="contextPacket.compileProject（需在專案頁指定 projectId）"
            disabled
          />
          <RepairAction
            icon={<Database className="h-4 w-4" />}
            label="修復孤兒資產"
            note="依賴 project_asset_links（M2 待建）"
            disabled
          />
          <RepairAction
            icon={<RefreshCw className="h-4 w-4" />}
            label="清理卡住任務"
            note="目前無 dataRepair procedure；下方列出卡住任務供人工處理"
            disabled
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          註：admin 後台 14 procedure 無 `dataRepair`（adapter 對應表 §6 確認缺口）。本分頁先做
          「診斷攤開」，修復動作待 M2/M3 補後端入口；屆時接上即用，UI 不改。
        </p>
      </Card>

      {/* 卡住 / 失敗任務（診斷） */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4" />卡住 / 失敗任務</div>
          <Badge variant="outline">{jobsQ.isLoading ? "…" : `${stuck.length} 筆`}</Badge>
        </div>
        {jobsQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
        ) : stuck.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">沒有卡住 / 失敗的任務。</div>
        ) : (
          <div className="max-h-72 overflow-auto divide-y">
            {stuck.map((j, i) => (
              <div key={j.id ?? i} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="flex-1 truncate">{j.label ?? j.kind ?? "任務"}</span>
                <Badge variant={String(j.status) === "failed" ? "destructive" : "outline"} className="text-[10px]">{j.status}</Badge>
                <span className="text-[10px] text-muted-foreground">{j.createdAt ? new Date(j.createdAt).toLocaleDateString("zh-TW") : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function RepairAction({ icon, label, note, disabled }: { icon: React.ReactNode; label: string; note: string; disabled?: boolean }) {
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">{icon}{label}</div>
      <div className="text-[10px] text-muted-foreground">{note}</div>
      <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" disabled={disabled}>
        {disabled ? "待建" : "執行"}
      </Button>
    </div>
  );
}

export default DataRepairTab;
