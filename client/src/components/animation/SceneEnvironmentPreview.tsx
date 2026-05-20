/**
 * SceneEnvironmentPreview — 場景環境即時視覺預覽
 *
 * 根據場景的環境描述（environment, flora, lighting等）
 * 生成即時的視覺代表圖，幫助使用者在編輯時預覽場景氛圍
 */

import { memo, useMemo } from "react";
import { type WorldScene } from "../../../../shared/worldbuilding-types";
import { Trees, Sun, Cloud, Moon, Droplets, Wind } from "lucide-react";

interface SceneEnvironmentPreviewProps {
  scene: WorldScene;
  className?: string;
}

export const SceneEnvironmentPreview = memo(function SceneEnvironmentPreview({
  scene,
  className = "",
}: SceneEnvironmentPreviewProps) {
  // 從場景描述生成視覺元素
  const visualElements = useMemo(() => {
    const environment = scene.environment ?? "";
    const lighting = scene.lighting ?? "";
    const mood = scene.mood ?? "";
    const flora = scene.flora ?? [];
    const environmentChanges = scene.environmentChanges ?? [];

    // 提取時間/天氣關鍵字
    const timeOfDay = lighting.includes("黃昏") || lighting.includes("夕陽") ? "sunset"
      : lighting.includes("夜") || lighting.includes("月光") ? "night"
      : lighting.includes("晨") || lighting.includes("日出") ? "dawn"
      : "day";

    const weather = environment.includes("雨") || environmentChanges.some(c => c.includes("雨")) ? "rain"
      : environment.includes("霧") || environmentChanges.some(c => c.includes("霧")) ? "fog"
      : environment.includes("雪") ? "snow"
      : environment.includes("雲") ? "cloudy"
      : "clear";

    // 提取顏色基調
    const colors: string[] = [];
    if (timeOfDay === "sunset") {
      colors.push("#ff6b35", "#f7931e", "#ffd93d");
    } else if (timeOfDay === "night") {
      colors.push("#1a1a2e", "#162447", "#3d5a80");
    } else if (timeOfDay === "dawn") {
      colors.push("#ffa07a", "#87ceeb", "#ffd700");
    } else {
      colors.push("#87ceeb", "#98d8c8", "#6fcf97");
    }

    // 根據氛圍調整
    if (mood.includes("療癒") || mood.includes("溫馨")) {
      colors[0] = "#a8dadc";
      colors[1] = "#e8dff5";
    } else if (mood.includes("神秘") || mood.includes("詭譎")) {
      colors[0] = "#4a4e69";
      colors[1] = "#9a8c98";
    }

    // 提取環境元素
    const hasForest = environment.includes("森林") || flora.some(f => f.includes("樹"));
    const hasWater = environment.includes("水") || environment.includes("河") || environment.includes("湖");
    const hasMountain = environment.includes("山");

    return {
      timeOfDay,
      weather,
      colors,
      hasForest,
      hasWater,
      hasMountain,
      flora: flora.slice(0, 3),
    };
  }, [scene]);

  // 生成天氣圖標
  const WeatherIcon = () => {
    switch (visualElements.weather) {
      case "rain":
        return <Droplets className="w-5 h-5" style={{ color: visualElements.colors[2] ?? "#87ceeb" }} />;
      case "fog":
        return <Cloud className="w-5 h-5 opacity-60" style={{ color: visualElements.colors[1] }} />;
      case "cloudy":
        return <Cloud className="w-5 h-5" style={{ color: visualElements.colors[1] }} />;
      default:
        return visualElements.timeOfDay === "night" ? (
          <Moon className="w-5 h-5" style={{ color: visualElements.colors[2] ?? "#ffd700" }} />
        ) : (
          <Sun className="w-5 h-5" style={{ color: visualElements.colors[2] ?? "#ffd700" }} />
        );
    }
  };

  // 生成環境 SVG
  const generateEnvironmentSVG = () => {
    return (
      <svg className="absolute inset-0 w-full h-full" opacity="0.4">
        <defs>
          <linearGradient id="skyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={visualElements.colors[0]} stopOpacity="0.8" />
            <stop offset="50%" stopColor={visualElements.colors[1]} stopOpacity="0.5" />
            <stop offset="100%" stopColor={visualElements.colors[2] ?? visualElements.colors[1]} stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* 天空/背景 */}
        <rect width="100%" height="60%" fill="url(#skyGradient)" />

        {/* 地面 */}
        <rect y="60%" width="100%" height="40%" fill={visualElements.colors[1]} opacity="0.3" />

        {/* 山脈剪影 */}
        {visualElements.hasMountain && (
          <>
            <path
              d="M 0 60 Q 30 40 60 60 T 120 60 L 120 100 L 0 100 Z"
              fill={visualElements.colors[0]}
              opacity="0.4"
            />
            <path
              d="M 40 60 Q 65 45 90 60 T 140 60 L 140 100 L 40 100 Z"
              fill={visualElements.colors[0]}
              opacity="0.3"
            />
          </>
        )}

        {/* 森林剪影 */}
        {visualElements.hasForest && (
          <>
            <polygon points="10,75 15,55 20,75" fill={visualElements.colors[0]} opacity="0.5" />
            <polygon points="25,75 30,58 35,75" fill={visualElements.colors[0]} opacity="0.5" />
            <polygon points="40,75 47,52 54,75" fill={visualElements.colors[0]} opacity="0.5" />
            <polygon points="60,75 66,60 72,75" fill={visualElements.colors[0]} opacity="0.5" />
            <polygon points="80,75 85,56 90,75" fill={visualElements.colors[0]} opacity="0.5" />
          </>
        )}

        {/* 水面 */}
        {visualElements.hasWater && (
          <rect y="75%" width="100%" height="25%" fill={visualElements.colors[2] ?? visualElements.colors[1]} opacity="0.25" />
        )}

        {/* 雨滴 */}
        {visualElements.weather === "rain" && (
          <>
            <line x1="20" y1="0" x2="18" y2="20" stroke={visualElements.colors[2]} strokeWidth="1" opacity="0.5" />
            <line x1="40" y1="5" x2="38" y2="25" stroke={visualElements.colors[2]} strokeWidth="1" opacity="0.5" />
            <line x1="60" y1="2" x2="58" y2="22" stroke={visualElements.colors[2]} strokeWidth="1" opacity="0.5" />
            <line x1="80" y1="8" x2="78" y2="28" stroke={visualElements.colors[2]} strokeWidth="1" opacity="0.5" />
            <line x1="100" y1="3" x2="98" y2="23" stroke={visualElements.colors[2]} strokeWidth="1" opacity="0.5" />
          </>
        )}

        {/* 霧氣 */}
        {visualElements.weather === "fog" && (
          <>
            <ellipse cx="30" cy="50" rx="40" ry="8" fill={visualElements.colors[1]} opacity="0.3" />
            <ellipse cx="70" cy="55" rx="35" ry="7" fill={visualElements.colors[1]} opacity="0.25" />
            <ellipse cx="50" cy="65" rx="45" ry="9" fill={visualElements.colors[1]} opacity="0.2" />
          </>
        )}
      </svg>
    );
  };

  const hasContent = scene.environment || scene.lighting || scene.mood || (scene.flora && scene.flora.length > 0);

  return (
    <div className={`relative rounded-lg overflow-hidden border border-border/40 ${className}`}>
      {/* 背景層 */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${visualElements.colors[0]}22, ${visualElements.colors[1]}11)`,
        }}
      />

      {/* SVG 環境層 */}
      {hasContent && generateEnvironmentSVG()}

      {/* 內容層 */}
      <div className="relative p-4 space-y-3">
        {/* 場景標題 */}
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-sm">{scene.name || "未命名場景"}</h4>
            {scene.tagline && (
              <p className="text-xs text-muted-foreground mt-0.5">{scene.tagline}</p>
            )}
          </div>
          <WeatherIcon />
        </div>

        {/* 環境特徵 */}
        {hasContent && (
          <div className="space-y-2">
            {/* 時間與天氣 */}
            <div className="flex flex-wrap gap-1.5">
              <div
                className="px-2 py-1 rounded-full text-[10px] border"
                style={{
                  backgroundColor: `${visualElements.colors[0]}15`,
                  borderColor: `${visualElements.colors[0]}40`,
                  color: visualElements.colors[0],
                }}
              >
                {visualElements.timeOfDay === "sunset" ? "黃昏" :
                 visualElements.timeOfDay === "night" ? "夜晚" :
                 visualElements.timeOfDay === "dawn" ? "清晨" : "白天"}
              </div>
              <div
                className="px-2 py-1 rounded-full text-[10px] border"
                style={{
                  backgroundColor: `${visualElements.colors[1]}15`,
                  borderColor: `${visualElements.colors[1]}40`,
                  color: visualElements.colors[1],
                }}
              >
                {visualElements.weather === "rain" ? "雨天" :
                 visualElements.weather === "fog" ? "霧氣" :
                 visualElements.weather === "cloudy" ? "多雲" : "晴朗"}
              </div>
            </div>

            {/* 植被標籤 */}
            {visualElements.flora.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <Trees className="w-4 h-4 text-muted-foreground" />
                {visualElements.flora.map((f, i) => (
                  <div
                    key={i}
                    className="px-2 py-1 rounded-full text-[10px] border border-border/40 bg-card/40 text-muted-foreground"
                  >
                    {f}
                  </div>
                ))}
              </div>
            )}

            {/* 環境元素圖標 */}
            <div className="flex gap-2 pt-1">
              {visualElements.hasForest && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Trees className="w-3.5 h-3.5" />
                  <span>森林</span>
                </div>
              )}
              {visualElements.hasWater && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Droplets className="w-3.5 h-3.5" />
                  <span>水域</span>
                </div>
              )}
              {visualElements.hasMountain && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Wind className="w-3.5 h-3.5" />
                  <span>山脈</span>
                </div>
              )}
            </div>
          </div>
        )}

        {!hasContent && (
          <p className="text-xs text-muted-foreground text-center py-2">
            填寫場景資料後將顯示視覺預覽
          </p>
        )}
      </div>
    </div>
  );
});
