/**
 * Live orb voice preview — Plays a sample sentence via ElevenLabs TTS
 * (`brain.orbVoicePreview` mutation). Used by the technician slot in
 * the Config tab so admins can hear the voice before saving.
 */
import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";

export const SOUL_PREVIEW_TEXT =
  "你好,我是光球。我已準備好協助你開始今天的創作旅程。";

export function LivePreview({
  model,
  voiceId,
}: {
  model: string;
  voiceId?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const orbVoicePreview = trpc.brain.orbVoicePreview.useMutation({
    onSuccess: data => {
      setIsLoading(false);
      setErrorMsg(null);
      const audio = new Audio(data.audioBase64);
      audioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => {
        setIsPlaying(false);
        setErrorMsg("音頻播放失敗");
      };
      audio.play().catch(e => {
        setIsPlaying(false);
        setErrorMsg("無法播放:" + String(e));
      });
      setIsPlaying(true);
    },
    onError: err => {
      setIsLoading(false);
      setIsPlaying(false);
      setErrorMsg(err.message);
    },
  });

  const handlePlay = () => {
    if (isLoading || isPlaying) {
      audioRef.current?.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    orbVoicePreview.mutate({
      text: SOUL_PREVIEW_TEXT,
      voiceId: voiceId ?? "Rachel",
      modelId: "eleven_turbo_v2",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <motion.div
          className="relative flex-shrink-0 cursor-pointer"
          animate={
            isPlaying
              ? { scale: [1, 1.15, 1, 1.1, 1], opacity: [1, 0.9, 1, 0.85, 1] }
              : { scale: [1, 1.04, 1] }
          }
          transition={
            isPlaying
              ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              : { duration: 3, repeat: Infinity, ease: "easeInOut" }
          }
          onClick={handlePlay}
          title="點擊播放光球語音預覽"
        >
          <div
            className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
              isPlaying
                ? "bg-gradient-to-br from-amber-300 via-orange-500 to-rose-500 shadow-orange-400/50"
                : "bg-gradient-to-br from-amber-300 via-orange-400 to-rose-400 shadow-amber-300/30"
            }`}
          />
          <div className="absolute inset-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-300/40 via-orange-400/30 to-rose-400/20 blur-md" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/60 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </motion.div>

        <div className="flex-1 bg-white/60 dark:bg-white/10 backdrop-blur-sm rounded-2xl rounded-tl-sm p-3.5 border border-white/40 shadow-sm">
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            「{SOUL_PREVIEW_TEXT}」
          </p>
          <div className="flex items-center justify-between mt-2.5">
            <span className="hs-small !mb-0 text-muted-foreground/60">
              {model} · ElevenLabs TTS
            </span>
            <button
              onClick={handlePlay}
              disabled={false}
              className={`text-[10px] flex items-center gap-1 transition-colors ${
                isLoading
                  ? "text-amber-500 cursor-wait"
                  : isPlaying
                    ? "text-red-400 hover:text-red-500"
                    : "text-primary/70 hover:text-primary"
              }`}
            >
              {isLoading ? "載入中..." : isPlaying ? "停止 ■" : "▶ 播放預覽"}
            </button>
          </div>
          {errorMsg && (
            <p className="hs-small !mb-0 text-red-400 mt-1">{errorMsg}</p>
          )}
        </div>
      </div>
      <p className="hs-small !mb-0 text-muted-foreground/60 text-center">
        點擊光球或「播放預覽」聆聽真實 TTS 語音
      </p>
    </div>
  );
}
