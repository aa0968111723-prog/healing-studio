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

interface ChatMsg { id: string; role: "me" | "ai"; text: string; agent?: string; error?: boolean }

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
  // AIDV-157 捲動修復:scrollIntoView 目標改成「最新訊息列」而非列表底部的空 div。
  // 舊版捲到底部 padding，把最新訊息＋錯誤推出畫面，看似一片空白。
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const scrollToLatest = () =>
    requestAnimationFrame(() =>
      lastMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    );

  const send = async () => {
    const q = input.trim();
    if (!q || typing) return;
    setMsgs((m) => [...m, { id: uid("m"), role: "me", text: q }]);
    setInput("");
    setTyping(true);
    scrollToLatest();
    try {
      const ai = await spine.directorReply(q);
      setMsgs((m) => [...m, { id: uid("m"), role: "ai", text: ai.text || "（無回覆）", agent: ai.agent }]);
    } catch {
      // AIDV-157 ① 白話化:不再外洩「directorReply failed」開發字串。
      //          ② 保留既有訊息:這裡是 append（不清空對話），使用者已送出的
      //             訊息與歷史都還在；並把使用者剛打的字回填輸入框，一鍵可重送。
      setMsgs((m) => [...m, {
        id: uid("m"), role: "ai", agent: "system", error: true,
        text: "導演暫時連不上，請稍後再試。你的訊息已保留，可直接重新送出。",
      }]);
      setInput(q);
    } finally {
      setTyping(false);
      scrollToLatest();
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" /> 導演對話 · CO-STAR × RAG
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border bg-card/40 p-3">
        {msgs.map((m, i) => (
          <div
            key={m.id}
            ref={i === msgs.length - 1 ? lastMsgRef : undefined}
            className={cn("flex gap-2", m.role === "me" && "flex-row-reverse")}
          >
            <span className="mt-0.5 text-base leading-none">{m.role === "me" ? "🧑" : m.error ? "⚠️" : "🧠"}</span>
            <div className={cn("min-w-0", m.role === "me" && "text-right")}>
              <div className="text-[10px] text-muted-foreground">{m.role === "me" ? "你" : m.agent || "AI"}</div>
              <div
                className={cn(
                  "mt-0.5 inline-block whitespace-pre-line rounded-2xl px-3 py-2 text-xs",
                  m.role === "me"
                    ? "bg-primary text-primary-foreground"
                    : m.error
                      ? "border border-destructive/40 bg-destructive/10 text-destructive"
                      : "bg-muted",
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
