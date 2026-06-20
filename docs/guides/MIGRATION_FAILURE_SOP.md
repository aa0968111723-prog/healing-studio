<!-- AIDV-61 H6 Migration Failure & Rollback SOP -->

# Migration 失敗判讀與 Railway 回滾 SOP

> 寫給工程小白 Bruce 的白話操作手冊。
> 當「資料庫 migration（資料表結構升級）失敗、或部署後網站怪怪的」時，照這份做。
>
> 對齊真實設定：
> - Railway 從 GitHub `main` 分支**自動 build & deploy**（push 到 main 就會出新版本）。
> - 健康檢查路徑：`/api/health`（見 `railway.toml`，逾時 120 秒、失敗自動重啟最多 3 次）。
> - 本卡新增旗標：`MIGRATION_FAIL_CLOSED`（預設關，見下方第 4 節）。

---

## 0. 先搞懂兩個詞

- **Migration（遷移）**：把資料庫的「資料表結構」往前升級的小腳本（放在 repo 的 `drizzle/` 資料夾，
  檔名像 `0075_xxx.sql`）。開機時程式會自動把「還沒套用過的」依序套上去。
- **回滾（Rollback）**：把線上網站「退回上一個正常的版本」。Railway 保留每次部署的完整 image，
  所以退回去就是「重新啟用舊版本那一顆 image」，**很快、很安全**。

> 重點觀念：**回滾「程式」很安全；回滾「資料庫結構」很危險。**
> 本 SOP 的回滾指的是「退回上一版程式 image」。如果某個 migration 已經改壞了資料表，
> 光退程式不一定能救資料——所以**寧可在出問題的當下擋住啟動**，不要讓壞掉的版本繼續服務（這就是 `MIGRATION_FAIL_CLOSED` 的用途）。

---

## 1. 怎麼看出「migration 失敗了」

### A. 看部署 log（最直接）

1. 開 Railway Dashboard → 你的專案 → 點 App 服務（不是 MySQL 那顆）。
2. 進 **Deployments** 分頁 → 點最新那次部署 → 看 **Deploy Logs / Logs**。
3. 搜尋這幾行關鍵字：

   | 看到這行 | 代表 |
   | --- | --- |
   | `[Database] Checking for pending migrations…` | 開始套用 migration |
   | `[Database] Migrations applied successfully.` | ✅ **成功**（正常） |
   | `[Database] Migration failed: …` | ❌ **失敗**（要處理） |
   | `[Database][FATAL] Migration apply failed and MIGRATION_FAIL_CLOSED is enabled …` | ❌ 失敗，且已開 fail-closed → 程式**主動擋啟動** |
   | `[Database] orphaned migration SQL files …` | ⚠️ 有 SQL 檔沒登記到 `_journal.json`（drizzle 會跳過它，通常不是當下 crash 主因，但要記下來修） |

### B. 看 `/api/health`

- 用瀏覽器開 `https://你的網址/api/health`。
- 正常回 `{"ok":true,...}`。
- 若一直打不開 / Railway 顯示 deploy「unhealthy」→ 服務沒起來（fail-closed 開著且 migration 失敗時就會這樣，這是**預期行為**）。

### C. 預設（fail-closed 關）時的陷阱 ⚠️

- **預設情況下**（`MIGRATION_FAIL_CLOSED` 沒設或為 `false`），就算 migration 失敗，
  程式只會 log 一行 `Migration failed` 然後**照常啟動**、`/api/health` 仍回 ok。
- 也就是說：**健康檢查綠燈 ≠ migration 一定成功。** 一定要回去翻 log 找 `Migration failed`。
- 想讓「migration 失敗時自動變紅燈、被 Railway 抓到」→ 把旗標打開（第 4 節）。

---

## 2. 在 Railway 回滾到「上一個正常版本」

當新版本壞掉、要先止血時：

1. Railway Dashboard → App 服務 → **Deployments** 分頁。
2. 找出**上一個** status 是綠色 / `SUCCESS` 的部署（通常是壞掉那次的前一筆）。
3. 點該筆右側的 **⋮（三個點）→ Redeploy**（部署詳情頁也可能叫 **Rollback / Roll back to here**）。
   - 註：別跟 **Restore** 搞混——Railway 的 Restore 是「還原已刪除的服務／環境」，不是回滾部署。
   - 這會用「那一版的舊 image」重新啟動容器——舊版的 `dist/` 與 `drizzle/` 都原封不動，安全。
4. 等 1–2 分鐘，回到第 1 節 B 確認 `/api/health` 變回 ok、log 沒有 `Migration failed`。

> 替代法（從原始碼退）：到 GitHub 把 `main` `git revert` 掉壞掉那個 commit 再 push，
> Railway 會自動 build 出乾淨的新版本。**優先用 Dashboard 的 Redeploy 止血（快），事後再用 revert 清乾淨。**

### 回滾後一定要做的事

- 回到 log 找 `Migration failed: <錯誤訊息>`，看是哪一個 migration、什麼錯（SQL 語法錯？欄位/資料表衝突？）。
- 修好那個 `drizzle/00xx_*.sql` 後，再走正常流程 push 上去。
- 注意：**如果壞掉的 migration 已經把某個資料表改成一半**，單純退程式救不回資料，
  需要人工到 MySQL 補修（必要時找有 DB 經驗的人，先備份再動手）。

---

## 3. 常見根因與排查

| 症狀 / log | 可能原因 | 怎麼修 |
| --- | --- | --- |
| `You have an error in your SQL syntax` | migration SQL 寫錯 | 改 `drizzle/00xx_*.sql`，本機先用 Docker MySQL 跑過再 push |
| `Duplicate column` / `Table already exists` | 同一段結構被重複建 | 用 `information_schema` 先判斷存在與否再建（既有 migration 都這樣守門）|
| `orphaned migration SQL files …` | SQL 檔沒登記到 `drizzle/meta/_journal.json` | 補上 journal 條目；沒登記的檔 drizzle **不會執行**（歷史上 0071–0074 就是這樣漏掉，已於 AIDV-17 補登記 journal）|
| 啟動卡住 / 一直逾時 | migration 註解或內容讓 driver 卡死 | 見第 5 節「真實案例」 |

---

## 4. `MIGRATION_FAIL_CLOSED` 旗標：開還是關？

這個旗標決定「**migration 真的套用失敗時，程式該怎麼辦**」。

| 設定 | 行為 | 適合誰 |
| --- | --- | --- |
| **不設 / `false`（預設）** | **fail-open**：log 一行錯誤後**照常啟動**繼續服務。對現有 prod **零行為改變**。 | 想維持現狀、不想因為 migration 小問題就整站起不來 |
| **`true`** | **fail-closed**：印致命 log 後 **`process.exit(1)` 擋啟動** → `/api/health` 失敗 → Railway 判定 unhealthy → 自動重啟（最多 3 次）或讓你人工回滾 | 想要「壞了就大聲報、別讓半殘版本服務」、把問題第一時間擋在門外 |

### 取捨白話版

- **關（預設）的好處**：migration 出小狀況也不會讓整站掛掉，先撐著服務、慢慢修。
  **壞處**：可能「悄悄壞掉」——資料表沒升級成功，但網站看起來活著，要靠人去翻 log 才發現。
- **開的好處**：壞掉馬上變紅燈、馬上被你（或 Railway）發現，逼你回滾/修好才能上。
  **壞處**：任何 migration 失敗都會擋啟動，對「想先求有服務」的情境比較剛烈。

### 怎麼在 Railway 設定

1. Railway Dashboard → App 服務 → **Variables** 分頁。
2. **New Variable** → 名稱 `MIGRATION_FAIL_CLOSED`、值 `true`（要開）或 `false`（關，等於不設）。
   - 可接受的「開」寫法：`true` / `1` / `on` / `yes`（大小寫不拘）。其餘一律當成關。
3. 存檔後 Railway 會重啟服務套用。

### 安全保證（重要）

- **Demo / 沒設 `DATABASE_URL` 的情境完全不受這旗標影響。** 沒有資料庫就根本不會去跑 migration，
  所以不管旗標開或關，demo 都照常開機，**絕不會因為開了 fail-closed 而開不了機**。
- fail-closed **只在「真的去套用某個 migration 而失敗」時**才擋啟動；
  「已經套用過、重跑沒事」的冪等情況不會誤判（既有 migration 都用 `information_schema` 守門）。

---

## 5. 真實案例備忘：`--> statement-breakpoint` 卡死 prod（防呆）

**發生過什麼**：某些 migration 的**註解**裡寫了字面字串 `--> statement-breakpoint`。
drizzle 用 `--> statement-breakpoint` 當「把一個 SQL 檔切成多段執行」的分隔標記；
如果它出現在你不該放的地方（例如純註解行），切割就會錯亂，導致 migration 在 **prod 啟動時卡死**
（容器起不來、health check 一直逾時）。歷史上 `0067` / `0068` 就踩過這個雷、已修。

**防呆鐵則**：

- ✍️ **migration 檔的註解裡，永遠不要打字面 `--> statement-breakpoint`。**
  這個標記只能由 drizzle-kit 在正確位置自動產生，人不要手寫進註解。
- 🧪 新增 migration 後，**先在本機用 Docker MySQL 真的跑一次**（`npm run db:push` 或起 dev server 端到端），
  確認「Migrations applied successfully.」再 push 到 `main`。
- 🔎 Code review 時 grep 一下新 migration 有沒有混入這串字面（CI 也可加一條檢查）。
- 🚑 萬一又卡死：照第 2 節 Redeploy 回上一版止血，再回 `drizzle/` 把那個檔的註解清乾淨。

---

## 6. 一頁速查

```
壞了？
 ├─ 看 Railway → App → Deployments → Logs
 │    找 "Migration failed" / "[FATAL] … MIGRATION_FAIL_CLOSED"
 ├─ 開瀏覽器打 /api/health（綠？紅？— 但綠燈不代表 migration 成功！）
 ├─ 先止血：Deployments → 上一個綠色部署 → ⋮ → Redeploy
 ├─ 找根因：哪個 drizzle/00xx_*.sql、什麼錯
 ├─ 修好 SQL（本機 Docker MySQL 先跑過）→ push 到 main → 自動部署
 └─ 想「壞了就擋門」→ Variables 設 MIGRATION_FAIL_CLOSED=true
                       想維持現狀（撐著服務）→ 不設 / =false
```

---

相關檔案：
- `railway.toml` — healthcheck=`/api/health`、`restartPolicyType=ON_FAILURE`、`restartPolicyMaxRetries=3`
- `Dockerfile` — runner stage 複製 `dist/` 與 `drizzle/`（migration 檔隨 image 一起發版）
- `server/db.ts` — `applyMigrations()` 的 fail-closed catch、`isMigrationFailClosed()` 純判定
- `server/_core/index.ts` — bootstrap：fail-closed 時 `process.exit(1)` 擋啟動
- `server/_core/env.validated.ts` — `MIGRATION_FAIL_CLOSED` 旗標定義（預設 `"false"`）
- `docs/guides/DEPLOY_ENV_RAILWAY.md` — 環境變數總表（含本旗標）
