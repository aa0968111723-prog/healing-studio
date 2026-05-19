/**
 * CharacterVisualPreview — 角色即時視覺預覽
 *
 * 根據角色的文字描述（appearance, outfit, personality等）
 * 生成即時的視覺代表圖，幫助使用者在編輯時預覽角色形象
 */

import { memo, useMemo } from "react";
import { type WorldCharacter } from "../../../../shared/worldbuilding-types";
import { User, Palette, Sparkles } from "lucide-react";

interface CharacterVisualPreviewProps {
  character: WorldCharacter;
  className?: string;
}

export const CharacterVisualPreview = memo(function CharacterVisualPreview({
  character,
  className = "",
}: CharacterVisualPreviewProps) {
  // 從角色描述生成視覺元素
  const visualElements = useMemo(() => {
    const appearance = character.appearance ?? "";
    const personality = character.personality ?? "";
    const likes = character.likes ?? [];

    // 提取顏色關鍵字
    const colors: string[] = [];
    const colorKeywords = [
      { key: "黑", color: "#2c2c2c" },
      { key: "白", color: "#f5f5f5" },
      { key: "紅", color: "#e74c3c" },
      { key: "藍", color: "#3498db" },
      { key: "綠", color: "#27ae60" },
      { key: "黃", color: "#f1c40f" },
      { key: "紫", color: "#9b59b6" },
      { key: "粉", color: "#ff85c0" },
      { key: "棕", color: "#8b6f47" },
      { key: "金", color: "#ffd700" },
      { key: "銀", color: "#c0c0c0" },
      { key: "橙", color: "#ff8c42" },
      { key: "灰", color: "#95a5a6" },
    ];

    colorKeywords.forEach(({ key, color }) => {
      if (appearance.includes(key) && colors.length < 3) {
        colors.push(color);
      }
    });

    // 如果沒有提取到顏色，使用預設色
    if (colors.length === 0) {
      colors.push("#7f8c8d", "#95a5a6", "#bdc3c7");
    }

    // 提取性格關鍵字來決定圖案風格
    const patterns: string[] = [];
    if (personality.includes("活潑") || personality.includes("開朗")) {
      patterns.push("energetic");
    }
    if (personality.includes("沉穩") || personality.includes("冷靜")) {
      patterns.push("calm");
    }
    if (personality.includes("神秘") || personality.includes("冷漠")) {
      patterns.push("mysterious");
    }

    // 提取物品/喜好關鍵字
    const items = [...likes, ...((character.signatureItems ?? []))].slice(0, 3);

    return { colors, patterns, items };
  }, [character]);

  // 生成 SVG 背景圖案
  const generatePattern = (colors: string[], patterns: string[]) => {
    const isEnergetic = patterns.includes("energetic");
    const isCalm = patterns.includes("calm");
    const isMysterious = patterns.includes("mysterious");

    // 根據性格選擇圖案
    if (isEnergetic) {
      return (
        <svg className="absolute inset-0 w-full h-full" opacity="0.3">
          <defs>
            <pattern id="energetic" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="3" fill={colors[0]} />
              <circle cx="30" cy="20" r="2" fill={colors[1] ?? colors[0]} />
              <circle cx="20" cy="35" r="2.5" fill={colors[2] ?? colors[0]} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#energetic)" />
        </svg>
      );
    }

    if (isCalm) {
      return (
        <svg className="absolute inset-0 w-full h-full" opacity="0.2">
          <defs>
            <pattern id="calm" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <line x1="0" y1="30" x2="60" y2="30" stroke={colors[0]} strokeWidth="1" />
              <line x1="0" y1="45" x2="60" y2="45" stroke={colors[1] ?? colors[0]} strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#calm)" />
        </svg>
      );
    }

    if (isMysterious) {
      return (
        <svg className="absolute inset-0 w-full h-full" opacity="0.25">
          <defs>
            <radialGradient id="mysterious">
              <stop offset="0%" stopColor={colors[0]} stopOpacity="0.4" />
              <stop offset="100%" stopColor={colors[1] ?? colors[0]} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50%" cy="50%" r="40%" fill="url(#mysterious)" />
        </svg>
      );
    }

    // 預設圖案
    return (
      <svg className="absolute inset-0 w-full h-full" opacity="0.15">
        <defs>
          <pattern id="default" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="25" height="25" fill={colors[0]} opacity="0.5" />
            <rect x="25" y="25" width="25" height="25" fill={colors[1] ?? colors[0]} opacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#default)" />
      </svg>
    );
  };

  const hasContent = character.appearance || character.personality || (character.likes && character.likes.length > 0);

  return (
    <div className={`relative rounded-lg overflow-hidden border border-border/40 ${className}`}>
      {/* 背景漸變 */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${visualElements.colors[0] ?? "#7f8c8d"}22, ${visualElements.colors[1] ?? "#95a5a6"}11)`,
        }}
      />

      {/* 圖案層 */}
      {generatePattern(visualElements.colors, visualElements.patterns)}

      {/* 內容層 */}
      <div className="relative p-4 space-y-3">
        {/* 頭像區域 */}
        <div className="flex items-center gap-3">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center border-2"
            style={{
              borderColor: visualElements.colors[0] ?? "#7f8c8d",
              background: `linear-gradient(135deg, ${visualElements.colors[0] ?? "#7f8c8d"}33, ${visualElements.colors[1] ?? "#95a5a6"}22)`,
            }}
          >
            <User className="w-8 h-8" style={{ color: visualElements.colors[0] ?? "#7f8c8d" }} />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-sm">{character.name || "未命名角色"}</h4>
            {character.tagline && (
              <p className="text-xs text-muted-foreground mt-0.5">{character.tagline}</p>
            )}
          </div>
        </div>

        {/* 特徵標籤 */}
        {hasContent && (
          <div className="flex flex-wrap gap-1.5">
            {character.appearance && (
              <div
                className="px-2 py-1 rounded-full text-[10px] flex items-center gap-1 border"
                style={{
                  backgroundColor: `${visualElements.colors[0] ?? "#7f8c8d"}15`,
                  borderColor: `${visualElements.colors[0] ?? "#7f8c8d"}40`,
                  color: visualElements.colors[0] ?? "#7f8c8d",
                }}
              >
                <Palette className="w-3 h-3" />
                外貌已設定
              </div>
            )}
            {character.personality && (
              <div
                className="px-2 py-1 rounded-full text-[10px] flex items-center gap-1 border"
                style={{
                  backgroundColor: `${visualElements.colors[1] ?? "#95a5a6"}15`,
                  borderColor: `${visualElements.colors[1] ?? "#95a5a6"}40`,
                  color: visualElements.colors[1] ?? "#95a5a6",
                }}
              >
                <Sparkles className="w-3 h-3" />
                個性已設定
              </div>
            )}
            {visualElements.items.slice(0, 2).map((item, i) => (
              <div
                key={i}
                className="px-2 py-1 rounded-full text-[10px] border border-border/40 bg-card/40 text-muted-foreground"
              >
                {item}
              </div>
            ))}
          </div>
        )}

        {!hasContent && (
          <p className="text-xs text-muted-foreground text-center py-2">
            填寫角色資料後將顯示視覺預覽
          </p>
        )}
      </div>
    </div>
  );
});
