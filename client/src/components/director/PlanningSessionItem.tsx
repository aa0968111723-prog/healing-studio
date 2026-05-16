import { memo } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export const PlanningSessionItem = memo(function PlanningSessionItem({
  session,
  onLoad,
  onDelete,
}: {
  session: {
    id: number;
    title: string;
    createdAt: Date | string;
    updatedAt?: Date | string | null;
  };
  onLoad: (data: string, id?: number) => void;
  onDelete: (id: number) => void;
}) {
  const loadQuery = trpc.director.loadPlanningSession.useQuery(
    { id: session.id },
    { enabled: false }
  );

  const handleLoad = async () => {
    const result = await loadQuery.refetch();
    if (result.data?.sessionData) {
      onLoad(result.data.sessionData, session.id);
    } else {
      toast.error("無法載入規劃");
    }
  };

  const displayDate = session.updatedAt ?? session.createdAt;
  const label = session.updatedAt ? "上次更新" : "建立";

  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-card/40 transition-colors group">
      <button onClick={handleLoad} className="flex-1 text-left min-w-0">
        <span className="text-xs font-medium truncate block">
          {session.title}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {label}：{new Date(displayDate).toLocaleDateString("zh-TW")}
        </span>
      </button>
      <button
        onClick={() => onDelete(session.id)}
        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all shrink-0"
        title="刪除"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
});
