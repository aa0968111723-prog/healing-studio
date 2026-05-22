/**
 * CollaborativeDiscussionLauncher.tsx — 多代理「自動討論」面板。
 *
 * 取代 AgentChat 上原本那顆「🌿 讓 2-4 位精靈一起討論這個」單一按鈕，把
 * 設定（最多回合數、家族 / 個別精靈白名單、起跑那位、額外 mute）攤開成
 * 一個摺疊面板。使用者可以決定「這場討論誰能進來」再按下啟動。
 *
 * 進行中時：
 *   - 主按鈕變成「停止這場討論」（呼叫 cancelCollaborativeDiscussion）
 *   - 顯示「進度條」摘要（第一棒 / maxRounds / 套用的 scope）
 *
 * 沒在跑時：
 *   - 摺疊收起時只露一條 chip（節省 vertical space）
 *   - 展開後三段：① 規模（slider for maxRounds）② 家族勾選 ③ 個別精靈
 *
 * 這支只負責「召集」階段；真正的精靈訊息透過 GlobalOrbChatContext 的
 * polling effect 進到 chat bubble，本元件不渲染對話內容。
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { CollaborativeProgressPanel } from "./CollaborativeProgressPanel";

import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import {
  SPIRITS,
  SPIRIT_FAMILIES,
  SPIRIT_FAMILY_LABEL,
  getSpiritsByFamily,
  type SpiritFamily,
} from "@/lib/spiritsVisual";
import type {
  CollaborativeDiscussionFamily,
  CollaborativeDiscussionOptions,
} from "@/contexts/GlobalOrbChatContext";

interface CollaborativeDiscussionLauncherProps {
  /** 取得當前輸入框的文字 — 由父元件提供 (通常就是 AgentChat 的 input)。 */
  getPromptText: () => string;
  /** 啟動成功後可選清空輸入框 (callback)。 */
  onAfterLaunch?: () => void;
  /** 父元件「主送出」是否在 busy；用來鎖住啟動鈕避免重複觸發。 */
  parentBusy?: boolean;
}

const FAMILY_BG: Record<SpiritFamily, string> = {
  role: "bg-amber-50/80 dark:bg-amber-900/15 border-amber-200/70 dark:border-amber-800/40",
  specialist: "bg-rose-50/80 dark:bg-rose-900/15 border-rose-200/70 dark:border-rose-800/40",
  proactive: "bg-violet-50/80 dark:bg-violet-900/15 border-violet-200/70 dark:border-violet-800/40",
};

export function CollaborativeDiscussionLauncher({
  getPromptText,
  onAfterLaunch,
  parentBusy,
}: CollaborativeDiscussionLauncherProps) {
  const {
    startCollaborativeDiscussion,
    cancelCollaborativeDiscussion,
    isCollaborativeDiscussionActive,
    collaborativeDiscussionMeta,
  } = useGlobalOrbChat();

  // 摺疊狀態 — 預設收起，避免一進場就佔走 composer 上方半個畫面。
  const [expanded, setExpanded] = useState(false);
  // 設定狀態。allowedFamilies / allowedRoles 都空 = 不限制（沿用 protocol）。
  const [maxRounds, setMaxRounds] = useState<number>(3);
  const [allowedFamilies, setAllowedFamilies] = useState<CollaborativeDiscussionFamily[]>([]);
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [extraMutedRoles, setExtraMutedRoles] = useState<string[]>([]);
  const [initialAgent, setInitialAgent] = useState<string>("");
  const [launching, setLaunching] = useState(false);

  // 算出「實際可參與的精靈集合」— 顯示在底部 hint，讓使用者按下啟動前
  // 就知道「會找誰」。allowedFamilies 跟 allowedRoles 都空 = 全部 15 位。
  const effectiveRoster = useMemo(() => {
    const familyFiltered =
      allowedFamilies.length > 0
        ? SPIRITS.filter(s => allowedFamilies.includes(s.family))
        : SPIRITS;
    const roleFiltered =
      allowedRoles.length > 0
        ? familyFiltered.filter(s => allowedRoles.includes(s.id))
        : familyFiltered;
    return roleFiltered.filter(s => !extraMutedRoles.includes(s.id));
  }, [allowedFamilies, allowedRoles, extraMutedRoles]);

  function toggleFamily(family: CollaborativeDiscussionFamily) {
    setAllowedFamilies(prev =>
      prev.includes(family) ? prev.filter(f => f !== family) : [...prev, family],
    );
    // 切家族時，把不在新家族裡的個別 allowedRoles 清掉，避免「勾了個別精靈
    // 但他被家族篩掉變成空集合」的悶狀況。
    setAllowedRoles(prev => {
      if (prev.length === 0) return prev;
      const willInclude = allowedFamilies.includes(family)
        ? allowedFamilies.filter(f => f !== family)
        : [...allowedFamilies, family];
      if (willInclude.length === 0) return prev;
      return prev.filter(r => {
        const spirit = SPIRITS.find(s => s.id === r);
        return spirit ? willInclude.includes(spirit.family) : false;
      });
    });
  }

  function toggleRole(roleId: string) {
    setAllowedRoles(prev =>
      prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId],
    );
    // 勾個別精靈時，順手把他從 mute list 拿掉（兩者矛盾就以勾選為主）。
    setExtraMutedRoles(prev => prev.filter(r => r !== roleId));
  }

  function toggleMute(roleId: string) {
    setExtraMutedRoles(prev =>
      prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId],
    );
    setAllowedRoles(prev => prev.filter(r => r !== roleId));
  }

  function resetScope() {
    setAllowedFamilies([]);
    setAllowedRoles([]);
    setExtraMutedRoles([]);
    setInitialAgent("");
  }

  async function handleLaunch() {
    const text = getPromptText().trim();
    if (!text) return;
    setLaunching(true);
    const options: CollaborativeDiscussionOptions = {
      maxRounds,
      allowedFamilies: allowedFamilies.length > 0 ? allowedFamilies : undefined,
      allowedRoles: allowedRoles.length > 0 ? allowedRoles : undefined,
      extraMutedRoles: extraMutedRoles.length > 0 ? extraMutedRoles : undefined,
      initialAgent: initialAgent || undefined,
    };
    try {
      await startCollaborativeDiscussion(text, options);
      onAfterLaunch?.();
    } catch {
      // GlobalOrbChatContext 已經把錯誤訊息推進 chat bubble 了，這裡不再吐
    } finally {
      setLaunching(false);
    }
  }

  async function handleCancel() {
    await cancelCollaborativeDiscussion();
  }

  // ─── 進行中：顯示豐富的協作視覺化 panel ─────────────────────────────
  if (isCollaborativeDiscussionActive && collaborativeDiscussionMeta) {
    return (
      <CollaborativeProgressPanel
        meta={collaborativeDiscussionMeta}
        onCancel={() => void handleCancel()}
      />
    );
  }

  // ─── 收起時：只露單行 trigger（保留主按鈕仍可一鍵跑預設場） ──────────
  if (!expanded) {
    return (
      <div className="flex items-center justify-end gap-2 pt-1.5">
        <span className="mr-1 text-[10px] text-muted-foreground">範圍設定已移到「精靈小屋」</span>
        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={
            !getPromptText().trim() ||
            launching ||
            !!parentBusy
          }
          className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-200/70 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700/50 dark:text-emerald-300 dark:hover:bg-emerald-900/20 disabled:opacity-40 transition-colors"
          data-testid="orb-collab-discuss-btn"
        >
          {launching ? "🌿 召集中…" : "🌿 讓 2-5 位精靈一起討論這個"}
        </button>
      </div>
    );
  }

  // ─── 展開：完整設定面板 ───────────────────────────────────────────────
  return (
    <div
      className="rounded-xl border border-border/60 surface-2 px-3 py-3 mt-1.5 space-y-3 text-xs"
      data-testid="orb-collab-discuss-panel"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
        <span className="font-semibold text-foreground/90">
          多代理討論設定
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="ml-auto text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 inline-flex items-center gap-1"
        >
          收起 <ChevronUp className="w-3 h-3" />
        </button>
      </div>

      {/* 規模 */}
      <div>
        <label className="flex items-center gap-2 text-foreground/90 mb-1">
          <span>最多回合</span>
          <span className="ml-auto font-mono text-[11px] text-slate-500">
            {maxRounds} 棒
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={maxRounds}
          onChange={e => setMaxRounds(Number(e.target.value))}
          className="w-full accent-emerald-500"
          data-testid="orb-collab-max-rounds"
        />
        <p className="text-[11px] text-slate-500 mt-1">
          每棒一位精靈說一段；上限 5 棒，避免無止境繞圈。
        </p>
      </div>

      {/* 家族 */}
      <div>
        <div className="text-foreground/90 mb-1">
          參與家族（不勾 = 不限制）
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SPIRIT_FAMILIES.map(family => {
            const active = allowedFamilies.includes(family);
            return (
              <button
                key={family}
                type="button"
                onClick={() => toggleFamily(family)}
                className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                  active
                    ? `${FAMILY_BG[family]} text-foreground ring-1 ring-emerald-400/50`
                    : "border-slate-200/70 text-slate-600 hover:bg-slate-50 dark:border-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-800/40"
                }`}
              >
                {SPIRIT_FAMILY_LABEL[family]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 個別精靈 — 兩欄 grid */}
      <div>
        <div className="flex items-center text-foreground/90 mb-1">
          <span>個別精靈（不勾 = 沿用家族 / 預設）</span>
          <button
            type="button"
            onClick={resetScope}
            className="ml-auto text-[11px] text-slate-500 hover:text-emerald-600 underline"
          >
            清掉所有限制
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-1">
          {SPIRIT_FAMILIES.flatMap(getSpiritsByFamily).map(spirit => {
            const allowed = allowedRoles.includes(spirit.id);
            const muted = extraMutedRoles.includes(spirit.id);
            return (
              <div
                key={spirit.id}
                className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 border ${
                  allowed
                    ? "border-emerald-300/70 bg-emerald-50/70 dark:bg-emerald-900/20"
                    : muted
                      ? "border-rose-300/60 bg-rose-50/60 dark:bg-rose-900/20 opacity-70"
                      : "border-border/60"
                }`}
              >
                <span className="text-base leading-none">{spirit.emoji}</span>
                <span className="text-[11px] truncate text-foreground/90">
                  {spirit.nickname}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleRole(spirit.id)}
                    title={allowed ? "已加入白名單" : "加入白名單"}
                    className={`text-[10px] px-1 rounded ${
                      allowed
                        ? "bg-emerald-500 text-white"
                        : "bg-muted text-slate-500"
                    }`}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMute(spirit.id)}
                    title={muted ? "本次已 mute" : "本次 mute 這位"}
                    className={`text-[10px] px-1 rounded ${
                      muted
                        ? "bg-rose-500 text-white"
                        : "bg-muted text-slate-500"
                    }`}
                  >
                    −
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          + 加入白名單 / − 本次靜音。永久 mute 請去設定改。
        </p>
      </div>

      {/* 起跑那位（可選） */}
      <div>
        <label className="text-foreground/90 mb-1 block">
          起跑那位（不選 = 自動依需求挑）
        </label>
        <select
          value={initialAgent}
          onChange={e => setInitialAgent(e.target.value)}
          className="w-full px-2 py-1 rounded-lg border border-border/60 bg-card text-foreground/90 text-xs"
        >
          <option value="">自動挑 (selectRoleForIntent)</option>
          {SPIRITS.map(s => (
            <option key={s.id} value={s.id}>
              {s.emoji} {s.nickname}（{s.label}）
            </option>
          ))}
        </select>
      </div>

      {/* roster preview + launch */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/60">
        <div className="text-[11px] text-slate-500 truncate">
          將從 {effectiveRoster.length} 位中接力（{effectiveRoster
            .slice(0, 6)
            .map(s => s.emoji)
            .join("")}
          {effectiveRoster.length > 6 ? "…" : ""}）
        </div>
        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={
            !getPromptText().trim() ||
            launching ||
            !!parentBusy ||
            effectiveRoster.length === 0
          }
          className="ml-auto px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 text-white text-[11px] font-semibold shadow hover:shadow-md disabled:opacity-40 inline-flex items-center gap-1"
          data-testid="orb-collab-launch"
        >
          {launching ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> 召集中…
            </>
          ) : (
            <>🌿 啟動討論</>
          )}
        </button>
      </div>
    </div>
  );
}
