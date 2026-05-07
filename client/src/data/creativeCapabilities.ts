import {
  Clapperboard,
  Cpu,
  Shield,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";

import type { FeatureDetail } from "@/components/FeatureDetailDialog";

export type { FeatureDetail };

export interface CreativeCapability extends FeatureDetail {
  /** Canonical route inside the app. Used by the orb's "試用" button. */
  route: string;
}

export const CREATIVE_CAPABILITIES: CreativeCapability[] = [
  {
    id: "text-to-image",
    icon: Wand2,
    title: "AI 圖片生成",
    description:
      "輸入文字描述，即刻生成高品質影像。支援多種風格與精準的參數調校。",
    longDescription:
      "從一段描述出發，快速產出可商用等級的影像。內建多種美學預設與細節調校，讓你在分鐘內完成從概念到視覺成品的跳躍。",
    features: [
      "多風格預設：寫實 / 插畫 / 電影感 / 日系",
      "精準參數：光影、構圖、色調、鏡頭語言",
      "高解析輸出：支援 2K / 4K 放大",
      "風格參考：上傳 reference 自動擷取氛圍",
    ],
    tag: "圖片",
    color: "rgba(168,85,247,0.10)",
    borderColor: "rgba(168,85,247,0.20)",
    accentColor: "rgb(168,85,247)",
    route: "/image-studio",
  },
  {
    id: "text-to-video",
    icon: Clapperboard,
    title: "AI 影片創作",
    description: "從文字一鍵生成流暢動態影片，適用於短片、動畫與創意敘事。",
    longDescription:
      "自動化從腳本到成片的全流程。鏡頭運動、轉場節奏、角色一致性都幫你處理好，你只需要專注在敘事本身。",
    features: [
      "鏡頭運動自動編排：推拉搖移一鍵套用",
      "多尺寸輸出：9:16 / 16:9 / 1:1 同步生成",
      "角色一致性：跨鏡頭維持同一人物樣貌",
      "音畫同步：自動對齊配樂節奏",
    ],
    tag: "影片",
    color: "rgba(59,130,246,0.10)",
    borderColor: "rgba(59,130,246,0.20)",
    accentColor: "rgb(59,130,246)",
    route: "/video-studio",
  },
  {
    id: "text-to-music",
    icon: Sparkles,
    title: "AI 音樂生成",
    description:
      "描述曲風情境，自動產生原創配樂。從電子氛圍到古典管弦皆可駕馭。",
    longDescription:
      "說出你想要的情緒、節奏與樂器，AI 會產出可直接使用的原創配樂。支援多段落結構與情緒轉折，適合 podcast、短影音、廣告。",
    features: [
      "情境式 prompt：「冷冽、雨夜、慢板鋼琴」",
      "多樂器編制：電子、管弦、民謠、氛圍",
      "段落結構：前奏 / 主歌 / 副歌可分段生成",
      "商用授權：所有輸出可直接發佈",
    ],
    tag: "音樂",
    color: "rgba(236,72,153,0.10)",
    borderColor: "rgba(236,72,153,0.20)",
    accentColor: "rgb(236,72,153)",
    route: "/pro-studio",
  },
  {
    id: "director-ai",
    icon: Cpu,
    title: "導演 AI 編排",
    description:
      "智慧腳本分析與多媒體編排，自動拆解段落並生成對應的圖、影、音。",
    longDescription:
      "把一份腳本丟進來，導演 AI 會幫你拆解場景、分配鏡頭、挑選配樂，並呼叫對應的生成引擎組合出完整作品。",
    features: [
      "腳本自動分鏡：段落 → 場景 → shot list",
      "跨模態編排：圖、影、音、字幕一次到位",
      "節奏調校：自動對齊時間軸與敘事張力",
      "一鍵重跑：單一場景可獨立重新生成",
    ],
    tag: "導演",
    color: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.20)",
    accentColor: "rgb(34,197,94)",
    route: "/director",
  },
  {
    id: "voice-clone",
    icon: Users,
    title: "語音克隆",
    description: "上傳語音樣本，精確複製說話風格與音色，適用於配音與旁白製作。",
    longDescription:
      "只需 30 秒的聲音樣本，即可建立專屬語音模型。支援多語言、多情緒演繹，適合 podcast、旁白、有聲書與角色配音。",
    features: [
      "低樣本建模：30 秒樣本即可開始",
      "多語言輸出：中英日韓自然切換",
      "情緒控制：平靜、激昂、溫柔、嚴肅",
      "倫理保護：需本人授權 + 浮水印追溯",
    ],
    tag: "語音",
    color: "rgba(249,115,22,0.10)",
    borderColor: "rgba(249,115,22,0.20)",
    accentColor: "rgb(249,115,22)",
    route: "/pro-studio",
  },
  {
    id: "lora-training",
    icon: Shield,
    title: "角色訓練 LoRA",
    description: "訓練專屬角色模型，確保跨作品的視覺風格一致性與角色辨識度。",
    longDescription:
      "為你的 IP 角色或個人風格訓練專屬 LoRA 模型，在後續所有生成任務中保持一致的視覺特徵，不再為「角色又不像」煩惱。",
    features: [
      "少量樣本訓練：10–20 張即可開始",
      "跨媒介一致：圖、影、3D 全部通用",
      "版本管理：可保留多個風格 checkpoint",
      "私有部署：訓練資料不外流",
    ],
    tag: "訓練",
    color: "rgba(14,165,233,0.10)",
    borderColor: "rgba(14,165,233,0.20)",
    accentColor: "rgb(14,165,233)",
    route: "/models",
  },
];
