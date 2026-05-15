import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { useOrbVoice } from "@/hooks/useOrbVoice";

export interface OrbVoiceButtonProps {
  /**
   * Honour the user's `voiceEnabled` preference. When false the button
   * doesn't render at all so the WS connection never fires (saves the
   * cost of a Gemini Live socket on every page load for users who
   * haven't opted in).
   */
  enabled?: boolean;
  /**
   * Honour `voiceAutoActivate` — when true, the button auto-fires
   * `startVoice()` once on mount so the user doesn't need to click the
   * mic before talking. Only kicks in once per mount; closing & re-
   * opening the panel restarts. Off by default to avoid surprising
   * users with a live mic the moment they open the orb.
   */
  autoActivate?: boolean;
}

export function OrbVoiceButton({ enabled = true, autoActivate = false }: OrbVoiceButtonProps) {
  const voice = useOrbVoice();
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!autoActivate) return;
    if (autoStartedRef.current) return;
    if (voice.isConnected) return;
    autoStartedRef.current = true;
    try {
      voice.startVoice();
    } catch (err) {
      console.warn(
        "[OrbVoiceButton] auto-activate failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    // `voice` is intentionally omitted — useOrbVoice returns a fresh
    // object every render, so including it would re-fire startVoice() on
    // every parent re-render the moment a sibling state changes (e.g.
    // pageAgent.snapshot). The autoStartedRef guard above is sufficient
    // for "fire once per mount"; on unmount/remount the ref resets and
    // we get a fresh auto-activate, which is what the user asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoActivate]);

  if (!enabled) return null;

  const color = voice.error
    ? "bg-red-500 hover:bg-red-600"
    : voice.isSpeaking
      ? "bg-purple-500 hover:bg-purple-600"
      : voice.isListening
        ? "bg-blue-500 hover:bg-blue-600"
        : voice.isConnected
          ? "bg-orange-500 hover:bg-orange-600"
          : "bg-muted hover:bg-muted";
  const ariaLabel = voice.isConnected
    ? voice.isListening
      ? "停止語音"
      : "結束語音"
    : "開始語音對話";
  return (
    <div className="relative">
      <button
        type="button"
        className={`p-2 rounded-lg transition-colors text-white ${color} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300`}
        onClick={voice.isConnected ? voice.stopVoice : voice.startVoice}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {voice.isListening ? (
          <Mic className="w-4 h-4" aria-hidden="true" />
        ) : (
          <MicOff className="w-4 h-4" aria-hidden="true" />
        )}
      </button>
      {voice.userTranscript && (
        <div className="absolute bottom-12 right-0 bg-black text-white text-xs p-2 rounded max-w-[16rem] truncate">
          {voice.userTranscript}
        </div>
      )}
      {voice.isSpeaking && (
        <div className="absolute bottom-12 left-0 bg-purple-50 border p-2 rounded text-xs max-w-[16rem]">
          光球回應中… {voice.transcript}
        </div>
      )}
      {voice.error && (
        <div className="absolute bottom-12 right-0 bg-red-50 border border-red-200 p-2 rounded text-xs text-red-600 max-w-[16rem]">
          ⚠️ {voice.error}
        </div>
      )}
    </div>
  );
}
