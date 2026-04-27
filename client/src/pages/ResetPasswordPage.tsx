import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Lock, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isStrongPassword = (value: string) =>
    value.length >= 8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);

  useEffect(() => {
    // Get token from URL params
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");

    if (!urlToken) {
      setVerifying(false);
      setError("未提供重置令牌");
      return;
    }

    setToken(urlToken);

    // Verify token
    const verifyToken = async () => {
      try {
        const response = await fetch(
          `/api/auth/verify-reset-token?token=${encodeURIComponent(urlToken)}`,
          {
            credentials: "include",
          }
        );

        const data = await response.json();

        if (response.ok && data.valid) {
          setTokenValid(true);
        } else {
          setError("重置連結已失效或無效");
        }
      } catch (err) {
        setError("驗證重置連結時發生錯誤");
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("兩次輸入的密碼不一致");
      setLoading(false);
      return;
    }

    if (!isStrongPassword(newPassword)) {
      setError("密碼需包含至少 8 個字元，包括大小寫字母、數字和符號");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          token,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "密碼重置失敗");
      }

      setSuccess(true);

      // Redirect to home after 3 seconds
      setTimeout(() => {
        window.location.href = "/";
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "密碼重置失敗");
    } finally {
      setLoading(false);
    }
  };

  const getPasswordStrength = () => {
    if (!newPassword) return null;
    const checks = {
      length: newPassword.length >= 8,
      lowercase: /[a-z]/.test(newPassword),
      uppercase: /[A-Z]/.test(newPassword),
      number: /\d/.test(newPassword),
      special: /[^A-Za-z0-9]/.test(newPassword),
    };
    const passedChecks = Object.values(checks).filter(Boolean).length;
    if (passedChecks === 5) return { level: "strong", color: "text-emerald-600" };
    if (passedChecks >= 3) return { level: "medium", color: "text-amber-600" };
    return { level: "weak", color: "text-red-600" };
  };

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="p-1 hover:bg-muted rounded-md transition-colors"
              aria-label="返回首頁"
            >
              <ArrowLeft className="h-5 w-5" />
            </a>
            <CardTitle className="text-2xl font-bold">重置密碼</CardTitle>
          </div>
          <CardDescription>設定您的新密碼</CardDescription>
        </CardHeader>
        <CardContent>
          {verifying ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-sm text-muted-foreground mt-4">驗證重置連結...</p>
            </div>
          ) : !tokenValid ? (
            <div className="space-y-4 text-center py-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-red-100 p-3">
                  <AlertCircle className="h-8 w-8 text-red-600" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">連結已失效</h3>
                <p className="text-sm text-muted-foreground">
                  {error || "此密碼重置連結已過期或無效。"}
                </p>
              </div>
              <div className="space-y-2 pt-4">
                <Button
                  onClick={() => window.location.href = "/forgot-password"}
                  className="w-full"
                >
                  重新申請重置連結
                </Button>
                <Button
                  onClick={() => window.location.href = "/"}
                  variant="outline"
                  className="w-full"
                >
                  返回首頁
                </Button>
              </div>
            </div>
          ) : success ? (
            <div className="space-y-4 text-center py-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-emerald-100 p-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">密碼重置成功！</h3>
                <p className="text-sm text-muted-foreground">
                  您的密碼已成功更新。正在為您跳轉到登入頁面...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-medium">
                  新密碼
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="至少 8 碼，含大小寫/數字/符號"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    disabled={loading}
                    className="pl-10"
                    required
                  />
                </div>
                {passwordStrength && (
                  <p className={`text-xs ${passwordStrength.color}`}>
                    密碼強度：
                    {passwordStrength.level === "strong" && "強"}
                    {passwordStrength.level === "medium" && "中"}
                    {passwordStrength.level === "weak" && "弱"}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium">
                  確認密碼
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="再次輸入新密碼"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md">
                  {error}
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-md">
                <p className="font-medium mb-1">密碼需求：</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>至少 8 個字元</li>
                  <li>包含大寫字母 (A-Z)</li>
                  <li>包含小寫字母 (a-z)</li>
                  <li>包含數字 (0-9)</li>
                  <li>包含特殊符號 (!@#$%^&* 等)</li>
                </ul>
              </div>

              <Button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                className="w-full"
              >
                {loading ? "重置中..." : "重置密碼"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
