/* AI Director · 設計系統 — Toast 通知系統（U-4d / AIDV-137）
 * ToastProvider：管理全域 toast 佇列（ok/warn/bad/info）。
 * useToast()：任何 <ToastProvider> 子樹元件呼叫 show/toast.ok/warn/bad/info 推入通知。
 * Toasts：固定右下角容器，逐筆渲 design-kit Toast，4.8 秒自動消失，可點關。
 * · 純呈現：色彩走 .aidv-kit token，不寫死 hex。
 * · a11y：每張 Toast 已有 role="status" + aria-live（bad → assertive，其餘 polite）。*/
import * as React from "react";
import { Toast, type DkToastKind } from "./chrome";

export interface ToastItem {
  id: string;
  kind: DkToastKind;
  title: React.ReactNode;
  message?: React.ReactNode;
}

interface ToastCtx {
  items: ToastItem[];
  show: (kind: DkToastKind, title: React.ReactNode, message?: React.ReactNode) => void;
  dismiss: (id: string) => void;
}

const Ctx = React.createContext<ToastCtx | null>(null);

const AUTO_MS = 4800;
let _seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback(
    (kind: DkToastKind, title: React.ReactNode, message?: React.ReactNode) => {
      const id = String(++_seq);
      setItems((prev) => [...prev, { id, kind, title, message }]);
      setTimeout(() => dismiss(id), AUTO_MS);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ items, show, dismiss }), [items, show, dismiss]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 推入 toast 的 hook。須在 <ToastProvider> 子樹使用。 */
export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast 須在 <ToastProvider> 子樹內使用");
  const { show } = ctx;
  const toast = React.useMemo(
    () => ({
      ok: (title: React.ReactNode, msg?: React.ReactNode) => show("ok", title, msg),
      warn: (title: React.ReactNode, msg?: React.ReactNode) => show("warn", title, msg),
      bad: (title: React.ReactNode, msg?: React.ReactNode) => show("bad", title, msg),
      info: (title: React.ReactNode, msg?: React.ReactNode) => show("info", title, msg),
    }),
    [show],
  );
  return { show, toast };
}

/** 固定右下角 toast 堆疊容器。需在 <ToastProvider> 子樹使用，通常由 AidvShellChrome 渲染。 */
export function Toasts() {
  const ctx = React.useContext(Ctx);
  if (!ctx || ctx.items.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex w-[min(340px,92vw)] flex-col gap-2"
      aria-label="通知佇列"
    >
      {ctx.items.map((t) => (
        <Toast
          key={t.id}
          kind={t.kind}
          title={t.title}
          message={t.message}
          onClose={() => ctx.dismiss(t.id)}
        />
      ))}
    </div>
  );
}
