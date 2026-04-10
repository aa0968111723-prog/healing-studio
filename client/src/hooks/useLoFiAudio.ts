/**
 * useLoFiAudio.ts — Phase 14 Lo-Fi 環境音效 Hook
 *
 * 白皮書規格：
 * - Web Audio API AudioContext 生成 400Hz Lowpass Filter 白噪音
 * - 合成 Lo-Fi 環境音（低通濾波 + 溫暖失真 + vinyl crackle）
 * - 與 PersonalityContext 整合：不同人格不同音色
 *   calm     → 柔和白噪音 + 低頻嗡鳴
 *   creative → 輕快節拍 + 高亮度濾波
 *   technical → 純靜音 / 極低頻嗡鳴
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { usePersonality } from "@/contexts/PersonalityContext";

interface LoFiNodes {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  distortion: WaveShaperNode;
  gainNode: GainNode;
}

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 256;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const curve = new Float32Array(samples) as any as Float32Array<ArrayBuffer>;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function createWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const bufferSize = ctx.sampleRate * 2; // 2 秒循環
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export interface LoFiControls {
  isPlaying: boolean;
  volume: number;
  start: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
}

export function useLoFiAudio(): LoFiControls {
  const { personality } = usePersonality();
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<LoFiNodes | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.15);

  // 根據人格決定濾波器參數
  const getFilterParams = useCallback(() => {
    switch (personality) {
      case "creative":
        return { frequency: 800, Q: 0.5, distortionAmount: 20 };
      case "technical":
        return { frequency: 200, Q: 1.2, distortionAmount: 5 };
      default: // calm
        return { frequency: 400, Q: 0.7, distortionAmount: 15 };
    }
  }, [personality]);

  const start = useCallback(() => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      // 停止舊節點
      if (nodesRef.current) {
        nodesRef.current.source.stop();
        nodesRef.current.gainNode.disconnect();
      }

      const { frequency, Q, distortionAmount } = getFilterParams();

      // 白噪音來源（循環）
      const buffer = createWhiteNoiseBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // 低通濾波器（Lo-Fi 效果核心）
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(frequency, ctx.currentTime);
      filter.Q.setValueAtTime(Q, ctx.currentTime);

      // 溫暖失真（Vinyl 感）
      const distortion = ctx.createWaveShaper();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      distortion.curve = makeDistortionCurve(distortionAmount) as any;
      distortion.oversample = "4x";

      // 音量節點（淡入）
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);

      // 連接音訊圖
      source.connect(filter);
      filter.connect(distortion);
      distortion.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start();
      nodesRef.current = { source, filter, distortion, gainNode };
      setIsPlaying(true);
    } catch (err) {
      console.warn("[LoFi] Web Audio 啟動失敗:", err);
    }
  }, [volume, getFilterParams]);

  const stop = useCallback(() => {
    if (nodesRef.current && ctxRef.current) {
      const { gainNode, source } = nodesRef.current;
      const ctx = ctxRef.current;
      // 淡出後停止
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => {
        try { source.stop(); } catch { /* ignore */ }
        nodesRef.current = null;
      }, 1600);
    }
    setIsPlaying(false);
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (nodesRef.current && ctxRef.current) {
      const ctx = ctxRef.current;
      nodesRef.current.gainNode.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.3);
    }
  }, []);

  // 人格切換時更新濾波器（不重啟）
  useEffect(() => {
    if (!nodesRef.current || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const { filter } = nodesRef.current;
    const { frequency, Q } = getFilterParams();
    filter.frequency.linearRampToValueAtTime(frequency, ctx.currentTime + 1);
    filter.Q.linearRampToValueAtTime(Q, ctx.currentTime + 1);
  }, [personality, getFilterParams]);

  // 元件卸載時清理
  useEffect(() => {
    return () => {
      try {
        nodesRef.current?.source.stop();
        ctxRef.current?.close();
      } catch { /* ignore */ }
    };
  }, []);

  return { isPlaying, volume, start, stop, setVolume };
}
