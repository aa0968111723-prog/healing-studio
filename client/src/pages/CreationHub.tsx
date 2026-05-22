import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useProjects } from "@/contexts/ProjectsContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { ArrowRight, Sparkles } from "lucide-react";

const ORB_HANDOFF_KEY = "home-orb-pending-prompt";

const quickActions = [
  "做一支影片",
  "做一張海報 / 文宣",
  "產生圖片",
  "產生配音 / 音樂",
  "整理素材",
  "訓練模型",
] as const;

const shortcuts = [
  "幫我規劃今天的創作流程",
  "我想先做一支短影片，幫我拆步驟",
  "幫我整理目前專案下一步",
] as const;

export default function CreationHub() {
  const [, setLocation] = useLocation();
  const { activeProject } = useProjects();
  const [orbPrompt, setOrbPrompt] = useState("");

  const projectStage = useMemo(
    () => (activeProject?.updatedAt ? "製作中" : "概念規劃"),
    [activeProject?.updatedAt],
  );

  useRegisterPageAgent({
    pageId: "create",
    pageLabel: "創作作業系統",
    pagePath: "/create",
    capabilities: [],
    state: { surface: "creation-dashboard" },
    handle: async () => ({ ok: false, reason: "create: no-op" }),
  });

  const submitOrbPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    try {
      window.sessionStorage.setItem(ORB_HANDOFF_KEY, trimmed);
    } catch {
      // ignore storage failures
    }
    setLocation("/agent");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">創作作業系統</p>
          <h1 className="text-2xl font-semibold">全站創作系統專案管理區</h1>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">全站導覽一覽</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>全站架構</DialogTitle>
              <DialogDescription>從主控台快速進入不同創作系統。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="rounded-xl border p-3">創作工作室 / 影片 / 圖像 / 聲音</div>
              <div className="rounded-xl border p-3">導演 AI / 分鏡 / 腳本 / 提示詞</div>
              <div className="rounded-xl border p-3">專案 / 團隊 / 排程 / 筆記</div>
              <div className="rounded-xl border p-3">資產庫 / 模型 / 生成歷史 / 教學</div>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-5 px-6 pb-10 lg:grid-cols-3">
        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-3 text-lg font-semibold">快速開始</h2>
          <div className="grid gap-2">
            {quickActions.map(item => (
              <Button
                key={item}
                variant="secondary"
                className="justify-between"
                onClick={() => setLocation("/studio")}
              >
                <span>{item}</span>
                <ArrowRight className="size-4" />
              </Button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-3 text-lg font-semibold">團隊與個人專案進度</h2>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">我的專案：</span>{activeProject?.title ?? "尚未指定"}</p>
            <p><span className="text-muted-foreground">團隊專案：</span>Healing Studio 協作計畫</p>
            <p><span className="text-muted-foreground">專案階段：</span>{projectStage}</p>
            <p><span className="text-muted-foreground">下一步建議：</span>先完成今天的核心產出，再補齊素材與註記。</p>
          </div>
          <Button className="mt-4 w-full" onClick={() => setLocation("/projects")}>繼續創作</Button>
        </section>

        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-4" /> 詢問光球</h2>
          <textarea
            value={orbPrompt}
            onChange={e => setOrbPrompt(e.target.value)}
            placeholder="把你現在卡住的問題告訴光球…"
            className="min-h-28 w-full rounded-xl border bg-background p-3 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {shortcuts.map(q => (
              <Button key={q} size="sm" variant="outline" onClick={() => submitOrbPrompt(q)}>{q}</Button>
            ))}
          </div>
          <Button className="mt-3 w-full" onClick={() => submitOrbPrompt(orbPrompt)}>送出給光球</Button>
        </section>
      </main>
    </div>
  );
}
