import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Globe, Lock, Trash2, Cpu, Mic, Palette, Gift } from "lucide-react";
import { motion } from "framer-motion";

const modelTypeLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  image_subject: { label: "圖像主體", icon: <Palette className="w-4 h-4" /> },
  voice_clone: { label: "語音克隆", icon: <Mic className="w-4 h-4" /> },
  style_lora: { label: "風格 LoRA", icon: <Cpu className="w-4 h-4" /> },
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "等待中", color: "bg-yellow-100 text-yellow-700" },
  training: { label: "訓練中", color: "bg-blue-100 text-blue-700" },
  ready: { label: "就緒", color: "bg-green-100 text-green-700" },
  failed: { label: "失敗", color: "bg-red-100 text-red-700" },
};

export default function ModelsPage() {
  const [tab, setTab] = useState("my");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<"image_subject" | "voice_clone" | "style_lora">("image_subject");

  const myModelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });
  const teamModelsQuery = trpc.models.teamModels.useQuery(undefined, { retry: false });

  const createModel = trpc.models.create.useMutation({
    onSuccess: () => {
      myModelsQuery.refetch();
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      toast.success("模型已建立，等待訓練...");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleVisibility = trpc.models.toggleVisibility.useMutation({
    onSuccess: () => {
      myModelsQuery.refetch();
      teamModelsQuery.refetch();
      toast.success("已更新，分享模型可獲得額外配額！");
    },
  });

  const deleteModel = trpc.models.delete.useMutation({
    onSuccess: () => {
      myModelsQuery.refetch();
      toast.success("已刪除");
    },
  });

  const models = tab === "my" ? myModelsQuery.data : teamModelsQuery.data;
  const isLoading = tab === "my" ? myModelsQuery.isLoading : teamModelsQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">微調模型</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="rounded-[25px] gap-1">
              <Plus className="w-4 h-4" />
              新增模型
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-[25px]">
            <DialogHeader>
              <DialogTitle>建立微調模型</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="模型名稱"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-[25px]"
              />
              <Textarea
                placeholder="模型描述（選填）"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="rounded-[20px]"
                rows={3}
              />
              <Select value={newType} onValueChange={(v) => setNewType(v as typeof newType)}>
                <SelectTrigger className="rounded-[25px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image_subject">圖像主體</SelectItem>
                  <SelectItem value="voice_clone">語音克隆</SelectItem>
                  <SelectItem value="style_lora">風格 LoRA</SelectItem>
                </SelectContent>
              </Select>
              <Button
                className="w-full rounded-[25px]"
                onClick={() => createModel.mutate({ name: newName, description: newDesc, modelType: newType })}
                disabled={!newName.trim() || createModel.isPending}
              >
                {createModel.isPending ? "建立中..." : "建立模型"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-[25px] bg-muted/50">
          <TabsTrigger value="my" className="rounded-[20px] gap-1">
            <Lock className="w-3 h-3" />
            我的模型
          </TabsTrigger>
          <TabsTrigger value="team" className="rounded-[20px] gap-1">
            <Globe className="w-3 h-3" />
            團隊共享
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="healing-card bg-muted/30 h-20 animate-pulse rounded-[25px]" />
            ))}
          </div>
        ) : !models || models.length === 0 ? (
          <div className="healing-card bg-card p-12 text-center">
            <Cpu className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              {tab === "my" ? "還沒有微調模型，點擊上方按鈕建立" : "還沒有團隊共享的模型"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {models.map((model) => {
              const typeInfo = modelTypeLabels[model.modelType] || { label: model.modelType, icon: <Cpu className="w-4 h-4" /> };
              const statusInfo = statusLabels[model.status] || { label: model.status, color: "" };
              return (
                <motion.div
                  key={model.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="healing-card bg-card p-4 flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-[15px] bg-muted/50 flex items-center justify-center shrink-0">
                    {typeInfo.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{model.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs rounded-[10px]">
                        {typeInfo.label}
                      </Badge>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                      {model.visibility === "team_shared" && (
                        <Badge variant="outline" className="text-xs rounded-[10px] gap-1">
                          <Gift className="w-2.5 h-2.5" />
                          共享
                        </Badge>
                      )}
                    </div>
                  </div>
                  {tab === "my" && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-[15px] h-8"
                        onClick={() =>
                          toggleVisibility.mutate({
                            id: model.id,
                            visibility: model.visibility === "private" ? "team_shared" : "private",
                          })
                        }
                      >
                        {model.visibility === "private" ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-[15px] h-8 text-destructive"
                        onClick={() => deleteModel.mutate({ id: model.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
