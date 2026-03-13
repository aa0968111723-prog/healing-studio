import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Image, Video, Music, Mic, FileText, Package, Globe, Lock, Trash2, Gift, ExternalLink } from "lucide-react";
import { GlassCard, ZenSkeleton, ZenOrb } from "@/components/ZenCoPilot";
import { motion } from "framer-motion";

const typeConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  image: { icon: <Image className="w-4 h-4" />, label: "圖片", color: "bg-zen-lavender/20" },
  video: { icon: <Video className="w-4 h-4" />, label: "影片", color: "bg-zen-sky/20" },
  audio: { icon: <Music className="w-4 h-4" />, label: "音樂", color: "bg-zen-peach/20" },
  voice: { icon: <Mic className="w-4 h-4" />, label: "語音", color: "bg-zen-blush/20" },
  script: { icon: <FileText className="w-4 h-4" />, label: "腳本", color: "bg-zen-sage/20" },
  zip_bundle: { icon: <Package className="w-4 h-4" />, label: "打包", color: "bg-zen-sand/20" },
};

export default function AssetsLibrary() {
  const [tab, setTab] = useState("my");

  const myAssetsQuery = trpc.assets.myAssets.useQuery(undefined, { retry: false });
  const teamAssetsQuery = trpc.assets.teamAssets.useQuery(undefined, { retry: false });

  const toggleVisibility = trpc.assets.toggleVisibility.useMutation({
    onSuccess: () => {
      myAssetsQuery.refetch();
      teamAssetsQuery.refetch();
      toast.success("已更新，分享資產可獲得額外配額");
    },
  });

  const deleteAsset = trpc.assets.delete.useMutation({
    onSuccess: () => {
      myAssetsQuery.refetch();
      toast.success("已刪除");
    },
  });

  const assets = tab === "my" ? myAssetsQuery.data : teamAssetsQuery.data;
  const isLoading = tab === "my" ? myAssetsQuery.isLoading : teamAssetsQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-zen-smoke" />
          <h1 className="text-xl font-semibold">數位資產庫</h1>
        </div>
        <Badge variant="secondary" className="rounded-lg text-xs">
          {myAssetsQuery.data?.length ?? 0} 個資產
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">管理所有生成的數位資產。分享至團隊可獲得額外配額獎勵。</p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="my" className="rounded-lg gap-1 text-xs"><Lock className="w-3 h-3" /> 我的資產</TabsTrigger>
          <TabsTrigger value="team" className="rounded-lg gap-1 text-xs"><Globe className="w-3 h-3" /> 團隊共享</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <GlassCard key={i} hover={false}>
              <div className="aspect-square rounded-lg bg-muted/30 animate-pulse mb-3" />
              <ZenSkeleton lines={2} />
            </GlassCard>
          ))}
        </div>
      ) : assets && assets.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((asset, idx) => {
            const config = typeConfig[asset.assetType] || { icon: <Package className="w-4 h-4" />, label: asset.assetType, color: "bg-muted/20" };
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <GlassCard className="overflow-hidden group">
                  {/* Preview */}
                  <div className="aspect-square rounded-lg overflow-hidden bg-muted/20 relative mb-3">
                    {asset.fileUrl && asset.assetType === "image" ? (
                      <img src={asset.fileUrl} alt={asset.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    ) : asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt={asset.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className={`w-12 h-12 rounded-xl ${config.color} flex items-center justify-center`}>
                          {config.icon}
                        </div>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1">
                        {asset.fileUrl && (
                          <Button variant="outline" size="sm" className="rounded-lg bg-white/90 text-xs h-7 gap-1" onClick={() => window.open(asset.fileUrl!, "_blank")}>
                            <ExternalLink className="w-3 h-3" /> 開啟
                          </Button>
                        )}
                        {tab === "my" && (
                          <>
                            <Button variant="outline" size="sm" className="rounded-lg bg-white/90 text-xs h-7 gap-1" onClick={() => toggleVisibility.mutate({ id: asset.id, visibility: asset.visibility === "private" ? "team_shared" : "private" })}>
                              {asset.visibility === "private" ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                            </Button>
                            <Button variant="outline" size="sm" className="rounded-lg bg-white/90 text-xs h-7 text-destructive" onClick={() => deleteAsset.mutate({ id: asset.id })}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Info */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium truncate">{asset.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${config.color} text-foreground`}>{config.label}</span>
                      {asset.visibility === "team_shared" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md">
                          <Gift className="w-2.5 h-2.5" /> 共享
                        </span>
                      )}
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
          <h3 className="text-base font-medium mt-6">尚無數位資產</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {tab === "my" ? "前往工作室生成你的第一個作品" : "還沒有團隊共享的資產"}
          </p>
        </div>
      )}
    </div>
  );
}
