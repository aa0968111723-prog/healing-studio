// ============================================================================
// shells/AidvShellChrome.tsx — U-4 殼層 chrome 視覺實裝（AIDV-94 · Wave U · flag-gated）
// ----------------------------------------------------------------------------
// 用 U-10 落地的 design-kit chrome 元件（Rail/TopBar/MobileNav/CommandPalette）組成
// 亮色暖光 app 殼，接真實 4-shell（SHELL_META）＋ wouter 導航＋⌘K。
//
// 【定位】overlay 型：只渲染 fixed 的 Rail（左 76px）＋TopBar（上 58px）＋MobileNav（≤md 底部）
//   ＋⌘K 面板；不包裹 children（由 DashboardLayout 給 main 加對應 padding）。
// 【旗標】掛載端（DashboardLayout）以 ENABLE_AIDV_CHROME 守門，預設 OFF＝不渲染、沿用 AppleDock
//   ＝線上零變化。本元件本身不持有旗標。
// ============================================================================
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  AidvKit, Rail, TopBar, MobileNav, CommandPalette, ProjectSwitcher,
  type DkShellDef, type DkCommandItem, type DkProjectLite,
} from "@/components/design-kit";
import { SHELL_META } from "@/config/shells";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { useCreativeProject } from "@/spine/useCreativeProject";
import type { ShellId } from "@/spine/types";

const SHELLS: DkShellDef[] = SHELL_META.map((s) => ({ id: s.id, emoji: s.emoji, name: s.zh, enabled: s.enabled }));

/** 由路徑前綴推當前 shell（與 ShellFrame 路由前綴一致）。 */
export function shellFromPath(path: string): ShellId {
  const seg = path.split("/")[1];
  if (seg === "social" || seg === "learn" || seg === "settings") return seg;
  return "video";
}

export function AidvShellChrome() {
  const [location, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [psOpen, setPsOpen] = useState(false);
  const active = shellFromPath(location);
  const activeMeta = SHELL_META.find((s) => s.id === active) ?? SHELL_META[0];

  // U-4 第二/三片：接真實資料（皆在旗標之下、僅 chrome ON 時查詢）。
  const world = useCreativeProject();
  const projectsQ = trpc.creativeProject.list.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const projectList: DkProjectLite[] = (projectsQ.data ?? []).map((p) => ({ id: String(p.id), name: p.title }));
  const balanceQ = trpc.credits.myBalance.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const credits = typeof balanceQ.data?.remaining === "number" ? balanceQ.data.remaining : undefined;

  // ⌘K / Ctrl+K 開關命令面板（全站快捷）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goShell = (id: ShellId) => {
    const meta = SHELL_META.find((s) => s.id === id);
    if (meta) navigate(meta.path);
  };

  const cmdItems: DkCommandItem[] = [
    ...SHELL_META.map((s) => ({ id: `shell-${s.id}`, label: `前往 ${s.zh}`, group: "導航", hint: s.path, onRun: () => goShell(s.id) })),
    { id: "create", label: "創作中樞", group: "創作", hint: "/create", onRun: () => navigate("/create") },
    { id: "director", label: "導演企劃台", group: "創作", hint: "/director", onRun: () => navigate("/director") },
    { id: "playground", label: "單模型遊樂場", group: "創作", hint: "/playground", onRun: () => navigate("/playground") },
    { id: "new-project", label: "新建專案", group: "專案", hint: "/create", onRun: () => navigate("/create") },
    { id: "switch-project", label: "切換專案", group: "專案", onRun: () => setPsOpen(true) },
    { id: "go-settings", label: "設定", group: "設定", hint: "/settings", onRun: () => navigate("/settings") },
  ];

  return (
    <AidvKit>
      {!isMobile && (
        <div className="fixed left-0 top-0 z-40 h-svh">
          <Rail shells={SHELLS} active={active} onSelect={goShell} credits={credits} onHome={() => navigate("/")} onCmdK={() => setCmdkOpen(true)} />
        </div>
      )}
      <div className={cn("fixed right-0 top-0 z-30", isMobile ? "left-0" : "left-[76px]")}>
        <TopBar
          shell={{ id: activeMeta.id, emoji: activeMeta.emoji, name: activeMeta.zh }}
          projectSlot={
            <ProjectSwitcher
              projects={projectList}
              activeId={world.activeProjectId != null ? String(world.activeProjectId) : undefined}
              onSelect={(id) => world.setActiveProjectId(Number(id))}
              onCreate={() => navigate("/create")}
              open={psOpen}
              onToggle={() => setPsOpen((v) => !v)}
            />
          }
          credits={credits}
          onCmdK={() => setCmdkOpen(true)}
        />
      </div>
      {isMobile && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <MobileNav shells={SHELLS} active={active} onSelect={goShell} onCmdK={() => setCmdkOpen(true)} />
        </div>
      )}
      <CommandPalette open={cmdkOpen} items={cmdItems} onClose={() => setCmdkOpen(false)} />
    </AidvKit>
  );
}

export default AidvShellChrome;
