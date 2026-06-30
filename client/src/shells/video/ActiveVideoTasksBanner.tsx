// AIDV-649: 頁面重載後「進行中影片任務」持久橫幅
//
// BackgroundTasksDrawer 的 in-memory store 在頁面刷新後歸零，但底層
// generate.activeJobs 查詢會在 Provider 初始化時立即向 DB 撈一次資料。
// 本元件偵測 studioType='video' 且 status∈{queued,processing} 的任務，
// 在 /video 頂部顯示橫幅，讓使用者一鍵重新打開 DrawerTask 找回任務。
import { Loader2, Video, X } from "lucide-react";
import { useState } from "react";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import { Button } from "@/components/ui/button";

export function ActiveVideoTasksBanner() {
  const { tasks, setDrawerOpen } = useBackgroundTasks();
  const [dismissed, setDismissed] = useState(false);

  const activeTasks = tasks.filter(
    t =>
      t.studioType === "video" &&
      (t.status === "queued" || t.status === "processing")
  );

  if (dismissed || activeTasks.length === 0) return null;

  const count = activeTasks.length;

  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 mx-4 mt-2">
      <Loader2 className="size-4 shrink-0 animate-spin text-amber-400" />
      <Video className="size-4 shrink-0 text-amber-400" />
      <span className="flex-1">
        您有{" "}
        <strong className="font-semibold">
          {count} 部影片{count > 1 ? "" : ""}
        </strong>{" "}
        正在生成中——重新載入頁面不影響任務，點擊可查看進度。
      </span>
      <Button
        variant="outline"
        size="sm"
        className="border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 hover:text-amber-100"
        onClick={() => setDrawerOpen(true)}
      >
        查看任務
      </Button>
      <button
        className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="關閉橫幅"
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
