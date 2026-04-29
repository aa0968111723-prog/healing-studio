import { useOrbVoice } from "@/hooks/useOrbVoice";

export function OrbVoiceButton() {
  const voice = useOrbVoice();
  const color = voice.error ? "bg-red-500" : voice.isSpeaking ? "bg-purple-500" : voice.isListening ? "bg-blue-500" : voice.isConnected ? "bg-orange-500" : "bg-gray-400";
  return (
    <div className="relative">
      <button className={`h-10 w-10 rounded-full text-white ${color}`} onClick={voice.isConnected ? voice.stopVoice : voice.startVoice}>🎙</button>
      {voice.userTranscript && <div className="absolute bottom-12 right-0 bg-black text-white text-xs p-2 rounded">{voice.userTranscript}</div>}
      {voice.isSpeaking && <div className="absolute bottom-12 left-0 bg-purple-50 border p-2 rounded text-xs">光球回應中... {voice.transcript}</div>}
    </div>
  );
}
