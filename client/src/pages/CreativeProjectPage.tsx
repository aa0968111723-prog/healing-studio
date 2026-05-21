/**
 * CreativeProjectPage.tsx — 專案主控台列表 + 詳情
 * ────────────────────────────────────────────────────────────────────────────
 * 把 Director session（存在 project_notes_calendar）+ 世界觀框架 + 世界分鏡板
 * 三者綁定成一個有意義的「創作專案」。
 *
 * 此頁面提供：
 *   - 建立 / 列出 / 刪除創作專案
 *   - 把現有的世界觀框架、分鏡板綁定到專案
 *   - 切換到「當前世界觀上下文」，讓各 Studio 頁面自動帶入一致性
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { NextStepPanel } from "@/components/layout/NextStepPanel";
import { SectionCard } from "@/components/layout/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  FolderOpen,
  Globe2,
  Film,
  Trash2,
  Sparkles,
  Loader2,
} from "lucide-react";

type ProjectStatus = "concept" | "production" | "review" | "complete";


function isMissingCreativeProjectsTable(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? "";
  return /ER_NO_SUCH_TABLE/i.test(message) && /creative_projects/i.test(message);
}

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "concept", label: "概念中" },
  { value: "production", label: "製作中" },
  { value: "review", label: "審查中" },
  { value: "complete", label: "完成" },
];

export default function CreativeProjectPage() {
  const world = useWorldContext();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const listQuery = trpc.creativeProject.list.useQuery(undefined, {
    staleTime: 5_000,
  });
  const projects = listQuery.data ?? [];
  const utils = trpc.useUtils();
  const tableMissing = isMissingCreativeProjectsTable(listQuery.error);
  const activeProject = useMemo(() => projects.find(p => p.id === world.currentProjectId) ?? null, [projects, world.currentProjectId]);
  const nextStepText = activeProject
    ? activeProject.worldFrameworkId === null
      ? "下一步：先綁定世界觀。"
      : activeProject.worldStoryboardId === null
      ? "下一步：建立分鏡。"
      : "下一步：產生製作包 / 建立生成任務。"
    : projects.length === 0
    ? "下一步：建立第一個創作專案。"
    : "下一步：選擇目前專案作為全站上下文。";

  const createMutation = trpc.creativeProject.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success("已建立創作專案");
      setCreateOpen(false);
      utils.creativeProject.list.invalidate();
      world.setCurrentProjectId(id);
    },
    onError: err => {
      if (isMissingCreativeProjectsTable(err)) {
        toast.error("創作專案資料表尚未建立，請執行資料庫 migration。");
        return;
      }
      toast.error(err.message || "建立失敗");
    },
  });

  const deleteMutation = trpc.creativeProject.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      setDeleteId(null);
      utils.creativeProject.list.invalidate();
      // 若刪掉的是當前選定的專案，順手停用注入
      if (world.currentProjectId === deleteId) {
        world.setCurrentProjectId(null);
      }
    },
    onError: err => toast.error(err.message || "刪除失敗"),
  });

  return (
    <div className="page-shell space-y-6">
      <PageHeader title="創作專案" subtitle="把世界觀、腳本、分鏡、素材與生成紀錄綁在同一個專案下。" primaryAction={{ label: "建立專案", onClick: () => setCreateOpen(true) }} />

      <NextStepPanel title="專案主控台下一步" description={nextStepText} />

      {tableMissing && (
        <SectionCard title="資料庫尚未完成初始化" description="創作專案資料表尚未建立，請執行資料庫 migration。" />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <SectionCard title="目前專案" description={activeProject ? `當前：${activeProject.title}` : "尚未啟用專案"} />
        <SectionCard title="綁定狀態" description={activeProject ? `世界觀：${activeProject.worldFrameworkId ? "已綁定" : "未綁定"}｜分鏡：${activeProject.worldStoryboardId ? "已綁定" : "未綁定"}` : "先啟用專案後檢查綁定"} />
      </div>

      {listQuery.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">
          <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
          載入中…
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>還沒有任何創作專案。建立一個來開始多模態創作。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => {
            const isActive = world.currentProjectId === p.id;
            return (
              <div
                key={p.id}
                className={`rounded-xl border bg-card p-4 transition hover:shadow-md ${
                  isActive ? "border-primary ring-1 ring-primary/30" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate font-medium">{p.title}</h3>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {STATUS_OPTIONS.find(s => s.value === p.status)?.label ??
                      p.status}
                  </Badge>
                </div>

                <div className="mt-3 space-y-1 text-xs">
                  <BindingRow
                    icon={<Globe2 className="size-3" />}
                    label="世界觀"
                    bound={p.worldFrameworkId !== null}
                  />
                  <BindingRow
                    icon={<Film className="size-3" />}
                    label="分鏡板"
                    bound={p.worldStoryboardId !== null}
                  />
                  <BindingRow
                    icon={<Sparkles className="size-3" />}
                    label="導演對話"
                    bound={p.directorSessionId !== null}
                  />
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "default"}
                    className="flex-1"
                    onClick={() => {
                      if (isActive) {
                        world.setCurrentProjectId(null);
                      } else {
                        world.setCurrentProjectId(p.id);
                        toast.success(`已切換到「${p.title}」`);
                      }
                    }}
                  >
                    {isActive ? "停用" : "啟用為當前"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    asChild
                    className="text-muted-foreground"
                  >
                    <Link href={`/creative-projects/${p.id}`}>編輯</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteId(p.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={input => createMutation.mutate(input)}
        submitting={createMutation.isPending}
      />

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除創作專案？</AlertDialogTitle>
            <AlertDialogDescription>
              這只會解除 Director 對話 / 世界觀 / 分鏡板的綁定，
              這些資源本身不會被刪除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BindingRow({
  icon,
  label,
  bound,
}: {
  icon: React.ReactNode;
  label: string;
  bound: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className={bound ? "text-foreground" : "italic"}>
        {bound ? "已綁定" : "未綁定"}
      </span>
    </div>
  );
}

interface CreateInput {
  title: string;
  description?: string;
  status?: ProjectStatus;
  worldFrameworkId?: number | null;
  worldStoryboardId?: number | null;
}

function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateInput) => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("concept");
  const [worldFrameworkId, setWorldFrameworkId] = useState<string>("__none__");
  const [worldStoryboardId, setWorldStoryboardId] = useState<string>("__none__");

  const worldsQuery = trpc.worldbuilding.list.useQuery(undefined, {
    enabled: open,
    staleTime: 30_000,
  });
  const storyboardsQuery = trpc.worldStoryboard.list.useQuery(undefined, {
    enabled: open,
    staleTime: 30_000,
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("請輸入專案名稱");
      return;
    }
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      worldFrameworkId:
        worldFrameworkId === "__none__"
          ? null
          : Number.parseInt(worldFrameworkId, 10),
      worldStoryboardId:
        worldStoryboardId === "__none__"
          ? null
          : Number.parseInt(worldStoryboardId, 10),
    });
  };

  // Reset form when dialog closes
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTitle("");
      setDescription("");
      setStatus("concept");
      setWorldFrameworkId("__none__");
      setWorldStoryboardId("__none__");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>建立創作專案</DialogTitle>
          <DialogDescription>
            專案會把世界觀框架、分鏡板綁在一起，
            之後在 Studio 頁面就會自動帶入這個專案的設定。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-title">專案名稱</Label>
            <Input
              id="cp-title"
              placeholder="例如：魔法少女傳說 S1"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-desc">簡介（可選）</Label>
            <Textarea
              id="cp-desc"
              placeholder="這個專案的目標、風格、預計輸出格式…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={10_000}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>狀態</Label>
            <Select value={status} onValueChange={v => setStatus(v as ProjectStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>世界觀框架（可選）</Label>
            <Select
              value={worldFrameworkId}
              onValueChange={setWorldFrameworkId}
            >
              <SelectTrigger>
                <SelectValue placeholder="未綁定" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未綁定</SelectItem>
                {(worldsQuery.data ?? []).map(w => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>分鏡板（可選）</Label>
            <Select
              value={worldStoryboardId}
              onValueChange={setWorldStoryboardId}
            >
              <SelectTrigger>
                <SelectValue placeholder="未綁定" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未綁定</SelectItem>
                {(storyboardsQuery.data ?? []).map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !title.trim()}>
            {submitting ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Plus className="mr-1 size-4" />
            )}
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
