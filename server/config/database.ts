import { serverEnv } from "../_core/env.validated";

export type SqlDriver = "mysql" | "postgres";

export function getSqlConfig(driver: SqlDriver = "mysql") {
  const url = serverEnv.DATABASE_URL;
  return {
    driver,
    url,
    pool: {
      min: 2,
      max: 10,
      idleMs: 60_000,
    },
  };
}
