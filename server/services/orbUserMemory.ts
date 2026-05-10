import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";

export async function loadOrbMemory(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  const rows = await db
    .select({ summary: users.orbMemorySummary })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.summary?.trim() ?? "";
}

export async function saveOrbMemory(
  userId: number,
  messages: { role: string; content: string }[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const conversation = messages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(0, 8_000);
  const summaryResp = await invokeLLM({
    model: "gpt-4o-mini",
    temperature: 0.2,
    systemPrompt: "請將對話濃縮為繁體中文重點摘要，限制 100 字以內，只輸出摘要本身。",
    messages: [{ role: "user", content: conversation }],
    timeoutMs: 20_000,
  });
  const summary = String(summaryResp.text ?? "").trim().slice(0, 1000);
  await db
    .update(users)
    .set({ orbMemorySummary: summary })
    .where(eq(users.id, userId));
}
