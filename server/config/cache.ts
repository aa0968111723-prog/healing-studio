import { serverEnv } from "../_core/env.validated";

export type CacheConfig = {
  enabled: boolean;
  redisUrl: string;
  keyPrefix: string;
};

export function getCacheConfig(): CacheConfig {
  return {
    enabled: Boolean(serverEnv.REDIS_URL),
    redisUrl: serverEnv.REDIS_URL,
    keyPrefix: serverEnv.REDIS_KEY_PREFIX,
  };
}
