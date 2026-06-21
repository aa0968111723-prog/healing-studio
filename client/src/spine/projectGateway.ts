// ============================================================================
// spine/projectGateway.ts — 專案脊椎資料閘道（P1：把 P0 stub 的 DataStore.getProject 做成真實聚合）
// ----------------------------------------------------------------------------
// 【為什麼要這層】P0 的 adapters/dataStore.trpc.ts `getProject` 只呼 `creativeProject.get`
//   並寬鬆 cast，是「休眠 stub」。真正的「隨身脈絡包」（characters/scenes/shots/notes/assets/
//   packet）需要聚合多個 procedure（adapter 對應表 §5）。P1 把這個聚合補成真實：
//
//     loadProject ← creativeProject.get + worldbuilding.get + worldStoryboard.listByWorld
//                   + vault.list + notes.list + contextPacket.getLatest   （全部已驗證存在）
//   （分鏡用 listByWorld({ worldId }) 依當前專案世界觀過濾，不用會回 user 全部分鏡的 list — AIDV-161）
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
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type {
  CreativeProject, CreativeProjectSummary, Character, Scene, Shot, Note, AssetRow,
  PromptBlock, ContextPacket, SourceGrade,
} from "@/spine/types";
import { getTrpcClient } from "@/adapters/trpcClient";
import { compileContextPacket } from "@/spine/contextPacket";
import { buildWorldStylePrefix } from "@/spine/worldStyle";
import { MOCK_PROJECTS, DEFAULT_MOCK_PROJECT_ID } from "@/spine/mockProjects";
import { uid, delay } from "@/spine/spineUtil";

// ─── 具名 tRPC 輸入型別（AIDV-162：取代 as any，tsc 抓形狀不符）──────────────────
// inferRouterInputs<AppRouter> 是型別來源地（server/routers 的 AppRouter）的權威推導；
// 各方法送出的物件以這些 alias 標註，編譯期即驗證對齊真實 procedure 的 zod input。
type RouterInputs = inferRouterInputs<AppRouter>;
type VaultUpdateInput = RouterInputs["vault"]["update"];
type WorldbuildingUpdateInput = RouterInputs["worldbuilding"]["update"];
type WorldbuildingGetInput = RouterInputs["worldbuilding"]["get"];
type CompileProjectInput = RouterInputs["contextPacket"]["compileProject"];
type CreateFromSegmentsInput = RouterInputs["worldStoryboard"]["createFromSegments"];

/** compileProject 的 mode（COMPILE_MODES）——導演台重編預設用 "director"。 */
type CompileMode = CompileProjectInput["mode"];

// ─── 共用輸入型別 ─────────────────────────────────────────────────────────────

export interface VaultSaveInput {
  projectId: string;
  characterId: string;
  /** 對映的保險庫項目數值 id（vault.update 需 z.number()）；無時跳過回寫（best-effort）。 */
  vaultItemId?: number | null;
  sourceGrade?: SourceGrade;
  locked?: boolean;
  locks?: Character["locks"];
}
export interface CharacterEditInput {
  projectId: string;
  characterId: string;
  /** 連結的世界觀 framework id（worldbuilding.update 需 id）；無時跳過回寫（best-effort）。 */
  worldFrameworkId?: number | null;
}
export interface NoteCreateInput { projectId: string; text: string; shotNo?: string }
export interface PromptBlockCreateInput { projectId: string; label: string; text: string }
export interface ProjectCreateInput { name: string; type: CreativeProject["type"] }
export interface StoryboardIngestInput {
  projectId: string;
  /** 寫入目標世界觀 framework id（createFromSegments 需 worldId）；無時跳過回寫（best-effort）。 */
  worldFrameworkId?: number | null;
  /** 分鏡集名稱（createFromSegments 需 name）；無時以專案/預設名生成。 */
  name?: string;
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
  /** creativeProject.link — 連結（或傳 null 解綁）世界觀 framework 到專案（I-6 Phase 2b / AIDV-100）。 */
  linkWorld(projectId: string, worldFrameworkId: number | null): Promise<void>;
  /** worldbuilding.list — 使用者的世界清單（給嚮導世界選單）。 */
  listWorlds(): Promise<{ id: number; name: string }[]>;
}

// ============================================================================
// 真實 tRPC 實作（預設）
// ============================================================================
export function makeProjectGatewayTrpc(): ProjectGateway {
  // 【AIDV-162 完成 typed 化】typed＝createTRPCClient<AppRouter>，tsc 可抓 input/output 不符。
  // 不再有 `as unknown as any` 旁路——全部讀寫方法都走 typed，送出形狀對齊真實 procedure
  // 的 zod input（vault.update / worldbuilding.update / worldStoryboard.createFromSegments /
  // worldbuilding.get / contextPacket.compileProject）。tsc 綠＝形狀對。
  const typed = getTrpcClient();
  const num = (id: string | number) => (typeof id === "number" ? id : Number(id));
  /** 解析 id 為有限數值（vault/world id 須 z.number）；非數值（uid 後援）回 null → 跳過回寫。 */
  const numOrNull = (id: string | number | null | undefined): number | null => {
    if (id === null || id === undefined) return null;
    const n = typeof id === "number" ? id : Number(id);
    return Number.isFinite(n) ? n : null;
  };

  async function listProjects(): Promise<CreativeProjectSummary[]> {
    // ✅ typed：creativeProject.list 的列＝rowToData 投影（title 為名稱欄；無 emoji/type 欄，
    // type 暫不從 metadata 推導——spine 的 type 是中文枚舉，待 G10 era 對齊）。
    const rows = await typed.creativeProject.list.query();
    return rows.map((r): CreativeProjectSummary => ({
      id: String(r.id),
      name: r.title || "未命名專案",
      updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
    }));
  }

  async function loadProject(projectId: string | number | null): Promise<CreativeProject | null> {
    if (projectId === null || projectId === undefined) return null;
    const id = num(projectId);

    // 【AIDV-161 跨專案資料混入修補】骨幹 creativeProject.get 必須**先**取得，因為分鏡要依
    // 「當前專案連結的世界觀」過濾——base.worldFrameworkId 是過濾鍵。先 await base、再並行其餘。
    // 任一子查詢失敗都不讓整頁壞：個別 catch → null；骨幹缺失（base 取不到）才整體回 null。
    const base = await typed.creativeProject.get.query({ id }).catch(() => null);
    if (!base) return null;

    // 分鏡改用 ownership-scoped 的 worldStoryboard.listByWorld({ worldId })，取代會回「該使用者
    // 全部分鏡」、忽略輸入的 worldStoryboard.list（server: list 不吃 projectId，回 user 全部）。
    // 未連結世界觀（worldFrameworkId 為 null）的專案＝無分鏡來源，直接跳過查詢（避免誤載別專案）。
    // （AIDV-161 修正：本卡保留 ownership-scoped listByWorld，不回歸。）
    const worldId = numOrNull(base.worldFrameworkId);

    // 並行聚合「隨身脈絡」其餘面向（adapter 對應表 §5：多 procedure 組 CreativeProjectContext）。
    // 【AIDV-162 typed 對齊】
    //  - worldbuilding.get 真實輸入＝{ id }（世界觀 id，非 projectId）；用 worldId 取，
    //    未連結世界觀則跳過（原本送 { projectId: id } 永遠收 undefined → 回 null）。
    //  - vault.list / notes.list 真實輸入皆**不含 projectId**（user 級；只吃過濾欄，均可選），
    //    原本送 { projectId: id } 是 any-cast 藏掉的形狀錯；改為不帶輸入。
    //  - contextPacket.getLatest 真實輸入＝{ projectId }（已正確，保留）。
    const [world, board, vault, notes, packet] = await Promise.all([
      worldId != null
        ? typed.worldbuilding.get.query({ id: worldId } satisfies WorldbuildingGetInput).catch(() => null)
        : Promise.resolve(null),
      worldId != null
        ? typed.worldStoryboard.listByWorld.query({ worldId }).catch(() => null)
        : Promise.resolve(null),
      typed.vault.list.query().catch(() => null),
      typed.notes.list.query().catch(() => null),
      typed.contextPacket.getLatest.query({ projectId: id }).catch(() => null),
    ]);

    return assembleProject(id, base, world, board, vault, notes, packet);
  }

  async function recompilePacket(project: CreativeProject): Promise<ContextPacket> {
    try {
      // 🔧 contextPacket.compileProject。真實 zod 輸入＝{ projectId, mode（必填）, query?, forceRefresh? }。
      // 原本只送 { projectId } → 缺必填 mode；any-cast 旁路 zod，後端走空、永遠回退本地卻謊報成功。
      // 導演台重編走 "director" 模式（COMPILE_MODES 之一，對齊 orchestration mode）。
      const input: CompileProjectInput = {
        projectId: num(project.id),
        mode: "director" satisfies CompileMode,
      };
      const r = await typed.contextPacket.compileProject.mutate(input);
      return toPacket(r) ?? compileContextPacket(project);
    } catch (e) {
      // 伺服器無回應 → 本地決定性重編（UI 仍即時更新）；留痕以利診斷（不改回退控制流）。
      console.error("[spine] recompilePacket compileProject 失敗，回退本地重編", e);
      return compileContextPacket(project);
    }
  }

  async function saveVaultState(input: VaultSaveInput): Promise<void> {
    // 🔧 vault.update。真實 zod 輸入＝{ id: z.number(), name?, tags?, imageUrl?,
    // metadata?: z.record(string, unknown) }——**無 projectId / sourceGrade / locked / locks 頂層欄**。
    // 原本送那 4 個未定義欄＋字串 id，是 any-cast 藏掉的形狀錯。對齊：鎖/grade/approval 屬
    // 角色定版狀態，落 metadata（保險庫項目的自由欄位）；id 須為保險庫項目數值 id。
    // vaultItemId 為對映的保險庫項目 id；無（uid 後援/尚未建項）→ 跳過回寫（best-effort，UI 已樂觀更新）。
    const id = numOrNull(input.vaultItemId ?? input.characterId);
    if (id == null) return;
    const metadata: Record<string, unknown> = {};
    if (input.sourceGrade !== undefined) metadata.sourceGrade = input.sourceGrade;
    if (input.locked !== undefined) metadata.locked = input.locked;
    if (input.locks !== undefined) metadata.locks = input.locks;
    const payload: VaultUpdateInput = { id, metadata };
    await typed.vault.update.mutate(payload);
  }

  async function saveCharacterEdit(input: CharacterEditInput): Promise<void> {
    // 🔧 worldbuilding.update。真實 zod 輸入＝{ id: 世界觀 id, patch: frameworkInput.partial() }
    // ——編輯整個世界觀 framework，**非單個角色**；無 projectId / characterId 頂層欄。
    // 原本送 { projectId, characterId } 是 any-cast 藏掉的形狀錯。對齊：以連結的世界觀 id 觸發
    // 後端的「世界觀變更 → 既有鏡 stale 級聯」（座艙的真實邊由 Provider 注入 worldFrameworkId）；
    // 此處不夾帶角色 diff（過渡），送空 patch（全欄 optional，後端做存在權限檢查 + no-op 更新）。
    // 未連結世界觀 → 無回寫目標，跳過（best-effort，UI 已本地標 stale）。
    const id = numOrNull(input.worldFrameworkId);
    if (id == null) return;
    const payload: WorldbuildingUpdateInput = { id, patch: {} };
    await typed.worldbuilding.update.mutate(payload);
  }

  async function createNote(input: NoteCreateInput): Promise<void> {
    // ✅ typed（W1-7）：notes.create 真實 zod 輸入＝{ title 必填, content?, noteType, status,
    // tags?, … }，**無 projectId / text / shotNo 欄**。原本送 {projectId,text,shotNo} →
    // 必填的 title 缺失被 zod 退回（且 Provider 的 optimistic catch 吞錯 → 導演台「新增筆記」
    // 看似成功、實際從未寫入庫——promptLibrary.create 同款蟲，typed 化抓出）。
    // 改：text 截前 80 字當 title（shotNo 作前綴）、全文進 content；notes 為 user 級
    //（project_notes_calendar 以 userId 掛載），projectId 關聯待 M2 era 補欄。
    const title =
      ((input.shotNo ? `[${input.shotNo}] ` : "") + input.text.trim()).slice(0, 80) ||
      "導演台筆記";
    await typed.notes.create.mutate({
      title,
      content: input.text,
      noteType: "note",
      tags: ["導演台"],
    });
  }

  async function createPromptBlock(input: PromptBlockCreateInput): Promise<void> {
    // ✅ typed（W1-7）：promptLibrary.create 真實 zod 輸入＝{ title, content, category?, … }，
    // 無 projectId / label 欄。原本送 {projectId,label,content} → 必填的 title 缺失，伺服器
    // 端 zod 會退回（且 ProjectSpineProvider 的 optimistic catch 會吞掉錯誤 → 看似存了、實際
    // 沒寫入庫）。改送 title（取面板標籤）+ content；prompt_library 為 user 級（schema 無
    // projectId 欄），故不再傳 projectId。category 由後端預設 "general"。
    await typed.promptLibrary.create.mutate({
      title: input.label || "未命名提示詞",
      content: input.text,
    });
  }

  async function createProject(input: ProjectCreateInput): Promise<{ id: string }> {
    // ✅ typed（W1-7）：creativeProject.create 真實 zod 輸入＝{ title 必填, status?, metadata?, … }，
    // 無 name/type 欄。原本送 {name,type} → 必填的 title 缺失，伺服器端 zod 會退回（同
    // promptLibrary.create 前例）。改送 title；type（"影片"/"社群"/"混合"）正規化後落
    // metadata.type（creative_projects 無 type 欄，待後端升格；與 rowToProject 讀同一個 key）。
    const metaType = input.type === "影片" ? "video" : "other";
    const r = await typed.creativeProject.create.mutate({
      title: input.name,
      metadata: { type: metaType, spineType: input.type },
    });
    return { id: String(r.id) };
  }

  async function ingestStoryboard(input: StoryboardIngestInput): Promise<void> {
    // 🔧 worldStoryboard.createFromSegments。真實 zod 輸入＝{ worldId（必填，非 projectId）,
    // name（必填）, segments: [{ rawText?, storyboard:{sceneHeading,visualDescription,dialogue,
    // soundDesign,cameraDirection,duration,mood}, characters: string[], locations: string[] }],
    // aspectRatio?, fps?, sourceScriptId? }。原本送 { projectId, segments:[Shot 形狀], characters,
    // scenes } 全不符——any-cast 藏掉的形狀錯。對齊：
    //  - worldId 取自連結的世界觀（無 → 跳過回寫，best-effort；UI 已本地寫入分鏡）。
    //  - 每個 Shot → 一個 segment：把 Shot 欄位投到 storyboard 子物件；characterIds/sceneId
    //    解析為**名稱字串陣列**（server 以名稱比對 framework.characters / locations）。
    if (input.shots.length === 0) return;
    const worldId = numOrNull(input.worldFrameworkId);
    if (worldId == null) return;

    const charNameById = new Map(input.characters.map((c) => [c.id, c.name]));
    const sceneNameById = new Map(input.scenes.map((s) => [s.id, s.name]));

    const segments: CreateFromSegmentsInput["segments"] = input.shots.map((sh) => {
      const characters = sh.characterIds
        .map((cid) => charNameById.get(cid))
        .filter((n): n is string => typeof n === "string");
      const locationName = sh.sceneId != null ? sceneNameById.get(sh.sceneId) : undefined;
      const locations = locationName ? [locationName] : [];
      return {
        rawText: sh.title || undefined,
        storyboard: {
          sceneHeading: sh.no,
          visualDescription: sh.title,
          dialogue: "",
          soundDesign: "",
          cameraDirection: "",
          duration: "5s",
          mood: "",
        },
        characters,
        locations,
      };
    });

    const payload: CreateFromSegmentsInput = {
      worldId,
      name: input.name?.trim() || `導演台分鏡 · 專案 ${input.projectId}`,
      segments,
    };
    await typed.worldStoryboard.createFromSegments.mutate(payload);
  }

  async function linkWorld(projectId: string, worldFrameworkId: number | null): Promise<void> {
    // creativeProject.link 已支援設/解綁 worldFrameworkId（零新後端，AIDV-100）。
    await typed.creativeProject.link.mutate({ id: num(projectId), worldFrameworkId });
  }

  async function listWorlds(): Promise<{ id: number; name: string }[]> {
    // worldbuilding.list 回 rowToData 列（含 id / name）。
    const rows = await typed.worldbuilding.list.query();
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? `世界 #${r.id}`),
    }));
  }

  return {
    mode: "trpc",
    listProjects, loadProject, recompilePacket,
    saveVaultState, saveCharacterEdit, createNote, createPromptBlock, createProject, ingestStoryboard,
    linkWorld, listWorlds,
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
    // 已連結 LoRA（linkedModelId）＝權威訊號；loraStatus 缺漏時據此推得「已完成」（I-7）。
    const linkedModelId = c.linkedModelId ?? null;
    return {
      id: String(c.id ?? uid("c")),
      name: String(c.name ?? "角色"),
      emoji: String(c.emoji ?? "🧑"),
      sourceGrade: (v.sourceGrade ?? c.sourceGrade ?? "estimate") as SourceGrade,
      locked: Boolean(v.locked ?? c.locked ?? false),
      locks: { face: !!locks.face, hair: !!locks.hair, costume: !!locks.costume, accessory: !!locks.accessory },
      loraStatus: (c.loraStatus ?? (linkedModelId != null ? "已完成" : "未訓練")) as Character["loraStatus"],
      linkedModelId,
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
    // I-2（AIDV-80）：從已抓到的 world 預計算精簡風格前綴；旗標關時不會被使用（零行為改變）。
    worldStyle: buildWorldStylePrefix(world) || undefined,
    // I-3（AIDV-81）：連結世界觀 id，供「劇本→自動分鏡骨架」當 seedSkeleton 的 worldId。
    worldFrameworkId: base.worldFrameworkId ?? null,
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
    async linkWorld(projectId, worldFrameworkId) {
      await delay(60);
      const p = find(projectId);
      if (p) p.worldFrameworkId = worldFrameworkId; // 種子本地 patch，離線可驗 UI
    },
    async listWorlds() {
      await delay(60);
      // 離線示範世界清單（真實模式走 worldbuilding.list）。
      return [
        { id: 7, name: "雪山密勒日巴（示範世界）" },
        { id: 8, name: "療癒森林（示範世界）" },
      ];
    },
  };
}

/** 依旗標選擇閘道實作。 */
export function makeProjectGateway(mock: boolean): ProjectGateway {
  return mock ? makeProjectGatewayMock() : makeProjectGatewayTrpc();
}
