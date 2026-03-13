import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Users, BarChart3, MessageSquare, Shield, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

export default function AdminPage() {
  const { user } = useAuth();
  const [quotaInputs, setQuotaInputs] = useState<Record<number, string>>({});

  const usersQuery = trpc.admin.allUsers.useQuery(undefined, { retry: false });
  const feedbacksQuery = trpc.feedback.all.useQuery(undefined, { retry: false });
  const costQuery = trpc.admin.teamCostSummary.useQuery(undefined, { retry: false });

  const updateQuota = trpc.admin.updateQuota.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast.success("配額已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateFeedbackStatus = trpc.feedback.updateStatus.useMutation({
    onSuccess: () => {
      feedbacksQuery.refetch();
      toast.success("狀態已更新");
    },
  });

  if (user?.role !== "admin") {
    return (
      <div className="healing-card bg-card p-12 text-center">
        <Shield className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground">此頁面僅限管理員存取</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Shield className="w-6 h-6" />
        管理後台
      </h1>

      <Tabs defaultValue="users">
        <TabsList className="rounded-[25px] bg-muted/50">
          <TabsTrigger value="users" className="rounded-[20px] gap-1">
            <Users className="w-3 h-3" />
            使用者
          </TabsTrigger>
          <TabsTrigger value="feedback" className="rounded-[20px] gap-1">
            <MessageSquare className="w-3 h-3" />
            回饋
          </TabsTrigger>
          <TabsTrigger value="costs" className="rounded-[20px] gap-1">
            <BarChart3 className="w-3 h-3" />
            成本
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-4">
          {usersQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted/30 animate-pulse rounded-[25px]" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {usersQuery.data?.map((u) => (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="healing-card bg-card p-4 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{u.name || "未命名"}</p>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs rounded-[10px]">
                        {u.role === "admin" ? "管理員" : "使用者"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {u.email || "無信箱"} | 配額: {u.remainingGenerations}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="number"
                      placeholder="配額"
                      value={quotaInputs[u.id] ?? ""}
                      onChange={(e) => setQuotaInputs((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      className="w-20 h-8 rounded-[15px] text-sm"
                    />
                    <Button
                      size="sm"
                      className="rounded-[15px] h-8"
                      onClick={() => {
                        const amount = parseInt(quotaInputs[u.id] || "0");
                        if (amount >= 0) updateQuota.mutate({ userId: u.id, amount });
                      }}
                      disabled={updateQuota.isPending}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback" className="mt-4">
          {feedbacksQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted/30 animate-pulse rounded-[25px]" />
              ))}
            </div>
          ) : !feedbacksQuery.data || feedbacksQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">沒有回饋</p>
          ) : (
            <div className="space-y-2">
              {feedbacksQuery.data.map((fb) => (
                <motion.div
                  key={fb.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="healing-card bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{fb.title}</p>
                      {fb.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs rounded-[10px]">{fb.category}</Badge>
                        <Badge variant="outline" className="text-xs rounded-[10px]">{fb.priority}</Badge>
                      </div>
                    </div>
                    <Select
                      value={fb.status}
                      onValueChange={(v) =>
                        updateFeedbackStatus.mutate({
                          id: fb.id,
                          status: v as "open" | "in_progress" | "resolved" | "closed",
                        })
                      }
                    >
                      <SelectTrigger className="w-28 h-8 rounded-[15px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">開放</SelectItem>
                        <SelectItem value="in_progress">處理中</SelectItem>
                        <SelectItem value="resolved">已解決</SelectItem>
                        <SelectItem value="closed">已關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Costs Tab */}
        <TabsContent value="costs" className="mt-4">
          {costQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted/30 animate-pulse rounded-[25px]" />
              ))}
            </div>
          ) : !costQuery.data || costQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">沒有成本資料</p>
          ) : (
            <div className="space-y-2">
              {costQuery.data.map((item) => (
                <div key={item.userId} className="healing-card bg-card p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="font-medium">使用者 #{item.userId}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.totalRequests} 次請求 | {item.totalTokens} tokens
                    </p>
                  </div>
                  <p className="text-lg font-semibold">${parseFloat(String(item.totalCost)).toFixed(3)}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
