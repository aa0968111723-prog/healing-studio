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
import { ArrowRight, Sparkles, Clapperboard, Image, Music2, FolderKanban, Brain, Wand2 } from "lucide-react";

const quickActions = [
  { label: "做一支影片", icon: Clapperboard, path: "/studio/video" },
  { label: "做一張海報文宣", icon: Wand2, path: "/design" },
  { label: "產生圖片", icon: Image, path: "/studio/image" },
  { label: "產生配音音樂", icon: Music2, path: "/studio/pro" },
  { label: "整理素材", icon: FolderKanban, path: "/library" },
  { label: "訓練模型", icon: Brain, path: "/lora" },
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
    setLocation(`/agent?prompt=${encodeURIComponent(trimmed)}`);
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
                key={item.label}
                variant="secondary"
                className="justify-between group"
                onClick={() => setLocation(item.path)}
              >
                <span className="inline-flex items-center gap-2"><item.icon className="size-4" />{item.label}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-3 text-lg font-semibold">當前專案</h2>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">我的專案：</span>{activeProject?.title ?? "尚未指定"}</p>
            <p><span className="text-muted-foreground">狀態：</span>{projectStage}</p>
            <p><span className="text-muted-foreground">流程：</span>世界觀 ✅ / 腳本 ✅ / 分鏡 +新增 / 素材 +新增</p>
            <p><span className="text-muted-foreground">最近更新：</span>{activeProject?.updatedAt ? new Date(activeProject.updatedAt).toLocaleString() : "尚無"}</p>
          </div>
          <Button className="mt-4 w-full" onClick={() => setLocation("/projects")}>繼續創作 →</Button>
          <Button variant="link" className="mt-1 px-0" onClick={() => setLocation("/projects")}>查看所有專案</Button>
        </section>

        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-4" /> 詢問光球</h2>
          <textarea
            value={orbPrompt}
            onChange={e => setOrbPrompt(e.target.value)}
            placeholder="告訴光球你的目標，它會幫你定位到正確系統"
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
      <section className="mx-auto w-full max-w-6xl px-6 pb-10">
        <h3 className="mb-3 text-base font-semibold">六大系統快速入口</h3>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {["光球代理系統","設計/規劃/執行","影片腳本/世界觀","資料庫系統","全站設定","學習文件系統"].map((name) => (
            <div key={name} className="rounded-xl border bg-card p-3 text-sm">{name}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
