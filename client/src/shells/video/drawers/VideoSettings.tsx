// ============================================================================
// shells/video/drawers/VideoSettings.tsx — 2-18 影片系統設定（W1-6 強化）
// ----------------------------------------------------------------------------
// 從 ConsoleDrawers 抽出獨立檔（同 FlowTv/ModelCatalog 慣例）。三件事：
//   • 生成引擎（GENERATION_PROVIDER）：沿用既有 spine.setProvider。
//   • per-引擎設定（2-16）：各模態「預設引擎」可就地覆寫——選項取自 registry
//     （getModelsByDomain），基準＝後端 brain 預設（director.generationModels 唯讀）。
//     覆寫存 DirectorConsole 本地狀態（per session）；寫回 brain＝後端待補（G10）。
//   • 個人化（完善）：把帳號層已持久化的偏好（PersonalSettingsContext，localStorage
//     ＋debounced 後端同步）搬進座艙就地調，不再只能去 /settings。
// 零後端變更；全程在 ENABLE_4SHELL=ON 之下才可達。
// ============================================================================
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

      {/* 鐵則 */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本。<br />
        帳號／權限／觀測等全站設定在 <span className="font-mono">/settings</span> shell。
      </div>
    </div>
  );
}

export default VideoSettingsBody;
