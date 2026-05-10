import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";

export async function loadOrbMemory(userId: number): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ summary: users.orbMemorySummary })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (row?.summary ?? "").trim();
}

export async function saveOrbMemory(userId: number, summary: string): Promise<void> {
  const db = getDb();
  const cleaned = summary.trim();

  await db
    .update(users)
    .set({
      orbMemorySummary: cleaned.length > 0 ? cleaned : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
