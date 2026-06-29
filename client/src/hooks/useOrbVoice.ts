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

  const startVoice = () => {
    const token = localStorage.getItem("token") ?? "";
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/orb-voice?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => { setIsConnected(true); setIsListening(true); setError(null); };
    ws.onmessage = evt => {
      // AIDV-560：壞訊息（非 JSON）不再讓 onmessage 整個 throw 而靜默崩潰；
      // 記錯誤並忽略該則訊息，連線維持可用。
      let data: any;
      try {
        data = JSON.parse(String(evt.data));
      } catch {
        setError("收到無法解析的語音訊息");
        return;
      }
      if (data.type === "transcript") setTranscript(data.text ?? "");
      if (data.type === "userTranscript") setUserTranscript(data.text ?? "");
      if (data.type === "toolCall") setLastToolCall(data.payload ?? null);
      if (data.type === "audio") setIsSpeaking(true);
      if (data.type === "error") setError(data.message ?? "voice-error");
    };
    // AIDV-560：連線層級錯誤先前無人接手——補 onerror，讓狀態列顯示斷線可重連。
    ws.onerror = () => {
      setError("語音連線發生錯誤，請重新連線");
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
    };
    ws.onclose = () => { setIsConnected(false); setIsListening(false); setIsSpeaking(false); };
  };

  const stopVoice = () => { wsRef.current?.close(); wsRef.current = null; setIsListening(false); };
  const toggleMute = () => setIsListening(v => !v);

  return { isConnected, isListening, isSpeaking, transcript, userTranscript, lastToolCall, startVoice, stopVoice, toggleMute, error };
}
