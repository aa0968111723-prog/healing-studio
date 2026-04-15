import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { ResetAllToursButton } from "@/components/SiteOnboardingOverlay";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Settings, User, RotateCcw, Brain, ChevronRight, Shield, Sun, Moon,
  Clapperboard, Eye, Bell, Palette, BarChart3, Coins, Activity,
  Monitor, Coffee, Waves, ExternalLink, Sparkles,
} from "lucide-react";
import { useTheme, type AppearanceMode } from "@/contexts/ThemeContext";
import { useCurrentScene } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import { useLocation } from "wouter";

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
  const { theme, appearanceMode, setAppearanceMode } = useTheme();
  const { sceneId, override: sceneOverride, setOverride: setSceneOverride } = useCurrentScene();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("profile");

  // ─── Notification preference (localStorage) ───────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem("settings-sound") !== "false"; } catch { return true; }
  });
  const [desktopNotif, setDesktopNotif] = useState(() => {
    try { return localStorage.getItem("settings-desktop-notif") === "true"; } catch { return false; }
  });

  useEffect(() => {
    localStorage.setItem("settings-sound", String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem("settings-desktop-notif", String(desktopNotif));
    if (desktopNotif && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [desktopNotif]);

  const handleRestartOnboarding = () => {
    localStorage.removeItem("ai-director-onboarded");
    localStorage.removeItem("hasSeenTour");
    localStorage.removeItem("onboarded");
    window.dispatchEvent(new CustomEvent("site-tour-start", { detail: { pageId: "welcome" } }));
    toast.success("已重置引導狀態，全站引導即將開始...");
  };

  const isAdmin = user?.role === "admin";

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
        <TabsList className="rounded-xl bg-muted/40 p-1 flex-nowrap overflow-x-auto h-auto gap-1 w-full justify-start">
          <TabsTrigger value="profile" className="rounded-lg gap-1 text-xs shrink-0">
            <User className="w-3 h-3" /> 個人資料
          </TabsTrigger>
          <TabsTrigger value="appearance" className="rounded-lg gap-1 text-xs shrink-0">
            <Palette className="w-3 h-3" /> 外觀
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-lg gap-1 text-xs shrink-0">
            <Bell className="w-3 h-3" /> 通知
          </TabsTrigger>
          <TabsTrigger value="onboarding" className="rounded-lg gap-1 text-xs shrink-0">
            <Eye className="w-3 h-3" /> 引導
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="rounded-lg gap-1 text-xs shrink-0">
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
                <p className="text-sm font-medium text-foreground mt-1">{user?.name || "未設定"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">電子郵件</Label>
                <p className="text-sm font-medium text-foreground mt-1">{user?.email || "未設定"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">角色</Label>
                <p className="text-sm font-medium text-foreground mt-1">
                  {isAdmin ? "管理員" : "使用者"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">剩餘配額</Label>
                <p className="text-sm font-medium text-foreground mt-1 tabular-nums">
                  {user?.remainingGenerations ?? 0} 次
                </p>
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
              選擇主題切換策略 — 目前：<span className="font-medium">{theme === "dark" ? "深色" : "亮色"}</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {APPEARANCE_MODES.map((mode) => {
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
                      ${isActive
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
                        <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <p className={`hs-small !mb-0 font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>
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

          {/* ── Section 2: Background Scene ── */}
          <GlassCard>
            <h2 className="hs-h3 !mb-0 text-foreground mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              背景場景
            </h2>
            <p className="hs-small !mb-0 text-muted-foreground mb-4">
              {sceneOverride
                ? <>已手動鎖定場景 · <button onClick={() => { setSceneOverride(null); toast.success("已恢復自動場景"); }} className="text-primary hover:underline">恢復自動</button></>
                : "依時間自動切換 · 也可手動鎖定"
              }
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SCENE_OPTIONS.map((scene) => {
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
                      ${isActive
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
                        <Icon className={`w-3 h-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                        <span className={`hs-small !mb-0 font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>
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
              {WALLPAPER_RESOURCES.map((res) => (
                <a
                  key={res.name}
                  href={res.url}
                  target="_blank"
                  rel="noopener noreferrer"
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
                </a>
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
                  <p className="text-sm font-medium text-foreground">音效提示</p>
                  <p className="hs-small !mb-0 text-muted-foreground">生成完成時播放提示音</p>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">桌面通知</p>
                  <p className="hs-small !mb-0 text-muted-foreground">背景任務完成時發送系統通知</p>
                </div>
                <Switch checked={desktopNotif} onCheckedChange={setDesktopNotif} />
              </div>
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
                      <h3 className="hs-h3 !mb-0 text-foreground">AI 大腦組態</h3>
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
                      <h3 className="hs-h3 !mb-0 text-foreground">成本與用量</h3>
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
                      <h3 className="hs-h3 !mb-0 text-foreground">AI 監控中心</h3>
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
