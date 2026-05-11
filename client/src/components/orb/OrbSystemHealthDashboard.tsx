/**
 * OrbSystemHealthDashboard.tsx - Real-time system health and performance monitoring
 *
 * Displays:
 * - System health metrics (response time, error rate, etc.)
 * - Spirit collaboration statistics
 * - Cost breakdown and optimization suggestions
 * - Performance trends
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Zap,
  Users,
  Clock,
  Target,
  Database,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthMetric {
  name: string;
  value: number;
  unit: string;
  status: "good" | "warning" | "critical";
  trend?: "up" | "down" | "stable";
  target?: number;
}

interface SpiritCollaboration {
  spiritFrom: string;
  spiritTo: string;
  handoffCount: number;
  avgHandoffTime: number;
  successRate: number;
  contextLossScore: number;
}

interface CostBreakdown {
  category: string;
  amount: number;
  percentage: number;
  trend: "up" | "down" | "stable";
}

interface SystemHealthDashboardProps {
  refreshInterval?: number; // in milliseconds
}

export default function OrbSystemHealthDashboard({
  refreshInterval = 30000,
}: SystemHealthDashboardProps) {
  // Mock data - replace with actual tRPC subscriptions
  const [healthMetrics, setHealthMetrics] = useState<HealthMetric[]>([
    {
      name: "平均回應時間",
      value: 245,
      unit: "ms",
      status: "good",
      trend: "down",
      target: 300,
    },
    {
      name: "錯誤率",
      value: 0.8,
      unit: "%",
      status: "good",
      trend: "stable",
      target: 2,
    },
    {
      name: "工具成功率",
      value: 96.5,
      unit: "%",
      status: "good",
      trend: "up",
      target: 95,
    },
    {
      name: "使用者滿意度",
      value: 4.6,
      unit: "/5",
      status: "good",
      trend: "up",
      target: 4.5,
    },
    {
      name: "記憶體使用",
      value: 72,
      unit: "%",
      status: "warning",
      trend: "up",
      target: 80,
    },
    {
      name: "API 延遲",
      value: 156,
      unit: "ms",
      status: "good",
      trend: "stable",
      target: 200,
    },
    {
      name: "澄清率",
      value: 15,
      unit: "%",
      status: "good",
      trend: "down",
      target: 20,
    },
  ]);

  const [collaborations, setCollaborations] = useState<SpiritCollaboration[]>([
    {
      spiritFrom: "導導 (Director)",
      spiritTo: "圖圖 (Image)",
      handoffCount: 45,
      avgHandoffTime: 1200,
      successRate: 0.96,
      contextLossScore: 0.08,
    },
    {
      spiritFrom: "導導 (Director)",
      spiritTo: "影影 (Video)",
      handoffCount: 32,
      avgHandoffTime: 1500,
      successRate: 0.94,
      contextLossScore: 0.12,
    },
  ]);

  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown[]>([
    { category: "LLM 呼叫", amount: 12.45, percentage: 45, trend: "up" },
    { category: "圖像生成", amount: 8.32, percentage: 30, trend: "stable" },
    { category: "影片生成", amount: 5.54, percentage: 20, trend: "down" },
    { category: "其他", amount: 1.38, percentage: 5, trend: "stable" },
  ]);

  // Refresh data periodically
  useEffect(() => {
    // TODO: Replace with actual tRPC subscription
    const interval = setInterval(() => {
      // Simulate data updates
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  const getStatusIcon = (status: HealthMetric["status"]) => {
    switch (status) {
      case "good":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "critical":
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
    }
  };

  const getTrendIcon = (trend?: HealthMetric["trend"]) => {
    if (!trend) return null;
    switch (trend) {
      case "up":
        return <TrendingUp className="w-3 h-3 text-emerald-500" />;
      case "down":
        return <TrendingDown className="w-3 h-3 text-red-500" />;
      case "stable":
        return <Activity className="w-3 h-3 text-gray-400" />;
    }
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-500" />
          系統健康監控
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          即時系統狀態和效能指標
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="health" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="health" className="text-xs">
            <Activity className="w-3 h-3 mr-1" />
            健康狀態
          </TabsTrigger>
          <TabsTrigger value="collaboration" className="text-xs">
            <Users className="w-3 h-3 mr-1" />
            協作統計
          </TabsTrigger>
          <TabsTrigger value="cost" className="text-xs">
            <DollarSign className="w-3 h-3 mr-1" />
            成本分析
          </TabsTrigger>
        </TabsList>

        {/* Health Metrics Tab */}
        <TabsContent value="health" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {healthMetrics.map((metric) => (
              <Card key={metric.name}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(metric.status)}
                      <span className="text-sm font-medium">{metric.name}</span>
                    </div>
                    {getTrendIcon(metric.trend)}
                  </div>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-2xl font-bold">{metric.value}</span>
                    <span className="text-sm text-muted-foreground">{metric.unit}</span>
                  </div>

                  {metric.target && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>目標</span>
                        <span>
                          {metric.target} {metric.unit}
                        </span>
                      </div>
                      <Progress
                        value={Math.min((metric.value / metric.target) * 100, 100)}
                        className="h-1"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Collaboration Tab */}
        <TabsContent value="collaboration" className="mt-4 space-y-4">
          {collaborations.map((collab, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-500" />
                  {collab.spiritFrom} → {collab.spiritTo}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">交接次數</p>
                    <p className="font-semibold">{collab.handoffCount} 次</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">平均時間</p>
                    <p className="font-semibold">{formatTime(collab.avgHandoffTime)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">成功率</p>
                    <p className="font-semibold">{(collab.successRate * 100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">上下文損失</p>
                    <p className="font-semibold">
                      {(collab.contextLossScore * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Success rate bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>整體表現</span>
                    <span>{(collab.successRate * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={collab.successRate * 100} className="h-2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Cost Analysis Tab */}
        <TabsContent value="cost" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">成本分佈</CardTitle>
              <CardDescription className="text-xs">
                本月總計: ${costBreakdown.reduce((sum, item) => sum + item.amount, 0).toFixed(2)} USD
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {costBreakdown.map((item) => (
                <div key={item.category} className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.category}</span>
                      {item.trend === "up" && (
                        <TrendingUp className="w-3 h-3 text-red-500" />
                      )}
                      {item.trend === "down" && (
                        <TrendingDown className="w-3 h-3 text-emerald-500" />
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${item.amount.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{item.percentage}%</p>
                    </div>
                  </div>
                  <Progress value={item.percentage} className="h-2" />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Optimization suggestions */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <Target className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-900 mb-1">
                    成本優化建議
                  </p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    <li>• 考慮使用更小的模型處理簡單任務</li>
                    <li>• 實施請求快取以減少重複呼叫</li>
                    <li>• 優化 Prompt 以減少 Token 使用</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
