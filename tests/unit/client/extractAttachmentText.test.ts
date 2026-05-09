/**
 * extractAttachmentText.test.ts
 *
 * Lock the docx text-extraction regex against Word's actual output. Earlier
 * versions of `extractDocxText` only matched the literal `<w:p/>` shape and
 * silently dropped self-closing paragraphs that carried `w14:paraId`
 * attributes — which Word always emits for empty paragraphs / scene
 * separators. Without this test, F5 from the orb audit can regress.
 *
 * @vitest-environment jsdom
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractAttachmentText } from "../../../client/src/lib/extractAttachmentText";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildDocxFile(documentXml: string): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`
  );
  zip.file("word/document.xml", documentXml);
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "script.docx", { type: DOCX_MIME });
}

describe("extractAttachmentText (docx)", () => {
  it("preserves self-closing empty paragraphs (Word w14:paraId scene separators)", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="00000001"><w:r><w:t>Scene one</w:t></w:r></w:p>
    <w:p w14:paraId="00000002"/>
    <w:p w14:paraId="00000003"/>
    <w:p w14:paraId="00000004"><w:r><w:t>Scene two</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const file = await buildDocxFile(xml);
    const text = await extractAttachmentText(file, DOCX_MIME);
    expect(text).toContain("Scene one");
    expect(text).toContain("Scene two");
    // The two empty paragraphs collapse to a single blank line via
    // `\n{3,}` -> `\n\n` clamp, but there must be at least one between
    // the scenes.
    expect(text).toMatch(/Scene one\s*\n\s*Scene two/);
    expect(text.indexOf("Scene one")).toBeLessThan(text.indexOf("Scene two"));
  });

  it("converts <w:br/> with attributes into newlines", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Line A</w:t><w:br w:type="textWrapping"/><w:t>Line B</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const file = await buildDocxFile(xml);
    const text = await extractAttachmentText(file, DOCX_MIME);
    expect(text).toMatch(/Line A\s*\n\s*Line B/);
  });

  it("decodes XML entities so & < > emerge correctly", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>A &amp; B &lt;C&gt; D</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const file = await buildDocxFile(xml);
    const text = await extractAttachmentText(file, DOCX_MIME);
    expect(text).toContain("A & B <C> D");
  });
});
