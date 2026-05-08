export type SceneVignetteId = "nightSky" | "morning" | "cafe" | "deepSea";

const TOP_TINT: Record<SceneVignetteId, string> = {
  nightSky: "rgba(56,88,170,0.28)",
  morning: "rgba(255,237,213,0.45)",
  cafe: "rgba(120,72,40,0.30)",
  deepSea: "rgba(36,112,158,0.24)",
};

const BOTTOM_TINT: Record<SceneVignetteId, string> = {
  nightSky: "rgba(34,50,120,0.30)",
  morning: "rgba(254,215,170,0.55)",
  cafe: "rgba(60,40,20,0.45)",
  deepSea: "rgba(20,74,130,0.28)",
};

interface Props {
  sceneId: SceneVignetteId;
}

/**
 * Top-and-bottom soft gradient inset that gives each scene unique edge
 * shading.  Sits underneath the content but above the ambient particle
 * canvas, deepening the sense of "place" without obscuring the scene
 * particles in the middle band.
 */
export default function SceneVignette({ sceneId }: Props) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[5]"
      style={{
        background: `linear-gradient(180deg, ${TOP_TINT[sceneId]} 0%, transparent 22%, transparent 78%, ${BOTTOM_TINT[sceneId]} 100%)`,
        transition: "background 1s ease",
      }}
    />
  );
}
