// ============================================================================
// components/social/GenerationConsole.tsx — provider 可選的出圖主控（含回退鏈 UI）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3.2 / §4.3（成本確認）。
//
// 真正接 P0 GenerationAdapter（spine.adapters.generation.generate(req, onEvent)）：
//   - provider 可選（讀/寫 spine.provider；hf|gemini|fal|mock）。
//   - 即時回退事件（attempt/queued/poll/fail/fallback/success）逐條呈現（§3.2 失敗 UI）。
//   - 失敗可重試；故障注入（spine.faults）可演自動回退。
//   - 媒體生成「先估成本再確認」（成本階梯鐵則，§4.4）——estimate 事件先到。
// 真實 procedure（GitNexus 校正）：generate.estimateCost → submitStudioJob → jobStatus →
//   recordGenResult（底層 imageStudio.<model>），非 imageStudio.generate。
// ============================================================================
import { useState } from "react";
import { Bolt, RefreshCw, CircleCheck, CircleX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSpine } from "@/providers/SpineProvider";
import type { GenEvent, GenResult } from "@/adapters/types";
import type { ProviderId, GenKind } from "@/spine/types";

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "hf", label: "Hugging Face" },
  { id: "gemini", label: "Gemini" },
  { id: "fal", label: "fal.ai" },
  { id: "mock", label: "Mock（離線）" },
];

interface GenerationConsoleProps {
  prompt: string;
  kind?: GenKind;
  className?: string;
  disabled?: boolean;
  onDone: (res: GenResult) => void;
}

export function GenerationConsole({ prompt, kind = "image", className, disabled, onDone }: GenerationConsoleProps) {
  const spine = useSpine();
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [events, setEvents] = useState<GenEvent[]>([]);
  const [estCost, setEstCost] = useState<number | null>(null);

  async function run() {
    setStatus("generating");
    setEvents([]);
    setEstCost(null);
    const seed = Math.floor(Math.random() * 9000) + 1000; // 出圖隨機 seed（非 composeLayout 確定性層）
    try {
      const res = await spine.adapters.generation.generate(
        { kind, prompt, seed, provider: spine.provider },
        (e) => {
          setEvents((prev) => [...prev, e]);
          if (e.type === "estimate") setEstCost(e.costUsd);
          if (e.type === "fallback") toast.message("自動回退 provider", { description: `${e.provider} → ${e.next}` });
          if (e.type === "fail") toast.warning(`${e.provider} 生成失敗`, { description: `${e.error.msg}（HTTP ${e.error.http}）` });
        },
      );
      setStatus("done");
      onDone(res);
      toast.success("社群圖已生成", {
        description: `${res.model} · $${res.costUsd.toFixed(3)}${res.provider !== spine.provider ? `（回退 ${res.provider}）` : ""}`,
      });
    } catch (err) {
      setStatus("error");
      toast.error("生成失敗", { description: (err as Error)?.message ?? "全部 provider 皆失敗，請重試或切換 provider" });
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Select value={spine.provider} onValueChange={(v) => spine.setProvider(v as ProviderId)}>
          <SelectTrigger className="w-40" aria-label="生成 provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={run} disabled={disabled || status === "generating"} className="flex-1">
          {status === "generating" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> 生成中…
            </>
          ) : (
            <>
              <Bolt className="h-4 w-4" /> 生成（{spine.provider}）
            </>
          )}
        </Button>

        {status === "error" && (
          <Button variant="outline" onClick={run} aria-label="重試">
            <RefreshCw className="h-4 w-4" /> 重試
          </Button>
        )}
      </div>

      {estCost != null && (
        <div className="text-xs text-muted-foreground">
          預估成本 ${estCost.toFixed(3)} · 媒體生成永遠先估再確認（成本階梯）
        </div>
      )}

      {events.length > 0 && (
        <ol className="space-y-1 rounded-lg border bg-muted/40 p-2 text-xs">
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              {e.type === "success" ? (
                <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
              ) : e.type === "fail" ? (
                <CircleX className="h-3.5 w-3.5 text-rose-500" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="font-mono">{describe(e)}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-[11px] text-muted-foreground">
        時事選題經脊椎讀 <Badge variant="outline" className="px-1 py-0 text-[10px]">news.list</Badge> （不開 /learn 頁）。
        provider 可在 /settings 切換、注入故障看回退。像素走 GenerationProvider；文字層走 composeLayout（確定性）。
      </p>
    </div>
  );
}

function describe(e: GenEvent): string {
  switch (e.type) {
    case "estimate":
      return `估價 $${e.costUsd.toFixed(3)}`;
    case "attempt":
      return `嘗試 ${e.provider}（第 ${e.step + 1} 跳）`;
    case "queued":
      return `已排入 ${e.provider} · job ${e.jobId}`;
    case "poll":
      return `輪詢 ${e.jobId} · ${e.status}`;
    case "fail":
      return `${e.provider} 失敗 · ${e.error.code}`;
    case "fallback":
      return `回退 ${e.provider} → ${e.next}`;
    case "success":
      return `成功 ${e.provider} · ${e.res.model}${e.fellBack ? "（回退）" : ""}`;
    default:
      return "";
  }
}

export default GenerationConsole;
