/**
 * AmbientSoundEngine.tsx — 輕音樂禪意音景系統
 *
 * 使用 Web Audio API 程序化生成 4 種場景音效，
 * 風格追求靜謐、空靈、帶有禪意 (Zen) 的療癒氛圍：
 *
 *   夜空 — 空靈五聲音階 Pad + 頌缽泛音微光 + 柔和夜風
 *   晨光 — 溫暖七和弦 Pad + 輕柔鳥鳴 + 晨間微風
 *   咖啡廳 — Lo-fi 棕噪音底噪 + 低語人聲模擬 + 輕巧杯碟聲
 *   深海 — 雙重調變海流 + 鯨歌低頻共鳴 + 溫柔氣泡音
 *
 * OARS 心理學合規：
 *   - Open-ended：不強制播放，使用者自主選擇啟動
 *   - Affirming：溫暖頻率偏好（中低頻為主），避免尖銳高頻
 *   - Reflective：音效反映當前環境情境，建立心理安全感
 *   - Summarizing：漸進式音量淡入（3s），場景切換平滑交叉淡出（2s）
 *
 * 瀏覽器自動播放政策：需使用者互動後才啟動 AudioContext。
 * 使用者偏好（音量、靜音狀態）透過 localStorage 記憶。
 *
 * 音效設計靈感：禪意冥想音樂 — 五聲音階和聲、頌缽泛音、
 * 有機調變的自然聲景，營造靜謐空靈的療癒空間。
 */

import { useRef, useEffect, useCallback, useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

interface LightMusicProfile {
  melody: number[];
  harmony: number[];
  bass: number[];
  stepMs: number;
  noteLength: number;
  contour: number[];
}

const LIGHT_MUSIC_PROFILES: Record<SceneId, LightMusicProfile> = {
  nightSky: {
    melody: [261.63, 329.63, 392.0, 440.0, 523.25, 659.25],
    harmony: [196.0, 261.63, 329.63],
    bass: [130.81, 146.83],
    stepMs: 1650,
    noteLength: 2.8,
    contour: [0, 2, 3, 2, 4, 3, 2, 1],
  },
  morning: {
    melody: [293.66, 369.99, 440.0, 493.88, 587.33, 659.25],
    harmony: [220.0, 293.66, 369.99],
    bass: [146.83, 164.81],
    stepMs: 1500,
    noteLength: 2.5,
    contour: [0, 1, 2, 4, 3, 5, 4, 2],
  },
  cafe: {
    melody: [220.0, 261.63, 293.66, 329.63, 392.0, 440.0],
    harmony: [164.81, 220.0, 261.63],
    bass: [110.0, 130.81],
    stepMs: 1720,
    noteLength: 2.6,
    contour: [0, 2, 1, 3, 2, 4, 3, 1],
  },
  deepSea: {
    melody: [174.61, 220.0, 261.63, 293.66, 349.23, 392.0],
    harmony: [130.81, 174.61, 220.0],
    bass: [87.31, 98.0],
    stepMs: 1880,
    noteLength: 3.2,
    contour: [0, 1, 3, 2, 4, 2, 1, 0],
  },
};

/**
 * Add a melodic "light music" layer on top of ambient textures.
 * This creates a calm motif with harmony + bass pulses so it sounds musical and healing.
 */
function createLightMusicLayer(
  ctx: AudioContext,
  dest: AudioNode,
  sceneId: SceneId
): { gain: GainNode; cleanup: () => void } {
  const profile = LIGHT_MUSIC_PROFILES[sceneId];
  const layerGain = ctx.createGain();
  layerGain.gain.value = 0.034;

  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = sceneId === "morning" ? 2600 : 2100;
  musicFilter.Q.value = 0.45;

  const musicHighShelf = ctx.createBiquadFilter();
  musicHighShelf.type = "highshelf";
  musicHighShelf.frequency.value = 1700;
  musicHighShelf.gain.value = -5;

  const echoDelay = ctx.createDelay(1.2);
  echoDelay.delayTime.value = sceneId === "deepSea" ? 0.52 : 0.38;
  const echoGain = ctx.createGain();
  echoGain.gain.value = 0.2;
  const echoFilter = ctx.createBiquadFilter();
  echoFilter.type = "lowpass";
  echoFilter.frequency.value = 1800;

  layerGain.connect(musicFilter).connect(musicHighShelf).connect(dest);
  musicHighShelf
    .connect(echoDelay)
    .connect(echoFilter)
    .connect(echoGain)
    .connect(dest);

  let motifStep = Math.floor(Math.random() * profile.contour.length);
  let chordStep = 0;
  let noteTimer: ReturnType<typeof setInterval> | null = null;
  let bassTimer: ReturnType<typeof setInterval> | null = null;

  const toMelodyFreq = (step: number): number => {
    const idx =
      profile.contour[step % profile.contour.length] % profile.melody.length;
    return profile.melody[idx];
  };

  const triggerMelodyNote = () => {
    const now = ctx.currentTime;
    const base = toMelodyFreq(motifStep);
    const grace = profile.melody[(motifStep + 1) % profile.melody.length];
    motifStep += 1;

    const fundamental = ctx.createOscillator();
    fundamental.type = "sine";
    fundamental.frequency.value = base;
    const overtone = ctx.createOscillator();
    overtone.type = "triangle";
    overtone.frequency.value = base * 2.01;
    const graceTone = ctx.createOscillator();
    graceTone.type = "sine";
    graceTone.frequency.value = grace;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.17, now + 0.14);
    env.gain.exponentialRampToValueAtTime(0.0016, now + profile.noteLength);

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.value = 0.19;
    const graceGain = ctx.createGain();
    graceGain.gain.value = 0.12;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 1.8;

    vibrato.connect(vibratoDepth).connect(fundamental.frequency);
    vibrato.connect(vibratoDepth).connect(graceTone.frequency);

    fundamental.connect(env).connect(layerGain);
    overtone.connect(overtoneGain).connect(env);
    graceTone.connect(graceGain).connect(env);

    fundamental.start(now);
    overtone.start(now);
    graceTone.start(now + 0.12);
    vibrato.start(now);
    fundamental.stop(now + profile.noteLength + 0.22);
    overtone.stop(now + profile.noteLength + 0.22);
    graceTone.stop(now + profile.noteLength * 0.72);
    vibrato.stop(now + profile.noteLength);
  };

  const triggerHarmony = () => {
    const now = ctx.currentTime + 0.04;
    const root = profile.harmony[chordStep % profile.harmony.length];
    chordStep += 1;
    const intervals = [1, 1.25, 1.5];
    intervals.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = root * ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now + i * 0.03);
      env.gain.linearRampToValueAtTime(0.06 / (i + 1), now + 0.18 + i * 0.04);
      env.gain.exponentialRampToValueAtTime(
        0.001,
        now + profile.noteLength + 0.5
      );
      osc.connect(env).connect(layerGain);
      osc.start(now + i * 0.03);
      osc.stop(now + profile.noteLength + 0.8);
    });
  };

  const triggerBassPulse = () => {
    const now = ctx.currentTime;
    const bassFreq =
      profile.bass[Math.floor(Math.random() * profile.bass.length)];
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "sine";
    bassOsc.frequency.value = bassFreq;
    const bassEnv = ctx.createGain();
    bassEnv.gain.setValueAtTime(0.0001, now);
    bassEnv.gain.linearRampToValueAtTime(0.06, now + 0.22);
    bassEnv.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    bassOsc.connect(bassEnv).connect(layerGain);
    bassOsc.start(now);
    bassOsc.stop(now + 1.9);
  };

  // swing timing keeps melody organic and less mechanical.
  noteTimer = setInterval(
    () => {
      triggerMelodyNote();
      if (Math.random() > 0.35) triggerHarmony();
    },
    profile.stepMs + (Math.random() - 0.5) * 260
  );
  bassTimer = setInterval(triggerBassPulse, profile.stepMs * 2.8);
  triggerMelodyNote();
  triggerHarmony();
  triggerBassPulse();

  return {
    gain: layerGain,
    cleanup: () => {
      if (noteTimer) clearInterval(noteTimer);
      if (bassTimer) clearInterval(bassTimer);
    },
  };
}

/**
 * Night Sky: Zen 空靈氛圍 — ethereal pad + singing bowl shimmer + breathy wind
 *
 * 靈感來源：靜謐禪意冥想音樂
 * - Layer 1: Ethereal pad — 五聲音階 (A pentatonic) 的微失諧正弦疊加，
 *   產生空靈的和聲共鳴與自然的 beating 效果
 * - Layer 2: Singing bowl shimmer — 模擬頌缽泛音，
 *   週期性的清亮高頻微光，帶來禪意閃爍感
 * - Layer 3: Breathy wind — 極柔和的棕噪音低通濾波，
 *   模擬夜空微風，營造寧靜空間感
 */
function createNightSkyLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Ethereal Zen pad — pentatonic A minor (A2, C3, D3, E3, G3)
  // Each note uses two slightly detuned oscillators for organic beating effect
  const padGain = ctx.createGain();
  padGain.gain.value = 0.05;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 1200;
  padFilter.Q.value = 0.4;
  // Slow tremolo LFO for breathing feel
  const padLFO = ctx.createOscillator();
  padLFO.type = "sine";
  padLFO.frequency.value = 0.06; // Very slow breathing ~16s cycle
  const padLFOGain = ctx.createGain();
  padLFOGain.gain.value = 0.015;
  padLFO.connect(padLFOGain).connect(padGain.gain);
  padLFO.start();

  const padOscs: OscillatorNode[] = [];
  // A pentatonic: A2=110, C3=130.8, D3=146.8, E3=164.8, G3=196
  const padFreqs = [110, 130.8, 146.8, 164.8, 196];
  padFreqs.forEach(freq => {
    // Two detuned oscillators per note for shimmering beating
    [freq, freq * 1.003].forEach(f => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.15;
      osc.connect(oscGain).connect(padFilter);
      osc.start();
      padOscs.push(osc);
    });
  });
  padFilter.connect(padGain).connect(dest);
  layers.push({
    gain: padGain,
    cleanup: () => {
      padOscs.forEach(o => {
        try {
          o.stop();
        } catch {}
      });
      try {
        padLFO.stop();
      } catch {}
    },
  });

  // Layer 2: Singing bowl shimmer — periodic high-frequency bell tones
  let bowlInterval: ReturnType<typeof setInterval> | null = null;
  const bowlGain = ctx.createGain();
  bowlGain.gain.value = 0.02;
  bowlGain.connect(dest);

  bowlInterval = setInterval(
    () => {
      if (Math.random() > 0.35) return; // Sparse, meditative pacing
      // Singing bowl overtone frequencies (harmonics of ~523 Hz, C5)
      const baseFreq = 523 + Math.random() * 60;
      const harmonics = [1, 2.01, 3.02, 4.98]; // Slightly inharmonic like real bowls
      const now = ctx.currentTime;
      harmonics.forEach((h, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = baseFreq * h;
        const env = ctx.createGain();
        const attackTime = 0.08 + i * 0.02;
        const decayTime = 2.5 + Math.random() * 2;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.2 / (i + 1), now + attackTime);
        env.gain.exponentialRampToValueAtTime(0.001, now + decayTime);
        osc.connect(env).connect(bowlGain);
        osc.start(now);
        osc.stop(now + decayTime + 0.1);
      });
    },
    6000 + Math.random() * 8000 // Every 6–14 seconds
  );

  layers.push({
    gain: bowlGain,
    cleanup: () => {
      if (bowlInterval) clearInterval(bowlInterval);
    },
  });

  // Layer 3: Breathy wind — very gentle brown noise, heavy low-pass
  const windBuffer = createBrownNoiseBuffer(ctx, 4);
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = windBuffer;
  windSrc.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 350;
  windFilter.Q.value = 0.3;
  // Slow modulation for organic wind movement
  const windLFO = ctx.createOscillator();
  windLFO.type = "sine";
  windLFO.frequency.value = 0.08;
  const windLFOGain = ctx.createGain();
  windLFOGain.gain.value = 100;
  windLFO.connect(windLFOGain).connect(windFilter.frequency);
  windLFO.start();
  const windGain = ctx.createGain();
  windGain.gain.value = 0.04;
  windSrc.connect(windFilter).connect(windGain).connect(dest);
  windSrc.start();
  layers.push({
    gain: windGain,
    cleanup: () => {
      try {
        windSrc.stop();
      } catch {}
      try {
        windLFO.stop();
      } catch {}
    },
  });

  return layers;
}

/**
 * Morning: 溫暖晨光 — warm harmonic pad + gentle birdsong + soft breeze
 *
 * 優化：更溫暖的和弦（C major 7th），鳥鳴更柔和自然，
 * 微風更輕盈，整體更具療癒感
 */
function createMorningLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Gentle breeze (pink noise, bandpassed, with slow modulation)
  const pinkBuffer = createPinkNoiseBuffer(ctx, 4);
  const breezeSrc = ctx.createBufferSource();
  breezeSrc.buffer = pinkBuffer;
  breezeSrc.loop = true;
  const breezeFilter = ctx.createBiquadFilter();
  breezeFilter.type = "bandpass";
  breezeFilter.frequency.value = 400;
  breezeFilter.Q.value = 0.3;
  // Add gentle wind modulation
  const breezeLFO = ctx.createOscillator();
  breezeLFO.type = "sine";
  breezeLFO.frequency.value = 0.12;
  const breezeLFOGain = ctx.createGain();
  breezeLFOGain.gain.value = 120;
  breezeLFO.connect(breezeLFOGain).connect(breezeFilter.frequency);
  breezeLFO.start();
  const breezeGain = ctx.createGain();
  breezeGain.gain.value = 0.05;
  breezeSrc.connect(breezeFilter).connect(breezeGain).connect(dest);
  breezeSrc.start();
  layers.push({
    gain: breezeGain,
    cleanup: () => {
      try {
        breezeSrc.stop();
      } catch {}
      try {
        breezeLFO.stop();
      } catch {}
    },
  });

  // Layer 2: Warm pad (C major 7th chord — C4, E4, G4, B4) with gentle tremolo
  const padGain = ctx.createGain();
  padGain.gain.value = 0.022;
  const padLFO = ctx.createOscillator();
  padLFO.type = "sine";
  padLFO.frequency.value = 0.08;
  const padLFOGain = ctx.createGain();
  padLFOGain.gain.value = 0.008;
  padLFO.connect(padLFOGain).connect(padGain.gain);
  padLFO.start();
  const padOscs: OscillatorNode[] = [];
  // Cmaj7: C4=261.6, E4=329.6, G4=392.0, B4=493.9
  [261.6, 329.6, 392.0, 493.9].forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.25;
    osc.connect(oscGain).connect(padGain);
    osc.start();
    padOscs.push(osc);
  });
  padGain.connect(dest);
  layers.push({
    gain: padGain,
    cleanup: () => {
      padOscs.forEach(o => {
        try {
          o.stop();
        } catch {}
      });
      try {
        padLFO.stop();
      } catch {}
    },
  });

  // Layer 3: Gentle bird chirps (softer, more melodic than before)
  let birdInterval: ReturnType<typeof setInterval> | null = null;
  const birdGain = ctx.createGain();
  birdGain.gain.value = 0.04;
  birdGain.connect(dest);

  birdInterval = setInterval(
    () => {
      if (Math.random() > 0.45) return;
      const baseFreq = 2000 + Math.random() * 800;
      const chirpCount = 2 + Math.floor(Math.random() * 2);
      for (let c = 0; c < chirpCount; c++) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const env = ctx.createGain();
        const startTime = ctx.currentTime + c * 0.14;
        osc.frequency.setValueAtTime(baseFreq, startTime);
        osc.frequency.linearRampToValueAtTime(baseFreq * 1.2, startTime + 0.04);
        osc.frequency.linearRampToValueAtTime(
          baseFreq * 0.95,
          startTime + 0.07
        );
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
        osc.connect(env).connect(birdGain);
        osc.start(startTime);
        osc.stop(startTime + 0.12);
      }
    },
    4000 + Math.random() * 5000
  );

  layers.push({
    gain: birdGain,
    cleanup: () => {
      if (birdInterval) clearInterval(birdInterval);
    },
  });

  return layers;
}

/**
 * Café: 溫馨午後 — warm lo-fi ambience + soft murmur + gentle cup clinks
 *
 * 優化：更柔和的低頻底噪，人聲模擬更自然，
 * 杯碟聲更輕巧，整體氛圍更舒適放鬆
 */
function createCafeLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Lo-fi ambient noise (brown noise, heavily filtered, with subtle movement)
  const brownBuffer = createBrownNoiseBuffer(ctx, 4);
  const lofiSrc = ctx.createBufferSource();
  lofiSrc.buffer = brownBuffer;
  lofiSrc.loop = true;
  const lofiFilter = ctx.createBiquadFilter();
  lofiFilter.type = "lowpass";
  lofiFilter.frequency.value = 500;
  lofiFilter.Q.value = 0.6;
  // Subtle movement for organic feel
  const lofiLFO = ctx.createOscillator();
  lofiLFO.type = "sine";
  lofiLFO.frequency.value = 0.15;
  const lofiLFOGain = ctx.createGain();
  lofiLFOGain.gain.value = 80;
  lofiLFO.connect(lofiLFOGain).connect(lofiFilter.frequency);
  lofiLFO.start();
  const lofiGain = ctx.createGain();
  lofiGain.gain.value = 0.055;
  lofiSrc.connect(lofiFilter).connect(lofiGain).connect(dest);
  lofiSrc.start();
  layers.push({
    gain: lofiGain,
    cleanup: () => {
      try {
        lofiSrc.stop();
      } catch {}
      try {
        lofiLFO.stop();
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
  murmurGain.gain.value = 0.028;
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
  clinkGain.gain.value = 0.02;
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

/**
 * Deep Sea: 深海冥想 — oceanic flow + meditative low resonance + gentle bubbles
 *
 * 優化：水流聲更有機，低頻共鳴更具冥想感，
 * 氣泡聲更輕柔稀疏，增加深海鯨歌般的低頻呼喚
 */
function createDeepSeaLayers(ctx: AudioContext, dest: AudioNode) {
  const layers: Array<{ gain: GainNode; cleanup: () => void }> = [];

  // Layer 1: Deep water flow (brown noise with dual-LFO modulation for organic wave movement)
  const brownBuffer = createBrownNoiseBuffer(ctx, 4);
  const waterSrc = ctx.createBufferSource();
  waterSrc.buffer = brownBuffer;
  waterSrc.loop = true;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = "lowpass";
  waterFilter.frequency.value = 280;
  waterFilter.Q.value = 0.8;
  // Primary wave movement
  const waterLFO = ctx.createOscillator();
  waterLFO.type = "sine";
  waterLFO.frequency.value = 0.08;
  const waterLFOGain = ctx.createGain();
  waterLFOGain.gain.value = 80;
  waterLFO.connect(waterLFOGain).connect(waterFilter.frequency);
  waterLFO.start();
  // Secondary slower swell
  const waterLFO2 = ctx.createOscillator();
  waterLFO2.type = "sine";
  waterLFO2.frequency.value = 0.03;
  const waterLFO2Gain = ctx.createGain();
  waterLFO2Gain.gain.value = 50;
  waterLFO2.connect(waterLFO2Gain).connect(waterFilter.frequency);
  waterLFO2.start();
  const waterGain = ctx.createGain();
  waterGain.gain.value = 0.08;
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
      try {
        waterLFO2.stop();
      } catch {}
    },
  });

  // Layer 2: Meditative low resonance — deeper, with slow pulsation (whale-song inspired)
  const resGain = ctx.createGain();
  resGain.gain.value = 0.024;
  const resLFO = ctx.createOscillator();
  resLFO.type = "sine";
  resLFO.frequency.value = 0.05;
  const resLFOGain = ctx.createGain();
  resLFOGain.gain.value = 0.012;
  resLFO.connect(resLFOGain).connect(resGain.gain);
  resLFO.start();
  const resOscs: OscillatorNode[] = [];
  // Deeper sub-bass tones with slight detuning for organic quality
  [38, 57, 57.5].forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.4;
    osc.connect(oscGain).connect(resGain);
    osc.start();
    resOscs.push(osc);
  });
  resGain.connect(dest);
  layers.push({
    gain: resGain,
    cleanup: () => {
      resOscs.forEach(o => {
        try {
          o.stop();
        } catch {}
      });
      try {
        resLFO.stop();
      } catch {}
    },
  });

  // Layer 3: Gentle bubble sounds (softer, sparser)
  let bubbleInterval: ReturnType<typeof setInterval> | null = null;
  const bubbleGain = ctx.createGain();
  bubbleGain.gain.value = 0.018;
  bubbleGain.connect(dest);

  bubbleInterval = setInterval(
    () => {
      if (Math.random() > 0.6) return; // Sparser bubbles
      const bubbleCount = 1 + Math.floor(Math.random() * 2);
      for (let b = 0; b < bubbleCount; b++) {
        const delay = b * (0.15 + Math.random() * 0.3);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const startFreq = 250 + Math.random() * 300;
        const env = ctx.createGain();
        const startTime = ctx.currentTime + delay;
        osc.frequency.setValueAtTime(startFreq, startTime);
        osc.frequency.exponentialRampToValueAtTime(
          startFreq * 2,
          startTime + 0.08
        );
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(0.15, startTime + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
        osc.connect(env).connect(bubbleGain);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
      }
    },
    3000 + Math.random() * 4000
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

// ─── Audio File URL Map (hybrid: procedural + file-based) ───────────────────
//
// 可在此處配置每個場景的外部音頻檔案 URL。
// 設定非空 URL 後，該場景會同時播放程序化音效與音頻檔案。
// 佔位符 URL 可替換為實際的開源環境音連結。
//
// URL 格式：完整 HTTPS URL（例：https://cdn.example.com/audio/zen-night.mp3）
//           或站內相對路徑（例：/audio/zen-night.mp3）
// 支援格式：MP3, OGG, WAV, FLAC（瀏覽器原生支援的格式）
//
// 推薦免費資源：
//   - freesound.org (CC0 授權)
//   - pixabay.com/music (免費商用)
//   - BBC Sound Effects (RemArc 授權)

export const SCENE_AUDIO_URLS: Record<SceneId, string> = {
  nightSky: "", // 禪意冥想音樂 — 適合空靈夜空氛圍
  morning: "", // 晨間自然聲景 — 鳥鳴、溪流
  cafe: "", // 咖啡廳環境音 — lo-fi beats、輕柔人聲
  deepSea: "", // 深海環境音 — 水下聲景、鯨歌
};

/** 場景音頻檔案描述（供 UI 顯示使用） */
export const SCENE_SOUND_LABELS: Record<SceneId, string> = {
  nightSky: "星夜輕音樂",
  morning: "晨光輕音樂",
  cafe: "午後輕音樂",
  deepSea: "深海輕音樂",
};

/**
 * Create an HTML5 Audio-based layer routed through Web Audio API.
 * Returns null if no URL is configured for the scene.
 * Only allows relative paths and HTTPS URLs for security.
 */
function createAudioFileLayer(
  ctx: AudioContext,
  dest: AudioNode,
  sceneId: SceneId
): { gain: GainNode; cleanup: () => void } | null {
  const url = SCENE_AUDIO_URLS[sceneId];
  if (!url) return null;

  // Security: only allow relative paths or HTTPS URLs
  const isRelative = url.startsWith("/");
  const isHttps = url.startsWith("https://");
  if (!isRelative && !isHttps) {
    console.warn(`[AmbientSound] Rejected non-HTTPS audio URL for ${sceneId}`);
    return null;
  }

  const audio = new Audio(url);
  audio.crossOrigin = "anonymous";
  audio.loop = true;
  audio.volume = 1; // Volume controlled via Web Audio gain node

  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.value = 0.3; // Blend with procedural sounds
  source.connect(gain).connect(dest);

  audio.play().catch(err => {
    // Autoplay may fail due to browser policy, network, or invalid URL
    console.warn(`[AmbientSound] Audio file play failed for ${sceneId}:`, err);
  });

  return {
    gain,
    cleanup: () => {
      audio.pause();
      audio.src = "";
      audio.load();
    },
  };
}

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

    // Create new layers (procedural + dedicated light-music melodic layer + optional audio file)
    const factory = SCENE_SOUND_FACTORIES[sceneId];
    const newLayers = factory(ctx, masterGain);
    newLayers.push(createLightMusicLayer(ctx, masterGain, sceneId));

    // Add audio file layer if URL is configured
    const audioFileLayer = createAudioFileLayer(ctx, masterGain, sceneId);
    if (audioFileLayer) {
      newLayers.push(audioFileLayer);
    }

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
  /** Mobile compact mode — icon only, no text label */
  compact?: boolean;
  /** Optional scene label to display (e.g. "禪意星夜") */
  sceneLabel?: string;
}

export const SoundControl = memo(function SoundControl({
  controls,
  isDark,
  compact = false,
  sceneLabel,
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

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSlider(false);
      }
    }
    if (showSlider) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [showSlider]);

  const handleClick = () => {
    if (!isUnlocked) {
      unlock();
      if (isMuted) toggleMute();
      return;
    }
    // In compact mode, toggle slider visibility; in desktop mode, toggle mute
    if (compact) {
      if (showSlider) {
        toggleMute();
      } else {
        setShowSlider(true);
      }
    } else {
      toggleMute();
    }
  };

  const isActive = isUnlocked && !isMuted;
  const glowColor = isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)";
  const btnBase = isDark
    ? "bg-white/10 hover:bg-white/15 text-white/80"
    : "bg-black/5 hover:bg-black/10 text-black/60";

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      {/* Volume slider — animated expand/collapse (available in both modes) */}
      <AnimatePresence>
        {showSlider && isUnlocked && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full overflow-hidden backdrop-blur-md ${
              isDark ? "bg-white/10" : "bg-black/5"
            }`}
          >
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={e => setVolume(Number(e.target.value) / 100)}
              className="w-16 h-1 appearance-none rounded-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${
                  isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.3)"
                } ${volume * 100}%, ${
                  isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)"
                } ${volume * 100}%)`,
              }}
            />
            <span
              className={`text-[10px] font-mono w-6 text-right ${
                isDark ? "text-white/60" : "text-black/40"
              }`}
            >
              {Math.round(volume * 100)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main button with breathing glow when playing */}
      <motion.button
        onClick={handleClick}
        onMouseEnter={() => !compact && isUnlocked && setShowSlider(true)}
        onMouseLeave={() => !compact && setShowSlider(false)}
        animate={
          isActive
            ? {
                boxShadow: [
                  `0 0 0px ${glowColor}`,
                  `0 0 10px ${glowColor}`,
                  `0 0 0px ${glowColor}`,
                ],
              }
            : { boxShadow: "0 0 0px transparent" }
        }
        transition={
          isActive
            ? { duration: 3, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.4 }
        }
        className={`flex items-center gap-1.5 rounded-full backdrop-blur-md transition-colors duration-300 cursor-pointer select-none ${
          compact ? "p-2" : "px-2.5 py-1.5"
        } ${btnBase}`}
        title={!isUnlocked ? "點擊啟動輕音樂" : isMuted ? "取消靜音" : "靜音"}
      >
        {/* Animated waveform bars when playing, static icon otherwise */}
        <div
          className={`relative flex items-center justify-center ${
            compact ? "w-4 h-4" : "w-3.5 h-3.5"
          }`}
        >
          {isActive ? (
            <div className="flex items-end gap-[2px] w-full h-full">
              {([0.5, 1, 0.65] as const).map((base, i) => (
                <motion.div
                  key={i}
                  className={`flex-1 rounded-full ${
                    isDark ? "bg-white/70" : "bg-black/50"
                  }`}
                  animate={{ scaleY: [base, 1, base * 0.4, 0.9, base] }}
                  transition={{
                    duration: 1.4 + i * 0.25,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.18,
                  }}
                  style={{ transformOrigin: "bottom", height: "100%" }}
                />
              ))}
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
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
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              )}
            </svg>
          )}
        </div>

        {/* Text label — hidden in compact mode */}
        {!compact && (
          <span className="text-[10px] font-medium whitespace-nowrap">
            {!isUnlocked ? "輕音樂" : isMuted ? "靜音" : sceneLabel || "播放中"}
          </span>
        )}
      </motion.button>
    </div>
  );
});

export default SoundControl;
