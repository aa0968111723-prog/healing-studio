// ============================================================================
// shells/video/ConfirmGate.tsx — 確認門（GATE）卡：完整狀態機的可視化 + 解鎖動作
// ----------------------------------------------------------------------------
// 顯示專案級確認門全貌（鐵則引擎 spine/gate.ts 的 UI 面）：
//   • 三態計數：可量產 / 部分待補 / 全待補（countGate）
//   • 具名待補：角色缺定裝 / 場景缺實景 / 角色未確認 / 角色僅估算（去重彙整自所有鏡）
//   • 解鎖：對「可上傳參考照解鎖」的角色給單鍵動作（uploadReference → grade 升精準 + 鎖全 → 重算 ready）
//   • 過期重生：角色改設定後的 stale 計數提示
//   • 鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本
// ============================================================================
import { useMemo } from "react";
import { Lock, AlertTriangle, Check, Upload, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { computeGate, countGate, type GateReason } from "@/spine/gate";
// U-2（AIDV-92）逐殼採用 · /video S5：旗標 ON 時改用 design-kit 亮色暖光 GateCard
// （與 ReadinessChip／ShotPanel 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝沿用既有 Tailwind 版＝零變化。
// 設計門依 ui-ux-pro-max「色彩非唯一資訊（High）」：兩版皆保留三態文字標籤與鐵則文案。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, GateCard as DkGateCard } from "@/components/design-kit";

interface AggReason extends GateReason {
  shots: string[]; // 受影響鏡號
}

export function ConfirmGate() {
  const spine = useProjectSpine();
  const p = spine.project!;

  const { gate, reasons } = useMemo(() => {
    const gate = countGate(p.shots, p.characters, p.scenes);
    // 去重彙整所有鏡的待補原因（key = kind+refId），記錄受影響鏡號。
    const map = new Map<string, AggReason>();
    for (const sh of p.shots) {
      const g = computeGate(sh, p.characters, p.scenes);
      for (const r of g.reasons) {
        const key = `${r.kind}:${r.refId}`;
        const cur = map.get(key);
        if (cur) cur.shots.push(sh.no);
        else map.set(key, { ...r, shots: [sh.no] });
      }
    }
    return { gate, reasons: [...map.values()] };
  }, [p]);

  const allReady = reasons.length === 0;

  // 旗標 ON：薄 adapter（Shot→ShotLite／Character→CharacterLite）後改渲 design-kit GateCard。
  // 待補角色的「上傳參考照」接回同一個 spine.uploadReference（與下方既有版同一真實接點）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkGateCard
          shots={p.shots.map((s) => ({ id: s.id, route: s.route, characterIds: s.characterIds }))}
          characters={p.characters.map((c) => ({
            id: c.id, name: c.name, sourceGrade: c.sourceGrade, locked: c.locked,
          }))}
          onUploadReference={(charId) => spine.uploadReference(charId)}
        />
      </AidvKit>
    );
  }

  return (
    <div className="rounded-xl border bg-card/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Lock className="size-4 text-primary" /> 確認門 · GATE
      </div>

      {/* 三態大計數 */}
      <div className="grid grid-cols-3 gap-2">
        <Count n={gate.ready} label="可量產" tone="ok" />
        <Count n={gate.partial} label="部分待補" tone="warn" />
        <Count n={gate.blocked} label="全待補" tone="bad" />
      </div>

      {/* 具名待補原因 + 解鎖動作 */}
      <div className="mt-3 space-y-1.5">
        {allReady ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-4" /> 主要角色已定版、場景到位 → 可進量產。
          </div>
        ) : (
          reasons.map((r) => (
            <div key={`${r.kind}:${r.refId}`} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
              {r.kind === "scene-missing-location" ? (
                <MapPin className="size-4 shrink-0 text-amber-500" />
              ) : (
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 flex-1 text-xs">
                <span className="font-medium">{r.refName}</span>
                <Badge variant="outline" className="ml-1.5 align-middle text-[10px]">{r.label}</Badge>
                <span className="ml-1 text-muted-foreground">· {r.shots.join("、")}</span>
              </span>
              {r.unlockable ? (
                <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" onClick={() => spine.uploadReference(r.refId)}>
                  <Upload className="size-3" /> 上傳參考照
                </Button>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">場景頁鎖定實景</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* 過期重生提示 */}
      {gate.stale > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <RefreshCw className="size-3.5" /> {gate.stale} 鏡因角色改設定而過期 → 需同 seed 重生。
        </div>
      )}

      {/* 鐵則 */}
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        鐵則：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · 媒體生成前先估成本。
      </p>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border py-2",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "bad" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <span
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "bad" && "text-destructive",
        )}
      >
        {n}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default ConfirmGate;
