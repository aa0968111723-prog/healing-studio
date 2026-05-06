import { z } from "zod";

const SAFE_MESSAGE = "系統繁忙，已切換摘要模式";

const assistantPayloadSchema = z.object({
  final_user_message: z.object({
    text: z.string().optional(),
    markdown: z.string().optional(),
    cta: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
  }).optional(),
  traceId: z.string().optional(),
});

const looksLikeBase64 = (v: string) => /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 400;
const looksLikeJwt = (v: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const looksLikeJsonBlob = (v: string) => {
  const t = v.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
};

export function isSuspiciousSerializedString(v: string, threshold = 240): boolean {
  if (!v || v.length < threshold) return false;
  return looksLikeBase64(v) || looksLikeJwt(v) || looksLikeJsonBlob(v);
}

export function safeRenderAssistantMessage(raw: unknown): { text: string; traceId?: string; fallback: boolean; triggerSummary: boolean } {
  const parsed = assistantPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    console.debug("[assistant-message-safety] schema validation failed", parsed.error.flatten());
    return { text: SAFE_MESSAGE, fallback: true, triggerSummary: true };
  }
  const payload = parsed.data;
  const safe = payload.final_user_message;
  if (!safe) {
    console.debug("[assistant-message-safety] missing final_user_message", raw);
    return { text: SAFE_MESSAGE, traceId: payload.traceId, fallback: true, triggerSummary: true };
  }
  const text = safe.markdown ?? safe.text ?? "";
  if (isSuspiciousSerializedString(text)) {
    console.debug("[assistant-message-safety] suspicious serialization output", {
      traceId: payload.traceId,
      preview: text.slice(0, 120),
      raw,
    });
    return { text: SAFE_MESSAGE, traceId: payload.traceId, fallback: true, triggerSummary: true };
  }
  // whitelist only
  const unknownFields = Object.keys(safe).filter(k => !["text", "markdown", "cta"].includes(k));
  if (unknownFields.length > 0) {
    console.debug("[assistant-message-safety] dropped unknown fields", unknownFields);
  }
  return { text, traceId: payload.traceId, fallback: false, triggerSummary: false };
}
