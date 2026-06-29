import { type CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/contexts/ThemeContext";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      // AIDV-573: toast 統一移到右上角，避開右下角光球助手（ProactiveOrbWidget 預設 bottom-right），
      // 不再堆疊蓋住光球。預設 6 秒自動消失 + closeButton 可手動關閉，避免失敗 toast 卡整分鐘不退。
      position="top-right"
      duration={6000}
      closeButton
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--color-zen-sage)",
          "--success-text": "var(--text-on-glass-strong)",
          "--info-bg": "var(--color-zen-sky)",
          "--info-text": "var(--text-on-glass-strong)",
          "--warning-bg": "var(--color-zen-peach)",
          "--warning-text": "var(--text-on-glass-strong)",
          "--error-bg": "var(--color-zen-rose)",
          "--error-text": "var(--popover-foreground)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "transition-healing rounded-2xl",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
