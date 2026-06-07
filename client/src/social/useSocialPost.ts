// ============================================================================
// social/useSocialPost.ts — 社群貼文草稿狀態（Tier-0：記憶體聚合，零新表）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §4.3（核准語意）/ §5.1（Tier-0）/ §5.5。
//
// 一篇貼文 = 文案 + 版型 + 品牌鎖 + 底圖資產 + 多尺寸變體 + 單張核准 + 排程。Tier-0 以
// 記憶體聚合（real → social_posts 表，Tier-1）。單張核准＝確認門等價物（§4.3）：
//   pending → generated（出圖後）→ approved | rejected。approved 才能匯出多尺寸/排程發佈。
//
// 不另建 active-project 狀態：projectId 由呼叫端（cockpit）從 useCreativeProject 帶入。
// ============================================================================
import { useCallback, useMemo, useState } from "react";
import type { GenKind } from "@/spine/types";

export type PostApproval = "pending" | "generated" | "approved" | "rejected";
export type AssetSource = "generated" | "uploaded" | "licensed";

export interface PostCopy {
  headline: string;
  subhead?: string;
  body?: string;
  hashtags: string[];
  cta?: string;
}

export interface PostExport {
  presetId: string;
  assetUrl: string;
  contentHash: string;
}

export interface SocialPostDraft {
  id: string;
  title: string;
  brief: string;
  templateId: string | null;
  brandLock: boolean;
  copy: PostCopy;
  /** 出圖結果（背景主視覺；composeLayout 疊字於其上）。 */
  background?: { assetUrl?: string; seed: number; provider: string; model: string; costUsd: number; kind: GenKind };
  /** 素材來源（發佈前確認，§4.3）。 */
  assetSource: AssetSource;
  sourceConfirmed: boolean;
  approval: PostApproval;
  /** 已匯出的多尺寸變體。 */
  exports: PostExport[];
  /** 排程時間（ISO；無＝未排）。 */
  scheduledAt?: string;
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

function emptyDraft(): SocialPostDraft {
  return {
    id: uid("post"),
    title: "未命名貼文",
    brief: "本週主題：放下。一句開示金句。",
    templateId: null,
    brandLock: true,
    copy: { headline: "放下，即是自在。", subhead: "本週開示", hashtags: ["#療癒誌", "#正念"], cta: "閱讀更多" },
    assetSource: "generated",
    sourceConfirmed: true, // generated 本站生成預設已確認；uploaded/licensed 需手動確認
    approval: "pending",
    exports: [],
  };
}

export interface UseSocialPostResult {
  post: SocialPostDraft;
  setTitle: (t: string) => void;
  setBrief: (b: string) => void;
  setTemplate: (id: string | null) => void;
  toggleBrandLock: () => void;
  setCopy: (patch: Partial<PostCopy>) => void;
  /** 出圖完成後寫入背景並進入 generated（核准門等價物，§4.3）。 */
  setBackground: (bg: NonNullable<SocialPostDraft["background"]>) => void;
  /** 素材來源確認（uploaded/licensed 需確認你有使用權，§4.3）。 */
  setAssetSource: (src: AssetSource, confirmed?: boolean) => void;
  approve: () => void;
  reject: () => void;
  recordExport: (e: PostExport) => void;
  schedule: (whenISO: string) => void;
  reset: () => void;
}

export function useSocialPost(initial?: Partial<SocialPostDraft>): UseSocialPostResult {
  const [post, setPost] = useState<SocialPostDraft>(() => ({ ...emptyDraft(), ...initial }));

  const setTitle = useCallback((title: string) => setPost((p) => ({ ...p, title })), []);
  const setBrief = useCallback((brief: string) => setPost((p) => ({ ...p, brief })), []);
  const setTemplate = useCallback((templateId: string | null) => setPost((p) => ({ ...p, templateId })), []);
  const toggleBrandLock = useCallback(() => setPost((p) => ({ ...p, brandLock: !p.brandLock })), []);
  const setCopy = useCallback((patch: Partial<PostCopy>) => setPost((p) => ({ ...p, copy: { ...p.copy, ...patch } })), []);

  const setBackground = useCallback(
    (background: NonNullable<SocialPostDraft["background"]>) =>
      setPost((p) => ({
        ...p,
        background,
        // 改了主視覺 → 既有匯出失效；核准退回 generated（需重新核准，§2.4 stale 精神）。
        exports: [],
        approval: "generated",
      })),
    [],
  );

  const setAssetSource = useCallback(
    (assetSource: AssetSource, confirmed?: boolean) =>
      setPost((p) => ({
        ...p,
        assetSource,
        sourceConfirmed: confirmed ?? assetSource === "generated",
      })),
    [],
  );

  const approve = useCallback(() => setPost((p) => (p.approval === "generated" ? { ...p, approval: "approved" } : p)), []);
  const reject = useCallback(() => setPost((p) => ({ ...p, approval: "rejected" })), []);
  const recordExport = useCallback(
    (e: PostExport) =>
      setPost((p) => ({ ...p, exports: [...p.exports.filter((x) => x.presetId !== e.presetId), e] })),
    [],
  );
  const schedule = useCallback((scheduledAt: string) => setPost((p) => ({ ...p, scheduledAt })), []);
  const reset = useCallback(() => setPost(emptyDraft()), []);

  return useMemo(
    () => ({
      post, setTitle, setBrief, setTemplate, toggleBrandLock, setCopy,
      setBackground, setAssetSource, approve, reject, recordExport, schedule, reset,
    }),
    [post, setTitle, setBrief, setTemplate, toggleBrandLock, setCopy, setBackground, setAssetSource, approve, reject, recordExport, schedule, reset],
  );
}

/** 是否可進入多尺寸匯出／排程發佈（單張 approved + 素材來源已確認，§4.3）。 */
export function canExportOrPublish(post: SocialPostDraft): boolean {
  return post.approval === "approved" && post.sourceConfirmed;
}
