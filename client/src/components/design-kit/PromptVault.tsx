/* AI Director · 共用模式「生成 → 存庫 → 重用」提示詞庫（跨 shell：/video + /social）
   ──────────────────────────────────────────────────────────────────────────
   Bruce 重點：提示詞庫必須「真實記錄」，非 mock。下方對回 GitNexus 校驗過的真實 procedure：
     · 存入提示詞庫   → promptLibrary.create            （prompt 全文 + params + assetId + tags + scope）
     · 風格組合存庫   → blockCombos.create / customBlocks.create
     · 產出素材寫回   → generate.recordGenResult → digital_asset_library（含 provider/modelId/seed/cost）
     · 個人收藏       → promptCollection.*
     · 瀏覽/搜尋素材  → assets.* / notesCurator.searchAssets / categorizeAsset / tagAssets
     · 再生成         → generate.estimateCost → submitStudioJob → jobStatus → recordGenResult
   ⚠ prompt↔asset 顯式關聯欄位若 prompt_library 尚無，暫存 params JSON 或後端加法式擴充；
     跨專案關聯待 project_asset_links（P4）。以 _GitNexus程式碼真實對照表.md 逐條核對（任務 #12）。
   ────────────────────────────────────────────────────────────────────────── */
import * as React from "react";
import { Button, Pill, Tag, Toggle, Spinner } from "./primitives";
import type { ProviderId } from "./tokens";

/* 一筆提示詞庫紀錄（對映 prompt_library row + 關聯 asset） */
export interface VaultEntry {
  id: string;
  prompt: string;                       // 全文 → prompt_library.content
  params: { model: string; seed?: number; size?: string; provider: ProviderId; cfg?: number };
  assetId?: string;                     // → digital_asset_library.id（產出素材）
  thumb?: React.CSSProperties;          // 縮圖樣式（demo）
  tags: string[];
  sourceWorkflow: "video" | "social";   // 來源工作流
  projectId?: string;
  uses: number;
  forkedFrom?: string;
  status?: "draft" | "saved";
}
export type SaveState = "idle" | "saving" | "saved" | "error" | "duplicate";

/* ============== 1) 存入 UX：生成結果旁的「存入提示詞庫」 ============== */
export function SaveToVault({
  state = "idle", autoDraft, onToggleAuto, onSave, onRetry,
}: {
  state?: SaveState; autoDraft?: boolean; onToggleAuto?: () => void;
  onSave?: () => void; onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap" aria-live="polite">
      {state === "idle" && <Button size="xs" onClick={onSave}>＋ 存入提示詞庫</Button>}
      {state === "saving" && <Button size="xs" disabled><span className="inline-block w-[12px] h-[12px] mr-1 rounded-full border-2 border-[var(--line)] border-t-[var(--clay)] animate-spin align-[-1px]" />存入中…</Button>}
      {state === "saved" && <Pill kind="ok" dot>已存入提示詞庫 · 可重用</Pill>}
      {state === "duplicate" && <Pill kind="warn" dot>已存在 · 已更新使用次數</Pill>}
      {state === "error" && (<><Pill kind="bad" dot>存入失敗</Pill><Button size="xs" onClick={onRetry}>重試</Button></>)}
      <label className="ml-auto flex items-center gap-[7px] text-[11px] text-[var(--text-mute)] cursor-pointer">
        <Toggle on={!!autoDraft} onClick={onToggleAuto} label="自動存草稿" />自動存草稿
      </label>
    </div>
  );
}

/* ============== 2) 重用 UX：素材創作步驟的「提示詞庫」瀏覽器 ============== */
type BrowseState = "empty" | "loading" | "error" | "ready";
export function VaultBrowser({
  state = "ready", entries = [], query, onQuery, onRegen, onInsert, onFork, onRetry,
}: {
  state?: BrowseState; entries?: VaultEntry[]; query?: string;
  onQuery?: (q: string) => void;
  onRegen?: (e: VaultEntry) => void; onInsert?: (e: VaultEntry) => void; onFork?: (e: VaultEntry) => void;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* 搜尋 / 篩選 */}
      <div className="flex items-center gap-2">
        <input value={query} onChange={e => onQuery?.(e.target.value)} placeholder="搜尋 prompt、模型、標籤…"
          className="flex-1 h-9 px-3 text-[13px] rounded-[12px] bg-[var(--wash)] border border-[var(--line)] outline-none focus:border-[var(--clay)] focus:shadow-[var(--ring-soft)]" />
        <Tag>我的詞庫</Tag><Tag>團隊共享</Tag><Tag>block 組合</Tag>
      </div>

      {state === "loading" && (
        <div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i =>
          <div key={i} className="h-[150px] rounded-[14px] bg-[linear-gradient(100deg,var(--surface-2)_30%,var(--wash)_50%,var(--surface-2)_70%)] bg-[length:200%_100%] animate-[sh_1.4s_infinite]" />)}
        </div>
      )}
      {state === "error" && (
        <div className="flex flex-col items-center text-center gap-3 py-12">
          <div className="w-[60px] h-[60px] rounded-[18px] grid place-items-center text-[26px] text-[var(--bad)] bg-[var(--bad-tint)] border border-[rgba(199,73,58,.32)]">!</div>
          <div className="font-serif text-[16px] font-semibold">提示詞庫載入失敗</div>
          <p className="text-[var(--text-mute)] text-[13px]">tRPC <code>promptLibrary.list</code> 連線中斷</p>
          <Button onClick={onRetry}>重試</Button>
        </div>
      )}
      {state === "empty" && (
        <div className="flex flex-col items-center text-center gap-3 py-12">
          <div className="w-[64px] h-[64px] rounded-[20px] grid place-items-center text-[28px] bg-[linear-gradient(160deg,var(--surface-2),var(--surface-3))] border border-[var(--line)]">📚</div>
          <div className="font-serif text-[17px] font-semibold">還沒有存過提示詞</div>
          <p className="text-[var(--text-mute)] text-[13px] max-w-[420px]">生成素材後，按結果旁的「＋ 存入提示詞庫」，之後即可在這裡瀏覽、再生成、或複製編輯。</p>
        </div>
      )}
      {state === "ready" && (
        <div className="grid grid-cols-2 gap-3">
          {entries.map(e => <PromptCard key={e.id} e={e} onRegen={onRegen} onInsert={onInsert} onFork={onFork} />)}
        </div>
      )}
    </div>
  );
}

function PromptCard({ e, onRegen, onInsert, onFork }: {
  e: VaultEntry; onRegen?: (e: VaultEntry) => void; onInsert?: (e: VaultEntry) => void; onFork?: (e: VaultEntry) => void;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] overflow-hidden shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)] hover:border-[var(--clay-soft)] transition-all duration-200">
      <div className="aspect-[16/10]" style={e.thumb ?? { background: "var(--surface-2)" }} />
      <div className="p-[11px]">
        <div className="text-[12.5px] leading-[1.5] line-clamp-2">{e.prompt}</div>
        <div className="mt-2 flex items-center gap-[6px] flex-wrap font-mono text-[9.5px] text-[var(--muted-2)]">
          <span>{e.params.model}</span>·<span>seed {e.params.seed}</span>·<span className="uppercase text-[var(--clay-deep)]">{e.params.provider}</span>·<span>×{e.uses}</span>
          {e.status === "draft" && <Pill kind="mute">草稿</Pill>}
        </div>
        <div className="mt-[9px] flex items-center gap-[5px] flex-wrap">
          <Button size="xs" variant="primary" onClick={() => onRegen?.(e)}>再生成</Button>
          <Button size="xs" onClick={() => onInsert?.(e)}>插入素材</Button>
          <Button size="xs" variant="ghost" onClick={() => onFork?.(e)}>複製並編輯</Button>
        </div>
      </div>
    </div>
  );
}
