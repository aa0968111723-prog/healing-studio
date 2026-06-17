// ============================================================================
// components/connectors/connectorsTypes.ts — 連接器治理面板資料型別＋mock
// ----------------------------------------------------------------------------
// AIDV-115 / U-12：5 類治理面板的唯讀資料契約（純前端、props/mock 驅動）。
// 不接後端、不含任何金鑰；mock 僅供離線視覺驗收（第三人可驗）。
// ============================================================================

/** 連接器即時連線狀態（對應狀態 dot 顏色）。 */
export type ConnectorStatus = "connected" | "disconnected" | "error";

/** 連接器健康狀態（對應健康 Pill）。 */
export type ConnectorHealth = "healthy" | "degraded" | "down" | "unknown";

/** 5 類治理分組。 */
export type ConnectorCategory =
  | "model" // 模型供應商
  | "storage" // 儲存
  | "source" // 資料源
  | "byomcp" // BYOMCP（自帶 MCP）
  | "vault"; // 個人資料庫

/** ACL 角色。 */
export type AclRole = "owner" | "editor" | "viewer";

/** 單條 ACL 權限列：角色＋可見性。 */
export interface AclEntry {
  role: AclRole;
  /** 該角色是否可見此連接器（純視覺 Toggle，唯讀回呼）。 */
  visible: boolean;
}

/** 單個連接器卡資料（唯讀）。 */
export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  health: ConnectorHealth;
  /** 顯示用副標（如供應商、端點別名）；不得含金鑰。 */
  detail?: string;
  /** ACL 權限列（角色＋可見性）。 */
  acl: AclEntry[];
}

export const CATEGORY_META: Record<
  ConnectorCategory,
  { label: string; /** lucide icon 名（由元件對應 SVG） */ icon: string }
> = {
  model: { label: "模型供應商", icon: "cpu" },
  storage: { label: "儲存", icon: "database" },
  source: { label: "資料源", icon: "plug" },
  byomcp: { label: "BYOMCP", icon: "server" },
  vault: { label: "個人資料庫", icon: "lock" },
};

export const CATEGORY_ORDER: ConnectorCategory[] = [
  "model",
  "storage",
  "source",
  "byomcp",
  "vault",
];

export const ROLE_LABEL: Record<AclRole, string> = {
  owner: "擁有者",
  editor: "編輯者",
  viewer: "檢視者",
};

export const HEALTH_LABEL: Record<ConnectorHealth, string> = {
  healthy: "健康",
  degraded: "降級",
  down: "中斷",
  unknown: "未知",
};

/** 離線視覺驗收用 mock（零金鑰、純展示）。 */
export const MOCK_CONNECTORS: Connector[] = [
  {
    id: "hf",
    name: "Hugging Face",
    category: "model",
    status: "connected",
    health: "healthy",
    detail: "預設生成 provider",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: true },
      { role: "viewer", visible: false },
    ],
  },
  {
    id: "gemini",
    name: "Gemini 2.5",
    category: "model",
    status: "error",
    health: "down",
    detail: "感知＋生成並列",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: false },
      { role: "viewer", visible: false },
    ],
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    category: "storage",
    status: "connected",
    health: "degraded",
    detail: "媒體物件儲存",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: true },
      { role: "viewer", visible: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "source",
    status: "disconnected",
    health: "unknown",
    detail: "資料源 · 未連線",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: false },
      { role: "viewer", visible: false },
    ],
  },
  {
    id: "mcp-local",
    name: "Local MCP Server",
    category: "byomcp",
    status: "connected",
    health: "healthy",
    detail: "自帶 MCP 端點",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: true },
      { role: "viewer", visible: false },
    ],
  },
  {
    id: "vault-me",
    name: "個人資料庫",
    category: "vault",
    status: "connected",
    health: "healthy",
    detail: "角色 · 提示 · 偏好",
    acl: [
      { role: "owner", visible: true },
      { role: "editor", visible: false },
      { role: "viewer", visible: false },
    ],
  },
];
