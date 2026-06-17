/* AI Director · 團隊協作視覺 — 型別與 mock（U-13 / AIDV-116）
 * ----------------------------------------------------------------------------
 * 純前端唯讀資料契約：團隊／成員／角色／共享範圍／分工看板任務。
 *  · 本卡純視覺，資料用 props/mock 離線可驗；真實 RBAC／後端＝AIDV-121。
 *  · 角色（role）與共享範圍（scope）的語氣色映射集中於此，避免各處硬綁。
 * rev. U-13 · 2026-06-17 */
import type { StatusTone } from "../design-kit/atoms";

/** 團隊成員角色（RBAC 視覺分級；真實權限＝AIDV-121）。 */
export type TeamRole = "owner" | "admin" | "editor" | "viewer" | "guest";

/** 共享範圍（誰能看到此團隊／資源）。 */
export type ShareScope = "private" | "team" | "org" | "public";

/** 分工看板欄位狀態（看板欄＝狀態，卡＝任務）。 */
export type BoardColumnId = "todo" | "doing" | "review" | "done";

export type TeamMember = {
  id: string;
  name: string;
  /** 頭像 URL（缺省時以姓名首字產生 initials 頭像）。 */
  avatarUrl?: string;
  role: TeamRole;
  /** 是否在線（純視覺指示）。 */
  online?: boolean;
};

export type BoardTask = {
  id: string;
  title: string;
  column: BoardColumnId;
  /** 指派成員 id（對應 Team.members）；缺省＝未指派。 */
  assigneeId?: string;
  /** 可選標籤（如領域／優先級）。 */
  tag?: string;
};

export type Team = {
  id: string;
  name: string;
  /** 一句話描述。 */
  blurb?: string;
  scope: ShareScope;
  members: TeamMember[];
  tasks: BoardTask[];
};

/* ──────────────────────────────────────────────────────────────
 * 角色 → 語氣 + 標籤（SSOT；Pill / RoleTag 共用）。
 * ────────────────────────────────────────────────────────────── */
export const ROLE_META: Record<TeamRole, { tone: StatusTone; label: string }> = {
  owner:  { tone: "warn", label: "擁有者" },
  admin:  { tone: "info", label: "管理員" },
  editor: { tone: "ok",   label: "編輯者" },
  viewer: { tone: "mute", label: "檢視者" },
  guest:  { tone: "mute", label: "訪客" },
};

/* ──────────────────────────────────────────────────────────────
 * 共享範圍 → 語氣 + 標籤 + lucide 圖示鍵（ShareScopeBadge 用）。
 * ────────────────────────────────────────────────────────────── */
export const SCOPE_META: Record<
  ShareScope,
  { tone: StatusTone; label: string; icon: "lock" | "users" | "building" | "globe"; hint: string }
> = {
  private: { tone: "mute", label: "私人",  icon: "lock",     hint: "僅自己可見" },
  team:    { tone: "info", label: "團隊",  icon: "users",    hint: "團隊成員可見" },
  org:     { tone: "ok",   label: "組織",  icon: "building", hint: "整個組織可見" },
  public:  { tone: "warn", label: "公開",  icon: "globe",    hint: "任何人可見" },
};

/* ──────────────────────────────────────────────────────────────
 * 看板欄定義（欄＝狀態；語意順序固定）。
 * ────────────────────────────────────────────────────────────── */
export const BOARD_COLUMNS: ReadonlyArray<{ id: BoardColumnId; label: string; tone: StatusTone }> = [
  { id: "todo",   label: "待辦", tone: "mute" },
  { id: "doing",  label: "進行中", tone: "info" },
  { id: "review", label: "審查", tone: "warn" },
  { id: "done",   label: "完成", tone: "ok" },
] as const;

/* ──────────────────────────────────────────────────────────────
 * 離線 mock（驗收／走查用）。
 * ────────────────────────────────────────────────────────────── */
export const MOCK_TEAMS: Team[] = [
  {
    id: "t-aurora",
    name: "極光製作組",
    blurb: "負責主線敘事鏡頭與配樂統合。",
    scope: "team",
    members: [
      { id: "m1", name: "林維", role: "owner", online: true },
      { id: "m2", name: "陳曦", role: "admin", online: true },
      { id: "m3", name: "黃柏", role: "editor", online: false },
      { id: "m4", name: "Quinn", role: "viewer", online: true },
    ],
    tasks: [
      { id: "k1", title: "開場分鏡定稿", column: "done", assigneeId: "m1", tag: "敘事" },
      { id: "k2", title: "第二幕配樂選曲", column: "review", assigneeId: "m2", tag: "音樂" },
      { id: "k3", title: "角色立繪上色", column: "doing", assigneeId: "m3", tag: "美術" },
      { id: "k4", title: "片尾字幕排版", column: "todo", tag: "後製" },
      { id: "k5", title: "轉場特效測試", column: "doing", assigneeId: "m4", tag: "特效" },
    ],
  },
  {
    id: "t-solo",
    name: "個人練習檔",
    blurb: "私人沙盒，僅自己可見。",
    scope: "private",
    members: [{ id: "m1", name: "林維", role: "owner", online: true }],
    tasks: [{ id: "k6", title: "試做光影預設", column: "todo", assigneeId: "m1" }],
  },
];
