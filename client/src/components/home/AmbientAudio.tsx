import React, { useCallback, useEffect, useRef, useState } from "react";

type Environment = "ocean" | "cafe" | "morning" | "night";

interface AmbientAudioProps {
    environment?: Environment;
    autoStart?: boolean;
}

export function AmbientAudio({ environment = "ocean", autoStart = false }: AmbientAudioProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.3);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const nodesRef = useRef<{ source: AudioBufferSourceNode | null; gainNode: GainNode | null }>({
          source: null,
          gainNode: null,
    });
    const isStartedRef = useRef(false);

  const ENV_CONFIGS: Record<Environment, { cutoff: number; resonance: number; rate: number }> = {
        ocean: { cutoff: 400, resonance: 1.2, rate: 0.8 },
        cafe: { cutoff: 800, resonance: 0.8, rate: 1.2 },
        morning: { cutoff: 600, resonance: 1.0, rate: 1.0 },
        night: { cutoff: 200, resonance: 1.5, rate: 0.5 },
  };

  const stopAudio = useCallback(() => {
        if (nodesRef.current.source) {
                try { nodesRef.current.source.stop(); } catch {}
                nodesRef.current.source = null;
        }
        if (nodesRef.current.gainNode) {
                nodesRef.current.gainNode = null;
        }
        isStartedRef.current = false;
        setIsPlaying(false);
  }, []);

  const startAudio = useCallback(() => {
        if (isStartedRef.current) return;

                                     const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;

                                     if (!audioCtxRef.current) {
                                             audioCtxRef.current = new AudioContextClass();
                                     }
        const ctx = audioCtxRef.current;

                                     const config = ENV_CONFIGS[environment];
        const bufferSize = ctx.sampleRate * 4;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
        }

                                     const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

                                     const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = config.cutoff;
        filter.Q.value = config.resonance;

                                     const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);

                                     source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start();

                                     nodesRef.current = { source, gainNode };
        isStartedRef.current = true;
        setIsPlaying(true);
  }, [environment, volume]);

  const toggle = () => {
        if (isPlaying) {
                if (nodesRef.current.gainNode && audioCtxRef.current) {
                          const gain = nodesRef.current.gainNode.gain;
                          gain.linearRampToValueAtTime(0, audioCtxRef.current.currentTime + 0.8);
                          setTimeout(stopAudio, 900);
                } else {
                          stopAudio();
                }
        } else {
                startAudio();
        }
  };

  useEffect(() => {
        if (autoStart) startAudio();
        return () => { stopAudio(); };
  }, []);

  useEffect(() => {
        if (nodesRef.current.gainNode && audioCtxRef.current) {
                nodesRef.current.gainNode.gain.linearRampToValueAtTime(volume, audioCtxRef.current.currentTime + 0.3);
        }
  }, [volume]);

  return (
        <div className="ambient-audio-control" style={{ position: "fixed", bottom: "1.5rem", left: "1.5rem", zIndex: 50, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                          onClick={toggle}
                          aria-label={isPlaying ? "Mute" : "Play"}
                          title={isPlaying ? "Click to mute" : `Play ambient sound`}
                          style={{
                                      width: "2.5rem",
                                      height: "2.5rem",
                                      borderRadius: "50%",
                                      background: "rgba(255,255,255,0.08)",
                                      border: "1px solid rgba(255,255,255,0.15)",
                                      backdropFilter: "blur(12px)",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "1.1rem",
                                      transition: "all 0.2s ease",
                                      color: "rgba(255,255,255,0.7)",
                          }}
                        >
                  {isPlaying ? "
                    {isPlaying ? "ON" : "OFF"}
                </button>button>
          {isPlaying && (
                  <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={volume}
                              onChange={e => setVolume(Number(e.target.value))}
                              aria-label="Volume"
                              style={{ width: "4rem", accentColor: "var(--accent-color, #7c3aed)" }}
                            />
                )}
        </div>div>
      );
}
</button>
