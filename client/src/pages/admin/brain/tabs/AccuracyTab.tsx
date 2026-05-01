/**
 * AI 大腦組態 — 精準度測試(Accuracy)分頁
 * Owns its accuracy tests query + run/runAll mutations.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Target,
  Play,
  RefreshCw,
  TrendingUp,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";

type TestType = "response_quality" | "latency" | "consistency" | "error_rate";

export function AccuracyTab({ active }: { active: boolean }) {
  const utils = trpc.useUtils();
  const [testEngine, setTestEngine] = useState("gemini-2.5-flash");
  const [testType, setTestType] = useState<TestType>("response_quality");
  const [testPrompt, setTestPrompt] = useState("");
  const [testExpected, setTestExpected] = useState("");

  const testsQuery = trpc.brain.accuracyTests.useQuery(undefined, {
    enabled: active,
  });
  const runTestMut = trpc.brain.runAccuracyTest.useMutation({
    onSuccess: () => {
      toast.success("測試完成");
      void utils.brain.accuracyTests.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`測試失敗:${err.message}`),
  });
  const runAllTestsMut = trpc.brain.runAllAccuracyTests.useMutation({
    onSuccess: () => {
      toast.success("批量測試完成");
      void utils.brain.accuracyTests.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`批量測試失敗:${err.message}`),
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Target className="w-4 h-4 text-indigo-500" />
          AI 精準度測試系統
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          自行測試生成式 AI 的回應品質、延遲、一致性。低於門檻時自動建立優化提案
          (需管理員批准)。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <Label className="text-[10px]">引擎</Label>
            <Input
              value={testEngine}
              onChange={e => setTestEngine(e.target.value)}
              className="text-xs mt-1"
              placeholder="gemini-2.5-flash"
            />
          </div>
          <div>
            <Label className="text-[10px]">測試類型</Label>
            <Select
              value={testType}
              onValueChange={v => setTestType(v as TestType)}
            >
              <SelectTrigger className="text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="response_quality">回應品質</SelectItem>
                <SelectItem value="latency">延遲測試</SelectItem>
                <SelectItem value="consistency">一致性</SelectItem>
                <SelectItem value="error_rate">錯誤率</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">測試提示詞</Label>
            <Input
              value={testPrompt}
              onChange={e => setTestPrompt(e.target.value)}
              className="text-xs mt-1"
              placeholder="用 30 字描述一棵樹"
            />
          </div>
          <div>
            <Label className="text-[10px]">預期行為</Label>
            <Input
              value={testExpected}
              onChange={e => setTestExpected(e.target.value)}
              className="text-xs mt-1"
              placeholder="回傳繁體中文,字數接近 30"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              testPrompt.trim() &&
              testExpected.trim() &&
              runTestMut.mutate({
                engine: testEngine,
                testType,
                testPrompt,
                expectedBehavior: testExpected,
              })
            }
            disabled={
              runTestMut.isPending ||
              !testPrompt.trim() ||
              !testExpected.trim()
            }
          >
            <Play className="w-3.5 h-3.5 mr-1" />
            {runTestMut.isPending ? "測試中..." : "執行測試"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAllTestsMut.mutate()}
            disabled={runAllTestsMut.isPending}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${runAllTestsMut.isPending ? "animate-spin" : ""}`}
            />
            {runAllTestsMut.isPending ? "批量測試中..." : "執行全部預定義測試"}
          </Button>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          測試結果歷史
        </h3>
        {testsQuery.isLoading ? (
          <ZenSkeleton lines={3} />
        ) : (
          <div className="space-y-2">
            {(testsQuery.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                尚無測試記錄,請執行測試
              </p>
            )}
            {(testsQuery.data ?? []).map(t => (
              <div
                key={t.id}
                className={`rounded-lg border p-3 text-xs ${
                  t.passed
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-red-500/20 bg-red-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[9px]">
                        {t.engine}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px]">
                        {t.testType}
                      </Badge>
                      <span
                        className={`font-bold text-sm ${t.passed ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {t.score}/100
                      </span>
                      {t.passed ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <X className="w-3 h-3 text-red-600" />
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      提示:{t.testPrompt}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      結果:{t.actualResult.slice(0, 200)}
                    </p>
                    {t.suggestions.length > 0 && (
                      <div className="mt-1.5 text-[10px] text-amber-600">
                        💡 {t.suggestions.join(";")}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(t.createdAt).toLocaleString("zh-TW")}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
