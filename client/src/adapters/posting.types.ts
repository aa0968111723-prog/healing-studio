// ============================================================================
// adapters/posting.types.ts — 第 6 條接縫：PostingProvider（發佈通道）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §6.2「PostingProvider 接縫（mock→Postiz）」。
//
// 發佈到外部平台是 /social 唯一「完全沒有現況實作」的能力。依全站 Mock-First 哲學，
// 把它藏在第 6 條接縫後（前五條見 P0 adapters/types.ts），現在跑 mock、之後翻一個旗標
// 接真實（Postiz 28+ 通道 或 各平台原生 API）。上層 social.postNow/schedulePost 不改。
//
// 與 P0 五接縫同構：介面強型別、env 旗標切換實作、回退/錯誤型別一致（重用 AdapterError）。
// 「發佈通道永遠可缺席」——沒接真實就停在「已產出、可手動下載多尺寸包」，不阻斷創作主線。
// ============================================================================
import type { ProviderId } from "@/spine/types";

/** 支援通道（mock 全支援；真實依 Postiz/原生 API 能力）。 */
export type PostingChannel = "ig" | "fb" | "threads" | "x" | "line" | "xhs" | "linkedin" | "tiktok";

export const CHANNEL_LABEL: Record<PostingChannel, string> = {
  ig: "Instagram",
  fb: "Facebook",
  threads: "Threads",
  x: "X / Twitter",
  line: "LINE",
  xhs: "小紅書",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

export type PostStatusValue = "scheduled" | "posted" | "failed";

/** 發佈附帶的資產（指向 digital_asset_library；ratioPreset 對映 sizePresets）。 */
export interface PostAssetRef {
  assetId: string;
  assetUrl?: string;
  ratioPreset: string;
}

export interface PublishCopy {
  headline?: string;
  body?: string;
  hashtags?: string[];
  cta?: string;
}

export interface PublishReq {
  /** 本站貼文 id（冪等鍵的一部分）。 */
  postId: string;
  channel: PostingChannel;
  copy: PublishCopy;
  assets: PostAssetRef[];
  /** 有值＝排程；無值＝立即發。 */
  scheduledAt?: string; // ISO
}

/** 外部平台回參（寫回 social_posts.external_refs，§5.2）。 */
export interface ExternalRef {
  provider: "mock" | "postiz" | string;
  channel: PostingChannel;
  /** 平台側貼文 id。 */
  externalId: string;
  permalink?: string;
  postedAt?: string;
}

export interface PublishResult {
  ref: ExternalRef;
  status: PostStatusValue;
  /** 此次帳本成本（mock=0，不污染真實帳，§3.6）。 */
  costUsd: number;
}

export interface PostStatus {
  status: PostStatusValue;
  permalink?: string;
  /** 失敗原因（拒件/限流/token 過期…）。 */
  reason?: string;
}

/** 發佈事件（給 UI 即時呈現排隊/重試/成功；對映 GenEvent 的習慣）。 */
export type PostingEvent =
  | { type: "queued"; channel: PostingChannel; idempotencyKey: string }
  | { type: "attempt"; channel: PostingChannel; provider: string }
  | { type: "retry"; channel: PostingChannel; reason: string; nextInMs: number }
  | { type: "posted"; channel: PostingChannel; ref: ExternalRef }
  | { type: "failed"; channel: PostingChannel; reason: string };

export interface PostingProvider {
  /** 立即或排程發佈（scheduledAt 有值＝排程）。 */
  publish(req: PublishReq, onEvent?: (e: PostingEvent) => void): Promise<PublishResult>;
  /** 查發佈狀態（輪詢；mock 立即回終態）。 */
  getStatus(ref: ExternalRef): Promise<PostStatus>;
  /** 取消尚未到點的排程（已發佈回 false）。 */
  cancel(ref: ExternalRef): Promise<{ ok: boolean }>;
}

/** 接縫相依（provider 偏好 + 故障注入，對齊 P0 AdapterDeps）。 */
export interface PostingDeps {
  getProvider?: () => ProviderId;
  getFaults?: () => Record<string, boolean>;
}

export interface PostingRegistry {
  posting: PostingProvider;
  meta: { posting: string };
}
