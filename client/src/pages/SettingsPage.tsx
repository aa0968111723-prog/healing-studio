import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Settings, User, Sparkles, Image, Video, Music, Mic,
  Save, RefreshCw
} from "lucide-react";
import { motion } from "framer-motion";

export default function SettingsPage() {
  const { user } = useAuth();

  // Director preferences
  const prefsQuery = trpc.directorPreferences.get.useQuery(undefined, { retry: false });
  const updatePrefs = trpc.directorPreferences.update.useMutation({
    onSuccess: () => {
      toast.success("偏好設定已儲存");
      prefsQuery.refetch();
    },
    onError: (err) => toast.error("儲存失敗：" + err.message),
  });

  // Subscription plans
  const plansQuery = trpc.plans.list.useQuery(undefined, { retry: false });

  const [personality, setPersonality] = useState<"calm" | "creative" | "technical">("creative");
  const [preferredFormat, setPreferredFormat] = useState<"co-star" | "sslcm" | "selcm" | "free">("co-star");

  useEffect(() => {
    if (prefsQuery.data) {
      setPersonality(prefsQuery.data.personality as any || "creative");
      setPreferredFormat(prefsQuery.data.preferredFormat as any || "co-star");
    }
  }, [prefsQuery.data]);

  const handleSavePrefs = () => {
    updatePrefs.mutate({ personality, preferredFormat });
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
          管理你的帳號偏好與 AI 導演設定
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
                    className={`p-3 rounded-xl text-left transition-all ${
                      personality === opt.value
                        ? "bg-primary/10 border-primary/30 shadow-sm"
                        : "bg-white/30 border-white/50 hover:bg-white/50"
                    }`}
                    style={{ border: "1px solid" }}
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
                    className={`p-2.5 rounded-lg text-center text-xs font-medium transition-all ${
                      preferredFormat === opt.value
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-white/30 text-muted-foreground border-white/50 hover:bg-white/50"
                    }`}
                    style={{ border: "1px solid" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSavePrefs}
              disabled={updatePrefs.isPending}
              size="sm"
              className="rounded-lg"
            >
              <Save className="w-3 h-3 mr-1" />
              儲存偏好
            </Button>
          </div>
        )}
      </GlassCard>

      {/* Subscription Plans */}
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          訂閱方案
        </h2>

        {plansQuery.isLoading ? (
          <ZenSkeleton lines={3} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(plansQuery.data || []).map((plan) => {
              const quota = plan.quotaAllocation as { image: number; video: number; audio: number; voice: number } | null;
              return (
                <motion.div
                  key={plan.id}
                  whileHover={{ scale: 1.02 }}
                  className="p-4 rounded-xl transition-all"
                  style={{
                    background: "rgba(255,255,255,0.4)",
                    border: "1px solid rgba(255,255,255,0.6)",
                  }}
                >
                  <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                  <p className="text-lg font-bold text-foreground mt-1 tabular-nums">
                    {plan.priceMonthly === 0 ? "免費" : `$${plan.priceMonthly}/月`}
                  </p>
                  {quota && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Image className="w-3 h-3" /> 圖片 {quota.image} 次
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Video className="w-3 h-3" /> 影片 {quota.video} 次
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Music className="w-3 h-3" /> 音樂 {quota.audio} 次
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Mic className="w-3 h-3" /> 語音 {quota.voice} 次
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 text-xs rounded-lg"
                    onClick={() => toast.info("訂閱功能即將推出")}
                  >
                    {plan.priceMonthly === 0 ? "目前方案" : "升級"}
                  </Button>
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
