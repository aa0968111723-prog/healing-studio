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
  AidvKit, Rail, TopBar, MobileNav, CommandPalette, ProjectSwitcher, ProviderSwitcher, AccountMenu,
  ToastProvider, Toasts,
  type DkShellDef, type DkCommandItem, type DkProjectLite, type DkProviderEntry,
} from "@/components/design-kit";
import { SHELL_META } from "@/config/shells";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { ENABLE_ORB_ONBOARDING } from "@/config/featureFlags";
import { OrbOnboardingDialog } from "@/components/orb-agent/OrbOnboardingDialog";
import { useCreativeProject } from "@/spine/useCreativeProject";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSpine } from "@/providers/SpineProvider";
import { PROVIDER_META, type ProviderId } from "@/components/design-kit/tokens";
import type { ShellId } from "@/spine/types";
import { useTheme } from "@/contexts/ThemeContext";

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
  const [acctOpen, setAcctOpen] = useState(false);
  const [provOpen, setProvOpen] = useState(false);
  const active = shellFromPath(location);
  const activeMeta = SHELL_META.find((s) => s.id === active) ?? SHELL_META[0];

  // AIDV-823: onboarding dialog state — only active when flag is ON
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const prefsQ = trpc.agentPreferences.getPreferences.useQuery(undefined, {
    enabled: ENABLE_ORB_ONBOARDING,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (
      ENABLE_ORB_ONBOARDING &&
      !prefsQ.isLoading &&
      prefsQ.data &&
      !prefsQ.data.onboardingCompletedAt &&
      !localStorage.getItem('ai-director-onboarded') &&
      !localStorage.getItem('orb-onboarding-skipped')
    ) {
      setOnboardingOpen(true);
    } else if (ENABLE_ORB_ONBOARDING && prefsQ.isError) {
      setOnboardingOpen(true);
    }
  }, [prefsQ.data, prefsQ.isLoading, prefsQ.isError]);

  // U-4 第二/三片：接真實資料（皆在旗標之下、僅 chrome ON 時查詢）。
  const world = useCreativeProject();
  const spine = useSpine();
  // P1（Codex 審查）：chrome 取代 AppleDock 後須保留登出出口。
  // 登出出口有三：① TopBar 右側 AccountMenu（桌機可見）② MobileNav ⏻（行動可見）③ ⌘K「登出」（快捷）。
  // 不可只藏在 ⌘K——行動裝置無實體 ⌘K、桌機使用者也未必知道要按。三處皆呼叫同一真實 logout()。
  const { logout, user } = useAuth();
  const { setAppearanceMode } = useTheme();
  const accountLabel =
    (user && typeof user === "object"
      ? ((user as { name?: string; email?: string }).name ?? (user as { email?: string }).email)
      : undefined) ?? undefined;
  const doLogout = () => { setAcctOpen(false); void logout(); };

  const projectsQ = trpc.creativeProject.list.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const STATUS_EMOJI: Record<string, string> = { concept: "💡", production: "🎬", review: "🔍", complete: "✅" };
  const STATUS_ZH: Record<string, string> = { concept: "概念", production: "製作中", review: "審閱中", complete: "完成" };
  const projectList: DkProjectLite[] = (projectsQ.data ?? []).map((p) => ({
    id: String(p.id),
    name: p.title,
    emoji: STATUS_EMOJI[(p as { status?: string }).status ?? ""] ?? "🎬",
    subtitle: STATUS_ZH[(p as { status?: string }).status ?? ""],
  }));

  // AIDV-134：Context Packet meter — 讀作用專案最新 packet（不重算；30 min TTL）
  const activeProjectId = world.activeProjectId;
  const ctxPktQ = trpc.contextPacket.getLatest.useQuery(
    { projectId: activeProjectId! },
    { enabled: activeProjectId != null, staleTime: 60_000, refetchOnWindowFocus: false }
  );
  const CTX_MAX_TOKENS = 4096;
  const contextPct = ctxPktQ.data?.tokenEstimate != null
    ? Math.min(100, Math.round((ctxPktQ.data.tokenEstimate / CTX_MAX_TOKENS) * 100))
    : undefined;
  const ttlLabel = (() => {
    const exp = ctxPktQ.data?.expiresAt;
    if (!exp) return undefined;
    const ms = new Date(exp).getTime() - Date.now();
    if (ms <= 0) return "已過期";
    const mins = Math.floor(ms / 60_000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  })();

  // AIDV-134：切換專案後在背景重建 Context Packet（fire-and-forget）
  const compileMut = trpc.contextPacket.compileProject.useMutation();

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

  // U-4b ProviderSwitcher — build entries from PROVIDER_META + fault-injection for down status.
  const providerEntries: DkProviderEntry[] = (["hf", "gemini", "fal", "mock"] as ProviderId[]).map((id) => ({
    id,
    label: PROVIDER_META[id].label,
    cost: PROVIDER_META[id].cost,
    status: spine.faults[`provider.${id}`] ? "down" : "ok",
  }));

  const cmdItems: DkCommandItem[] = [
    // 前往 group（首頁/四殼層）
    { id: "go-home", label: "前往 首頁", group: "前往", hint: "/", onRun: () => navigate("/") },
    ...SHELL_META.map((s) => ({ id: `shell-${s.id}`, label: `前往 ${s.zh}`, group: "前往", hint: s.path, onRun: () => goShell(s.id) })),
    // 創作 group
    { id: "create", label: "創作中樞", group: "創作", hint: "/create", onRun: () => navigate("/create") },
    { id: "director", label: "導演企劃台", group: "創作", hint: "/director", onRun: () => navigate("/director") },
    { id: "playground", label: "單模型遊樂場", group: "創作", hint: "/playground", onRun: () => navigate("/playground") },
    // 代理動作 group（AIDV-136：排程生成/重建 Context Packet/i2v 研究/自訂工作流）
    { id: "agent-schedule", label: "排程生成所有就緒鏡", group: "代理動作", hint: "/video", onRun: () => navigate("/video") },
    { id: "agent-ctx", label: "重建 Context Packet", group: "代理動作", hint: "/video/director", onRun: () => navigate("/video/director") },
    { id: "agent-i2v", label: "研究 i2v 一致性", group: "代理動作", hint: "/video/director", onRun: () => navigate("/video/director") },
    { id: "agent-workflow", label: "自訂工作流", group: "代理動作", hint: "/create", onRun: () => navigate("/create") },
    // 切換專案 group
    { id: "new-project", label: "新建專案", group: "切換專案", hint: "/create", onRun: () => navigate("/create") },
    { id: "switch-project", label: "切換專案", group: "切換專案", onRun: () => setPsOpen(true) },
    // 生成 Provider group
    { id: "switch-provider", label: "切換生成 Provider", group: "生成 Provider", onRun: () => setProvOpen(true) },
    // 主題 group（AIDV-136）
    { id: "theme-light", label: "淺色主題", group: "主題", onRun: () => setAppearanceMode("light") },
    { id: "theme-dark", label: "深色主題", group: "主題", onRun: () => setAppearanceMode("dark") },
    { id: "theme-system", label: "跟隨系統", group: "主題", onRun: () => setAppearanceMode("system") },
    { id: "theme-auto", label: "自動（情境）", group: "主題", onRun: () => setAppearanceMode("auto") },
    // 設定 / 帳號
    { id: "go-settings", label: "設定", group: "設定", hint: "/settings", onRun: () => navigate("/settings") },
    { id: "logout", label: "登出", group: "帳號", hint: "結束登入", onRun: () => void logout() },
  ];

  return (
    <ToastProvider>
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
              onSelect={(id) => {
                world.setActiveProjectId(Number(id));
                compileMut.mutate({ projectId: Number(id), mode: "director" });
              }}
              onCreate={() => navigate("/create")}
              open={psOpen}
              onToggle={() => setPsOpen((v) => !v)}
              contextPct={contextPct}
              ttlLabel={ttlLabel}
            />
          }
          providerSlot={
            <ProviderSwitcher
              activeId={spine.provider}
              entries={providerEntries}
              open={provOpen}
              onToggle={() => setProvOpen((v) => !v)}
              onSwitch={(id) => spine.setProvider(id as ProviderId)}
              onSettings={() => navigate("/settings/provider")}
            />
          }
          credits={credits}
          onCmdK={() => setCmdkOpen(true)}
          accountSlot={
            <AccountMenu
              label={accountLabel}
              onLogout={doLogout}
              onSettings={() => { setAcctOpen(false); navigate("/settings"); }}
              open={acctOpen}
              onToggle={() => setAcctOpen((v) => !v)}
            />
          }
        />
      </div>
      {isMobile && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <MobileNav shells={SHELLS} active={active} onSelect={goShell} onCmdK={() => setCmdkOpen(true)} onLogout={doLogout} />
        </div>
      )}
      <CommandPalette open={cmdkOpen} items={cmdItems} onClose={() => setCmdkOpen(false)} />
      <Toasts />
    </AidvKit>
    {ENABLE_ORB_ONBOARDING && (
      <OrbOnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onCompleted={() => { if (location !== "/video") navigate("/video"); }}
      />
    )}
    </ToastProvider>
  );
}

export default AidvShellChrome;
