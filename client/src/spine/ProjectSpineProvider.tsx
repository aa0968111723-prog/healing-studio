// ============================================================================
// spine/ProjectSpineProvider.tsx — P1 專案脊椎（把 SpineProvider 的 useCreativeProject 接成真實資料）
// ----------------------------------------------------------------------------
// 【定位】P0 的 SpineProvider 持有「五接縫 adapters + 跨 shell 旗標」，但**刻意不持有**專案
//   隨身脈絡（避免第二套 active-project 狀態）。P1 在 /video 座艙範圍內補上「資料層」：
//
//     active id（誰）  ← useCreativeProject()（= WorldContext，全站唯一選擇來源；不複製）
//     隨身脈絡（內容）← projectGateway.loadProject(id)（真實聚合 / mock 種子）
//     生成/對話/研究  ← 重用 P0 的 useSpine().adapters（generation / commander / contextPacket / storage）
//     寫入回寫        ← projectGateway（vault.update / worldbuilding.update / notes.create …）
//
// 【為什麼仍「包覆，不取代」】真實模式下，「目前是哪個專案」永遠由 WorldContext 決定；本
//   provider 只是把那個 id 的**完整內容**載進可編輯的脊椎狀態，並提供座艙 action。mock 模式
//   下（VIDEO_SPINE_MOCK=ON）才自管一份離線種子（含 active 切換），供無後端開發。
//
// 【樂觀 UI】action 先改本地脊椎（即時回饋、確認門即時重算），再 best-effort 真實回寫；回寫
//   失敗只 toast 告警、不回滾（preparation 階段，欄位由 Code session 收斂）。語意（toast/確認門/
//   先估成本/回退鏈）與模擬一致。
//
// 必須掛在 <SpineProvider>（P0，app root）與 WorldContextProvider（app root）之內 —— 由
// VideoCockpitFrame 在 /video 範圍掛載，故成立且零全域成本。
// ============================================================================
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { toast } from "sonner";
import { useSpine } from "@/providers/SpineProvider";
import { isCostBlockedError } from "@/adapters/genErrorToast";
import { useCreativeProject } from "@/spine/useCreativeProject";
import { VIDEO_SPINE_MOCK, ENABLE_WORLD_STYLE_INJECTION } from "@/config/videoFlags";
import { makeProjectGateway, type ProjectGateway } from "@/spine/projectGateway";
import { compileContextPacket } from "@/spine/contextPacket";
import { applyWorldStyle } from "@/spine/worldStyle";
import { isShotGeneratable } from "@/spine/gate";
import { uid, now, delay, creditsForCost } from "@/spine/spineUtil";
import { DEFAULT_MOCK_PROJECT_ID } from "@/spine/mockProjects";
import type {
  CreativeProject, CreativeProjectSummary, Character, Shot, Scene, Persona, ProviderId,
} from "@/spine/types";
import type { DirectorReply, ScriptBreakdown } from "@/adapters/types";

interface ProjectSpineValue {
  // ── 資料 ──
  mode: "trpc" | "mock";
  loading: boolean;
  error: string | null;
  projects: CreativeProjectSummary[];
  project: CreativeProject | null;
  activeProjectId: string | null;
  setActiveProject: (id: string) => void;
  reload: () => void;
  // ── 跨座艙視圖（persona 由座艙持有；provider 重用 P0 SpineProvider）──
  persona: Persona;
  setPersona: (p: Persona) => void;
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  // ── 生成 ──
  generateShot: (shotId: string, opts?: { regen?: boolean }) => Promise<void>;
  // AIDV-233：明確單片段重試語意（內部與 generateShot(id) 等價；對齊 UI 意圖）。
  retrySingleShot: (shotId: string) => Promise<void>;
  scheduleGeneration: () => Promise<void>;
  // ── 確認門流程 ──
  uploadReference: (charId: string) => Promise<void>;
  changeCharacterSetting: (charId: string) => Promise<void>;
  toggleLock: (charId: string, key: keyof Character["locks"]) => Promise<void>;
  toggleSceneLock: (sceneId: string) => Promise<void>;
  approveShot: (shotId: string) => Promise<void>;
  // ── 資料庫寫入 ──
  addNote: (text: string, shotNo?: string) => Promise<void>;
  addPromptBlock: (label: string, text: string) => Promise<void>;
  // ── Context Packet / 引導式 ──
  rebuildPacket: () => Promise<void>;
  ingestBreakdown: (name: string, b: ScriptBreakdown, opts?: { newProject?: boolean }) => Promise<void>;
  createProject: (name: string, type: CreativeProject["type"]) => Promise<string>;
  // ── I-6 Phase 2b（AIDV-100）：世界連結 ──
  linkWorld: (worldFrameworkId: number | null) => Promise<void>;
  listWorlds: () => Promise<{ id: number; name: string }[]>;
  // ── AIDV-246：封面幀選擇 ──
  setCoverShot: (shotId: string | null) => void;
  // ── 導演 / 拆解（薄包 P0 commander adapter）──
  directorReply: (message: string) => Promise<DirectorReply>;
  breakdownScript: (script: string) => Promise<ScriptBreakdown>;
}

const Ctx = createContext<ProjectSpineValue | null>(null);

export function useProjectSpine(): ProjectSpineValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectSpine 必須在 <ProjectSpineProvider> 之內使用");
  return v;
}

export function ProjectSpineProvider({ children }: { children: ReactNode }) {
  const spine = useSpine(); // P0：adapters + provider 偏好
  const world = useCreativeProject(); // P0 → WorldContext：真實 active id 的唯一來源

  // gateway 只建一次（依旗標選 trpc / mock）。
  const gateway = useMemo<ProjectGateway>(() => makeProjectGateway(VIDEO_SPINE_MOCK), []);

  // mock 模式自管 active id；真實模式委派 WorldContext。
  const [mockActiveId, setMockActiveId] = useState<string>(DEFAULT_MOCK_PROJECT_ID);
  const activeProjectId = VIDEO_SPINE_MOCK
    ? mockActiveId
    : world.activeProjectId != null ? String(world.activeProjectId) : null;

  const [projects, setProjects] = useState<CreativeProjectSummary[]>([]);
  const [project, setProject] = useState<CreativeProject | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>("creative");

  // 用 ref 讓 action 永遠讀到最新 project，又不必把它放進 useCallback 依賴。
  const projRef = useRef<CreativeProject | null>(project);
  projRef.current = project;

  // ── pending 去重（防雙擊/連點把同一寫入動作重複觸發）──
  // 以 ref 同步把關：兩次極快連點時 state 非同步更新來不及擋，ref 立即生效。
  // 同一 key 的動作進行中 → 後續觸發直接忽略（回已解析的 Promise），避免重複扣點/重複寫入。
  const pendingRef = useRef<Set<string>>(new Set());
  const runExclusive = useCallback(async (key: string, fn: () => Promise<void>): Promise<void> => {
    if (pendingRef.current.has(key)) return; // 進行中 → 去重
    pendingRef.current.add(key);
    try {
      await fn();
    } finally {
      pendingRef.current.delete(key);
    }
  }, []);

  // ── 載入專案清單（切換器用）──
  useEffect(() => {
    let alive = true;
    gateway.listProjects().then((ps) => { if (alive) setProjects(ps); }).catch((e) => { console.error("[spine] listProjects 失敗（不阻斷主流程）", e); });
    return () => { alive = false; };
  }, [gateway]);

  // ── 載入作用中專案的隨身脈絡 ──
  const reloadToken = useRef(0);
  const reload = useCallback(() => { reloadToken.current += 1; loadActive(); /* eslint-disable-line */ }, []); // 由下方 effect 定義
  const loadActiveRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    const my = ++reloadToken.current;
    async function run() {
      if (activeProjectId == null) { setProject(null); setError(null); setLoading(false); return; }
      setLoading(true); setError(null);
      try {
        const p = await gateway.loadProject(activeProjectId);
        if (!alive || my !== reloadToken.current) return;
        setProject(p);
        if (!p) setError("找不到專案內容（可能尚未建立隨身脈絡）。");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "載入專案脈絡失敗");
        setProject(null);
      } finally {
        if (alive && my === reloadToken.current) setLoading(false);
      }
    }
    loadActiveRef.current = run;
    run();
    return () => { alive = false; };
  }, [gateway, activeProjectId]);
  function loadActive() { loadActiveRef.current(); }

  const setActiveProject = useCallback((id: string) => {
    if (VIDEO_SPINE_MOCK) { setMockActiveId(id); return; }
    world.setActiveProjectId(Number(id)); // 委派 WorldContext（全站同步）
  }, [world]);

  // ── 本地脊椎不可變更新 helpers（樂觀 UI）──
  const patchProject = useCallback((fn: (p: CreativeProject) => CreativeProject) => {
    setProject((p) => (p ? { ...fn(p), updatedAt: Date.now() } : p));
  }, []);
  const patchShot = useCallback((shotId: string, fn: (sh: Shot) => Shot) => {
    patchProject((p) => ({ ...p, shots: p.shots.map((sh) => (sh.id === shotId ? fn(sh) : sh)) }));
  }, [patchProject]);

  // ── 生成（重用 P0 generation adapter；含回退鏈 + recordGenResult 回寫）──
  const genOne = useCallback(async (shot: Shot, opts: { regen?: boolean } = {}) => {
    const p = projRef.current; if (!p) return;
    const variant = shot.gen.variant; // 同 seed + 同 variant → 同一張影格（一致性）
    patchShot(shot.id, (s) => ({ ...s, stale: false, gen: { ...s.gen, status: "generating" } }));

    try {
      let fellBack = false; // fellBack 只在 success 事件上；GenResult 本身不帶，故由事件流捕捉
      const res = await spine.adapters.generation.generate(
        {
          seed: shot.seed,
          provider: spine.provider,
          kind: shot.route === "text" ? "image" : "keyframe",
          shotNo: shot.no,
          // I-2（AIDV-80）：旗標開時 prepend 世界風格前綴；關（預設）時原樣＝零行為改變。
          prompt: applyWorldStyle(shot.prompt, p.worldStyle, ENABLE_WORLD_STYLE_INJECTION),
          projectId: Number(p.id) || undefined,
        },
        (e) => {
          if (e.type === "estimate") toast(`先估成本：$${e.costUsd.toFixed(3)}`, { description: `${shot.no} ${shot.title}` });
          else if (e.type === "fail") toast.warning(`${e.provider} 生成失敗`, { description: `${e.error.msg}（HTTP ${e.error.http}）` });
          else if (e.type === "fallback") {
            toast(`自動回退引擎：${e.provider} → ${e.next}`, {
              // AIDV-160：白話說明跨到哪個 provider、是否扣點。
              description: e.crossesToPaid ? `改用付費引擎 ${e.next}（會扣點）` : `改用同層引擎 ${e.next}（計費方式不變）`,
            });
          } else if (e.type === "cost-blocked") {
            // AIDV-160：免費引擎不可用，守門不無聲跨付費扣點 → 明確告知、不扣點。
            toast.error("免費引擎暫時無法使用 · 未扣點", { description: e.reason });
          } else if (e.type === "success") fellBack = e.fellBack;
        },
      );

      patchShot(shot.id, (s) => ({
        ...s, gen: { status: "done", provider: res.provider, model: res.model, costUsd: res.costUsd, variant, assetUrl: res.assetUrl },
      }));
      patchProject((pp) => ({
        ...pp,
        assets: [{
          id: uid("a"), kind: shot.route === "text" ? "image" : "keyframe", shotNo: shot.no,
          provider: res.provider, modelId: res.model, sourceStudio: "video-studio",
          costUsd: res.costUsd, seed: shot.seed, ts: now(),
        }, ...pp.assets],
      }));

      // 🔧 回寫資產庫（P0 storage adapter → generate.recordGenResult；失敗不阻斷 UI）。
      try {
        await spine.adapters.storage.recordGenResult({
          projectId: Number(p.id) || undefined, shotNo: shot.no,
          kind: shot.route === "text" ? "image" : "keyframe",
          provider: res.provider, model: res.model, costUsd: res.costUsd, seed: shot.seed, assetUrl: res.assetUrl,
        });
      } catch (e) { console.error("[spine] recordGenResult 回寫失敗（由 Storage seam / 背景修復補償）", e); }

      const cost = creditsForCost(res.costUsd);
      toast.success(`${shot.no} ${opts.regen ? "已重生" : "已生成"}`, {
        description: `${res.model}${fellBack ? `（已回退 ${res.provider}）` : ` · ${res.provider}`} · 約 ${cost} 積分`,
      });
    } catch (err) {
      // AIDV-160：成本守門中止不是硬失敗——友善「免費引擎暫時無法使用 · 未扣點」
      // toast 已於事件處理器顯示。鏡頭未生成也未失敗 → 回 idle（非紅色 error 態），
      // 且**不**再 fire 通用「{shot} 生成失敗」toast，避免雙 toast（恰好一個冷靜 toast）。
      if (isCostBlockedError(err)) {
        patchShot(shot.id, (s) => ({ ...s, gen: { ...s.gen, status: "idle" } }));
        return;
      }
      patchShot(shot.id, (s) => ({ ...s, gen: { ...s.gen, status: "error" } }));
      toast.error(`${shot.no} 生成失敗`, { description: err instanceof Error ? err.message : "全部 provider 皆失敗，請重試或切換 provider" });
    }
  }, [spine, patchShot, patchProject]);

  // 去重鍵以 shotId 區隔：同一鏡生成中再次點擊→忽略（防重複扣點），不同鏡仍可並行觸發。
  const generateShot = useCallback((shotId: string, opts: { regen?: boolean } = {}) =>
    runExclusive(`generate:${shotId}`, async () => {
      const p = projRef.current; if (!p) return;
      const shot = p.shots.find((x) => x.id === shotId); if (!shot) return;
      await genOne(shot, opts);
    }), [genOne, runExclusive]);

  // AIDV-233：單片段重試（error 態 → 重跑同一鏡，使用 generate:shotId 去重防雙擊）。
  const retrySingleShot = useCallback((shotId: string) => generateShot(shotId), [generateShot]);

  const scheduleGeneration = useCallback(() => runExclusive("schedule", async () => {
    const p = projRef.current; if (!p) return;
    const ready = p.shots.filter((sh) => isShotGeneratable(sh, p.characters, p.scenes) && sh.gen.status !== "done");
    if (ready.length === 0) { toast.warning("沒有可排程的鏡頭", { description: "就緒鏡都已生成，或先解鎖待補角色/場景" }); return; }
    toast(`已排程生成`, { description: `${ready.length} 個就緒鏡進入背景佇列` });
    for (const sh of ready) { await genOne(sh); await delay(250); }
    toast.success("批次生成完成", { description: `${ready.length} 鏡已回寫資產庫` });
  }), [genOne, runExclusive]);

  // ── 確認門流程 ──
  const uploadReference = useCallback((charId: string) => runExclusive(`uploadReference:${charId}`, async () => {
    const p = projRef.current; if (!p) return;
    patchProject((pp) => ({
      ...pp,
      characters: pp.characters.map((c) => c.id === charId
        ? { ...c, sourceGrade: "precise", locked: true, refImages: c.refImages + 3,
            loraStatus: c.loraStatus === "未訓練" ? "排隊中" : c.loraStatus,
            locks: { face: true, hair: true, costume: true, accessory: true } }
        : c),
    }));
    const c = p.characters.find((x) => x.id === charId);
    try {
      // 先 await 回寫成功，再報成功（避免「先報成功、回寫卻失敗」的競態）。
      await gateway.saveVaultState({
        projectId: p.id, characterId: charId, sourceGrade: "precise", locked: true,
        locks: { face: true, hair: true, costume: true, accessory: true },
      });
      toast.success("參考圖已上傳 · 角色升級", { description: `${c?.name ?? "角色"} → ✅ 精準、鎖臉啟用，相關鏡頭已解鎖` });
    } catch (e) {
      console.error("[spine] uploadReference saveVaultState 回寫失敗", e);
      toast.warning("參考圖已套用（本地）", { description: "vault.update 回寫稍後重試" });
    }
  }), [gateway, patchProject, runExclusive]);

  const changeCharacterSetting = useCallback(async (charId: string) => {
    const p = projRef.current; if (!p) return;
    const affected = p.shots.filter((sh) => sh.characterIds.includes(charId) && sh.gen.status === "done").length;
    patchProject((pp) => ({
      ...pp,
      shots: pp.shots.map((sh) => (sh.characterIds.includes(charId) && sh.gen.status === "done" ? { ...sh, stale: true } : sh)),
    }));
    const c = p.characters.find((x) => x.id === charId);
    toast.warning(`${c?.name ?? "角色"} 已改設定`, { description: `${affected} 個既有鏡標記為「過期待重生」` });
    // AIDV-162：worldbuilding.update 以連結的世界觀 id 為回寫鍵（未連結則 gateway 跳過）。
    try { await gateway.saveCharacterEdit({ projectId: p.id, characterId: charId, worldFrameworkId: p.worldFrameworkId }); }
    catch (e) { console.error("[spine] changeCharacterSetting 回寫失敗（級聯由後端落實；本地已標 stale）", e); }
  }, [gateway, patchProject]);

  const toggleLock = useCallback(async (charId: string, key: keyof Character["locks"]) => {
    const p = projRef.current; if (!p) return;
    let nextChar: Character | undefined;
    patchProject((pp) => ({
      ...pp,
      characters: pp.characters.map((c) => {
        if (c.id !== charId) return c;
        const locks = { ...c.locks, [key]: !c.locks[key] };
        const allLocked = locks.face && locks.hair && locks.costume && locks.accessory;
        nextChar = { ...c, locks, locked: allLocked, sourceGrade: allLocked && c.sourceGrade !== "unconfirmed" ? "precise" : c.sourceGrade };
        return nextChar;
      }),
    }));
    try {
      if (nextChar) await gateway.saveVaultState({
        projectId: p.id, characterId: charId, sourceGrade: nextChar.sourceGrade, locked: nextChar.locked, locks: nextChar.locks,
      });
    } catch (e) { console.error("[spine] toggleLock 回寫失敗（本地已更新；回寫稍後重試）", e); }
  }, [gateway, patchProject]);

  const approveShot = useCallback((shotId: string) => runExclusive(`approveShot:${shotId}`, async () => {
    const p = projRef.current; if (!p) return;
    patchShot(shotId, (s) => ({ ...s, approval: "approved" }));
    const shot = p.shots.find((x) => x.id === shotId);
    try {
      // approval 走 vault.update payload（無專屬 setApproval）；先 await 回寫成功再報成功。
      await gateway.saveVaultState({ projectId: p.id, characterId: shot?.characterIds[0] ?? shotId });
      toast.success("已核准關鍵影格", { description: "可進入 image-to-video 階段" });
    } catch (e) {
      console.error("[spine] approveShot saveVaultState 回寫失敗", e);
      toast.warning("已核准（本地）· 回寫稍後重試", { description: "vault.update 回寫稍後重試" });
    }
  }), [gateway, patchShot, runExclusive]);

  const toggleSceneLock = useCallback(async (sceneId: string) => {
    const p = projRef.current; if (!p) return;
    let lockedNow = false;
    patchProject((pp) => ({
      ...pp,
      scenes: pp.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        lockedNow = !s.locked;
        return { ...s, locked: lockedNow };
      }),
    }));
    // 場景鎖定走 worldbuilding.update（scenesJson）；本地已更新，回寫 best-effort。
    // AIDV-162：以連結的世界觀 id 為回寫鍵（未連結則 gateway 跳過）。
    try { await gateway.saveCharacterEdit({ projectId: p.id, characterId: sceneId, worldFrameworkId: p.worldFrameworkId }); }
    catch (e) { console.error("[spine] toggleSceneLock 回寫失敗（本地已更新）", e); }
  }, [gateway, patchProject]);

  // ── 資料庫寫入 ──
  const addNote = useCallback((text: string, shotNo?: string) => runExclusive(`addNote:${shotNo ?? "_"}:${text}`, async () => {
    const p = projRef.current; if (!p) return;
    patchProject((pp) => ({ ...pp, notes: [{ id: uid("n"), ts: now(), text, shotNo }, ...pp.notes] }));
    try { await gateway.createNote({ projectId: p.id, text, shotNo }); }
    catch (e) {
      console.error("[spine] addNote createNote 回寫失敗", e);
      toast.warning("筆記已新增（本地）", { description: "notes.create 回寫稍後重試" });
    }
  }), [gateway, patchProject, runExclusive]);

  const addPromptBlock = useCallback((label: string, text: string) => runExclusive(`addPromptBlock:${label}`, async () => {
    const p = projRef.current; if (!p) return;
    patchProject((pp) => ({ ...pp, promptBlocks: [{ id: uid("pb"), label, text, kind: "custom", uses: 0 }, ...pp.promptBlocks] }));
    try {
      // 先 await 回寫成功再報成功（原本先報成功再 await，回寫失敗仍謊報已存）。
      await gateway.createPromptBlock({ projectId: p.id, label, text });
      toast.success("已存入提示詞庫", { description: label });
    } catch (e) {
      console.error("[spine] addPromptBlock createPromptBlock 回寫失敗", e);
      toast.warning("提示詞已加入（本地）", { description: "promptLibrary.create 回寫稍後重試" });
    }
  }), [gateway, patchProject, runExclusive]);

  // ── Context Packet ──
  const rebuildPacket = useCallback(() => runExclusive("rebuildPacket", async () => {
    const p = projRef.current; if (!p) return;
    const packet = await gateway.recompilePacket(p); // 真實 compileProject；失敗回退本地
    patchProject((pp) => ({ ...pp, packet }));
    toast.success("Context Packet 已重建", { description: "Deterministic→Cache→RAG 重新壓縮" });
  }), [gateway, patchProject, runExclusive]);

  // ── 引導式拆解寫入 ──
  const ingestBreakdown = useCallback((name: string, b: ScriptBreakdown, opts: { newProject?: boolean } = {}) => runExclusive(`ingestBreakdown:${name}`, async () => {
    let target = projRef.current;
    if (opts.newProject) {
      const id = await createProjectImpl(name || "引導式新專案", "影片");
      // 等待新專案載入（mock 立即；真實由 WorldContext 切換後 effect 重載）。
      await delay(150);
      target = projRef.current;
      if (!target) target = { ...emptyProject(id, name || "引導式新專案") };
    }
    if (!target) return;
    const characters: Character[] = b.characters.map((nm, i) => ({
      id: uid("c"), name: nm, emoji: ["🧘", "🧙", "⛰", "🧑"][i % 4],
      sourceGrade: "estimate", locked: false,
      locks: { face: false, hair: false, costume: false, accessory: false }, loraStatus: "未訓練", refImages: 0,
    }));
    const scenes: Scene[] = b.scenes.map((nm) => ({ id: uid("s"), name: nm, kind: "exterior", locked: false }));
    let counter = 0;
    const shots: Shot[] = b.acts.flatMap((act, ai) => act.shots.map((sh) => {
      counter++;
      const no = `S${String(counter).padStart(2, "0")}`;
      const charIds = sh.characters.map((cn) => characters.find((c) => c.name === cn)?.id).filter(Boolean) as string[];
      const sceneId = scenes.find((s) => s.name === sh.scene)?.id ?? null;
      return {
        id: uid("sh"), no, act: ai + 1, title: sh.title, route: sh.route, characterIds: charIds, sceneId,
        seed: 1000 + counter * 137, approval: "pending" as const, stale: false, gen: { status: "idle" as const, variant: 0 },
      };
    }));
    setProject((pp) => {
      const base = pp ?? target!;
      const np: CreativeProject = { ...base, name: name || base.name, characters, scenes, shots, stageIndex: 2, updatedAt: Date.now() };
      return { ...np, packet: compileContextPacket(np) };
    });
    // AIDV-162：createFromSegments 需 worldId（連結的世界觀）+ name；未連結則 gateway 跳過回寫。
    try {
      // 先 await 回寫成功再報「拆解完成」（原本先報成功再 await，回寫失敗仍謊報）。
      await gateway.ingestStoryboard({
        projectId: target.id,
        worldFrameworkId: target.worldFrameworkId,
        name: name || target.name,
        characters, scenes, shots,
      });
      toast.success("腳本拆解完成", { description: `${shots.length} 鏡 · ${characters.length} 角色 · ${scenes.length} 場景 已寫入專案` });
    }
    catch (e) {
      console.error("[spine] ingestBreakdown ingestStoryboard 回寫失敗", e);
      toast.warning("分鏡已寫入（本地）", { description: "worldStoryboard.createFromSegments 回寫稍後重試" });
    }
  }), [gateway, runExclusive]);

  async function createProjectImpl(name: string, type: CreativeProject["type"]): Promise<string> {
    const { id } = await gateway.createProject({ name, type });
    const newId = id || uid("p");
    toast.success("已建立專案", { description: `${type === "社群" ? "🖼" : "🎬"} ${name}` });
    setActiveProject(newId);
    if (VIDEO_SPINE_MOCK) setProject(emptyProject(newId, name, type));
    return newId;
  }
  const createProject = useCallback(createProjectImpl, [gateway, setActiveProject]);

  // ── I-6 Phase 2b（AIDV-100）：連結世界觀 framework 到當前專案 ──
  // 樂觀 patch worldFrameworkId（嚮導世界步即時打勾、I-2 風格於下次 reload 帶入），再 best-effort
  // 回寫 creativeProject.link（既有 procedure、零新後端）；回寫失敗只告警、不回滾。
  const linkWorld = useCallback(async (worldFrameworkId: number | null) => {
    const p = projRef.current; if (!p) return;
    patchProject((pp) => ({ ...pp, worldFrameworkId }));
    try {
      await gateway.linkWorld(p.id, worldFrameworkId);
      toast.success(worldFrameworkId == null ? "已解除世界連結" : "已連結世界", {
        description: "後續自動分鏡與生成會帶入該世界的風格與角色一致性",
      });
    } catch (e) {
      console.error("[spine] linkWorld creativeProject.link 回寫失敗", e);
      toast.warning("世界連結已套用（本地）", { description: "creativeProject.link 回寫稍後重試" });
    }
  }, [gateway, patchProject]);
  const listWorlds = useCallback(() => gateway.listWorlds(), [gateway]);

  // ── AIDV-246：封面幀選擇（純本地 patchProject；未來可 best-effort 回寫 creativeProject.update）──
  const setCoverShot = useCallback((shotId: string | null) => {
    patchProject((pp) => ({ ...pp, coverShotId: shotId }));
  }, [patchProject]);

  // ── 導演對話（薄包 P0 commander adapter）──
  const directorReply = useCallback(async (message: string): Promise<DirectorReply> => {
    const p = projRef.current;
    return spine.adapters.commander.directorReply({ persona, message, projectId: p ? Number(p.id) || null : null });
  }, [spine, persona]);

  // 🔧 拆解：P0 commander.breakdownScript（過渡 director.analyzeScriptOverview + generateVideoScript）。
  const breakdownScript = useCallback(async (script: string): Promise<ScriptBreakdown> => {
    const p = projRef.current;
    try {
      return await spine.adapters.commander.breakdownScript(script, p ? Number(p.id) || null : null);
    } catch (err) {
      toast.error("腳本拆解失敗", { description: err instanceof Error ? err.message : "director.breakdown 過渡鏈無回應" });
      throw err;
    }
  }, [spine]);

  const value: ProjectSpineValue = {
    mode: gateway.mode, loading, error, projects, project, activeProjectId, setActiveProject, reload,
    persona, setPersona, provider: spine.provider, setProvider: spine.setProvider,
    generateShot, retrySingleShot, scheduleGeneration,
    uploadReference, changeCharacterSetting, toggleLock, toggleSceneLock, approveShot,
    addNote, addPromptBlock, rebuildPacket, ingestBreakdown, createProject, directorReply, breakdownScript,
    linkWorld, listWorlds, setCoverShot,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── 空專案骨架（建立新專案時的本地佔位）──
function emptyProject(id: string, name: string, type: CreativeProject["type"] = "影片"): CreativeProject {
  return {
    id, name, emoji: type === "社群" ? "🖼" : "🎬", type, logline: "", styleBible: "", stageIndex: 0,
    characters: [], scenes: [], shots: [], notes: [], assets: [], promptBlocks: [],
    packet: { summaryMarkdown: "（尚未建立上下文）", sourceRefs: [], tokenEstimate: 0, ttlSec: 0, permissions: "擁有者可讀寫" },
    updatedAt: Date.now(),
  };
}
