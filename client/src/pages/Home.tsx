import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion } from "framer-motion";
import { Wand2, Clapperboard, Package, Cpu, ArrowRight, Sparkles, Shield, Users } from "lucide-react";

const FEATURES = [
  {
    icon: Wand2,
    title: "AI 智慧創作引擎",
    description: "圖片、影片、音樂、語音一站式 AI 生成，搭配專業提示詞編譯器",
    color: "bg-zen-lavender/20",
  },
  {
    icon: Clapperboard,
    title: "導演 AI 雙引擎",
    description: "事實研究 + CO-STAR 創意編排，自動生成結構化多媒體腳本",
    color: "bg-zen-sky/20",
  },
  {
    icon: Cpu,
    title: "角色鍛造所",
    description: "多角度資料集訓練，確保跨場景角色一致性，支援 LoRA 權重控制",
    color: "bg-zen-blush/20",
  },
  {
    icon: Package,
    title: "數位資產庫",
    description: "團隊共享數位資產，標籤管理，分享獎勵配額機制",
    color: "bg-zen-sage/20",
  },
  {
    icon: Shield,
    title: "安全可靠",
    description: "RBAC 權限控制、內容安全預檢、S3 預簽名 URL 保護",
    color: "bg-zen-sand/20",
  },
  {
    icon: Users,
    title: "共享空間",
    description: "社群互動與種子庫，探索他人的創作靈感，分享你的作品獲得配額獎勵",
    color: "bg-zen-peach/20",
  },
];

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16"
        style={{
          background: "rgba(245, 243, 240, 0.8)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.4)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <VisualSoul size="sm" />
            <span className="font-semibold tracking-tight text-foreground">AI Director</span>
          </div>
          <div>
            {isAuthenticated ? (
              <Button
                onClick={() => navigate("/studio")}
                className="rounded-xl gap-1.5 text-sm"
              >
                進入工作室
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                onClick={() => { window.location.href = getLoginUrl(); }}
                className="rounded-xl text-sm"
              >
                登入
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 -z-10"
          style={{
            background: "linear-gradient(135deg, rgba(245,243,240,1) 0%, rgba(234,201,193,0.3) 30%, rgba(212,197,226,0.2) 60%, rgba(200,213,224,0.2) 100%)",
          }}
        />

        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex justify-center mb-8">
              <motion.div
                animate={{
                  scale: [1, 1.05, 1],
                  boxShadow: [
                    "0 0 30px rgba(212, 197, 226, 0.3)",
                    "0 0 60px rgba(212, 197, 226, 0.5)",
                    "0 0 30px rgba(212, 197, 226, 0.3)",
                  ],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-20 h-20 rounded-full"
                style={{
                  background: "radial-gradient(circle at 35% 35%, rgba(212, 197, 226, 0.8), rgba(200, 213, 224, 0.6), rgba(234, 201, 193, 0.4))",
                }}
              />
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
              AI Director
              <br />
              <span style={{ color: "#6C6C6C" }}>智慧創作平台</span>
            </h1>

            <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              AI Director 多模態智慧創作平台。圖片、影片、音樂、語音一站式創作，
              搭配導演 AI 雙引擎與角色鍛造系統，打造高品質數位內容。
            </p>

            <div className="mt-10 flex items-center justify-center gap-4">
              {isAuthenticated ? (
                <>
                  <Button
                    size="lg"
                    onClick={() => navigate("/studio")}
                    className="rounded-xl h-12 px-8 gap-2 text-sm shadow-lg hover:shadow-xl transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    開始創作
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate("/director")}
                    className="rounded-xl h-12 px-8 gap-2 text-sm"
                  >
                    <Clapperboard className="w-4 h-4" />
                    導演 AI
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                  className="rounded-xl h-12 px-10 gap-2 text-sm shadow-lg hover:shadow-xl transition-all"
                >
                  立即開始
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-14"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              專為創作者打造
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-lg mx-auto">
              從創意構思到成品輸出，完整覆蓋多媒體內容生產流程
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feature, idx) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
              >
                <GlassCard className="h-full">
                  <div className={`w-10 h-10 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                    <feature.icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <GlassCard hover={false} className="text-center py-14 px-8">
            <VisualSoul size="md" />
            <h2 className="text-2xl font-bold text-foreground mt-6">
              準備好開始創作了嗎？
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
              登入後即可使用所有功能，每位使用者享有初始免費配額
            </p>
            <div className="mt-8">
              {isAuthenticated ? (
                <Button
                  size="lg"
                  onClick={() => navigate("/studio")}
                  className="rounded-xl h-12 px-10 gap-2 text-sm"
                >
                  進入工作室
                  <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                  className="rounded-xl h-12 px-10 gap-2 text-sm"
                >
                  免費開始
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border/30">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <VisualSoul size="sm" />
            <span>AI Director</span>
          </div>
          <span>Intelligent Creation Platform</span>
        </div>
      </footer>
    </div>
  );
}
