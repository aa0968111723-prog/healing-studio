/**
 * server/services/mediaTranscriber.ts
 *
 * Thin façade the voice-specialist spirit tool imports via
 * `await import("../mediaTranscriber")`. Routes to ElevenLabs Scribe.
 */

import { getElevenLabsExtendedClient } from "./elevenLabsExtended";

export interface TranscribeMediaInput {
  userId: number;
  mediaUrl: string;
  language?: string;
}

export interface TranscribeMediaResult {
  transcript: string;
  words?: Array<{ text: string; start: number; end: number; speaker?: string }>;
}

export async function transcribeMedia(
  input: TranscribeMediaInput
): Promise<TranscribeMediaResult> {
  const client = getElevenLabsExtendedClient();
  const result = await client.transcribe({
    audioUrl: input.mediaUrl,
    languageCode: input.language,
  });
  return {
    transcript: result.text,
    words: result.words,
  };
}
