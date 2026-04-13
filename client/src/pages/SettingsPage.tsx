import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { ResetAllToursButton } from "@/components/SiteOnboardingOverlay";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings, User, Sparkles, Save, RotateCcw, Brain, ChevronRight } from "lucide-react";
import { useAIState } from "@/contexts/AIStateContext";
import { useLocation } from "wouter";

export default function SettingsPage() {
  const { user } = useAuth();

  // 全站新手引導
  usePageTour("settings");
  const { setPersonality: setGlobalPersonality } = useAIState();
  const [, navigate] = useLocation();

  // Director preferences
  const prefsQuery = trpc.directorPreferences.get.useQuery(undefined, { retry: false });
  const updatePrefs = trpc.directorPreferences.update.useMutation({
    onSuccess: () => {
      toast.success("偏好設定已儲存");
      prefsQuery.refetch();
    },
    onError: (err) => toast.error("儲存失敗：" + err.message),
  });

  const [personality, setPersonality] = useState<"calm" | "creative" | "technical">("creative");
  const [preferredFormat, setPreferredFormat] = useState<"co-star" | "sslcm" | "selcm" | "free">("co-star");

  useEffect(() => {
    if (prefsQuery.data) {
      const dbPersonality = (prefsQuery.data.personality as any) || "creative";
      setPersonality(dbPersonality);
      setPreferredFormat(prefsQuery.data.preferredFormat as any || "co-star");
      // Sync DB value → global context (single source of truth)
      setGlobalPersonality(dbPersonality);
    }
  }, [prefsQuery.data, setGlobalPersonality]);

  const handleSavePrefs = () => {
    updatePrefs.mutate({ personality, preferredFormat });
    // Immediately propagate to global context (localStorage + in-memory)
    setGlobalPersonality(personality);
  };

  const handleRestartOnboarding = () => {
    // 重置舊式引導標記
    localStorage.removeItem("ai-director-onboarded");
    localStorage.removeItem("hasSeenTour");
    localStorage.removeItem("onboarded");
    // 觸發全站 Welcome Tour
    window.dispatchEvent(new CustomEvent("site-tour-start", { detail: { pageId: "welcome" } }));
    toast.success("已重置引導狀態，全站引導即將開始...");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6" />
          個人設定
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理你的帳號資訊與 AI 導演偏好
        </p>
      </div>

      {/* Profile Info */}
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
              {user?.role === "admin" ? "管理員" : "使用者"}
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

      {/* Director AI Preferences */}
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          導演 AI 偏好
        </h2>

        {prefsQuery.isLoading ? (
          <ZenSkeleton lines={3} />
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">AI 個性風格</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "calm", label: "沉穩", desc: "精準、有條理的建議" },
                  { value: "creative", label: "創意", desc: "大膽、富有想像力" },
                  { value: "technical", label: "技術", desc: "專注細節與參數" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPersonality(opt.value)}
                    className={`p-3 rounded-xl text-left transition-all border ${
                      personality === opt.value
                        ? "bg-primary/10 border-primary/30 shadow-sm"
                        : "bg-white/30 border-white/50 hover:bg-white/50"
                    }`}
                  >
                    <p className="text-xs font-medium text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">偏好框架</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { value: "co-star", label: "CO-STAR" },
                  { value: "sslcm", label: "SSLCM" },
                  { value: "selcm", label: "SELCM" },
                  { value: "free", label: "自由格式" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPreferredFormat(opt.value)}
                    className={`p-2.5 rounded-lg text-center text-xs font-medium transition-all border ${
                      preferredFormat === opt.value
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-white/30 text-muted-foreground border-white/50 hover:bg-white/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleSavePrefs}
                disabled={updatePrefs.isPending}
                size="sm"
                className="rounded-lg"
              >
                <Save className="w-3 h-3 mr-1" />
                儲存偏好
              </Button>
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
          </div>
        )}
      </GlassCard>
      {/* AI Brain Configuration Link */}
      <GlassCard>
        <button
          onClick={() => navigate("/settings/ai-brain")}
          className="w-full flex items-center justify-between p-1 rounded-lg hover:bg-white/30 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold text-foreground">AI 大腦組態</h3>
              <p className="text-[10px] text-muted-foreground">
                管理 5 種推理大腦與 4 種生成引擎的模型選擇與參數配置
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </GlassCard>
    </div>
  );
}
