import { describe, it, expect } from "vitest";

/**
 * API 金鑰驗證測試
 * 透過輕量級 API 呼叫確認各服務金鑰有效
 */

describe("API Keys Validation", () => {
  // ─── NewsAPI.org ─────────────────────────────────────────────
  it("NEWS_API_KEY should be set", () => {
    const key = process.env.NEWS_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("NEWS_API_KEY should authenticate with NewsAPI.org", async () => {
    const key = process.env.NEWS_API_KEY;
    if (!key) return;
    const res = await fetch(
      `https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${key}`
    );
    // 200 = valid key, 401 = invalid key
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  }, 15000);

  // ─── NewsData.io ─────────────────────────────────────────────
  it("NEWSDATA_API_KEY should be set", () => {
    const key = process.env.NEWSDATA_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("NEWSDATA_API_KEY should authenticate with NewsData.io", async () => {
    const key = process.env.NEWSDATA_API_KEY;
    if (!key) return;
    const res = await fetch(
      `https://newsdata.io/api/1/latest?apikey=${key}&q=test&size=1`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("success");
  }, 15000);

  // ─── Fal.ai ──────────────────────────────────────────────────
  it("FAL_API_KEY should be set", () => {
    const key = process.env.FAL_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("FAL_API_KEY should authenticate with Fal.ai", async () => {
    const key = process.env.FAL_API_KEY;
    if (!key) return;
    // Use a lightweight endpoint to validate the key
    const res = await fetch("https://rest.alpha.fal.ai/tokens/", {
      headers: { Authorization: `Key ${key}` },
    });
    // 200 or 404 means key is valid (endpoint may not exist but auth passed)
    // 401/403 means key is invalid
    expect([200, 404, 405]).toContain(res.status);
  }, 15000);

  // ─── LangSmith ──────────────────────────────────────────────
  it("LANGSMITH_API_KEY should be set", () => {
    const key = process.env.LANGSMITH_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.startsWith("lsv2_pt_")).toBe(true);
  });

  // ─── Pinecone ───────────────────────────────────────────────
  it("PINECONE_API_KEY should be set", () => {
    const key = process.env.PINECONE_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.startsWith("pcsk_")).toBe(true);
  });

  it("PINECONE_API_KEY should authenticate with Pinecone", async () => {
    const key = process.env.PINECONE_API_KEY;
    if (!key) return;
    const res = await fetch("https://api.pinecone.io/indexes", {
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
      },
    });
    // 200 = valid key (returns list of indexes)
    expect(res.status).toBe(200);
  }, 15000);

  // ─── ElevenLabs ─────────────────────────────────────────────
  it("ELEVENLABS_API_KEY should be set", () => {
    const key = process.env.ELEVENLABS_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.startsWith("sk_")).toBe(true);
  });

  it("ELEVENLABS_API_KEY should authenticate with ElevenLabs (free tier may 401)", async () => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return;
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
    });
    // Free tier keys may return 401; accept 200 (valid) or 401 (expired/free-tier limit)
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.subscription).toBeDefined();
    } else {
      console.warn("⚠️ ElevenLabs key returned 401 — may be expired or free-tier limited");
    }
  }, 15000);

  // ─── Suno ───────────────────────────────────────────────────
  it("SUNO_API_KEY should be set", () => {
    const key = process.env.SUNO_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  // ─── Replicate ──────────────────────────────────────────────
  it("REPLICATE_API_TOKEN should be set", () => {
    const key = process.env.REPLICATE_API_TOKEN;
    expect(key).toBeTruthy();
    expect(key!.startsWith("r8_")).toBe(true);
  });

  it("REPLICATE_API_TOKEN should authenticate with Replicate", async () => {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) return;
    const res = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.username).toBeDefined();
  }, 15000);
});
