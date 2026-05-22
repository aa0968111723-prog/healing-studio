import { useMemo } from "react";
import { useLocation } from "wouter";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APP_PAGE_REGISTRY,
  VISIBLE_DOCK_PAGE_IDS,
  type AppPageGroupId,
  type AppPageRegistryItem,
} from "@/config/appRegistry";

const GROUP_LABELS: Record<AppPageGroupId, string> = {
  orb: "光球與聊天",
  create: "創作與企劃",
  train: "模型訓練",
  project: "專案與筆記",
  assets: "資產與資料",
  learn: "學習與教學",
  settings: "設定與帳戶",
  admin: "管理後台",
};

// 隱藏不應該出現在「未整理區域」清單裡的頁面：
//   - VISIBLE_DOCK_PAGE_IDS 內的頁面（已經在主選單上）
//   - 動態路由與其他不適合直接從清單跳轉的頁面
const HIDDEN_FROM_UNORGANIZED: ReadonlySet<string> = new Set([
  "unorganized",
  "home", // 首頁直接從頭像選單進入
  "project-detail", // 動態路由 /projects/:id
]);

export default function UnorganizedArea() {
  const [, navigate] = useLocation();

  const grouped = useMemo(() => {
    const buckets = new Map<AppPageGroupId, AppPageRegistryItem[]>();
    for (const page of APP_PAGE_REGISTRY) {
      if (VISIBLE_DOCK_PAGE_IDS.has(page.id)) continue;
      if (HIDDEN_FROM_UNORGANIZED.has(page.id)) continue;
      const arr = buckets.get(page.group) ?? [];
      arr.push(page);
      buckets.set(page.group, arr);
    }
    return [...buckets.entries()]
      .map(([groupId, pages]) => ({
        groupId,
        label: GROUP_LABELS[groupId] ?? groupId,
        pages: pages.slice().sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
  }, []);

  return (
    <div className="page-shell space-y-3 sm:space-y-5">
      <Card>
        <CardHeader className="pb-2 px-3.5 sm:px-6 sm:pb-4">
          <p className="text-[11px] sm:text-xs text-muted-foreground">暫存區 / 未整理</p>
          <CardTitle className="text-lg sm:text-2xl flex items-center gap-2">
            <Inbox className="w-5 h-5" /> 未整理區域
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3.5 sm:px-6">
          <p className="text-xs sm:text-sm leading-5 sm:leading-6 text-muted-foreground">
            這裡彙整所有暫時不在主選單上的頁面。可以從這裡先打開使用，等之後再決定要把哪些頁面放回主選單。
          </p>
        </CardContent>
      </Card>

      {grouped.map(group => (
        <Card key={group.groupId}>
          <CardHeader className="pb-2 px-3.5 sm:px-6 sm:pb-3">
            <CardTitle className="text-sm sm:text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="px-3.5 sm:px-6 pb-3 sm:pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
              {group.pages.map(page => (
                <Button
                  key={page.id}
                  variant="outline"
                  className="h-auto min-h-14 justify-start whitespace-normal py-2.5 px-3 text-left"
                  onClick={() => navigate(page.path)}
                >
                  <div className="flex flex-col items-start gap-0.5 w-full">
                    <span className="text-sm font-medium">{page.label}</span>
                    <span className="text-2xs sm:text-xs text-muted-foreground leading-4 line-clamp-2">
                      {page.description}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
