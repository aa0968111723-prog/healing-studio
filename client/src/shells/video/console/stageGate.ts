// ============================================================================
// shells/video/console/stageGate.ts — S2 非線性跳階「補齊驗證」純函式引擎（AIDV-95 / U-5）
// ----------------------------------------------------------------------------
// 權威規格：docs/4shell-handoff/AI-Director-UIUX設計/shell-video/video規格.md §2
//   「非線性入口」——任一階段可點擊跳入；跳階時系統檢查該階段前置，缺料則彈「補齊精靈」
//   列出缺項，提供「回頭引導」或「就地快速補」。整套非線性，不變量＝跳階不丟已完成資料。
//
// 規格列出的三條硬驗證 + 兩條延伸（對映座艙中欄畫布 CanvasMode）：
//   · 跳「分鏡確認（shot）」但無分鏡        → 引導回腳本意圖（script）。
//   · 跳「多模態生成（asset）」但無就緒鏡    → 確認門擋下，列待補角色/場景（回分鏡修復）。
//   · 跳「打包初剪（rough-cut）」但無已生成素材 → 引導回多模態生成（asset）。
//   · 跳「成片交付（complete）」但無已核准影格 → 提示先核准關鍵影格（回分鏡確認 shot）。
//
// 純函式、無副作用、type-only 依賴（與 spine/gate.ts 同性質）→ 可窮盡單元測試、可在元件外
// 呼叫。複用既有確認門引擎 computeGate（角色定版/場景實景/三態）作為「就緒鏡」判準的唯一真相。
//
// 【零行為改變保證】本模組只「計算缺料」，不持有任何狀態、不做任何導航；是否套用由呼叫端
//   （CreationFlowBar）在旗標 ENABLE_VIDEO_GATE_KIT 之下決定。旗標 OFF＝完全不被呼叫。
// ============================================================================
import type { CreativeProject } from "@/spine/types";
import { computeGate } from "@/spine/gate";
import type { CanvasMode } from "../DirectorConsoleProvider";

/** 缺料種類（驅動 UI 顯示哪一種「待補」與回頭引導目標）。 */
export type StageGapKind =
  | "no-script" // 尚無分鏡（腳本未產出 / 未匯入）
  | "no-ready-shot" // 有分鏡但無任何「就緒可生成」鏡（角色未定版 / 場景未鎖）
  | "no-generated" // 尚無任何已生成素材（無法初剪）
  | "no-approved"; // 尚無任何已核准影格（不可交付成片）

/** 受影響的角色或場景（供「就地快速補」定位）。 */
export interface StageGapRef {
  id: string;
  name: string;
}

export interface StageGap {
  kind: StageGapKind;
  /** 中文短標（給標題）。 */
  label: string;
  /** 一句話說明 + 如何補（給內文）。 */
  detail: string;
  /** 「回頭引導」目標畫布（點此回到能補齊的上一階段）。 */
  backTo: CanvasMode;
  /** 回頭引導鈕的人話標籤（如「回腳本意圖」）。 */
  backToLabel: string;
  /** 受影響的角色/場景（no-ready-shot 才有；其餘為空）。 */
  refs: StageGapRef[];
}

/** 中欄畫布的人話名稱（回頭引導鈕用）。 */
const CANVAS_LABEL: Partial<Record<CanvasMode, string>> = {
  chat: "導演對話",
  script: "腳本意圖",
  shot: "分鏡確認",
  asset: "多模態素材",
  "rough-cut": "打包初剪",
  voice: "配音/環境音",
  music: "配樂",
  complete: "成片交付",
};

/** 一個鏡頭是否「已生成素材」（image/keyframe 完成且有資產 URL）。 */
function isGenerated(s: CreativeProject["shots"][number]): boolean {
  return s.gen.status === "done";
}

/**
 * 計算「跳到某中欄畫布」前的缺料清單。空陣列＝前置齊備、可直接前往。
 * 僅對「下游創作階段」（asset / rough-cut / shot / complete）設前置；
 * 入口/輔助畫布（chat / script / voice / music）永遠可進（回 []）。
 */
export function stageGaps(project: CreativeProject | null | undefined, target: CanvasMode): StageGap[] {
  if (!project) return [];
  const { shots, characters, scenes } = project;

  switch (target) {
    case "shot": {
      // 分鏡確認：需先有分鏡。
      if (shots.length === 0) {
        return [{
          kind: "no-script",
          label: "尚無分鏡",
          detail: "還沒有任何分鏡。先到「腳本意圖」產出或匯入腳本，系統會自動拆出分鏡骨架。",
          backTo: "script",
          backToLabel: `回${CANVAS_LABEL.script}`,
          refs: [],
        }];
      }
      return [];
    }

    case "asset": {
      // 多模態生成：需先有分鏡；且至少一鏡「就緒可生成」（角色定版 + 場景到位）。
      if (shots.length === 0) {
        return [{
          kind: "no-script",
          label: "尚無分鏡",
          detail: "還沒有任何分鏡可生成。先到「腳本意圖」產出或匯入腳本。",
          backTo: "script",
          backToLabel: `回${CANVAS_LABEL.script}`,
          refs: [],
        }];
      }
      const anyReady = shots.some((s) => computeGate(s, characters, scenes).state === "ready");
      if (!anyReady) {
        // 聚合所有鏡的「可解鎖」待補原因（角色未定版 / 場景未鎖），依 refId 去重。
        const seen = new Set<string>();
        const refs: StageGapRef[] = [];
        for (const s of shots) {
          for (const r of computeGate(s, characters, scenes).reasons) {
            if (r.unlockable && !seen.has(r.refId)) {
              seen.add(r.refId);
              refs.push({ id: r.refId, name: r.refName });
            }
          }
        }
        return [{
          kind: "no-ready-shot",
          label: "無就緒可生成鏡",
          detail: "目前沒有任何鏡頭通過確認門。先定版下列角色（上傳參考照）或鎖定場景，再回來生成。",
          backTo: "shot",
          backToLabel: `回${CANVAS_LABEL.shot}修復`,
          refs,
        }];
      }
      return [];
    }

    case "rough-cut": {
      // 打包初剪：需至少一鏡已生成素材，否則時間軸無料可排。
      if (!shots.some(isGenerated)) {
        return [{
          kind: "no-generated",
          label: "尚無已生成素材",
          detail: "時間軸還沒有可排入的素材。先到「多模態素材」生成或匯入至少一個鏡頭。",
          backTo: "asset",
          backToLabel: `回${CANVAS_LABEL.asset}`,
          refs: [],
        }];
      }
      return [];
    }

    case "complete": {
      // 成片交付：需至少一鏡已核准（鐵則：關鍵影格未核准不可交付）。
      if (!shots.some((s) => s.approval === "approved")) {
        return [{
          kind: "no-approved",
          label: "尚無已核准影格",
          detail: "還沒有任何鏡頭通過核准。先到「分鏡確認」核准關鍵影格，再交付成片。",
          backTo: "shot",
          backToLabel: `回${CANVAS_LABEL.shot}核准`,
          refs: [],
        }];
      }
      return [];
    }

    default:
      // chat / script / voice / music：入口或輔助畫布，無前置。
      return [];
  }
}

/**
 * 跳階徽章用「待補 N 項」計數。
 * no-ready-shot 以待補角色/場景數計（N＝列出的可解鎖項）；其餘缺料各計 1 項。
 * 0＝該畫布前置齊備（不顯示徽章）。
 */
export function stageWarnCount(project: CreativeProject | null | undefined, target: CanvasMode): number {
  return stageGaps(project, target).reduce((n, g) => n + Math.max(1, g.refs.length), 0);
}

/** 是否需要在跳轉前彈「補齊精靈」（有任何缺料即需要）。 */
export function needsStageWizard(project: CreativeProject | null | undefined, target: CanvasMode): boolean {
  return stageGaps(project, target).length > 0;
}
