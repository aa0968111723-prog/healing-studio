import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Image, Video, Music, Mic, FileText, Package, Globe, Lock, Trash2, Gift } from "lucide-react";
import { motion } from "framer-motion";

const typeIcons: Record<string, React.ReactNode> = {
  image: <Image className="w-4 h-4" />,
  video: <Video className="w-4 h-4" />,
  audio: <Music className="w-4 h-4" />,
  voice: <Mic className="w-4 h-4" />,
  script: <FileText className="w-4 h-4" />,
  zip_bundle: <Package className="w-4 h-4" />,
};

export default function AssetsLibrary() {
  const { user } = useAuth();
  const [tab, setTab] = useState("my");

  const myAssetsQuery = trpc.assets.myAssets.useQuery(undefined, { retry: false });
  const teamAssetsQuery = trpc.assets.teamAssets.useQuery(undefined, { retry: false });

  const toggleVisibility = trpc.assets.toggleVisibility.useMutation({
    onSuccess: () => {
      myAssetsQuery.refetch();
      teamAssetsQuery.refetch();
      toast.success("已更新可見性，分享可獲得額外配額！");
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">數位資產庫</h1>
        <Badge variant="secondary" className="rounded-[25px]">
          {myAssetsQuery.data?.length ?? 0} 個資產
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-[25px] bg-muted/50">
          <TabsTrigger value="my" className="rounded-[20px] gap-1">
            <Lock className="w-3 h-3" />
            我的資產
          </TabsTrigger>
          <TabsTrigger value="team" className="rounded-[20px] gap-1">
            <Globe className="w-3 h-3" />
            團隊共享
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="healing-card bg-muted/30 aspect-square animate-pulse rounded-[25px]" />
              ))}
            </div>
          ) : !assets || assets.length === 0 ? (
            <div className="healing-card bg-card p-12 text-center">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">
                {tab === "my" ? "還沒有任何資產，去創作工作室生成吧！" : "還沒有團隊共享的資產"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {assets.map((asset) => (
                <motion.div
                  key={asset.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="healing-card bg-card overflow-hidden group"
                >
                  {/* Preview */}
                  <div className="aspect-square bg-muted/30 relative overflow-hidden">
                    {asset.fileUrl && asset.assetType === "image" ? (
                      <img
                        src={asset.fileUrl}
                        alt={asset.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        {typeIcons[asset.assetType] || <Package className="w-8 h-8 text-muted-foreground/30" />}
                      </div>
                    )}
                    {/* Overlay actions */}
                    <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/10 transition-all flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100">
                      {tab === "my" && (
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-[20px] bg-white/90 text-xs h-7 gap-1"
                            onClick={() =>
                              toggleVisibility.mutate({
                                id: asset.id,
                                visibility: asset.visibility === "private" ? "team_shared" : "private",
                              })
                            }
                          >
                            {asset.visibility === "private" ? (
                              <><Globe className="w-3 h-3" />分享</>
                            ) : (
                              <><Lock className="w-3 h-3" />私人</>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-[20px] bg-white/90 text-xs h-7"
                            onClick={() => deleteAsset.mutate({ id: asset.id })}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Info */}
                  <div className="p-3">
                    <p className="text-sm font-medium truncate">{asset.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs rounded-[10px]">
                        {asset.assetType === "image" ? "圖片" :
                         asset.assetType === "video" ? "影片" :
                         asset.assetType === "audio" ? "音樂" :
                         asset.assetType === "voice" ? "語音" :
                         asset.assetType === "script" ? "腳本" : "打包"}
                      </Badge>
                      {asset.visibility === "team_shared" && (
                        <Badge variant="outline" className="text-xs rounded-[10px] gap-1">
                          <Gift className="w-2.5 h-2.5" />
                          共享
                        </Badge>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
