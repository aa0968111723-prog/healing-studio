import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  Image as ImageIcon,
  Video,
  Music,
  Mic,
  FileText,
  Search,
  ExternalLink,
  PlusCircle,
  X,
} from "lucide-react";
import { useAssetsDrawer, type AssetForInsert } from "@/contexts/AssetsDrawerContext";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

// ─── Type helpers ────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <ImageIcon className="w-3.5 h-3.5" />,
  video: <Video className="w-3.5 h-3.5" />,
  audio: <Music className="w-3.5 h-3.5" />,
  voice: <Mic className="w-3.5 h-3.5" />,
  script: <FileText className="w-3.5 h-3.5" />,
  zip_bundle: <Package className="w-3.5 h-3.5" />,
};

const TYPE_COLORS: Record<string, string> = {
  image: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  video: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  audio: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  voice: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  script: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  zip_bundle: "bg-muted/20 text-muted-foreground/70 border-border/30",
};

const TYPE_LABELS: Record<string, string> = {
  all: "全部",
  image: "圖片",
  video: "影片",
  audio: "音樂",
  voice: "語音",
  script: "腳本",
};

type AssetTypeFilter = "all" | "image" | "video" | "audio" | "voice" | "script";
const FILTER_TABS: AssetTypeFilter[] = ["all", "image", "video", "audio", "voice"];

// ─── Asset Card ──────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  onInsert,
  hasInsert,
}: {
  asset: {
    id: number;
    title: string;
    fileUrl: string | null;
    thumbnailUrl?: string | null;
    assetType: string;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    createdAt: Date | string;
  };
  onInsert: (asset: AssetForInsert) => void;
  hasInsert: boolean;
}) {
  const isImage = asset.assetType === "image";
  const isVideo = asset.assetType === "video";
  const typeColor = TYPE_COLORS[asset.assetType] ?? "bg-muted/20 text-muted-foreground/70 border-border/30";
  const typeIcon = TYPE_ICONS[asset.assetType] ?? <Package className="w-3.5 h-3.5" />;
  const displayUrl = asset.thumbnailUrl || asset.fileUrl;

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 transition-colors">
      {/* Thumbnail / Icon */}
      <div className="w-14 h-14 rounded-md overflow-hidden bg-white/5 flex-shrink-0 flex items-center justify-center">
        {isImage && displayUrl ? (
          <img src={displayUrl} alt={asset.title} className="w-full h-full object-cover" />
        ) : isVideo && asset.fileUrl ? (
          <video src={asset.fileUrl} className="w-full h-full object-cover" muted />
        ) : (
          <span className="text-muted-foreground/50">{typeIcon}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">{asset.title}</p>
        <Badge
          variant="outline"
          className={cn("mt-1 text-[10px] px-1.5 py-0 h-4 gap-0.5", typeColor)}
        >
          {typeIcon}
          <span className="ml-0.5">{TYPE_LABELS[asset.assetType] ?? asset.assetType}</span>
        </Badge>

        {/* Actions */}
        <div className="flex gap-1.5 mt-2">
          {hasInsert && asset.fileUrl && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] px-2 gap-1 border-white/15"
              onClick={() =>
                onInsert({
                  id: asset.id,
                  title: asset.title,
                  fileUrl: asset.fileUrl!,
                  assetType: asset.assetType,
                  mimeType: asset.mimeType,
                })
              }
            >
              <PlusCircle className="w-3 h-3" />
              插入參考
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 gap-1 text-muted-foreground"
            onClick={() => asset.fileUrl && window.open(asset.fileUrl, "_blank")}
          >
            <ExternalLink className="w-3 h-3" />
            開啟
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export default function AssetsQuickDrawer() {
  const { isOpen, closeDrawer, insertCallback } = useAssetsDrawer();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");

  const assetsQuery = trpc.assets.myAssets.useQuery(
    { assetType: typeFilter, search: search || undefined },
    { enabled: isOpen }
  );

  const assets = assetsQuery.data ?? [];

  function handleInsert(asset: AssetForInsert) {
    insertCallback?.(asset);
    closeDrawer();
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeDrawer();
      }}
    >
      <SheetContent
        side="right"
        className="w-[380px] sm:w-[420px] bg-background/80 backdrop-blur-2xl border-l border-white/10 p-0 overflow-hidden"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <Package className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <SheetTitle className="text-base">素材庫</SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground/60">
                    快速存取並插入素材到創作
                  </SheetDescription>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={closeDrawer}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>

          {/* Search */}
          <div className="px-4 py-3 border-b border-white/8">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋素材名稱…"
                className="pl-8 h-8 text-sm bg-white/5 border-white/10"
              />
            </div>

            {/* Type filter chips */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {FILTER_TABS.map(type => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    "text-[11px] px-2.5 py-0.5 rounded-full border transition-colors",
                    typeFilter === type
                      ? "bg-violet-500/30 border-violet-500/50 text-violet-200"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
                  )}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {assetsQuery.isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 rounded-lg bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
                <Package className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground/50">
                  {search ? "找不到符合的素材" : "尚無素材"}
                </p>
                <Link href="/assets">
                  <Button size="sm" variant="outline" className="text-xs mt-1" onClick={closeDrawer}>
                    前往素材庫上傳
                  </Button>
                </Link>
              </div>
            ) : (
              assets.map(asset => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onInsert={handleInsert}
                  hasInsert={!!insertCallback}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-white/10">
            <Link href="/assets" onClick={closeDrawer}>
              <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 border-white/15">
                <ExternalLink className="w-3.5 h-3.5" />
                開啟完整素材庫
              </Button>
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
