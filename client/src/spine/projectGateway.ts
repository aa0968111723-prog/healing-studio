// ============================================================================
// spine/projectGateway.ts — 專案脊椎資料閘道（P1：把 P0 stub 的 DataStore.getProject 做成真實聚合）
// ----------------------------------------------------------------------------
// 【為什麼要這層】P0 的 adapters/dataStore.trpc.ts `getProject` 只呼 `creativeProject.get`
//   並寬鬆 cast，是「休眠 stub」。真正的「隨身脈絡包」（characters/scenes/shots/notes/assets/
//   packet）需要聚合多個 procedure（adapter 對應表 §5）。P1 把這個聚合補成真實：
//
//     loadProject ← creativeProject.get + worldbuilding.get + worldStoryboard.list
//                   + vault.list + notes.list + contextPacket.getLatest   （全部已驗證存在）
//
// 【為什麼放 spine/ 而非改 P0 adapters】維持「只加不改」：P0 的五接縫一行不動；本閘道是
//   **加法的第六面**，專供 /video 座艙的脊椎讀寫，重用 P0 的 getTrpcClient（同一 vanilla
//   tRPC client，superjson + splitLink + cookie），不另建連線、不重複設定。
//
// 【兩實作、同介面】makeProjectGatewayTrpc（真實，預設）/ makeProjectGatewayMock（離線種子）。
//   由 VIDEO_SPINE_MOCK 旗標在 ProjectSpineProvider 選擇。UI 不分模式。
//
// 【寫入語意】座艙採「樂觀本地 + 真實回寫」：action 先改本地脊椎（即時回饋），再 best-effort
//   呼真實 procedure；回寫失敗只告警、不回滾（preparation 階段，欄位由 Code session 收斂）。
//   每個寫入方法標註對映 procedure 與 GitNexus 校正狀態（🔧 = 已對齊真實 call graph）。
// ============================================================================
import type {
  CreativeProject, CreativeProjectSummary, Character, Scene, Shot, Note, AssetRow,
  PromptBlock, ContextPacket, SourceGrade,
} from "@/spine/types";
import { getTrpcClient } from "@/adapters/trpcClient";
import { compileContextPacket } from "@/spine/contextPacket";
import { MOCK_PROJECTS, DEFAULT_MOCK_PROJECT_ID } from "@/spine/mockProjects";
import { uid, delay } from "@/spine/spineUtil";

// ─── 共用輸入型別 ─────────────────────────────────────────────────────────────

export interface VaultSaveInput {
  projectId: string;
  characterId: string;
  sourceGrade?: SourceGrade;
  locked?: boolean;
  locks?: Character["locks"];
}
export interface CharacterEditInput { projectId: string; characterId: string }
export interface NoteCreateInput { projectId: string; text: string; shotNo?: string }
export interface PromptBlockCreateInput { projectId: string; label: string; text: string }
export interface ProjectCreateInput { name: string; type: CreativeProject["type"] }
export interface StoryboardIngestInput {
  projectId: string;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
}

// ─── 閘道介面 ─────────────────────────────────────────────────────────────────

export interface ProjectGateway {
  /** 資料來源模式（給 UI 標示「機 + 雲」/「mock」）。 */
  readonly mode: "trpc" | "mock";
  /** 專案精簡清單（切換器用）。 */
  listProjects(): Promise<CreativeProjectSummary[]>;
  /** 載入單一專案的完整隨身脈絡（聚合多 procedure；找不到回 null）。 */
  loadProject(projectId: string | number | null): Promise<CreativeProject | null>;
  /** 重編 Context Packet（真實打 compileProject；失敗回退本地重編）。 */
  recompilePacket(project: CreativeProject): Promise<ContextPacket>;
  /** 🔧 vault.update — 角色鎖/grade/approval 回寫。 */
  saveVaultState(input: VaultSaveInput): Promise<void>;
  /** 🔧 worldbuilding.update — 角色改設定（觸發後端 stale 級聯）。 */
  saveCharacterEdit(input: CharacterEditInput): Promise<void>;
  /** notes.create — 新增專案筆記。 */
  createNote(input: NoteCreateInput): Promise<void>;
  /** promptLibrary.create — 新增提示詞積木。 */
  createPromptBlock(input: PromptBlockCreateInput): Promise<void>;
  /** creativeProject.create — 建立新專案。 */
  createProject(input: ProjectCreateInput): Promise<{ id: string }>;
  /** 🔧 worldStoryboard.createFromSegments — 引導式拆解結果批寫分鏡。 */
  ingestStoryboard(input: StoryboardIngestInput): Promise<void>;
}

// ============================================================================
// 真實 tRPC 實作（預設）
// ============================================================================
export function makeProjectGatewayTrpc(): ProjectGateway {
  // 重用 P0 的 vanilla client；tRPC 邊界寬鬆化（procedure 名已驗證；確切 zod 輸入由 Code session 收斂）。
  const client = getTrpcClient() as unknown as any;
  const num = (id: string | number) => (typeof id === "number" ? id : Number(id));

  async function listProjects(): Promise<CreativeProjectSummary[]> {
    const rows = await client.creativeProject.list.query();
    return (Array.isArray(rows) ? rows : rows?.items ?? []).map((r: any): CreativeProjectSummary => ({
      id: String(r.id),
      name: r.name ?? r.title ?? "未命名專案",
      emoji: r.emoji,
      type: r.type,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
    }));
  }

  async function loadProject(projectId: string | number | null): Promise<CreativeProject | null> {
    if (projectId === null || projectId === undefined) return null;
    const id = num(projectId);

    // 並行聚合「隨身脈絡」（adapter 對應表 §5：多 procedure 組 CreativeProjectContext）。
    // 任一子查詢失敗都不讓整頁壞：個別 catch → 空集合，骨幹（creativeProject.get）為必要。
    const [base, world, board, vault, notes, packet] = await Promise.all([
      client.creativeProject.get.query({ id }).catch(() => null),
      client.worldbuilding.get.query({ projectId: id }).catch(() => null),
      client.worldStoryboard.list.query({ projectId: id }).catch(() => null),
      client.vault.list.query({ projectId: id }).catch(() => null),
      client.notes.list.query({ projectId: id }).catch(() => null),
      client.contextPacket.getLatest.query({ projectId: id }).catch(() => null),
    ]);
    if (!base) return null;

    return assembleProject(id, base, world, board, vault, notes, packet);
  }

  async function recompilePacket(project: CreativeProject): Promise<ContextPacket> {
    try {
      // 🔧 contextPacket.compileProject（伺服器 Deterministic→Cache→RAG，為權威）。
      const r = await client.contextPacket.compileProject.mutate({ projectId: num(project.id) });
      return toPacket(r) ?? compileContextPacket(project);
    } catch {
      // 伺服器無回應 → 本地決定性重編（UI 仍即時更新）。
      return compileContextPacket(project);
    }
  }

  async function saveVaultState(input: VaultSaveInput): Promise<void> {
    // 🔧 vault.update（approval/locks/grade 走 payload；vault 僅 CRUD + exportToAssets）。
    await client.vault.update.mutate({
      id: input.characterId,
      projectId: num(input.projectId),
      sourceGrade: input.sourceGrade,
      locked: input.locked,
      locks: input.locks,
    });
  }

  async function saveCharacterEdit(input: CharacterEditInput): Promise<void> {
    // 🔧 worldbuilding.update（改設定 → 後端觸發既有鏡 stale 級聯）。
    await client.worldbuilding.update.mutate({
      projectId: num(input.projectId),
      characterId: input.characterId,
    });
  }

  async function createNote(input: NoteCreateInput): Promise<void> {
    // notes.create（project_notes_calendar）。
    await client.notes.create.mutate({
      projectId: num(input.projectId), text: input.text, shotNo: input.shotNo,
    });
  }

  async function createPromptBlock(input: PromptBlockCreateInput): Promise<void> {
    // promptLibrary.create（prompt_library）。真實 zod 輸入＝{ title, content, category?, … }，
    // 無 projectId / label 欄。原本送 {projectId,label,content} → 必填的 title 缺失，伺服器
    // 端 zod 會退回（且 ProjectSpineProvider 的 optimistic catch 會吞掉錯誤 → 看似存了、實際
    // 沒寫入庫）。改送 title（取面板標籤）+ content；prompt_library 為 user 級（schema 無
    // projectId 欄），故不再傳 projectId。category 由後端預設 "general"。
    await client.promptLibrary.create.mutate({
      title: input.label, content: input.text,
    });
  }

  async function createProject(input: ProjectCreateInput): Promise<{ id: string }> {
    // creativeProject.create。
    const r = await client.creativeProject.create.mutate({ name: input.name, type: input.type });
    return { id: String(r?.id ?? r?.projectId ?? "") };
  }

  async function ingestStoryboard(input: StoryboardIngestInput): Promise<void> {
    // 🔧 worldStoryboard.createFromSegments（依 director.breakdown 過渡結果批寫分鏡）。
    await client.worldStoryboard.createFromSegments.mutate({
      projectId: num(input.projectId),
      segments: input.shots.map((sh) => ({
        shotNumber: sh.no, act: sh.act, title: sh.title, route: sh.route,
        characterIds: sh.characterIds, sceneId: sh.sceneId, seed: sh.seed,
      })),
      characters: input.characters.map((c) => ({ name: c.name, sourceGrade: c.sourceGrade })),
      scenes: input.scenes.map((s) => ({ name: s.name, kind: s.kind })),
    });
  }

  return {
    mode: "trpc",
    listProjects, loadProject, recompilePacket,
    saveVaultState, saveCharacterEdit, createNote, createPromptBlock, createProject, ingestStoryboard,
  };
}

// ─── 真實回傳 → 脊椎型別的防禦式映射（欄位名以 GitNexus 盤點為基礎，Code session 最終核對）──

function toPacket(r: any): ContextPacket | null {
  if (!r) return null;
  return {
    summaryMarkdown: String(r.summaryMarkdown ?? r.summary ?? ""),
    sourceRefs: (r.sourceRefs ?? []).map((s: any) => ({
      ref: String(s.ref ?? s.id ?? ""), kind: String(s.kind ?? ""), fresh: Boolean(s.fresh ?? true),
    })),
    tokenEstimate: Number(r.tokenEstimate ?? r.tokens ?? 0),
    ttlSec: Number(r.ttlSec ?? 0),
    permissions: String(r.permissions ?? "擁有者可讀寫"),
  };
}

function assembleProject(
  id: number, base: any, world: any, board: any, vault: any, notes: any, packet: any,
): CreativeProject {
  const vaultRows: any[] = Array.isArray(vault) ? vault : vault?.items ?? [];
  const wbChars: any[] = world?.characters ?? world?.charactersJson ?? [];
  const wbScenes: any[] = world?.scenes ?? world?.scenesJson ?? [];
  const boardRows: any[] = Array.isArray(board) ? board : board?.items ?? board?.shots ?? [];
  const noteRows: any[] = Array.isArray(notes) ? notes : notes?.items ?? [];

  // 角色：worldbuilding 提供身份，vault 提供鎖/grade（以 vault 為定版權威）。
  const characters: Character[] = wbChars.map((c: any): Character => {
    const v = vaultRows.find((x) => String(x.characterId ?? x.id) === String(c.id)) ?? {};
    const locks = v.locks ?? c.locks ?? { face: false, hair: false, costume: false, accessory: false };
    return {
      id: String(c.id ?? uid("c")),
      name: String(c.name ?? "角色"),
      emoji: String(c.emoji ?? "🧑"),
      sourceGrade: (v.sourceGrade ?? c.sourceGrade ?? "estimate") as SourceGrade,
      locked: Boolean(v.locked ?? c.locked ?? false),
      locks: { face: !!locks.face, hair: !!locks.hair, costume: !!locks.costume, accessory: !!locks.accessory },
      loraStatus: (c.loraStatus ?? "未訓練") as Character["loraStatus"],
      refImages: Number(c.refImages ?? v.refImages ?? 0),
    };
  });

  const scenes: Scene[] = wbScenes.map((s: any): Scene => ({
    id: String(s.id ?? uid("s")),
    name: String(s.name ?? "場景"),
    kind: (s.kind ?? "exterior") as Scene["kind"],
    locked: Boolean(s.locked ?? false),
  }));

  const shots: Shot[] = boardRows.map((sh: any, i: number): Shot => ({
    id: String(sh.id ?? uid("sh")),
    no: String(sh.shotNumber ?? sh.no ?? `S${String(i + 1).padStart(2, "0")}`),
    act: Number(sh.act ?? 1),
    title: String(sh.title ?? ""),
    route: (sh.route === "ref" ? "ref" : "text") as Shot["route"],
    characterIds: (sh.characterIds ?? sh.characters ?? []).map((x: any) => String(x)),
    sceneId: sh.sceneId != null ? String(sh.sceneId) : null,
    seed: Number(sh.seed ?? 1000 + i * 137),
    approval: (sh.approval === "approved" ? "approved" : "pending") as Shot["approval"],
    stale: Boolean(sh.stale ?? false),
    gen: {
      status: (sh.gen?.status ?? (sh.assetUrl ? "done" : "idle")) as Shot["gen"]["status"],
      provider: sh.gen?.provider, model: sh.gen?.model, costUsd: sh.gen?.costUsd,
      variant: Number(sh.gen?.variant ?? 0),
    },
    prompt: sh.prompt,
  }));

  const noteList: Note[] = noteRows.map((n: any): Note => ({
    id: String(n.id ?? uid("n")),
    ts: String(n.ts ?? n.createdAt ?? ""),
    text: String(n.text ?? n.body ?? ""),
    shotNo: n.shotNo,
  }));

  const assets: AssetRow[] = (base.assets ?? []).map((a: any): AssetRow => ({
    id: String(a.id ?? uid("a")),
    kind: (a.kind ?? "image") as AssetRow["kind"],
    shotNo: a.shotNo,
    provider: (a.provider ?? "hf") as AssetRow["provider"],
    modelId: String(a.modelId ?? a.model ?? ""),
    sourceStudio: String(a.sourceStudio ?? "video-studio"),
    costUsd: Number(a.costUsd ?? 0),
    seed: a.seed,
    ts: String(a.ts ?? a.createdAt ?? ""),
  }));

  const promptBlocks: PromptBlock[] = (base.promptBlocks ?? []).map((pb: any): PromptBlock => ({
    id: String(pb.id ?? uid("pb")),
    label: String(pb.label ?? ""),
    text: String(pb.text ?? pb.content ?? ""),
    kind: (pb.kind === "custom" ? "custom" : "combo") as PromptBlock["kind"],
    uses: Number(pb.uses ?? 0),
  }));

  const assembled: CreativeProject = {
    id: String(base.id ?? id),
    name: String(base.name ?? base.title ?? "未命名專案"),
    emoji: String(base.emoji ?? "🎬"),
    type: (base.type ?? "影片") as CreativeProject["type"],
    logline: String(base.logline ?? ""),
    styleBible: String(base.styleBible ?? ""),
    stageIndex: Number(base.stageIndex ?? 0),
    characters, scenes, shots, notes: noteList, assets, promptBlocks,
    packet: toPacket(packet) ?? { summaryMarkdown: "", sourceRefs: [], tokenEstimate: 0, ttlSec: 0, permissions: "擁有者可讀寫" },
    updatedAt: base.updatedAt ? new Date(base.updatedAt).getTime() : Date.now(),
  };
  // 伺服器尚無 packet → 本地即時編一份，避免左欄空白。
  if (!assembled.packet.summaryMarkdown) assembled.packet = compileContextPacket(assembled);
  return assembled;
}

// ============================================================================
// Mock 實作（離線種子；VIDEO_SPINE_MOCK=ON）
// ============================================================================
export function makeProjectGatewayMock(): ProjectGateway {
  // 深拷貝種子，避免跨 session 汙染。
  const store: CreativeProject[] = structuredClone(MOCK_PROJECTS);
  const find = (id: string | number | null) =>
    store.find((p) => String(p.id) === String(id ?? DEFAULT_MOCK_PROJECT_ID)) ?? store[0] ?? null;

  return {
    mode: "mock",
    async listProjects() {
      await delay(80);
      return store.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, type: p.type, updatedAt: p.updatedAt }));
    },
    async loadProject(id) {
      await delay(120);
      const p = find(id);
      return p ? structuredClone(p) : null;
    },
    async recompilePacket(project) { await delay(80); return compileContextPacket(project); },
    // mock 寫入＝no-op（座艙的本地樂觀狀態已是唯一真實；種子不需回寫）。
    async saveVaultState() { await delay(40); },
    async saveCharacterEdit() { await delay(40); },
    async createNote() { await delay(40); },
    async createPromptBlock() { await delay(40); },
    async createProject(input) { await delay(60); return { id: uid("p") }; },
    async ingestStoryboard() { await delay(60); },
  };
}

/** 依旗標選擇閘道實作。 */
export function makeProjectGateway(mock: boolean): ProjectGateway {
  return mock ? makeProjectGatewayMock() : makeProjectGatewayTrpc();
}
