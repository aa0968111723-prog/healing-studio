import { lazy, Suspense, useMemo, useRef, useState } from "react";

const HistoryPage = lazy(() => import("./HistoryPage"));
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  BookMarked,
  Layers,
  ListChecks,
  Clock,
  Cloud,
  Database,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { DriveLibrarySection } from "@/components/DriveLibrarySection";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { shortErrorMsg } from "@/lib/upload";
import {
  resolveAssetsLibraryRouteState,
  type AssetsLibrarySectionId as SectionId,
  type AssetsLibraryViewMode as AssetsViewMode,
} from "./assetsLibraryRouteState";

const PromptLibraryPage = lazy(() => import("./PromptLibraryPage"));
const PromptCollectionPage = lazy(() => import("./PromptCollectionPage"));
const VaultPage = lazy(() => import("./VaultPage"));
const BackgroundTasksPage = lazy(() => import("./BackgroundTasksPage"));
const PersonalDatabasePanel = lazy(
  () => import("@/components/learn-hub/PersonalDatabasePanel"),
);

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

// 對應後端 digital_asset_library.sourceStudio enum（0047 migration）+
// 「unknown」 = 舊資料或手動上傳。讓使用者依「哪個工作室產的」分類資產，
// 解決過去全部混在一起、無法回追的「資產庫亂掉」問題。
const SOURCE_STUDIOS = [
  "all",
  "creative",
  "director",
  "image",
  "video",
  "pro",
  "background",
  "webhook",
  "suno",
  "replicate",
  "unknown",
] as const;
type SourceStudioFilter = (typeof SOURCE_STUDIOS)[number];

const SOURCE_STUDIO_LABELS: Record<SourceStudioFilter, string> = {
  all: "全部來源",
  creative: "創意工作室",
  director: "導演 AI",
  image: "Image Studio",
  video: "Video Studio",
  pro: "Pro Studio",
  background: "背景任務",
  webhook: "Webhook",
  suno: "Suno 音樂",
  replicate: "Replicate",
  unknown: "其他 / 手動",
};

// 常用 6 個 source 直接 inline 顯示，其餘收進「更多來源」下拉 — 避免單列
// 11 個按鈕在桌面 wrap 兩行、手機 wrap 五六行，讓使用者掃描篩選變得很
// 累。剩下的低頻分類（背景任務 / Webhook / Replicate / 其他）保留可選
// 但不佔視覺空間。
const PRIMARY_SOURCES: readonly SourceStudioFilter[] = [
  "all",
  "creative",
  "director",
  "image",
  "video",
  "pro",
];
const SECONDARY_SOURCES: readonly SourceStudioFilter[] = [
  "background",
  "webhook",
  "suno",
  "replicate",
  "unknown",
];

// 排序選項 — client-side 在 useMemo 內依此 key 排，伺服器端預設已是
// createdAt DESC（最新優先）。
type AssetSortKey = "newest" | "oldest" | "by_source" | "by_type";
const SORT_LABELS: Record<AssetSortKey, string> = {
  newest: "最新優先",
  oldest: "最舊優先",
  by_source: "依來源分組",
  by_type: "依類型分組",
};

// ─── Section Tabs (合併後的大分頁) ───────────────────────────────────────────
// 2026-05 合併:原本有 7 個分頁,使用者抱怨「不知道怎麼看」。
// - 共享空間 → 併入「數位資產庫」的「我的 / 團隊共享」內部分頁(已存在)
// - 生成歷史 → 併入「數位資產庫」的 viewMode 切換(資產卡 / 歷史時間軸)
// - 成品輸出庫(VaultPage 子分頁) → 在 VaultPage.tsx 中移除,改由 數位資產庫
//   統一承接(資料層已由 postGenActions 寫進 digital_asset_library)
// 結果:7 個分頁 → 5 個分頁,且功能未流失。

function SubPageSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-4 w-72 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    </div>
  );
}

function getInitialSection(): SectionId {
  // 2026-05: 入口統一為「數位資產庫」單頁，不再讓使用者在此頁切換到其他子頁。
  return "assets";
}

function getInitialViewMode(): AssetsViewMode {
  return resolveAssetsLibraryRouteState(window.location.search).viewMode;
}

function getInitialTab(): "my" | "team" {
  return resolveAssetsLibraryRouteState(window.location.search).tab;
}

function parsePositiveAssetId(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

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
function UploadDialog({
  onSuccess,
  open,
  onOpenChange,
}: {
  onSuccess: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;
  const setOpen = (value: boolean) => {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setInternalOpen(value);
    }
  };
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
    <Dialog open={actualOpen} onOpenChange={setOpen}>
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
  const isMobile = useIsMobile();

  // 合併大分頁：讀取 URL ?section= 決定初始分頁
  const [section, setSection] = useState<SectionId>(getInitialSection);

  // 頂部分頁：在「數位資產」與「個人資料庫系統」之間切換
  const [topTab, setTopTab] = useState<"assets" | "personal_db">(
    () =>
      new URLSearchParams(window.location.search).get("top") === "personal_db"
        ? "personal_db"
        : "assets",
  );

  // 把 viewMode / tab 同步進 URL,讓使用者重新整理 / 分享連結時保留狀態
  const updateAssetsUrlParam = (key: "view" | "tab" | "top", value: string, defaultValue: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };
  const handleTopTabChange = (t: "assets" | "personal_db") => {
    setTopTab(t);
    updateAssetsUrlParam("top", t, "assets");
  };
  const handleViewModeChange = (m: AssetsViewMode) => {
    setViewMode(m);
    updateAssetsUrlParam("view", m, "cards");
  };
  const handleAssetsTabChange = (t: "my" | "team") => {
    setTab(t);
    updateAssetsUrlParam("tab", t, "my");
  };

  // 全站新手引導
  usePageTour("assets");
  const [tab, setTab] = useState<"my" | "team">(getInitialTab);
  const [viewMode, setViewMode] = useState<AssetsViewMode>(getInitialViewMode);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");
  const [sourceFilter, setSourceFilter] =
    useState<SourceStudioFilter>("all");
  const [sortKey, setSortKey] = useState<AssetSortKey>("newest");
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const myAssetsQuery = trpc.assets.myAssets.useQuery(
    {
      assetType: typeFilter,
      sourceStudio: sourceFilter,
      search: search || undefined,
    },
    { retry: false }
  );
  const teamAssetsQuery = trpc.assets.teamAssets.useQuery(
    {
      assetType: typeFilter,
      sourceStudio: sourceFilter,
      search: search || undefined,
    },
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

  const rawAssets = tab === "my" ? myAssetsQuery.data : teamAssetsQuery.data;
  const isLoading =
    tab === "my" ? myAssetsQuery.isLoading : teamAssetsQuery.isLoading;
  const totalMyAssets = myAssetsQuery.data?.length ?? 0;

  // 是否有任何篩選作用中 — 用於切換「重設」chip 和空狀態文案。
  const hasActiveFilter =
    typeFilter !== "all" ||
    sourceFilter !== "all" ||
    search.trim().length > 0;

  // 排序：使用者選擇的 sortKey 在後端 fetch 完成後 client-side 套用。
  // by_source / by_type 同時按二級鍵（createdAt DESC）維持新舊順序穩定。
  const assets = useMemo(() => {
    if (!rawAssets) return rawAssets;
    const sorted = [...rawAssets];
    const tsOf = (v: unknown): number =>
      v instanceof Date ? v.getTime() : new Date(v as string).getTime();
    switch (sortKey) {
      case "newest":
        sorted.sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt));
        break;
      case "oldest":
        sorted.sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
        break;
      case "by_source": {
        const order: Record<string, number> = Object.fromEntries(
          SOURCE_STUDIOS.map((s, i) => [s, i])
        );
        sorted.sort((a, b) => {
          const ra = order[a.sourceStudio ?? "unknown"] ?? 999;
          const rb = order[b.sourceStudio ?? "unknown"] ?? 999;
          if (ra !== rb) return ra - rb;
          return tsOf(b.createdAt) - tsOf(a.createdAt);
        });
        break;
      }
      case "by_type": {
        const order: Record<string, number> = Object.fromEntries(
          ASSET_TYPES.map((t, i) => [t, i])
        );
        sorted.sort((a, b) => {
          const ra = order[a.assetType] ?? 999;
          const rb = order[b.assetType] ?? 999;
          if (ra !== rb) return ra - rb;
          return tsOf(b.createdAt) - tsOf(a.createdAt);
        });
        break;
      }
    }
    return sorted;
  }, [rawAssets, sortKey]);

  const filteredAssets = useMemo(() => {
    if (!assets) return assets;
    const keyword = search.trim().toLowerCase();
    return assets.filter(asset => {
      if (typeFilter !== "all" && asset.assetType !== typeFilter) return false;
      if (sourceFilter !== "all" && (asset.sourceStudio ?? "unknown") !== sourceFilter) {
        return false;
      }
      if (!keyword) return true;
      const haystack = [
        asset.title,
        asset.description,
        asset.promptUsed,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [assets, search, sourceFilter, typeFilter]);

  const resetFilters = () => {
    setTypeFilter("all");
    setSourceFilter("all");
    setSearch("");
  };

  // ─── PageAgent 註冊（Phase 4b：資產庫接入光球） ──────────────────────────
  // 光球可：切 my/team 分頁、切資產類型、下搜尋字串、清空條件。
  const ASSETS_TAB_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "my", label: "我的資產", meta: { bestFor: "個人素材管理", tip: "先做命名與標籤標準化" } },
      { id: "team", label: "團隊共享", meta: { bestFor: "跨人協作復用", tip: "同步用途與授權說明" } },
    ],
    []
  );
  const ASSETS_TYPE_OPTIONS = useMemo<AgentCapability["options"]>(
    () => [
      { id: "all", label: "全部", meta: { bestFor: "總覽盤點", tip: "先看跨模態可重用素材" } },
      { id: "image", label: "圖片", meta: { bestFor: "視覺素材", tip: "優先補齊角色/場景關鍵圖" } },
      { id: "video", label: "影片", meta: { bestFor: "鏡頭參考", tip: "補上時長與運鏡標記便於檢索" } },
      { id: "audio", label: "音樂", meta: { bestFor: "配樂素材", tip: "加註 BPM 與情緒標籤" } },
      { id: "voice", label: "語音", meta: { bestFor: "配音素材", tip: "加註語速/語氣/角色設定" } },
      { id: "script", label: "腳本", meta: { bestFor: "敘事資產", tip: "與分鏡/提示詞建立關聯" } },
      { id: "zip_bundle", label: "打包", meta: { bestFor: "交付封裝", tip: "用版本號管理交付包" } },
    ],
    []
  );
  const assetsAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換分頁",
        currentId: tab,
        options: ASSETS_TAB_OPTIONS,
        hint: "切到 my（我的資產）或 team（團隊共享）",
      },
      {
        action: "setParam",
        label: "類型篩選",
        hint: "setParam key='assetType' value=all|image|video|audio|voice|script|zip_bundle",
      },
      {
        action: "setParam",
        label: "來源篩選",
        hint: "setParam key='sourceStudio' value=all|creative|director|image|video|pro|background|webhook|suno|replicate|unknown",
      },
      {
        action: "setParam",
        label: "排序方式",
        hint: "setParam key='sort' value=newest|oldest|by_source|by_type",
      },
      {
        action: "search",
        label: "搜尋資產",
        hint: "搜尋資產標題或內容。建議搜尋詞格式：用途 + 角色/場景 + 版本",
      },
      {
        action: "openDialog",
        label: "開啟/關閉面板",
        options: [
          { id: "upload", label: "上傳資產對話框" },
          { id: "close-all", label: "關閉所有展開" },
        ],
        hint: "可開啟上傳對話框，或使用 assetId 參數展開特定資產詳細資訊",
      },
      {
        action: "reset",
        label: "清空條件",
        hint: "類型還原 all、搜尋清空",
      },
    ],
    [tab, ASSETS_TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "assets",
    pageLabel: "數位資產庫",
    pagePath: "/assets",
    capabilities: assetsAgentCapabilities,
    // Only register this agent when the "assets" sub-section is active; each
    // embedded sub-page (prompts, vault, shared, tasks) registers its own
    // agent while mounted, so we disable this one to avoid conflicts.
    enabled: section === "assets",
    state: {
      tab,
      typeFilter,
      sourceFilter,
      sortKey,
      search,
      visibleCount: assets?.length ?? 0,
      myTotal: totalMyAssets,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          if (action.tabId !== "my" && action.tabId !== "team") {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          handleAssetsTabChange(action.tabId);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "setParam": {
          if (action.key === "assetType") {
            const v = String(action.value ?? "");
            if (!ASSET_TYPES.includes(v as AssetTypeFilter)) {
              return { ok: false, reason: `unknown assetType: ${v}` };
            }
            setTypeFilter(v as AssetTypeFilter);
            return { ok: true, message: `類型切到「${v}」` };
          }
          if (action.key === "sourceStudio") {
            const v = String(action.value ?? "");
            if (!SOURCE_STUDIOS.includes(v as SourceStudioFilter)) {
              return { ok: false, reason: `unknown sourceStudio: ${v}` };
            }
            setSourceFilter(v as SourceStudioFilter);
            return {
              ok: true,
              message: `來源切到「${SOURCE_STUDIO_LABELS[v as SourceStudioFilter]}」`,
            };
          }
          if (action.key === "sort") {
            const v = String(action.value ?? "");
            if (!(v in SORT_LABELS)) {
              return { ok: false, reason: `unknown sort: ${v}` };
            }
            setSortKey(v as AssetSortKey);
            return {
              ok: true,
              message: `排序改為「${SORT_LABELS[v as AssetSortKey]}」`,
            };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "search": {
          setSearch(action.query);
          return { ok: true, message: "已套用搜尋" };
        }
        case "openDialog": {
          const { dialogId } = action;
          const actionRecord = action as unknown as Record<string, unknown>;
          const legacyAssetId =
            actionRecord && typeof actionRecord === "object" && "assetId" in actionRecord
              ? actionRecord.assetId
              : undefined;
          const assetIdFromParams =
            action.params && typeof action.params === "object"
              ? (action.params as { assetId?: unknown }).assetId
              : undefined;
          const assetId = assetIdFromParams ?? legacyAssetId;
          switch (dialogId) {
            case "upload":
              setShowUploadDialog(true);
              return { ok: true, message: "已開啟上傳對話框" };
            case "close-all":
              setExpandedId(null);
              setShowUploadDialog(false);
              return { ok: true, message: "已關閉所有展開" };
            default:
              // If assetId is provided, expand that asset
              if (assetId !== undefined) {
                const id = parsePositiveAssetId(assetId);
                if (id === null) {
                  return { ok: false, reason: `無效的資產 ID: ${assetId}` };
                }
                setExpandedId(id);
                return { ok: true, message: `已展開資產 #${id}` };
              }
              return { ok: false, reason: `未知的 dialogId: ${dialogId}` };
          }
        }
        case "reset": {
          resetFilters();
          setSortKey("newest");
          return { ok: true, message: "已清空所有篩選與排序" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on assets: ${action.type}`,
          };
      }
    },
  });

  return (
    <div className="space-y-6">
      {/* ─── 數位資產庫（主內容） ──────────────────────────────────────────── */}
      {section === "assets" && (
        <>
          <div className="flex items-end justify-between gap-4">
            <header className="page-header !mb-0">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-muted-foreground" />
                <h1 className="page-title !mb-0">數位資產庫</h1>
              </div>
              <p className="page-subtitle">
                所有 AI 生成成品、手動上傳資產、團隊共享、歷史紀錄都在這裡。下方切換「資產卡 / 歷史時間軸」與「我的 / 團隊共享」。
              </p>
            </header>
            <div className="flex items-center gap-2">
              {topTab === "assets" && (
                <Badge variant="secondary" className="rounded-lg text-xs">
                  {totalMyAssets} 個資產
                </Badge>
              )}
              <UploadDialog
                onSuccess={() => myAssetsQuery.refetch()}
                open={showUploadDialog}
                onOpenChange={setShowUploadDialog}
              />
            </div>
          </div>

          {/* ── 頂部分頁：數位資產 / 個人資料庫系統 ────────────────── */}
          <Tabs
            value={topTab}
            onValueChange={value => {
              if (value === "assets" || value === "personal_db")
                handleTopTabChange(value);
            }}
          >
            <TabsList className="rounded-xl bg-muted/40 p-1">
              <TabsTrigger value="assets" className="rounded-lg gap-1 text-xs">
                <Package className="w-3 h-3" /> 數位資產
              </TabsTrigger>
              <TabsTrigger
                value="personal_db"
                className="rounded-lg gap-1 text-xs"
              >
                <Database className="w-3 h-3" /> 個人資料庫系統
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {topTab === "personal_db" && (
            <Suspense fallback={<SubPageSkeleton />}>
              <PersonalDatabasePanel />
            </Suspense>
          )}

          {topTab === "assets" && (
            <>
          {/* ── 範圍分頁（我的 / 團隊）— 移到篩選之上，因為使用者
                通常先決定要看哪個範圍，再依類型/來源過濾。 */}
          <Tabs
            value={tab}
            onValueChange={value => {
              if (value === "my" || value === "team") setTab(value);
            }}
          >
            <TabsList className="rounded-xl bg-muted/40 p-1">
              <TabsTrigger value="my" className="rounded-lg gap-1 text-xs">
                <Lock className="w-3 h-3" /> 我的資產
              </TabsTrigger>
              <TabsTrigger value="team" className="rounded-lg gap-1 text-xs">
                <Globe className="w-3 h-3" /> 團隊共享
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* ── 工具列：搜尋 + 排序 + 重設 ───────────────────────────── */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋資產（標題 / 描述 / 提示詞）..."
                className="pl-8 h-8 text-xs rounded-lg"
              />
              {search && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setSearch("")}
                  aria-label="清除搜尋"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
            <Select
              value={sortKey}
              onValueChange={v => setSortKey(v as AssetSortKey)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as AssetSortKey[]).map(k => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {SORT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilter && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="w-3 h-3" /> 重設篩選
              </button>
            )}
          </div>

          {/* ── 篩選列 1：類型（圖 / 影 / 音 / 語 / 腳 / 包） ─────────── */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium shrink-0">
              類型
            </span>
            <div className="flex gap-1 flex-wrap">
              {ASSET_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1 ${typeFilter === t ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`}
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

          {/* ── 篩選列 2：來源工作室（常用 6 + 下拉收合其餘） ───────── */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium shrink-0">
              來源
            </span>
            <div className="flex gap-1 flex-wrap">
              {PRIMARY_SOURCES.map(s => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${sourceFilter === s ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"}`}
                >
                  {SOURCE_STUDIO_LABELS[s]}
                </button>
              ))}
              {/* 其餘低頻來源收進下拉，避免單列 11 個按鈕在桌面 wrap 兩
                  行、手機 wrap 五六行。被選中時 trigger 自動高亮。 */}
              <Select
                value={
                  SECONDARY_SOURCES.includes(sourceFilter)
                    ? sourceFilter
                    : "__placeholder__"
                }
                onValueChange={v => {
                  if (v !== "__placeholder__")
                    setSourceFilter(v as SourceStudioFilter);
                }}
              >
                <SelectTrigger
                  className={`h-7 w-[120px] text-[11px] rounded-lg ${SECONDARY_SOURCES.includes(sourceFilter) ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"}`}
                >
                  <SelectValue placeholder="更多來源…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="__placeholder__"
                    className="text-xs text-muted-foreground"
                    disabled
                  >
                    更多來源…
                  </SelectItem>
                  {SECONDARY_SOURCES.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {SOURCE_STUDIO_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── 結果統計 — 讓使用者知道目前篩選下顯示幾個 / 共幾個 ─── */}
          {!isLoading && rawAssets && filteredAssets && (
            <p className="hs-small !mb-0 text-muted-foreground">
              {hasActiveFilter ? (
                <>
                  顯示 <span className="text-foreground font-medium">{filteredAssets.length}</span>{" "}
                  個資產
                </>
              ) : (
                <>
                  共 <span className="text-foreground font-medium">{rawAssets.length}</span>{" "}
                  個資產
                </>
              )}
            </p>
          )}

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {[1, 2, 3, 4].map(i => (
                <GlassCard key={i} hover={false}>
                  <div className="aspect-square rounded-lg bg-muted/30 animate-pulse mb-3" />
                  <ZenSkeleton lines={2} />
                </GlassCard>
              ))}
            </div>
          ) : filteredAssets && filteredAssets.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filteredAssets.map((asset, idx) => {
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
                              className="rounded-lg bg-card/90 text-xs h-7 gap-1"
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
                              className="rounded-lg bg-card/90 text-xs h-7 gap-1"
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
                                className="rounded-lg bg-card/90 text-xs h-7 gap-1"
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
                                className="rounded-lg bg-card/90 text-xs h-7 text-destructive"
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
                      {/* 來源工作室 badge — 0047 migration 寫入的
                          sourceStudio 欄位，讓使用者一眼看出資產來自哪
                          個工作室。前綴的小色點區分不同來源；舊資料
                          （NULL）不顯示。 */}
                      {asset.sourceStudio && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setSourceFilter(
                              asset.sourceStudio as SourceStudioFilter
                            );
                          }}
                          className="inline-flex items-center gap-1 text-[10px] text-foreground/80 bg-foreground/5 hover:bg-foreground/10 px-1.5 py-0.5 rounded-md transition-colors"
                          title={
                            asset.modelId
                              ? `來源：${SOURCE_STUDIO_LABELS[asset.sourceStudio as SourceStudioFilter] ?? asset.sourceStudio}\n模型：${asset.modelId}\n（點選只看此來源）`
                              : `來源（點選只看此來源）`
                          }
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              asset.sourceStudio === "creative"
                                ? "bg-zen-lavender"
                                : asset.sourceStudio === "director"
                                  ? "bg-zen-sage"
                                  : asset.sourceStudio === "image"
                                    ? "bg-zen-sky"
                                    : asset.sourceStudio === "video"
                                      ? "bg-zen-peach"
                                      : asset.sourceStudio === "pro"
                                        ? "bg-zen-blush"
                                        : asset.sourceStudio === "suno"
                                          ? "bg-amber-400"
                                          : "bg-muted-foreground/50"
                            }`}
                          />
                          {SOURCE_STUDIO_LABELS[
                            asset.sourceStudio as SourceStudioFilter
                          ] ?? asset.sourceStudio}
                        </button>
                      )}
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
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
            {hasActiveFilter ? (
              <Filter className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Package className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <h3 className="hs-h3 !mb-0">
            {hasActiveFilter ? "目前篩選下沒有資產" : "尚無數位資產"}
          </h3>
          <p className="hs-p !mb-0 text-muted-foreground max-w-sm">
            {hasActiveFilter
              ? "試試改變類型 / 來源 / 搜尋字詞，或清除全部篩選"
              : tab === "my"
                ? "前往工作室生成，或點擊「上傳資產」手動添加"
                : "還沒有團隊共享的資產"}
          </p>
          {hasActiveFilter && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs gap-1 mt-1"
              onClick={resetFilters}
            >
              <X className="w-3 h-3" /> 重設篩選
            </Button>
          )}
        </div>
      )}
            </>
          )}
        </>
      )}

      {/* ─── 提示詞庫 ─────────────────────────────────────────────────────── */}
      {section === "prompts" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <PromptLibraryPage />
        </Suspense>
      )}

      {/* ─── 個人提示詞收集（含全站精靈 / 模型樣板 / 模板，支援團隊共享）── */}
      {section === "collection" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <PromptCollectionPage />
        </Suspense>
      )}

      {/* ─── 一致性保險庫 ─────────────────────────────────────────────────── */}
      {section === "vault" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <VaultPage />
        </Suspense>
      )}

      {/* ─── 背景任務中心 ─────────────────────────────────────────────────── */}
      {section === "tasks" && (
        <Suspense fallback={<SubPageSkeleton />}>
          <BackgroundTasksPage />
        </Suspense>
      )}

      {/* ─── Google Drive 素材庫 ───────────────────────────────────────────── */}
      {section === "drive" && <DriveLibrarySection />}
    </div>
  );
}
