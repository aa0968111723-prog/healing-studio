// ============================================================================
// spine/worldStyle.ts — I-2 世界風格注入（AIDV-80）的純函式核心
// ----------------------------------------------------------------------------
// 把「選定世界」的預設 style profile 壓成一行精簡視覺風格前綴，於生成時 prepend 到
// 提示詞，達成「同專案連續生成視覺一致 / 切世界即切風格」。
//
// 設計：兩個純函式、零副作用、零 import 執行期相依 →
//   • buildWorldStylePrefix(world)：從 worldbuilding.get 的回傳（loosely typed）抽出
//     預設 WorldStyleProfile 的關鍵視覺欄位，組成精簡前綴字串。
//   • applyWorldStyle(prompt, prefix, enabled)：旗標關（預設）時原樣回傳＝零行為改變；
//     旗標開且有前綴時才 prepend。
// 旗標 ENABLE_WORLD_STYLE_INJECTION 預設 OFF（見 config/videoFlags.ts）。
// ============================================================================

/** WorldStyleProfile 的寬鬆投影（gateway 的 world 為 any；只取注入用得到的視覺欄位）。 */
type LooseStyleProfile = {
  id?: string;
  triggerWord?: unknown;
  artStyle?: unknown;
  palette?: unknown;
  lighting?: unknown;
  shadingModel?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 從 worldbuilding framework（loosely typed）抽出「預設 style profile」並組成精簡前綴。
 * 找不到 profile / 無欄位 → 回空字串（呼叫端據此 no-op）。純函式、防禦式解析。
 */
export function buildWorldStylePrefix(world: unknown): string {
  if (!world || typeof world !== "object") return "";
  const w = world as Record<string, unknown>;
  const raw = Array.isArray(w.styleProfiles)
    ? w.styleProfiles
    : Array.isArray((w as { styleProfilesJson?: unknown }).styleProfilesJson)
      ? (w as { styleProfilesJson: unknown[] }).styleProfilesJson
      : [];
  const profiles = raw as LooseStyleProfile[];
  if (profiles.length === 0) return "";

  const defaultId = w.defaultStyleProfileId;
  const def =
    profiles.find((p) => p && defaultId != null && String(p.id) === String(defaultId)) ?? profiles[0];
  if (!def || typeof def !== "object") return "";

  const palette = Array.isArray(def.palette)
    ? def.palette.map(str).filter(Boolean)
    : [];

  const bits = [
    str(def.triggerWord),
    str(def.artStyle),
    palette.length ? `palette: ${palette.join(" / ")}` : "",
    str(def.lighting),
    str(def.shadingModel),
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  return bits.join(", ");
}

/**
 * 旗標關（預設）→ 原樣回傳（零行為改變）。旗標開且有前綴 → prepend 到提示詞。
 * prompt 可能 undefined（純 prefix 時回 prefix）。
 */
export function applyWorldStyle(
  prompt: string | undefined,
  worldStyle: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!enabled) return prompt;
  const prefix = worldStyle?.trim();
  if (!prefix) return prompt;
  return prompt && prompt.trim() ? `${prefix}\n\n${prompt}` : prefix;
}
