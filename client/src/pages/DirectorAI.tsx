import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Clapperboard, Send, Save, Image, Music, Mic, ChevronRight } from "lucide-react";
import { GlassCard, ZenOrb, ZenSkeleton } from "@/components/ZenCoPilot";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import type { CoStarScript } from "@shared/types";

export default function DirectorAI() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      content: `你是「導演 AI」，一位專業的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。

CO-STAR 框架：
- Context（背景）：場景的背景設定
- Situation（情境）：當前的情境描述
- Task（任務）：需要完成的創作任務
- Action（行動）：具體的執行步驟
- Result（結果）：預期的成果

請用繁體中文回覆，並提供具體、有創意的建議。`,
    },
  ]);
  const [saveToNotes, setSaveToNotes] = useState(false);
  const [scripts, setScripts] = useState<CoStarScript[]>([]);
  const [showStoryboard, setShowStoryboard] = useState(!isMobile);

  const chatMutation = trpc.director.chat.useMutation({
    onSuccess: (data) => {
      const scriptSummary = data.script
        ? `\n\n---\n**CO-STAR 腳本已生成**\n\n| 欄位 | 內容 |\n|------|------|\n| 背景 | ${data.script.context} |\n| 情境 | ${data.script.situation} |\n| 任務 | ${data.script.task} |\n| 行動 | ${data.script.action} |\n| 結果 | ${data.script.result} |\n\n**視覺提示詞：** ${data.script.visualPrompt}\n\n**語音腳本：** ${data.script.audioScript}\n\n**音樂風格：** ${data.script.musicVibe}`
        : "";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: (data.research || "已完成分析。") + scriptSummary,
        },
      ]);
      if (data.script) {
        setScripts((prev) => [...prev, data.script as CoStarScript]);
        if (!showStoryboard && !isMobile) setShowStoryboard(true);
      }
      if (saveToNotes) {
        toast.success("腳本已儲存至專案筆記");
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSend = (content: string) => {
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content },
    ];
    setMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      saveToNotes,
    });
  };

  const handleSendToStudio = (script: CoStarScript) => {
    sessionStorage.setItem("sendToStudio", JSON.stringify({
      prompt: script.visualPrompt,
      generationType: "multimodal",
      musicStyle: script.musicVibe,
      audioScript: script.audioScript,
    }));
    navigate("/studio");
    toast.success("腳本已發送到工作室");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clapperboard className="w-5 h-5 text-zen-smoke" />
          <h1 className="text-xl font-semibold">導演 AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="save-notes"
              checked={saveToNotes}
              onCheckedChange={setSaveToNotes}
            />
            <Label htmlFor="save-notes" className="text-xs">
              自動儲存至筆記
            </Label>
          </div>
          {!isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1"
              onClick={() => setShowStoryboard(!showStoryboard)}
            >
              {showStoryboard ? "隱藏" : "顯示"} Storyboard
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        雙引擎 RAG（事實研究 + CO-STAR 創意編排）— 生成的腳本可一鍵發送到工作室
      </p>

      {/* Split-Screen Layout */}
      <div className="flex gap-5">
        {/* Left: Chat Panel */}
        <div className={`flex-1 transition-all ${showStoryboard && !isMobile ? "max-w-[55%]" : ""}`}>
          <AIChatBox
            messages={messages}
            onSendMessage={handleSend}
            isLoading={chatMutation.isPending}
            placeholder="描述你的創作構想..."
            height={isMobile ? "calc(100vh - 320px)" : "calc(100vh - 260px)"}
            emptyStateMessage="告訴導演 AI 你的創作構想"
            suggestedPrompts={[
              "幫我構思一部禪意短片",
              "我想製作一段冥想引導音頻",
              "設計一個品牌宣傳影片腳本",
            ]}
          />
        </div>

        {/* Right: Storyboard Panel (desktop) */}
        <AnimatePresence>
          {showStoryboard && !isMobile && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "45%", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <GlassCard hover={false} className="h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <ZenOrb size="sm" />
                    Storyboard
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {scripts.length} 個腳本
                  </span>
                </div>

                <ScrollArea className="h-[calc(100vh-340px)]">
                  {scripts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <ZenOrb size="md" />
                      <p className="text-sm text-muted-foreground mt-4">
                        與導演 AI 對話後，腳本會自動出現在這裡
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4 pr-2">
                      {scripts.map((script, idx) => (
                        <div key={idx} className="rounded-xl border border-border/50 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              腳本 #{idx + 1}
                            </span>
                            <Button
                              size="sm"
                              className="rounded-lg gap-1 text-xs h-7"
                              onClick={() => handleSendToStudio(script)}
                            >
                              <Send className="w-3 h-3" />
                              發送到工作室
                            </Button>
                          </div>

                          {/* CO-STAR Summary */}
                          <div className="space-y-1.5">
                            {[
                              { label: "背景", value: script.context },
                              { label: "情境", value: script.situation },
                              { label: "任務", value: script.task },
                              { label: "行動", value: script.action },
                              { label: "結果", value: script.result },
                            ].map((item) => (
                              <div key={item.label} className="flex gap-2">
                                <span className="text-[11px] font-medium text-muted-foreground w-8 shrink-0">{item.label}</span>
                                <span className="text-xs text-foreground leading-relaxed">{item.value}</span>
                              </div>
                            ))}
                          </div>

                          {/* Dispatch Targets */}
                          <div className="flex gap-2 pt-2 border-t border-border/30">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                              <Image className="w-3 h-3" /> Veo 3.1
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                              <Music className="w-3 h-3" /> Suno V5
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                              <Mic className="w-3 h-3" /> ElevenLabs
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile: Storyboard as scrollable section below chat */}
      {isMobile && scripts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ZenOrb size="sm" />
            Storyboard ({scripts.length})
          </h3>
          {scripts.map((script, idx) => (
            <GlassCard key={idx} hover={false} className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">腳本 #{idx + 1}</span>
                <Button
                  size="sm"
                  className="rounded-lg gap-1 text-xs h-7"
                  onClick={() => handleSendToStudio(script)}
                >
                  <Send className="w-3 h-3" />
                  發送到工作室
                </Button>
              </div>
              <p className="text-xs text-foreground line-clamp-3">{script.context}</p>
              <div className="flex gap-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                  <Image className="w-3 h-3" /> 視覺
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                  <Music className="w-3 h-3" /> 音樂
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                  <Mic className="w-3 h-3" /> 語音
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
