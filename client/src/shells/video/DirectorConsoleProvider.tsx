// ============================================================================
// shells/video/DirectorConsoleProvider.tsx — Wave 0 導演台「介面狀態」脊椎
// ----------------------------------------------------------------------------
// 【定位】ProjectSpineProvider 持有「資料 + 動作」（專案/分鏡/確認門/生成/回寫）。本 provider
//   只持有導演台的**介面導航狀態**：哪一鏡在焦點（S0X 導航主軸）、中欄畫布模式、抽屜開關、
//   側欄顯隱、自動存草稿、可設定工作流步驟、光球 Ambient Copilot 四態（由資料計算）。
//   兩者分離：資料層可單獨測試；介面層純前端、零後端、零金鑰。
//
// 必須掛在 <ProjectSpineProvider> 之內（由 VideoCockpit 在導演台範圍掛載）。
//
// 【S0X deep-link】readiness chip / 確認門待補原因 → deepLinkToShot/deepLinkToReason：
//   把焦點移到該鏡、切中欄到「分鏡修復」畫布，使「點了 chip 就到修復點」成立。
//
// 【工作流持久化＝後端待補】步驟自訂（user_workflows / workflow_steps）尚未落地，Wave 0
//   先以本地狀態頂住；切換專案不重置（per session）。見 console/workflowSteps.ts。
// ============================================================================
import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from "react";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { countGate } from "@/spine/gate";
import { freshDefaultWorkflow, type WorkflowStep } from "./console/workflowSteps";
import type { Shot } from "@/spine/types";

/** 中欄「創作畫布」模式（對映子系統）。 */
export type CanvasMode =
  | "chat" // 導演對話（CO-STAR × RAG，已移除人格預設）
  | "script" // 2-1 腳本意圖（director.*）
  | "shot" // 2-3 分鏡 GATE / ShotCard（聚焦單鏡修復）
  | "asset" // 2-3 多模態素材生成（generation seam → fal）
  | "voice" // 2-5 配音 / 環境音（proStudio.qwenTTS / elevenLabsTTS / soundEffects）
  | "music"; // 2-6 配樂（proStudio.textToMusic）

/** 抽屜（split-view / drawer 疊層，不整頁離場）。 */
export type DrawerId =
  | "workflow" // 2-17 工作流設定（WorkflowBuilder；W1-7 修正：原誤標 2-16=客製化設定）
  | "flowtv" // 2-12 Flow 電視牆 / 提示詞庫（promptLibrary.*）
  | "playground" // 2-13 單模型遊樂場（aiModels.list）
  | "research" // I-5 真實地球研究面板（realEarth.* 唯讀查詢；AIDV-83）
  | "prompts" // I-8 提示詞跨庫組合（promptLibrary/Collection 唯讀；AIDV-86）
  | "agents" // I-1 光球精靈能力＋成本目錄（spirit.listModels / estimateSegmentCost 唯讀；AIDV-79）
  | "settings"; // 2-18 影片系統設定

/** 光球 Ambient Copilot 四態（移除人格預設）。 */
export type OrbLevel = "silent" | "hint" | "collab" | "critical";

export interface OrbBubble {
  emoji: string;
  title: string;
  text: string;
  cta?: string;
  /** 點 CTA 的動作（deep-link / 開抽屜 / 切畫布）。 */
  onCta?: () => void;
}

export interface OrbState {
  level: OrbLevel;
  /** 主動泡泡（hint / critical 時有；silent / collab 為 null）。 */
  bubble: OrbBubble | null;
}

export type EngineModality =
  | "text-to-image"
  | "text-to-video"
  | "text-to-audio"
  | "text-to-speech";

interface DirectorConsoleValue {
  // ── S0X 導航主軸 ──
  focusShotId: string | null;
  focusShot: Shot | null;
  setFocusShot: (id: string | null) => void;
  // ── 中欄畫布 ──
  canvasMode: CanvasMode;
  setCanvasMode: (m: CanvasMode) => void;
  // ── 抽屜（疊層）──
  drawer: DrawerId | null;
  openDrawer: (d: DrawerId | null) => void;
  // ── 側欄顯隱 / 自動存草稿（2-18）──
  showSidecar: boolean;
  setShowSidecar: (b: boolean) => void;
  autoSaveDraft: boolean;
  setAutoSaveDraft: (b: boolean) => void;
  // ── per-引擎偏好備忘（2-16，型別約束 key 避免錯字產生死條目；後端接線待補 G10）──
  enginePrefs: Partial<Record<EngineModality, string>>;
  setEnginePref: (modality: EngineModality, modelId: string | null) => void;
  // ── 可設定工作流（2-17，後端待補=G10/W2-E → 本地狀態）──
  steps: WorkflowStep[];
  setSteps: (s: WorkflowStep[]) => void;
  // ── deep-link 到修復點（chip → 聚焦該鏡的「分鏡」畫布，內含待補原因 + 就地修復）──
  deepLinkToShot: (shotId: string) => void;
  // ── 光球 ──
  orb: OrbState;
  orbOpen: boolean;
  setOrbOpen: (b: boolean) => void;
  dismissBubble: () => void;
}

const Ctx = createContext<DirectorConsoleValue | null>(null);

export function useDirectorConsole(): DirectorConsoleValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDirectorConsole 必須在 <DirectorConsoleProvider> 之內使用");
  return v;
}

export function DirectorConsoleProvider({ children }: { children: ReactNode }) {
  const spine = useProjectSpine();
  const project = spine.project;

  const [focusShotId, setFocusShotId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("chat");
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [showSidecar, setShowSidecar] = useState(true);
  const [autoSaveDraft, setAutoSaveDraft] = useState(false);
  const [enginePrefs, setEnginePrefs] = useState<Partial<Record<EngineModality, string>>>({});
  const [steps, setSteps] = useState<WorkflowStep[]>(() => freshDefaultWorkflow());

  // per-引擎偏好備忘：傳 null 清除回「用系統預設」。
  const setEnginePref = useCallback((modality: EngineModality, modelId: string | null) => {
    setEnginePrefs((prev) => {
      const next = { ...prev };
      if (!modelId) delete next[modality];
      else next[modality] = modelId;
      return next;
    });
  }, []);
  const [orbOpen, setOrbOpen] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState(false);

  // 焦點鏡解析（focusShotId 可能指向已刪除的鏡 → 回 null）。
  const focusShot = useMemo<Shot | null>(
    () => (project && focusShotId ? project.shots.find((s) => s.id === focusShotId) ?? null : null),
    [project, focusShotId],
  );

  const setFocusShot = useCallback((id: string | null) => setFocusShotId(id), []);

  const deepLinkToShot = useCallback((shotId: string) => {
    setFocusShotId(shotId);
    setCanvasMode("shot");
  }, []);

  // ── 光球四態：由資料計算（gate / 就緒鏡 / 過期 / 錯誤）──
  const orb = useMemo<OrbState>(() => {
    if (orbOpen) return { level: "collab", bubble: null };
    if (!project) return { level: "silent", bubble: null };

    const gate = countGate(project.shots, project.characters, project.scenes);
    const errored = project.shots.some((s) => s.gen.status === "error");

    // critical：有全待補角色／生成錯誤 → 紅色關鍵態 + deep-link 到修復點。
    if (gate.blocked > 0 || errored) {
      if (bubbleDismissed) return { level: "critical", bubble: null };
      const firstBlocked = project.shots.find(
        (s) => countGate([s], project.characters, project.scenes).blocked > 0,
      );
      return {
        level: "critical",
        bubble: {
          emoji: "🛡",
          title: "守守 · 確認門擋下",
          text: errored
            ? "有鏡頭生成失敗，且部分角色尚未定版。先修復再量產。"
            : `有 ${gate.blocked} 鏡因角色未定版被擋下 — 先補精準參考再生成。`,
          cta: "去修復",
          onCta: firstBlocked ? () => deepLinkToShot(firstBlocked.id) : undefined,
        },
      };
    }

    // hint：有就緒未生成鏡 / 過期待重生 → 暖色提示態。
    const ready = gate.ready;
    const generated = project.shots.filter((s) => s.gen.status === "done").length;
    if (!bubbleDismissed && ready > 0 && generated < project.shots.length) {
      return {
        level: "hint",
        bubble: {
          emoji: "✨",
          title: "守守 · 可以開工了",
          text: `有 ${ready} 個就緒鏡可生成。媒體生成前我會先估成本、失敗全額退還。`,
          cta: "看就緒鏡",
          onCta: () => setCanvasMode("shot"),
        },
      };
    }
    if (!bubbleDismissed && gate.stale > 0) {
      return {
        level: "hint",
        bubble: {
          emoji: "🔁",
          title: "守守 · 有過期鏡",
          text: `${gate.stale} 鏡因角色改設定而過期，需同 seed 重生以維持一致性。`,
        },
      };
    }

    return { level: "silent", bubble: null };
  }, [orbOpen, project, bubbleDismissed, deepLinkToShot]);

  const dismissBubble = useCallback(() => setBubbleDismissed(true), []);

  const value: DirectorConsoleValue = {
    focusShotId, focusShot, setFocusShot,
    canvasMode, setCanvasMode,
    drawer, openDrawer: setDrawer,
    showSidecar, setShowSidecar,
    autoSaveDraft, setAutoSaveDraft,
    enginePrefs, setEnginePref,
    steps, setSteps,
    deepLinkToShot,
    orb, orbOpen, setOrbOpen, dismissBubble,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
