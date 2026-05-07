interface Props {
  /** Approximate height in CSS units. */
  height?: number;
  /** Tint of the shimmer wave. */
  color?: string;
  /** Optional label rendered centred over the skeleton. */
  label?: string;
}

/**
 * Cinematic skeleton placeholder used as Suspense fallback for the
 * lazy-loaded Bento and Showcase blocks.  A soft tinted block hosts a
 * shimmer wave sweeping left → right, replacing the previous bare
 * spinner.
 */
export default function SectionShimmerSkeleton({
  height = 320,
  color = "rgba(168,85,247,0.15)",
  label,
}: Props) {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden mx-auto my-8 sm:my-12 max-w-5xl rounded-2xl"
      style={{
        height,
        background: `linear-gradient(135deg, ${color} 0%, transparent 80%)`,
        border: `1px solid ${color}`,
      }}
    >
      {/* Sweeping shimmer wave */}
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmerSweep_2.4s_ease-in-out_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
        }}
      />
      {label && (
        <div className="absolute inset-0 flex items-center justify-center text-xs tracking-[0.3em] uppercase text-current opacity-50">
          {label}
        </div>
      )}
      <style>{`
        @keyframes shimmerSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
