import { motion } from "framer-motion";
import { ArrowRight, Check, Play } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getLoginUrl } from "@/const";

export interface FeatureDetail {
  id: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  description: string;
  longDescription: string;
  features: string[];
  tag: string;
  color: string;
  borderColor: string;
  accentColor: string;
  /** Optional HLS / MP4 URL. If absent, a placeholder preview renders. */
  videoUrl?: string;
  /** Optional deep-link target inside the Studio. Defaults to "/studio". */
  ctaHref?: string;
}

interface Props {
  feature: FeatureDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAuthenticated: boolean;
  isDark: boolean;
}

export default function FeatureDetailDialog({
  feature,
  open,
  onOpenChange,
  isAuthenticated,
  isDark,
}: Props) {
  const [, navigate] = useLocation();

  if (!feature) return null;

  const handleTry = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    navigate(feature.ctaHref ?? "/studio");
    onOpenChange(false);
  };

  const Icon = feature.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={`sm:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto p-0 border-0 rounded-3xl ${
          isDark
            ? "bg-slate-900/90 text-slate-100"
            : "bg-white/95 text-stone-900"
        }`}
        style={{
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: `0 24px 80px -20px ${feature.accentColor}40, 0 0 0 1px ${feature.accentColor}25`,
        }}
      >
        {/* Video / preview area */}
        <div
          className="relative aspect-[16/9] w-full overflow-hidden rounded-t-3xl"
          style={{ background: feature.color }}
        >
          {feature.videoUrl ? (
            <video
              src={feature.videoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <>
              <motion.div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${feature.accentColor}22 0%, transparent 55%), radial-gradient(circle at 70% 70%, ${feature.accentColor}12 0%, transparent 55%)`,
                }}
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{
                    background: `${feature.accentColor}18`,
                    border: `1px solid ${feature.accentColor}25`,
                    backdropFilter: "blur(16px)",
                  }}
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Icon
                    className="w-10 h-10"
                    style={{ color: feature.accentColor }}
                  />
                </motion.div>
              </div>
              <div
                className={`absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[10px] tracking-wide ${
                  isDark ? "bg-white/10 text-white/70" : "bg-black/30 text-white/80"
                }`}
                style={{ backdropFilter: "blur(8px)" }}
              >
                示意畫面 · Demo coming soon
              </div>
            </>
          )}
          <div
            className="absolute top-4 left-4 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wider uppercase"
            style={{
              background: `${feature.accentColor}18`,
              color: feature.accentColor,
              border: `1px solid ${feature.accentColor}30`,
              backdropFilter: "blur(12px)",
            }}
          >
            {feature.tag}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 sm:px-8 py-7 sm:py-8 space-y-6">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-1 h-5 rounded-full"
                style={{ background: feature.accentColor }}
              />
              <DialogTitle className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {feature.title}
              </DialogTitle>
            </div>
            <DialogDescription
              className={`text-[15px] leading-relaxed ${
                isDark ? "text-slate-300" : "text-stone-600"
              }`}
            >
              {feature.longDescription}
            </DialogDescription>
          </div>

          {feature.features.length > 0 && (
            <div>
              <div
                className={`text-[11px] tracking-[0.18em] uppercase mb-3 ${
                  isDark ? "text-white/40" : "text-black/40"
                }`}
              >
                核心能力
              </div>
              <ul className="grid sm:grid-cols-2 gap-2.5">
                {feature.features.map(item => (
                  <li
                    key={item}
                    className={`flex items-start gap-2.5 text-sm leading-relaxed ${
                      isDark ? "text-slate-200" : "text-stone-700"
                    }`}
                  >
                    <span
                      className="mt-[3px] flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: `${feature.accentColor}20` }}
                    >
                      <Check
                        className="w-2.5 h-2.5"
                        style={{ color: feature.accentColor }}
                      />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <div
            className={`flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t ${
              isDark ? "border-white/10" : "border-black/8"
            }`}
          >
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={`text-sm transition-colors ${
                isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              稍後再看
            </button>
            <Button
              onClick={handleTry}
              className="rounded-2xl h-11 px-6 gap-2 text-white font-medium shadow-lg hover:shadow-xl transition-all"
              style={{
                background: `linear-gradient(135deg, ${feature.accentColor}, ${feature.accentColor}d0)`,
                boxShadow: `0 8px 24px -8px ${feature.accentColor}80`,
              }}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>立即試用{feature.title.replace(/^AI\s*/, "")}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
