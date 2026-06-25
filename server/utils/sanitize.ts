import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["b", "i", "u", "strong", "em", "p", "br", "ul", "ol", "li", "a", "code", "pre", "blockquote", "h1", "h2", "h3", "h4"];

/**
 * Strip dangerous HTML from user-supplied rich text before storing to DB.
 * Allows a safe subset of formatting tags; removes scripts, event handlers, etc.
 * Applied at the server boundary so the sanitized value is what gets persisted.
 */
export function sanitizeRichText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS, ALLOWED_ATTR: ["href", "target"] });
}

/**
 * Strip ALL HTML tags — for plain-text fields that should never contain markup
 * (titles, summaries, labels). Simpler and stricter than sanitizeRichText.
 */
export function sanitizePlainText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
