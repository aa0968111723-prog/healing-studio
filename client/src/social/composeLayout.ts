// ============================================================================
// social/composeLayout.ts — 確定性文字排版合成器（/social 唯一真正新增的生成原語）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3.1。
//
// 【為什麼存在】擴散模型（FLUX/SD 類）生不出可靠的中文字與精準排版（錯字、糊字、
//   字體不可控）。社群／海報的命脈是「文字清晰＋品牌字體正確」。因此 text-layout 採
//   「確定性模板渲染」（SVG），把『擴散生成的背景視覺』與『確定性渲染的文字層』分層疊合。
//   → 背景走 GenerationProvider（mock|hf|gemini|fal）；文字層走本檔，保證保真與可編輯。
//
// 【確定性鐵律】本函式為純函式：相同輸入 → 逐字元相同 SVG。
//   - 不呼叫 Math.random / Date.now / 任何 I/O。
//   - 文字換行採確定性「視覺寬度估算」（CJK=1 單位、半形=0.5 單位）。
//   - 一切尺寸/位置由 preset + brandKit + seed 純計算得出。
//   - 回傳 contentHash（FNV-1a）證明確定性（tests/composeLayout.test.ts 驗）。
//
// 輸出 SVG 字串可：①前端 <img src={dataUrl}> 或 dangerouslySetInnerHTML 預覽；
//   ②後端 headless（resvg/satori）光柵化為 PNG/PDF 匯出（§3.4）。本檔只產生標記，
//   不做光柵化（光柵化屬匯出步驟，可在 P5+ 接 server 或 canvas）。
// ============================================================================
import type { BrandKit } from "./brandKit";
import { bestTextColor, swatch, contrastRatio, meetsAA, DEFAULT_BRAND_KIT } from "./brandKit";
import type { SizePreset, Orientation } from "./sizePresets";

export interface LayoutSlots {
  headline?: string;
  subhead?: string;
  body?: string;
  cta?: string;
  badge?: string;
}

export interface ComposeLayoutReq {
  /** 來源版面範本 id（showcase 範本 / block_combos 風格），記入血統；不影響確定性。 */
  templateId?: string;
  /** 套色票／字體／安全邊距（null → 內建預設品牌）。 */
  brandKit?: BrandKit | null;
  /** 文字插槽。 */
  slots: LayoutSlots;
  /** 擴散生成或上傳的底圖 URL（有則疊在漸層上）。 */
  backgroundAssetUrl?: string;
  /** 目標尺寸預設（決定寬高與 orientation 排版分支）。 */
  preset: SizePreset;
  /** 固定 seed → 漸層與裝飾確定性可重現（預設 0）。 */
  seed?: number;
  /** 是否顯示品牌鎖徽章（cockpit 預覽用）。 */
  brandLocked?: boolean;
}

export interface ComposeLayoutResult {
  /** 確定性 SVG 標記。 */
  svg: string;
  width: number;
  height: number;
  /** 警告（low_contrast / overflow…）；不阻斷輸出，UI 標示即可。 */
  warnings: string[];
  /** 輸入正規化後的 FNV-1a 雜湊（同輸入恆等）。 */
  contentHash: string;
}

// ── 確定性小工具 ──────────────────────────────────────────────────────────────

/** XML/SVG 文字逃逸（中文安全 + 防注入）。 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 字元視覺寬度單位：CJK / 全形 = 1；其餘（半形拉丁/數字/標點）= 0.5。確定性。 */
function charWidthUnit(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  const isCjk =
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals → 統一漢字
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compat
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compat forms
    (code >= 0xff00 && code <= 0xff60) || // 全形 ASCII
    (code >= 0xffe0 && code <= 0xffe6);
  return isCjk ? 1 : 0.5;
}

/** 一段文字的視覺寬度（單位數）。 */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidthUnit(ch);
  return w;
}

/**
 * 確定性換行：依「每行最大寬度單位」貪婪斷行。中文逐字、拉丁字儘量整詞不切。
 * 回傳行陣列。
 */
export function wrapText(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  const flush = () => {
    if (line) lines.push(line);
    line = "";
    lineW = 0;
  };
  // 以「詞 token」切：連續非 CJK 視為一詞；CJK 逐字。
  const tokens = text.match(/[⺀-鿿가-힣＀-￯]|[^\s⺀-鿿가-힣＀-￯]+|\s+|\n/g) ?? [];
  for (const tk of tokens) {
    if (tk === "\n") {
      flush();
      continue;
    }
    if (/^\s+$/.test(tk)) {
      // 空白：能放就放（不在行首）
      if (lineW > 0 && lineW + 0.5 <= maxUnits) {
        line += " ";
        lineW += 0.5;
      }
      continue;
    }
    const w = visualWidth(tk);
    if (lineW + w > maxUnits && lineW > 0) flush();
    if (w > maxUnits) {
      // 超長 token（少見）：硬切。
      for (const ch of tk) {
        const cw = charWidthUnit(ch);
        if (lineW + cw > maxUnits && lineW > 0) flush();
        line += ch;
        lineW += cw;
      }
    } else {
      line += tk;
      lineW += w;
    }
  }
  flush();
  return lines;
}

/** FNV-1a 32-bit 確定性雜湊（回 8 位 hex）。 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/** 由 seed + palette 生成確定性線性漸層（背景退路，無底圖時用）。 */
function gradientFor(kit: BrandKit, seed: number): { from: string; to: string; angle: number } {
  const from = swatch(kit, "primary") ?? "#04122B";
  const to = swatch(kit, "secondary") ?? "#0D1B2A";
  const angle = 90 + (seed % 180); // 確定性角度
  return { from, to, angle };
}

// ── 版面定位（依 orientation 重排，而非縮放；設計 §3.4 reframe）─────────────────

interface SlotBox {
  align: "start" | "middle" | "end";
  anchorY: "top" | "center" | "bottom";
}

function layoutForOrientation(o: Orientation): SlotBox {
  switch (o) {
    case "portrait":
      return { align: "start", anchorY: "bottom" }; // 直式：文字壓底、左對齊（限動/海報）
    case "landscape":
      return { align: "start", anchorY: "center" }; // 橫式：左中對齊（FB/X 連結卡）
    case "square":
    default:
      return { align: "middle", anchorY: "center" }; // 方形：置中（語錄卡）
  }
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export function composeLayout(req: ComposeLayoutReq): ComposeLayoutResult {
  const kit = req.brandKit ?? DEFAULT_BRAND_KIT;
  const seed = req.seed ?? 0;
  const { width: W, height: H } = req.preset;
  const warnings: string[] = [];

  const short = Math.min(W, H);
  const margin = Math.round(short * kit.layoutRules.safeMargin);
  const contentW = W - margin * 2;
  const box = layoutForOrientation(req.preset.orientation);
  const grad = gradientFor(kit, seed);

  // 字級：依品牌 scale，再按短邊縮放（讓海報/限動比例一致）。
  const baseUnit = short / 1080;
  const [s1, , s3, , s5] = kit.typography.scale;
  const sizeHead = Math.round((s1 ?? 88) * baseUnit);
  const sizeSub = Math.round((s3 ?? 34) * baseUnit);
  const sizeBody = Math.round((s5 ?? 16) * baseUnit * 1.25);
  const sizeCta = Math.round((s3 ?? 34) * baseUnit * 0.8);

  // 文字色：優先用品牌中性色（尊重品牌身份）；若在此底色對比不足（未達 AA-large），
  // 自動退到最可讀色並標 low_contrast —— 渲染恆可讀，同時誠實提醒「品牌色票在此底色不可讀、已自動替代」。
  const bgForText = grad.from;
  const neutral = swatch(kit, "neutral");
  let textColor: string;
  if (neutral && meetsAA(contrastRatio(neutral, bgForText), true)) {
    textColor = neutral;
  } else {
    textColor = bestTextColor(kit, bgForText);
    warnings.push("low_contrast");
  }
  const accent = swatch(kit, "accent") ?? "#E9C46A";

  // 換行（依各層字級換算每行最大「字數單位」）。
  const unitsFor = (px: number) => Math.max(6, Math.floor(contentW / px));
  const headLines = req.slots.headline ? wrapText(req.slots.headline, unitsFor(sizeHead)) : [];
  const subLines = req.slots.subhead ? wrapText(req.slots.subhead, unitsFor(sizeSub)) : [];
  const bodyLines = req.slots.body ? wrapText(req.slots.body, unitsFor(sizeBody)) : [];

  // 行高
  const lhHead = Math.round(sizeHead * 1.18);
  const lhSub = Math.round(sizeSub * 1.3);
  const lhBody = Math.round(sizeBody * 1.5);
  const gap = Math.round(short * 0.03);

  const blockH =
    headLines.length * lhHead +
    (subLines.length ? gap + subLines.length * lhSub : 0) +
    (bodyLines.length ? gap + bodyLines.length * lhBody : 0) +
    (req.slots.cta ? gap + Math.round(sizeCta * 2.2) : 0);

  if (blockH > H - margin * 2) warnings.push("overflow");

  // 起始 Y（依 anchorY）
  let y =
    box.anchorY === "top"
      ? margin + sizeHead
      : box.anchorY === "bottom"
        ? H - margin - blockH + sizeHead
        : (H - blockH) / 2 + sizeHead;

  // 對齊 X / text-anchor
  const anchor = box.align === "middle" ? "middle" : box.align === "end" ? "end" : "start";
  const x = box.align === "middle" ? W / 2 : box.align === "end" ? W - margin : margin;

  const headFamily = escapeXml(kit.typography.heading.family);
  const bodyFamily = escapeXml(kit.typography.body.family);
  const headWeight = kit.typography.heading.weight;

  // ── 組 SVG ──────────────────────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`,
  );
  // defs：漸層 + 底部壓暗 scrim（提升文字可讀性）
  parts.push(
    `<defs>` +
      `<linearGradient id="bg" gradientTransform="rotate(${grad.angle} .5 .5)">` +
      `<stop offset="0" stop-color="${escapeXml(grad.from)}"/>` +
      `<stop offset="1" stop-color="${escapeXml(grad.to)}"/></linearGradient>` +
      `<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>` +
      `</defs>`,
  );
  // 背景：漸層底 → 可選底圖（cover）→ scrim
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  if (req.backgroundAssetUrl) {
    parts.push(
      `<image href="${escapeXml(req.backgroundAssetUrl)}" width="${W}" height="${H}" ` +
        `preserveAspectRatio="xMidYMid slice" opacity="0.96"/>`,
    );
  }
  parts.push(`<rect width="${W}" height="${H}" fill="url(#scrim)"/>`);

  // 品牌鎖徽章
  if (req.brandLocked) {
    const bw = Math.round(short * 0.22);
    const bh = Math.round(short * 0.06);
    parts.push(
      `<g>` +
        `<rect x="${margin}" y="${margin}" rx="${bh / 2}" width="${bw}" height="${bh}" fill="${escapeXml(accent)}" opacity="0.92"/>` +
        `<text x="${margin + bh * 0.5}" y="${margin + bh * 0.7}" font-family="${bodyFamily}" font-size="${Math.round(bh * 0.5)}" fill="#04122B">${escapeXml("🔒 品牌鎖定")}</text>` +
        `</g>`,
    );
  }

  // badge（小標籤，置於標題上方）
  if (req.slots.badge) {
    parts.push(
      `<text x="${x}" y="${Math.max(margin + sizeSub, y - lhHead)}" text-anchor="${anchor}" ` +
        `font-family="${bodyFamily}" font-size="${sizeSub}" fill="${escapeXml(accent)}" letter-spacing="2">` +
        `${escapeXml(req.slots.badge)}</text>`,
    );
  }

  // headline
  for (const line of headLines) {
    parts.push(
      `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${headFamily}" ` +
        `font-size="${sizeHead}" font-weight="${headWeight}" fill="${escapeXml(textColor)}" ` +
        `style="paint-order:stroke" stroke="#000" stroke-opacity="0.18" stroke-width="${Math.max(1, sizeHead * 0.02)}">` +
        `${escapeXml(line)}</text>`,
    );
    y += lhHead;
  }

  // subhead
  if (subLines.length) {
    y += gap;
    for (const line of subLines) {
      parts.push(
        `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${bodyFamily}" ` +
          `font-size="${sizeSub}" fill="${escapeXml(textColor)}" opacity="0.95">${escapeXml(line)}</text>`,
      );
      y += lhSub;
    }
  }

  // body
  if (bodyLines.length) {
    y += gap;
    for (const line of bodyLines) {
      parts.push(
        `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${bodyFamily}" ` +
          `font-size="${sizeBody}" fill="${escapeXml(textColor)}" opacity="0.9">${escapeXml(line)}</text>`,
      );
      y += lhBody;
    }
  }

  // cta（強調膠囊）
  if (req.slots.cta) {
    y += gap;
    const ctaText = req.slots.cta;
    const ctaW = Math.round((visualWidth(ctaText) + 2) * sizeCta);
    const ctaH = Math.round(sizeCta * 2.0);
    const ctaX = box.align === "middle" ? (W - ctaW) / 2 : box.align === "end" ? W - margin - ctaW : margin;
    parts.push(
      `<g>` +
        `<rect x="${ctaX}" y="${y - sizeCta}" rx="${ctaH / 2}" width="${ctaW}" height="${ctaH}" fill="${escapeXml(accent)}"/>` +
        `<text x="${ctaX + ctaW / 2}" y="${y + sizeCta * 0.25}" text-anchor="middle" font-family="${bodyFamily}" ` +
        `font-size="${sizeCta}" font-weight="700" fill="#04122B">${escapeXml(ctaText)}</text>` +
        `</g>`,
    );
  }

  parts.push(`</svg>`);
  const svg = parts.join("");

  // 確定性雜湊：對「正規化輸入」而非輸出取雜湊（更穩定、與排版細節脫鉤）。
  const norm = JSON.stringify({
    t: req.templateId ?? "",
    k: kit.id + ":" + kit.version,
    s: req.slots,
    bg: req.backgroundAssetUrl ?? "",
    p: req.preset.id,
    seed,
    locked: !!req.brandLocked,
  });
  const contentHash = fnv1a(norm);

  return { svg, width: W, height: H, warnings, contentHash };
}

/** 把 SVG 包成可直接放 <img src> 的 data URL（前端預覽 / 下載）。 */
export function svgToDataUrl(svg: string): string {
  // 使用 encodeURIComponent 而非 btoa：對中文安全、且輸出確定性。
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
