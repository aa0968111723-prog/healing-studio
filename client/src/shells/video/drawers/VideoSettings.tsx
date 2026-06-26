// ============================================================================
// shells/video/drawers/VideoSettings.tsx — 2-18 影片系統設定（W1-6 強化）
// ----------------------------------------------------------------------------
// 從 ConsoleDrawers 抽出獨立檔（同 FlowTv/ModelCatalog 慣例）。四件事：
//   • 生成引擎（GENERATION_PROVIDER）：沿用既有 spine.setProvider。
//   • per-引擎設定（2-16）：各模態「預設引擎」可就地覆寫——選項取自 registry
//     （getModelsByDomain），基準＝後端 brain 預設（director.generationModels 唯讀）。
//     覆寫存 DirectorConsole 本地狀態（per session）；寫回 brain＝後端待補（G10）。
//   • 個人化（完善）：把帳號層已持久化的偏好（PersonalSettingsContext，localStorage
//     ＋debounced 後端同步）搬進座艙就地調，不再只能去 /settings。
//   • AIDV-271 輸出規格（匯出格式 mp4/webm/gif + resolution/fps/codec）
//     per-專案儲存（videoProject.save）。
// ============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole, type EngineModality } from "../DirectorConsoleProvider";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { getModelsByDomain, type ModelDomain } from "@shared/unifiedModelRegistry";
import {
  usePersonalSettings, type PersonalSettings, type PersonalSettingsSyncStatus,
} from "@/contexts/PersonalSettingsContext";
import type { ProviderId } from "@/spine/types";
import { toast } from "sonner";

type OutputFormat = "mp4" | "webm" | "gif";
type OutputResolution = "720p" | "1080p" | "4K";
type OutputFps = 24 | 30 | 60;
type OutputCodec = "h264" | "h265" | "vp9";

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "hf", label: "Hugging Face" },
  { id: "gemini", label: "Gemini 2.5" },
  { id: "fal", label: "fal" },
  { id: "mock", label: "Mock（離線）" },
];

/** 各模態 → registry 領域（brainDefaults 的 key 用 director 模態命名）。
 *  註：registry 無純 text-to-video 領域，本系統「影片引擎」實作＝圖生影片(i2v)，故 T2V 對映 image-to-video。
 *  此為「偏好備忘」用途（不直接餵生成），故 i2v 選項用於影片引擎偏好是安全的。 */
const ENGINE_MODALITIES: { key: EngineModality; label: string; domain: ModelDomain }[] = [
  { key: "text-to-image", label: "文字生圖", domain: "text-to-image" },
  { key: "text-to-video", label: "影片（圖生影片 i2v）", domain: "image-to-video" },
  { key: "text-to-audio", label: "音樂 / 音效", domain: "audio-music" },
  { key: "text-to-speech", label: "語音 / 配音", domain: "voice-tts" },
];

/** 帳號層個人化開關（皆為 PersonalSettings 的 boolean 欄；已自動持久化）。 */
type BoolToggleKey =
  | "confirmBeforeGenerate" | "compactMode" | "soundEnabled"
  | "desktopNotif" | "orbCuteMode" | "orbRandomFly";
const PERSONAL_TOGGLES: { key: BoolToggleKey; label: string }[] = [
  { key: "confirmBeforeGenerate", label: "生成前先跳確認（成本門）" },
  { key: "compactMode", label: "緊湊模式（資訊密度高）" },
  { key: "soundEnabled", label: "音效" },
  { key: "desktopNotif", label: "桌面通知" },
  { key: "orbCuteMode", label: "光球可愛模式" },
  { key: "orbRandomFly", label: "光球隨機飄移" },
];

const SYNC_LABEL: Record<PersonalSettingsSyncStatus, string> = {
  idle: "本機",
  loading: "載入中…",
  saving: "同步中…",
  synced: "已同步",
  offline: "離線（暫存本機）",
  error: "同步失敗",
};

const FORMAT_OPTIONS: { value: OutputFormat; label: string; desc: string }[] = [
  { value: "mp4", label: "MP4", desc: "H.264 · 相容性最佳" },
  { value: "webm", label: "WebM", desc: "VP9 · 網頁嵌入最佳" },
  { value: "gif", label: "GIF", desc: "動態圖 · 自動限 ≤15s / ≤720px" },
];

const RESOLUTION_OPTIONS: OutputResolution[] = ["720p", "1080p", "4K"];
const FPS_OPTIONS: OutputFps[] = [24, 30, 60];
const CODEC_OPTIONS: { value: OutputCodec; label: string }[] = [
  { value: "h264", label: "H.264" },
  { value: "h265", label: "H.265" },
  { value: "vp9", label: "VP9" },
];

function OutputSpecSection() {
  const utils = trpc.useUtils();
  const projectsQ = trpc.videoProject.list.useQuery(undefined, { staleTime: 30_000 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const saveMut = trpc.videoProject.save.useMutation({
    onSuccess: () => {
      utils.videoProject.list.invalidate();
      toast.success("輸出規格已儲存");
    },
    onError: () => toast.error("儲存輸出規格失敗"),
  });

  const projects = projectsQ.data ?? [];
  const project = projects.find(p => p.id === selectedId) ?? projects[0] ?? null;
  const spec = project?.outputSpec;

  if (projectsQ.isLoading) return <PanelLoading count={3} className="h-8 rounded-lg" label="讀取輸出規格…" />;
  if (!project) return <p className="text-[10px] text-muted-foreground">尚無影片專案</p>;

  function save(patch: Record<string, unknown>) {
    if (!project) return;
    const merged = { ...(spec ?? { resolution: "1080p", fps: 30, codec: "h264", format: "mp4" }), ...patch };
    saveMut.mutate({
      id: project.id,
      outputSpec: merged as Parameters<typeof saveMut.mutate>[0]["outputSpec"],
      expectedVersion: project.version,
    });
  }

  return (
    <div className="space-y-2">
      {projects.length > 1 && (
        <select
          aria-label="切換影片專案"
          value={selectedId ?? project.id}
          onChange={e => setSelectedId(Number(e.target.value))}
          className="w-full rounded-md border bg-background px-2 py-1 text-xs"
        >
          {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}

      {/* 匯出格式 */}
      <div>
        <div className="mb-1 text-[10px] font-medium text-muted-foreground">匯出格式</div>
        <div className="grid grid-cols-3 gap-1">
          {FORMAT_OPTIONS.map(f => (
            <button
              key={f.value}
              type="button"
              disabled={saveMut.isPending}
              onClick={() => save({ format: f.value })}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-left text-[10px] transition-healing",
                (spec?.format ?? "mp4") === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <div className="font-medium">{f.label}</div>
              <div className="text-muted-foreground">{f.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 解析度 */}
      <div className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
        <span>解析度</span>
        <select
          aria-label="解析度"
          value={spec?.resolution ?? "1080p"}
          disabled={saveMut.isPending}
          onChange={e => save({ resolution: e.target.value as OutputResolution })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {RESOLUTION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* FPS */}
      <div className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
        <span>幀率（FPS）</span>
        <select
          aria-label="幀率"
          value={spec?.fps ?? 30}
          disabled={saveMut.isPending}
          onChange={e => save({ fps: Number(e.target.value) as OutputFps })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {FPS_OPTIONS.map(f => <option key={f} value={f}>{f} fps</option>)}
        </select>
      </div>

      {/* 編碼器 */}
      <div className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
        <span>編碼器</span>
        <select
          aria-label="編碼器"
          value={spec?.codec ?? "h264"}
          disabled={saveMut.isPending}
          onChange={e => save({ codec: e.target.value as OutputCodec })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {CODEC_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {(spec?.format === "gif") && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
          GIF 輸出自動限制 ≤15 秒 / ≤720px 以控制檔案大小。
        </p>
      )}
    </div>
  );
}

export function VideoSettingsBody() {
  const console_ = useDirectorConsole();
  const spine = useProjectSpine();
  const personal = usePersonalSettings();
  const defaults = trpc.director.generationModels.useQuery(undefined, { staleTime: 5 * 60_000 });
  const brainDefaults = (defaults.data?.brainDefaults ?? {}) as Record<string, string | undefined>;

  return (
    <div className="space-y-4 pt-4">
      {/* 生成引擎 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">生成引擎（GENERATION_PROVIDER）</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDERS.map((pv) => (
            <button
              key={pv.id}
              type="button"
              onClick={() => spine.setProvider(pv.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-healing",
                spine.provider === pv.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50",
              )}
            >
              {pv.label}
            </button>
          ))}
        </div>
      </div>

      {/* per-引擎設定（2-16）：各模態預設引擎，可就地覆寫 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">各模態預設引擎（per-引擎 · 2-16）</span>
          <Badge variant="outline" className="text-[9px]">偏好備忘 · 未接線</Badge>
        </div>
        {defaults.isLoading ? (
          <PanelLoading count={4} className="h-9 rounded-lg" label="讀取各模態預設引擎…" />
        ) : (
          <div className="space-y-2">
            {defaults.isError && (
              <PanelError
                compact
                message="系統預設讀取失敗（director.generationModels）；仍可從 registry 選引擎覆寫。"
                onRetry={() => void defaults.refetch()}
              />
            )}
            {ENGINE_MODALITIES.map((m) => {
              const options = getModelsByDomain(m.domain);
              const baseline = brainDefaults[m.key];
              const override = console_.enginePrefs[m.key];
              return (
                <label key={m.key} className="block rounded-lg border bg-card/60 px-2.5 py-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium">{m.label}</span>
                    {override ? (
                      <Badge variant="secondary" className="text-[9px]">已記偏好</Badge>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">系統預設：<span className="font-mono">{baseline ?? "—"}</span></span>
                    )}
                  </div>
                  <select
                    aria-label={`${m.label} 預設引擎`}
                    value={override ?? ""}
                    onChange={(e) => console_.setEnginePref(m.key, e.target.value || null)}
                    className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    <option value="">用系統預設{baseline ? `（${baseline}）` : ""}</option>
                    {options.map((o) => (
                      <option key={o.modelId} value={o.modelId}>{o.label}（{o.provider}）</option>
                    ))}
                  </select>
                </label>
              );
            })}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              偏好備忘（per session）：<span className="font-medium">目前不影響生成</span>，生成仍走系統預設（brain）。接線到生成＝後端待補（G10／AIDV-9 之後）。
            </p>
          </div>
        )}
      </div>

      {/* 介面（此座艙，console 範圍狀態） */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">介面（此座艙）</div>
        <div className="space-y-2">
          <label className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs">
            <span>顯示 Context Sidecar（右欄）</span>
            <Switch checked={console_.showSidecar} onCheckedChange={console_.setShowSidecar} />
          </label>
          <label className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs">
            <span>自動存草稿（prompt ≥4 字自動入庫）</span>
            <Switch checked={console_.autoSaveDraft} onCheckedChange={console_.setAutoSaveDraft} />
          </label>
        </div>
      </div>

      {/* 個人化（帳號層 · 已持久化）——「完善」：搬進座艙就地調 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">個人化（帳號層 · 自動同步）</span>
          <span className="text-[9px] text-muted-foreground">{SYNC_LABEL[personal.syncStatus]}</span>
        </div>
        <div className="space-y-2">
          {PERSONAL_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs">
              <span>{t.label}</span>
              <Switch
                checked={Boolean(personal.settings[t.key])}
                onCheckedChange={(v) => personal.updateSettings({ [t.key]: v } as Partial<PersonalSettings>)}
              />
            </label>
          ))}
        </div>
      </div>

      {/* AIDV-271 輸出規格（匯出格式 · 解析度 · FPS · 編碼器） */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">輸出規格（per-專案）</span>
          <Badge variant="outline" className="text-[9px]">AIDV-271</Badge>
        </div>
        <OutputSpecSection />
      </div>

      {/* 鐵則 */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本。<br />
        帳號／權限／觀測等全站設定在 <span className="font-mono">/settings</span> shell。
      </div>
    </div>
  );
}

export default VideoSettingsBody;
