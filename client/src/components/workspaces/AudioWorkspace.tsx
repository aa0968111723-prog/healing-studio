import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ZenTooltip } from "@/components/ZenCoPilot";
import { Music, Mic2, Clock } from "lucide-react";

export type AudioWorkspaceState = {
  isInstrumental: boolean;
  lyrics: string;
  musicStyle: string;
  duration: number;
  energy: number;
};

type AudioWorkspaceProps = {
  value: AudioWorkspaceState;
  onChange: (state: AudioWorkspaceState) => void;
};

const MUSIC_STYLES = [
  { value: "ambient", label: "環境音樂" },
  { value: "lofi", label: "Lo-Fi" },
  { value: "classical", label: "古典" },
  { value: "electronic", label: "電子" },
  { value: "jazz", label: "爵士" },
  { value: "cinematic", label: "電影配樂" },
  { value: "pop", label: "流行" },
  { value: "rnb", label: "R&B" },
  { value: "folk", label: "民謠" },
  { value: "hiphop", label: "嘻哈" },
];

export function createDefaultAudioState(): AudioWorkspaceState {
  return {
    isInstrumental: true,
    lyrics: "",
    musicStyle: "ambient",
    duration: 30,
    energy: 50,
  };
}

export function AudioWorkspace({ value, onChange }: AudioWorkspaceProps) {
  const update = (partial: Partial<AudioWorkspaceState>) =>
    onChange({ ...value, ...partial });

  return (
    <div className="space-y-5">
      {/* Instrumental vs Vocal Toggle */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/35 border border-white/50">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              value.isInstrumental ? "bg-primary/10" : "bg-violet-500/10"
            }`}
          >
            {value.isInstrumental ? (
              <Music className="w-4 h-4 text-primary" />
            ) : (
              <Mic2 className="w-4 h-4 text-violet-600" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {value.isInstrumental ? "純音樂" : "含人聲"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {value.isInstrumental ? "僅生成樂器演奏" : "包含歌詞演唱"}
            </p>
          </div>
        </div>
        <Switch
          checked={!value.isInstrumental}
          onCheckedChange={checked => update({ isInstrumental: !checked })}
        />
      </div>

      {/* Lyrics (shown when vocal) */}
      {!value.isInstrumental && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            歌詞
          </Label>
          <Textarea
            placeholder={
              "[Verse 1]\n在寧靜的夜晚\n星光灑落在窗前\n\n[Chorus]\n讓音樂帶我飛翔\n穿越時空的彼岸"
            }
            value={value.lyrics}
            onChange={e => update({ lyrics: e.target.value })}
            rows={6}
            className="rounded-xl bg-white/40 border-white/60 resize-none text-xs font-mono placeholder:text-muted-foreground/35 leading-relaxed"
          />
          <p className="text-[10px] text-muted-foreground/60">
            使用 [Verse]、[Chorus]、[Bridge] 標記歌曲結構
          </p>
        </div>
      )}

      {/* Music Style */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          音樂風格
        </Label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {MUSIC_STYLES.map(style => (
            <button
              key={style.value}
              onClick={() => update({ musicStyle: style.value })}
              className={`px-2 py-2 rounded-lg text-[10px] font-medium transition-all ${
                value.musicStyle === style.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-white/40 text-muted-foreground hover:bg-white/60"
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium text-muted-foreground">
              曲目長度
            </Label>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {value.duration}s
          </span>
        </div>
        <Slider
          value={[value.duration]}
          onValueChange={([val]) => update({ duration: val })}
          min={15}
          max={120}
          step={5}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>15 秒</span>
          <span>120 秒</span>
        </div>
      </div>

      {/* Energy Level */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">
            能量強度
          </Label>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {value.energy}%
          </span>
        </div>
        <Slider
          value={[value.energy]}
          onValueChange={([val]) => update({ energy: val })}
          min={0}
          max={100}
          step={5}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>柔和舒緩</span>
          <span>激昂澎湃</span>
        </div>
      </div>
    </div>
  );
}
