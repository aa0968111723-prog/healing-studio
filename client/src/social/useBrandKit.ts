// ============================================================================
// social/useBrandKit.ts — 品牌庫狀態（Tier-0：重用 block_combos，零新表）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §2 / §5.1 / §5.5。
//
// 【Tier-0 持久化模型】品牌身份 = 一筆 block_combos（kind:'brand' 哨符），鎖定閘門
//   落 consistency_vault。本 hook 在 P5 外殼期以「記憶體 + 序列化就緒」呈現：
//     - 初始 fixture「療癒誌」（DEFAULT_BRAND_KIT），對映設計 §5.5。
//     - save() 把 BrandKit 序列化成 block_combos 形狀（brandKitToBlockCombo），
//       目標 procedure = blockCombos.create/update（real 接線時改這一行，UI 不動）。
//     - lock()/unlock() 走 brandKit.ts 狀態機；real 時雙寫 vault.update（設計 §2.3）。
//   為何不直接打後端：P0 DataStore 接縫尚未暴露 block_combos 讀寫；Tier-0 MVP 以記憶體
//   先跑通整條旅程（mock-first），待 blockCombos.* 接縫補上即替換 persist()。
//
// 與脊椎一致：projectId 來自 useCreativeProject()（WorldContext 唯一真實來源，不另建狀態）。
// ============================================================================
import { useCallback, useMemo, useState } from "react";
import { useCreativeProject } from "@/spine/useCreativeProject";
import {
  DEFAULT_BRAND_KIT, evaluateBrandGate, lockBrand, unlockBrand,
  brandKitToBlockCombo, type BrandKit, type BrandGate,
} from "./brandKit";

export interface UseBrandKitResult {
  kit: BrandKit;
  gate: BrandGate;
  /** 局部更新品牌欄位（自動回到 defined、若曾 locked 則需重新鎖）。 */
  update: (patch: Partial<BrandKit>) => void;
  /** 鎖定（通過閘門才生效）。 */
  lock: () => void;
  /** 解鎖（version++，回傳受影響估計交由貼文層判斷 stale）。 */
  unlock: () => void;
  /** 序列化並「持久化」（Tier-0：回傳 block_combos 形狀；real→blockCombos.*）。 */
  save: () => ReturnType<typeof brandKitToBlockCombo>;
  /** 是否已鎖。 */
  locked: boolean;
}

export function useBrandKit(initial?: BrandKit): UseBrandKitResult {
  const active = useCreativeProject();
  const projectId =
    (active as { activeProjectId?: string | number | null })?.activeProjectId != null
      ? String((active as { activeProjectId?: string | number | null }).activeProjectId)
      : null;

  const [kit, setKit] = useState<BrandKit>(() => ({
    ...(initial ?? DEFAULT_BRAND_KIT),
    projectId: (initial ?? DEFAULT_BRAND_KIT).projectId ?? projectId,
  }));

  const update = useCallback((patch: Partial<BrandKit>) => {
    setKit((k) => {
      const next = { ...k, ...patch };
      // 改欄位 → 若原為 locked，退回 defined（需重新鎖；對映 §2.4 解鎖→改→重鎖）。
      if (k.lockState === "locked") next.lockState = "defined";
      return next;
    });
  }, []);

  const lock = useCallback(() => setKit((k) => lockBrand(k)), []);
  const unlock = useCallback(() => setKit((k) => unlockBrand(k)), []);

  const save = useCallback(() => brandKitToBlockCombo(kit), [kit]);

  const gate = useMemo(() => evaluateBrandGate(kit), [kit]);

  return { kit, gate, update, lock, unlock, save, locked: kit.lockState === "locked" };
}
