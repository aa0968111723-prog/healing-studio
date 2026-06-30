import { z } from "zod";

const FalJobResultSchema = z
  .object({
    images: z.array(z.object({ url: z.string() })).optional(),
    image: z.object({ url: z.string() }).optional(),
    video: z.object({ url: z.string() }).optional(),
    video_url: z.string().optional(),
    audio: z.object({ url: z.string() }).optional(),
    audio_url: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const FalPollStatusSchema = z
  .object({
    status: z.string().optional(),
    audio_url: z.string().optional(),
    audioUrl: z.string().optional(),
    video_url: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
    raw: z.unknown().optional(),
  })
  .passthrough();

export type FalJobResult = z.infer<typeof FalJobResultSchema>;
export type FalPollStatus = z.infer<typeof FalPollStatusSchema>;

export function extractResultUrl(
  jobType: string | null | undefined,
  resultData: unknown
): string | null {
  const parsed = FalJobResultSchema.safeParse(resultData);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (jobType === "video") return d.video?.url ?? d.video_url ?? d.url ?? null;
  if (jobType === "audio" || jobType === "voice")
    return d.audio?.url ?? d.audio_url ?? d.url ?? null;
  return d.images?.[0]?.url ?? d.image?.url ?? d.url ?? null;
}

export function parsePollStatus(raw: unknown): FalPollStatus | null {
  const result = FalPollStatusSchema.safeParse(raw);
  return result.success ? result.data : null;
}
