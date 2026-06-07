// ============================================================================
// shells/video/columns/DirectorColumn.tsx — 中欄：人格 + 確認門 + 導演台對話
// ----------------------------------------------------------------------------
// 人格（calm/creative/technical）→ ProjectSpineProvider.persona。
// 確認門 → <ConfirmGate />（完整狀態機）。
// 對話 → spine.directorReply()（薄包 P0 commander.directorReply → director.chat，CO-STAR×RAG×三人格）。
//   訊息清單由本欄持有（UI 局部狀態）；送出/打字/錯誤都在這裡處理。
// ============================================================================
import { useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { ConfirmGate } from "../ConfirmGate";
import { uid } from "@/spine/spineUtil";
import type { Persona } from "@/spine/types";

interface ChatMsg { id: string; role: "me" | "ai"; text: string; agent?: string }

const PERSONAS: { id: Persona; n: string; d: string }[] = [
  { id: "calm", n: "平靜", d: "CALM" },
  { id: "creative", n: "創意", d: "CREATIVE" },
  { id: "technical", n: "技術", d: "TECHNICAL" },
];

export function DirectorColumn() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      id: "m0", role: "ai", agent: "OpenRouter→Claude",
      text: `已載入《${p.name}》上下文。要從哪一場開始？我會遵守確認門鐵則：角色未定版不進分鏡、關鍵影格未核准不跑 i2v。`,
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

  const activePersona = PERSONAS.find((x) => x.id === spine.persona)?.n ?? "創意";

  return (
    <Card className="glass-card-static flex min-h-[520px] flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-5">
        {/* 人格切換 */}
        <div className="grid grid-cols-3 gap-2">
          {PERSONAS.map((pe) => (
            <button
              key={pe.id}
              type="button"
              onClick={() => spine.setPersona(pe.id)}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-center transition-healing",
                spine.persona === pe.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
              )}
            >
              <div className="text-xs font-semibold">{pe.n}</div>
              <div className="text-[9px] tracking-wider text-muted-foreground">{pe.d}</div>
            </button>
          ))}
        </div>

        {/* 確認門 */}
        <ConfirmGate />

        {/* 對話訊息 */}
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

        {/* 輸入列 */}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`以「${activePersona}」人格對話… CO-STAR × RAG`}
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
      </CardContent>
    </Card>
  );
}

export default DirectorColumn;
