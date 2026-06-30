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
    // 無痕 / 停用儲存的瀏覽器讀 localStorage 會丟例外；吞掉並用空 token 照樣嘗試連線。
    let token = "";
    try {
      token = localStorage.getItem("token") ?? "";
    } catch {
      token = "";
    }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/orb-voice?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => { setIsConnected(true); setIsListening(true); setError(null); };
    ws.onmessage = evt => {
      // 單一封包格式錯誤不應拖垮整個 handler；解析失敗就略過這則訊息、保持連線可用。
      let data: any;
      try {
        data = JSON.parse(String(evt.data));
      } catch (err) {
        console.error("[useOrbVoice] 無法解析語音訊息，已略過：", err);
        return;
      }
      if (data.type === "transcript") setTranscript(data.text ?? "");
      if (data.type === "userTranscript") setUserTranscript(data.text ?? "");
      if (data.type === "toolCall") setLastToolCall(data.payload ?? null);
      if (data.type === "audio") setIsSpeaking(true);
      if (data.type === "error") setError(data.message ?? "voice-error");
    };
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
