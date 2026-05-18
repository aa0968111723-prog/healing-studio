/**
 * TeamsPage.tsx — 多人協作的團隊管理頁
 *
 * 給資料庫 team_shared 視野背後的角色關係做 UI：建立團隊、邀請成員、
 * 管理角色、退出 / 解散團隊。
 *
 * 邀請流程刻意簡化：直接輸入「workspace 內」其他使用者的 userId 即可。
 * 後續做 email invite 再加 pending_invitations。
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { shortErrorMsg } from "@/lib/upload";
import { toast } from "sonner";
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
  Users,
  Plus,
  Crown,
  Shield,
  UserPlus,
  UserMinus,
  LogOut,
  Trash2,
  Loader2,
} from "lucide-react";

export default function TeamsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const listQuery = trpc.teams.list.useQuery(undefined, { staleTime: 5_000 });
  const teams = listQuery.data ?? [];

  return (
    <div className="page-shell space-y-6">
      <header className="page-header flex items-center justify-between">
        <div>
          <p className="page-eyebrow">Teams</p>
          <h1 className="page-title flex items-center gap-2">
            <Users className="w-6 h-6" />
            團隊管理
          </h1>
          <p className="page-subtitle">
            建立團隊把成員加進來，就可以共享資料庫裡的 team_shared 素材。
            owner 與 admin 可以管理成員；member 可以讀寫團隊的素材。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          建立團隊
        </Button>
      </header>

      {listQuery.isLoading ? (
        <div className="text-muted-foreground py-12 text-center">載入中…</div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>還沒加入任何團隊。建立一個或請其他 owner 把你邀請進來。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teams.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedTeamId(t.id)}
              className="text-left rounded-xl border bg-card hover:shadow-md transition p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{t.name}</h3>
                  {t.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {t.description}
                    </p>
                  )}
                </div>
                <RoleBadge role={t.role} />
              </div>
              <div className="text-xs text-muted-foreground">
                建立於 {new Date(t.createdAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => listQuery.refetch()}
      />

      {selectedTeamId !== null && (
        <TeamDetailDialog
          teamId={selectedTeamId}
          onClose={() => setSelectedTeamId(null)}
          onMutated={() => listQuery.refetch()}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  if (role === "owner") {
    return (
      <Badge className="gap-1">
        <Crown className="w-3 h-3" />
        Owner
      </Badge>
    );
  }
  if (role === "admin") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Shield className="w-3 h-3" />
        Admin
      </Badge>
    );
  }
  return <Badge variant="outline">Member</Badge>;
}

function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createMut = trpc.teams.create.useMutation();

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("請輸入團隊名稱");
      return;
    }
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.success("團隊已建立");
      onCreated();
      setName("");
      setDescription("");
      onOpenChange(false);
    } catch (err) {
      toast.error(shortErrorMsg(err, 120));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>建立新團隊</DialogTitle>
          <DialogDescription>
            建立者自動成為 owner，可以邀請其他人加入並共享資料。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="team-name">團隊名稱</Label>
            <Input
              id="team-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：行銷團隊"
            />
          </div>
          <div>
            <Label htmlFor="team-desc">描述（選填）</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="這個團隊負責什麼、由哪些人組成"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMut.isPending}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending}>
            {createMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                建立中…
              </>
            ) : (
              "建立"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamDetailDialog({
  teamId,
  onClose,
  onMutated,
}: {
  teamId: number;
  onClose: () => void;
  onMutated: () => void;
}) {
  const teamQuery = trpc.teams.get.useQuery({ id: teamId });
  const membersQuery = trpc.teams.members.useQuery({ id: teamId });
  // 透過 teams.list 取自己在此團隊的角色（避免另外開 me endpoint）
  const myTeamsList = trpc.teams.list.useQuery();
  const [confirmingAction, setConfirmingAction] = useState<
    null | { kind: "remove" | "leave" | "delete"; userId?: number; userName?: string }
  >(null);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "member">("member");

  const addMut = trpc.teams.addMember.useMutation();
  const removeMut = trpc.teams.removeMember.useMutation();
  const leaveMut = trpc.teams.leave.useMutation();
  const deleteMut = trpc.teams.delete.useMutation();

  const team = teamQuery.data;
  const members = membersQuery.data ?? [];
  const myRole =
    myTeamsList.data?.find(t => t.id === teamId)?.role ?? "member";

  if (!team) return null;

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  async function handleAdd() {
    const uid = parseInt(addUserId, 10);
    if (!Number.isFinite(uid) || uid <= 0) {
      toast.error("請輸入有效的 userId");
      return;
    }
    try {
      await addMut.mutateAsync({ teamId, userId: uid, role: addRole });
      toast.success("已加入");
      setAddUserId("");
      membersQuery.refetch();
      onMutated();
    } catch (err) {
      toast.error(shortErrorMsg(err, 120));
    }
  }

  async function handleConfirmedAction() {
    if (!confirmingAction) return;
    try {
      if (confirmingAction.kind === "remove" && confirmingAction.userId) {
        await removeMut.mutateAsync({ teamId, userId: confirmingAction.userId });
        toast.success("已移除");
        membersQuery.refetch();
      } else if (confirmingAction.kind === "leave") {
        await leaveMut.mutateAsync({ teamId });
        toast.success("已離開團隊");
        onMutated();
        onClose();
      } else if (confirmingAction.kind === "delete") {
        await deleteMut.mutateAsync({ teamId });
        toast.success("團隊已解散");
        onMutated();
        onClose();
      }
    } catch (err) {
      toast.error(shortErrorMsg(err, 120));
    } finally {
      setConfirmingAction(null);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              {team.name}
              <RoleBadge role={myRole} />
            </DialogTitle>
            {team.description && (
              <DialogDescription>{team.description}</DialogDescription>
            )}
          </DialogHeader>

          <section className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              成員（{members.length}）
            </h4>
            <ul className="space-y-2">
              {members.map(m => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border p-2"
                >
                  {m.user?.avatarUrl ? (
                    <img
                      src={m.user.avatarUrl}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">
                      {(m.user?.name ?? "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {m.user?.name ?? `使用者 #${m.userId}`}
                    </div>
                    {m.user?.email && (
                      <div className="text-xs text-muted-foreground truncate">
                        {m.user.email}
                      </div>
                    )}
                  </div>
                  <RoleBadge role={m.role} />
                  {canManage && m.role !== "owner" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setConfirmingAction({
                          kind: "remove",
                          userId: m.userId,
                          userName: m.user?.name ?? `#${m.userId}`,
                        })
                      }
                    >
                      <UserMinus className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {canManage && (
            <section className="space-y-2 border-t pt-4">
              <h4 className="text-sm font-medium text-muted-foreground">
                <UserPlus className="w-4 h-4 inline mr-1" />
                加入新成員
              </h4>
              <div className="flex gap-2">
                <Input
                  value={addUserId}
                  onChange={e => setAddUserId(e.target.value)}
                  placeholder="userId（同 workspace 內）"
                  type="number"
                  min={1}
                />
                <Select
                  value={addRole}
                  onValueChange={v => setAddRole(v as "admin" | "member")}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleAdd} disabled={addMut.isPending}>
                  加入
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Phase 2 簡化版：直接以 userId 加成員，未來會加 email 邀請流程。
              </p>
            </section>
          )}

          <DialogFooter className="border-t pt-4">
            {!isOwner && (
              <Button
                variant="outline"
                onClick={() => setConfirmingAction({ kind: "leave" })}
              >
                <LogOut className="w-4 h-4 mr-1" />
                離開團隊
              </Button>
            )}
            {isOwner && (
              <Button
                variant="destructive"
                onClick={() => setConfirmingAction({ kind: "delete" })}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                解散團隊
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmingAction !== null}
        onOpenChange={v => !v && setConfirmingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmingAction?.kind === "remove" &&
                `確定要移除「${confirmingAction.userName}」？`}
              {confirmingAction?.kind === "leave" && "確定要離開此團隊？"}
              {confirmingAction?.kind === "delete" && "確定要解散此團隊？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingAction?.kind === "remove" &&
                "對方將失去團隊共享素材的存取權；他自己上傳的素材會留下，但需要他重新切回個人池。"}
              {confirmingAction?.kind === "leave" &&
                "你會立刻看不到團隊共享的素材；自己上傳的會繼續留在個人池。"}
              {confirmingAction?.kind === "delete" &&
                "團隊將被刪除，所有成員會被踢出。團隊內的素材會自動退回上傳者的個人池（visibility 改回 private）。此操作不可復原。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedAction}>
              確定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
