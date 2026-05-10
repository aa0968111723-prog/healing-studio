import { describe, expect, it } from "vitest";
import {
  renderNoteMarkdown,
  renderNotesJson,
  renderCombinedMarkdown,
  type ExportableNote,
} from "@/lib/noteExports";

const fixtureNote = (overrides: Partial<ExportableNote> = {}): ExportableNote => ({
  id: 42,
  title: "深度研究 - 創作排程",
  content: "## 重點\n- 第一條\n- 第二條",
  noteType: "note",
  status: "in_progress",
  scheduledDate: new Date("2026-05-12T01:00:00.000Z"),
  tags: ["研究", "Q2"],
  scriptJson: null,
  createdAt: new Date("2026-05-10T00:00:00.000Z"),
  updatedAt: new Date("2026-05-10T03:00:00.000Z"),
  ...overrides,
});

describe("renderNoteMarkdown", () => {
  it("emits a YAML frontmatter block that Obsidian / Logseq can parse", () => {
    const md = renderNoteMarkdown(fixtureNote());
    expect(md.startsWith("---\n")).toBe(true);
    // Frontmatter block must contain the structured fields.
    expect(md).toMatch(/title: "深度研究 - 創作排程"/);
    expect(md).toMatch(/type: note/);
    expect(md).toMatch(/status: in_progress/);
    expect(md).toMatch(/scheduled: 2026-05-12T01:00:00.000Z/);
    expect(md).toMatch(/created: 2026-05-10T00:00:00.000Z/);
    expect(md).toMatch(/source: healing-studio/);
    // Tags rendered as a YAML array (Obsidian Properties / Logseq friendly)
    expect(md).toMatch(/tags:\n {2}- "研究"\n {2}- "Q2"/);
  });

  it("renders the body and a Bear-friendly inline tag footer", () => {
    const md = renderNoteMarkdown(fixtureNote());
    expect(md).toContain("# 深度研究 - 創作排程");
    expect(md).toContain("## 重點");
    expect(md).toContain("- 第一條");
    expect(md).toContain("#研究 #Q2");
  });

  it("escapes embedded quotes and backslashes in the YAML title", () => {
    const md = renderNoteMarkdown(
      fixtureNote({ title: 'tricky "quoted" \\ title' })
    );
    expect(md).toContain('title: "tricky \\"quoted\\" \\\\ title"');
  });

  it("includes a code-fenced JSON block when scriptJson is present", () => {
    const md = renderNoteMarkdown(
      fixtureNote({ scriptJson: { context: "C", objective: "O" } })
    );
    expect(md).toContain("## CO-STAR 腳本");
    expect(md).toContain("```json");
    expect(md).toContain('"context": "C"');
  });

  it("falls back to status=todo when not provided", () => {
    const md = renderNoteMarkdown(fixtureNote({ status: null }));
    expect(md).toMatch(/status: todo/);
  });
});

describe("renderNotesJson", () => {
  it("produces a versioned, ISO-string backup", () => {
    const json = renderNotesJson([fixtureNote()]);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("healing-studio.notes.v1");
    expect(parsed.count).toBe(1);
    expect(parsed.notes[0]).toMatchObject({
      id: 42,
      title: "深度研究 - 創作排程",
      noteType: "note",
      status: "in_progress",
      tags: ["研究", "Q2"],
      scheduledDate: "2026-05-12T01:00:00.000Z",
      createdAt: "2026-05-10T00:00:00.000Z",
    });
  });

  it("normalises missing fields without crashing", () => {
    const json = renderNotesJson([
      fixtureNote({ status: null, tags: null, scheduledDate: null, updatedAt: null }),
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.notes[0].status).toBe("todo");
    expect(parsed.notes[0].tags).toEqual([]);
    expect(parsed.notes[0].scheduledDate).toBeNull();
    expect(parsed.notes[0].updatedAt).toBeNull();
  });
});

describe("renderCombinedMarkdown", () => {
  it("produces one document with header + per-note sections", () => {
    const md = renderCombinedMarkdown([
      fixtureNote(),
      fixtureNote({ id: 43, title: "另一篇", tags: [] }),
    ]);
    expect(md).toContain("# Healing Studio 筆記匯出");
    expect(md).toContain("共 2 則");
    expect(md).toContain("# 深度研究 - 創作排程");
    expect(md).toContain("# 另一篇");
  });
});
