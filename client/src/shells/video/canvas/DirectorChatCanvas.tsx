// ============================================================================
// shells/video/canvas/DirectorChatCanvas.tsx — 中欄畫布：導演對話（已移除人格預設）
// ----------------------------------------------------------------------------
// CO-STAR × RAG 導演對話，走 spine.directorReply（薄包 commander.directorReply → director.chat）。
// 一體成形：不再有 calm/creative/technical 人格切換條（Wave 0 移除人格預設）。
// ============================================================================
import { useRef, useState } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { uid } from "@/spine/spineUtil";

interface ChatMsg { id: string; role: "me" | "ai"; text: string; agent?: string }

export function DirectorChatCanvas() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      id: "m0", role: "ai", agent: "OpenRouter→Claude",
      text: `已載入《${p.name}》上下文。對話→腳本→世界觀→分鏡→生成，全部在這頁完成。鐵則：角色未定版不進分鏡、關鍵影格未核准不跑 i2v、媒體生成前先估成本。`,
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || typing) return;
    setMsgs((m) => [...m, { id: uid("m"), role: "me", text: q }]);
    setInput("");
    setTyping(true);
    try {
      const ai = await spine.directorReply(q);
      setMsgs((m) => [...m, { id: uid("m"), role: "ai", text: ai.text || "（無回覆）", agent: ai.agent }]);
    } catch (err) {
      setMsgs((m) => [...m, { id: uid("m"), role: "ai", text: `導演台連線中斷：${err instanceof Error ? err.message : "director.chat 無回應"}`, agent: "system" }]);
    } finally {
      setTyping(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" /> 導演對話 · CO-STAR × RAG
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card/40 p-3">
        {msgs.map((m) => (
          <div key={m.id} className={cn("flex gap-2", m.role === "me" && "flex-row-reverse")}>
            <span className="mt-0.5 text-base leading-none">{m.role === "me" ? "🧑" : "🧠"}</span>
            <div className={cn("min-w-0", m.role === "me" && "text-right")}>
              <div className="text-[10px] text-muted-foreground">{m.role === "me" ? "你" : m.agent || "AI"}</div>
              <div
                className={cn(
                  "mt-0.5 inline-block whitespace-pre-line rounded-2xl px-3 py-2 text-xs",
                  m.role === "me" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.text}
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-base leading-none">🧠</span>
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="與導演台對話… CO-STAR × RAG"
          className="max-h-32 min-h-[44px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button size="icon" onClick={() => void send()} disabled={typing || !input.trim()} aria-label="送出">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default DirectorChatCanvas;
