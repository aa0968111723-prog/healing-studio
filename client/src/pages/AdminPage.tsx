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
import { GlassCard, ZenSkeleton, ZenOrb } from "@/components/ZenCoPilot";
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ZenOrb size="lg" />
        <h3 className="text-base font-medium mt-6">權限不足</h3>
        <p className="text-sm text-muted-foreground mt-2">此頁面僅限管理員存取</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">管理後台</h1>
      </div>

      <p className="text-xs text-muted-foreground">管理使用者配額、處理回饋、檢視團隊成本。</p>

      <Tabs defaultValue="users">
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="users" className="rounded-lg gap-1 text-xs"><Users className="w-3 h-3" /> 使用者</TabsTrigger>
          <TabsTrigger value="feedback" className="rounded-lg gap-1 text-xs"><MessageSquare className="w-3 h-3" /> 回饋</TabsTrigger>
          <TabsTrigger value="costs" className="rounded-lg gap-1 text-xs"><BarChart3 className="w-3 h-3" /> 成本</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4 space-y-2">
          {usersQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : (
            usersQuery.data?.map((u) => (
              <motion.div key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{u.name || "未命名"}</p>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] rounded-md">{u.role === "admin" ? "管理員" : "使用者"}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{u.email || "無信箱"} | 配額: {u.remainingGenerations}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input type="number" placeholder="配額" value={quotaInputs[u.id] ?? ""} onChange={(e) => setQuotaInputs((prev) => ({ ...prev, [u.id]: e.target.value }))} className="w-20 h-8 rounded-lg text-xs" />
                      <Button size="sm" className="rounded-lg h-8 w-8 p-0" onClick={() => { const amount = parseInt(quotaInputs[u.id] || "0"); if (amount >= 0) updateQuota.mutate({ userId: u.id, amount }); }} disabled={updateQuota.isPending}>
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>

        <TabsContent value="feedback" className="mt-4 space-y-2">
          {feedbacksQuery.isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : !feedbacksQuery.data || feedbacksQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有回饋</p>
          ) : (
            feedbacksQuery.data.map((fb) => (
              <motion.div key={fb.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <GlassCard>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{fb.title}</p>
                      {fb.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>}
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{fb.category}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{fb.priority}</span>
                      </div>
                    </div>
                    <Select value={fb.status} onValueChange={(v) => updateFeedbackStatus.mutate({ id: fb.id, status: v as "open" | "in_progress" | "resolved" | "closed" })}>
                      <SelectTrigger className="w-24 h-7 rounded-lg text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">開放</SelectItem>
                        <SelectItem value="in_progress">處理中</SelectItem>
                        <SelectItem value="resolved">已解決</SelectItem>
                        <SelectItem value="closed">已關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </GlassCard>
              </motion.div>
            ))
          )}
        </TabsContent>

        <TabsContent value="costs" className="mt-4 space-y-2">
          {costQuery.isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={2} /></GlassCard>))}</div>
          ) : !costQuery.data || costQuery.data.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">沒有成本資料</p>
          ) : (
            costQuery.data.map((item) => (
              <GlassCard key={item.userId}>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">使用者 #{item.userId}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.totalRequests} 次請求 | {item.totalTokens} tokens</p>
                  </div>
                  <p className="text-lg font-semibold">${parseFloat(String(item.totalCost)).toFixed(3)}</p>
                </div>
              </GlassCard>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
