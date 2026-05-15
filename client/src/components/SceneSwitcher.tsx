/**
 * SceneSwitcher — 背景場景切換器
 *
 * 顯示一個小型切換按鈕，點擊後展開場景選擇面板。
 * 支援 4 種場景 + 「自動」模式（依時間切換）。
 * 選擇結果持久化到 localStorage。
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Palette, Moon, Sun, Coffee, Waves, RotateCcw } from "lucide-react";
import type { SceneId } from "@/components/AmbientEnvironment";

const SCENE_META: Record<
  SceneId,
  {
    icon: typeof Moon;
    label: string;
    description: string;
    preview: string; // gradient preview colors
  }
> = {
  nightSky: {
    icon: Moon,
    label: "夜空",
    description: "深藍星空 · 流星閃爍",
    preview: "linear-gradient(135deg, #0a0c23 0%, #191245 50%, #0a0820 100%)",
  },
  morning: {
    icon: Sun,
    label: "晨光",
    description: "暖橙日出 · 光塵飄浮",
    preview: "linear-gradient(135deg, #ffebd2 0%, #ffd4a0 50%, #ffe8c0 100%)",
  },
  cafe: {
    icon: Coffee,
    label: "咖啡廳",
    description: "暖棕午後 · 散景光點",
    preview: "linear-gradient(135deg, #ebdcc8 0%, #d4c0a8 50%, #f5ebe0 100%)",
  },
  deepSea: {
    icon: Waves,
    label: "深海",
    description: "深青海洋 · 氣泡光影",
    preview: "linear-gradient(135deg, #051932 0%, #0a2846 50%, #051932 100%)",
  },
};

interface SceneSwitcherProps {
  currentScene: SceneId;
  override: SceneId | null;
  allScenes: { id: SceneId; label: string }[];
  onSelect: (scene: SceneId | null) => void;
  isDark: boolean;
}

export default function SceneSwitcher({
  currentScene,
  override,
  allScenes,
  onSelect,
  isDark,
}: SceneSwitcherProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const CurrentIcon = SCENE_META[currentScene]?.icon || Palette;

  return (
    <div className="relative" ref={panelRef}>
      {/* Toggle Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium
          backdrop-blur-md transition-healing hover:scale-105
          ${
            isDark
              ? "bg-white/10 hover:bg-white/15 text-white/80"
              : "bg-black/5 hover:bg-black/10 text-black/60"
          }
          ${override ? "ring-1 ring-amber-400/50" : ""}
        `}
        title="切換背景場景"
      >
        <CurrentIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">
          {SCENE_META[currentScene]?.label}
        </span>
        {override && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`
              absolute right-0 top-full mt-2 w-64 rounded-2xl p-3 z-50
              backdrop-blur-xl shadow-2xl border
              ${
                isDark
                  ? "bg-muted/90 border-white/10"
                  : "bg-white/90 border-black/10"
              }
            `}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5 px-1">
              <span
                className={`text-[11px] font-semibold tracking-wide uppercase ${
                  isDark ? "text-white/50" : "text-black/40"
                }`}
              >
                背景場景
              </span>
              {override && (
                <button
                  onClick={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                    isDark
                      ? "text-amber-300/80 hover:bg-amber-400/10"
                      : "text-amber-600/80 hover:bg-amber-100"
                  }`}
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  自動模式
                </button>
              )}
            </div>

            {/* Scene Options */}
            <div className="space-y-1">
              {(Object.keys(SCENE_META) as SceneId[]).map(id => {
                const meta = SCENE_META[id];
                const Icon = meta.icon;
                const isActive = currentScene === id;
                const isOverridden = override === id;

                return (
                  <button
                    key={id}
                    onClick={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                    className={`
                      w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-healing
                      ${
                        isActive
                          ? isDark
                            ? "bg-white/10 ring-1 ring-white/20"
                            : "bg-black/5 ring-1 ring-black/10"
                          : isDark
                            ? "hover:bg-white/5"
                            : "hover:bg-black/3"
                      }
                    `}
                  >
                    {/* Preview circle */}
                    <div
                      className={`w-8 h-8 rounded-lg shrink-0 shadow-inner ring-1 ring-inset ${
                        isDark ? "ring-white/10" : "ring-black/8"
                      }`}
                      style={{ background: meta.preview }}
                    />

                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon
                          className={`w-3 h-3 shrink-0 ${
                            isDark ? "text-white/60" : "text-black/50"
                          }`}
                        />
                        <span
                          className={`text-xs font-medium ${
                            isDark ? "text-white/90" : "text-black/80"
                          }`}
                        >
                          {meta.label}
                        </span>
                        {isOverridden && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        )}
                      </div>
                      <p
                        className={`text-[10px] mt-0.5 ${
                          isDark ? "text-white/40" : "text-black/35"
                        }`}
                      >
                        {meta.description}
                      </p>
                    </div>

                    {isActive && (
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isDark ? "bg-white/60" : "bg-black/40"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <div
              className={`mt-2.5 pt-2 border-t text-center ${
                isDark ? "border-white/5" : "border-black/5"
              }`}
            >
              <p
                className={`text-[9px] ${isDark ? "text-white/25" : "text-black/20"}`}
              >
                {override
                  ? "已手動選擇 · 點擊「自動模式」恢復依時間切換"
                  : "目前依時間自動切換場景"}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
