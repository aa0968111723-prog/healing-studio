# Railway 環境變數設定清單

> 部署到 Railway 後，在 **Variables** 分頁逐一貼入以下變數

---

## 🔴 必填（沒有就無法啟動）

| 變數名稱       | 值                               | 說明                       |
| -------------- | -------------------------------- | -------------------------- |
| `NODE_ENV`     | `production`                     | 固定填這個                 |
| `PORT`         | `3000`                           | Railway 會自動覆蓋，但先填 |
| `JWT_SECRET`   | _(見下方生成方式)_               | 至少 32 字元隨機字串       |
| `DATABASE_URL` | `mysql://user:pass@host:3306/db` | MySQL 連線字串             |

### 生成 JWT_SECRET（複製以下任一個）

```
healing-studio-prod-jwt-2024-xK9mR3nQ
```

或到 Railway → Variables → 直接貼入

---

## 🟡 Google OAuth（登入功能用）

| 變數名稱               | 說明                                         |
| ---------------------- | -------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | 從 Google Cloud Console 取得                 |
| `GOOGLE_CLIENT_SECRET` | 從 Google Cloud Console 取得                 |
| `GOOGLE_REDIRECT_URI`  | `https://你的Railway網址/api/oauth/callback` |

---

## 🟢 AI 服務 API（功能性，非必要啟動）

| 變數名稱               | 取得網址                                    |
| ---------------------- | ------------------------------------------- |
| `GEMINI_API_KEY`       | https://aistudio.google.com/apikey          |
| `FAL_API_KEY`          | https://fal.ai/dashboard/keys               |
| `REPLICATE_API_TOKEN`  | https://replicate.com/account/api-tokens    |
| `ELEVENLABS_API_KEY`   | https://elevenlabs.io/app/settings/api-keys |
| `SUNO_API_KEY`         | Suno 開發者控制台                           |
| `PINECONE_API_KEY`     | https://app.pinecone.io                     |
| `PINECONE_ENVIRONMENT` | `us-east-1`                                 |
| `PINECONE_INDEX_NAME`  | `ai-director-memories`                      |
| `NEWS_API_KEY`         | https://newsapi.org/account                 |
| `NEWSDATA_API_KEY`     | https://newsdata.io                         |

---

## 📋 Railway MySQL 設定步驟

1. Railway Dashboard → **+ New** → **Database** → **MySQL**
2. 建立完後點擊 MySQL 服務 → **Variables**
3. 複製 `DATABASE_URL` 的值
4. 貼到你的 App 服務的 Variables 裡

---

## 🌐 Google OAuth URI 填法

Railway 部署完成後會給你一個網址，例如：
`https://healing-studio-production.up.railway.app`

填入 Google Cloud Console：

- **已授權的 JavaScript 來源**：`https://healing-studio-production.up.railway.app`
- **已授權的重新導向 URI**：`https://healing-studio-production.up.railway.app/api/oauth/callback`
