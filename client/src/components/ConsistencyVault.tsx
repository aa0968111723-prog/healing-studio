import { useState, useCallback } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { shortErrorMsg } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  User, Mountain, Upload, GripVertical, X, Plus, Search,
  ImagePlus, Layers, Trash2, Loader2, Link, Check,
} from "lucide-react";
import { ZenSkeleton } from "./ZenCoPilot";

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

// ─── Upload Helper ──────────────────────────────────────────────────────────

async function uploadFileToS3(file: File): Promise<{ url: string; fileKey: string }> {
  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64Data = result.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      data: base64,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "上傳失敗" }));
    throw new Error(err.error || "上傳失敗");
  }

  const result = await response.json();
  return { url: result.url, fileKey: result.fileKey };
}

// ─── Vault Item Card ────────────────────────────────────────────────────────

function VaultItemCard({
  item,
  onDragStart,
  onSelect,
  onDelete,
  compact,
}: {
  item: VaultItem;
  onDragStart?: (item: VaultItem, e: React.DragEvent) => void;
  onSelect?: (item: VaultItem) => void;
  onDelete?: (id: number) => void;
  compact?: boolean;
}) {
  const isMobile = useIsMobile();
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
            loading="lazy"
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

        {/* Delete button — always visible on mobile, hover-only on desktop */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
            className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500/80 text-white flex items-center justify-center transition-opacity hover:bg-red-600 ${
              isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}

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

// ─── Upload Dialog ──────────────────────────────────────────────────────────

function UploadPanel({
  itemType,
  onSuccess,
}: {
  itemType: "character" | "scene";
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tags, setTags] = useState("");

  const createVaultItem = trpc.vault.create.useMutation({
    onSuccess: () => {
      toast.success(`${itemType === "character" ? "角色" : "場景"}參考已儲存`);
      setName("");
      setFile(null);
      setPreview(null);
      setTags("");
      onSuccess();
    },
    onError: (err) => {
      toast.error("儲存失敗：" + shortErrorMsg(err.message), { duration: 5000 });
    },
  });

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.type.startsWith("image/")) {
      toast.error("請選擇圖片檔案");
      return;
    }
    if (selectedFile.size > 16 * 1024 * 1024) {
      toast.error("檔案大小不能超過 16MB");
      return;
    }
    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setPreview(url);
  };

  const handleUpload = async () => {
    if (!file || !name.trim()) {
      toast.error("請填寫名稱並選擇圖片");
      return;
    }

    setUploading(true);
    try {
      // Step 1: Upload file to S3
      const { url, fileKey } = await uploadFileToS3(file);

      // Step 2: Save vault item via tRPC
      const tagList = tags.trim() ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
      await createVaultItem.mutateAsync({
        name: name.trim(),
        itemType,
        imageUrl: url,
        fileKey,
        tags: tagList,
      });
    } catch (err: any) {
      toast.error("上傳失敗：" + shortErrorMsg(err), { duration: 5000 });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.5)" }}>
      <Input
        placeholder={itemType === "character" ? "角色名稱" : "場景名稱"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 text-xs rounded-lg bg-white/40 border-white/60"
      />

      <Input
        placeholder="標籤（逗號分隔）"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="h-8 text-xs rounded-lg bg-white/40 border-white/60"
      />

      {preview ? (
        <div className="relative aspect-video rounded-lg overflow-hidden">
          <img src={preview} alt="預覽" className="w-full h-full object-cover" loading="lazy" />
          <button
            onClick={() => { setFile(null); setPreview(null); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center hover:bg-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-lg border-2 border-dashed border-border/40 hover:border-border/60 cursor-pointer transition-colors">
          <Upload className="w-5 h-5 text-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground">點擊選擇圖片</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />
        </label>
      )}

      <Button
        onClick={handleUpload}
        disabled={uploading || !file || !name.trim()}
        size="sm"
        className="w-full h-8 text-xs rounded-lg"
      >
        {uploading ? (
          <>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            上傳中...
          </>
        ) : (
          <>
            <Upload className="w-3 h-3 mr-1" />
            儲存至保險庫
          </>
        )}
      </Button>
    </div>
  );
}

// ─── Main Consistency Vault ─────────────────────────────────────────────────

export function ConsistencyVault({ onDragStart, onSelect, compact = false }: ConsistencyVaultProps) {
  const [activeTab, setActiveTab] = useState<"character" | "scene">("character");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const utils = trpc.useUtils();

  // Fetch vault items from real database
  const vaultQuery = trpc.vault.list.useQuery(undefined, { retry: false });

  const deleteVaultItem = trpc.vault.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      utils.vault.list.invalidate();
    },
    onError: (err) => {
      toast.error("刪除失敗：" + err.message);
    },
  });

  // Transform data into VaultItems
  const allItems: VaultItem[] = (vaultQuery.data || []).map(item => ({
    id: item.id,
    name: item.name,
    type: item.itemType as "character" | "scene",
    imageUrl: item.imageUrl,
    tags: item.tags || [],
  }));

  const characterItems = allItems.filter(i => i.type === "character");
  const sceneItems = allItems.filter(i => i.type === "scene");

  const items = activeTab === "character" ? characterItems : sceneItems;
  const filteredItems = searchQuery
    ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : items;

  const handleDelete = (id: number) => {
    if (confirm("確定要刪除此項目嗎？")) {
      deleteVaultItem.mutate({ id });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">一致性保險庫</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowUpload(!showUpload)}
          className="h-7 px-2 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          新增
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        儲存角色與場景參考圖，拖放到工作區確保風格一致性
      </p>

      {/* Upload Panel */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <UploadPanel
              itemType={activeTab}
              onSuccess={() => {
                setShowUpload(false);
                utils.vault.list.invalidate();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
            isLoading={vaultQuery.isLoading}
            onDragStart={onDragStart}
            onSelect={onSelect}
            onDelete={handleDelete}
            compact={compact}
            emptyMessage="尚無角色參考圖。點擊「新增」上傳角色圖片。"
          />
        </TabsContent>

        <TabsContent value="scene" className="mt-2">
          <VaultGrid
            items={filteredItems}
            isLoading={vaultQuery.isLoading}
            onDragStart={onDragStart}
            onSelect={onSelect}
            onDelete={handleDelete}
            compact={compact}
            emptyMessage="尚無場景參考圖。點擊「新增」上傳場景圖片。"
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
  onDelete,
  compact,
  emptyMessage,
}: {
  items: VaultItem[];
  isLoading: boolean;
  onDragStart?: (item: VaultItem, e: React.DragEvent) => void;
  onSelect?: (item: VaultItem) => void;
  onDelete?: (id: number) => void;
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
          onDelete={onDelete}
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
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");

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

    // Try file - upload to S3
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  }, [onDrop]);

  const handleFileUpload = async (file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error("檔案大小不能超過 16MB");
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadFileToS3(file);
      onDrop(url);
      toast.success("圖片已上傳");
    } catch (err: any) {
      toast.error("上傳失敗：" + shortErrorMsg(err), { duration: 5000 });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    };
    input.click();
  };

  const handleUrlSubmit = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    // Accept http/https URLs
    if (!/^https?:\/\/.+/.test(trimmed)) {
      toast.error("請輸入有效的圖片 URL（以 http:// 或 https:// 開頭）");
      return;
    }
    onDrop(trimmed);
    setUrlInput("");
    setShowUrlInput(false);
    toast.success("已載入圖片 URL");
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
          <img src={value} alt={label} className="w-full h-full object-cover rounded-xl" loading="lazy" />
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
      ) : showUrlInput ? (
        /* URL input mode */
        <div className="aspect-video flex flex-col items-center justify-center gap-2 p-3">
          <div className="flex items-center gap-1.5 w-full">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit();
                if (e.key === "Escape") { setShowUrlInput(false); setUrlInput(""); }
              }}
              placeholder="貼上圖片 URL..."
              autoFocus
              className="flex-1 text-[11px] bg-white/60 border border-border/40 rounded-lg px-2 py-1.5 outline-none focus:border-primary/50 min-w-0"
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!urlInput.trim()}
              className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-30"
            >
              <Check className="w-3.5 h-3.5 text-primary" />
            </button>
            <button
              onClick={() => { setShowUrlInput(false); setUrlInput(""); }}
              className="p-1.5 rounded-lg hover:bg-muted/20 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground/50">按 Enter 確認，Esc 取消</span>
        </div>
      ) : (
        <div className="w-full aspect-video flex flex-col items-center justify-center gap-1 p-3">
          <button
            onClick={handleFileSelect}
            disabled={uploading}
            className="flex flex-col items-center gap-1.5 hover:bg-muted/10 transition-colors rounded-lg px-4 py-2 w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
                <span className="text-[11px] text-muted-foreground font-medium">上傳中...</span>
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 text-muted-foreground/40" />
                <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground/50">拖放或點擊上傳</span>
              </>
            )}
          </button>
          {/* URL input toggle */}
          <button
            onClick={() => setShowUrlInput(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-primary/70 transition-colors mt-0.5"
          >
            <Link className="w-3 h-3" />
            貼上 URL
          </button>
        </div>
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
