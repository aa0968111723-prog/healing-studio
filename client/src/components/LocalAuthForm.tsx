import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type Mode = "login" | "register";

type LocalAuthFormProps = {
  className?: string;
  onSuccess?: () => void;
  hideTitle?: boolean;
  redirectTo?: string;
};

type AuthErrorPayload = {
  error?: string;
  errorCode?: string;
  requiresTwoFactor?: boolean;
  retryAfterMinutes?: number;
};

class AuthError extends Error {
  errorCode?: string;
  requiresTwoFactor?: boolean;
  retryAfterMinutes?: number;
  status: number;

  constructor(message: string, status: number, payload: AuthErrorPayload) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.errorCode = payload.errorCode;
    this.requiresTwoFactor = payload.requiresTwoFactor;
    this.retryAfterMinutes = payload.retryAfterMinutes;
  }
}

// ── Server errorCode → 中文文案（單一事實來源） ───────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL: "Email 格式不正確，請檢查後重試。",
  PASSWORD_TOO_SHORT: "密碼至少需 8 個字元。",
  PASSWORD_REQUIRED: "請輸入密碼。",
  PASSWORD_WEAK: "密碼需同時包含大小寫字母、數字與符號。",
  EMAIL_ALREADY_REGISTERED:
    "這個 Email 已註冊，請改用「登入」或點選「忘記密碼」。",
  INVALID_CREDENTIALS: "Email 或密碼不正確。",
  OAUTH_ONLY_ACCOUNT:
    "此帳號是用 Google 登入註冊的，請改用「Google 登入」。",
  ACCOUNT_LOCKED: "失敗次數過多，請稍後再試或重設密碼。",
  INVALID_2FA_CODE: "驗證碼不正確或已失效，請重新輸入。",
  INVALID_2FA_FORMAT: "請輸入 6 位數字驗證碼。",
  DATABASE_UNAVAILABLE: "伺服器忙碌中，請稍後再試（資料庫暫時無法連線）。",
  REGISTER_FAILED: "註冊失敗，請稍後再試。",
  LOGIN_FAILED: "登入失敗，請稍後再試。",
  INVALID_PAYLOAD: "送出的資料格式錯誤，請重新填寫。",
};

function localizeError(err: AuthError): string {
  if (err.errorCode && ERROR_MESSAGES[err.errorCode]) {
    return ERROR_MESSAGES[err.errorCode];
  }
  // Fallback: server's English message → keep but prefix to make it
  // obvious this came back without a known code.
  return err.message || "操作失敗，請稍後再試。";
}

async function postAuth<T>(
  url: string,
  payload: Record<string, string>
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  } catch {
    // Network failure — fetch itself rejected, no response to parse.
    throw new AuthError("網路連線失敗，請檢查網路後再試。", 0, {
      errorCode: "NETWORK_ERROR",
    });
  }

  const data = (await response.json().catch(() => ({}))) as AuthErrorPayload &
    Record<string, unknown>;

  if (!response.ok) {
    throw new AuthError(
      data.error || "操作失敗，請稍後再試。",
      response.status,
      data
    );
  }

  return data as T;
}

// ── Password strength heuristic (0–4) ─────────────────────────────────────
function scorePassword(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

const STRENGTH_LABELS = ["太弱", "偏弱", "尚可", "良好", "極強"] as const;
const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-emerald-500",
  "bg-emerald-600",
] as const;

export default function LocalAuthForm({
  className,
  onSuccess,
  hideTitle = false,
  redirectTo,
}: LocalAuthFormProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Show / hide password
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegisterPwd, setShowRegisterPwd] = useState(false);

  // Caps lock indicator (HID hint — best-effort, won't fire on every browser)
  const [capsLockOn, setCapsLockOn] = useState(false);

  // 2FA challenge state — populated when the server signals requiresTwoFactor
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [totpToken, setTotpToken] = useState("");

  const [googleConfigured, setGoogleConfigured] = useState(false);
  // Lockout countdown so the user knows when they can retry instead of just
  // seeing "ACCOUNT_LOCKED" indefinitely.
  const [lockoutEndsAt, setLockoutEndsAt] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  const totpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/google/status", { credentials: "include" })
      .then(r => r.json())
      .then((data: { configured?: boolean }) => {
        if (mounted) setGoogleConfigured(!!data?.configured);
      })
      .catch(() => {
        if (mounted) setGoogleConfigured(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-focus the TOTP input when the 2FA challenge appears so the user
  // doesn't have to tap the field on mobile.
  useEffect(() => {
    if (twoFactorRequired) {
      const t = window.setTimeout(() => totpInputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [twoFactorRequired]);

  // Lockout countdown ticker
  useEffect(() => {
    if (!lockoutEndsAt) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockoutEndsAt - Date.now()) / 1000));
      setLockoutSecondsLeft(left);
      if (left <= 0) setLockoutEndsAt(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockoutEndsAt]);

  const passwordScore = useMemo(
    () => scorePassword(registerPassword),
    [registerPassword]
  );
  const passwordsMismatch =
    confirmPassword.length > 0 && registerPassword !== confirmPassword;

  const handleKeyForCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setCapsLockOn(e.getModifierState("CapsLock"));
    }
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "register") {
        const normalizedEmail = registerEmail.trim().toLowerCase();
        if (!normalizedEmail.includes("@")) {
          throw new AuthError(ERROR_MESSAGES.INVALID_EMAIL, 0, {
            errorCode: "INVALID_EMAIL",
          });
        }
        if (registerPassword !== confirmPassword) {
          throw new AuthError("兩次輸入的密碼不一致。", 0, {});
        }
        if (passwordScore < 3) {
          throw new AuthError(ERROR_MESSAGES.PASSWORD_WEAK, 0, {
            errorCode: "PASSWORD_WEAK",
          });
        }
        const result = await postAuth<{
          success?: boolean;
          linkedExisting?: boolean;
        }>("/api/auth/register", {
          email: normalizedEmail,
          password: registerPassword,
          name: registerName.trim(),
        });
        setSuccess(
          result.linkedExisting
            ? "已將密碼附加到既有的 Google 帳號，正在登入..."
            : "註冊成功，正在為你登入..."
        );
      } else {
        const normalizedEmail = loginEmail.trim().toLowerCase();
        if (!normalizedEmail.includes("@")) {
          throw new AuthError(ERROR_MESSAGES.INVALID_EMAIL, 0, {
            errorCode: "INVALID_EMAIL",
          });
        }
        const payload: Record<string, string> = {
          email: normalizedEmail,
          password: loginPassword,
        };
        if (twoFactorRequired && totpToken) {
          payload.totpToken = totpToken;
        }
        const result = await postAuth<{
          success?: boolean;
          requiresTwoFactor?: boolean;
        }>("/api/auth/login", payload);

        // Server returned 200 with success=false → 2FA challenge required.
        if (result.requiresTwoFactor && !result.success) {
          setTwoFactorRequired(true);
          setLoading(false);
          return;
        }
        setSuccess("登入成功，正在跳轉...");
      }

      onSuccess?.();
      const target =
        redirectTo || `${window.location.pathname}${window.location.search}`;
      window.location.assign(target);
    } catch (err) {
      const e = err instanceof AuthError ? err : null;
      // INVALID_2FA_CODE comes back as 401 with requiresTwoFactor=true; keep
      // the form in 2FA mode and just surface the error.
      if (e?.requiresTwoFactor) {
        setTwoFactorRequired(true);
        setTotpToken("");
      }
      // OAuth-only account → switch to login mode if user was on register so
      // they don't keep retrying registration.
      if (e?.errorCode === "OAUTH_ONLY_ACCOUNT") {
        // Stay readable but also nudge them visually.
      }
      // Surface lockout countdown.
      if (e?.errorCode === "ACCOUNT_LOCKED" && e.retryAfterMinutes) {
        setLockoutEndsAt(Date.now() + e.retryAfterMinutes * 60 * 1000);
      }
      setError(e ? localizeError(e) : (err as Error).message || "操作失敗");
    } finally {
      setLoading(false);
    }
  };

  // Disable submit while locked out.
  const isLockedOut = lockoutSecondsLeft > 0;

  return (
    <form
      className={className}
      onSubmit={e => {
        e.preventDefault();
        if (!loading && !isLockedOut) void submit();
      }}
    >
      {!hideTitle && (
        <p className="text-xs text-muted-foreground mb-2">
          或使用 Email 註冊 / 登入
        </p>
      )}
      <Tabs
        value={mode}
        onValueChange={v => {
          setMode(v as Mode);
          // Reset transient state when switching tabs so a stale 2FA prompt
          // doesn't leak across modes.
          setError(null);
          setSuccess(null);
          setTwoFactorRequired(false);
          setTotpToken("");
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Email 登入</TabsTrigger>
          <TabsTrigger value="register">註冊帳號</TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="space-y-3 mt-3">
          <Input
            type="email"
            placeholder="Email"
            value={loginEmail}
            onChange={e => setLoginEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            disabled={loading}
            aria-label="登入用 Email"
          />
          <div className="relative">
            <Input
              type={showLoginPwd ? "text" : "password"}
              placeholder="密碼"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              onKeyUp={handleKeyForCaps}
              autoComplete="current-password"
              disabled={loading}
              aria-label="登入用密碼"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowLoginPwd(v => !v)}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showLoginPwd ? "隱藏密碼" : "顯示密碼"}
            >
              {showLoginPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {capsLockOn && loginPassword.length > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              ⚠️ Caps Lock 已開啟
            </p>
          )}
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-muted-foreground">
              {isLockedOut
                ? `為保護帳號已暫時鎖定（剩 ${Math.floor(lockoutSecondsLeft / 60)}:${String(
                    lockoutSecondsLeft % 60
                  ).padStart(2, "0")}）`
                : ""}
            </span>
            <Link
              href="/forgot-password"
              className="text-xs text-primary hover:underline"
            >
              忘記密碼？
            </Link>
          </div>

          {twoFactorRequired && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-medium text-foreground">
                  兩步驟驗證碼
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                請打開驗證器 App，輸入 6 位數動態碼。
              </p>
              <Input
                ref={totpInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={totpToken}
                onChange={e =>
                  setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={loading}
                className="tracking-[0.5em] text-center text-base"
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="register" className="space-y-3 mt-3">
          <Input
            type="text"
            placeholder="顯示名稱（選填）"
            value={registerName}
            onChange={e => setRegisterName(e.target.value)}
            autoComplete="name"
            disabled={loading}
            maxLength={80}
          />
          <Input
            type="email"
            placeholder="Email"
            value={registerEmail}
            onChange={e => setRegisterEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            disabled={loading}
            aria-label="註冊用 Email"
          />
          <div className="relative">
            <Input
              type={showRegisterPwd ? "text" : "password"}
              placeholder="密碼（至少 8 碼，含大小寫/數字/符號）"
              value={registerPassword}
              onChange={e => setRegisterPassword(e.target.value)}
              onKeyUp={handleKeyForCaps}
              autoComplete="new-password"
              disabled={loading}
              aria-label="註冊用密碼"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowRegisterPwd(v => !v)}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showRegisterPwd ? "隱藏密碼" : "顯示密碼"}
            >
              {showRegisterPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {registerPassword.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      i < passwordScore
                        ? STRENGTH_COLORS[passwordScore]
                        : "bg-muted"
                    )}
                  />
                ))}
              </div>
              <p
                className={cn(
                  "text-[11px]",
                  passwordScore >= 3
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                強度：{STRENGTH_LABELS[passwordScore]}
                {passwordScore < 3 && "（需更長或加入特殊符號）"}
              </p>
            </div>
          )}
          {capsLockOn && registerPassword.length > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              ⚠️ Caps Lock 已開啟
            </p>
          )}
          <Input
            type={showRegisterPwd ? "text" : "password"}
            placeholder="確認密碼"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
            aria-invalid={passwordsMismatch || undefined}
          />
          {passwordsMismatch && (
            <p className="text-[11px] text-red-500">兩次輸入的密碼不一致。</p>
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {success}
          </p>
        </div>
      )}

      {googleConfigured && (
        <Button
          type="button"
          variant="outline"
          className="w-full mt-3"
          disabled={loading}
          onClick={() => {
            const here =
              window.location.pathname + window.location.search;
            window.location.href = `/api/oauth/google/start?redirect=${encodeURIComponent(here)}`;
          }}
        >
          使用 Google 登入
        </Button>
      )}

      <Button
        type="submit"
        disabled={
          loading ||
          isLockedOut ||
          (mode === "login" &&
            twoFactorRequired &&
            totpToken.length !== 6) ||
          (mode === "register" &&
            (!registerEmail ||
              !registerPassword ||
              !confirmPassword ||
              registerPassword !== confirmPassword ||
              passwordScore < 3))
        }
        className="w-full mt-3"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            處理中...
          </span>
        ) : isLockedOut ? (
          `已鎖定（${Math.floor(lockoutSecondsLeft / 60)}:${String(
            lockoutSecondsLeft % 60
          ).padStart(2, "0")}）`
        ) : mode === "register" ? (
          "建立帳號"
        ) : twoFactorRequired ? (
          "驗證並登入"
        ) : (
          "登入"
        )}
      </Button>
    </form>
  );
}
