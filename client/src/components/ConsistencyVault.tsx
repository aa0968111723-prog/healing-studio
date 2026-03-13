import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  User, Mountain, Upload, GripVertical, X, Plus, Search, Tag,
  ChevronRight, ImagePlus, Layers
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "./ZenCoPilot";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VaultItem = {
  id: number;
  name: string;
  type: "character" | "scene";
  imageUrl: string;
  tags?: string[];
};

type ConsistencyVaultProps = {
  onDragStart?: (item: VaultItem, e: React.DragEvent) => void;
  onSelect?: (item: VaultItem) => void;
  compact?: boolean;
};

// ─── Vault Item Card ────────────────────────────────────────────────────────

function VaultItemCard({
  item,
  onDragStart,
  onSelect,
  compact,
}: {
  item: VaultItem;
  onDragStart?: (item: VaultItem, e: React.DragEvent) => void;
  onSelect?: (item: VaultItem) => void;
  compact?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      draggable
      onDragStart={(e) => {
        const dragEvent = e as unknown as React.DragEvent;
        if (dragEvent.dataTransfer) {
          dragEvent.dataTransfer.setData("application/vault-item", JSON.stringify(item));
          dragEvent.dataTransfer.setData("text/plain", item.imageUrl);
          dragEvent.dataTransfer.effectAllowed = "copy";
        }
        onDragStart?.(item, dragEvent);
      }}
      onClick={() => onSelect?.(item)}
      className={`group relative rounded-xl overflow-hidden cursor-grab active:cursor-grabbing transition-all hover:shadow-lg ${
        compact ? "aspect-square" : ""
      }`}
      style={{
        background: "rgba(255,255,255,0.5)",
        border: "1px solid rgba(255,255,255,0.6)",
      }}
    >
      {/* Image */}
      <div className={`relative ${compact ? "aspect-square" : "aspect-[4/3]"}`}>
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/20">
            {item.type === "character" ? (
              <User className="w-8 h-8 text-muted-foreground/30" />
            ) : (
              <Mountain className="w-8 h-8 text-muted-foreground/30" />
            )}
          </div>
        )}

        {/* Drag handle overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <GripVertical className="w-4 h-4 text-white/80" />
            <span className="text-[10px] text-white/80 font-medium">拖放至工作區</span>
          </div>
        </div>

        {/* Type badge */}
        <div className="absolute top-1.5 left-1.5">
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
            item.type === "character"
              ? "bg-violet-500/20 text-violet-700"
              : "bg-emerald-500/20 text-emerald-700"
          }`} style={{ backdropFilter: "blur(8px)" }}>
            {item.type === "character" ? "角色" : "場景"}
          </span>
        </div>
      </div>

      {/* Info */}
      {!compact && (
        <div className="p-2.5">
          <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
          {item.tags && item.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Consistency Vault ─────────────────────────────────────────────────

export function ConsistencyVault({ onDragStart, onSelect, compact = false }: ConsistencyVaultProps) {
  const [activeTab, setActiveTab] = useState<"character" | "scene">("character");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch models as character references
  const modelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });
  // Fetch assets as scene references
  const assetsQuery = trpc.assets.myAssets.useQuery(undefined, { retry: false });

  // Transform data into VaultItems
  const characterItems: VaultItem[] = (modelsQuery.data || [])
    .filter(m => m.status === "ready")
    .map(m => ({
      id: m.id,
      name: m.name,
      type: "character" as const,
      imageUrl: m.fileUrl || "",
      tags: m.modelType ? [m.modelType] : [],
    }));

  const sceneItems: VaultItem[] = (assetsQuery.data || [])
    .filter(a => a.assetType === "image")
    .map(a => ({
      id: a.id,
      name: a.title,
      type: "scene" as const,
      imageUrl: a.fileUrl || "",
      tags: a.visibility === "team_shared" ? ["共享"] : [],
    }));

  const items = activeTab === "character" ? characterItems : sceneItems;
  const filteredItems = searchQuery
    ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : items;

  const isLoading = activeTab === "character" ? modelsQuery.isLoading : assetsQuery.isLoading;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">一致性保險庫</h3>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        儲存角色與場景參考圖，拖放到工作區確保風格一致性
      </p>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "character" | "scene")}>
        <TabsList className="w-full grid grid-cols-2 h-8 rounded-lg bg-muted/30 p-0.5">
          <TabsTrigger value="character" className="rounded-md text-xs h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <User className="w-3 h-3 mr-1" />
            角色 ({characterItems.length})
          </TabsTrigger>
          <TabsTrigger value="scene" className="rounded-md text-xs h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Mountain className="w-3 h-3 mr-1" />
            場景 ({sceneItems.length})
          </TabsTrigger>
        </TabsList>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input
            placeholder="搜尋..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs rounded-lg bg-white/40 border-white/60"
          />
        </div>

        <TabsContent value="character" className="mt-2">
          <VaultGrid
            items={filteredItems}
            isLoading={isLoading}
            onDragStart={onDragStart}
            onSelect={onSelect}
            compact={compact}
            emptyMessage="尚無就緒的角色模型。前往「角色鍛造所」建立角色。"
          />
        </TabsContent>

        <TabsContent value="scene" className="mt-2">
          <VaultGrid
            items={filteredItems}
            isLoading={isLoading}
            onDragStart={onDragStart}
            onSelect={onSelect}
            compact={compact}
            emptyMessage="尚無場景素材。生成圖片後會自動加入。"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Grid ───────────────────────────────────────────────────────────────────

function VaultGrid({
  items,
  isLoading,
  onDragStart,
  onSelect,
  compact,
  emptyMessage,
}: {
  items: VaultItem[];
  isLoading: boolean;
  onDragStart?: (item: VaultItem, e: React.DragEvent) => void;
  onSelect?: (item: VaultItem) => void;
  compact?: boolean;
  emptyMessage: string;
}) {
  if (isLoading) {
    return <ZenSkeleton lines={3} />;
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-6">
        <ImagePlus className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
        <p className="text-[11px] text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2"}`}>
      {items.map((item) => (
        <VaultItemCard
          key={`${item.type}-${item.id}`}
          item={item}
          onDragStart={onDragStart}
          onSelect={onSelect}
          compact={compact}
        />
      ))}
    </div>
  );
}

// ─── Dropzone for receiving vault items ─────────────────────────────────────

export function VaultDropzone({
  label,
  value,
  onDrop,
  onClear,
  className = "",
}: {
  label: string;
  value: string | null;
  onDrop: (imageUrl: string, item?: VaultItem) => void;
  onClear: () => void;
  className?: string;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // Try vault item first
    const vaultData = e.dataTransfer.getData("application/vault-item");
    if (vaultData) {
      try {
        const item: VaultItem = JSON.parse(vaultData);
        onDrop(item.imageUrl, item);
        toast.success(`已載入「${item.name}」`);
        return;
      } catch { /* fallthrough */ }
    }

    // Try plain URL
    const url = e.dataTransfer.getData("text/plain");
    if (url) {
      onDrop(url);
      return;
    }

    // Try file
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      onDrop(url);
    }
  }, [onDrop]);

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const url = URL.createObjectURL(file);
        onDrop(url);
      }
    };
    input.click();
  };

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-all overflow-hidden ${
        isDragOver
          ? "border-primary/50 bg-primary/5 scale-[1.02]"
          : value
          ? "border-transparent"
          : "border-border/40 hover:border-border/60"
      } ${className}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {value ? (
        <div className="relative aspect-video">
          <img src={value} alt={label} className="w-full h-full object-cover rounded-xl" />
          <Button
            variant="outline"
            size="icon"
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow-sm"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
          >
            <X className="w-3 h-3" />
          </Button>
          <div className="absolute bottom-1.5 left-1.5">
            <span className="text-[10px] font-medium text-white bg-black/40 px-2 py-0.5 rounded-full" style={{ backdropFilter: "blur(4px)" }}>
              {label}
            </span>
          </div>
        </div>
      ) : (
        <button
          onClick={handleFileSelect}
          className="w-full aspect-video flex flex-col items-center justify-center gap-1.5 p-3 hover:bg-muted/10 transition-colors"
        >
          <Upload className="w-5 h-5 text-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground/50">拖放或點擊上傳</span>
        </button>
      )}

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-xl"
            style={{
              background: "rgba(212, 197, 226, 0.2)",
              backdropFilter: "blur(4px)",
              border: "2px solid rgba(212, 197, 226, 0.5)",
            }}
          >
            <div className="text-center">
              <Plus className="w-6 h-6 text-primary mx-auto mb-1" />
              <p className="text-xs font-medium text-primary">放開以載入</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
