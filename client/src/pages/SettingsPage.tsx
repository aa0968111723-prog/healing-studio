import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { ResetAllToursButton } from "@/components/SiteOnboardingOverlay";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Settings,
  User,
  RotateCcw,
  Brain,
  ChevronRight,
  Shield,
  Sun,
  Moon,
  Clapperboard,
  Eye,
  Bell,
  Palette,
  BarChart3,
  Coins,
  Activity,
  Monitor,
  Coffee,
  Waves,
  ExternalLink,
  Sparkles,
  Link2,
} from "lucide-react";
import { useTheme, type AppearanceMode } from "@/contexts/ThemeContext";
import { useCurrentScene } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import { useLocation } from "wouter";
import {
  usePersonalSettings,
  type PersonalSettings,
} from "@/contexts/PersonalSettingsContext";
import { useViewMode } from "@/hooks/useMobile";

// ─── Appearance Mode Definitions ────────────────────────────────────────────

const APPEARANCE_MODES: {
  id: AppearanceMode;
  label: string;
  description: string;
  icon: typeof Sun;
  preview: string;
}[] = [
  {
    id: "light",
    label: "亮色模式",
    description: "始終使用柔和暖色調亮色主題",
    icon: Sun,
    preview: "linear-gradient(135deg, #f8f5f0 0%, #f0ebe3 50%, #ede5d8 100%)",
  },
  {
    id: "dark",
    label: "深色模式",
    description: "始終使用護眼深色主題",
    icon: Moon,
    preview: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  },
  {
    id: "auto",
    label: "場景連動",
    description: "根據背景場景自動切換亮/深色",
    icon: Sparkles,
    preview: "linear-gradient(135deg, #ffebd2 0%, #051932 50%, #ebdcc8 100%)",
  },
  {
    id: "system",
    label: "跟隨系統",
    description: "依作業系統偏好自動決定",
    icon: Monitor,
    preview: "linear-gradient(135deg, #e8e8e8 0%, #333333 100%)",
  },
];

// ─── Scene Definitions ──────────────────────────────────────────────────────

const SCENE_OPTIONS: {
  id: SceneId;
  label: string;
  description: string;
  icon: typeof Moon;
  timeRange: string;
  preview: string;
}[] = [
  {
    id: "nightSky",
    label: "夜空",
    description: "深藍星空 · 流星閃爍 · 星雲光暈",
    icon: Moon,
    timeRange: "22:00 – 05:00",
    preview: "linear-gradient(135deg, #0a0c23 0%, #191245 50%, #0a0820 100%)",
  },
  {
    id: "morning",
    label: "晨光",
    description: "暖橙日出 · 光塵飄浮 · 柔和光暈",
    icon: Sun,
    timeRange: "05:00 – 11:00",
    preview: "linear-gradient(135deg, #ffebd2 0%, #ffd4a0 50%, #ffe8c0 100%)",
  },
  {
    id: "cafe",
    label: "咖啡廳",
    description: "暖棕午後 · 蒸氣上升 · 散景光點",
    icon: Coffee,
    timeRange: "11:00 – 17:00",
    preview: "linear-gradient(135deg, #ebdcc8 0%, #d4c0a8 50%, #f5ebe0 100%)",
  },
  {
    id: "deepSea",
    label: "深海",
    description: "深青海洋 · 氣泡上浮 · 水波光影",
    icon: Waves,
    timeRange: "17:00 – 22:00",
    preview: "linear-gradient(135deg, #051932 0%, #0a2846 50%, #051428 100%)",
  },
];

// ─── Third-party Wallpaper Resources ────────────────────────────────────────

const WALLPAPER_RESOURCES = [
  {
    name: "Unsplash",
    description: "免費高品質攝影作品，可用作桌面背景靈感",
    url: "https://unsplash.com/t/wallpapers",
    icon: "🖼️",
  },
  {
    name: "Pexels",
    description: "免費素材圖庫，療癒風景與自然攝影",
    url: "https://www.pexels.com/search/wallpaper/",
    icon: "📸",
  },
  {
    name: "Dribbble",
    description: "設計師社群作品集，UI/UX 設計靈感",
    url: "https://dribbble.com/tags/wallpaper",
    icon: "🎨",
  },
  {
    name: "Coolors",
    description: "色彩搭配工具，探索療癒色票組合",
    url: "https://coolors.co/palettes/trending",
    icon: "🎨",
  },
];

export default function SettingsPage() {
  const { user } = useAuth();
  usePageTour("settings");
  const { settings, updateSettings, isHydrated } = usePersonalSettings();
  const { viewMode, setViewMode } = useViewMode();
  const { theme, appearanceMode, setAppearanceMode } = useTheme();
  const {
    sceneId,
    override: sceneOverride,
    setOverride: setSceneOverride,
  } = useCurrentScene();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("profile");
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  const [personalPrefs, setPersonalPrefs] = useState<
    Pick<
      PersonalSettings,
      "displayName" | "timezone" | "bio" | "compactMode" | "confirmBeforeGenerate"
    >
  >({
    displayName: settings.displayName,
    timezone: settings.timezone,
    bio: settings.bio,
    compactMode: settings.compactMode,
    confirmBeforeGenerate: settings.confirmBeforeGenerate,
  });

  useEffect(() => {
    if (!isHydrated) return;
    setPersonalPrefs({
      displayName: settings.displayName,
      timezone: settings.timezone,
      bio: settings.bio,
      compactMode: settings.compactMode,
      confirmBeforeGenerate: settings.confirmBeforeGenerate,
    });
  }, [settings, isHydrated]);

  const personalPrefsDirty = JSON.stringify(personalPrefs) !== JSON.stringify({
    displayName: settings.displayName,
    timezone: settings.timezone,
    bio: settings.bio,
    compactMode: settings.compactMode,
    confirmBeforeGenerate: settings.confirmBeforeGenerate,
  });

  const handleRestartOnboarding = () => {
    localStorage.removeItem("ai-director-onboarded");
    localStorage.removeItem("hasSeenTour");
    localStorage.removeItem("onboarded");
    window.dispatchEvent(
      new CustomEvent("site-tour-start", { detail: { pageId: "welcome" } })
    );
    toast.success("已重置引導狀態，全站引導即將開始...");
  };

  const handleSavePersonalPrefs = () => {
    const sanitized = {
      ...personalPrefs,
      displayName: personalPrefs.displayName.trim().slice(0, 40),
      timezone: personalPrefs.timezone.trim().slice(0, 80) || "Etc/UTC",
      bio: personalPrefs.bio.trim().slice(0, 180),
    };
    updateSettings(sanitized);
    setPersonalPrefs(sanitized);
    toast.success("個人化偏好已儲存");
  };

  const handleResetPersonalPrefs = () => {
    setPersonalPrefs({
      displayName: settings.displayName,
      timezone: settings.timezone,
      bio: settings.bio,
      compactMode: settings.compactMode,
      confirmBeforeGenerate: settings.confirmBeforeGenerate,
    });
    toast.success("已還原為上次儲存內容");
  };

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!tabsListRef.current) return;
    const activeEl = tabsListRef.current.querySelector<HTMLElement>(
      '[data-state="active"]'
    );
    activeEl?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeTab]);

  // ─── PageAgent 註冊（Phase 4b：個人設定接入光球） ────────────────────────
  // 光球可幫：切分頁（profile/appearance/notifications/onboarding/admin）、
  // 套用外觀模式（light/dark/auto/system）、鎖定背景場景、跳到常用子頁。
  const SETTINGS_TAB_OPTIONS = useMemo<AgentCapability["options"]>(() => {
    const base = [
      { id: "profile", label: "個人資料", meta: { bestFor: "帳戶資訊管理", tip: "定期檢查顯示名稱與偏好" } },
      { id: "appearance", label: "外觀", meta: { bestFor: "視覺舒適度", tip: "依作業時段切換明暗模式" } },
      { id: "notifications", label: "通知", meta: { bestFor: "訊息節奏控管", tip: "保留關鍵通知避免干擾" } },
      { id: "onboarding", label: "引導", meta: { bestFor: "流程重置", tip: "需求變動時可重新走引導" } },
    ];
    return isAdmin
      ? [...base, { id: "admin", label: "管理員", meta: { bestFor: "系統維運", tip: "僅在必要時調整高風險設定" } }]
      : base;
  }, [isAdmin]);
  const APPEARANCE_IDS = useMemo(
    () => APPEARANCE_MODES.map(m => m.id),
    []
  );
  const SCENE_IDS = useMemo(() => SCENE_OPTIONS.map(s => s.id), []);
  const SETTINGS_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/director",
        "/credits",
        "/admin",
        "/settings/ai-brain",
        "/langsmith",
      ]),
    []
  );
  const settingsAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換設定分頁",
        currentId: activeTab,
        options: SETTINGS_TAB_OPTIONS,
        hint: "切到 profile / appearance / notifications / onboarding（admin 限管理員）",
      },
      {
        action: "setParam",
        label: "外觀與場景",
        options: [
          { id: "appearanceMode", label: "外觀模式", meta: { bestFor: "閱讀舒適", tip: "夜間建議 dark/auto" } },
          { id: "scene", label: "背景場景", meta: { bestFor: "專注氛圍", tip: "可先鎖定常用場景避免跳動" } },
          { id: "displayName", label: "偏好顯示名稱", meta: { bestFor: "個人化識別", tip: "可和帳號名稱分開管理" } },
          { id: "viewMode", label: "檢視模式", meta: { bestFor: "跨裝置瀏覽", tip: "統一在個人設定管理桌機/行動檢視" } },
        ],
        hint: "setParam key='appearanceMode' value=light|dark|auto|system；key='scene' value=nightSky|morning|cafe|deepSea；key='displayName' value='你的暱稱'；key='viewMode' value=auto|desktop|mobile；key='scene' value='' 表示恢復自動",
      },
      {
        action: "navigate",
        label: "跳到相關子頁",
        hint: "navigate path='/director' | '/credits' | '/admin'（限管理員）| '/settings/ai-brain'（限管理員）| '/langsmith'（限管理員）",
      },
      {
        action: "reset",
        label: "回到個人資料分頁",
        hint: "activeTab 還原為 profile",
      },
    ],
    [activeTab, SETTINGS_TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "settings",
    pageLabel: "個人設定",
    pagePath: "/settings",
    capabilities: settingsAgentCapabilities,
    state: {
      activeTab,
      appearanceMode,
      theme,
      sceneId,
      sceneOverridden: sceneOverride !== null,
      soundEnabled: settings.soundEnabled,
      desktopNotif: settings.desktopNotif,
      isAdmin,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const allowed = SETTINGS_TAB_OPTIONS?.map(o => o.id) ?? [];
          if (!allowed.includes(action.tabId)) {
            return {
              ok: false,
              reason: `unknown tab or admin-only: ${action.tabId}`,
            };
          }
          setActiveTab(action.tabId);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "setParam": {
          if (action.key === "appearanceMode") {
            const v = String(action.value ?? "");
            if (!APPEARANCE_IDS.includes(v as AppearanceMode)) {
              return { ok: false, reason: `unknown appearanceMode: ${v}` };
            }
            setAppearanceMode(v as AppearanceMode);
            return { ok: true, message: `外觀切到「${v}」` };
          }
          if (action.key === "scene") {
            const v = action.value;
            if (v === null || v === "" || v === undefined) {
              setSceneOverride(null);
              return { ok: true, message: "已恢復自動場景" };
            }
            const s = String(v);
            if (!SCENE_IDS.includes(s as SceneId)) {
              return { ok: false, reason: `unknown scene: ${s}` };
            }
            setSceneOverride(s as SceneId);
            return { ok: true, message: `場景鎖定為「${s}」` };
          }
          if (action.key === "displayName") {
            const v = String(action.value ?? "").trim().slice(0, 40);
            setPersonalPrefs(prev => ({ ...prev, displayName: v }));
            updateSettings({ displayName: v });
            return { ok: true, message: `偏好名稱更新為「${v || "未設定"}」` };
          }
          if (action.key === "viewMode") {
            const v = String(action.value ?? "");
            if (v !== "auto" && v !== "desktop" && v !== "mobile") {
              return { ok: false, reason: `unknown viewMode: ${v}` };
            }
            setViewMode(v);
            return { ok: true, message: `檢視模式切到「${v}」` };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "navigate": {
          const path = String(action.path ?? "");
          if (!SETTINGS_NAV_ALLOWLIST.has(path)) {
            return { ok: false, reason: `不在允許跳轉清單：${path}` };
          }
          if (
            !isAdmin &&
            (path === "/admin" ||
              path === "/settings/ai-brain" ||
              path === "/langsmith")
          ) {
            return { ok: false, reason: "此路徑僅開放管理員" };
          }
          navigate(path);
          return { ok: true, message: `跳到 ${path}` };
        }
        case "reset": {
          setActiveTab("profile");
          return { ok: true, message: "分頁回到個人資料" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on settings: ${action.type}`,
          };
      }
    },
  });

  const handleToggleSound = (checked: boolean) => {
    updateSettings({ soundEnabled: checked });
    toast.success(checked ? "已開啟音效提示" : "已關閉音效提示");
  };

  const handleToggleDesktopNotif = async (checked: boolean) => {
    if (!("Notification" in window)) {
      setNotifPermission("unsupported");
      toast.error("目前裝置不支援桌面通知");
      return;
    }

    if (!checked) {
      updateSettings({ desktopNotif: false });
      setNotifPermission(Notification.permission);
      toast.success("已關閉桌面通知");
      return;
    }

    const currentPermission = Notification.permission;
    if (currentPermission === "granted") {
      updateSettings({ desktopNotif: true });
      setNotifPermission(currentPermission);
      toast.success("已開啟桌面通知");
      return;
    }

    if (currentPermission === "denied") {
      updateSettings({ desktopNotif: false });
      setNotifPermission(currentPermission);
      toast.error("通知權限已被封鎖，請先到瀏覽器設定開啟");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
    if (permission === "granted") {
      updateSettings({ desktopNotif: true });
      toast.success("已取得通知權限並開啟桌面通知");
    } else {
      updateSettings({ desktopNotif: false });
      toast.error("未取得通知權限，未啟用桌面通知");
    }
  };

  const handleSendTestNotification = () => {
    if (!("Notification" in window)) {
      toast.error("目前裝置不支援桌面通知");
      return;
    }
    if (Notification.permission !== "granted") {
      toast.error("請先允許通知權限，再進行測試");
      return;
    }
    const notification = new Notification("Healing Studio 測試通知", {
      body: "通知已成功啟用，點我回到個人設定頁。",
      icon: "/favicon.ico",
      tag: "healing-studio-settings-test",
    });
    notification.onclick = () => {
      window.focus();
      navigate("/settings");
      notification.close();
    };
    toast.success("已送出測試通知");
  };

  const handleOpenExternalResource = (url: string, label: string) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) {
      toast.success(`已開啟 ${label}`);
      return;
    }
    window.location.href = url;
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="hs-h1 !mb-0 text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6" />
          個人設定
        </h1>
        <p className="hs-small !mb-0 text-muted-foreground mt-1">
          管理你的帳號、外觀偏好與通知設定
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList
          ref={tabsListRef}
          className="rounded-xl bg-muted/40 p-1 flex-nowrap overflow-x-auto h-auto gap-1 w-full justify-start snap-x snap-mandatory"
        >
          <TabsTrigger
            value="profile"
            className="rounded-lg gap-1 text-sm shrink-0 min-w-[96px] snap-center"
          >
            <User className="w-3 h-3" /> 個人資料
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="rounded-lg gap-1 text-sm shrink-0 min-w-[88px] snap-center"
          >
            <Palette className="w-3 h-3" /> 外觀
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="rounded-lg gap-1 text-sm shrink-0 min-w-[88px] snap-center"
          >
            <Bell className="w-3 h-3" /> 通知
          </TabsTrigger>
          <TabsTrigger
            value="onboarding"
            className="rounded-lg gap-1 text-sm shrink-0 min-w-[88px] snap-center"
          >
            <Eye className="w-3 h-3" /> 引導
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="admin"
              className="rounded-lg gap-1 text-sm shrink-0 min-w-[92px] snap-center"
            >
              <Shield className="w-3 h-3" /> 管理員
            </TabsTrigger>
          )}
        </TabsList>

        {/* ═══ Tab 1: Profile ═══ */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-4 flex items-center gap-2">
              <User className="w-4 h-4" />
              帳號資訊
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">名稱</Label>
                <p className="text-sm font-medium text-foreground mt-1">
                  {user?.name || "未設定"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  電子郵件
                </Label>
                <p className="text-sm font-medium text-foreground mt-1">
                  {user?.email || "未設定"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">角色</Label>
                <p className="text-sm font-medium text-foreground mt-1">
                  {isAdmin ? "管理員" : "使用者"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  剩餘配額
                </Label>
                <p className="text-sm font-medium text-foreground mt-1 tabular-nums">
                  {user?.remainingGenerations ?? 0} 次
                </p>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-4 flex items-center gap-2">
              <User className="w-4 h-4" />
              個人化偏好（可儲存）
            </h2>
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">
                  偏好顯示名稱
                </Label>
                <Input
                  value={personalPrefs.displayName}
                  maxLength={40}
                  onChange={e =>
                    setPersonalPrefs(prev => ({
                      ...prev,
                      displayName: e.target.value,
                    }))
                  }
                  placeholder={user?.name || "輸入你希望顯示的名稱"}
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  目前實際顯示：{personalPrefs.displayName.trim() || user?.name || "未設定"}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    時區
                  </Label>
                  <Input
                    value={personalPrefs.timezone}
                    maxLength={80}
                    onChange={e =>
                      setPersonalPrefs(prev => ({
                        ...prev,
                        timezone: e.target.value,
                      }))
                    }
                    placeholder="例如：Asia/Taipei"
                    className="mt-1"
                  />
                </div>
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">
                      緊湊介面模式
                    </Label>
                    <Switch
                      checked={personalPrefs.compactMode}
                      onCheckedChange={checked =>
                        setPersonalPrefs(prev => ({
                          ...prev,
                          compactMode: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">
                      生成前二次確認
                    </Label>
                    <Switch
                      checked={personalPrefs.confirmBeforeGenerate}
                      onCheckedChange={checked =>
                        setPersonalPrefs(prev => ({
                          ...prev,
                          confirmBeforeGenerate: checked,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">個人簡介</Label>
                <Textarea
                  value={personalPrefs.bio}
                  maxLength={180}
                  onChange={e =>
                    setPersonalPrefs(prev => ({ ...prev, bio: e.target.value }))
                  }
                  placeholder="可記錄你的創作偏好、語氣習慣或目標（最多 180 字）"
                  className="mt-1 min-h-[96px]"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="rounded-lg"
                  onClick={handleSavePersonalPrefs}
                >
                  儲存偏好
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={handleResetPersonalPrefs}
                  disabled={!personalPrefsDirty}
                >
                  還原未儲存變更
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {personalPrefsDirty ? "有未儲存變更" : "已同步最新儲存內容"}
                </span>
              </div>
            </div>
          </GlassCard>

          {/* Quick link: Director AI preferences */}
          <GlassCard>
            <button
              onClick={() => navigate("/director")}
              className="w-full flex items-center justify-between p-1 rounded-lg hover:bg-white/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Clapperboard className="w-4 h-4 text-purple-600" />
                </div>
                <div className="text-left">
                  <h3 className="hs-h3 !mb-0 text-foreground">導演 AI 偏好</h3>
                  <p className="hs-small !mb-0 text-muted-foreground">
                    AI 個性風格與偏好框架設定已整合至導演 AI 頁面
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </GlassCard>

          {/* Quick link: Credits */}
          <GlassCard>
            <button
              onClick={() => navigate("/credits")}
              className="w-full flex items-center justify-between p-1 rounded-lg hover:bg-white/30 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Coins className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-left">
                  <h3 className="hs-h3 !mb-0 text-foreground">積分與配額</h3>
                  <p className="hs-small !mb-0 text-muted-foreground">
                    查看各模型消耗規則與剩餘配額
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 2: Appearance ═══ */}
        <TabsContent value="appearance" className="mt-4 space-y-4">
          {/* ── Section 1: Appearance Mode ── */}
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-1 flex items-center gap-2">
              <Palette className="w-4 h-4" />
              外觀模式
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              選擇主題切換策略 — 目前：
              <span className="font-medium">
                {theme === "dark" ? "深色" : "亮色"}
              </span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {APPEARANCE_MODES.map(mode => {
                const Icon = mode.icon;
                const isActive = appearanceMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setAppearanceMode(mode.id);
                      toast.success(`外觀模式已切換為「${mode.label}」`);
                    }}
                    className={`
                      relative rounded-xl p-3 text-left transition-all border overflow-hidden group
                      ${
                        isActive
                          ? "ring-2 ring-primary/40 border-primary/30 shadow-sm"
                          : "border-border/40 hover:border-border/60 hover:shadow-sm"
                      }
                    `}
                  >
                    {/* Preview gradient background */}
                    <div
                      className="absolute inset-0 opacity-30 group-hover:opacity-40 transition-opacity rounded-xl"
                      style={{ background: mode.preview }}
                    />
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon
                          className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        />
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <p
                        className={`hs-small !mb-0 font-semibold ${isActive ? "text-primary" : "text-foreground"}`}
                      >
                        {mode.label}
                      </p>
                      <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                        {mode.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-1 flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              檢視模式（全站統一）
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              所有頁面的桌機/行動檢視設定統一在此管理
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "auto", label: "自動" },
                { id: "desktop", label: "桌機" },
                { id: "mobile", label: "行動" },
              ].map(opt => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={viewMode === opt.id ? "default" : "outline"}
                  className="rounded-lg"
                  onClick={() => {
                    setViewMode(opt.id as "auto" | "desktop" | "mobile");
                    toast.success(`檢視模式已切換為「${opt.label}」`);
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </GlassCard>

          {/* ── Section 2: Background Scene ── */}
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              背景場景
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              {sceneOverride ? (
                <>
                  已手動鎖定場景 ·{" "}
                  <button
                    onClick={() => {
                      setSceneOverride(null);
                      toast.success("已恢復自動場景");
                    }}
                    className="text-primary hover:underline"
                  >
                    恢復自動
                  </button>
                </>
              ) : (
                "依時間自動切換 · 也可手動鎖定"
              )}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SCENE_OPTIONS.map(scene => {
                const Icon = scene.icon;
                const isActive = sceneId === scene.id;
                const isOverridden = sceneOverride === scene.id;
                return (
                  <button
                    key={scene.id}
                    onClick={() => {
                      setSceneOverride(scene.id);
                      toast.success(`場景已切換為「${scene.label}」`);
                    }}
                    className={`
                      relative rounded-xl overflow-hidden transition-all border group
                      ${
                        isActive
                          ? "ring-2 ring-primary/40 border-primary/30 shadow-sm"
                          : "border-border/40 hover:border-border/60 hover:shadow-sm"
                      }
                    `}
                  >
                    {/* Scene preview gradient */}
                    <div
                      className="h-16 w-full transition-transform group-hover:scale-105"
                      style={{ background: scene.preview }}
                    />
                    <div className="p-2.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon
                          className={`w-3 h-3 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <span
                          className={`hs-small !mb-0 font-semibold ${isActive ? "text-primary" : "text-foreground"}`}
                        >
                          {scene.label}
                        </span>
                        {isOverridden && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        )}
                      </div>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        {scene.description}
                      </p>
                      <p className="text-[8px] text-muted-foreground/60 mt-1">
                        🕐 {scene.timeRange}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {/* ── Section 3: Third-party Wallpaper Resources ── */}
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-1 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              靈感資源
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              探索更多視覺靈感與背景素材
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WALLPAPER_RESOURCES.map(res => (
                <button
                  key={res.name}
                  type="button"
                  onClick={() => handleOpenExternalResource(res.url, res.name)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border/30 hover:border-border/60 hover:bg-white/30 dark:hover:bg-white/5 transition-all group"
                >
                  <span className="text-xl shrink-0">{res.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="hs-small !mb-0 text-foreground group-hover:text-primary transition-colors font-semibold">
                      {res.name}
                    </p>
                    <p className="hs-small !mb-0 text-muted-foreground">
                      {res.description}
                    </p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 3: Notifications ═══ */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-4 flex items-center gap-2">
              <Bell className="w-4 h-4" />
              通知偏好
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    音效提示
                  </p>
                  <p className="hs-small !mb-0 text-muted-foreground">
                    生成完成時播放提示音
                  </p>
                </div>
                <Switch
                  checked={settings.soundEnabled}
                  onCheckedChange={handleToggleSound}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    桌面通知
                  </p>
                  <p className="hs-small !mb-0 text-muted-foreground">
                    背景任務完成時發送系統通知
                  </p>
                </div>
                <Switch
                  checked={settings.desktopNotif}
                  onCheckedChange={handleToggleDesktopNotif}
                />
              </div>
              <p className="hs-small !mb-0 text-muted-foreground">
                通知權限狀態：
                <span className="font-medium ml-1">
                  {notifPermission === "granted"
                    ? "已允許"
                    : notifPermission === "denied"
                      ? "已封鎖"
                      : notifPermission === "default"
                        ? "尚未授權"
                        : "此裝置不支援"}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg w-fit"
                onClick={handleSendTestNotification}
                disabled={notifPermission !== "granted"}
              >
                <Link2 className="w-3.5 h-3.5 mr-1" />
                發送測試通知
              </Button>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 4: Onboarding ═══ */}
        <TabsContent value="onboarding" className="mt-4 space-y-4">
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-4 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              新手引導
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              如果想重溫全站引導教學，可以在這裡重置。
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={handleRestartOnboarding}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                重新觀看全站引導
              </Button>
              <ResetAllToursButton />
            </div>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 5: Admin (admin-only) ═══ */}
        {isAdmin && (
          <TabsContent value="admin" className="mt-4 space-y-4">
            <GlassCard>
              <h2 className="hs-h3 !mb-0 text-foreground mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                管理員工具
              </h2>
              <p className="hs-small !mb-0 text-muted-foreground mb-4">
                快速存取管理員專屬功能
              </p>
              <div className="space-y-2">
                {/* Admin Panel */}
                <button
                  onClick={() => navigate("/admin")}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/30 border border-transparent hover:border-border/30 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="text-left">
                      <h3 className="hs-h3 !mb-0 text-foreground">管理後台</h3>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        使用者管理、API 金鑰、成本金流、系統監控
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>

                {/* AI Brain */}
                <button
                  onClick={() => navigate("/settings/ai-brain")}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/30 border border-transparent hover:border-border/30 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Brain className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-left">
                      <h3 className="hs-h3 !mb-0 text-foreground">
                        AI 大腦組態
                      </h3>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        5 種推理大腦與 4 種生成引擎的模型選擇與參數配置
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>

                {/* Cost Dashboard */}
                <button
                  onClick={() => navigate("/admin")}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/30 border border-transparent hover:border-border/30 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="text-left">
                      <h3 className="hs-h3 !mb-0 text-foreground">
                        成本與用量
                      </h3>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        API 呼叫統計、費用趨勢、使用紀錄
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>

                {/* LangSmith / AI Monitoring */}
                <button
                  onClick={() => navigate("/langsmith")}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/30 border border-transparent hover:border-border/30 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Activity className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="text-left">
                      <h3 className="hs-h3 !mb-0 text-foreground">
                        AI 監控中心
                      </h3>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        LangSmith 追蹤、LLM 呼叫分析
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>
              </div>
            </GlassCard>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
