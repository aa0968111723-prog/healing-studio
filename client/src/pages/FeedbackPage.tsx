import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, MessageSquare, Bug, Lightbulb, AlertTriangle, HelpCircle } from "lucide-react";
import { GlassCard, ZenSkeleton, ZenOrb } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";

const categoryInfo: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  bug: { label: "Bug 回報", icon: <Bug className="w-4 h-4" />, color: "bg-zen-blush/20" },
  feature_request: { label: "功能建議", icon: <Lightbulb className="w-4 h-4" />, color: "bg-zen-peach/20" },
  quality_issue: { label: "品質問題", icon: <AlertTriangle className="w-4 h-4" />, color: "bg-zen-sand/20" },
  general: { label: "一般回饋", icon: <HelpCircle className="w-4 h-4" />, color: "bg-zen-sage/20" },
};

const priorityLabels: Record<string, { label: string; color: string }> = {
  low: { label: "低", color: "bg-zen-sage/30 text-green-700" },
  medium: { label: "中", color: "bg-zen-peach/30 text-amber-700" },
  high: { label: "高", color: "bg-zen-blush/30 text-orange-700" },
  critical: { label: "緊急", color: "bg-red-100 text-red-700" },
};

const statusLabels: Record<string, { label: string; color: string }> = {
  open: { label: "開放", color: "bg-zen-sky/30 text-blue-700" },
  in_progress: { label: "處理中", color: "bg-zen-peach/30 text-amber-700" },
  resolved: { label: "已解決", color: "bg-zen-sage/30 text-green-700" },
  closed: { label: "已關閉", color: "bg-muted text-muted-foreground" },
};

export default function FeedbackPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"bug" | "feature_request" | "quality_issue" | "general">("general");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");

  const feedbacksQuery = trpc.feedback.myFeedbacks.useQuery(undefined, { retry: false });

  const createFeedback = trpc.feedback.create.useMutation({
    onSuccess: () => {
      feedbacksQuery.refetch();
      setShowCreate(false);
      setTitle("");
      setDescription("");
      toast.success("回饋已提交");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-zen-smoke" />
          <h1 className="text-xl font-semibold">回饋中心</h1>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-1.5 text-sm"><Plus className="w-4 h-4" /> 提交回饋</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>提交回饋</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <Input placeholder="標題" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl" />
              <Textarea placeholder="詳細描述..." value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" rows={4} />
              <div className="grid grid-cols-2 gap-3">
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="類別" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">Bug 回報</SelectItem>
                    <SelectItem value="feature_request">功能建議</SelectItem>
                    <SelectItem value="quality_issue">品質問題</SelectItem>
                    <SelectItem value="general">一般回饋</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="優先級" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="critical">緊急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full rounded-xl" onClick={() => createFeedback.mutate({ title, description, category, priority })} disabled={!title.trim() || createFeedback.isPending}>
                {createFeedback.isPending ? "提交中..." : "提交回饋"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground">提交問題回報或功能建議，協助我們持續改善平台。</p>

      {feedbacksQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={3} /></GlassCard>))}
        </div>
      ) : feedbacksQuery.data && feedbacksQuery.data.length > 0 ? (
        <div className="space-y-3">
          {feedbacksQuery.data.map((fb) => {
            const catInfo = categoryInfo[fb.category] || categoryInfo.general;
            const priInfo = priorityLabels[fb.priority] || priorityLabels.medium;
            const statInfo = statusLabels[fb.status] || statusLabels.open;
            return (
              <motion.div key={fb.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                <GlassCard>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg ${catInfo.color} flex items-center justify-center shrink-0 mt-0.5`}>
                      {catInfo.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{fb.title}</p>
                      {fb.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/30 font-medium">{catInfo.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${priInfo.color}`}>{priInfo.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${statInfo.color}`}>{statInfo.label}</span>
                        <span className="text-[11px] text-muted-foreground">{new Date(fb.createdAt).toLocaleDateString("zh-TW")}</span>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ZenOrb size="lg" />
          <h3 className="text-base font-medium mt-6">尚無回饋紀錄</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">點擊「提交回饋」分享你的意見</p>
        </div>
      )}
    </div>
  );
}
