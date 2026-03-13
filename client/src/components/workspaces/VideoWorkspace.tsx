import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { VaultDropzone } from "@/components/ConsistencyVault";
import { ZenTooltip } from "@/components/ZenCoPilot";
import { MoveHorizontal, ZoomIn, RotateCw, ArrowRight } from "lucide-react";

export type CameraMotion = {
  pan: number;       // -100 to 100 (left to right)
  zoom: number;      // -100 to 100 (out to in)
  tilt: number;      // -100 to 100 (down to up)
};

export type VideoWorkspaceState = {
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  duration: string;
  cameraMotion: CameraMotion;
  characterRefUrl: string | null;
};

type VideoWorkspaceProps = {
  value: VideoWorkspaceState;
  onChange: (state: VideoWorkspaceState) => void;
};

export function createDefaultVideoState(): VideoWorkspaceState {
  return {
    firstFrameUrl: null,
    lastFrameUrl: null,
    duration: "8",
    cameraMotion: { pan: 0, zoom: 0, tilt: 0 },
    characterRefUrl: null,
  };
}

const CAMERA_CONTROLS = [
  { key: "pan" as const, label: "平移 (Pan)", icon: MoveHorizontal, leftLabel: "左", rightLabel: "右" },
  { key: "zoom" as const, label: "縮放 (Zoom)", icon: ZoomIn, leftLabel: "推遠", rightLabel: "拉近" },
  { key: "tilt" as const, label: "傾斜 (Tilt)", icon: RotateCw, leftLabel: "下", rightLabel: "上" },
];

export function VideoWorkspace({ value, onChange }: VideoWorkspaceProps) {
  const update = (partial: Partial<VideoWorkspaceState>) => onChange({ ...value, ...partial });
  const updateCamera = (key: keyof CameraMotion, val: number) =>
    update({ cameraMotion: { ...value.cameraMotion, [key]: val } });

  return (
    <div className="space-y-5">
      {/* First & Last Frame Dropzones */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">影片時間軸</Label>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <VaultDropzone
              label="首幀 (Start)"
              value={value.firstFrameUrl}
              onDrop={(url) => update({ firstFrameUrl: url })}
              onClear={() => update({ firstFrameUrl: null })}
            />
          </div>

          {/* Timeline connector */}
          <div className="flex flex-col items-center gap-1 shrink-0 py-4">
            <div className="w-0.5 h-3 bg-border/50" />
            <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
            <div className="w-0.5 h-3 bg-border/50" />
          </div>

          <div className="flex-1">
            <VaultDropzone
              label="末幀 (End)"
              value={value.lastFrameUrl}
              onDrop={(url) => update({ lastFrameUrl: url })}
              onClear={() => update({ lastFrameUrl: null })}
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          從一致性保險庫拖放角色到首幀，AI 會在兩幀之間生成過渡影片
        </p>
      </div>

      {/* Character Reference for Consistency */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">角色一致性參考</Label>
        <VaultDropzone
          label="角色參考圖 (Character Ref)"
          value={value.characterRefUrl}
          onDrop={(url) => update({ characterRefUrl: url })}
          onClear={() => update({ characterRefUrl: null })}
          className="max-w-[50%]"
        />
        <p className="text-[10px] text-muted-foreground/60">
          拖放角色確保整段影片中角色外觀一致
        </p>
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">影片長度</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { value: "4", label: "4 秒" },
            { value: "8", label: "8 秒" },
            { value: "16", label: "16 秒" },
            { value: "30", label: "30 秒" },
          ].map((d) => (
            <button
              key={d.value}
              onClick={() => update({ duration: d.value })}
              className={`px-3 py-2 rounded-lg text-[11px] font-medium transition-all ${
                value.duration === d.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-white/40 text-muted-foreground hover:bg-white/60"
              }`}
            >
              {d.label}
              {parseInt(d.value) > 8 && (
                <span className="block text-[9px] opacity-70 mt-0.5">遞迴生成</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Camera Motion Controls */}
      <div className="space-y-3">
        <Label className="text-xs font-medium text-muted-foreground">鏡頭運動</Label>
        <div className="space-y-3 p-3 rounded-xl" style={{
          background: "rgba(255,255,255,0.3)",
          border: "1px solid rgba(255,255,255,0.5)",
        }}>
          {CAMERA_CONTROLS.map(({ key, label, icon: Icon, leftLabel, rightLabel }) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-foreground">{label}</span>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
                  {value.cameraMotion[key] > 0 ? "+" : ""}{value.cameraMotion[key]}
                </span>
              </div>
              <Slider
                value={[value.cameraMotion[key]]}
                onValueChange={([val]) => updateCamera(key, val)}
                min={-100}
                max={100}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground/50">
                <span>{leftLabel}</span>
                <span>靜止</span>
                <span>{rightLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
