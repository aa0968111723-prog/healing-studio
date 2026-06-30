import { type CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/contexts/ThemeContext";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      offset={{ bottom: 80 }}
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
