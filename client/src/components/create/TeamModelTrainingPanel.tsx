/**
 * TeamModelTrainingPanel — M 訓練 track（/create 區塊）
 * ────────────────────────────────────────────────────────────────────────────
 * 團隊 owner / admin 可用團隊 archive 中「存取層級＝完整引用」的圖片，發起 LoRA
 * 訓練，產出 team_shared 模型。一般成員看得到模型清單但不能發起。
 *
 * 治理：發起前必須勾選「已取得訓練資料使用授權」。後端再次強制權限與授權。
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GraduationCap, Loader2 } from "lucide-react";

const MODEL_STATUS_LABELS: Record<string, string> = {
  pending: "排隊中",
  training: "訓練中",
  ready: "可使用",
  failed: "失敗",
};

export function TeamModelTrainingPanel({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const teamsQuery = trpc.teams.list.useQuery(undefined, { retry: false });
  const teams = teamsQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState<number | null>(null);
  const effectiveTeamId = teamId ?? teams[0]?.id ?? null;
  const currentTeam = useMemo(
    () => teams.find(t => t.id === effectiveTeamId) ?? null,
    [teams, effectiveTeamId]
  );
  const canTrain = currentTeam?.role === "owner" || currentTeam?.role === "admin";

  const previewQuery = trpc.teamTraining.previewDataset.useQuery(
    { teamId: effectiveTeamId!, projectId },
    { enabled: open && effectiveTeamId != null, retry: false }
  );
  const modelsQuery = trpc.teamTraining.listModels.useQuery(
    { teamId: effectiveTeamId! },
    { enabled: open && effectiveTeamId != null, retry: false }
  );
  const preview = previewQuery.data;
  const models = modelsQuery.data ?? [];

  const [modelName, setModelName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [consent, setConsent] = useState(false);

  const start = trpc.teamTraining.startTraining.useMutation({
    onSuccess: r => {
      toast.success(`已開始訓練（${r?.imageCount ?? 0} 張圖片）`);
      setModelName("");
      setTriggerWord("");
      setConsent(false);
      if (effectiveTeamId != null) utils.teamTraining.listModels.invalidate({ teamId: effectiveTeamId });
    },
    onError: e => toast.error(e.message || "發起訓練失敗"),
  });

  if (teams.length === 0) return null;
  const enough = (preview?.count ?? 0) >= (preview?.minRequired ?? 4);

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(o => !o)}
      >
        <GraduationCap className="size-3.5" />
        團隊模型訓練（用團隊資料）{open ? "▴" : "▾"}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
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

          <p className="text-[12px] text-muted-foreground">
            可作訓練來源的圖片：
            <span className={enough ? "text-foreground" : "text-amber-600"}>
              {" "}
              {preview?.count ?? "…"} 張
            </span>
            （需至少 {preview?.minRequired ?? 4} 張，存取層級為「完整引用」）
          </p>

          {models.length > 0 ? (
            <ul className="space-y-1">
              {models.map(m => (
                <li key={m.id} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate" title={m.name}>
                    {m.name}
                  </span>
                  <span className="text-muted-foreground">
                    {MODEL_STATUS_LABELS[m.status] ?? m.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {canTrain ? (
            <div className="space-y-1.5 rounded border border-dashed p-2">
              <Input
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                placeholder="模型名稱（如：團隊風格 A）"
                className="h-7 text-[12px]"
              />
              <Input
                value={triggerWord}
                onChange={e => setTriggerWord(e.target.value)}
                placeholder="觸發詞（trigger word，如 teamstyle）"
                className="h-7 text-[12px]"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                />
                我已取得這些訓練資料的使用授權
              </label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full gap-1 text-[12px]"
                disabled={
                  start.isPending ||
                  !enough ||
                  !consent ||
                  modelName.trim().length === 0 ||
                  triggerWord.trim().length === 0 ||
                  effectiveTeamId == null
                }
                onClick={() =>
                  start.mutate({
                    teamId: effectiveTeamId!,
                    projectId,
                    modelName: modelName.trim(),
                    triggerWord: triggerWord.trim(),
                    modelType: "style_lora",
                    consentAcknowledged: consent,
                  })
                }
              >
                {start.isPending ? <Loader2 className="size-3 animate-spin" /> : <GraduationCap className="size-3" />}
                用團隊資料訓練
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">需團隊 owner / admin 才能發起訓練。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
