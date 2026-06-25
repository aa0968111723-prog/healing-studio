// SSEFallbackBanner — AIDV-353
// 當 Supabase Realtime SSE 中斷時顯示 amber 提示，告知創作者已降級到 5 秒輪詢。
// 前提：BackgroundTasksProvider 已在外層掛載。
import { AlertTriangle } from "lucide-react";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";

export function SSEFallbackBanner() {
  const { sseConnected, activeCount } = useBackgroundTasks();

  // 僅在有進行中任務且 SSE 已斷線時顯示
  if (sseConnected || activeCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>即時更新暫時中斷，每 5 秒自動更新</span>
    </div>
  );
}
