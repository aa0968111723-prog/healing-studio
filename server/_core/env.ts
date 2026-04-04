/**
 * env.ts — Server environment variables
 *
 * This module re-exports validated environment values from env.validated.ts.
 * The original ENV shape is preserved for backward compatibility with all
 * existing imports (routers, db, llm, imageGeneration, etc.).
 *
 * New code should prefer importing { serverEnv, assertApiKey, getApiKey }
 * from "./env.validated" for richer type safety and runtime checks.
 */

import { serverEnv } from "./env.validated";

export const ENV = {
  appId:          serverEnv.VITE_APP_ID,
  cookieSecret:   serverEnv.JWT_SECRET,
  databaseUrl:    serverEnv.DATABASE_URL,
  oAuthServerUrl: serverEnv.OAUTH_SERVER_URL,
  ownerOpenId:    serverEnv.OWNER_OPEN_ID,
  isProduction:   serverEnv.NODE_ENV === "production",
  forgeApiUrl:    serverEnv.BUILT_IN_FORGE_API_URL,
  forgeApiKey:    serverEnv.BUILT_IN_FORGE_API_KEY,
};
