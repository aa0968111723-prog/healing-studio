/**
 * config-check.ts — AIDV-261/342: 啟動時棄用環境變數警告
 *
 * 只發出 console.warn，不 throw。目的是提醒運維人員清理已棄用的設定，
 * 避免未來版本升級時因殘留設定造成無聲錯誤。
 *
 * GOTRUE_JWT_ADMIN_GROUP_NAME / GOTRUE_JWT_DEFAULT_GROUP_NAME：GoTrue v2.190.0
 * 起正式廢棄（AIDV-342）。請從 Railway 環境變數移除這兩個 key；
 * 本系統 admin 判斷已改用本地 users.role 欄位，不依賴 GoTrue 群組機制。
 */

export const DEPRECATED_ENV_VARS = [
  "GOTRUE_JWT_ADMIN_GROUP_NAME",
  "GOTRUE_JWT_DEFAULT_GROUP_NAME",
  "GOTRUE_OPERATOR_TOKEN",
] as const;

export type DeprecatedEnvKey = (typeof DEPRECATED_ENV_VARS)[number];

export function validateEnvConfig(): void {
  for (const key of DEPRECATED_ENV_VARS) {
    if (process.env[key]) {
      console.warn(
        `[config-warn][AIDV-342] ${key} is deprecated and must be removed from Railway env vars. ` +
          `This setting is ignored by GoTrue v2.190.0+ and may cause auth anomalies on future upgrades. ` +
          `Admin role is managed via users.role in the local DB — no GoTrue group config required.`
      );
    }
  }
}
