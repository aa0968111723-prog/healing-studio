/**
 * ConsistencyCheckPanel — 一致性檢查面板
 *
 * 功能：
 * 1. 顯示上傳圖幀的一致性檢查結果
 * 2. 角色、場景、風格的一致性分析
 * 3. 問題與建議列表
 * 4. 觸發重新檢查
 */

import { useState } from "react";
import { AlertCircle, Check, X, RefreshCw, Eye, AlertTriangle, Info } from "lucide-react";
import type {
  TimelineFrame,
  ConsistencyCheckResult,
  ConsistencyItem,
  ConsistencyIssue,
} from "../../../../shared/worldbuilding-timeline";
import { Button } from "../ui/button";
import { trpc } from "../../lib/trpc";

interface ConsistencyCheckPanelProps {
  frame: TimelineFrame;
  className?: string;
  onCheckComplete?: (result: ConsistencyCheckResult) => void;
}

export function ConsistencyCheckPanel({
  frame,
  className = "",
  onCheckComplete,
}: ConsistencyCheckPanelProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ConsistencyCheckResult | undefined>(
    frame.consistencyCheck
  );

  // Check consistency mutation
  const checkConsistencyMutation = trpc.worldbuilding.checkConsistency.useMutation({
    onMutate: () => {
      setIsChecking(true);
    },
    onSuccess: (result) => {
      setCheckResult(result);
      setIsChecking(false);
      onCheckComplete?.(result);
    },
    onError: (error) => {
      setIsChecking(false);
      alert(`一致性檢查失敗：${error.message}`);
    },
  });

  const handleRunCheck = () => {
    if (!frame.id) return;
    checkConsistencyMutation.mutate({
      timelineFrameId: frame.id,
    });
  };

  const getSeverityIcon = (severity: ConsistencyIssue["severity"]) => {
    switch (severity) {
      case "critical":
        return <X className="w-4 h-4 text-red-500" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "info":
        return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-green-100 dark:bg-green-900/30";
    if (score >= 60) return "bg-yellow-100 dark:bg-yellow-900/30";
    return "bg-red-100 dark:bg-red-900/30";
  };

  const renderConsistencyItem = (item: ConsistencyItem) => {
    return (
      <div
        key={item.name}
        className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
      >
        <div
          className={`flex items-center justify-center w-12 h-12 rounded-full ${getScoreBgColor(
            item.score
          )}`}
        >
          <span className={`text-lg font-bold ${getScoreColor(item.score)}`}>
            {item.score}
          </span>
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm">{item.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{item.details}</div>
          {item.referenceUrls && item.referenceUrls.length > 0 && (
            <div className="mt-2 flex gap-2">
              {item.referenceUrls.slice(0, 3).map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`參考 ${idx + 1}`}
                  className="w-16 h-16 object-cover rounded border border-border"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderIssue = (issue: ConsistencyIssue, idx: number) => {
    return (
      <div
        key={idx}
        className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
      >
        {getSeverityIcon(issue.severity)}
        <div className="flex-1">
          <div className="font-medium text-sm">{issue.message}</div>
          {issue.suggestedFix && (
            <div className="text-xs text-muted-foreground mt-1 italic">
              建議：{issue.suggestedFix}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {issue.category === "character" && "角色問題"}
            {issue.category === "scene" && "場景問題"}
            {issue.category === "style" && "風格問題"}
            {issue.category === "technical" && "技術問題"}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="w-5 h-5" />
          一致性檢查
        </h3>
        <Button
          onClick={handleRunCheck}
          disabled={isChecking || !frame.id}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
          {isChecking ? "檢查中..." : checkResult ? "重新檢查" : "開始檢查"}
        </Button>
      </div>

      {/* Frame Preview */}
      <div className="rounded-lg border border-border overflow-hidden">
        <img
          src={frame.imageUrl}
          alt={frame.title || "Timeline frame"}
          className="w-full h-auto max-h-64 object-contain bg-muted"
        />
        {frame.title && (
          <div className="p-3 border-t border-border">
            <div className="font-medium text-sm">{frame.title}</div>
            {frame.description && (
              <div className="text-xs text-muted-foreground mt-1">
                {frame.description}
              </div>
            )}
          </div>
        )}
      </div>

      {!checkResult && !isChecking && (
        <div className="text-center p-8 border border-dashed border-border rounded-lg">
          <Eye className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-4">
            尚未進行一致性檢查
          </p>
          <Button onClick={handleRunCheck} disabled={!frame.id}>
            開始檢查
          </Button>
        </div>
      )}

      {isChecking && (
        <div className="text-center p-8 border border-border rounded-lg">
          <RefreshCw className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            正在分析圖幀一致性...
          </p>
        </div>
      )}

      {checkResult && !isChecking && (
        <>
          {/* Overall Score */}
          <div className="rounded-lg border border-border p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">總體一致性評分</span>
              <div className="flex items-center gap-2">
                {checkResult.overallScore >= 80 ? (
                  <Check className="w-5 h-5 text-green-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-500" />
                )}
                <span
                  className={`text-2xl font-bold ${getScoreColor(
                    checkResult.overallScore
                  )}`}
                >
                  {checkResult.overallScore}
                </span>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  checkResult.overallScore >= 80
                    ? "bg-green-500"
                    : checkResult.overallScore >= 60
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${checkResult.overallScore}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              檢查時間：{new Date(checkResult.checkedAt).toLocaleString("zh-TW")}
            </div>
          </div>

          {/* Character Consistency */}
          {checkResult.characterConsistency.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">角色一致性</h4>
              <div className="space-y-2">
                {checkResult.characterConsistency.map(renderConsistencyItem)}
              </div>
            </div>
          )}

          {/* Scene Consistency */}
          {checkResult.sceneConsistency.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">場景一致性</h4>
              <div className="space-y-2">
                {checkResult.sceneConsistency.map(renderConsistencyItem)}
              </div>
            </div>
          )}

          {/* Style Consistency */}
          {checkResult.styleConsistency.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">風格一致性</h4>
              <div className="space-y-2">
                {checkResult.styleConsistency.map(renderConsistencyItem)}
              </div>
            </div>
          )}

          {/* Issues */}
          {checkResult.issues.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                問題與建議 ({checkResult.issues.length})
              </h4>
              <div className="space-y-2">
                {checkResult.issues.map(renderIssue)}
              </div>
            </div>
          )}

          {/* AI Suggestions */}
          {checkResult.suggestions && checkResult.suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">AI 建議</h4>
              <div className="space-y-2">
                {checkResult.suggestions.map((suggestion, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border border-border bg-card text-sm"
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            </div>
          )}

          {checkResult.issues.length === 0 && (
            <div className="text-center p-4 border border-dashed border-green-500/50 rounded-lg bg-green-50 dark:bg-green-900/20">
              <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                未發現一致性問題
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
