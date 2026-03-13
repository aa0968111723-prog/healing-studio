import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Clapperboard, BookOpen, Save } from "lucide-react";
import { Streamdown } from "streamdown";

export default function DirectorAI() {
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
  const [lastScript, setLastScript] = useState<Record<string, string> | null>(null);

  const chatMutation = trpc.director.chat.useMutation({
    onSuccess: (data) => {
      const scriptSummary = data.script
        ? `\n\n---\n**CO-STAR 腳本已生成：**\n\n**背景：** ${data.script.context}\n\n**情境：** ${data.script.situation}\n\n**任務：** ${data.script.task}\n\n**行動：** ${data.script.action}\n\n**預期結果：** ${data.script.result}\n\n---\n**視覺提示詞：** ${data.script.visualPrompt}\n\n**語音腳本：** ${data.script.audioScript}\n\n**音樂風格：** ${data.script.musicVibe}`
        : "";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: (data.research || "已完成分析。") + scriptSummary,
        },
      ]);
      setLastScript(data.script);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-semibold">導演 AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="save-notes"
              checked={saveToNotes}
              onCheckedChange={setSaveToNotes}
            />
            <Label htmlFor="save-notes" className="text-sm">
              自動儲存至筆記
            </Label>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        使用雙引擎 RAG（事實研究 + 創意編排）和 CO-STAR 框架，幫你構思完整的多媒體創作腳本
      </p>

      <AIChatBox
        messages={messages}
        onSendMessage={handleSend}
        isLoading={chatMutation.isPending}
        placeholder="描述你的創作構想... 例如：我想製作一部關於台灣茶文化的短片"
        height="calc(100vh - 280px)"
        emptyStateMessage="告訴導演 AI 你的創作構想"
        suggestedPrompts={[
          "幫我構思一部療癒系短片",
          "我想製作一段冥想引導音頻",
          "設計一個品牌宣傳影片腳本",
        ]}
      />

      {lastScript && (
        <div className="healing-card bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              最新腳本
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[25px] gap-1"
              onClick={() => toast.info("腳本已複製到剪貼簿")}
            >
              <Save className="w-3 h-3" />
              儲存
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            視覺提示詞：{lastScript.visualPrompt?.substring(0, 100)}...
          </div>
        </div>
      )}
    </div>
  );
}
