/**
 * ChatMessageText.tsx — Render a chat message string with clickable links and
 * (optionally) intent-option cards.
 *
 * The orb may include URLs in its text replies (`/process?spec=…`,
 * `https://example.com/...`). We don't want full markdown — just enough so
 * those URLs become real anchors instead of raw text users have to copy.
 *
 * When an `onIntentSelect` callback is supplied, we additionally pull out any
 * `**選項 X：…**` blocks and render them as clickable IntentCardOptions so the
 * user can pick instead of retyping. See `lib/intentOptions.ts`.
 *
 * Internal SPA paths (starting with `/`) navigate via wouter so we don't
 * full-reload the page; absolute URLs open in a new tab.
 */

import { Fragment, useMemo } from "react";
import { useLocation } from "wouter";
import { ExternalLink } from "lucide-react";
import IntentCardOptions from "./IntentCardOptions";
import {
  parseIntentSegments,
  type IntentOption,
} from "@/lib/intentOptions";

interface Props {
  text: string;
  /** Optional className applied to each anchor for tone alignment with the bubble. */
  linkClassName?: string;
  /**
   * When provided, intent-option blocks (`**選項 A：…**`) are rendered as
   * clickable cards. The callback receives the option's reconstructed text
   * (e.g. "選項 A：繼續風景圖創作"). Omit on user messages to leave them
   * as-is.
   */
  onIntentSelect?: (option: IntentOption) => void;
  /** Render intent cards in compact mode (smaller paddings/text). */
  intentCompact?: boolean;
  /** Disable intent cards (e.g. while a request is in-flight). */
  intentDisabled?: boolean;
}

const URL_PATTERN =
  /(\bhttps?:\/\/[^\s<>"']+|(?<!\S)\/[A-Za-z0-9/_\-?=&%.~+#]+)/g;

interface Segment {
  kind: "text" | "link";
  value: string;
}

function splitSegments(text: string): Segment[] {
  if (!text) return [];
  const out: Segment[] = [];
  let lastIndex = 0;
  // Use exec in a loop instead of matchAll() so we don't depend on
  // downlevel-iteration of RegExpStringIterator.
  const re = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      out.push({ kind: "text", value: text.slice(lastIndex, start) });
    }
    out.push({ kind: "link", value: match[0] });
    lastIndex = start + match[0].length;
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return out;
}

function isInternalLink(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function trimTrailingPunct(url: string): { url: string; tail: string } {
  // Don't drag trailing punctuation into the link target.
  const match = url.match(/[.,;:!?）)】」』」]+$/);
  if (!match) return { url, tail: "" };
  return { url: url.slice(0, -match[0].length), tail: match[0] };
}

interface PlainTextProps {
  text: string;
  linkClassName?: string;
}

function PlainTextWithLinks({ text, linkClassName }: PlainTextProps) {
  const [, navigate] = useLocation();
  const segments = useMemo(() => splitSegments(text), [text]);

  if (segments.length === 0) return <>{text}</>;

  const baseLinkClass =
    linkClassName ??
    "underline decoration-cyan-300 underline-offset-2 hover:text-cyan-600 inline-flex items-center gap-0.5";

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <Fragment key={i}>{seg.value}</Fragment>;
        const { url, tail } = trimTrailingPunct(seg.value);
        if (isInternalLink(url)) {
          return (
            <Fragment key={i}>
              <a
                href={url}
                onClick={e => {
                  e.preventDefault();
                  navigate(url);
                }}
                className={baseLinkClass}
              >
                {url}
              </a>
              {tail}
            </Fragment>
          );
        }
        return (
          <Fragment key={i}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className={baseLinkClass}
            >
              {url}
              <ExternalLink className="w-3 h-3" />
            </a>
            {tail}
          </Fragment>
        );
      })}
    </>
  );
}

export default function ChatMessageText({
  text,
  linkClassName,
  onIntentSelect,
  intentCompact,
  intentDisabled,
}: Props) {
  // Without an intent handler we fall through to the plain link renderer —
  // keeps user messages and other contexts unchanged.
  const intentSegments = useMemo(
    () => (onIntentSelect ? parseIntentSegments(text) : null),
    [text, onIntentSelect]
  );

  if (!intentSegments || !intentSegments.some(s => s.kind === "options")) {
    return <PlainTextWithLinks text={text} linkClassName={linkClassName} />;
  }

  return (
    <>
      {intentSegments.map((seg, i) => {
        if (seg.kind === "options") {
          return (
            <IntentCardOptions
              key={`opts-${i}`}
              options={seg.options}
              onSelect={onIntentSelect!}
              compact={intentCompact}
              disabled={intentDisabled}
            />
          );
        }
        return (
          <PlainTextWithLinks
            key={`txt-${i}`}
            text={seg.value}
            linkClassName={linkClassName}
          />
        );
      })}
    </>
  );
}
