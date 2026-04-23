export type CacheConfig = {
  enabled: boolean;
  redisUrl: string;
  keyPrefix: string;
};

export function getCacheConfig(): CacheConfig {
  return {
    enabled: Boolean(process.env.REDIS_URL),
    redisUrl: process.env.REDIS_URL || "",
    keyPrefix: process.env.REDIS_KEY_PREFIX || "healing-studio:",
  };
}
