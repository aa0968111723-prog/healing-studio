import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "login" | "register";

type LocalAuthFormProps = {
  className?: string;
  onSuccess?: () => void;
  hideTitle?: boolean;
  redirectTo?: string;
};

async function postAuth<T>(
  url: string,
  payload: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    requiresTwoFactor?: boolean;
  };

  if (!response.ok) {
    const err = new Error(data.error || "登入失敗，請稍後再試") as Error & {
      requiresTwoFactor?: boolean;
    };
    err.requiresTwoFactor = data.requiresTwoFactor;
    throw err;
  }

  return data as T;
}

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

  // 2FA challenge state — populated when the server signals requiresTwoFactor
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [totpToken, setTotpToken] = useState("");

  const [googleConfigured, setGoogleConfigured] = useState(false);

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

  const isStrongPassword = (value: string) =>
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "register") {
        const normalizedEmail = registerEmail.trim().toLowerCase();
        if (!normalizedEmail.includes("@")) {
          throw new Error("請輸入有效的 Email");
        }
        if (registerPassword !== confirmPassword) {
          throw new Error("兩次輸入的密碼不一致");
        }
        if (!isStrongPassword(registerPassword)) {
          throw new Error("密碼需包含大小寫、數字與符號");
        }
        await postAuth("/api/auth/register", {
          email: normalizedEmail,
          password: registerPassword,
          name: registerName.trim(),
        });
        setSuccess("註冊成功，正在為你登入...");
      } else {
        const normalizedEmail = loginEmail.trim().toLowerCase();
        if (!normalizedEmail.includes("@")) {
          throw new Error("請輸入有效的 Email");
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
      const e = err as Error & { requiresTwoFactor?: boolean };
      // INVALID_2FA_CODE comes back as 401 with requiresTwoFactor=true; keep
      // the form in 2FA mode and just surface the error.
      if (e.requiresTwoFactor) {
        setTwoFactorRequired(true);
      }
      setError(e.message || "操作失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className={className}
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      {!hideTitle && (
        <p className="text-xs text-muted-foreground mb-2">
          或使用 Email 註冊 / 登入
        </p>
      )}
      <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
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
            disabled={loading}
          />
          <Input
            type="password"
            placeholder="密碼"
            value={loginPassword}
            onChange={e => setLoginPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />
          <div className="text-right">
            <a
              href="/forgot-password"
              className="text-xs text-primary hover:underline"
              onClick={e => {
                e.preventDefault();
                window.location.href = "/forgot-password";
              }}
            >
              忘記密碼？
            </a>
          </div>

          {twoFactorRequired && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-medium text-foreground">
                兩步驟驗證碼
              </p>
              <p className="text-[11px] text-muted-foreground">
                請打開驗證器 App，輸入 6 位數動態碼。
              </p>
              <Input
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
          />
          <Input
            type="email"
            placeholder="Email"
            value={registerEmail}
            onChange={e => setRegisterEmail(e.target.value)}
            autoComplete="email"
            disabled={loading}
          />
          <Input
            type="password"
            placeholder="密碼（至少 8 碼，含大小寫/數字/符號）"
            value={registerPassword}
            onChange={e => setRegisterPassword(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
          />
          <Input
            type="password"
            placeholder="確認密碼"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={loading}
          />
        </TabsContent>
      </Tabs>

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {success && <p className="text-xs text-emerald-600 mt-2">{success}</p>}

      {googleConfigured && (
        <Button
          type="button"
          variant="outline"
          className="w-full mt-3"
          onClick={() => {
            window.location.href = "/api/auth/google";
          }}
        >
          使用 Google 登入
        </Button>
      )}

      <Button
        type="submit"
        disabled={
          loading ||
          (mode === "login" &&
            (!loginEmail ||
              !loginPassword ||
              (twoFactorRequired && totpToken.length !== 6))) ||
          (mode === "register" &&
            (!registerEmail ||
              !registerPassword ||
              !confirmPassword ||
              registerPassword !== confirmPassword))
        }
        className="w-full mt-3"
      >
        {loading
          ? "處理中..."
          : mode === "register"
            ? "建立帳號"
            : twoFactorRequired
              ? "驗證並登入"
              : "登入"}
      </Button>
    </form>
  );
}
