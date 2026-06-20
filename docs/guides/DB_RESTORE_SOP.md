<!-- AIDV-57 Database Backup & Restore SOP -->

# 資料庫備份與還原 SOP

> 寫給工程小白 Bruce 的白話操作手冊。
> 「每天自動備份正式資料庫、需要時把某一天的備份還原回來」就照這份做。
>
> 對齊真實設定：
> - 每日備份由 `server/jobs/dbSnapshotJob.ts` 的 cron 執行（已掛進
>   `server/_core/index.ts` 的 `SCHEDULED_MAINTENANCE_JOBS`）。
> - 備份檔上傳到 **Cloudflare R2**（reuse 既有 `S3_*` 設定，和媒體檔同一個 bucket，
>   但放在 `db-backups/` 路徑下）。
> - 備份用 `mysqldump --single-transaction`：**只讀、不鎖表**，對線上服務零影響。
> - 旗標 `ENABLE_DB_BACKUP` 預設 **ON**（沒設＝有備份）。

---

## 0. 先搞懂三個詞

- **備份（Backup / dump）**：把整個資料庫「當下的內容」匯出成一個 `.sql` 文字檔
  （裡面是一堆 `CREATE TABLE` + `INSERT`），再壓成 `.sql.gz`。我們每天自動做一次。
- **還原（Restore）**：把某個 `.sql.gz` 灌回「一個 MySQL 資料庫」，讓它變回備份當下的樣子。
- **Scratch（拋棄式）資料庫**：一個「臨時、空的、隨時可刪」的資料庫，專門拿來「還原＋檢查」用。
  **我們永遠先還原到 scratch 驗證，確認沒問題了，才考慮切換正式庫。**

> ⚠️ **最重要的一條鐵則**：
> **絕對不要直接把備份「蓋回」正在服務的正式資料庫。**
> 還原是「整包灌入」，灌錯/灌舊會把現有資料覆蓋掉、救不回來。
> 正確做法永遠是：**先還原到一個新的（空的）資料庫 → 檢查對不對 → 再決定要不要切換**。

---

## 1. 每天的自動備份是怎麼跑的（你不用做事，只要會看）

### 1.1 流程

```
每天 02:00（容器本地時間，Railway 預設 UTC）
   └─ mysqldump 讀正式庫（--single-transaction：一致快照、不鎖表）
        └─ 即時壓縮 gzip（串流，不佔記憶體）
             └─ 上傳 R2：db-backups/<庫名>/<庫名>_<時間戳>.sql.gz
```

- key 範例：`db-backups/healing_studio/healing_studio_2026-06-21T18-00-00-000Z.sql.gz`
- 因為 key 帶「時間戳」，每天都是**新檔案、不會互相覆蓋**（時間戳累積保留）。

### 1.2 怎麼確認「今天有備份成功」

**看 Railway log**：搜尋 `[DbBackup]`，正常會看到一行：

```
[DbBackup] ✅ 備份完成（1234ms，1820.5 KB gzip）→ r2://<bucket>/db-backups/healing_studio/healing_studio_2026-...Z.sql.gz
```

看到 `❌ 備份失敗` 或 `⏭️ 跳過` 時的對照表：

| log 內容 | 意思 | 要不要處理 |
|---|---|---|
| `✅ 備份完成` | 成功 | 不用 |
| `⏭️ ENABLE_DB_BACKUP=false，跳過` | 旗標被關了 | 想要備份就把它設回 `true`（或刪掉這個變數） |
| `⚠️ 未設定 DATABASE_URL` | 這台沒有資料庫（demo） | 正常，不用理 |
| `⚠️ R2 環境變數未設定` | 沒地方上傳 | 確認 Railway 有 `S3_ENDPOINT` 等四個變數 |
| `❌ 備份失敗（不影響服務）：...` | dump 或上傳出錯 | 看後面的錯誤訊息；服務不會掛，但要找原因（見第 6 節） |

> 備份失敗**不會讓網站掛掉**（fail-safe）：它只記 log（和 Sentry，如果有開），然後安靜跳過，
> 等明天再試。但你還是該去看一下為什麼失敗。

### 1.3 怎麼在 R2 上看到備份檔

- 進 Cloudflare Dashboard → R2 → 你的 bucket → 進 `db-backups/healing_studio/` 資料夾，
  會看到一堆按時間排的 `.sql.gz`。最新那個就是最近一次的備份。

---

## 2. 怎麼下載某一天的備份檔

你需要 R2 的存取金鑰（就是 Railway 裡那組 `S3_*`）。在你電腦上裝 AWS CLI 後：

```bash
# 1) 設定 R2 端點與金鑰（一次性；值去 Railway → Variables 抄）
export AWS_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID 的值>
export AWS_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY 的值>
export R2_ENDPOINT=<S3_ENDPOINT 的值>   # 形如 https://<account>.r2.cloudflarestorage.com
export R2_BUCKET=<S3_BUCKET_NAME 的值>

# 2) 列出有哪些備份（看時間挑一個）
aws s3 ls "s3://$R2_BUCKET/db-backups/healing_studio/" \
  --endpoint-url "$R2_ENDPOINT"

# 3) 下載你要的那一天（把檔名換成上一步看到的）
aws s3 cp \
  "s3://$R2_BUCKET/db-backups/healing_studio/healing_studio_2026-06-21T18-00-00-000Z.sql.gz" \
  ./restore.sql.gz \
  --endpoint-url "$R2_ENDPOINT"
```

> 沒有 AWS CLI 也可以：用 Cloudflare R2 後台網頁，直接點那個 `.sql.gz` 檔「Download」。

---

## 3. 還原到「新資料庫」並驗證（本機 Docker 版，最安全、推薦先這樣練）

這節用 repo 自帶的本機 Docker MySQL（`dev-environment/docker-compose.yml`）當「新資料庫」，
**完全不碰正式庫**。

### 3.1 起本機 DB

```bash
cd dev-environment
docker compose up -d mysql      # 起 aidv-mysql（mysql:8.4）
# 連線資訊（compose 裡寫死的本機開發帳密）：
#   root 密碼：root_dev_pw
#   一般帳號：hs / hs_dev_pw
#   主庫：    healing_studio
```

### 3.2 建一個「拋棄式 scratch 資料庫」，把備份灌進去

> 用 **root** 來建新庫＋灌資料（一般帳號 `hs` 只有 `healing_studio` 的權限，建不了新庫）。

```bash
# 1) 建空的 scratch 庫（名字帶日期，方便辨識，用完就刪）
docker exec aidv-mysql mysql -uroot -proot_dev_pw -e \
  "DROP DATABASE IF EXISTS healing_studio_restore_drill;
   CREATE DATABASE healing_studio_restore_drill
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2) 把下載的 restore.sql.gz 解壓後灌進 scratch 庫
#    （-i 把本機檔案餵進容器內的 mysql）
gunzip -c restore.sql.gz | \
  docker exec -i aidv-mysql mysql -uroot -proot_dev_pw healing_studio_restore_drill
```

### 3.3 驗證還原成功（對表數、對列數）

```bash
# 還原後的表數（應該等於備份來源的表數，目前約 70 張）
docker exec aidv-mysql mysql -uroot -proot_dev_pw -N -e \
  "SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='healing_studio_restore_drill';"

# 抽幾張關鍵表用「精確 COUNT(*)」對列數（TABLE_ROWS 只是估算，別用它判對錯）
docker exec aidv-mysql mysql -uroot -proot_dev_pw -N -e \
  "SELECT COUNT(*) FROM healing_studio_restore_drill.users;"
docker exec aidv-mysql mysql -uroot -proot_dev_pw -N -e \
  "SELECT COUNT(*) FROM healing_studio_restore_drill.digital_asset_library;"
```

- ✅ 表數一致、關鍵表 `COUNT(*)` 合理（和你預期的資料量對得上）＝ 還原成功。

### 3.4 用完一定要刪 scratch（清理）

```bash
docker exec aidv-mysql mysql -uroot -proot_dev_pw -e \
  "DROP DATABASE IF EXISTS healing_studio_restore_drill;"
```

---

## 4. 還原到「正式環境的新 DB」（Railway 版，需要時才做，務必小心）

> 用途：正式庫壞了、或要「換一個乾淨的庫」。**永遠是「還原到新庫 → 驗證 → 切流量」，
> 不是「蓋回舊庫」。** 這步偏維運、由 Bruce 在有人陪同時操作。

大方向（細節依當時 Railway 介面為準）：

1. 在 Railway 專案裡 **新增一個 MySQL 服務**（全新、空的），拿到它的連線字串。
2. 在你電腦上，把第 2 節下載的 `restore.sql.gz` 灌進**那個新庫**（不是現役庫）：
   ```bash
   gunzip -c restore.sql.gz | mysql -h <新庫host> -P <port> -u <user> -p <新庫名>
   #   ↑ 密碼會跳出來互動輸入，或用 MYSQL_PWD 環境變數帶（不要寫在指令列被 log）
   ```
3. 用第 3.3 節的方法**對表數、對列數**，確認新庫資料正確。
4. 確認無誤後，才把 app 的 `DATABASE_URL` 指到新庫、重新部署。**舊庫先留著別刪**
   （留幾天當保險），確定新庫穩了再清。

> ⚠️ 再強調：步驟 2 灌的是**新建的空庫**。**任何時候都不要對「正在服務的正式庫」執行
> 還原 / `DROP` / 覆蓋。**

---

## 5. 還原演練結果（本卡實際在 Docker 跑過一次，下面是真實數據）

> 這不是紙上談兵：AIDV-57 用上面第 3 節的流程，在本機 Docker（`aidv-mysql`, mysql:8.4）
> 實際跑了一次「dump → gzip → 還原到 scratch 庫 → 對數」。

| 項目 | 結果 |
|---|---|
| dump 指令 | 與 `dbSnapshotJob.ts` 的 `buildMysqldumpArgs` 完全一致（`--single-transaction --quick --lock-tables=false --routines --triggers --events ...`） |
| dump 是否鎖表 / 寫入來源 | 否（`--single-transaction` 唯讀一致快照）；演練後來源庫資料未被更動 |
| gzip 後大小 | 14,840 bytes（測試庫 70 張表、其中 `users` 預先塞了 7 筆測試列） |
| 密碼是否外洩到 dump / log | **否**（grep `hs_dev_pw` 於 dump 內 = 0 次；密碼走 `MYSQL_PWD`，不進 argv） |
| 還原到 scratch 庫 | exit 0，無錯誤 |
| 表數對比 | 來源 **70** ＝ 還原 **70** ✅ |
| 關鍵表列數對比（`users`，精確 `COUNT(*)`） | 來源 **7** ＝ 還原 **7** ✅，且抽樣列（`drill-001` / `d1@example.com`）正確還原 |
| 全表「是否有表在還原後消失」 | 0 張消失（70 張全到齊） |
| 清理 | scratch 庫已 `DROP`、測試列已刪、暫存檔已移除（環境回到演練前狀態） |

**結論：dump→還原→驗證 全流程通過。** 備份檔可用、還原可行、來源庫不受影響。

> 註：演練的來源是「本機 Docker 庫」而非正式 Railway 庫（安全鐵則：演練只在 scratch/Docker，
> 絕不對 prod 還原）。正式庫的還原走第 4 節、由 Bruce 在維運時段操作。

---

## 6. 備份失敗時怎麼查（fail-safe，網站不會掛，但要找原因）

`takeDbBackup()` 設計成**永不 throw**：任何失敗都收斂成 log + Sentry，cron 照常下次再跑。
常見原因：

| log 訊息片段 | 可能原因 | 處理 |
|---|---|---|
| `mysqldump exited with code 2` + `Access denied` | DB 帳密錯 / 權限不足 | 檢查 `DATABASE_URL`；備份帳號至少要 `SELECT`, `LOCK TABLES`(可免), `SHOW VIEW`, `TRIGGER`, `EVENT` |
| `mysqldump ... ENOENT` / `spawn mysqldump` | 容器內沒有 mysqldump | 確認 Dockerfile runner 階段有 `apk add mariadb-client`（本卡已加） |
| `backup file is empty (0 bytes)` | dump 沒輸出 | 通常伴隨上一行的真正錯誤；看 `mysqldump exited ...` 那段 stderr |
| R2 上傳相關（`PutObject` / 連線錯誤） | R2 金鑰失效 / 網路 / bucket 不存在 | 對齊 Railway 的 `S3_*` 變數；確認 bucket 存在 |
| `column-statistics` 之類相容性錯 | server/client 版本差異 | 指令已帶 `--column-statistics=0` 規避；若仍出現，回報以調整 |

---

## 7. 保留策略（目前作法 + 未來可加）

- **目前**：時間戳累積——每天一個新檔，永久保留在 R2（不自動刪）。簡單、不會誤刪。
- **想省空間時**（可選，未實作）：
  - 在 Cloudflare R2 對 `db-backups/` 前綴設一條 **Lifecycle rule**（例如「物件超過 30 天自動刪除」），
    這是最省事、零程式的作法。
  - 或之後加一支清理 cron：保留最近 N 天 + 每月 1 號各一份。
- 真要做保留策略前，先想清楚「最久要能還原到幾天前」。

---

## 8. Bruce 待辦（重要：請逐項確認）

> 本卡（AIDV-57）做的是「**應用層**每日把 DB dump 到 R2」。這和「**Railway/雲端供應商
> 自己的資料庫自動備份**」是**兩道獨立保險**，建議兩個都開（雙保險）。

- [ ] **① 確認 Railway MySQL 內建自動備份有開**
  - 進 Railway → 專案 `fantastic-love` → MySQL 服務 → 找 **Backups**（或 Settings 裡的 Backups）分頁。
  - 確認「自動備份」是開的、頻率（每日）與保留天數符合你的需求；可手動按一次「Backup now」測試。
  - 把「在哪開、保留幾天」記在這裡：`____________________`（填完把這行打勾）。
  - 註：Railway 的內建備份能力依方案/外掛而異；若該服務沒有內建備份 UI，本卡的 R2 每日備份
    就是主力，請務必確認第 ② 項的變數都在。
- [ ] **② 確認 R2 變數都在 Railway**（本卡備份要用）
  - `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET_NAME` 四個都有值。
  - 部署後看一次 log，確認出現 `[DbBackup] ✅ 備份完成`（或手動觸發驗證，見開發備註）。
- [ ] **③（可選）決定保留策略**：要不要在 R2 設 30 天 lifecycle 自動清舊備份（見第 7 節）。

---

## 9. 開發者備註（給之後接手的人）

- 程式碼：`server/jobs/dbSnapshotJob.ts`（job）、掛載點 `server/_core/index.ts`
  （`SCHEDULED_MAINTENANCE_JOBS` 陣列裡的 `dbSnapshotJob`）。
- 旗標：`ENABLE_DB_BACKUP`（預設 ON；`false`/`0`/`off`/`no` 才關）。
- 安全要點：密碼走 `MYSQL_PWD`（不進 argv、不進 log）；`--single-transaction` 唯讀不鎖表；
  demo/無 `DATABASE_URL`/無 R2 自動跳過；失敗永不 throw。
- 想本機手動觸發測試：在有 `DATABASE_URL` + `S3_*` 的環境，呼叫 `takeDbBackup()` 即可
  （它回傳 `{ status, key, bytesUploaded }`，不需要等 cron 到點）。
- 無 schema / migration：本卡純 job + 文件，不改任何資料表結構。
