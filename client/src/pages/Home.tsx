import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Wand2, Clapperboard, Package, Cpu, BarChart3, MessageSquare, ArrowRight, Sparkles } from "lucide-react";

const features = [
  {
    icon: <Wand2 className="w-6 h-6" />,
    title: "多模態創作",
    desc: "圖片、影片、音樂、語音一站式 AI 生成",
    color: "bg-morandi-blush/30",
  },
  {
    icon: <Clapperboard className="w-6 h-6" />,
    title: "導演 AI",
    desc: "CO-STAR 框架驅動的創意腳本生成",
    color: "bg-morandi-lavender/30",
  },
  {
    icon: <Package className="w-6 h-6" />,
    title: "數位資產庫",
    desc: "管理、分享你的創作成果",
    color: "bg-morandi-sage/30",
  },
  {
    icon: <Cpu className="w-6 h-6" />,
    title: "微調模型",
    desc: "訓練專屬的 AI 模型風格",
    color: "bg-morandi-sky/30",
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: "智慧儀表板",
    desc: "即時追蹤配額、成本與使用分析",
    color: "bg-morandi-peach/30",
  },
  {
    icon: <MessageSquare className="w-6 h-6" />,
    title: "回饋中心",
    desc: "提交建議，共同打造更好的工具",
    color: "bg-morandi-sand/30",
  },
];

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-morandi-cream via-morandi-blush/20 to-morandi-lavender/20" />
        <div className="relative container py-16 sm:py-24 lg:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm mb-6">
                <Sparkles className="w-4 h-4" />
                療癒系 AI 創作平台
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                療癒多模態
                <br />
                <span className="text-primary">工作室</span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
                結合莫蘭迪色系美學與 AI 技術，讓每一次創作都充滿溫度。
                圖片、影片、音樂、語音 — 一站式多模態生成。
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                {isAuthenticated ? (
                  <Button
                    size="lg"
                    className="rounded-[25px] h-12 px-8 text-base gap-2"
                    onClick={() => navigate("/studio")}
                  >
                    進入工作室
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="rounded-[25px] h-12 px-8 text-base gap-2"
                    onClick={() => { window.location.href = getLoginUrl(); }}
                  >
                    開始創作
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-[25px] h-12 px-8 text-base"
                  onClick={() => {
                    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  了解更多
                </Button>
              </div>
            </motion.div>
          </div>

          {/* Decorative Mascot */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-12 flex justify-center"
          >
            <svg viewBox="0 0 200 160" className="w-48 h-40 drop-shadow-xl">
              {/* Bear */}
              <circle cx="50" cy="45" r="10" fill="#D4C4A8" />
              <circle cx="80" cy="45" r="10" fill="#D4C4A8" />
              <circle cx="50" cy="45" r="6" fill="#EAC9C1" />
              <circle cx="80" cy="45" r="6" fill="#EAC9C1" />
              <circle cx="65" cy="70" r="25" fill="#D4C4A8" />
              <ellipse cx="65" cy="76" rx="14" ry="10" fill="#EAC9C1" opacity="0.6" />
              <circle cx="57" cy="66" r="3" fill="#6C6C6C" />
              <circle cx="73" cy="66" r="3" fill="#6C6C6C" />
              <circle cx="58.5" cy="64.5" r="1.2" fill="white" />
              <circle cx="74.5" cy="64.5" r="1.2" fill="white" />
              <ellipse cx="65" cy="74" rx="4" ry="2.5" fill="#C5A898" />
              <path d="M 60 78 Q 65 82 70 78" fill="none" stroke="#C5A898" strokeWidth="1.2" strokeLinecap="round" />
              {/* Bird */}
              <ellipse cx="140" cy="65" rx="15" ry="12" fill="#C8D5E0" />
              <circle cx="140" cy="52" r="10" fill="#C8D5E0" />
              <circle cx="136" cy="50" r="2" fill="#6C6C6C" />
              <circle cx="144" cy="50" r="2" fill="#6C6C6C" />
              <path d="M 138 55 L 140 58 L 142 55" fill="#D4A5A5" />
              <ellipse cx="128" cy="68" rx="7" ry="3.5" fill="#C8D5E0" transform="rotate(-15 128 68)" />
              <ellipse cx="152" cy="68" rx="7" ry="3.5" fill="#C8D5E0" transform="rotate(15 152 68)" />
              {/* Rabbit */}
              <ellipse cx="100" cy="110" rx="8" ry="22" fill="#EAC9C1" />
              <ellipse cx="120" cy="110" rx="8" ry="22" fill="#EAC9C1" />
              <ellipse cx="100" cy="110" rx="5" ry="17" fill="#F5DDD5" />
              <ellipse cx="120" cy="110" rx="5" ry="17" fill="#F5DDD5" />
              <circle cx="110" cy="135" r="18" fill="#F5EDE8" />
              <circle cx="104" cy="131" r="2.5" fill="#6C6C6C" />
              <circle cx="116" cy="131" r="2.5" fill="#6C6C6C" />
              <ellipse cx="110" cy="137" rx="3" ry="2" fill="#D4A5A5" />
              <circle cx="98" cy="138" r="4" fill="#EAC9C1" opacity="0.4" />
              <circle cx="122" cy="138" r="4" fill="#EAC9C1" opacity="0.4" />
            </svg>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 sm:py-24">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">核心功能</h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              六大系統模組，涵蓋從創意發想到成品管理的完整工作流
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="healing-card bg-card p-6 text-center"
              >
                <div className={`w-14 h-14 rounded-[20px] ${feature.color} flex items-center justify-center mx-auto mb-4`}>
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-gradient-to-r from-morandi-blush/20 via-morandi-lavender/20 to-morandi-sky/20">
        <div className="container text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
            準備好開始你的療癒創作了嗎？
          </h2>
          <p className="mt-3 text-muted-foreground">
            每位新使用者可獲得 50 次免費生成配額
          </p>
          <Button
            size="lg"
            className="mt-6 rounded-[25px] h-12 px-8 text-base gap-2"
            onClick={() => {
              if (isAuthenticated) navigate("/studio");
              else window.location.href = getLoginUrl();
            }}
          >
            立即開始
            <Sparkles className="w-4 h-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="container text-center text-sm text-muted-foreground">
          <p>療癒多模態工作室 - Healing Multimodal Studio</p>
          <p className="mt-1">以 AI 技術賦能創意，用莫蘭迪色系溫暖每一個靈感</p>
        </div>
      </footer>
    </div>
  );
}
