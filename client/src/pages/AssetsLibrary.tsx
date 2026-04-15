import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Image,
  Video,
  Music,
  Mic,
  FileText,
  Package,
  Globe,
  Lock,
  Trash2,
  Gift,
  ExternalLink,
  Download,
  Calendar,
  HardDrive,
  Wand2,
  ChevronDown,
  ChevronRight,
  Plus,
  Upload,
  Search,
  X,
  Filter,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion, AnimatePresence } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import { useIsMobile } from "@/hooks/useMobile";
import { shortErrorMsg } from "@/lib/upload";

const typeConfig: Record<
  string,
  {
    icon: React.ReactNode;
    label: string;
    color: string;
    ext: string;
    mimePrefix: string;
  }
> = {
  image: {
    icon: <Image className="w-4 h-4" />,
    label: "圖片",
    color: "bg-zen-lavender/20",
    ext: "png",
    mimePrefix: "image/",
  },
  video: {
    icon: <Video className="w-4 h-4" />,
    label: "影片",
    color: "bg-zen-sky/20",
    ext: "mp4",
    mimePrefix: "video/",
  },
  audio: {
    icon: <Music className="w-4 h-4" />,
    label: "音樂",
    color: "bg-zen-peach/20",
    ext: "mp3",
    mimePrefix: "audio/",
  },
  voice: {
    icon: <Mic className="w-4 h-4" />,
    label: "語音",
    color: "bg-zen-blush/20",
    ext: "mp3",
    mimePrefix: "audio/",
  },
  script: {
    icon: <FileText className="w-4 h-4" />,
    label: "腳本",
    color: "bg-zen-sage/20",
    ext: "txt",
    mimePrefix: "text/",
  },
  zip_bundle: {
    icon: <Package className="w-4 h-4" />,
    label: "打包",
    color: "bg-zen-sand/20",
    ext: "zip",
    mimePrefix: "application/zip",
  },
};

const ASSET_TYPES = [
  "all",
  "image",
  "video",
  "audio",
  "voice",
  "script",
  "zip_bundle",
] as const;
type AssetTypeFilter = (typeof ASSET_TYPES)[number];

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFile(url: string, filename: string) {
  try {
    // Use server proxy to bypass CORS restrictions on CDN URLs
    const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    toast.success(`已下載 ${filename}`);
  } catch {
    window.open(url, "_blank");
    toast.info("已在新分頁開啟，請右鍵另存新檔");
  }
}

// ─── Upload Dialog ──────────────────────────────────────────────────────────
function UploadDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assetType, setAssetType] = useState<
    "image" | "video" | "audio" | "voice" | "script" | "zip_bundle"
  >("image");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.assets.upload.useMutation({
    onSuccess: () => {
      toast.success("資產已上傳");
      setOpen(false);
      setTitle("");
      setSelectedFile(null);
      onSuccess();
    },
    onError: e =>
      toast.error("上傳失敗：" + shortErrorMsg(e.message), { duration: 5000 }),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    // Auto-detect type
    if (file.type.startsWith("image/")) setAssetType("image");
    else if (file.type.startsWith("video/")) setAssetType("video");
    else if (file.type.startsWith("audio/")) setAssetType("audio");
    else if (file.type === "text/plain" || file.type.includes("script"))
      setAssetType("script");
    else if (file.type === "application/zip" || file.name.endsWith(".zip"))
      setAssetType("zip_bundle");
  };

  const handleUpload = async () => {
    if (!selectedFile || !title.trim()) {
      toast.error("請選擇檔案並輸入標題");
      return;
    }
    setUploading(true);
    try {
      // Read file as base64
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
          data: base64Data,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "上傳失敗");
      }
      const { url, fileKey } = await resp.json();
      await uploadMutation.mutateAsync({
        title: title.trim(),
        assetType,
        fileUrl: url,
        fileKey,
        mimeType: selectedFile.type,
        fileSizeBytes: selectedFile.size,
      });
    } catch (err: any) {
      toast.error("上傳失敗：" + shortErrorMsg(err), { duration: 5000 });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl gap-1.5 text-sm" size="sm">
          <Plus className="w-4 h-4" /> 上傳資產
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> 手動上傳資產
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* File picker */}
          <div
            className="border-2 border-dashed border-border/40 rounded-xl p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
            {selectedFile ? (
              <div className="space-y-1">
                <Package className="w-8 h-8 text-primary mx-auto" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(selectedFile.size)}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">點擊選擇檔案</p>
                <p className="text-xs text-muted-foreground/60">
                  支援圖片、影片、音訊、文字、ZIP
                </p>
              </div>
            )}
          </div>
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">資產標題</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="輸入標題..."
              className="h-9 text-sm rounded-lg"
            />
          </div>
          {/* Type */}
          <div className="space-y-1.5">
            <Label className="text-xs">資產類型</Label>
            <Select
              value={assetType}
              onValueChange={v => setAssetType(v as typeof assetType)}
            >
              <SelectTrigger className="h-9 text-sm rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "image",
                    "video",
                    "audio",
                    "voice",
                    "script",
                    "zip_bundle",
                  ] as const
                ).map(t => (
                  <SelectItem key={t} value={t}>
                    {typeConfig[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full h-10 rounded-xl gap-2"
            onClick={handleUpload}
            disabled={uploading || !selectedFile}
          >
            {uploading ? (
              <>
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />{" "}
                上傳中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> 上傳
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AssetsLibrary() {
  const { personality } = useAIState();
  const isMobile = useIsMobile();

  // 全站新手引導
  usePageTour("assets");
  const [tab, setTab] = useState("my");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");

  const myAssetsQuery = trpc.assets.myAssets.useQuery(
    { assetType: typeFilter, search: search || undefined },
    { retry: false }
  );
  const teamAssetsQuery = trpc.assets.teamAssets.useQuery(
    { assetType: typeFilter, search: search || undefined },
    { retry: false }
  );

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
  const isLoading =
    tab === "my" ? myAssetsQuery.isLoading : teamAssetsQuery.isLoading;
  const totalMyAssets = myAssetsQuery.data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-muted-foreground" />
          <h1 className="hs-h2 !mb-0">數位資產庫</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-lg text-xs">
            {totalMyAssets} 個資產
          </Badge>
          <UploadDialog onSuccess={() => myAssetsQuery.refetch()} />
        </div>
      </div>

      <p className="hs-small !mb-0 text-muted-foreground">
        管理所有生成與上傳的數位資產。分享至團隊可獲得額外配額獎勵。
      </p>

      {/* Search + Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋資產..."
            className="pl-8 h-8 text-xs rounded-lg"
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearch("")}
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {ASSET_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1 ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`}
            >
              {t === "all" ? (
                <Filter className="w-3 h-3" />
              ) : (
                typeConfig[t]?.icon
              )}
              {t === "all" ? "全部" : typeConfig[t]?.label}
            </button>
          ))}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="my" className="rounded-lg gap-1 text-xs">
            <Lock className="w-3 h-3" /> 我的資產
          </TabsTrigger>
          <TabsTrigger value="team" className="rounded-lg gap-1 text-xs">
            <Globe className="w-3 h-3" /> 團隊共享
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map(i => (
            <GlassCard key={i} hover={false}>
              <div className="aspect-square rounded-lg bg-muted/30 animate-pulse mb-3" />
              <ZenSkeleton lines={2} />
            </GlassCard>
          ))}
        </div>
      ) : assets && assets.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {assets.map((asset, idx) => {
            const config = typeConfig[asset.assetType] || {
              icon: <Package className="w-4 h-4" />,
              label: asset.assetType,
              color: "bg-muted/20",
              ext: "bin",
              mimePrefix: "",
            };
            const isExpanded = expandedId === asset.id;
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <GlassCard className="overflow-hidden group p-2 sm:p-4">
                  {/* Preview */}
                  <div className="aspect-square rounded-lg overflow-hidden bg-muted/20 relative mb-2 sm:mb-3">
                    {asset.fileUrl && asset.assetType === "image" ? (
                      <img
                        src={asset.fileUrl}
                        alt={asset.title}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : asset.fileUrl && asset.assetType === "video" ? (
                      <video
                        src={asset.fileUrl}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div
                          className={`w-12 h-12 rounded-xl ${config.color} flex items-center justify-center`}
                        >
                          {config.icon}
                        </div>
                      </div>
                    )}
                    {/* Desktop hover overlay */}
                    {!isMobile && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100">
                        <div className="flex gap-1">
                          {asset.fileUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg bg-white/90 text-xs h-7 gap-1"
                              onClick={() =>
                                downloadFile(
                                  asset.fileUrl!,
                                  `${asset.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.${config.ext}`
                                )
                              }
                            >
                              <Download className="w-3 h-3" /> 下載
                            </Button>
                          )}
                          {asset.fileUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg bg-white/90 text-xs h-7 gap-1"
                              onClick={() =>
                                window.open(asset.fileUrl!, "_blank")
                              }
                            >
                              <ExternalLink className="w-3 h-3" /> 開啟
                            </Button>
                          )}
                          {tab === "my" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg bg-white/90 text-xs h-7 gap-1"
                                onClick={() =>
                                  toggleVisibility.mutate({
                                    id: asset.id,
                                    visibility:
                                      asset.visibility === "private"
                                        ? "team_shared"
                                        : "private",
                                  })
                                }
                              >
                                {asset.visibility === "private" ? (
                                  <Globe className="w-3 h-3" />
                                ) : (
                                  <Lock className="w-3 h-3" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg bg-white/90 text-xs h-7 text-destructive"
                                onClick={() =>
                                  deleteAsset.mutate({ id: asset.id })
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mobile action bar */}
                  {isMobile && (
                    <div className="flex gap-1 mb-2 justify-end">
                      {asset.fileUrl && (
                        <button
                          className="p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors"
                          title="下載"
                          onClick={() =>
                            downloadFile(
                              asset.fileUrl!,
                              `${asset.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.${config.ext}`
                            )
                          }
                        >
                          <Download className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      )}
                      {asset.fileUrl && (
                        <button
                          className="p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors"
                          title="開啟"
                          onClick={() => window.open(asset.fileUrl!, "_blank")}
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      )}
                      {tab === "my" && (
                        <>
                          <button
                            className="p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors"
                            title={
                              asset.visibility === "private"
                                ? "分享到團隊"
                                : "設為私人"
                            }
                            onClick={() =>
                              toggleVisibility.mutate({
                                id: asset.id,
                                visibility:
                                  asset.visibility === "private"
                                    ? "team_shared"
                                    : "private",
                              })
                            }
                          >
                            {asset.visibility === "private" ? (
                              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            className="p-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 transition-colors"
                            title="刪除"
                            onClick={() => deleteAsset.mutate({ id: asset.id })}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Info */}
                  <div className="space-y-2">
                    <p className="hs-h3 !mb-0 truncate">{asset.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${config.color} text-foreground`}
                      >
                        {config.label}
                      </span>
                      {asset.visibility === "team_shared" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md">
                          <Gift className="w-2.5 h-2.5" /> 共享
                        </span>
                      )}
                      {asset.rewardCredits > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                          +{asset.rewardCredits} 配額
                        </span>
                      )}
                    </div>

                    <button
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : asset.id)
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                      {isExpanded ? "收合詳情" : "展開詳情"}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-2 border-t border-border/20 space-y-1.5 text-[10px] text-muted-foreground">
                            {asset.description && (
                              <div>
                                <span className="font-medium text-foreground">
                                  描述：
                                </span>
                                <span>{asset.description}</span>
                              </div>
                            )}
                            {asset.promptUsed && (
                              <div>
                                <span className="font-medium text-foreground flex items-center gap-0.5 mb-0.5">
                                  <Wand2 className="w-2.5 h-2.5" />{" "}
                                  使用的提示詞：
                                </span>
                                <p className="hs-p !mb-0 whitespace-pre-wrap">
                                  {asset.promptUsed}
                                </p>
                              </div>
                            )}
                            {asset.mimeType && (
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-foreground">
                                  格式：
                                </span>
                                <span>{asset.mimeType}</span>
                              </div>
                            )}
                            {asset.fileSizeBytes != null && (
                              <div className="flex items-center gap-1">
                                <HardDrive className="w-2.5 h-2.5" />
                                <span className="font-medium text-foreground">
                                  大小：
                                </span>
                                <span>{formatBytes(asset.fileSizeBytes)}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <Calendar className="w-2.5 h-2.5" />
                              <span className="font-medium text-foreground">
                                建立：
                              </span>
                              <span>
                                {new Date(asset.createdAt).toLocaleString(
                                  "zh-TW"
                                )}
                              </span>
                            </div>
                            {asset.fileUrl && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full h-7 text-xs gap-1 rounded-lg mt-2"
                                onClick={() =>
                                  downloadFile(
                                    asset.fileUrl!,
                                    `${asset.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.${config.ext}`
                                  )
                                }
                              >
                                <Download className="w-3 h-3" /> 下載{" "}
                                {config.ext.toUpperCase()}
                              </Button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VisualSoul size="lg" personality={personality} />
          <h3 className="hs-h3 !mb-0 mt-6">
            {search || typeFilter !== "all"
              ? "沒有符合條件的資產"
              : "尚無數位資產"}
          </h3>
          <p className="hs-p !mb-0 text-muted-foreground mt-2 max-w-sm">
            {search || typeFilter !== "all"
              ? "請嘗試其他搜尋條件"
              : tab === "my"
                ? "前往工作室生成或點擊「上傳資產」手動添加"
                : "還沒有團隊共享的資產"}
          </p>
        </div>
      )}
    </div>
  );
}
