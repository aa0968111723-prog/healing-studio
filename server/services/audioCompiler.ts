/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Audio Compiler — 音樂編譯器
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 將情緒積木 + 使用者選擇的樂器/曲風/節奏/環境質感，
 * 編譯為 Suno / Udio 可消費的結構化提示詞。
 *
 * 核心演算法：
 * 1. Timeline Structure Generator — 動態產生 [Intro] [Verse 1] [Chorus] [Drop] 等時間軸標記
 * 2. Tag Stacking Limit — 每個中括號段落內的樂器/風格元素 ≤ 4 個，防過載
 * 3. Style Conflict Resolver — 偵測矛盾風格並自動調和
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AudioBlock {
  id: string;
  category: "instrument" | "genre" | "tempo" | "ambiance";
  label: string;
  prompt: string;
}

export interface AudioCompilerInput {
  /** 使用者選擇的積木 */
  blocks: AudioBlock[];
  /** 自由文字提示詞 */
  freePrompt?: string;
  /** 情緒 / Vibe 關鍵字 */
  moodKeywords?: string[];
  /** 歌詞（若有） */
  lyrics?: string;
  /** 目標時長（秒），預設 120 */
  targetDurationSec?: number;
  /** 是否為純器樂（無人聲） */
  instrumental?: boolean;
  /** 強制結構模板 */
  forceStructure?: StructureTemplateId;
  /** BPM 覆寫 */
  bpmOverride?: number;
}

export interface CompiledSection {
  /** 段落標記，如 [Verse 1] */
  tag: string;
  /** 該段落的提示詞元素 */
  elements: string[];
  /** 堆疊前的原始元素數量 */
  rawElementCount: number;
  /** 是否被 Tag Stacking Limit 裁剪 */
  wasTrimmed: boolean;
  /** 預估時長（秒） */
  estimatedDurationSec: number;
}

export interface AudioCompileResult {
  /** 最終編譯的完整提示詞 */
  prompt: string;
  /** 風格標籤（給 Suno style_of_music 欄位） */
  styleTag: string;
  /** 時間軸段落明細 */
  sections: CompiledSection[];
  /** 總段落數 */
  sectionCount: number;
  /** 預估總時長（秒） */
  estimatedDurationSec: number;
  /** 是否有風格衝突被調和 */
  hasConflictResolution: boolean;
  /** 衝突調和日誌 */
  conflictLog: string[];
  /** Tag Stacking 裁剪日誌 */
  stackingLog: string[];
  /** 編譯日誌 */
  compilationLog: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 結構模板
// ═══════════════════════════════════════════════════════════════════════════

export type StructureTemplateId =
  | "pop"        // 流行曲式
  | "ambient"    // 環境音樂
  | "edm"        // 電子舞曲
  | "ballad"     // 抒情慢歌
  | "cinematic"  // 電影配樂
  | "lofi"       // Lo-Fi
  | "minimal";   // 極簡

interface StructureSection {
  tag: string;
  role: "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "drop" | "breakdown" | "outro" | "interlude";
  /** 該段落的時長佔比（0~1） */
  durationWeight: number;
  /** 該段落的能量等級 1~5 */
  energy: number;
  /** 該段落偏好的元素類別 */
  preferCategories: AudioBlock["category"][];
}

const STRUCTURE_TEMPLATES: Record<StructureTemplateId, StructureSection[]> = {
  pop: [
    { tag: "[Intro]",     role: "intro",     durationWeight: 0.08, energy: 2, preferCategories: ["ambiance", "instrument"] },
    { tag: "[Verse 1]",   role: "verse",     durationWeight: 0.18, energy: 3, preferCategories: ["instrument", "genre"] },
    { tag: "[Pre-Chorus]", role: "prechorus", durationWeight: 0.08, energy: 3, preferCategories: ["tempo", "ambiance"] },
    { tag: "[Chorus]",    role: "chorus",    durationWeight: 0.18, energy: 5, preferCategories: ["instrument", "genre", "ambiance"] },
    { tag: "[Verse 2]",   role: "verse",     durationWeight: 0.15, energy: 3, preferCategories: ["instrument", "genre"] },
    { tag: "[Chorus]",    role: "chorus",    durationWeight: 0.18, energy: 5, preferCategories: ["instrument", "genre", "ambiance"] },
    { tag: "[Outro]",     role: "outro",     durationWeight: 0.15, energy: 2, preferCategories: ["ambiance", "instrument"] },
  ],
  ambient: [
    { tag: "[Intro]",      role: "intro",      durationWeight: 0.15, energy: 1, preferCategories: ["ambiance"] },
    { tag: "[Movement 1]", role: "verse",      durationWeight: 0.25, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Transition]", role: "interlude",  durationWeight: 0.10, energy: 1, preferCategories: ["ambiance"] },
    { tag: "[Movement 2]", role: "verse",      durationWeight: 0.25, energy: 3, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Fade Out]",   role: "outro",      durationWeight: 0.25, energy: 1, preferCategories: ["ambiance"] },
  ],
  edm: [
    { tag: "[Intro]",      role: "intro",      durationWeight: 0.08, energy: 2, preferCategories: ["ambiance", "instrument"] },
    { tag: "[Build Up]",   role: "prechorus",  durationWeight: 0.12, energy: 4, preferCategories: ["tempo", "instrument"] },
    { tag: "[Drop]",       role: "drop",       durationWeight: 0.20, energy: 5, preferCategories: ["instrument", "genre", "tempo"] },
    { tag: "[Breakdown]",  role: "breakdown",  durationWeight: 0.12, energy: 2, preferCategories: ["ambiance"] },
    { tag: "[Build Up 2]", role: "prechorus",  durationWeight: 0.10, energy: 4, preferCategories: ["tempo", "instrument"] },
    { tag: "[Drop 2]",     role: "drop",       durationWeight: 0.22, energy: 5, preferCategories: ["instrument", "genre", "tempo"] },
    { tag: "[Outro]",      role: "outro",      durationWeight: 0.16, energy: 2, preferCategories: ["ambiance"] },
  ],
  ballad: [
    { tag: "[Intro]",      role: "intro",      durationWeight: 0.10, energy: 1, preferCategories: ["instrument"] },
    { tag: "[Verse 1]",    role: "verse",      durationWeight: 0.22, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Chorus]",     role: "chorus",     durationWeight: 0.20, energy: 4, preferCategories: ["instrument", "genre"] },
    { tag: "[Verse 2]",    role: "verse",      durationWeight: 0.18, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Chorus]",     role: "chorus",     durationWeight: 0.18, energy: 4, preferCategories: ["instrument", "genre"] },
    { tag: "[Outro]",      role: "outro",      durationWeight: 0.12, energy: 1, preferCategories: ["ambiance", "instrument"] },
  ],
  cinematic: [
    { tag: "[Opening]",     role: "intro",     durationWeight: 0.12, energy: 2, preferCategories: ["ambiance", "instrument"] },
    { tag: "[Rising]",      role: "verse",     durationWeight: 0.20, energy: 3, preferCategories: ["instrument", "genre"] },
    { tag: "[Climax]",      role: "chorus",    durationWeight: 0.22, energy: 5, preferCategories: ["instrument", "genre", "tempo"] },
    { tag: "[Resolution]",  role: "bridge",    durationWeight: 0.18, energy: 3, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Denouement]",  role: "outro",     durationWeight: 0.28, energy: 1, preferCategories: ["ambiance"] },
  ],
  lofi: [
    { tag: "[Intro]",       role: "intro",     durationWeight: 0.10, energy: 1, preferCategories: ["ambiance"] },
    { tag: "[Loop A]",      role: "verse",     durationWeight: 0.25, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Variation]",   role: "bridge",    durationWeight: 0.15, energy: 2, preferCategories: ["instrument", "genre"] },
    { tag: "[Loop B]",      role: "verse",     durationWeight: 0.25, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Fade Out]",    role: "outro",     durationWeight: 0.25, energy: 1, preferCategories: ["ambiance"] },
  ],
  minimal: [
    { tag: "[Begin]",       role: "intro",     durationWeight: 0.15, energy: 1, preferCategories: ["instrument"] },
    { tag: "[Develop]",     role: "verse",     durationWeight: 0.35, energy: 2, preferCategories: ["instrument", "ambiance"] },
    { tag: "[Peak]",        role: "chorus",    durationWeight: 0.25, energy: 3, preferCategories: ["instrument", "tempo"] },
    { tag: "[Dissolve]",    role: "outro",     durationWeight: 0.25, energy: 1, preferCategories: ["ambiance"] },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// 風格衝突矩陣
// ═══════════════════════════════════════════════════════════════════════════

/** 互斥風格對：同時出現時需要調和 */
const STYLE_CONFLICTS: Array<[string, string, string]> = [
  // [風格A prompt片段, 風格B prompt片段, 調和建議]
  ["fast tempo",      "slow tempo",      "moderate tempo"],
  ["upbeat",          "adagio",          "moderate tempo"],
  ["electronic",      "classical",       "electronic classical fusion"],
  ["lo-fi",           "crystal clear",   "lo-fi"],
  ["heavy metal",     "ambient",         "post-rock ambient"],
  ["punk",            "classical",       "neo-classical"],
  ["deep bass",       "bright mix",      "balanced mix with sub-bass"],
  ["fast tempo",      "rubato",          "flexible tempo"],
  ["drums and percussion", "ethereal",   "soft percussion, ethereal"],
];

// ═══════════════════════════════════════════════════════════════════════════
// Tag Stacking Limit 常數
// ═══════════════════════════════════════════════════════════════════════════

/** 每個段落中括號內最多允許的元素數量 */
const MAX_ELEMENTS_PER_SECTION = 4;

/** 元素優先級（越小越優先保留） */
const CATEGORY_PRIORITY: Record<AudioBlock["category"], number> = {
  genre: 1,       // 曲風最重要，定義整體方向
  instrument: 2,  // 樂器其次
  tempo: 3,       // 節奏第三
  ambiance: 4,    // 環境質感最後
};

// ═══════════════════════════════════════════════════════════════════════════
// 結構模板自動推斷
// ═══════════════════════════════════════════════════════════════════════════

/** 根據積木內容推斷最佳結構模板 */
function inferStructureTemplate(blocks: AudioBlock[], moodKeywords?: string[]): StructureTemplateId {
  const prompts = blocks.map(b => b.prompt.toLowerCase()).join(" ");
  const moods = (moodKeywords || []).join(" ").toLowerCase();
  const combined = `${prompts} ${moods}`;

  // EDM 特徵
  if (/electronic|synth|edm|dance|techno|house|trance/.test(combined)) return "edm";
  // Lo-Fi 特徵
  if (/lo-fi|lofi|chill|vinyl|crackle/.test(combined)) return "lofi";
  // 環境音特徵
  if (/ambient|ethereal|spacious|drone|meditation/.test(combined)) return "ambient";
  // 電影配樂特徵
  if (/orchestral|cinematic|epic|film|soundtrack|dramatic/.test(combined)) return "cinematic";
  // 抒情特徵
  if (/ballad|slow|adagio|piano.*soft|gentle|tender/.test(combined)) return "ballad";
  // 極簡特徵
  if (/minimal|simple|sparse|solo/.test(combined)) return "minimal";
  // 預設流行
  return "pop";
}

// ═══════════════════════════════════════════════════════════════════════════
// AudioCompiler 主類
// ═══════════════════════════════════════════════════════════════════════════

export class AudioCompiler {
  private readonly maxElementsPerSection: number;

  constructor(maxElements: number = MAX_ELEMENTS_PER_SECTION) {
    this.maxElementsPerSection = maxElements;
  }

  // ─── 主編譯方法 ──────────────────────────────────────────────

  compile(input: AudioCompilerInput): AudioCompileResult {
    const log: string[] = [];
    const stackingLog: string[] = [];
    const conflictLog: string[] = [];
    const targetDuration = input.targetDurationSec || 120;

    log.push(`[開始編譯] 積木數量: ${input.blocks.length}, 目標時長: ${targetDuration}s`);

    // Step 1: 風格衝突偵測與調和
    const { resolvedBlocks, conflicts } = this.resolveConflicts(input.blocks);
    conflictLog.push(...conflicts);
    if (conflicts.length > 0) {
      log.push(`[衝突調和] 偵測到 ${conflicts.length} 組風格衝突，已自動調和`);
    }

    // Step 2: 推斷或使用指定的結構模板
    const templateId = input.forceStructure || inferStructureTemplate(resolvedBlocks, input.moodKeywords);
    const template = STRUCTURE_TEMPLATES[templateId];
    log.push(`[結構選擇] 使用模板: ${templateId} (${template.length} 段落)`);

    // Step 3: 分類積木
    const categorized = this.categorizeBlocks(resolvedBlocks);
    log.push(`[積木分類] 樂器: ${categorized.instrument.length}, 曲風: ${categorized.genre.length}, 節奏: ${categorized.tempo.length}, 環境: ${categorized.ambiance.length}`);

    // Step 4: 為每個段落分配元素 + Tag Stacking Limit
    const sections: CompiledSection[] = [];
    for (const section of template) {
      const sectionDuration = Math.round(targetDuration * section.durationWeight);
      const rawElements = this.selectElementsForSection(section, categorized, input.moodKeywords);
      const rawCount = rawElements.length;

      // Tag Stacking Limit 裁剪
      const { trimmed, wasTrimmed } = this.applyStackingLimit(rawElements, section.tag);
      if (wasTrimmed) {
        stackingLog.push(
          `${section.tag} 堆疊裁剪: ${rawCount} → ${trimmed.length} 元素 (上限 ${this.maxElementsPerSection})`
        );
      }

      sections.push({
        tag: section.tag,
        elements: trimmed,
        rawElementCount: rawCount,
        wasTrimmed,
        estimatedDurationSec: sectionDuration,
      });
    }

    log.push(`[堆疊防禦] ${stackingLog.length > 0 ? `${stackingLog.length} 個段落被裁剪` : "所有段落均在上限內"}`);

    // Step 5: 組裝最終提示詞
    const prompt = this.assemblePrompt(sections, input);
    const styleTag = this.buildStyleTag(resolvedBlocks, input);

    log.push(`[編譯完成] 總段落: ${sections.length}, 預估時長: ${targetDuration}s, 風格標籤: ${styleTag}`);

    return {
      prompt,
      styleTag,
      sections,
      sectionCount: sections.length,
      estimatedDurationSec: targetDuration,
      hasConflictResolution: conflicts.length > 0,
      conflictLog,
      stackingLog,
      compilationLog: log,
    };
  }

  // ─── 風格衝突偵測與調和 ──────────────────────────────────────

  resolveConflicts(blocks: AudioBlock[]): { resolvedBlocks: AudioBlock[]; conflicts: string[] } {
    const conflicts: string[] = [];
    const resolved = [...blocks];
    const prompts = resolved.map(b => b.prompt.toLowerCase());

    for (const [styleA, styleB, resolution] of STYLE_CONFLICTS) {
      const idxA = prompts.findIndex(p => p.includes(styleA));
      const idxB = prompts.findIndex(p => p.includes(styleB));

      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
        conflicts.push(
          `衝突: "${resolved[idxA].label}" vs "${resolved[idxB].label}" → 調和為 "${resolution}"`
        );
        // 保留第一個，修改為調和結果；移除第二個
        resolved[idxA] = {
          ...resolved[idxA],
          prompt: resolution,
          label: `${resolved[idxA].label}(已調和)`,
        };
        resolved.splice(idxB, 1);
        prompts.splice(idxB, 1);
      }
    }

    return { resolvedBlocks: resolved, conflicts };
  }

  // ─── 積木分類 ────────────────────────────────────────────────

  categorizeBlocks(blocks: AudioBlock[]): Record<AudioBlock["category"], AudioBlock[]> {
    const result: Record<AudioBlock["category"], AudioBlock[]> = {
      instrument: [],
      genre: [],
      tempo: [],
      ambiance: [],
    };
    for (const block of blocks) {
      if (result[block.category]) {
        result[block.category].push(block);
      }
    }
    return result;
  }

  // ─── 段落元素選擇 ───────────────────────────────────────────

  selectElementsForSection(
    section: StructureSection,
    categorized: Record<AudioBlock["category"], AudioBlock[]>,
    moodKeywords?: string[]
  ): string[] {
    const elements: string[] = [];

    // 按段落偏好類別順序加入元素
    for (const cat of section.preferCategories) {
      for (const block of categorized[cat]) {
        elements.push(block.prompt);
      }
    }

    // 加入非偏好類別的元素（低優先）
    const allCategories: AudioBlock["category"][] = ["genre", "instrument", "tempo", "ambiance"];
    for (const cat of allCategories) {
      if (!section.preferCategories.includes(cat)) {
        for (const block of categorized[cat]) {
          if (!elements.includes(block.prompt)) {
            elements.push(block.prompt);
          }
        }
      }
    }

    // 根據能量等級調整：低能量段落移除高能量元素
    if (section.energy <= 2) {
      return elements.filter(e => !/fast tempo|upbeat|heavy|loud|aggressive/.test(e.toLowerCase()));
    }

    // 高能量段落可以加入能量修飾
    if (section.energy >= 4 && moodKeywords?.length) {
      const energyMods = moodKeywords.filter(k =>
        /intense|powerful|epic|dramatic|energetic/.test(k.toLowerCase())
      );
      if (energyMods.length > 0) {
        elements.push(energyMods[0]);
      }
    }

    return Array.from(new Set(elements)); // 去重
  }

  // ─── Tag Stacking Limit 演算法 ──────────────────────────────

  applyStackingLimit(
    elements: string[],
    sectionTag: string
  ): { trimmed: string[]; wasTrimmed: boolean } {
    if (elements.length <= this.maxElementsPerSection) {
      return { trimmed: elements, wasTrimmed: false };
    }

    // 按優先級排序：根據元素內容推斷類別
    const scored = elements.map(el => ({
      element: el,
      priority: this.inferElementPriority(el),
    }));

    // 穩定排序：優先級小的排前面
    scored.sort((a, b) => a.priority - b.priority);

    // 裁剪至上限
    const trimmed = scored.slice(0, this.maxElementsPerSection).map(s => s.element);

    return { trimmed, wasTrimmed: true };
  }

  /** 根據元素內容推斷其類別優先級 */
  private inferElementPriority(element: string): number {
    const lower = element.toLowerCase();

    // 曲風關鍵字
    if (/pop|jazz|rock|classical|electronic|folk|r&b|hip-hop|ambient|lo-fi|edm|metal|punk|blues|soul|reggae|country/.test(lower)) {
      return CATEGORY_PRIORITY.genre;
    }
    // 樂器關鍵字
    if (/piano|guitar|violin|flute|drums|bass|synth|harp|cello|trumpet|saxophone|organ|percussion|ensemble|orchestral/.test(lower)) {
      return CATEGORY_PRIORITY.instrument;
    }
    // 節奏關鍵字
    if (/tempo|bpm|beat|rhythm|adagio|allegro|swing|rubato|fast|slow|moderate|accelerat/.test(lower)) {
      return CATEGORY_PRIORITY.tempo;
    }
    // 環境質感
    return CATEGORY_PRIORITY.ambiance;
  }

  // ─── 提示詞組裝 ─────────────────────────────────────────────

  assemblePrompt(sections: CompiledSection[], input: AudioCompilerInput): string {
    const lines: string[] = [];

    // 全局修飾
    const globalMods: string[] = [];
    if (input.instrumental) {
      globalMods.push("[Instrumental]");
    }
    if (input.bpmOverride) {
      globalMods.push(`[BPM: ${input.bpmOverride}]`);
    }
    if (globalMods.length > 0) {
      lines.push(globalMods.join(" "));
      lines.push("");
    }

    // 逐段落組裝
    for (const section of sections) {
      lines.push(section.tag);
      if (section.elements.length > 0) {
        lines.push(section.elements.join(", "));
      }

      // 如果有歌詞且是 verse/chorus 段落，插入歌詞佔位
      if (input.lyrics && /Verse|Chorus|Hook/.test(section.tag)) {
        const lyricsSegment = this.extractLyricsForSection(section.tag, input.lyrics);
        if (lyricsSegment) {
          lines.push(lyricsSegment);
        }
      }

      lines.push(""); // 段落間空行
    }

    // 加入自由提示詞
    if (input.freePrompt?.trim()) {
      lines.push(`[Style Note] ${input.freePrompt.trim()}`);
    }

    // 加入情緒關鍵字
    if (input.moodKeywords?.length) {
      const moodStr = input.moodKeywords.slice(0, 3).join(", ");
      lines.push(`[Mood] ${moodStr}`);
    }

    return lines.join("\n").trim();
  }

  // ─── 歌詞段落提取 ───────────────────────────────────────────

  private extractLyricsForSection(sectionTag: string, lyrics: string): string | null {
    const paragraphs = lyrics.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length === 0) return null;

    // 簡單映射：Verse 1 → 第 1 段, Verse 2 → 第 2 段, Chorus → 最後一段
    if (/Verse 1|Loop A|Movement 1/.test(sectionTag) && paragraphs[0]) {
      return paragraphs[0].trim();
    }
    if (/Verse 2|Loop B|Movement 2/.test(sectionTag) && paragraphs.length > 1) {
      return paragraphs[1].trim();
    }
    if (/Chorus|Hook|Climax/.test(sectionTag)) {
      return paragraphs[paragraphs.length - 1].trim();
    }

    return null;
  }

  // ─── 風格標籤建構 ───────────────────────────────────────────

  buildStyleTag(blocks: AudioBlock[], input: AudioCompilerInput): string {
    const parts: string[] = [];

    // 曲風優先
    const genres = blocks.filter(b => b.category === "genre");
    if (genres.length > 0) {
      parts.push(...genres.slice(0, 2).map(g => g.prompt));
    }

    // 加入情緒修飾
    if (input.moodKeywords?.length) {
      parts.push(input.moodKeywords[0]);
    }

    // 加入節奏修飾
    const tempos = blocks.filter(b => b.category === "tempo");
    if (tempos.length > 0) {
      parts.push(tempos[0].prompt);
    }

    // 純器樂標記
    if (input.instrumental) {
      parts.push("instrumental");
    }

    // Tag Stacking Limit 也適用於 styleTag
    const limited = parts.slice(0, this.maxElementsPerSection);
    return limited.join(", ");
  }

  // ─── 快速編譯（簡化入口） ───────────────────────────────────

  compileQuick(
    blockPrompts: string[],
    mood?: string,
    instrumental?: boolean
  ): string {
    const blocks: AudioBlock[] = blockPrompts.map((prompt, i) => ({
      id: `quick_${i}`,
      category: this.inferCategory(prompt),
      label: prompt,
      prompt,
    }));

    const result = this.compile({
      blocks,
      moodKeywords: mood ? [mood] : undefined,
      instrumental,
    });

    return result.prompt;
  }

  /** 從 prompt 文字推斷積木類別 */
  private inferCategory(prompt: string): AudioBlock["category"] {
    const lower = prompt.toLowerCase();
    if (/piano|guitar|violin|flute|drums|bass|synth|harp|cello|trumpet|saxophone|organ|percussion|ensemble|orchestral/.test(lower)) {
      return "instrument";
    }
    if (/pop|jazz|rock|classical|electronic|folk|r&b|hip-hop|ambient|lo-fi|edm|metal|punk|blues|soul/.test(lower)) {
      return "genre";
    }
    if (/tempo|bpm|beat|rhythm|adagio|allegro|swing|rubato|fast|slow|moderate/.test(lower)) {
      return "tempo";
    }
    return "ambiance";
  }

  // ─── 工具方法 ────────────────────────────────────────────────

  /** 取得所有可用的結構模板 */
  getAvailableTemplates(): Array<{ id: StructureTemplateId; sectionCount: number; sections: string[] }> {
    return (Object.entries(STRUCTURE_TEMPLATES) as [StructureTemplateId, StructureSection[]][]).map(
      ([id, sections]) => ({
        id,
        sectionCount: sections.length,
        sections: sections.map(s => s.tag),
      })
    );
  }

  /** 預覽指定模板的結構 */
  previewTemplate(templateId: StructureTemplateId): StructureSection[] | null {
    return STRUCTURE_TEMPLATES[templateId] || null;
  }

  /** 取得 Tag Stacking Limit 上限 */
  getMaxElementsPerSection(): number {
    return this.maxElementsPerSection;
  }

  /** 驗證積木組合是否有衝突 */
  validateBlocks(blocks: AudioBlock[]): { valid: boolean; conflicts: string[] } {
    const { conflicts } = this.resolveConflicts(blocks);
    return { valid: conflicts.length === 0, conflicts };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

let _instance: AudioCompiler | null = null;

export function getAudioCompiler(): AudioCompiler {
  if (!_instance) {
    _instance = new AudioCompiler();
  }
  return _instance;
}
