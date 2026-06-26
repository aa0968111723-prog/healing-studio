/**
 * config-check.ts — AIDV-261: 啟動時棄用環境變數警告
 *
 * 只發出 console.warn，不 throw。目的是提醒運維人員清理已棄用的設定，
 * 避免未來版本升級時因殘留設定造成無聲錯誤。
 */

const DEPRECATED_ENV_VARS = [
  "GOTRUE_JWT_ADMIN_GROUP_NAME",
  "GOTRUE_OPERATOR_TOKEN",
] as const;

export function validateEnvConfig(): void {
  for (const key of DEPRECATED_ENV_VARS) {
    if (process.env[key]) {
      console.warn(
        `[config-warn] ${key} is deprecated and should be removed from the environment`
      );
    }
  }
}
