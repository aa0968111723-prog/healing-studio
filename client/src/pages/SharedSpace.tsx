import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, Search, Package, Cpu, Heart, Download,
  Eye, Share2, Sparkles, Image, Music, Video, Mic
} from "lucide-react";
import { motion } from "framer-motion";

const MODALITY_ICONS: Record<string, React.ElementType> = {
  image: Image,
  video: Video,
  audio: Music,
  voice: Mic,
  script: Sparkles,
  zip_bundle: Package,
};

export default function SharedSpace() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("assets");

  // Fetch shared assets
  const sharedAssetsQuery = trpc.assets.teamAssets.useQuery(undefined, { retry: false });
  // Fetch shared models
  const sharedModelsQuery = trpc.models.teamModels.useQuery(undefined, { retry: false });

  const filteredAssets = useMemo(() => {
    const assets = sharedAssetsQuery.data || [];
    if (!searchQuery) return assets;
    return assets.filter(a =>
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.promptUsed && a.promptUsed.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedAssetsQuery.data, searchQuery]);

  const filteredModels = useMemo(() => {
    const models = sharedModelsQuery.data || [];
    if (!searchQuery) return models;
    return models.filter(m =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description && m.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedModelsQuery.data, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6" />
          共享空間
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          探索社群創作、分享你的作品，獲得配額獎勵
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "共享素材", value: sharedAssetsQuery.data?.length || 0, icon: Package },
          { label: "共享模型", value: sharedModelsQuery.data?.length || 0, icon: Cpu },
          { label: "你的貢獻", value: "—", icon: Share2 },
          { label: "獲得獎勵", value: "—", icon: Sparkles },
        ].map((stat) => (
          <GlassCard key={stat.label} className="text-center py-4">
            <stat.icon className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-lg font-semibold text-foreground tabular-nums">{stat.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
        <Input
          placeholder="搜尋共享素材或模型..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-10 rounded-xl bg-white/40 border-white/60"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl bg-muted/30 p-0.5">
          <TabsTrigger value="assets" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Package className="w-4 h-4 mr-1.5" />
            共享素材 ({filteredAssets.length})
          </TabsTrigger>
          <TabsTrigger value="models" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Cpu className="w-4 h-4 mr-1.5" />
            共享模型 ({filteredModels.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="mt-4">
          {sharedAssetsQuery.isLoading ? (
            <ZenSkeleton lines={4} />
          ) : filteredAssets.length === 0 ? (
            <GlassCard className="text-center py-12">
              <Package className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">尚無共享素材</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                在「數位資產庫」中將素材設為團隊共享，即可出現在這裡
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredAssets.map((asset, idx) => {
                const ModalityIcon = MODALITY_ICONS[asset.assetType] || Package;
                return (
                  <motion.div
                    key={asset.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <GlassCard className="overflow-hidden group">
                      {/* Thumbnail */}
                      <div className="aspect-square relative -mx-4 -mt-4 mb-3 overflow-hidden">
                        {asset.fileUrl && (asset.assetType === "image" || asset.assetType === "video") ? (
                          <img
                            src={asset.fileUrl}
                            alt={asset.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted/10">
                            <ModalityIcon className="w-10 h-10 text-muted-foreground/20" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/80 text-muted-foreground" style={{ backdropFilter: "blur(4px)" }}>
                            {asset.assetType}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs font-medium text-foreground truncate">{asset.title}</p>
                      {asset.promptUsed && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{asset.promptUsed}</p>
                      )}
                    </GlassCard>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="models" className="mt-4">
          {sharedModelsQuery.isLoading ? (
            <ZenSkeleton lines={4} />
          ) : filteredModels.length === 0 ? (
            <GlassCard className="text-center py-12">
              <Cpu className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">尚無共享模型</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                在「角色鍛造所」中將模型設為團隊共享，即可出現在這裡
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredModels.map((model, idx) => (
                <motion.div
                  key={model.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <GlassCard>
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center shrink-0">
                        <Cpu className="w-6 h-6 text-primary/40" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{model.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{model.modelType}</p>
                        {model.description && (
                          <p className="text-[10px] text-muted-foreground/70 mt-1 line-clamp-2">{model.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        model.status === "ready" ? "bg-green-500/10 text-green-600" :
                        model.status === "training" ? "bg-yellow-500/10 text-yellow-600" :
                        "bg-muted/30 text-muted-foreground"
                      }`}>
                        {model.status === "ready" ? "就緒" : model.status === "training" ? "訓練中" : model.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(model.createdAt).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
