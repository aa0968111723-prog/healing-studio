// AIDV-864 PR②：功能區域清單 + 從路徑自動偵測
export interface FeedbackArea {
  id: string;
  label: string;
}

export const FEEDBACK_AREAS: FeedbackArea[] = [
  { id: "video_generate", label: "影片生成" },
  { id: "image_studio",   label: "圖片工作室" },
  { id: "character_world", label: "角色·世界觀" },
  { id: "export",         label: "匯出" },
  { id: "account_settings", label: "帳號設定" },
  { id: "learning",       label: "學習中心" },
  { id: "feedback_page",  label: "回饋管理" },
  { id: "admin",          label: "管理後台" },
  { id: "home",           label: "首頁" },
  { id: "other",          label: "其他" },
];

const PATH_MAP: [string, string][] = [
  ["/video",    "video_generate"],
  ["/social",   "image_studio"],
  ["/learn",    "learning"],
  ["/settings", "account_settings"],
  ["/feedback", "feedback_page"],
  ["/admin",    "admin"],
  ["/export",   "export"],
  ["/character","character_world"],
  ["/world",    "character_world"],
];

export function detectAreaFromPath(path: string): string {
  for (const [prefix, areaId] of PATH_MAP) {
    if (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?")) {
      return areaId;
    }
  }
  return path === "/" ? "home" : "other";
}
