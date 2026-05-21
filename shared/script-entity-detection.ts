/**
 * shared/script-entity-detection.ts
 *
 * 從腳本文字裡偵測：
 *   - 可疑角色名（中文/英文/混合）
 *   - 場景描述
 *   - 對白
 *   - 情緒關鍵字
 *
 * 不依賴任何重型 NLP 模型；用簡單規則 + 啟發式（fugue heuristic）就好。
 *
 * 對比已存在的世界觀，回傳「未知角色 / 未知場景」清單，讓 UI 提示
 * 使用者一鍵加入。
 *
 * 已有 `shared/orb-script-structure.ts` 的 `productionEntities` 是淺層 regex
 * （只抓 `角色: ___`、`場景: ___` 這類顯式宣告）。本檔做的是更深的偵測：
 *   1. 「XX：對白」這類冒號開頭找出角色
 *   2. 「INT. / EXT.」找場景頭
 *   3. 「場景 1」「第一場」等中文章節找場景
 *   4. 從上下文推測情緒詞
 */

import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type ScriptEntityKind = "character" | "scene" | "emotion";

export type DetectedScriptEntity = {
  kind: ScriptEntityKind;
  /** 偵測到的字串（去頭尾空白） */
  name: string;
  /** 出現次數 */
  occurrences: number;
  /** 第一段樣本片段（給 UI 顯示「在哪裡看到的」） */
  sampleContext?: string;
  /** 此名稱是否與既有世界觀對齊（true = 已存在，false = 未知 / 草稿） */
  matchedExistingId?: string;
};

export type DialogueLine = {
  /** 說話者 */
  speaker: string;
  /** 對白內容 */
  line: string;
};

export type ScriptEntityDetectionResult = {
  /** 偵測到的角色（去重 + 計數） */
  characters: DetectedScriptEntity[];
  /** 偵測到的場景 */
  scenes: DetectedScriptEntity[];
  /** 對白行（含 speaker） */
  dialogues: DialogueLine[];
  /** 情緒關鍵字命中（從 EMOTION_KEYWORDS 抽出） */
  emotions: DetectedScriptEntity[];
  /** 腳本中出現、但目前世界觀沒有的「未知角色名」清單 */
  unknownCharacters: DetectedScriptEntity[];
  /** 腳本中出現、但目前世界觀沒有的「未知場景」清單 */
  unknownScenes: DetectedScriptEntity[];
};

// ─── 內部設定 ─────────────────────────────────────────────────────────────

/** 不會被當作角色名的「常見動詞 / 標記詞」黑名單 */
const CHARACTER_NAME_BLACKLIST = new Set([
  // 對白標記
  "OS",
  "VO",
  "V.O.",
  "OS.",
  "O.S.",
  "CUT",
  "FADE",
  "DISSOLVE",
  // 動詞 / 動作
  "說",
  "說道",
  "問",
  "答",
  "想",
  "繼續",
  "結束",
  // 通用名詞 / 結構詞
  "INT",
  "EXT",
  "場景",
  "鏡頭",
  "場",
  "角色",
  "scene",
  "shot",
  "act",
  "場次",
  "畫外音",
  "旁白",
]);

/** 情緒詞辭庫（中英文） */
const EMOTION_KEYWORDS = [
  "喜悅",
  "開心",
  "微笑",
  "大笑",
  "悲傷",
  "哭泣",
  "啜泣",
  "憤怒",
  "暴怒",
  "震驚",
  "錯愕",
  "緊張",
  "焦慮",
  "恐懼",
  "驚恐",
  "羞澀",
  "臉紅",
  "困惑",
  "崩潰",
  "失望",
  "失落",
  "孤獨",
  "happy",
  "sad",
  "angry",
  "afraid",
  "joy",
  "nervous",
  "shocked",
  "cry",
  "laugh",
];

/**
 * 「XX：對白」對白偵測樣式。
 *
 * 使用顯式 \u Unicode escape 來避免 JS 正則對 BMP CJK 範圍的歧義
 * （某些版本的轉碼器會把 `[一-鿿]` 折成 UTF-16 surrogate range 而漏字）。
 */
const DIALOGUE_LINE_RE =
  /^\s*([一-鿿A-Za-z][一-鿿A-Za-z0-9_·\-' ]{0,30}?)\s*[:：](.+)$/;

/** Screenplay 場景頭：INT./EXT. ... — TIME */
const SLUGLINE_RE =
  /^\s*(?:INT\.?|EXT\.?|INT\/EXT|I\/E)\.?\s+([^\n]+?)(?:\s+(?:—|-|DAY|NIGHT|MORNING|EVENING|DUSK|DAWN))/i;

/** 中文場次標記：場景 1、第一場、第 1 場、Scene 1、SCENE 1 */
const SCENE_HEADING_RE_LIST: RegExp[] = [
  /(?:^|\n)\s*場景\s*[#:：]?\s*([0-9一二三四五六七八九十]+)\s*[：:.\-—]?\s*([^\n]{0,40})/gm,
  /(?:^|\n)\s*第\s*([0-9一二三四五六七八九十]+)\s*場\s*[：:.\-—]?\s*([^\n]{0,40})/gm,
  /(?:^|\n)\s*scene\s*([0-9]+)\s*[：:.\-—]?\s*([^\n]{0,40})/gim,
];

const sanitizeName = (raw: string): string => {
  return raw
    .trim()
    .replace(/^[\(（【\[]/g, "")
    .replace(/[\)）】\]]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const isLikelyCharacterName = (s: string): boolean => {
  if (!s) return false;
  if (s.length < 1 || s.length > 24) return false;
  const trimmed = s.trim();
  if (CHARACTER_NAME_BLACKLIST.has(trimmed)) return false;
  if (CHARACTER_NAME_BLACKLIST.has(trimmed.toUpperCase())) return false;
  // 必須至少有一個「字」（中文或英文字母）。注意 JS `\w` 不含 CJK，
  // 所以不能用 \W 反向偵測；改成正向檢查含字母即可。
  const hasLetter = /[一-鿿A-Za-z]/.test(trimmed);
  if (!hasLetter) return false;
  // 不允許有句子結尾標點（多半是對白內容被誤抓）
  if (/[。！？!?]$/u.test(trimmed)) return false;
  return true;
};

// ─── 主邏輯 ────────────────────────────────────────────────────────────────

function aggregate(
  names: Array<{ name: string; context?: string }>,
  kind: ScriptEntityKind
): DetectedScriptEntity[] {
  const map = new Map<string, DetectedScriptEntity>();
  for (const { name, context } of names) {
    const clean = sanitizeName(name);
    if (!clean) continue;
    const existing = map.get(clean);
    if (existing) {
      existing.occurrences += 1;
    } else {
      map.set(clean, {
        kind,
        name: clean,
        occurrences: 1,
        sampleContext: context?.slice(0, 80),
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.occurrences - a.occurrences
  );
}

function detectDialoguesAndSpeakers(
  text: string
): { dialogues: DialogueLine[]; speakers: Array<{ name: string; context: string }> } {
  const lines = text.split(/\r?\n/);
  const dialogues: DialogueLine[] = [];
  const speakers: Array<{ name: string; context: string }> = [];

  for (const rawLine of lines) {
    const m = rawLine.match(DIALOGUE_LINE_RE);
    if (!m) continue;
    const speakerCandidate = sanitizeName(m[1] ?? "");
    const line = (m[2] ?? "").trim();
    // 過濾結構標記（場景：、鏡頭：、INT.: 等）
    if (!isLikelyCharacterName(speakerCandidate)) continue;
    // 對白通常 > 1 字
    if (line.length === 0) continue;
    dialogues.push({ speaker: speakerCandidate, line });
    speakers.push({
      name: speakerCandidate,
      context: line,
    });
  }
  return { dialogues, speakers };
}

function detectSceneHeadings(
  text: string
): Array<{ name: string; context: string }> {
  const found: Array<{ name: string; context: string }> = [];

  // Screenplay slugline: INT. <PLACE> — DAY
  const slugLines = text.split(/\r?\n/);
  for (const line of slugLines) {
    const m = line.match(SLUGLINE_RE);
    if (m && m[1]) {
      const place = sanitizeName(m[1].toUpperCase().replace(/\s+/g, " "));
      // sanitize back to original case if pure CJK
      const originalCase = sanitizeName(m[1]);
      const name = /[一-鿿]/.test(originalCase) ? originalCase : place;
      if (name) found.push({ name, context: line.trim() });
    }
  }

  // 中文 / Scene 場次
  for (const re of SCENE_HEADING_RE_LIST) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const label = sanitizeName(m[2] ?? "");
      if (label && label.length >= 1) {
        found.push({ name: label, context: m[0] });
      }
    }
  }

  return found;
}

function detectEmotions(text: string): Array<{ name: string; context: string }> {
  const found: Array<{ name: string; context: string }> = [];
  for (const kw of EMOTION_KEYWORDS) {
    const re = new RegExp(kw, "gi");
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      found.push({
        name: kw,
        context: matches.length === 1 ? matches[0] : `${matches.length} 次`,
      });
    }
  }
  return found;
}

/**
 * 比對腳本中找出來的名稱、與既有世界觀的角色 / 場景，回傳未對齊的清單。
 * 對比方式：normalize（trim + 小寫）後完全相同或被包含視為命中。
 */
function diffAgainstWorld(
  entities: DetectedScriptEntity[],
  world: WorldbuildingFrameworkData | null | undefined,
  kind: "character" | "scene"
): DetectedScriptEntity[] {
  if (!world) return entities;
  const pool =
    kind === "character"
      ? (world.characters ?? []).map(c => ({ id: c.id, name: c.name }))
      : (world.scenes ?? []).map(s => ({ id: s.id, name: s.name }));

  const norm = (s: string): string =>
    s.trim().toLowerCase().replace(/\s+/g, "");

  return entities.map(e => {
    const target = norm(e.name);
    const hit = pool.find(p => {
      const candidate = norm(p.name ?? "");
      if (!candidate || !target) return false;
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
    if (hit) {
      return { ...e, matchedExistingId: hit.id };
    }
    return e;
  });
}

// ─── 公開 API ──────────────────────────────────────────────────────────────

/**
 * 從腳本文字裡偵測角色 / 場景 / 對白 / 情緒。若帶入 world，會比對既有
 * 世界觀並標記哪些是 unknown，方便 UI 提示「補設定」。
 */
export function detectScriptEntities(
  text: string,
  world?: WorldbuildingFrameworkData | null
): ScriptEntityDetectionResult {
  if (!text || text.trim().length === 0) {
    return {
      characters: [],
      scenes: [],
      dialogues: [],
      emotions: [],
      unknownCharacters: [],
      unknownScenes: [],
    };
  }

  const { dialogues, speakers } = detectDialoguesAndSpeakers(text);
  const sceneHeadings = detectSceneHeadings(text);
  const emotionsRaw = detectEmotions(text);

  // 也從顯式宣告 (角色: XX) 裡抽
  const explicitChars: Array<{ name: string; context: string }> = [];
  const explicitScenes: Array<{ name: string; context: string }> = [];
  const explicitCharRe =
    /(?:角色|主角|配角|反派|人物)\s*[：:是為]\s*([一-鿿A-Za-z0-9_·\-' ]{2,24})/g;
  let m: RegExpExecArray | null;
  while ((m = explicitCharRe.exec(text)) !== null) {
    explicitChars.push({ name: m[1], context: m[0] });
  }
  const explicitSceneRe =
    /(?:場景|地點|location)\s*[：:是為]\s*([一-鿿A-Za-z0-9_·\-' ]{2,32})/gi;
  while ((m = explicitSceneRe.exec(text)) !== null) {
    explicitScenes.push({ name: m[1], context: m[0] });
  }

  const characters = aggregate(
    [...speakers, ...explicitChars],
    "character"
  );
  const scenes = aggregate(
    [...sceneHeadings, ...explicitScenes],
    "scene"
  );
  const emotions = aggregate(emotionsRaw, "emotion");

  // 與世界觀比對
  const charactersWithMatch = diffAgainstWorld(
    characters,
    world,
    "character"
  );
  const scenesWithMatch = diffAgainstWorld(scenes, world, "scene");

  const unknownCharacters = charactersWithMatch.filter(
    c => !c.matchedExistingId
  );
  const unknownScenes = scenesWithMatch.filter(s => !s.matchedExistingId);

  return {
    characters: charactersWithMatch,
    scenes: scenesWithMatch,
    dialogues,
    emotions,
    unknownCharacters,
    unknownScenes,
  };
}
