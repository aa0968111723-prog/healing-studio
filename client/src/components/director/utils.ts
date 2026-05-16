import type { ScenePlan, ScriptSegment } from "@shared/types";

/** Derive ScenePlan rows from imported script segments for the scene-planning phase. */
export function scenesFromSegments(segments: ScriptSegment[]): ScenePlan[] {
  return segments.map((seg, i) => {
    const sb = seg.storyboard;
    const noteParts = [
      sb.dialogue ? `對白：${sb.dialogue}` : "",
      sb.cameraDirection ? `鏡頭：${sb.cameraDirection}` : "",
      sb.soundDesign ? `音效：${sb.soundDesign}` : "",
    ].filter(Boolean);
    return {
      id: seg.id || `scene-${i}-${Date.now()}`,
      title: sb.sceneHeading || `場景 ${i + 1}`,
      description: sb.visualDescription || seg.rawText.slice(0, 200),
      mood: sb.mood || "",
      emotionalGoal: "",
      characters: seg.characters ?? [],
      location: seg.locations?.[0] ?? "",
      duration: sb.duration || "",
      notes: noteParts.join("\n"),
    };
  });
}
