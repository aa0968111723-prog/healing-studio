import { useRef, useState } from "react";

export function useOrbVoice() {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isMutedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [userTranscript, setUserTranscript] = useState("");
  const [lastToolCall, setLastToolCall] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const startRecording = async (ws: WebSocket) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("無法取得麥克風權限");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 16_000,
    });

    recorder.ondataavailable = (evt) => {
      if (evt.data.size > 0 && !isMutedRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(evt.data);
      }
    };

    // Notify server of mimeType so it knows the audio format
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "mimeType", value: mimeType.split(";")[0] }));
    }

    recorder.start(250); // 250 ms slices
    mediaRecorderRef.current = recorder;
    setIsListening(true);
  };

  const stopRecording = (sendStopSignal = false) => {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (!recorder || recorder.state === "inactive") {
      setIsListening(false);
      if (sendStopSignal && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      return;
    }

    // Send stop signal after final ondataavailable fires (in onstop)
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      setIsListening(false);
      if (sendStopSignal && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
    };

    recorder.stop();
  };

  const startVoice = () => {
    // 無痕 / 停用儲存的瀏覽器讀 localStorage 會丟例外；吞掉並用空 token 照樣嘗試連線。
    let token = "";
    try {
      token = localStorage.getItem("token") ?? "";
    } catch {
      token = "";
    }
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/orb-voice?token=${encodeURIComponent(token)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
      isMutedRef.current = false;
      startRecording(ws);
    };

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
      if (data.type === "audio") {
        setIsSpeaking(true);
        const audio = new Audio(data.data as string);
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => setIsSpeaking(false);
        audio.play().catch(() => setIsSpeaking(false));
      }
      if (data.type === "error") setError(data.message ?? "voice-error");
    };

    ws.onerror = () => {
      setError("語音連線發生錯誤，請重新連線");
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
    };

    ws.onclose = () => {
      stopRecording(false);
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
    };
  };

  const stopVoice = () => {
    stopRecording(true);
    wsRef.current?.close();
    wsRef.current = null;
  };

  const toggleMute = () => {
    const nowMuted = !isMutedRef.current;
    isMutedRef.current = nowMuted;
    setIsListening(!nowMuted);
  };

  return {
    isConnected,
    isListening,
    isSpeaking,
    transcript,
    userTranscript,
    lastToolCall,
    startVoice,
    stopVoice,
    toggleMute,
    error,
  };
}
