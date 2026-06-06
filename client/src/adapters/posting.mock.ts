// ============================================================================
// adapters/posting.mock.ts — MockPostingAdapter（零金鑰；P5 外殼期預設）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §6.2 / §6.3。
//
// 讓「排程 → 到點 → 標記已發佈 → 顯示 permalink」整條在 P5 外殼期零金鑰可演：
//   - publish(): 標 posted（或 scheduled）、回假 permalink、成本 0（不污染真實帳，§3.6）。
//   - 冪等鍵 = postId + channel + scheduledAt（避免重複發，§6.3）。
//   - 故障注入：getFaults()['posting'] 為真 → 模擬限流，先 retry 事件再 failed（§6.3 限流/拒件）。
//   - 記憶體狀態表：getStatus 可查回終態（對映 social_posts.external_refs）。
//
// 介面與真實（Postiz）完全相同，故切換「UI 一行不改」（只改 posting.ts 的 env 旗標）。
// ============================================================================
import type {
  PostingProvider, PostingDeps, PublishReq, PublishResult, PostStatus, ExternalRef, PostingEvent,
} from "./posting.types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function idempotencyKey(req: PublishReq): string {
  return `${req.postId}::${req.channel}::${req.scheduledAt ?? "now"}`;
}

function fakePermalink(channel: string, externalId: string): string {
  const host: Record<string, string> = {
    ig: "instagram.com/p", fb: "facebook.com", threads: "threads.net",
    x: "x.com/i/web/status", line: "line.me", xhs: "xiaohongshu.com/explore",
    linkedin: "linkedin.com/feed/update", tiktok: "tiktok.com",
  };
  return `https://${host[channel] ?? "example.com"}/${externalId}`;
}

export function makePostingMock(deps: PostingDeps = {}): PostingProvider {
  // 記憶體狀態表（對映 social_posts.external_refs；換頁不持久＝Tier-0 mock 預期行為）。
  const store = new Map<string, PostStatus>();
  const seen = new Set<string>(); // 冪等去重

  async function publish(req: PublishReq, onEvent: (e: PostingEvent) => void = () => {}): Promise<PublishResult> {
    const key = idempotencyKey(req);
    onEvent({ type: "queued", channel: req.channel, idempotencyKey: key });

    // 冪等：同鍵已發過 → 直接回既有終態（不重複發，§6.3）。
    if (seen.has(key)) {
      const externalId = `dup_${key.length}`;
      const ref: ExternalRef = { provider: "mock", channel: req.channel, externalId, permalink: fakePermalink(req.channel, externalId), postedAt: new Date().toISOString() };
      return { ref, status: store.get(key)?.status ?? "posted", costUsd: 0 };
    }

    await sleep(280);
    onEvent({ type: "attempt", channel: req.channel, provider: "mock" });

    // 故障注入：模擬限流 → 退避一次 → 仍失敗（讓 UI 演 §6.3 拒件/限流態）。
    const faulted = deps.getFaults?.()["posting"];
    if (faulted) {
      onEvent({ type: "retry", channel: req.channel, reason: "rate_limited (429, 故障注入)", nextInMs: 1500 });
      await sleep(300);
      const reason = "平台限流：已退避重排，請稍後重試或改尺寸/文案";
      store.set(key, { status: "failed", reason });
      onEvent({ type: "failed", channel: req.channel, reason });
      const ref: ExternalRef = { provider: "mock", channel: req.channel, externalId: rid("err") };
      return { ref, status: "failed", costUsd: 0 };
    }

    seen.add(key);
    const externalId = rid("mock");
    const scheduled = !!req.scheduledAt;
    const ref: ExternalRef = {
      provider: "mock",
      channel: req.channel,
      externalId,
      permalink: fakePermalink(req.channel, externalId),
      postedAt: scheduled ? undefined : new Date().toISOString(),
    };
    const status: PublishResult["status"] = scheduled ? "scheduled" : "posted";
    store.set(key, { status, permalink: ref.permalink });
    onEvent({ type: "posted", channel: req.channel, ref });
    return { ref, status, costUsd: 0 };
  }

  async function getStatus(ref: ExternalRef): Promise<PostStatus> {
    await sleep(60);
    // 以 channel+externalId 反查；mock 找不到時視為已發佈（外殼期樂觀）。
    for (const [, v] of store) {
      if (v.permalink && v.permalink.includes(ref.externalId)) return v;
    }
    return { status: ref.postedAt ? "posted" : "scheduled", permalink: ref.permalink };
  }

  async function cancel(ref: ExternalRef): Promise<{ ok: boolean }> {
    await sleep(60);
    if (ref.postedAt) return { ok: false }; // 已發佈不可取消
    return { ok: true };
  }

  return { publish, getStatus, cancel };
}
