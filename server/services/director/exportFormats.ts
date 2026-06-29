/**
 * Director script export formatters.
 *
 * Extracted from server/routers/director.ts so the router file can stay
 * focused on tRPC procedure wiring. Pure functions, no DB or LLM
 * dependencies.
 */

import type { ScriptSegment } from "../../../shared/types";
import { sanitizeCsvCell } from "../../../shared/csv-safe";

export function generateExport(
  segments: ScriptSegment[],
  format: string,
  options: {
    customColumns?: Array<{ header: string; field: string }>;
    includeDiscussion?: boolean;
    includeCostar?: boolean;
    customTemplate?: string;
  }
): string {
  switch (format) {
    case "json":
      return JSON.stringify(
        segments.map(seg => ({
          index: seg.index,
          ...seg.storyboard,
          rawText: seg.rawText,
          status: seg.status,
          ...(options.includeCostar && seg.costar
            ? { costar: seg.costar }
            : {}),
          ...(options.includeDiscussion ? { discussion: seg.discussion } : {}),
        })),
        null,
        2
      );

    case "csv": {
      const cols = options.customColumns ?? [
        { header: "序號", field: "index" },
        { header: "場景", field: "sceneHeading" },
        { header: "視覺描述", field: "visualDescription" },
        { header: "對白", field: "dialogue" },
        { header: "音效", field: "soundDesign" },
        { header: "鏡頭", field: "cameraDirection" },
        { header: "時長", field: "duration" },
        { header: "氛圍", field: "mood" },
        { header: "狀態", field: "status" },
      ];
      // 公式注入中和 + RFC-4180 引號跳脫統一走 @shared/csv-safe（對白/視覺描述等
      // 皆為使用者/AI 可控內容，原 escapeCSV 只引號跳脫未防公式注入）— AIDV-562
      const escapeCSV = (val: string) => sanitizeCsvCell(val);
      const header = cols.map(c => escapeCSV(c.header)).join(",");
      const rows = segments.map(seg => {
        const flat: Record<string, string> = {
          index: String(seg.index + 1),
          ...seg.storyboard,
          rawText: seg.rawText,
          status: seg.status,
        };
        return cols.map(c => escapeCSV(flat[c.field] ?? "")).join(",");
      });
      return [header, ...rows].join("\n");
    }

    case "markdown": {
      return segments
        .map((seg, i) => {
          const lines = [
            `## 分鏡 ${i + 1}：${seg.storyboard.sceneHeading}`,
            "",
            `**視覺描述：** ${seg.storyboard.visualDescription}`,
            "",
            seg.storyboard.dialogue
              ? `**對白：**\n> ${seg.storyboard.dialogue.replace(/\n/g, "\n> ")}`
              : "",
            "",
            `**音效設計：** ${seg.storyboard.soundDesign}`,
            `**鏡頭運動：** ${seg.storyboard.cameraDirection}`,
            `**預估時長：** ${seg.storyboard.duration}`,
            `**情緒氛圍：** ${seg.storyboard.mood}`,
            `**狀態：** ${seg.status}`,
          ];
          if (options.includeDiscussion && seg.discussion.length > 0) {
            lines.push("", "### 討論紀錄", "");
            seg.discussion.forEach(d => {
              lines.push(
                `- **${d.role === "user" ? "使用者" : "導演"}**：${d.content}`
              );
            });
          }
          return lines.filter(Boolean).join("\n");
        })
        .join("\n\n---\n\n");
    }

    case "srt": {
      let timeOffset = 0;
      return segments
        .map((seg, i) => {
          const durationSec = parseDurationToSeconds(seg.storyboard.duration);
          const start = formatSrtTime(timeOffset);
          const end = formatSrtTime(timeOffset + durationSec);
          timeOffset += durationSec;
          const text =
            seg.storyboard.dialogue || seg.storyboard.visualDescription;
          return `${i + 1}\n${start} --> ${end}\n${text}`;
        })
        .join("\n\n");
    }

    case "fdx": {
      const elements = segments
        .map(seg => {
          const parts: string[] = [];
          if (seg.storyboard.sceneHeading) {
            parts.push(
              `    <Paragraph Type="Scene Heading"><Text>${escapeXml(seg.storyboard.sceneHeading)}</Text></Paragraph>`
            );
          }
          if (seg.storyboard.visualDescription) {
            parts.push(
              `    <Paragraph Type="Action"><Text>${escapeXml(seg.storyboard.visualDescription)}</Text></Paragraph>`
            );
          }
          if (seg.storyboard.dialogue) {
            parts.push(
              `    <Paragraph Type="Dialogue"><Text>${escapeXml(seg.storyboard.dialogue)}</Text></Paragraph>`
            );
          }
          return parts.join("\n");
        })
        .join("\n");
      return `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No">\n  <Content>\n${elements}\n  </Content>\n</FinalDraft>`;
    }

    case "custom": {
      if (!options.customTemplate) return JSON.stringify(segments, null, 2);
      return segments
        .map((seg, i) => {
          let out = options.customTemplate!;
          out = out.replace(/\{\{index\}\}/g, String(i + 1));
          out = out.replace(
            /\{\{sceneHeading\}\}/g,
            seg.storyboard.sceneHeading
          );
          out = out.replace(
            /\{\{visualDescription\}\}/g,
            seg.storyboard.visualDescription
          );
          out = out.replace(/\{\{dialogue\}\}/g, seg.storyboard.dialogue);
          out = out.replace(/\{\{soundDesign\}\}/g, seg.storyboard.soundDesign);
          out = out.replace(
            /\{\{cameraDirection\}\}/g,
            seg.storyboard.cameraDirection
          );
          out = out.replace(/\{\{duration\}\}/g, seg.storyboard.duration);
          out = out.replace(/\{\{mood\}\}/g, seg.storyboard.mood);
          out = out.replace(/\{\{status\}\}/g, seg.status);
          out = out.replace(/\{\{rawText\}\}/g, seg.rawText);
          return out;
        })
        .join("\n\n");
    }

    default:
      return JSON.stringify(segments, null, 2);
  }
}

export function parseDurationToSeconds(duration: string): number {
  const minMatch = duration.match(/(\d+)\s*分/);
  const secMatch = duration.match(/(\d+)\s*秒/);
  const numMatch = duration.match(/^(\d+(?:\.\d+)?)$/);
  let total = 0;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  if (!minMatch && !secMatch && numMatch) total = parseFloat(numMatch[1]);
  return total || 5;
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
