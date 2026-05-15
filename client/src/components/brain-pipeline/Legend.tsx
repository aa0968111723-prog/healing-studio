import type { PipelineGraph, PipelineNodeStatus } from "@shared/brain-pipeline";

const DOT_COLOR: Record<PipelineNodeStatus, string> = {
  healthy: "bg-emerald-500",
  needs_optimization: "bg-yellow-500",
  broken: "bg-red-500",
  abnormal: "bg-orange-500",
};

interface Props {
  legend: PipelineGraph["legend"];
}

export function Legend({ legend }: Props) {
  return (
    <div className="absolute bottom-4 right-4 z-10 rounded-xl bg-white/90 backdrop-blur border shadow-lg p-3 space-y-2 text-xs max-w-[260px]">
      <div className="font-semibold mb-1">圖例</div>
      {legend.map(item => (
        <div key={item.status} className="flex items-start gap-2">
          <span
            className={`h-3 w-3 rounded-full mt-0.5 shrink-0 ${DOT_COLOR[item.status]}`}
          />
          <div>
            <div className="font-medium">{item.label}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              {item.description}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
