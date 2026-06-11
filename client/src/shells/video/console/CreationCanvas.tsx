// ============================================================================
// shells/video/console/CreationCanvas.tsx — 中欄：創作畫布（模式路由）
// ----------------------------------------------------------------------------
// 一體成形主軸：頂部創作流程列／Story Spine／光球都透過 canvasMode 驅動此處的工作面，
//   平順過渡、不整頁離場。模式：導演對話 / 腳本(2-1) / 分鏡(2-3) / 素材(2-3) / 配音環境(2-5) / 配樂(2-6)。
// ============================================================================
import { MessageSquare, FileText, Film, ImagePlus, Mic, Music } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDirectorConsole, type CanvasMode } from "../DirectorConsoleProvider";
import { DirectorChatCanvas } from "../canvas/DirectorChatCanvas";
import { ScriptCanvas } from "../canvas/ScriptCanvas";
import { ShotDetailCanvas } from "../canvas/ShotDetailCanvas";
import { AssetGenCanvas } from "../canvas/AssetGenCanvas";
import { VoiceAmbientCanvas } from "../canvas/VoiceAmbientCanvas";
import { MusicCanvas } from "../canvas/MusicCanvas";

const MODES: { id: CanvasMode; label: string; icon: typeof Film }[] = [
  { id: "chat", label: "導演對話", icon: MessageSquare },
  { id: "script", label: "腳本", icon: FileText },
  { id: "shot", label: "分鏡", icon: Film },
  { id: "asset", label: "素材", icon: ImagePlus },
  { id: "voice", label: "配音環境", icon: Mic },
  { id: "music", label: "配樂", icon: Music },
];

export function CreationCanvas({ onGuided }: { onGuided: () => void }) {
  const console_ = useDirectorConsole();
  const mode = console_.canvasMode;

  return (
    <Card className="glass-card-static flex min-h-[560px] flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        {/* 模式切換條 */}
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => console_.setCanvasMode(m.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-healing",
                  active ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="size-3.5" /> {m.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1">
          {mode === "chat" && <DirectorChatCanvas />}
          {mode === "script" && <ScriptCanvas onGuided={onGuided} />}
          {mode === "shot" && <ShotDetailCanvas />}
          {mode === "asset" && <AssetGenCanvas />}
          {mode === "voice" && <VoiceAmbientCanvas />}
          {mode === "music" && <MusicCanvas />}
        </div>
      </CardContent>
    </Card>
  );
}

export default CreationCanvas;
