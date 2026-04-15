/**
 * LazyStreamdown — 延遲載入 Streamdown Markdown 渲染器
 *
 * Streamdown 依賴鏈（mermaid + shiki + katex + rehype + remark 等）
 * 構成 12MB+ 的 vendor-markdown chunk，不應在初始載入時引入。
 * 此元件以 React.lazy() + Suspense 包裝，確保只在實際需要渲染
 * Markdown 內容時才載入整個依賴樹。
 */

import { lazy, Suspense, type ReactNode } from "react";

const StreamdownLazy = lazy(() =>
  import("streamdown").then((mod) => ({ default: mod.Streamdown }))
);

interface LazyStreamdownProps {
  children?: string;
  className?: string;
  /** Fallback while loading, defaults to a subtle shimmer placeholder */
  fallback?: ReactNode;
}

export default function LazyStreamdown({
  children,
  className,
  fallback,
}: LazyStreamdownProps) {
  const fb = fallback ?? (
    <div className="animate-pulse space-y-2 py-2">
      <div className="h-3 bg-muted/40 rounded w-3/4" />
      <div className="h-3 bg-muted/40 rounded w-1/2" />
      <div className="h-3 bg-muted/40 rounded w-5/6" />
    </div>
  );

  return (
    <Suspense fallback={fb}>
      <StreamdownLazy className={className}>{children}</StreamdownLazy>
    </Suspense>
  );
}
