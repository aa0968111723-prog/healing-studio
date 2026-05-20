/**
 * WorldContextSidebar — 各 Studio 頁面共用的「當前世界觀」面板
 * ────────────────────────────────────────────────────────────────────────────
 * 任何 Studio 頁面（Image / Video / Pro）可以 drop-in 這個元件，
 * 使用者就能：
 *   1. 看到當前選定的創作專案 + 世界觀
 *   2. 切換到不同的創作專案
 *   3. 暫時停用世界觀注入
 *
 * 設計原則：
 *   - 預設 collapsed，不擋畫面
 *   - 沒有專案時顯示 CTA 引導用戶建立 / 選擇
 *   - 不打斷任何既有 Studio 功能
 */

import { useState } from "react";
import { Link } from "wouter";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Globe2, Sparkles, X } from "lucide-react";

export interface WorldContextSidebarProps {
  /** Card 的額外 CSS class */
  className?: string;
  /** 是否預設展開（預設 true，因為使用者通常會想看一致性前綴） */
  defaultOpen?: boolean;
  /** 隱藏「切換專案」下拉，只顯示當前狀態（給唯讀模式用） */
  hideSwitcher?: boolean;
}

const STATUS_LABELS: Record<
  "concept" | "production" | "review" | "complete",
  string
> = {
  concept: "概念中",
  production: "製作中",
  review: "審查中",
  complete: "完成",
};

export function WorldContextSidebar({
  className,
  defaultOpen = true,
  hideSwitcher = false,
}: WorldContextSidebarProps) {
  const world = useWorldContext();
  const [open, setOpen] = useState(defaultOpen);

  const projectsQuery = trpc.creativeProject.list.useQuery(undefined, {
    staleTime: 60_000,
  });

  const handleSelect = (value: string) => {
    if (value === "__none__") {
      world.setCurrentProjectId(null);
    } else {
      const id = Number.parseInt(value, 10);
      if (Number.isFinite(id) && id > 0) {
        world.setCurrentProjectId(id);
      }
    }
  };

  return (
    <Card className={className}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <div className="flex items-center gap-2">
                <Globe2 className="size-4 text-primary" />
                <CardTitle className="text-sm">世界觀上下文</CardTitle>
                {world.isActive && (
                  <Badge variant="secondary" className="gap-1">
                    <Sparkles className="size-3" />
                    已注入
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={`size-4 transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pb-4">
            {!hideSwitcher && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  創作專案
                </label>
                <Select
                  value={
                    world.currentProjectId !== null
                      ? String(world.currentProjectId)
                      : "__none__"
                  }
                  onValueChange={handleSelect}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="未選定專案" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">
                        停用（不注入世界觀）
                      </span>
                    </SelectItem>
                    {(projectsQuery.data ?? []).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {world.currentProject ? (
              <div className="space-y-2 rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {world.currentProject.title}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {STATUS_LABELS[world.currentProject.status]}
                  </Badge>
                </div>
                {world.currentProject.worldFrameworkName ? (
                  <div className="text-muted-foreground">
                    世界觀：
                    <span className="text-foreground">
                      {world.currentProject.worldFrameworkName}
                    </span>
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    （此專案尚未綁定世界觀框架）
                  </div>
                )}

                {world.consistencyPrefix ? (
                  <details className="group">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      一致性前綴（自動注入 prompt）
                    </summary>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[10px] leading-relaxed">
                      {world.consistencyPrefix}
                    </pre>
                  </details>
                ) : world.isLoading ? (
                  <div className="text-muted-foreground">載入摘要中…</div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                <p>尚未選定創作專案。</p>
                <p>選定後，所有生成將自動帶入世界觀一致性前綴。</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  asChild
                >
                  <Link href="/creative-projects">前往創作專案</Link>
                </Button>
              </div>
            )}

            {world.isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => world.setCurrentProjectId(null)}
              >
                <X className="mr-1 size-3" />
                停用世界觀注入
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
