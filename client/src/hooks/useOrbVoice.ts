import { useRef, useState } from "react";

export function useOrbVoice() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [userTranscript, setUserTranscript] = useState("");
  const [lastToolCall, setLastToolCall] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // gatewayMode === "stub" 時，server 回的所有 transcript 都加上 [STUB] 前綴，
  // OrbVoiceButton 可以用這個 flag 決定要不要顯示「語音 ASR 還在串接」橫條。
  const [gatewayMode, setGatewayMode] = useState<"stub" | "live" | null>(null);

  const startVoice = () => {
    const token = localStorage.getItem("token") ?? "";
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/orb-voice?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => { setIsConnected(true); setIsListening(true); setError(null); };
    ws.onmessage = evt => {
      const data = JSON.parse(String(evt.data));
      if (data.type === "ready") setGatewayMode(data.gatewayMode === "stub" ? "stub" : "live");
      if (data.type === "transcript") setTranscript(data.text ?? "");
      if (data.type === "userTranscript") setUserTranscript(data.text ?? "");
      if (data.type === "toolCall") setLastToolCall(data.payload ?? null);
      if (data.type === "audio") setIsSpeaking(true);
      if (data.type === "error") setError(data.message ?? "voice-error");
    };
    ws.onclose = () => { setIsConnected(false); setIsListening(false); setIsSpeaking(false); };
  };

  const stopVoice = () => { wsRef.current?.close(); wsRef.current = null; setIsListening(false); setGatewayMode(null); };
  const toggleMute = () => setIsListening(v => !v);

  return { isConnected, isListening, isSpeaking, transcript, userTranscript, lastToolCall, startVoice, stopVoice, toggleMute, error, gatewayMode };
}
