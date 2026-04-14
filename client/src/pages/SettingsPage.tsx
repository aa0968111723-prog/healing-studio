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
} from "lucide-react";
import { useAIState } from "@/contexts/AIStateContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "wouter";

export default function SettingsPage() {
  const { user } = useAuth();
  usePageTour("settings");
  const { personality } = useAIState();
  const { theme, toggleTheme, switchable } = useTheme();
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
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6" />
          個人設定
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
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
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
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
                  <h3 className="text-sm font-semibold text-foreground">導演 AI 偏好</h3>
                  <p className="text-[10px] text-muted-foreground">
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
                  <h3 className="text-sm font-semibold text-foreground">積分與配額</h3>
                  <p className="text-[10px] text-muted-foreground">
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
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Palette className="w-4 h-4" />
              外觀設定
            </h2>
            <div className="space-y-4">
              {/* Theme toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {theme === "dark" ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                  <div>
                    <p className="text-sm font-medium text-foreground">深色模式</p>
                    <p className="text-[10px] text-muted-foreground">
                      {switchable ? "切換亮色與深色主題" : "目前主題由系統控制"}
                    </p>
                  </div>
                </div>
                {switchable && toggleTheme ? (
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={toggleTheme}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/40">
                    {theme === "dark" ? "深色" : "亮色"}
                  </span>
                )}
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 3: Notifications ═══ */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Bell className="w-4 h-4" />
              通知偏好
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">音效提示</p>
                  <p className="text-[10px] text-muted-foreground">生成完成時播放提示音</p>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">桌面通知</p>
                  <p className="text-[10px] text-muted-foreground">背景任務完成時發送系統通知</p>
                </div>
                <Switch checked={desktopNotif} onCheckedChange={setDesktopNotif} />
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* ═══ Tab 4: Onboarding ═══ */}
        <TabsContent value="onboarding" className="mt-4 space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              新手引導
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
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
              <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                管理員工具
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
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
                      <h3 className="text-sm font-semibold text-foreground">管理後台</h3>
                      <p className="text-[10px] text-muted-foreground">
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
                      <h3 className="text-sm font-semibold text-foreground">AI 大腦組態</h3>
                      <p className="text-[10px] text-muted-foreground">
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
                      <h3 className="text-sm font-semibold text-foreground">成本與用量</h3>
                      <p className="text-[10px] text-muted-foreground">
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
                      <h3 className="text-sm font-semibold text-foreground">AI 監控中心</h3>
                      <p className="text-[10px] text-muted-foreground">
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
