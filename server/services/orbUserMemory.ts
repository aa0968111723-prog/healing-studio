import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";

export async function loadOrbMemory(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  const rows = await db
    .select({ orbMemorySummary: users.orbMemorySummary })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.orbMemorySummary ?? "";
}

export async function saveOrbMemory(
  userId: number,
  recentMessages: { role: string; content: string }[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const lastSix = recentMessages.slice(-6);
  if (lastSix.length === 0) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "請將以下對話壓縮為 100 字以內、繁體中文、可延續脈絡的摘要。" },
        { role: "user", content: JSON.stringify(lastSix) },
      ],
    }),
  });
  if (!response.ok) return;
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const summary = json.choices?.[0]?.message?.content?.trim() ?? "";
  await db.update(users).set({ orbMemorySummary: summary || null }).where(eq(users.id, userId));
}
