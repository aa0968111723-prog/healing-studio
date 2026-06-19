export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/**
 * AIDV-59（H4 JWT 硬化）：新發 session token 的預設壽命。
 * 從 ~1 年縮短為 30 天，降低密鑰／token 外洩的暴露視窗（365→30 天）。
 * 已簽發的舊 token 仍各自帶 exp，不受影響（不會大規模登出）。
 */
export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
/** THIRTY_DAYS_MS 的秒數字串形式，用作 JWT_ACCESS_TOKEN_EXPIRES_IN 的預設值。 */
export const THIRTY_DAYS_SECONDS = String(60 * 60 * 24 * 30); // "2592000"
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
export const NOT_LEADER_ERR_MSG =
  "You do not have required permission (10003)";

/** 站內角色階層：user < leader < admin。leader 可動成本 / 自動給點，不能設定他人角色。 */
export const USER_ROLES = ["user", "leader", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** leader 或 admin 都算「組長以上」— 可動積分分配 / 成本檢視。 */
export function isLeaderOrAdmin(role: UserRole | string | undefined | null): boolean {
  return role === "admin" || role === "leader";
}
