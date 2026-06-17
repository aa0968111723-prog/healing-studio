// ============================================================================
// shells/settings/panels/ProviderPanel.tsx — 生成引擎（Provider B 案）+ 故障注入
// ----------------------------------------------------------------------------
// 對映模擬 settings「生成引擎」分頁 + 架構 §6 B 案：hf | gemini | fal | mock 逐引擎切換。
// 接縫：P0 SpineProvider 的 provider / setProvider / faults / toggleFault（GenerationAdapter
//   讀此偏好，內建 hf→gemini→fal→mock 回退鏈）。Claude 只決策、不生圖。
// 持久化（選配）：把選定 provider 寫入 settings.extraSettings.generationProvider（重整後沿用）。
//   未登入時 settings.update 失敗不影響本機切換（SpineProvider 為記憶體狀態）。
// 故障注入：toggleFault(provider) → 到 /video|/social 生成可看回退鏈；研究故障 toggleFault('research')。
// ============================================================================
import { Hand, Zap, Bug } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSpine } from "@/providers/SpineProvider";
import type { ProviderId } from "@/spine/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時生成引擎卡改用 design-kit ProviderOption、
// 故障注入列改用 design-kit SettingRow（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；
// OFF（預設）＝既有版＝線上零變化。ProviderOption 自帶 status 圓點（fault→down，對映「down banner」）、
// role=radio/aria-checked 表「使用中」，選擇控制項 onSelect 照舊；note/cost 以說明列保留不丟。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, ProviderOption, SettingRow as DkSettingRow } from "@/components/design-kit";

const PROVIDERS: ProviderId[] = ["hf", "gemini", "fal", "mock"];
const PROVIDER_META: Record<ProviderId, { note: string; cost: string; fault: string }> = {
  hf: { note: "HF Inference（主引擎，預設）", cost: "0.012", fault: "逾時 504" },
  gemini: { note: "Gemini（並列可選；B 案）", cost: "0.020", fault: "速率限制 429" },
  fal: { note: "fal.ai（回退）", cost: "0.030", fault: "額度用盡 402" },
  mock: { note: "離線兜底（零金鑰）", cost: "0.000", fault: "注入 500（連兜底都失敗→整體失敗）" },
};

export function ProviderPanel() {
  const spine = useSpine();
  const update = trpc.settings.update.useMutation({
    onSuccess: () => toast.success("已記住生成引擎偏好"),
    onError: () => {/* 未登入 → 僅本機切換，不打擾 */},
  });

  const pick = (pv: ProviderId) => {
    spine.setProvider(pv);
    // 選配持久化（寫 extraSettings；失敗不影響本機切換）。
    update.mutate({ extraSettings: { generationProvider: pv } } as any);
  };

  return (
    <div className="space-y-4">
      {/* Provider 選擇 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Hand className="h-4 w-4" />生成 Provider（B 案）</div>
          <Badge variant="outline" className="font-mono text-[10px]">GENERATION_PROVIDER = {spine.provider}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">逐引擎切換：HF 預設、Gemini 並列、fal 回退、mock 離線兜底。Claude 只決策、不生圖。</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PROVIDERS.map((pv) => (
            <ProviderChoice
              key={pv}
              pv={pv}
              selected={spine.provider === pv}
              down={!!spine.faults[pv]}
              onSelect={() => pick(pv)}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Zap className="h-3 w-3" />回退鏈：hf → gemini → fal → mock（每跳 append-only 記 provider/cost/latency）。
        </div>
      </Card>

      {/* 故障注入（demo 回退） */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Bug className="h-4 w-4" />故障注入（示範回退）</div>
          <Badge variant="secondary" className="text-[10px]">demo / 測試用</Badge>
        </div>
        <p className="text-xs text-muted-foreground">打開任一 provider 的故障，再去 /video 或 /social 生成，會看到自動回退鏈與提示。</p>
        {PROVIDERS.map((pv) => (
          <Row key={pv} label={`模擬 ${pv} 失敗`} desc={PROVIDER_META[pv].fault}>
            <Switch checked={!!spine.faults[pv]} onCheckedChange={() => spine.toggleFault(pv)} />
          </Row>
        ))}
        <Row label="模擬研究上游故障" desc="/learn 研究代理 503（示範錯誤 / 重試）">
          <Switch checked={!!spine.faults.research} onCheckedChange={() => spine.toggleFault("research")} />
        </Row>
      </Card>
    </div>
  );
}

/** 生成引擎卡：旗標 ON 時改用 design-kit ProviderOption（圓點＝健康/故障、role=radio＝使用中）＋
 *  說明列保留 note/cost；OFF＝既有卡片＝零變化。選擇控制項 onSelect 兩版皆在。 */
export function ProviderChoice({ pv, selected, down, onSelect }: { pv: ProviderId; selected: boolean; down: boolean; onSelect: () => void }) {
  const meta = PROVIDER_META[pv];
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="flex flex-col gap-1.5">
          <ProviderOption name={pv.toUpperCase()} status={down ? "down" : "ok"} selected={selected} onSelect={onSelect} />
          <div className="px-1 text-[11px] text-muted-foreground">{meta.note}</div>
          <div className="px-1 text-[11px] font-mono text-amber-600">${meta.cost}/張</div>
        </div>
      </AidvKit>
    );
  }
  return (
    <button
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold uppercase">{pv}</span>
        {selected && <Badge variant="default" className="text-[10px]">使用中</Badge>}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5">{meta.note}</div>
      <div className="text-[11px] text-amber-600 font-mono mt-1.5">${meta.cost}/張</div>
    </button>
  );
}

/** 故障注入列：旗標 ON 時改用 design-kit 亮色暖光 SettingRow；OFF＝既有列＝零變化。Switch 控制項兩版皆在。 */
export function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkSettingRow label={label} hint={desc}>{children}</DkSettingRow>
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div><div className="text-sm font-medium">{label}</div>{desc && <div className="text-[11px] text-muted-foreground">{desc}</div>}</div>
      {children}
    </div>
  );
}

export default ProviderPanel;
