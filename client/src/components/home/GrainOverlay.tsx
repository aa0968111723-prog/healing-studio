interface Props {
  /** 0–1, defaults to 0.06 (subtle). */
  opacity?: number;
}

/**
 * Inline SVG film-grain texture.  Sits as a fixed full-viewport overlay
 * with `mix-blend-mode: overlay`, adding a barely-visible tactile layer
 * to the entire homepage so flat gradient backgrounds feel premium.
 *
 * SVG is inlined as a data URL — no external request, no Cumulative Layout
 * Shift, and the noise pattern is reproducible across reloads.
 */
export default function GrainOverlay({ opacity = 0.06 }: Props) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>
    <filter id='n'>
      <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>
      <feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/>
    </filter>
    <rect width='100%' height='100%' filter='url(#n)'/>
  </svg>`;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[55]"
      style={{
        opacity,
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        backgroundSize: "240px 240px",
        mixBlendMode: "overlay",
      }}
    />
  );
}
