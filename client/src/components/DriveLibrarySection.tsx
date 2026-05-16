/**
 * DriveLibrarySection — manages user's pinned Google Drive folders and
 * lets them browse the contents inline.
 *
 * Scoping note: this is the read-only ("素材庫") side of Drive. We don't
 * upload to or modify the user's Drive — files open in a new tab via
 * `webViewLink`. Phase 2 may add inline preview / linking to schedule.
 */

import { useEffect, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";

type DriveFile = inferRouterOutputs<AppRouter>["drive"]["listFolder"]["files"][number];
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ZenCoPilot";
import {
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  ExternalLink,
  RefreshCw,
  Trash2,
  Cloud,
  CloudOff,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LibraryKind = "shoot" | "personal" | "other";

const KIND_LABEL: Record<LibraryKind, string> = {
  shoot: "外拍",
  personal: "個人",
  other: "其他",
};

const KIND_TONE: Record<LibraryKind, string> = {
  shoot: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  personal: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  other: "border-border/30 bg-muted/10 text-muted-foreground/70",
};

export function DriveLibrarySection() {
  const utils = trpc.useUtils();
  const status = trpc.drive.status.useQuery();
  const libraries = trpc.drive.listLibraries.useQuery(undefined, {
    enabled: status.data?.connected === true,
  });

  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);

  const disconnect = trpc.drive.disconnect.useMutation({
    onSuccess: () => {
      utils.drive.status.invalidate();
      utils.drive.listLibraries.invalidate();
      setActiveFolderId(null);
      setBreadcrumb([]);
      toast.success("已中止 Drive 連結");
    },
  });

  const removeLibrary = trpc.drive.removeLibrary.useMutation({
    onSuccess: () => {
      utils.drive.listLibraries.invalidate();
      toast.success("已移除素材庫");
    },
  });

  if (status.isLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-card/5 p-6 text-sm text-muted-foreground">
        正在檢查 Google Drive 連結狀態…
      </div>
    );
  }

  if (!status.data?.connected) {
    return <DriveConnectCta />;
  }

  const handleOpenLibrary = (lib: { driveFolderId: string; driveFolderName: string | null; label: string }) => {
    setActiveFolderId(lib.driveFolderId);
    setBreadcrumb([
      { id: lib.driveFolderId, name: lib.driveFolderName || lib.label },
    ]);
  };

  const handleEnterFolder = (folder: { id: string; name: string }) => {
    setActiveFolderId(folder.id);
    setBreadcrumb(prev => [...prev, folder]);
  };

  const handleBreadcrumb = (idx: number) => {
    const next = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(next);
    setActiveFolderId(next[next.length - 1]?.id ?? null);
  };

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2">
            <Cloud className="w-5 h-5 text-emerald-400 mt-0.5" />
            <div>
              <h3 className="hs-h3 !mb-0 text-foreground">已連結 Google Drive</h3>
              <p className="hs-small !mb-0 text-muted-foreground/70">
                釘選資料夾當外拍 / 個人素材庫，瀏覽會以唯讀模式進行。
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs gap-1.5 text-muted-foreground hover:text-red-400"
            onClick={() => {
              if (window.confirm("中止連結後，所有素材庫項目仍會保留，但需要重新授權才能再次瀏覽內容。確定？")) {
                disconnect.mutate();
              }
            }}
          >
            <CloudOff className="w-3.5 h-3.5" />
            中止連結
          </Button>
        </div>
        <AddLibraryForm
          onAdded={() => utils.drive.listLibraries.invalidate()}
        />
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <h3 className="hs-h3 !mb-0 text-foreground flex items-center gap-2">
            <Folder className="w-4 h-4 text-amber-400" />
            我的素材庫
            {libraries.data && (
              <Badge variant="outline" className="text-[10px]">
                {libraries.data.length}
              </Badge>
            )}
          </h3>
        </div>

        {libraries.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-12 rounded-lg bg-card/5 animate-pulse" />
            ))}
          </div>
        ) : !libraries.data || libraries.data.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 py-4 text-center">
            尚未釘選任何 Drive 資料夾。把資料夾連結貼到上方輸入框即可開始。
          </p>
        ) : (
          <div className="space-y-2">
            {libraries.data.map(lib => (
              <LibraryRow
                key={lib.id}
                library={lib}
                active={activeFolderId === lib.driveFolderId}
                onOpen={() => handleOpenLibrary(lib)}
                onRemove={() => {
                  if (window.confirm(`確定移除素材庫「${lib.label}」？（不會刪除 Drive 上的檔案）`)) {
                    removeLibrary.mutate({ id: lib.id });
                  }
                }}
              />
            ))}
          </div>
        )}
      </GlassCard>

      {activeFolderId && (
        <GlassCard>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3 flex-wrap">
            {breadcrumb.map((seg, i) => (
              <span key={`${seg.id}-${i}`} className="flex items-center gap-1">
                <button
                  onClick={() => handleBreadcrumb(i)}
                  className={cn(
                    "px-1.5 py-0.5 rounded hover:bg-card/10",
                    i === breadcrumb.length - 1
                      ? "text-foreground/90 font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {seg.name}
                </button>
                {i < breadcrumb.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                )}
              </span>
            ))}
          </div>
          <DriveFolderBrowser
            folderId={activeFolderId}
            onEnterFolder={handleEnterFolder}
          />
        </GlassCard>
      )}
    </div>
  );
}

function DriveConnectCta() {
  return (
    <GlassCard>
      <div className="text-center py-6 space-y-3">
        <HardDrive className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <h3 className="hs-h3 !mb-0 text-foreground">連結 Google Drive 素材庫</h3>
        <p className="hs-small !mb-0 text-muted-foreground/70 max-w-md mx-auto">
          授權後可以把 Drive 資料夾釘選為「外拍」或「個人」素材庫，在排程裡直接挑檔案。授權範圍是唯讀，不會修改你的 Drive。
        </p>
        <Button
          size="sm"
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
          onClick={() => {
            const back = window.location.pathname + window.location.search;
            window.location.href = `/api/oauth/google/drive/start?redirect=${encodeURIComponent(
              back
            )}`;
          }}
        >
          <Cloud className="w-3.5 h-3.5" />
          連結 Google Drive
        </Button>
      </div>
    </GlassCard>
  );
}

function AddLibraryForm({ onAdded }: { onAdded: () => void }) {
  const [folderInput, setFolderInput] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<LibraryKind>("shoot");

  const add = trpc.drive.addLibrary.useMutation({
    onSuccess: data => {
      toast.success(`已加入素材庫「${data.driveFolderName || label}」`);
      setFolderInput("");
      setLabel("");
      onAdded();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px] gap-2">
        <Input
          value={folderInput}
          onChange={e => setFolderInput(e.target.value)}
          placeholder="貼上 Drive 資料夾網址或 ID"
          className="bg-card/5 border-white/10 text-xs"
        />
        <Input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="顯示名稱（選填）"
          className="bg-card/5 border-white/10 text-xs"
        />
        <select
          value={kind}
          onChange={e => setKind(e.target.value as LibraryKind)}
          className="bg-card/5 border border-white/10 rounded-md text-xs h-9 px-2 text-foreground"
        >
          <option value="shoot">外拍</option>
          <option value="personal">個人</option>
          <option value="other">其他</option>
        </select>
      </div>
      <Button
        size="sm"
        className="w-full sm:w-auto h-8 text-xs gap-1.5"
        onClick={() => {
          if (!folderInput.trim()) {
            toast.error("請貼上資料夾連結或 ID");
            return;
          }
          add.mutate({
            folderInput: folderInput.trim(),
            label: label.trim() || folderInput.trim().slice(0, 40),
            kind,
          });
        }}
        disabled={add.isPending}
      >
        <FolderPlus className="w-3 h-3" />
        {add.isPending ? "新增中…" : "釘選為素材庫"}
      </Button>
    </div>
  );
}

function LibraryRow({
  library,
  active,
  onOpen,
  onRemove,
}: {
  library: {
    id: number;
    label: string;
    kind: string;
    driveFolderId: string;
    driveFolderName: string | null;
  };
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const kind = (library.kind as LibraryKind) ?? "other";
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-3 py-2 transition-all hover:bg-card/5",
        active ? "border-amber-500/40 bg-amber-500/5" : "border-white/10"
      )}
    >
      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left text-sm font-medium text-foreground/90 truncate hover:underline"
      >
        {library.label}
        {library.driveFolderName && library.driveFolderName !== library.label && (
          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
            ({library.driveFolderName})
          </span>
        )}
      </button>
      <Badge variant="outline" className={cn("text-[10px]", KIND_TONE[kind])}>
        {KIND_LABEL[kind]}
      </Badge>
      <a
        href={`https://drive.google.com/drive/folders/${library.driveFolderId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 rounded hover:bg-card/10 text-muted-foreground/60 hover:text-foreground"
        title="在 Google Drive 開啟"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/60 hover:text-red-400"
        title="移除"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function DriveFolderBrowser({
  folderId,
  onEnterFolder,
}: {
  folderId: string;
  onEnterFolder: (f: { id: string; name: string }) => void;
}) {
  // Drive page tokens are folder-scoped, so when the user opens a different
  // folder we MUST drop both the token and any accumulated pages — otherwise
  // we'd send a stale token (often returning invalid-page-token errors) and
  // visibly mix files from two different folders.
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [accumulated, setAccumulated] = useState<DriveFile[]>([]);
  const [seenIds] = useState(() => new Set<string>());

  useEffect(() => {
    setPageToken(undefined);
    setAccumulated([]);
    seenIds.clear();
  }, [folderId, seenIds]);

  const folder = trpc.drive.listFolder.useQuery({ folderId, pageToken });

  // Append each fetched page so "載入更多" extends the grid instead of
  // replacing it. Dedupe defensively in case a page boundary repeats an id.
  useEffect(() => {
    if (!folder.data?.files) return;
    const fresh: DriveFile[] = [];
    for (const f of folder.data.files) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        fresh.push(f);
      }
    }
    if (fresh.length > 0) {
      setAccumulated(prev => [...prev, ...fresh]);
    }
  }, [folder.data, seenIds]);

  const folders = useMemo(() => accumulated.filter(f => f.isFolder), [accumulated]);
  const others = useMemo(() => accumulated.filter(f => !f.isFolder), [accumulated]);

  // First-page loading state only — subsequent paginations show a spinner
  // on the "載入更多" button itself.
  if (folder.isLoading && accumulated.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="aspect-square rounded-lg bg-card/5 animate-pulse" />
        ))}
      </div>
    );
  }

  if (folder.error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center justify-between">
        <span>讀取失敗：{folder.error.message}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] gap-1"
          onClick={() => folder.refetch()}
        >
          <RefreshCw className="w-3 h-3" /> 重試
        </Button>
      </div>
    );
  }

  if (accumulated.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/60 py-4 text-center">
        這個資料夾是空的。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {folders.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
            資料夾
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => onEnterFolder({ id: f.id, name: f.name })}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] px-2.5 py-2 text-left text-xs"
              >
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate text-foreground/90">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
            檔案
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {others.map(f => (
              <a
                key={f.id}
                href={f.webViewLink ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden hover:border-amber-500/30 transition-colors"
              >
                <div className="aspect-square bg-black/30 flex items-center justify-center overflow-hidden">
                  {f.thumbnailLink ? (
                    // Drive thumbnails come back as referrer-sensitive URLs; the
                    // referrer policy keeps them loading without leaking auth.
                    <img
                      src={f.thumbnailLink}
                      alt={f.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                  )}
                </div>
                <p className="text-[11px] truncate px-2 py-1.5 text-foreground/80">
                  {f.name}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}

      {folder.data?.nextPageToken && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs"
          disabled={folder.isFetching}
          onClick={() => setPageToken(folder.data!.nextPageToken)}
        >
          {folder.isFetching ? "載入中…" : "載入更多"}
        </Button>
      )}
    </div>
  );
}
