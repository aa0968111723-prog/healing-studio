/* AI Director · 團隊協作視覺 — 小元件（U-13 / AIDV-116）
 * ----------------------------------------------------------------------------
 * Avatar（頭像＋線上點）／RoleTag（角色 Pill）／ShareScopeBadge（共享範圍指示）／
 * MemberRow（成員列）。全部重用 design-kit primitives/atoms，綁 .aidv-kit token，
 * 不寫死 hex。a11y：lucide-react SVG、icon-only aria-label、對比 ≥4.5。
 *  · 純呈現、唯讀消費 props（真實 RBAC＝AIDV-121，不在本卡）。
 * rev. U-13 · 2026-06-17 */
import * as React from "react";
import { Lock, Users, Building2, Globe } from "lucide-react";
import { cn } from "../design-kit/tokens";
import { Pill, Dot } from "../design-kit/atoms";
import {
  ROLE_META,
  SCOPE_META,
  type TeamMember,
  type TeamRole,
  type ShareScope,
} from "./teamsTypes";

/* ──────────────────────────────────────────────────────────────
 * Avatar —— 頭像（有圖用圖、無圖用姓名首字 initials），可選線上指示點。
 * a11y：img 帶 alt；initials 容器帶 aria-label（朗讀成員名）。
 * ────────────────────────────────────────────────────────────── */
const AV_SIZE = { sm: "size-7 text-[11px]", md: "size-9 text-[13px]", lg: "size-11 text-[15px]" } as const;

function initialsOf(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  // 中文取末字、拉丁取首字母（最多兩字）。
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return /[A-Za-z]/.test(t[0]) ? t.slice(0, 2).toUpperCase() : t.slice(-1);
}

export function Avatar({
  name,
  avatarUrl,
  size = "md",
  online,
  className,
}: {
  name: string;
  avatarUrl?: string;
  size?: keyof typeof AV_SIZE;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex flex-none", className)}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className={cn(
            "rounded-full object-cover border border-[var(--line)] bg-[var(--surface-2)]",
            AV_SIZE[size],
          )}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={cn(
            "inline-flex items-center justify-center rounded-full font-semibold",
            "border border-[var(--line)] bg-[var(--surface-2)] text-[var(--clay)]",
            AV_SIZE[size],
          )}
        >
          {initialsOf(name)}
        </span>
      )}
      {online !== undefined && (
        <span className="absolute -bottom-px -right-px rounded-full bg-[var(--surface)] p-[1.5px]">
          <Dot tone={online ? "ok" : "mute"} size="sm" label={online ? "在線" : "離線"} />
        </span>
      )}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
 * RoleTag —— 角色標籤（重用 Pill；語氣由 ROLE_META 映射）。
 * ────────────────────────────────────────────────────────────── */
export function RoleTag({ role }: { role: TeamRole }) {
  const meta = ROLE_META[role];
  return (
    <Pill kind={meta.tone} dot>
      {meta.label}
    </Pill>
  );
}

/* ──────────────────────────────────────────────────────────────
 * ShareScopeBadge —— 共享範圍指示（lucide 圖示＋語氣 Pill）。
 * a11y：圖示 aria-hidden（語意由文字承載）；hint 走 title。
 * ────────────────────────────────────────────────────────────── */
const SCOPE_ICON: Record<ShareScope, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  private: Lock,
  team: Users,
  org: Building2,
  public: Globe,
};

export function ShareScopeBadge({ scope, className }: { scope: ShareScope; className?: string }) {
  const meta = SCOPE_META[scope];
  const Icon = SCOPE_ICON[scope];
  return (
    <span className={cn("inline-flex", className)} title={meta.hint}>
      <Pill kind={meta.tone}>
        <Icon className="size-3" aria-hidden />
        {meta.label}
      </Pill>
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
 * MemberRow —— 成員列（頭像＋姓名＋角色 Pill）。
 * 語意：<li>，由 MemberList 的 <ul> 承載。
 * ────────────────────────────────────────────────────────────── */
export function MemberRow({ member }: { member: TeamMember }) {
  return (
    <li className="flex items-center gap-3 rounded-[12px] px-2 py-[6px] hover:bg-[var(--surface-2)] transition-colors duration-200">
      <Avatar name={member.name} avatarUrl={member.avatarUrl} online={member.online} size="md" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">
        {member.name}
      </span>
      <RoleTag role={member.role} />
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────
 * MemberList —— 成員列容器（<ul>，可選標題）。
 * ────────────────────────────────────────────────────────────── */
export function MemberList({
  members,
  label = "團隊成員",
  className,
}: {
  members: TeamMember[];
  label?: string;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cn("flex flex-col gap-px", className)}>
      {members.map((m) => (
        <MemberRow key={m.id} member={m} />
      ))}
    </ul>
  );
}
