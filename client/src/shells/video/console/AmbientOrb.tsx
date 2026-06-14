// ============================================================================
// shells/video/console/AmbientOrb.tsx — 光球 Ambient Copilot（四態，移除人格預設）
// ----------------------------------------------------------------------------
// 四態（由 DirectorConsoleProvider 依資料計算）：
//   silent  靜默 — 只有呼吸浮球。
//   hint    提示 — 暖色主動泡泡（就緒鏡 / 過期待重生）。
//   collab  協作 — 面板開啟（快速動作：提示詞庫 / 遊樂場 / 重建 packet / 就緒鏡 / 設定）。
//   critical 關鍵 — 紅環主動泡泡（確認門擋下 / 生成失敗），CTA deep-link 到修復點。
// 沿用真實 `.orb-breathe` 動畫；尊重 prefers-reduced-motion（index.css 已關閉動畫）。
// ============================================================================
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole, type OrbLevel } from "../DirectorConsoleProvider";

/** 玻璃光球 SVG（移植自原型 orb()；星環自轉 + 暖金面孔）。 */
function OrbGlyph({ size = 46 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="orb-breathe">
      <defs>
        <radialGradient id="dc-og" cx="38%" cy="32%">
          <stop offset="0" stopColor="#DFF7F1" />
          <stop offset="42%" stopColor="#7FD9CF" />
          <stop offset="75%" stopColor="#2C7E77" />
          <stop offset="100%" stopColor="#1c4a52" />
        </radialGradient>
        <linearGradient id="dc-fg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="100%" stopColor="#C8922F" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="#3E9D94" opacity=".12" />
      <circle cx="50" cy="50" r="34" fill="url(#dc-og)" />
      <ellipse cx="42" cy="40" rx="11" ry="7" fill="#fff" opacity=".35" />
      <g fill="url(#dc-fg)">
        <circle cx="50" cy="44" r="6" />
        <path d="M38 66c0-9 5.6-15 12-15s12 6 12 15c0 2-24 2-24 0z" />
      </g>
      <g fill="none" stroke="#E0AC4A" strokeWidth="2.4" opacity=".9">
        <ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(-18 50 50)" />
      </g>
    </svg>
  );
}

const RING: Record<OrbLevel, string> = {
  silent: "ring-1 ring-border",
  hint: "ring-2 ring-amber-400/60",
  collab: "ring-2 ring-primary/50",
  critical: "ring-2 ring-destructive/70 animate-pulse",
};

export function AmbientOrb() {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const { orb } = console_;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2.5">
      {/* 主動泡泡（hint / critical） */}
      {orb.bubble && !console_.orbOpen && (
        <div className="pointer-events-auto w-64 rounded-xl border bg-popover p-3 shadow-healing-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{orb.bubble.emoji} {orb.bubble.title}</span>
            <button type="button" onClick={console_.dismissBubble} className="text-muted-foreground hover:text-foreground" aria-label="關閉">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{orb.bubble.text}</p>
          {orb.bubble.cta && (
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  orb.bubble?.onCta?.();
                  console_.dismissBubble();
                }}
              >
                {orb.bubble.cta}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={console_.dismissBubble}>
                稍後
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 協作面板（collab） */}
      {console_.orbOpen && (
        <div className="pointer-events-auto w-72 overflow-hidden rounded-2xl border bg-popover shadow-healing-lg">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <OrbGlyph size={24} />
            <span className="flex-1 text-sm font-semibold">光球 · Ambient Copilot</span>
            <button type="button" onClick={() => console_.setOrbOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="收起">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-1 p-2">
            <OrbAction label="提示詞庫 · Flow 電視牆" hint="存庫 / 再生成 / 複製編輯" onClick={() => console_.openDrawer("flowtv")} />
            <OrbAction label="單模型遊樂場" hint="挑模型 · 自由試生成" onClick={() => console_.openDrawer("playground")} />
            <OrbAction label="真實地球研究" hint="查真實歷史/地理 · 為這段接地" onClick={() => console_.openDrawer("research")} />
            <OrbAction label="提示詞跨庫組合" hint="庫＋收藏挑多個 · 合成組合提示詞" onClick={() => console_.openDrawer("prompts")} />
            <OrbAction label="精靈能力 · 成本預估" hint="看精靈可用模型＋預估成本 · 不觸發生成" onClick={() => console_.openDrawer("agents")} />
            <OrbAction label="看就緒鏡" hint="走確認門 · 先估成本" onClick={() => { console_.setCanvasMode("shot"); console_.setOrbOpen(false); }} />
            <OrbAction label="重建 Context Packet" hint="Deterministic→Cache→RAG" onClick={() => void spine.rebuildPacket()} />
            <OrbAction label="影片系統設定" hint="生成引擎 / 顯隱 / 自動存草稿" onClick={() => console_.openDrawer("settings")} />
          </div>
          <p className="border-t px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
            光球只協助，不替你決策；媒體生成前一律先估成本、失敗全額退還。
          </p>
        </div>
      )}

      {/* 浮球 FAB */}
      <button
        type="button"
        onClick={() => console_.setOrbOpen(!console_.orbOpen)}
        className={cn(
          "pointer-events-auto grid size-14 place-items-center rounded-full bg-popover shadow-healing-lg transition-healing hover:-translate-y-0.5",
          RING[orb.level],
        )}
        aria-label="光球助手"
        title={`光球 · ${orb.level}`}
      >
        <OrbGlyph size={42} />
      </button>
    </div>
  );
}

function OrbAction({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-healing hover:bg-muted/60"
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}

export default AmbientOrb;
