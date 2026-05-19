/**
 * SourcePicker — 世界觀系統的多來源引用選擇器
 *
 * 一顆按鈕，按下展開 popover，使用者可以從以下 5 種來源挑檔：
 *   1. 個人上傳        — 直接拖檔到 S3 / R2（呼叫 /api/upload）
 *   2. 數位資訊庫      — 從個人的數位資產庫（digital_asset_library）挑
 *   3. 個人資料庫      — 從 Consistency Vault（character/scene profile）挑
 *   4. 雲端            — 從已連結的 Google Drive 素材庫挑
 *   5. 網外連結        — 手動貼 URL（最直接、最低耦合）
 *
 * 回呼統一收斂成一個 { url, label?, fileKey?, mimeType?, sizeBytes? } shape，
 * 讓上層 component 拿到 URL 後可以塞進角色 / 場景 / 音效庫 / 研究資料庫…
 * 任何需要引用素材的地方，省得重新貼 link。
 */

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { uploadFileToS3, shortErrorMsg } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Link2,
  Upload,
  Database,
  Archive,
  Cloud,
  Loader2,
  Image as ImageIcon,
  FileAudio,
  Film,
  ChevronRight,
  ChevronLeft,
  Folder,
  FolderOpen,
  ExternalLink,
} from "lucide-react";

export type SourcePickResult = {
  url: string;
  label?: string;
  fileKey?: string;
  mimeType?: string;
  sizeBytes?: number;
};

type AssetKind = "image" | "audio" | "video" | "any";

export function SourcePicker({
  label = "選擇來源",
  accept,
  assetKind = "any",
  vaultItemType,
  onPick,
  disabled,
}: {
  /** 按鈕文字 */
  label?: string;
  /** 上傳時的 MIME / 副檔名 filter (e.g. "image/*", "audio/*,.mp3") */
  accept?: string;
  /** 過濾數位資產庫 / 雲端來源的類型 */
  assetKind?: AssetKind;
  /** 個人資料庫過濾（character / scene） */
  vaultItemType?: "character" | "scene";
  onPick: (result: SourcePickResult) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    (result: SourcePickResult) => {
      onPick(result);
      setOpen(false);
    },
    [onPick]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-7 text-xs gap-1"
        >
          <Link2 className="w-3 h-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[460px] p-2"
      >
        <Tabs defaultValue="upload">
          <TabsList className="w-full justify-start h-8">
            <TabsTrigger value="upload" className="text-[11px] h-7 px-2 gap-1">
              <Upload className="w-3 h-3" />
              個人上傳
            </TabsTrigger>
            <TabsTrigger value="assets" className="text-[11px] h-7 px-2 gap-1">
              <Database className="w-3 h-3" />
              數位資訊庫
            </TabsTrigger>
            <TabsTrigger value="vault" className="text-[11px] h-7 px-2 gap-1">
              <Archive className="w-3 h-3" />
              個人資料庫
            </TabsTrigger>
            <TabsTrigger value="drive" className="text-[11px] h-7 px-2 gap-1">
              <Cloud className="w-3 h-3" />
              雲端
            </TabsTrigger>
            <TabsTrigger value="link" className="text-[11px] h-7 px-2 gap-1">
              <ExternalLink className="w-3 h-3" />
              網外連結
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-2">
            <UploadPane accept={accept} onPick={handlePick} />
          </TabsContent>
          <TabsContent value="assets" className="mt-2">
            <AssetsPane assetKind={assetKind} onPick={handlePick} />
          </TabsContent>
          <TabsContent value="vault" className="mt-2">
            <VaultPane itemType={vaultItemType} onPick={handlePick} />
          </TabsContent>
          <TabsContent value="drive" className="mt-2">
            <DrivePane onPick={handlePick} />
          </TabsContent>
          <TabsContent value="link" className="mt-2">
            <LinkPane onPick={handlePick} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

// ─── Upload ─────────────────────────────────────────────────────────────────

function UploadPane({
  accept,
  onPick,
}: {
  accept?: string;
  onPick: (r: SourcePickResult) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const { url, fileKey } = await uploadFileToS3(file);
        onPick({
          url,
          fileKey,
          label: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        toast.success(`${file.name} 已上傳並引用`);
      } catch (e) {
        toast.error(`上傳失敗：${shortErrorMsg(e)}`);
      } finally {
        setUploading(false);
      }
    },
    [onPick]
  );

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        直接從本機選檔，上傳到自家儲存後立刻引用。
      </p>
      <label
        htmlFor="src-picker-upload"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/40 bg-card/30 p-6 cursor-pointer hover:bg-card/50 transition"
      >
        {uploading ? (
          <>
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">上傳中…</span>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5 text-primary" />
            <span className="text-xs">點此選檔或拖檔過來</span>
            {accept && (
              <span className="text-[10px] text-muted-foreground">
                {accept}
              </span>
            )}
          </>
        )}
      </label>
      <input
        id="src-picker-upload"
        type="file"
        accept={accept}
        className="hidden"
        disabled={uploading}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Digital Asset Library ──────────────────────────────────────────────────

function AssetsPane({
  assetKind,
  onPick,
}: {
  assetKind: AssetKind;
  onPick: (r: SourcePickResult) => void;
}) {
  const [search, setSearch] = useState("");
  const assetType =
    assetKind === "image"
      ? "image"
      : assetKind === "audio"
        ? "audio"
        : assetKind === "video"
          ? "video"
          : "all";
  const query = trpc.assets.myAssets.useQuery({
    assetType,
    sourceStudio: "all",
    search: search || undefined,
  });

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋標題 / 提示詞…"
        className="h-7 text-xs"
      />
      <ScrollArea className="h-[260px] pr-2">
        {query.isLoading ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            載入資產中…
          </p>
        ) : !query.data || query.data.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            數位資訊庫尚無符合的資產。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {query.data.slice(0, 60).map(a => {
              const url = a.fileUrl ?? a.thumbnailUrl ?? "";
              if (!url) return null;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    onPick({
                      url,
                      label: a.title,
                      fileKey: a.fileKey ?? undefined,
                      mimeType: a.mimeType ?? undefined,
                      sizeBytes: a.fileSizeBytes ?? undefined,
                    })
                  }
                  className="rounded-md border border-border/30 bg-card/30 hover:border-primary/60 hover:bg-card/60 transition overflow-hidden text-left"
                  title={a.title}
                >
                  <div className="aspect-square bg-card/20 flex items-center justify-center">
                    {a.assetType === "image" && url ? (
                      <img
                        src={a.thumbnailUrl ?? url}
                        alt={a.title}
                        className="w-full h-full object-cover"
                      />
                    ) : a.assetType === "audio" || a.assetType === "voice" ? (
                      <FileAudio className="w-5 h-5 text-muted-foreground" />
                    ) : a.assetType === "video" ? (
                      <Film className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="px-1.5 py-1">
                    <p className="text-[10px] truncate">{a.title}</p>
                    <Badge variant="outline" className="text-[9px]">
                      {a.assetType}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Vault (Consistency Vault) ──────────────────────────────────────────────

function VaultPane({
  itemType,
  onPick,
}: {
  itemType?: "character" | "scene";
  onPick: (r: SourcePickResult) => void;
}) {
  const [search, setSearch] = useState("");
  const query = trpc.vault.list.useQuery({
    itemType,
    search: search || undefined,
  });

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋名稱 / 標籤…"
        className="h-7 text-xs"
      />
      <ScrollArea className="h-[260px] pr-2">
        {query.isLoading ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            載入個人資料庫中…
          </p>
        ) : !query.data || query.data.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            個人資料庫（一致性保險庫）目前沒有可選項目。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {query.data.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() =>
                  onPick({
                    url: v.imageUrl,
                    label: v.name,
                    fileKey: v.fileKey ?? undefined,
                  })
                }
                className="rounded-md border border-border/30 bg-card/30 hover:border-primary/60 hover:bg-card/60 transition overflow-hidden text-left"
                title={v.name}
              >
                <div className="aspect-square bg-card/20">
                  <img
                    src={v.imageUrl}
                    alt={v.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="px-1.5 py-1">
                  <p className="text-[10px] truncate">{v.name}</p>
                  <Badge variant="outline" className="text-[9px]">
                    {v.itemType === "character" ? "角色" : "場景"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Google Drive ───────────────────────────────────────────────────────────

function DrivePane({ onPick }: { onPick: (r: SourcePickResult) => void }) {
  const status = trpc.drive.status.useQuery();
  const libraries = trpc.drive.listLibraries.useQuery(undefined, {
    enabled: status.data?.connected === true,
  });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const files = trpc.drive.listFolder.useQuery(
    { folderId: folderId ?? "", pageSize: 60 },
    { enabled: !!folderId }
  );

  if (status.isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground italic py-4 text-center">
        檢查 Drive 連結中…
      </p>
    );
  }
  if (!status.data?.connected) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-300 space-y-1">
        <p>尚未連結 Google Drive。</p>
        <p className="text-muted-foreground">
          到「設定 → 連結雲端」授權後即可在這裡引用 Drive 內的素材。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {folderId ? (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              setFolderId(null);
              setBreadcrumb([]);
            }}
            className="flex items-center gap-0.5 hover:text-foreground"
          >
            <ChevronLeft className="w-3 h-3" />
            返回素材庫列表
          </button>
          {breadcrumb.length > 0 && (
            <>
              <ChevronRight className="w-2.5 h-2.5" />
              <span className="truncate">
                {breadcrumb.map(b => b.name).join(" / ")}
              </span>
            </>
          )}
        </div>
      ) : null}

      <ScrollArea className="h-[260px] pr-2">
        {!folderId ? (
          libraries.isLoading ? (
            <p className="text-[11px] text-muted-foreground italic py-4 text-center">
              載入素材庫…
            </p>
          ) : !libraries.data || libraries.data.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic py-4 text-center">
              尚未在「設定」加入任何 Drive 素材庫。
            </p>
          ) : (
            <div className="space-y-1">
              {libraries.data.map(lib => (
                <button
                  key={lib.id}
                  type="button"
                  onClick={() => {
                    setFolderId(lib.driveFolderId);
                    setBreadcrumb([
                      {
                        id: lib.driveFolderId,
                        name: lib.driveFolderName ?? lib.label,
                      },
                    ]);
                  }}
                  className="w-full flex items-center gap-2 rounded-md border border-border/30 bg-card/30 p-2 hover:bg-card/50 transition text-left"
                >
                  <Folder className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate font-medium">{lib.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {lib.driveFolderName ?? lib.driveFolderId}
                    </p>
                  </div>
                  <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )
        ) : files.isLoading ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            從 Drive 取檔案中…
          </p>
        ) : !files.data || files.data.files.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            這個資料夾是空的。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {files.data.files.map(f => {
              const isFolder = f.mimeType === "application/vnd.google-apps.folder";
              if (isFolder) {
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFolderId(f.id);
                      setBreadcrumb(prev => [...prev, { id: f.id, name: f.name }]);
                    }}
                    className="rounded-md border border-border/30 bg-card/30 hover:border-primary/60 hover:bg-card/60 transition p-2 text-left"
                  >
                    <FolderOpen className="w-5 h-5 text-primary mx-auto" />
                    <p className="text-[10px] truncate mt-1">{f.name}</p>
                  </button>
                );
              }
              // Use webContentLink when available (direct content URL),
              // else webViewLink as a reference fallback.
              const url = f.webContentLink || f.webViewLink || "";
              if (!url) return null;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() =>
                    onPick({
                      url,
                      label: f.name,
                      mimeType: f.mimeType ?? undefined,
                    })
                  }
                  className="rounded-md border border-border/30 bg-card/30 hover:border-primary/60 hover:bg-card/60 transition overflow-hidden text-left"
                  title={f.name}
                >
                  <div className="aspect-square bg-card/20 flex items-center justify-center">
                    {f.thumbnailLink ? (
                      <img
                        src={f.thumbnailLink}
                        alt={f.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Cloud className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="px-1.5 py-1">
                    <p className="text-[10px] truncate">{f.name}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── External Link ──────────────────────────────────────────────────────────

function LinkPane({ onPick }: { onPick: (r: SourcePickResult) => void }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const valid = /^https?:\/\//.test(url.trim());

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        直接貼一個公開可存取的 URL（圖片 / 音檔 / 影片 / 文件皆可）。
      </p>
      <Input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://…"
        className="h-7 text-xs"
      />
      <Input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="顯示名稱（選填）"
        className="h-7 text-xs"
      />
      <Button
        type="button"
        size="sm"
        disabled={!valid}
        onClick={() =>
          onPick({
            url: url.trim(),
            label: label.trim() || undefined,
          })
        }
        className="h-7 text-xs w-full"
      >
        <Link2 className="w-3 h-3 mr-1" />
        引用此連結
      </Button>
    </div>
  );
}
