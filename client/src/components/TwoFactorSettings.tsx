import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, ShieldCheck, ShieldOff, Copy } from "lucide-react";

type Stage = "idle" | "setup" | "enabled";

async function api<T>(
  url: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    credentials: "include",
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body: json ? JSON.stringify(json) : undefined,
    ...rest,
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "請稍後再試");
  }
  return data as T;
}

export default function TwoFactorSettings() {
  const [stage, setStage] = useState<Stage>("idle");
  const [secret, setSecret] = useState<string>("");
  const [otpAuthUri, setOtpAuthUri] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
  }, []);

  const refreshStatus = async () => {
    try {
      const data = await api<{ enabled: boolean }>("/api/auth/2fa/status");
      setStage(data.enabled ? "enabled" : "idle");
    } catch {
      // Treat any error as "not enabled" — the endpoint requires auth, so the
      // worst case is the user sees the setup CTA when they shouldn't.
      setStage("idle");
    }
  };

  const beginSetup = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const data = await api<{ secret: string; otpAuthUri: string }>(
        "/api/auth/2fa/setup",
        { method: "POST", json: {} }
      );
      setSecret(data.secret);
      setOtpAuthUri(data.otpAuthUri);
      setToken("");
      setStage("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "啟動 2FA 失敗");
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      await api<{ success: true }>("/api/auth/2fa/verify", {
        method: "POST",
        json: { token },
      });
      setStage("enabled");
      setSecret("");
      setOtpAuthUri("");
      setToken("");
      setInfo("兩步驟驗證已啟用，下次登入時會要求動態碼。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "驗證失敗");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await api<{ success: true }>("/api/auth/2fa/disable", {
        method: "POST",
        json: { token },
      });
      setStage("idle");
      setToken("");
      setInfo("已關閉兩步驟驗證。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "停用失敗");
    } finally {
      setLoading(false);
    }
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setInfo("已複製到剪貼簿"),
      () => setError("複製失敗，請手動選取")
    );
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        {stage === "enabled" ? (
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <ShieldOff className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">兩步驟驗證 (2FA)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stage === "enabled"
              ? "已啟用 — 登入時需要驗證器 App 的 6 位數動態碼。"
              : "使用 Google Authenticator / Authy / 1Password 等驗證器 App，登入時加上 6 位數動態碼。"}
          </p>
        </div>
      </div>

      {stage === "idle" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={beginSetup}
        >
          {loading ? "產生密鑰中..." : "啟用兩步驟驗證"}
        </Button>
      )}

      {stage === "setup" && (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium mb-1">1. 在驗證器 App 中加入帳號</p>
            <p className="text-[11px] text-muted-foreground mb-2">
              掃描下方 otpauth 連結，或手動輸入下方密鑰（Base32）。
            </p>

            <div className="rounded-md border border-border/50 bg-muted/30 p-2 flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-[11px]">
                {secret}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => copy(secret)}
                className="h-7 px-2"
                title="複製密鑰"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>

            <a
              href={otpAuthUri}
              className="inline-block mt-2 text-xs text-primary hover:underline break-all"
            >
              在裝置上開啟 → {otpAuthUri.slice(0, 60)}…
            </a>
          </div>

          <div>
            <p className="text-xs font-medium mb-1">
              2. 輸入 App 顯示的 6 位數動態碼以完成設定
            </p>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={token}
              onChange={e =>
                setToken(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={loading}
              className="tracking-[0.5em] text-center"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={confirmSetup}
              disabled={loading || token.length !== 6}
            >
              {loading ? "驗證中..." : "驗證並啟用"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setStage("idle");
                setSecret("");
                setOtpAuthUri("");
                setToken("");
                setError(null);
              }}
              disabled={loading}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {stage === "enabled" && (
        <div className="space-y-2">
          <p className="text-xs font-medium">輸入目前的 6 位數動態碼以停用 2FA</p>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={token}
              onChange={e =>
                setToken(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={loading}
              className="tracking-[0.5em] text-center max-w-[160px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={disable}
              disabled={loading || token.length !== 6}
            >
              {loading ? "停用中..." : "停用 2FA"}
            </Button>
          </div>
        </div>
      )}

      {info && (
        <div className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {info}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
