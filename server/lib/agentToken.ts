/**
 * agentToken.ts — AIDV-333: Agent-to-Agent 短時效 JWT 互信認證
 *
 * 問題：Orchestrator 分派子任務給 Script Agent 時，子代理無法驗證指令是否
 * 真的來自 Orchestrator（prompt injection 可偽冒 Orchestrator 身份，造成
 * 橫向越權）。
 *
 * 解法：Orchestrator 為每個子任務用獨立金鑰（AGENT_SIGNING_KEY）簽發
 * 5 分鐘有效的 HS256 JWT，子代理驗證 aud（目標代理 ID）+ issuer + 簽名。
 * 過期或偽冒 token → 401。跨代理委派鏈記錄在 x_chain payload 欄位。
 *
 * 啟用條件：Railway 設定 AGENT_SIGNING_KEY（32+ 字元隨機值），未設則
 * isAgentAuthConfigured() = false，所有操作 fail-closed（503）。
 */

import { SignJWT, jwtVerify } from "jose";
import { serverEnv } from "../_core/env.validated.js";

/** A2A token 預設效期（秒）— 最小授權原則：短時效強制每個子任務重新認證。 */
export const AGENT_TOKEN_EXPIRES_SECONDS = 5 * 60; // 5 分鐘

/** Issuer claim 固定值，防止使用者 session token 被當 agent token 重用。 */
export const AGENT_ISSUER = "healing-studio:agent-orchestrator";

/** A2A JWT audience 前綴，配合 targetAgentId 組成完整 audience。 */
export const AGENT_AUDIENCE_PREFIX = "a2a:";

/**
 * AGENT_SIGNING_KEY 是否已設定（> 0 字元）。
 * 未設定時所有 A2A token 操作 fail-closed（503）。
 */
export function isAgentAuthConfigured(): boolean {
  return !!(serverEnv.AGENT_SIGNING_KEY && serverEnv.AGENT_SIGNING_KEY.length > 0);
}

function getAgentSigningSecret(): Uint8Array {
  if (!isAgentAuthConfigured()) {
    throw Object.assign(new Error("AGENT_SIGNING_KEY 未設定，A2A 認證不可用"), {
      code: "PRECONDITION_FAILED" as const,
    });
  }
  return new TextEncoder().encode(serverEnv.AGENT_SIGNING_KEY);
}

export interface AgentTokenPayload {
  /** 簽發方代理 ID（e.g. "orchestrator"）。*/
  sub: string;
  /** 目標代理 ID（e.g. "script-agent"）。由 AGENT_AUDIENCE_PREFIX 組合。 */
  aud: string | string[];
  /** 目標代理 ID（不含 prefix，便於後端直接比對 registry 條目）。*/
  agent_id: string;
  /** 此 token 授權的任務 ID。 */
  task_id: string;
  /** 委派鏈（ [orchestrator, script-agent, ...] ），以 x-agent-chain header 傳遞。 */
  x_chain: string[];
  iat?: number;
  exp?: number;
}

/**
 * 為子任務簽發短時效 A2A JWT。
 * Orchestrator 在每次分派任務前呼叫此函式，取得只對目標代理有效的 token。
 *
 * @param issuerId    簽發方代理 ID（通常為 "orchestrator"）
 * @param targetAgentId 目標代理 ID（tRPC 路由端的 expectedAudience 必須與此一致）
 * @param taskId      任務 ID（用於稽核 + 防 token replay 橫向移用）
 * @param existingChain 上游傳入的委派鏈（x-agent-chain header 拆分後的陣列），自動 append issuerId
 */
export async function issueAgentToken(params: {
  issuerId: string;
  targetAgentId: string;
  taskId: string;
  existingChain?: string[];
}): Promise<string> {
  const { issuerId, targetAgentId, taskId, existingChain = [] } = params;
  const secret = getAgentSigningSecret();
  const audience = `${AGENT_AUDIENCE_PREFIX}${targetAgentId}`;
  const chain = [...existingChain, issuerId];

  return new SignJWT({
    agent_id: targetAgentId,
    task_id: taskId,
    x_chain: chain,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${AGENT_TOKEN_EXPIRES_SECONDS}s`)
    .setSubject(issuerId)
    .setAudience(audience)
    .setIssuer(AGENT_ISSUER)
    .sign(secret);
}

export interface VerifiedAgentToken {
  issuerId: string;
  targetAgentId: string;
  taskId: string;
  chain: string[];
}

/**
 * 驗證 A2A JWT。
 * 子代理在接受任務前呼叫此函式，確認指令確實來自受信任的 Orchestrator。
 *
 * @param token           Bearer token（去除 "Bearer " 前綴後的原始字串）
 * @param expectedAgentId 本代理自身的 ID（驗 aud 是否指向自己）
 * @returns 驗證通過的 payload；簽名/過期/audience 不符 → throw（呼叫端回 401）
 */
export async function verifyAgentToken(
  token: string,
  expectedAgentId: string
): Promise<VerifiedAgentToken> {
  const secret = getAgentSigningSecret();
  const expectedAudience = `${AGENT_AUDIENCE_PREFIX}${expectedAgentId}`;

  const { payload } = await jwtVerify(token, secret, {
    audience: expectedAudience,
    issuer: AGENT_ISSUER,
  });

  const p = payload as unknown as AgentTokenPayload;
  return {
    issuerId: p.sub ?? "",
    targetAgentId: p.agent_id ?? expectedAgentId,
    taskId: p.task_id ?? "",
    chain: Array.isArray(p.x_chain) ? p.x_chain : [],
  };
}

/**
 * 從 x-agent-chain header 值（comma-separated）解析委派鏈陣列。
 * 缺失或空字串 → []。
 */
export function parseAgentChainHeader(headerValue: string | undefined): string[] {
  if (!headerValue) return [];
  return headerValue
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 把委派鏈陣列序列化回 x-agent-chain header 值。
 */
export function formatAgentChainHeader(chain: string[]): string {
  return chain.join(", ");
}
