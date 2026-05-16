# Google OAuth 登入問題排查指南

本文件提供完整的 Google OAuth 登入問題診斷與修復流程。

---

## 🔍 問題現象

在正式站 `https://director.today` 點選「以 Google 登入」後：
- Google 視窗授權看起來成功
- 但回到網站後仍然是未登入狀態（沒有看到工作室頁面）
- 頁面沒有明確錯誤訊息（或有顯示錯誤訊息）

---

## 📋 診斷檢查清單

### 1. 檢查環境變數設定

在 Railway（或其他部署平台）的環境變數中，確認以下設定：

#### ✅ 必要變數

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://director.today/api/oauth/callback
DATABASE_URL=mysql://user:pass@host:3306/database
JWT_SECRET=your-secret-key-at-least-32-chars
```

#### ⚠️ 常見錯誤

- ❌ `GOOGLE_REDIRECT_URI` 未設定（會使用預設值 `http://localhost:3000/api/oauth/callback`）
- ❌ `GOOGLE_REDIRECT_URI` 使用 HTTP 而非 HTTPS
- ❌ `GOOGLE_REDIRECT_URI` 包含尾部斜線（`/api/oauth/callback/`）
- ❌ `DATABASE_URL` 未設定或連線失敗
- ❌ `JWT_SECRET` 未設定或太短

---

### 2. 檢查 Google Cloud Console 設定

前往 [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)

#### ✅ OAuth 2.0 用戶端設定

1. **應用程式類型**：Web application
2. **已授權的 JavaScript 來源**：
   - `https://director.today`
3. **已授權的重新導向 URI**：
   - `https://director.today/api/oauth/callback`

#### ⚠️ 常見錯誤

- ❌ 重新導向 URI 不完全匹配（大小寫、http vs https、有無尾部斜線）
- ❌ 未在「已授權的 JavaScript 來源」中加入正式網域
- ❌ 使用錯誤的 Client ID 或 Secret（測試環境 vs 正式環境）

---

### 3. 檢查日誌 (Logs)

#### 在 Railway Dashboard 查看日誌

前往 **Railway → Your App → Deployments → View Logs**

#### 關鍵日誌標記

所有 OAuth 相關日誌都有明確前綴，方便搜尋：

```bash
[GoogleAuth] Building Google auth URL
[OAuth] Callback received
[GoogleAuth] Exchanging code for tokens
[OAuth] User info retrieved
[OAuth] Upserting user to database
[Cookies] Session cookie options
[OAuth] Setting session cookie
[OAuth] Login successful, redirecting to: /
[Auth] Authenticating request
```

#### 常見錯誤日誌模式

##### A. 缺少環境變數

```
[GoogleAuth] GOOGLE_CLIENT_ID not configured
```

**解決方案**：在 Railway 環境變數中設定 `GOOGLE_CLIENT_ID`

##### B. Token 交換失敗（redirect_uri_mismatch）

```
[GoogleAuth] Token exchange failed {
  status: 400,
  error: "redirect_uri_mismatch"
}
```

**解決方案**：
1. 檢查環境變數 `GOOGLE_REDIRECT_URI` 是否正確
2. 檢查 Google Cloud Console 的「已授權的重新導向 URI」是否完全匹配

##### C. Cookie 未正確設定

```
[Cookies] Session cookie options {
  hostname: 'director.today',
  secure: false,  // ⚠️ 應該是 true
  sameSite: 'lax'
}
```

**解決方案**：確保 Railway 有正確設定 `x-forwarded-proto: https` header

##### D. 使用者登入後找不到帳號

```
[Auth] User not found in database { openId: 'google-user-id' }
```

**解決方案**：檢查 `DATABASE_URL` 是否正確，資料庫是否可連線

---

### 4. 檢查前端錯誤提示

如果前端顯示錯誤訊息，對應如下：

| 錯誤代碼 | 訊息 | 可能原因 |
|---------|------|---------|
| `oauth_config_error` | Google 登入未設定，請聯繫管理員 | `GOOGLE_CLIENT_ID` 未設定 |
| `auth_denied` | 您已取消 Google 授權 | 使用者在 Google 頁面點擊「取消」 |
| `missing_code` | Google 登入流程異常 | Google 未回傳 authorization code |
| `missing_google_user_id` | 無法取得 Google 帳號資訊 | Google UserInfo API 未回傳 `sub` |
| `oauth_failed` | Google 登入失敗 | Token 交換失敗或資料庫錯誤 |

---

### 5. Cookie 檢查（瀏覽器開發者工具）

1. 打開瀏覽器 DevTools (F12)
2. 前往 **Application** → **Cookies** → `https://director.today`
3. 檢查是否有 Cookie 名稱為 `hs_session` (或您設定的 COOKIE_NAME)

#### ✅ 正常的 Cookie 屬性

```
Name: hs_session
Value: eyJhbGc...  (JWT token)
Domain: director.today
Path: /
Secure: ✓ (HTTPS only)
HttpOnly: ✓
SameSite: None (for HTTPS) or Lax (for HTTP)
```

#### ⚠️ 常見問題

- ❌ 沒有 Cookie：OAuth callback 設定 cookie 失敗
- ❌ `Secure` 未勾選：後端未正確偵測 HTTPS
- ❌ `SameSite=Strict`：過於嚴格，可能導致跨域問題

---

### 6. Network 面板檢查（瀏覽器開發者工具）

1. 打開 DevTools → **Network** 分頁
2. 清除所有記錄
3. 點擊「以 Google 登入」
4. 觀察以下請求：

#### ✅ 正常流程

```
1. GET /api/oauth/google/start
   → Status: 302 Redirect to Google

2. (在 Google 頁面授權)

3. GET /api/oauth/callback?code=...&state=...
   → Status: 302 Redirect to /
   → Set-Cookie: hs_session=...

4. GET /
   → Cookie: hs_session=...
   → 已登入狀態
```

#### ⚠️ 異常模式

- ❌ `/api/oauth/callback` 回傳 `302` 但沒有 `Set-Cookie`
- ❌ `/api/oauth/callback` 回傳 `error=oauth_failed`
- ❌ 回到首頁後的請求沒有帶 `Cookie: hs_session`

---

## 🔧 修復步驟

### Step 1: 確認環境變數

在 Railway Dashboard:

```bash
# 檢查
GOOGLE_CLIENT_ID=已設定 ✓
GOOGLE_CLIENT_SECRET=已設定 ✓
GOOGLE_REDIRECT_URI=https://director.today/api/oauth/callback
DATABASE_URL=已設定 ✓
JWT_SECRET=已設定 ✓
```

### Step 2: 更新 Google Cloud Console

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. 選擇對應的 OAuth 2.0 Client ID
3. 在「已授權的重新導向 URI」中**精確**加入：
   ```
   https://director.today/api/oauth/callback
   ```
4. 點擊「儲存」

### Step 3: 重新部署應用

在 Railway:
1. 儲存環境變數後，應用會自動重新部署
2. 或手動點擊 **Redeploy**

### Step 4: 清除瀏覽器狀態

1. 打開 DevTools (F12)
2. **Application** → **Cookies** → 刪除所有 `director.today` 的 cookies
3. **Application** → **Local Storage** → 清除 `director.today` 的資料
4. 關閉 DevTools，重新整理頁面

### Step 5: 測試登入流程

1. 點擊「以 Google 登入」
2. 在 Google 頁面選擇帳號並授權
3. 觀察日誌輸出（Railway Logs）
4. 確認成功登入並看到工作室頁面

---

## 📊 成功登入的完整日誌範例

```
[GoogleAuth] Building Google auth URL {
  redirectUri: 'https://director.today/api/oauth/callback',
  redirectAfter: '/',
  hasClientId: true
}

[OAuth] Callback received {
  hasCode: true,
  hasState: true,
  errorParam: 'none',
  hostname: 'director.today',
  protocol: 'https',
  forwardedProto: 'https'
}

[OAuth] Exchanging code for tokens...

[GoogleAuth] Exchanging code for tokens {
  redirectUri: 'https://director.today/api/oauth/callback',
  codeLength: 106
}

[OAuth] Token exchange successful

[OAuth] Fetching user info...

[OAuth] User info retrieved {
  sub: '1234567890',
  email: 'user@gmail.com',
  emailVerified: true
}

[OAuth] Upserting user to database... {
  openId: '1234567890',
  email: 'user@gmail.com'
}

[OAuth] User upserted successfully

[OAuth] Creating session token...

[Cookies] Session cookie options {
  hostname: 'director.today',
  secure: true,
  sameSite: 'none',
  protocol: 'https',
  forwardedProto: 'https'
}

[OAuth] Setting session cookie {
  cookieOptions: { httpOnly: true, path: '/', sameSite: 'none', secure: true },
  cookieName: 'hs_session',
  maxAge: 31536000000
}

[OAuth] Login successful, redirecting to: /

[Auth] Authenticating request {
  hasCookie: true,
  hasSessionToken: true,
  isDemoMode: false,
  hostname: 'director.today'
}

[Auth] Fetching user from database { openId: '1234567890' }

[Auth] User authenticated successfully {
  userId: 42,
  email: 'user@gmail.com',
  loginMethod: 'google'
}
```

---

## 🆘 仍然無法登入？

### 進階診斷

1. **檢查 Railway 日誌是否有其他錯誤**
   ```bash
   # 搜尋關鍵字
   [OAuth]
   [GoogleAuth]
   [Cookies]
   [Auth]
   ERROR
   ```

2. **檢查資料庫連線**
   ```bash
   # 在 Railway Shell 執行
   echo $DATABASE_URL
   mysql -h <host> -u <user> -p<password> <database> -e "SHOW TABLES;"
   ```

3. **檢查 Google OAuth Quota**
   - 前往 [Google Cloud Console - APIs](https://console.cloud.google.com/apis/dashboard)
   - 檢查 Google+ API 是否啟用
   - 檢查 OAuth 配額是否用盡

4. **測試本地環境**
   ```bash
   # 在本地啟動
   GOOGLE_CLIENT_ID=xxx \
   GOOGLE_CLIENT_SECRET=yyy \
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/callback \
   DATABASE_URL=xxx \
   JWT_SECRET=xxx \
   npm run dev
   ```

### 聯絡支援

如果以上步驟都無法解決，請提供：
1. Railway 日誌（完整的 OAuth 流程日誌）
2. 瀏覽器 DevTools Network 截圖
3. 環境變數清單（不含敏感資訊）
4. Google Cloud Console 的 OAuth Client 設定截圖

---

## 📚 參考資料

- [Google OAuth 2.0 文件](https://developers.google.com/identity/protocols/oauth2)
- [Railway 環境變數設定](https://docs.railway.app/develop/variables)
- [Express Cookie 設定](https://expressjs.com/en/api.html#res.cookie)
- [JWT 最佳實踐](https://tools.ietf.org/html/rfc7519)
