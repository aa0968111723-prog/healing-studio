/**
 * AmbientSoundEngine.tsx — 環境白噪音系統
 *
 * 使用 Web Audio API 程序化生成 4 種場景音效：
 *   夜空 — 柔和白噪音 + 低頻嗡鳴 + 偶發蟋蟀聲
 *   晨光 — 鳥鳴模擬 + 輕柔風聲 + 溫暖 pad
 *   咖啡廳 — Lo-fi 環境音 + 杯碟輕響 + 低語人聲
 *   深海 — 深沉水流聲 + 氣泡音 + 低頻共鳴
 *
 * OARS 心理學合規：
 *   - Open-ended：不強制播放，使用者自主選擇啟動
 *   - Affirming：溫暖頻率偏好（中低頻為主），避免尖銳高頻
 *   - Reflective：音效反映當前環境情境，建立心理安全感
 *   - Summarizing：漸進式音量淡入（3s），場景切換平滑交叉淡出（2s）
 *
 * 瀏覽器自動播放政策：需使用者互動後才啟動 AudioContext。
 * 使用者偏好（音量、靜音狀態）透過 localStorage 記憶。
 */

import { useRef, useEffect, useCallback, useState, memo } from "react";
import type { SceneId } from "./AmbientEnvironment";

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "ambient-sound-prefs";
const FADE_IN_DURATION = 3; // seconds — OARS gentle introduction
const CROSSFADE_DURATION = 2; // seconds — smooth scene transition
const DEFAULT_VOLUME = 0.25;

interface SoundPrefs {
  volume: number;
  muted: boolean;
}

function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        volume:
          typeof parsed.volume === "number"
            ? Math.max(0, Math.min(1, parsed.volume))
            : DEFAULT_VOLUME,
        muted: typeof parsed.muted === "boolean" ? parsed.muted : true,
      };
    }
  } catch {
    /* ignore */
  }
  return { volume: DEFAULT_VOLUME, muted: true };
}

function savePrefs(prefs: SoundPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

// ─── Procedural Sound Generators ────────────────────────────────────────────

/** Create a white noise buffer */
function createNoiseBuffer(
  ctx: AudioContext,
  duration: number = 2
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Create a brown noise buffer (low-frequency weighted) */
function createBrownNoiseBuffer(
  ctx: AudioContext,
  duration: number = 2
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5; // normalize
  }
  return buffer;
}

/** Create a pink noise buffer */
function createPinkNoiseBuffer(
  ctx: AudioContext,
  duration: number = 2
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

// ─── Scene Sound Layer Definitions ──────────────────────────────────────────

interface SoundLayer {
  /** Create and connect nodes, return a gain node for volume control */
  create: (
    ctx: AudioContext,
    dest: AudioNode
  ) => { gain: GainNode; cleanup: () => void };
}

/** Night Sky: soft white noise + low drone + cricket chirps */
function createNightSkyLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Soft filtered white noise (wind)
  const noiseBuffer = createNoiseBuffer(ctx, 4);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;
  noiseSrc.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 800;
  noiseFilter.Q.value = 0.5;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.12;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(dest);
  noiseSrc.start();
  layers.push({
    gain: noiseGain,
    cleanup: () => {
      try {
        noiseSrc.stop();
      } catch {}
    },
  });

  // Layer 2: Low frequency drone (warm hum)
  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 55; // A1 — warm, grounding
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.04;
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 200;
  drone.connect(droneFilter).connect(droneGain).connect(dest);
  drone.start();
  layers.push({
    gain: droneGain,
    cleanup: () => {
      try {
        drone.stop();
      } catch {}
    },
  });

  // Layer 3: Cricket chirps (periodic oscillator bursts)
  let cricketInterval: ReturnType<typeof setInterval> | null = null;
  const cricketGain = ctx.createGain();
  cricketGain.gain.value = 0.03;
  cricketGain.connect(dest);

  cricketInterval = setInterval(
    () => {
      if (Math.random() > 0.4) return; // Only chirp sometimes
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 3800 + Math.random() * 800;
      const env = ctx.createGain();
      env.gain.value = 0;
      const now = ctx.currentTime;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.6, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(env).connect(cricketGain);
      osc.start(now);
      osc.stop(now + 0.1);
    },
    2000 + Math.random() * 3000
  );

  layers.push({
    gain: cricketGain,
    cleanup: () => {
      if (cricketInterval) clearInterval(cricketInterval);
    },
  });

  return layers;
}

/** Morning: bird chirps + gentle breeze + warm pad */
function createMorningLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Gentle breeze (pink noise, bandpassed)
  const pinkBuffer = createPinkNoiseBuffer(ctx, 4);
  const breezeSrc = ctx.createBufferSource();
  breezeSrc.buffer = pinkBuffer;
  breezeSrc.loop = true;
  const breezeFilter = ctx.createBiquadFilter();
  breezeFilter.type = "bandpass";
  breezeFilter.frequency.value = 400;
  breezeFilter.Q.value = 0.3;
  const breezeGain = ctx.createGain();
  breezeGain.gain.value = 0.08;
  breezeSrc.connect(breezeFilter).connect(breezeGain).connect(dest);
  breezeSrc.start();
  layers.push({
    gain: breezeGain,
    cleanup: () => {
      try {
        breezeSrc.stop();
      } catch {}
    },
  });

  // Layer 2: Warm pad (layered sine waves)
  const padGain = ctx.createGain();
  padGain.gain.value = 0.025;
  const padOscs: OscillatorNode[] = [];
  [261.6, 329.6, 392.0].forEach(freq => {
    // C4 major chord
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.3;
    osc.connect(oscGain).connect(padGain);
    osc.start();
    padOscs.push(osc);
  });
  padGain.connect(dest);
  layers.push({
    gain: padGain,
    cleanup: () =>
      padOscs.forEach(o => {
        try {
          o.stop();
        } catch {}
      }),
  });

  // Layer 3: Bird chirps
  let birdInterval: ReturnType<typeof setInterval> | null = null;
  const birdGain = ctx.createGain();
  birdGain.gain.value = 0.05;
  birdGain.connect(dest);

  birdInterval = setInterval(
    () => {
      if (Math.random() > 0.5) return;
      const baseFreq = 1800 + Math.random() * 1200;
      const chirpCount = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < chirpCount; c++) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const env = ctx.createGain();
        const startTime = ctx.currentTime + c * 0.12;
        osc.frequency.setValueAtTime(baseFreq, startTime);
        osc.frequency.linearRampToValueAtTime(baseFreq * 1.3, startTime + 0.05);
        osc.frequency.linearRampToValueAtTime(baseFreq * 0.9, startTime + 0.08);
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(0.4, startTime + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
        osc.connect(env).connect(birdGain);
        osc.start(startTime);
        osc.stop(startTime + 0.12);
      }
    },
    3000 + Math.random() * 4000
  );

  layers.push({
    gain: birdGain,
    cleanup: () => {
      if (birdInterval) clearInterval(birdInterval);
    },
  });

  return layers;
}

/** Café: lo-fi ambience + cup clinks + murmur */
function createCafeLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Lo-fi ambient noise (brown noise, heavily filtered)
  const brownBuffer = createBrownNoiseBuffer(ctx, 4);
  const lofiSrc = ctx.createBufferSource();
  lofiSrc.buffer = brownBuffer;
  lofiSrc.loop = true;
  const lofiFilter = ctx.createBiquadFilter();
  lofiFilter.type = "lowpass";
  lofiFilter.frequency.value = 600;
  lofiFilter.Q.value = 0.8;
  const lofiGain = ctx.createGain();
  lofiGain.gain.value = 0.1;
  lofiSrc.connect(lofiFilter).connect(lofiGain).connect(dest);
  lofiSrc.start();
  layers.push({
    gain: lofiGain,
    cleanup: () => {
      try {
        lofiSrc.stop();
      } catch {}
    },
  });

  // Layer 2: Murmur (filtered pink noise simulating distant voices)
  const murmurBuffer = createPinkNoiseBuffer(ctx, 4);
  const murmurSrc = ctx.createBufferSource();
  murmurSrc.buffer = murmurBuffer;
  murmurSrc.loop = true;
  const murmurBP = ctx.createBiquadFilter();
  murmurBP.type = "bandpass";
  murmurBP.frequency.value = 300;
  murmurBP.Q.value = 2;
  const murmurGain = ctx.createGain();
  murmurGain.gain.value = 0.04;
  // Add subtle modulation for "voice-like" quality
  const murmurLFO = ctx.createOscillator();
  murmurLFO.type = "sine";
  murmurLFO.frequency.value = 0.3;
  const murmurLFOGain = ctx.createGain();
  murmurLFOGain.gain.value = 80;
  murmurLFO.connect(murmurLFOGain).connect(murmurBP.frequency);
  murmurLFO.start();
  murmurSrc.connect(murmurBP).connect(murmurGain).connect(dest);
  murmurSrc.start();
  layers.push({
    gain: murmurGain,
    cleanup: () => {
      try {
        murmurSrc.stop();
      } catch {}
      try {
        murmurLFO.stop();
      } catch {}
    },
  });

  // Layer 3: Cup clinks (high-frequency short bursts)
  let clinkInterval: ReturnType<typeof setInterval> | null = null;
  const clinkGain = ctx.createGain();
  clinkGain.gain.value = 0.03;
  clinkGain.connect(dest);

  clinkInterval = setInterval(
    () => {
      if (Math.random() > 0.3) return;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 2000 + Math.random() * 2000;
      const env = ctx.createGain();
      const now = ctx.currentTime;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.3, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      const clinkFilter = ctx.createBiquadFilter();
      clinkFilter.type = "highpass";
      clinkFilter.frequency.value = 1500;
      osc.connect(env).connect(clinkFilter).connect(clinkGain);
      osc.start(now);
      osc.stop(now + 0.2);
    },
    4000 + Math.random() * 6000
  );

  layers.push({
    gain: clinkGain,
    cleanup: () => {
      if (clinkInterval) clearInterval(clinkInterval);
    },
  });

  return layers;
}

/** Deep Sea: water flow + bubbles + low resonance */
function createDeepSeaLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Deep water flow (brown noise, very low-passed)
  const brownBuffer = createBrownNoiseBuffer(ctx, 4);
  const waterSrc = ctx.createBufferSource();
  waterSrc.buffer = brownBuffer;
  waterSrc.loop = true;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = "lowpass";
  waterFilter.frequency.value = 300;
  waterFilter.Q.value = 1;
  // Slow modulation for wave-like movement
  const waterLFO = ctx.createOscillator();
  waterLFO.type = "sine";
  waterLFO.frequency.value = 0.1;
  const waterLFOGain = ctx.createGain();
  waterLFOGain.gain.value = 100;
  waterLFO.connect(waterLFOGain).connect(waterFilter.frequency);
  waterLFO.start();
  const waterGain = ctx.createGain();
  waterGain.gain.value = 0.15;
  waterSrc.connect(waterFilter).connect(waterGain).connect(dest);
  waterSrc.start();
  layers.push({
    gain: waterGain,
    cleanup: () => {
      try {
        waterSrc.stop();
      } catch {}
      try {
        waterLFO.stop();
      } catch {}
    },
  });

  // Layer 2: Low resonance drone
  const resGain = ctx.createGain();
  resGain.gain.value = 0.035;
  const resOscs: OscillatorNode[] = [];
  [40, 60].forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.5;
    osc.connect(oscGain).connect(resGain);
    osc.start();
    resOscs.push(osc);
  });
  resGain.connect(dest);
  layers.push({
    gain: resGain,
    cleanup: () =>
      resOscs.forEach(o => {
        try {
          o.stop();
        } catch {}
      }),
  });

  // Layer 3: Bubble sounds
  let bubbleInterval: ReturnType<typeof setInterval> | null = null;
  const bubbleGain = ctx.createGain();
  bubbleGain.gain.value = 0.04;
  bubbleGain.connect(dest);

  bubbleInterval = setInterval(
    () => {
      const bubbleCount = 1 + Math.floor(Math.random() * 3);
      for (let b = 0; b < bubbleCount; b++) {
        const delay = b * (0.1 + Math.random() * 0.2);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const startFreq = 200 + Math.random() * 400;
        const env = ctx.createGain();
        const startTime = ctx.currentTime + delay;
        osc.frequency.setValueAtTime(startFreq, startTime);
        osc.frequency.exponentialRampToValueAtTime(
          startFreq * 2.5,
          startTime + 0.06
        );
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
        osc.connect(env).connect(bubbleGain);
        osc.start(startTime);
        osc.stop(startTime + 0.15);
      }
    },
    2000 + Math.random() * 3000
  );

  layers.push({
    gain: bubbleGain,
    cleanup: () => {
      if (bubbleInterval) clearInterval(bubbleInterval);
    },
  });

  return layers;
}

// ─── Scene Factory Map ──────────────────────────────────────────────────────

const SCENE_SOUND_FACTORIES: Record<
  SceneId,
  (
    ctx: AudioContext,
    dest: AudioNode
  ) => Array<{ gain: GainNode; cleanup: () => void }>
> = {
  nightSky: createNightSkyLayers,
  morning: createMorningLayers,
  cafe: createCafeLayers,
  deepSea: createDeepSeaLayers,
};

// ─── Hook: useAmbientSound ─────────────────────────────────────────────────

export interface AmbientSoundControls {
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether user has muted */
  isMuted: boolean;
  /** Current volume 0–1 */
  volume: number;
  /** Whether AudioContext has been unlocked by user interaction */
  isUnlocked: boolean;
  /** Toggle mute on/off */
  toggleMute: () => void;
  /** Set volume 0–1 */
  setVolume: (v: number) => void;
  /** Unlock AudioContext (call from user interaction handler) */
  unlock: () => void;
}

export function useAmbientSound(sceneId: SceneId): AmbientSoundControls {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const layersRef = useRef<Array<{ gain: GainNode; cleanup: () => void }>>([]);
  const prevSceneRef = useRef<SceneId | null>(null);

  const [prefs, setPrefs] = useState<SoundPrefs>(loadPrefs);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Persist prefs
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Initialize AudioContext on unlock
  const unlock = useCallback(() => {
    if (ctxRef.current) {
      if (ctxRef.current.state === "suspended") {
        ctxRef.current.resume();
      }
      setIsUnlocked(true);
      return;
    }
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0; // Start silent, will fade in
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;
      setIsUnlocked(true);
    } catch (e) {
      console.warn("[AmbientSound] Failed to create AudioContext:", e);
    }
  }, []);

  // Build / swap scene layers
  useEffect(() => {
    const ctx = ctxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain || !isUnlocked) return;

    // If same scene, skip
    if (prevSceneRef.current === sceneId) return;
    const prevScene = prevSceneRef.current;
    prevSceneRef.current = sceneId;

    // Fade out old layers
    const oldLayers = [...layersRef.current];
    if (oldLayers.length > 0) {
      const now = ctx.currentTime;
      oldLayers.forEach(({ gain, cleanup }) => {
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_DURATION);
        setTimeout(() => cleanup(), CROSSFADE_DURATION * 1000 + 200);
      });
    }

    // Create new layers
    const factory = SCENE_SOUND_FACTORIES[sceneId];
    const newLayers = factory(ctx, masterGain);
    layersRef.current = newLayers;

    // OARS gentle fade-in: if first activation, use longer fade; otherwise crossfade
    const fadeTime = prevScene === null ? FADE_IN_DURATION : CROSSFADE_DURATION;
    const now = ctx.currentTime;

    // Set master gain based on mute state
    if (!prefs.muted) {
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(prefs.volume, now + fadeTime);
      setIsPlaying(true);
    }
  }, [sceneId, isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update master volume when prefs change
  useEffect(() => {
    const ctx = ctxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain || !isUnlocked) return;

    const now = ctx.currentTime;
    if (prefs.muted) {
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.5);
      setIsPlaying(false);
    } else {
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(prefs.volume, now + 0.5);
      setIsPlaying(true);
    }
  }, [prefs.volume, prefs.muted, isUnlocked]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      layersRef.current.forEach(({ cleanup }) => cleanup());
      layersRef.current = [];
      if (ctxRef.current) {
        try {
          ctxRef.current.close();
        } catch {}
        ctxRef.current = null;
      }
    };
  }, []);

  // Pause/resume on visibility change
  useEffect(() => {
    function handleVisibility() {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.hidden) {
        ctx.suspend();
      } else if (!prefs.muted && isUnlocked) {
        ctx.resume();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [prefs.muted, isUnlocked]);

  const toggleMute = useCallback(() => {
    setPrefs(prev => ({ ...prev, muted: !prev.muted }));
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setPrefs(prev => ({ ...prev, volume: clamped, muted: clamped === 0 }));
  }, []);

  return {
    isPlaying,
    isMuted: prefs.muted,
    volume: prefs.volume,
    isUnlocked,
    toggleMute,
    unlock,
    setVolume,
  };
}

// ─── Sound Control UI Component ─────────────────────────────────────────────

interface SoundControlProps {
  controls: AmbientSoundControls;
  isDark: boolean;
}

export const SoundControl = memo(function SoundControl({
  controls,
  isDark,
}: SoundControlProps) {
  const {
    isPlaying,
    isMuted,
    volume,
    isUnlocked,
    toggleMute,
    setVolume,
    unlock,
  } = controls;
  const [showSlider, setShowSlider] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close slider on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSlider(false);
      }
    }
    if (showSlider) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showSlider]);

  const handleMainClick = () => {
    if (!isUnlocked) {
      unlock();
      // Auto-unmute on first unlock
      if (isMuted) toggleMute();
      return;
    }
    toggleMute();
  };

  const bgClass = isDark
    ? "bg-white/10 hover:bg-white/15"
    : "bg-black/5 hover:bg-black/10";
  const textClass = isDark ? "text-white/80" : "text-black/60";
  const sliderBg = isDark ? "bg-white/10" : "bg-black/5";
  const sliderFill = isDark ? "bg-white/60" : "bg-black/30";

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      {/* Volume slider (expandable) */}
      {showSlider && isUnlocked && (
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md ${sliderBg} transition-all duration-300`}
        >
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={e => setVolume(Number(e.target.value) / 100)}
            className="w-16 h-1 appearance-none rounded-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.3)"} ${volume * 100}%, ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)"} ${volume * 100}%)`,
            }}
          />
          <span className={`text-[10px] font-mono ${textClass} w-6 text-right`}>
            {Math.round(volume * 100)}
          </span>
        </div>
      )}

      {/* Main button */}
      <button
        onClick={handleMainClick}
        onContextMenu={e => {
          e.preventDefault();
          if (isUnlocked) setShowSlider(v => !v);
        }}
        onMouseEnter={() => {
          if (isUnlocked) setShowSlider(true);
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full backdrop-blur-md transition-all duration-300 ${bgClass} ${textClass} cursor-pointer`}
        title={!isUnlocked ? "點擊啟動環境音效" : isMuted ? "取消靜音" : "靜音"}
      >
        {/* Sound icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {!isUnlocked || isMuted ? (
            <>
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </>
          ) : (
            <>
              <path
                d="M15.54 8.46a5 5 0 0 1 0 7.07"
                opacity={volume > 0.3 ? 1 : 0.3}
              />
              <path
                d="M19.07 4.93a10 10 0 0 1 0 14.14"
                opacity={volume > 0.6 ? 1 : 0.3}
              />
            </>
          )}
        </svg>
        <span className="text-[10px] font-medium">
          {!isUnlocked ? "環境音" : isMuted ? "靜音" : "播放中"}
        </span>
      </button>
    </div>
  );
});

export default SoundControl;
