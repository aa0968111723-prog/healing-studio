import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, MessageSquare, Bug, Lightbulb, AlertTriangle, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";

const categoryInfo: Record<string, { label: string; icon: React.ReactNode }> = {
  bug: { label: "Bug 回報", icon: <Bug className="w-4 h-4" /> },
  feature_request: { label: "功能建議", icon: <Lightbulb className="w-4 h-4" /> },
  quality_issue: { label: "品質問題", icon: <AlertTriangle className="w-4 h-4" /> },
  general: { label: "一般回饋", icon: <HelpCircle className="w-4 h-4" /> },
};

const priorityColors: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const statusColors: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
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
      toast.success("回饋已提交，感謝你的意見！");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">回饋中心</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-[25px] gap-1">
              <Plus className="w-4 h-4" />
              提交回饋
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-[25px]">
            <DialogHeader>
              <DialogTitle>提交回饋</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="標題"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-[25px]"
              />
              <Textarea
                placeholder="詳細描述..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-[20px]"
                rows={4}
              />
              <div className="grid grid-cols-2 gap-3">
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger className="rounded-[25px]">
                    <SelectValue placeholder="類別" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">Bug 回報</SelectItem>
                    <SelectItem value="feature_request">功能建議</SelectItem>
                    <SelectItem value="quality_issue">品質問題</SelectItem>
                    <SelectItem value="general">一般回饋</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectTrigger className="rounded-[25px]">
                    <SelectValue placeholder="優先級" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="critical">緊急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full rounded-[25px]"
                onClick={() => createFeedback.mutate({ title, description, category, priority })}
                disabled={!title.trim() || createFeedback.isPending}
              >
                {createFeedback.isPending ? "提交中..." : "提交回饋"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {feedbacksQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="healing-card bg-muted/30 h-20 animate-pulse rounded-[25px]" />
          ))}
        </div>
      ) : !feedbacksQuery.data || feedbacksQuery.data.length === 0 ? (
        <div className="healing-card bg-card p-12 text-center">
          <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">還沒有回饋紀錄</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feedbacksQuery.data.map((fb) => {
            const catInfo = categoryInfo[fb.category] || categoryInfo.general;
            return (
              <motion.div
                key={fb.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="healing-card bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-[12px] bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                    {catInfo.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{fb.title}</p>
                    {fb.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs rounded-[10px]">
                        {catInfo.label}
                      </Badge>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColors[fb.priority] || ""}`}>
                        {fb.priority === "low" ? "低" : fb.priority === "medium" ? "中" : fb.priority === "high" ? "高" : "緊急"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[fb.status] || ""}`}>
                        {fb.status === "open" ? "開放" : fb.status === "in_progress" ? "處理中" : fb.status === "resolved" ? "已解決" : "已關閉"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(fb.createdAt).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
