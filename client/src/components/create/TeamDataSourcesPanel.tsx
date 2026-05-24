/**
 * TeamDataSourcesPanel — M4/M5 團隊資料 + 外部來源（/create 區塊）
 * ────────────────────────────────────────────────────────────────────────────
 * - 「整理資料來源」按鈕：on-demand 編譯 context packet（不在頁面載入時自動跑，
 *   避免意外計算成本），顯示摘要與「本次用到的資料來源」。
 * - 外部來源連接：連接 / 健檢 / 啟停使用者自己的 Google Drive、Notion（read-only）。
 *
 * 安全：憑證只送後端（後端加密），前端不顯示也不保存 token。
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Cloud,
  FileText,
  RefreshCw,
  Plus,
  Loader2,
  Power,
  Link2,
} from "lucide-react";
import {
  accessLevelLabel,
  dataSourceKindLabel,
  matchedByLabel,
  connectionStatusLabel,
  providerLabel,
} from "./teamDataFormat";

export function TeamDataSourcesPanel({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const latestQuery = trpc.contextPacket.getLatest.useQuery(
    { projectId },
    { retry: false, staleTime: 5_000 }
  );
  const packet = latestQuery.data ?? null;

  const compile = trpc.contextPacket.compileProject.useMutation({
    onSuccess: () => {
      toast.success("已整理可用資料來源");
      utils.contextPacket.getLatest.invalidate({ projectId });
      utils.creativeProject.getContextSummary.invalidate();
    },
    onError: e => toast.error(e.message || "整理資料來源失敗"),
  });

  return (
    <section className="rounded-lg border bg-card/40 p-3 text-sm" data-testid="team-data-sources-panel">
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Database className="size-3.5" />
          團隊資料 / 資料來源
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-[12px]"
          disabled={compile.isPending}
          onClick={() => compile.mutate({ projectId, mode: "create" })}
        >
          {compile.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          整理資料來源
        </Button>
      </header>

      {packet ? (
        <div className="space-y-2">
          {packet.summaryMarkdown ? (
            <p className="whitespace-pre-wrap text-[13px] text-foreground/90">
              {packet.summaryMarkdown}
            </p>
          ) : null}
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">本次用到的資料來源</p>
            {packet.sourceRefs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {packet.sourceRefs.map((ref, i) => (
                  <Badge
                    key={`${ref.kind}-${ref.refId}-${i}`}
                    variant="outline"
                    className="max-w-[220px] truncate text-[11px] font-normal"
                    title={ref.snippet ?? ref.title}
                  >
                    {dataSourceKindLabel(ref.kind)}・{ref.title}・{accessLevelLabel(ref.accessLevel)}
                    {ref.matchedBy ? `・${matchedByLabel(ref.matchedBy)}` : ""}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-[12px] italic text-muted-foreground">
                沒有符合的資料來源。可上傳團隊資料或在下方連接外部來源。
              </span>
            )}
          </div>
          {!packet.reused ? null : (
            <p className="text-[11px] text-muted-foreground">（使用快取結果，可再次整理以更新）</p>
          )}
        </div>
      ) : (
        <p className="text-[12px] italic text-muted-foreground">
          尚未整理。點「整理資料來源」會依此專案彙整可用的團隊資料與已連接的外部來源。
        </p>
      )}

      <DataConnectionsSection projectId={projectId} />
    </section>
  );
}

function DataConnectionsSection({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const listQuery = trpc.dataConnections.list.useQuery(
    { projectId },
    { retry: false, enabled: open }
  );
  const connections = listQuery.data ?? [];

  const invalidate = () => utils.dataConnections.list.invalidate({ projectId });

  const create = trpc.dataConnections.create.useMutation({
    onSuccess: () => {
      toast.success("已新增資料來源，請點「驗證」完成連接");
      invalidate();
    },
    onError: e => toast.error(e.message || "新增連接失敗"),
  });
  const test = trpc.dataConnections.test.useMutation({
    onSuccess: c => {
      toast[c?.status === "active" ? "success" : "error"](
        c?.status === "active" ? "連接正常" : "連接無法使用，請檢查授權 / token"
      );
      invalidate();
    },
    onError: e => toast.error(e.message || "驗證失敗"),
  });
  const setStatus = trpc.dataConnections.setStatus.useMutation({
    onSuccess: () => invalidate(),
    onError: e => toast.error(e.message || "更新狀態失敗"),
  });

  const [notionToken, setNotionToken] = useState("");
  const [driveFolders, setDriveFolders] = useState("");

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(o => !o)}
      >
        <Link2 className="size-3.5" />
        外部資料來源（Google Drive / Notion）{open ? "▴" : "▾"}
      </button>

      {open ? (
        <div className="mt-2 space-y-3">
          {connections.length > 0 ? (
            <ul className="space-y-1.5">
              {connections.map(c => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded border bg-background/60 px-2 py-1.5"
                >
                  {c.kind === "cloud" ? (
                    <Cloud className="size-3.5 text-muted-foreground" />
                  ) : (
                    <FileText className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="text-[13px]">{providerLabel(c.provider)}</span>
                  <Badge
                    variant={c.status === "active" ? "default" : "outline"}
                    className="text-[10px] font-normal"
                  >
                    {connectionStatusLabel(c.status)}
                  </Badge>
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={test.isPending}
                      onClick={() => test.mutate({ id: c.id })}
                    >
                      驗證
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[11px]"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          id: c.id,
                          status: c.status === "disabled" ? "active" : "disabled",
                        })
                      }
                    >
                      <Power className="size-3" />
                      {c.status === "disabled" ? "啟用" : "停用"}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] italic text-muted-foreground">
              尚未連接外部來源。
            </p>
          )}

          <div className="space-y-2 rounded border border-dashed p-2">
            <p className="text-[11px] font-medium text-muted-foreground">新增 Notion</p>
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={notionToken}
                onChange={e => setNotionToken(e.target.value)}
                placeholder="Notion Integration Token（secret_…）"
                className="h-7 text-[12px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[12px]"
                disabled={create.isPending || notionToken.trim().length === 0}
                onClick={() =>
                  create.mutate(
                    {
                      kind: "notes",
                      provider: "notion",
                      projectId,
                      credential: notionToken.trim(),
                    },
                    { onSuccess: () => setNotionToken("") }
                  )
                }
              >
                <Plus className="size-3" />
                連接
              </Button>
            </div>

            <p className="pt-1 text-[11px] font-medium text-muted-foreground">新增 Google Drive 資料夾</p>
            <div className="flex gap-1.5">
              <Input
                value={driveFolders}
                onChange={e => setDriveFolders(e.target.value)}
                placeholder="Drive 資料夾 ID（多個用逗號分隔）"
                className="h-7 text-[12px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[12px]"
                disabled={create.isPending || driveFolders.trim().length === 0}
                onClick={() =>
                  create.mutate(
                    {
                      kind: "cloud",
                      provider: "google_drive",
                      projectId,
                      config: {
                        folderIds: driveFolders
                          .split(/[,\s]+/)
                          .map(s => s.trim())
                          .filter(Boolean),
                      },
                    },
                    { onSuccess: () => setDriveFolders("") }
                  )
                }
              >
                <Plus className="size-3" />
                連接
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Drive 需先在「資產庫」完成 Google 授權；憑證只保存在後端，不會顯示於前端。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
