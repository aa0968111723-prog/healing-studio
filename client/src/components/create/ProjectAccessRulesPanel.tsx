/**
 * ProjectAccessRulesPanel — M4 資料來源存取規則（最小編輯器）
 * ────────────────────────────────────────────────────────────────────────────
 * 團隊 owner / admin 可設定此專案的「團隊預設存取層級」與既有規則的層級；一般成員
 * 唯讀。寫入由後端再次強制權限（非管理員會被擋）。allowedModes 第一版送 null（全部
 * mode），細緻 mode 控制留待後續。
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck } from "lucide-react";
import { accessLevelLabel } from "./teamDataFormat";

const ACCESS_LEVELS = ["none", "summary_only", "chunk_access", "full_reference"] as const;

export function ProjectAccessRulesPanel({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const teamsQuery = trpc.teams.list.useQuery(undefined, { retry: false });
  const teams = teamsQuery.data ?? [];

  const [teamId, setTeamId] = useState<number | null>(null);
  const effectiveTeamId = teamId ?? teams[0]?.id ?? null;
  const currentTeam = useMemo(
    () => teams.find(t => t.id === effectiveTeamId) ?? null,
    [teams, effectiveTeamId]
  );
  const canEdit = currentTeam?.role === "owner" || currentTeam?.role === "admin";

  const rulesQuery = trpc.teamData.listProjectAccessRules.useQuery(
    { teamId: effectiveTeamId!, projectId },
    { enabled: effectiveTeamId != null, retry: false }
  );
  const rules = rulesQuery.data ?? [];
  const teamDefault = rules.find(r => r.materialId == null && r.projectId === projectId);

  const setRules = trpc.teamData.setProjectAccessRules.useMutation({
    onSuccess: () => {
      toast.success("已更新資料存取規則");
      if (effectiveTeamId != null)
        utils.teamData.listProjectAccessRules.invalidate({ teamId: effectiveTeamId, projectId });
    },
    onError: e => toast.error(e.message || "更新規則失敗（需團隊 owner / admin）"),
  });

  if (teams.length === 0) return null;

  const save = (materialId: number | null, accessLevel: string) => {
    if (effectiveTeamId == null) return;
    setRules.mutate({
      teamId: effectiveTeamId,
      projectId,
      rules: [
        {
          materialId,
          accessLevel: accessLevel as (typeof ACCESS_LEVELS)[number],
          allowedModes: null,
        },
      ],
    });
  };

  return (
    <div className="mt-3 space-y-2 border-t pt-2">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        資料存取規則
        {!canEdit ? <span className="text-[11px]">（唯讀；需 owner / admin 才能編輯）</span> : null}
      </div>

      {teams.length > 1 ? (
        <Select
          value={effectiveTeamId != null ? String(effectiveTeamId) : undefined}
          onValueChange={v => setTeamId(Number(v))}
        >
          <SelectTrigger className="h-7 w-full text-[12px]">
            <SelectValue placeholder="選擇團隊" />
          </SelectTrigger>
          <SelectContent>
            {teams.map(t => (
              <SelectItem key={t.id} value={String(t.id)} className="text-[12px]">
                {t.name}（{t.role}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[12px]">團隊預設層級</span>
        <Select
          value={teamDefault?.accessLevel ?? "summary_only"}
          onValueChange={v => save(null, v)}
          disabled={!canEdit || setRules.isPending}
        >
          <SelectTrigger className="h-7 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCESS_LEVELS.map(l => (
              <SelectItem key={l} value={l} className="text-[12px]">
                {accessLevelLabel(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rules.filter(r => r.materialId != null).length > 0 ? (
        <ul className="space-y-1">
          {rules
            .filter(r => r.materialId != null)
            .map(r => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-[12px]" title={`素材 #${r.materialId}`}>
                  素材 #{r.materialId}
                </span>
                <Select
                  value={r.accessLevel}
                  onValueChange={v => save(r.materialId, v)}
                  disabled={!canEdit || setRules.isPending}
                >
                  <SelectTrigger className="h-7 flex-1 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCESS_LEVELS.map(l => (
                      <SelectItem key={l} value={l} className="text-[12px]">
                        {accessLevelLabel(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        預設規則套用於該團隊在此專案可見的素材；可用明確「不開放」排除特定素材。
      </p>
    </div>
  );
}
