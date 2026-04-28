import { useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ConsistencyVault } from "@/components/ConsistencyVault";
import { Layers, Film, Music, Image, Download, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";

// ─── 成品輸出庫 ──────────────────────────────────────────────────────────────

type JobType = "image" | "video" | "audio" | "voice" | "multimodal";

function mediaUrlFromResult(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const r = resultJson as Record<string, unknown>;
  return (
    (r.resultUrl as string) ??
    (((r.result as Record<string, unknown>)?.video as Record<string, unknown>)?.url as string) ??
    ((r.result as Record<string, unknown>)?.videoUrl as string) ??
    (((r.result as Record<string, unknown>)?.audio as Record<string, unknown>)?.url as string) ??
    ((r.result as Record<string, unknown>)?.audioUrl as string) ??
    (((r.result as Record<string, unknown>)?.image as Record<string, unknown>)?.url as string) ??
    ((r.result as Record<string, unknown>)?.imageUrl as string) ??
    ((r.result as Record<string, unknown>)?.images as string[])?.[0] ??
    (r.videoUrl as string) ??
    (r.audioUrl as string) ??
    (r.imageUrl as string) ??
    null
  );
}

function jobTypeIcon(type: string) {
  if (type === "video" || type === "multimodal") return <Film className="w-4 h-4" />;
  if (type === "audio" || type === "voice") return <Music className="w-4 h-4" />;
  return <Image className="w-4 h-4" />;
}

function jobTypeLabel(type: string): string {
  const map: Record<string, string> = {
    image: "圖片",
    video: "影片",
    audio: "音樂",
    voice: "語音",
    multimodal: "多模態",
  };
  return map[type] ?? type;
}

function downloadUrl(mediaUrl: string, jobType: string): string {
  const extMap: Record<string, string> = {
    video: "mp4",
    audio: "mp3",
    voice: "mp3",
    image: "png",
    multimodal: "mp4",
  };
  const ext = extMap[jobType] ?? "bin";
  const filename = `healing-studio-${jobType}-${Date.now()}.${ext}`;
  return `/api/media/download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`;
}

const JOB_TYPE_FILTERS: Array<{ value: JobType | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "video", label: "影片" },
  { value: "audio", label: "音樂" },
  { value: "image", label: "圖片" },
  { value: "voice", label: "語音" },
];

const PAGE_SIZE = 20;

function MediaOutputVault() {
  const [filter, setFilter] = useState<JobType | "all">("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch, isFetching } =
    trpc.generate.listCompletedMedia.useQuery(
      {
        jobType: filter === "all" ? undefined : filter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      },
      { staleTime: 30_000 }
    );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleFilterChange = useCallback((f: JobType | "all") => {
    setFilter(f);
    setPage(0);
  }, []);

  return (
    <div className="space-y-4">
      {/* 篩選列 */}
      <div className="flex items-center gap-2 flex-wrap">
        {JOB_TYPE_FILTERS.map(f => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => handleFilterChange(f.value as JobType | "all")}
            className="h-7 text-xs"
          >
            {f.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto h-7"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* 載入中 */}
      {isLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          載入中…
        </div>
      )}

      {/* 空狀態 */}
      {!isLoading && items.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
          尚無成品紀錄。前往工作室生成影片、音樂或圖片後，結果會自動出現在這裡。
        </div>
      )}

      {/* 成品格線 */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(job => {
            const mediaUrl = mediaUrlFromResult(job.resultJson);
            const label =
              ((job.resultJson as Record<string, unknown>)?.label as string) ??
              jobTypeLabel(job.jobType);
            const modelId =
              ((job.resultJson as Record<string, unknown>)?.modelId as string) ?? "";

            return (
              <div
                key={job.id}
                className="border rounded-lg p-3 space-y-2 bg-card"
              >
                {/* Header */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground shrink-0">
                    {jobTypeIcon(job.jobType)}
                  </span>
                  <span className="text-sm font-medium truncate flex-1">{label}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {jobTypeLabel(job.jobType)}
                  </Badge>
                </div>

                {/* 模型名稱 */}
                {modelId && (
                  <p className="text-xs text-muted-foreground truncate">{modelId}</p>
                )}

                {/* 媒體預覽 */}
                {mediaUrl && job.jobType === "video" && (
                  <video
                    src={mediaUrl}
                    controls
                    className="w-full rounded max-h-40 bg-black"
                    preload="metadata"
                  />
                )}
                {mediaUrl && (job.jobType === "audio" || job.jobType === "voice") && (
                  <audio
                    src={mediaUrl}
                    controls
                    className="w-full"
                    preload="metadata"
                  />
                )}
                {mediaUrl && job.jobType === "image" && (
                  <img
                    src={mediaUrl}
                    alt={label}
                    className="w-full rounded max-h-40 object-cover"
                    loading="lazy"
                  />
                )}

                {/* 時間 + 下載 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleDateString("zh-TW", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {mediaUrl && (
                    <a
                      href={downloadUrl(mediaUrl, job.jobType)}
                      download
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下載
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 分頁 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type VaultTab = "consistency" | "output";

export default function VaultPage() {
  usePageTour("vault");
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<VaultTab>("consistency");

  const VAULT_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/studio", "/image-studio", "/models", "/assets"]),
    []
  );
  const vaultAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "前往工作室或模型庫",
        options: [
          { id: "/studio", label: "創作工作室", meta: { bestFor: "快速套用一致性素材", tip: "先拖角色錨點再生成" } },
          { id: "/image-studio", label: "圖片創作室", meta: { bestFor: "角色視覺定稿", tip: "先固定臉部與服裝特徵" } },
          { id: "/models", label: "角色鍛造所", meta: { bestFor: "模型版本治理", tip: "保留穩定版避免回滾風險" } },
          { id: "/assets", label: "數位資產庫", meta: { bestFor: "參考素材整理", tip: "先統一命名規則再批次標記" } },
        ],
        hint: "/studio、/image-studio、/models、/assets",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "vault",
    pageLabel: "一致性保險庫",
    pagePath: "/vault",
    capabilities: vaultAgentCapabilities,
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate") {
        if (!VAULT_NAV_ALLOWLIST.has(action.path)) {
          return { ok: false, reason: `navigation blocked: ${action.path}` };
        }
        navigate(action.path);
        return { ok: true, message: `已導航到 ${action.path}` };
      }
      return { ok: false, reason: `unsupported on vault: ${action.type}` };
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="hs-h1 !mb-0 text-foreground flex items-center gap-2">
          <Layers className="w-6 h-6" />
          資產保險庫
        </h1>
        <p className="hs-small !mb-0 text-muted-foreground mt-1">
          管理角色參考圖，並查看三個工作室生成的所有成品。
        </p>
      </div>

      <AssetModelSubpageGuide page="vault" />

      {/* Tab 切換 */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("consistency")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "consistency"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          一致性保險庫
        </button>
        <button
          onClick={() => setActiveTab("output")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "output"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          成品輸出庫
        </button>
      </div>

      {/* Tab 內容 */}
      {activeTab === "consistency" && (
        <div className="max-w-2xl">
          <ConsistencyVault />
        </div>
      )}
      {activeTab === "output" && <MediaOutputVault />}
    </div>
  );
}
