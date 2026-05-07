import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [, navigate] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("請求過於頻繁，請稍後再試");
        }
        throw new Error(data.error || "發送重置連結失敗");
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "發送重置連結失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="p-1 hover:bg-muted rounded-md transition-colors"
              aria-label="返回首頁"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <CardTitle className="text-2xl font-bold">忘記密碼</CardTitle>
          </div>
          <CardDescription>
            輸入您的 Email，我們將發送密碼重置連結給您
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4 text-center py-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-emerald-100 p-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">重置連結已發送！</h3>
                <p className="text-sm text-muted-foreground">
                  如果該 Email 地址存在於我們的系統中，您將收到一封包含密碼重置連結的郵件。
                </p>
                <p className="text-xs text-muted-foreground mt-4">
                  請檢查您的收件箱（以及垃圾郵件資料夾）。
                </p>
              </div>
              <div className="space-y-2 pt-4">
                <Button
                  onClick={() => navigate("/")}
                  variant="outline"
                  className="w-full"
                >
                  返回首頁
                </Button>
                <Button
                  onClick={() => {
                    setSuccess(false);
                    setEmail("");
                  }}
                  variant="ghost"
                  className="w-full"
                >
                  重新發送
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email 地址
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
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

              <Button
                type="submit"
                disabled={loading || !email}
                className="w-full"
              >
                {loading ? "發送中..." : "發送重置連結"}
              </Button>

              <div className="text-center text-sm">
                <span className="text-muted-foreground">記得密碼了？</span>{" "}
                <a
                  href="/"
                  className="text-primary hover:underline font-medium"
                >
                  返回登入
                </a>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
