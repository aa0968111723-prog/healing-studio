import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Link2, Package2, Sparkles } from "lucide-react";

type SubpageKey =
  | "assets"
  | "history"
  | "prompt-library"
  | "shared"
  | "models"
  | "vault"
  | "lora-trainer"
  | "background-tasks";

const GUIDE_CONTENT: Record<
  SubpageKey,
  { title: string; bullets: string[]; badge: string }
> = {
  assets: {
    title: "素材庫最佳流程",
    badge: "素材",
    bullets: [
      "先用關鍵字 + 類型篩選，再做收藏避免重找。",
      "重要素材加上用途註記（封面 / 分鏡 / 角色）。",
      "需要回編時直接傳送到對應工作室，減少重工。",
    ],
  },
  history: {
    title: "生成歷史回放策略",
    badge: "歷史",
    bullets: [
      "先以模型與時間區間縮小範圍，再比對參數。",
      "把可重用案例加入精選，建立個人範本池。",
      "回放時先改一項參數，避免多變數難以追因。",
    ],
  },
  "prompt-library": {
    title: "提示詞庫管理重點",
    badge: "提示詞",
    bullets: [
      "以任務場景命名（例：商品主視覺 / 角色轉場）。",
      "保存「可複製片段」而非超長單一提示詞。",
      "加入負向提示詞模板，提升穩定出圖率。",
    ],
  },
  shared: {
    title: "團隊共享協作守則",
    badge: "共享",
    bullets: [
      "分享前補齊模型、參數與適用情境說明。",
      "檔案命名帶版本號，避免覆蓋與誤用。",
      "優先共享可落地模板，降低團隊試錯成本。",
    ],
  },
  models: {
    title: "模型庫選型與套用策略",
    badge: "模型",
    bullets: [
      "先看模型狀態與使用紀錄，再決定是否套用到工作室。",
      "用名稱 + 版本規範，避免團隊誤用舊模型。",
      "套用後同步記錄觸發詞，讓後續迭代可重現。",
    ],
  },
  vault: {
    title: "角色保險庫穩定策略",
    badge: "保險庫",
    bullets: [
      "先固定角色核心特徵（髮型/服裝/色系）。",
      "角色與場景分開管理，後續組合更靈活。",
      "每次生成先套用錨點，再做風格微調。",
    ],
  },
  "lora-trainer": {
    title: "模型訓練提效建議",
    badge: "訓練",
    bullets: [
      "先做小樣本試訓，確認方向再擴充資料量。",
      "資料品質優先於數量，避免雜訊拖慢收斂。",
      "記錄每輪超參數，快速回溯最佳 checkpoint。",
    ],
  },
  "background-tasks": {
    title: "背景任務追蹤要點",
    badge: "任務",
    bullets: [
      "先看失敗任務再看完成任務，優先排除阻塞。",
      "按模態分批檢查可更快找到問題來源。",
      "長任務完成後立即歸檔，保持面板乾淨。",
    ],
  },
};

const ASSET_MODEL_SUBPAGES: {
  key: SubpageKey;
  label: string;
  path: string;
}[] = [
  { key: "assets", label: "素材中心", path: "/assets" },
  { key: "history", label: "生成歷史", path: "/assets?section=history" },
  { key: "prompt-library", label: "提示詞庫", path: "/prompt-library" },
  { key: "shared", label: "共享素材", path: "/shared" },
  { key: "models", label: "角色鍛造所 & 模型訓練", path: "/models" },
  { key: "vault", label: "角色保險庫", path: "/vault" },
  { key: "background-tasks", label: "背景任務", path: "/background-tasks" },
];

const GLOBAL_HANDOFFS = [
  { label: "創作工作室", path: "/studio" },
  { label: "圖片創作室", path: "/image-studio" },
  { label: "影片創作室", path: "/video-studio" },
  { label: "專業創作室", path: "/pro-studio" },
  { label: "導演 AI", path: "/director" },
];

export function AssetModelSubpageGuide({ page }: { page: SubpageKey }) {
  const [open, setOpen] = useState(false);
  const content = useMemo(() => GUIDE_CONTENT[page], [page]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl border border-border/50 bg-background/70 p-3"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Package2 className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs sm:text-sm font-medium text-left truncate">
              {content.title}
            </p>
            <Badge variant="secondary" className="text-[10px] rounded-full">
              {content.badge}
            </Badge>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <ul className="space-y-1 list-disc pl-5">
          {content.bullets.map(b => (
            <li key={b} className="text-xs text-muted-foreground">
              {b}
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-primary" />
            <p className="text-[11px] font-medium text-foreground/80">
              素材與模型 7 子分頁
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ASSET_MODEL_SUBPAGES.map(item => {
              const effectivePage = page === "lora-trainer" ? "models" : page;
              const isActive = item.key === effectivePage;
              return (
                <Link
                  key={item.key}
                  href={item.path}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-background/70 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-border/50 bg-muted/20 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <p className="text-[11px] font-medium text-foreground/80">
              全站串接建議入口
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GLOBAL_HANDOFFS.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className="text-[11px] px-2 py-1 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background/70"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
