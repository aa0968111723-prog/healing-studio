import { cn } from "@/lib/utils";
import { Cloud, RefreshCw, Home, ShieldCheck } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional: show a compact inline fallback instead of full-page */
  inline?: boolean;
  /** Optional: custom fallback component */
  fallback?: ReactNode;
  /** Optional: callback when error is caught */
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Zero-Anxiety ErrorBoundary
 * Catches React render errors and displays a friendly, calming UI.
 * Emphasizes that no credits were deducted and encourages retry.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
    // Log error for debugging but don't expose to user
    console.error("[ErrorBoundary]", error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // Inline compact fallback (for embedding inside pages)
    if (this.props.inline) {
      return (
        <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 backdrop-blur-sm">
          <Cloud size={36} className="text-amber-500 mb-3" />
          <p className="text-base font-medium text-foreground mb-1">
            頁面暫時遇到了一點小狀況
          </p>
          <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 mb-4">
            <ShieldCheck size={14} />
            <span>您的積分並未被扣除，請放心</span>
          </div>
          <button
            onClick={this.handleRetry}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium",
              "bg-primary/90 text-primary-foreground",
              "hover:bg-primary transition-colors cursor-pointer"
            )}
          >
            <RefreshCw size={14} />
            重新載入
          </button>
        </div>
      );
    }

    // Full-page fallback (default)
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-gradient-to-br from-amber-50/50 via-background to-sky-50/30 dark:from-amber-950/10 dark:via-background dark:to-sky-950/10">
        <div className="flex flex-col items-center w-full max-w-md text-center">
          {/* Calming cloud icon with soft glow */}
          <div className="relative mb-6">
            <div className="absolute inset-0 blur-2xl bg-amber-300/30 dark:bg-amber-500/10 rounded-full scale-150" />
            <Cloud size={56} className="relative text-amber-500" />
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-2">
            系統暫時休息中
          </h2>
          <p className="text-muted-foreground mb-3 leading-relaxed">
            AI 服務連線稍微異常，可能是暫時性的網路波動。
            <br />
            請稍後再試一次，通常很快就會恢復。
          </p>

          {/* Zero-anxiety credit assurance */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 mb-6">
            <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              我們並未扣除您的積分，請放心
            </span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleRetry}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 transition-opacity cursor-pointer"
              )}
            >
              <RefreshCw size={15} />
              重新嘗試
            </button>
            <button
              onClick={() => (window.location.href = "/studio")}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium",
                "bg-muted text-muted-foreground",
                "hover:bg-muted/80 transition-colors cursor-pointer"
              )}
            >
              <Home size={15} />
              回到工作室
            </button>
          </div>

          {/* Subtle error detail for power users */}
          {this.state.error && (
            <details className="mt-6 w-full text-left">
              <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground/80 transition-colors">
                技術細節（供進階使用者參考）
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
