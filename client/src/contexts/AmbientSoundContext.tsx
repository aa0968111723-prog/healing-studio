import { createContext, useContext, type ReactNode } from "react";
import { useCurrentScene } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import { useAmbientSound } from "@/components/AmbientSoundEngine";
import type { AmbientSoundControls } from "@/components/AmbientSoundEngine";

export interface AmbientContextValue extends AmbientSoundControls {
  sceneId: SceneId;
  isDark: boolean;
  override: SceneId | null;
  setOverride: (scene: SceneId | null) => void;
  allScenes: { id: SceneId; label: string }[];
}

const AmbientContext = createContext<AmbientContextValue | null>(null);

/** Merges scene state + ambient sound state into a single global provider. */
export function AmbientProvider({ children }: { children: ReactNode }) {
  const scene = useCurrentScene();
  const sound = useAmbientSound(scene.sceneId);

  return (
    <AmbientContext.Provider value={{ ...scene, ...sound }}>
      {children}
    </AmbientContext.Provider>
  );
}

export function useAmbient(): AmbientContextValue {
  const ctx = useContext(AmbientContext);
  if (!ctx) throw new Error("useAmbient must be used within AmbientProvider");
  return ctx;
}
