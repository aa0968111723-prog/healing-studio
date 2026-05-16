import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Lock, ArrowLeft, CheckCircle2, Shield, Monitor } from "lucide-react";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type { AgentAction, AgentActionResult, AgentCapability } from "@/contexts/PageAgentContext";

const ACCOUNT_TAB_IDS = ["profile", "security", "activity"] as const;
type AccountTabId = (typeof ACCOUNT_TAB_IDS)[number];

function isAccountTabId(value: string): value is AccountTabId {
  return (ACCOUNT_TAB_IDS as readonly string[]).includes(value);
}

export default function AccountSettingsPage() {
  const { user: authUser, loading: authLoading, isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/",
  });

  const [activeTab, setActiveTab] = useState<AccountTabId>("profile");
  const [user, setUser] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginHistory, setLoginHistory] = useState<Array<{
    id: number;
    success: boolean;
    device: string | null;
    browser: string | null;
    os: string | null;
    ipAddress: string | null;
    createdAt: string;
  }>>([]);

  // Profile tab state
  const [name, setName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Password tab state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Hydrate local form state from useAuth's user data; this avoids the
  // duplicate REST round-trip to /api/auth/me that previously surfaced as
  // a console 401 for guest visitors before the redirect kicked in.
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      setLoading(false);
      return;
    }
    setUser({
      name: (authUser as { name?: string }).name ?? "",
      email: (authUser as { email?: string }).email ?? "",
    });
    setName((authUser as { name?: string }).name ?? "");
    setLoading(false);
  }, [authLoading, authUser]);

  // Login history is the only piece not covered by useAuth, so it remains
  // a REST call — but only after we know the user is authenticated.
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLoginHistory();
  }, [isAuthenticated]);

  const fetchLoginHistory = async () => {
    try {
      const response = await fetch("/api/auth/login-history?limit=10", {
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        setLoginHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch login history:", err);
    }
  };

  const isStrongPassword = (value: string) =>
    value.length >= 8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError(null);
    setProfileSuccess(false);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "更新失敗");
      }

      setProfileSuccess(true);
      setUser(prev => prev ? { ...prev, name } : null);

      // Clear success message after 3 seconds
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("兩次輸入的密碼不一致");
      setPasswordLoading(false);
      return;
    }

    if (!isStrongPassword(newPassword)) {
      setPasswordError("密碼需包含至少 8 個字元，包括大小寫字母、數字和符號");
      setPasswordLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "密碼更新失敗");
      }

      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Clear success message after 3 seconds
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "密碼更新失敗");
    } finally {
      setPasswordLoading(false);
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

  // 統一使用 NAV_ALLOWLIST Set 與其他頁一致；同時擴充常見離站目的（設定 / 積分），
  // 讓光球能在 account-settings 直接帶用戶到帳號相關位置。
  const ACCOUNT_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/", "/dashboard", "/settings", "/credits"]),
    []
  );

  const accountAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換分頁",
        options: [
          { id: "profile", label: "個人資料", meta: { tip: "查看與修改顯示名稱" } },
          { id: "security", label: "安全設定", meta: { tip: "更改密碼、兩步驟驗證" } },
          { id: "activity", label: "登入記錄", meta: { tip: "檢視最近裝置登入紀錄" } },
        ],
        currentId: activeTab,
        hint: "setTab tabId='profile' | 'security' | 'activity'",
      },
      {
        action: "navigate",
        label: "離開帳號設定",
        options: [
          { id: "/", label: "返回首頁", meta: { tip: "回到登入後首頁" } },
          { id: "/dashboard", label: "儀表板", meta: { tip: "查看創作概況" } },
          { id: "/settings", label: "個人設定", meta: { tip: "外觀、通知與場景偏好" } },
          { id: "/credits", label: "積分說明", meta: { tip: "瞭解積分計算與餘額" } },
        ],
        hint: "navigate path='/' | '/dashboard' | '/settings' | '/credits'",
      },
    ],
    [activeTab]
  );

  useRegisterPageAgent({
    pageId: "account-settings",
    pageLabel: "帳號設定",
    pagePath: "/account-settings",
    capabilities: accountAgentCapabilities,
    state: {
      activeTab,
      hasUser: !!user,
      hasLoginHistory: loginHistory.length > 0,
      loginHistoryCount: loginHistory.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const id = String(action.tabId ?? "");
          if (!isAccountTabId(id)) {
            return { ok: false, reason: `unknown tab: ${id}` };
          }
          setActiveTab(id);
          return { ok: true, message: `已切換到 ${id}` };
        }
        case "navigate": {
          const path = String(action.path ?? "");
          if (!ACCOUNT_NAV_ALLOWLIST.has(path)) {
            return { ok: false, reason: `不在允許跳轉清單：${path}` };
          }
          window.location.href = path;
          return { ok: true, message: `跳到 ${path}` };
        }
        default:
          return { ok: false, reason: `unsupported action: ${action.type}` };
      }
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500/8 via-background to-blue-500/8">
      <div className="page-shell page-shell-narrow !max-w-3xl page-shell-pad">
        <div className="mb-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-healing"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </a>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">帳號設定</CardTitle>
            <CardDescription>管理您的個人資料和安全設定</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={value => {
                if (isAccountTabId(value)) setActiveTab(value);
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  個人資料
                </TabsTrigger>
                <TabsTrigger value="security" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  安全設定
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  登入記錄
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-4 mt-6">
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      Email 地址
                    </label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ""}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email 地址無法更改
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="name" className="text-sm font-medium">
                      顯示名稱
                    </label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      disabled={profileLoading}
                      placeholder="您的名稱"
                    />
                  </div>

                  {profileError && (
                    <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md">
                      {profileError}
                    </div>
                  )}

                  {profileSuccess && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-md flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      個人資料已更新
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={profileLoading || name === user?.name}
                    className="w-full"
                  >
                    {profileLoading ? "更新中..." : "儲存變更"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="security" className="space-y-4 mt-6">
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="current-password" className="text-sm font-medium">
                      目前密碼
                    </label>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      disabled={passwordLoading}
                      placeholder="輸入目前的密碼"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="new-password" className="text-sm font-medium">
                      新密碼
                    </label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      disabled={passwordLoading}
                      placeholder="至少 8 碼，含大小寫/數字/符號"
                      required
                    />
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
                    <label htmlFor="confirm-new-password" className="text-sm font-medium">
                      確認新密碼
                    </label>
                    <Input
                      id="confirm-new-password"
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      disabled={passwordLoading}
                      placeholder="再次輸入新密碼"
                      required
                    />
                  </div>

                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md">
                      {passwordError}
                    </div>
                  )}

                  {passwordSuccess && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-md flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      密碼已成功更新
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-md">
                    <p className="font-medium mb-1">密碼需求：</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>至少 8 個字元</li>
                      <li>包含大寫字母、小寫字母、數字和特殊符號</li>
                    </ul>
                  </div>

                  <Button
                    type="submit"
                    disabled={
                      passwordLoading ||
                      !currentPassword ||
                      !newPassword ||
                      !confirmPassword
                    }
                    className="w-full"
                  >
                    {passwordLoading ? "更新中..." : "更新密碼"}
                  </Button>
                </form>

                <div className="pt-4 mt-4 border-t border-border/40">
                  <TwoFactorSettings />
                </div>
              </TabsContent>

              <TabsContent value="activity" className="space-y-4 mt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium">最近登入記錄</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        查看您的帳號登入活動
                      </p>
                    </div>
                  </div>

                  {loginHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">尚無登入記錄</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {loginHistory.map((record) => (
                        <div
                          key={record.id}
                          className="flex items-start gap-3 p-3 border rounded-lg"
                        >
                          <div className="mt-0.5">
                            <Monitor className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">
                                {record.device || "Unknown"} · {record.browser || "Unknown"}
                              </span>
                              {record.success ? (
                                <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                                  成功
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                                  失敗
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {record.os} · {record.ipAddress || "Unknown IP"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(record.createdAt).toLocaleString("zh-TW", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-md">
                    <p className="font-medium mb-1">🔒 安全提示</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>如果發現可疑的登入活動，請立即更改密碼</li>
                      <li>定期檢查您的登入記錄以確保帳號安全</li>
                    </ul>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
