// ============================================================================
// providers/SpineProvider.tsx — 共用脊椎（P0 scaffold：包覆，不取代）
// ----------------------------------------------------------------------------
// 【定位】整合指南 §3「脊椎落位：包覆，不取代」。SpineProvider 是一層「加法」provider：
//   - 持有五接縫 adapters（依 env 預設 trpc；見 adapters/index.ts）。
//   - 持有跨 shell 的輕量視圖：生成 provider 選擇、故障注入、feature flags、cmdk 開關。
//   - 透過 useCreativeProject() 對外曝露 active CreativeProject —— 但**委派**給既有的
//     useActiveProject()（WorldContext-backed，全站唯一真實來源），**不複製**第二套狀態。
//
// 【為什麼可以放在最外層、且零風險】
//   1. 本 provider 無任何 mount 副作用：不發網路請求、不寫 DOM、不碰 localStorage。
//   2. P0 沒有任何 UI 會呼叫 spine.adapters.*（shell 只把既有頁面 re-home）。
//   3. active-project 仍由 WorldContextProvider 當唯一來源；SpineProvider 只是「提供 adapters
//      + 跨 shell 旗標」的容器。useCreativeProject 是消費 hook，必須在 WorldContextProvider
//      之內呼叫（shell 都在其內，成立）。
//   → 即使 ENABLE_4SHELL=OFF、SpineProvider 仍掛著，行為與線上完全一致。
//
// 【與既有 4 context 的關係】不取代 ProjectsProvider / ThemeProvider / BackgroundTasksProvider /
//   GlobalOrbChatProvider。日後（P1）把 SpineProvider 的 action（generateShot/runResearch…）接上
//   adapters 時，UI 語意（toast、確認門、扣點）不變，只換資料來源。
// ============================================================================
import {
  createContext, useContext, useMemo, useRef, useState, useCallback, type ReactNode,
} from "react";
import { createAdapters, type Adapters } from "@/adapters";
import type { ProviderId } from "@/spine/types";
import { FEATURE_FLAGS } from "@/config/featureFlags";

interface SpineValue {
  /** 五接縫 adapters（dataStore/generation/commander/contextPacket/storage）。 */
  adapters: Adapters;
  /** 目前生成 provider（給 GenerationAdapter 的偏好；預設 hf）。 */
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  /** 故障注入（demo/測試用；正式為空）。 */
  faults: Record<string, boolean>;
  toggleFault: (key: string) => void;
  /** build-time feature flags 唯讀快照（ENABLE_4SHELL / SHELL_SOCIAL / SHELL_LEARN）。 */
  flags: typeof FEATURE_FLAGS;
  /** Command palette 開關（跨 shell 共用；P0 不強制接，預留）。 */
  cmdkOpen: boolean;
  setCmdk: (open: boolean) => void;
}

const SpineCtx = createContext<SpineValue | null>(null);

export function useSpine(): SpineValue {
  const v = useContext(SpineCtx);
  if (!v) throw new Error("useSpine 必須在 <SpineProvider> 之內使用");
  return v;
}

export function SpineProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ProviderId>("hf");
  const [faults, setFaults] = useState<Record<string, boolean>>({});
  const [cmdkOpen, setCmdk] = useState(false);

  // 用 ref 讓 adapters 的 getProvider/getFaults 永遠讀到最新值，又不必重建 adapters。
  const providerRef = useRef(provider); providerRef.current = provider;
  const faultsRef = useRef(faults); faultsRef.current = faults;

  // adapters 只建一次（無副作用；getTrpcClient 為 lazy，import/建立時不連線）。
  const adapters = useMemo(
    () => createAdapters({ getProvider: () => providerRef.current, getFaults: () => faultsRef.current }),
    [],
  );

  const toggleFault = useCallback((key: string) => {
    setFaults((f) => ({ ...f, [key]: !f[key] }));
  }, []);

  const value = useMemo<SpineValue>(() => ({
    adapters, provider, setProvider, faults, toggleFault, flags: FEATURE_FLAGS, cmdkOpen, setCmdk,
  }), [adapters, provider, faults, toggleFault, cmdkOpen]);

  return <SpineCtx.Provider value={value}>{children}</SpineCtx.Provider>;
}
