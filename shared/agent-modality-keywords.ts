/**
 * shared/agent-modality-keywords.ts
 *
 * Single source of truth for modality keyword sets. Before this module
 * lived, `multiAgentDetector.ts` and `orb-agent-roles.ts` each had their
 * own keyword list — they drifted (multiAgentDetector knew "圖" /
 * "picture" but the role router didn't, and the role router knew "畫"
 * / "繪製" / "img2img" but the multi-agent detector didn't).
 *
 * The drift caused inconsistent routing: a message that the role router
 * classified as `image-specialist` could be classified as a no-modality
 * generic message by the detector, which then refused to enter
 * multi-agent mode even when it should. The fix: both modules import
 * the keyword sets from here.
 *
 * Pure / sync; no runtime dependencies. Safe to import anywhere.
 */

export type ModalityId = "image" | "video" | "music" | "voice" | "3d";

/**
 * Keyword sets per modality. Order within each list does NOT matter —
 * `detectModalitiesFromText` does plain substring match, lower-cased.
 *
 * Curation rules:
 *   - Single-character entries ("圖", "畫") are kept here only — they're
 *     useful for multi-modality detection but TOO greedy for the
 *     specialist-role keyword router (which needs unambiguous signals).
 *     The specialist router uses its own narrower keyword sets in
 *     orb-agent-roles.ts; both consult this list when they need broad
 *     modality coverage.
 *   - Cross-modality words ("聲音" — both music and voice claim it
 *     historically) are now kept ONLY in voice; music uses "音樂" /
 *     "音效" / "音訊" instead. See orb-agent-roles.ts for the deeper
 *     fix; this module mirrors that decision so detectors stay aligned.
 */
export const MODALITY_KEYWORDS: Record<ModalityId, readonly string[]> = {
  image: [
    "圖",
    "圖片",
    "圖像",
    "照片",
    "畫",
    "繪製",
    "image",
    "photo",
    "picture",
  ],
  video: [
    "影片",
    "視頻",
    "video",
    "動畫",
    "animation",
  ],
  music: [
    "音樂",
    "音訊",
    "音效",
    "背景音",
    "music",
    "audio",
    "sound",
    "soundtrack",
  ],
  voice: [
    "配音",
    "語音",
    "聲音",
    "voice",
    "narration",
    "dubbing",
    "說話",
  ],
  "3d": [
    "3d",
    "三維",
    "立體",
    "3d model",
  ],
};

/**
 * Return the set of modalities mentioned anywhere in `text`. Each
 * modality fires at most once even if multiple keywords match.
 *
 * Used by:
 *   - server/services/multiAgentDetector.ts — to populate
 *     `detectedModalities` for collaboration heuristics.
 *   - server/services/specializedAgentMemoryStore.ts (future) — to tag
 *     prompt embeddings by modality.
 */
export function detectModalitiesFromText(text: string): ModalityId[] {
  const haystack = text.toLowerCase();
  const out: ModalityId[] = [];
  for (const modality of Object.keys(MODALITY_KEYWORDS) as ModalityId[]) {
    if (MODALITY_KEYWORDS[modality].some(kw => haystack.includes(kw))) {
      out.push(modality);
    }
  }
  return out;
}

/**
 * Map a detected modality to its specialist agent id (matches AgentRole
 * literals from orb-agent-roles.ts). Useful when a caller wants to
 * suggest agents based on modalities. 3D maps to image-specialist
 * because the 3D pipeline lives in image-studio, same convention as
 * multiAgentDetector.
 */
export function modalityToSpecialistAgentId(modality: ModalityId): string {
  switch (modality) {
    case "image":
    case "3d":
      return "image-specialist";
    case "video":
      return "video-specialist";
    case "music":
      return "music-specialist";
    case "voice":
      return "voice-specialist";
  }
}
