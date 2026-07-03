# GC3 — 憑證加密層深挖(connectionService + secretCrypto)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/subsystems/contextPackets/connectionService.ts(208)、server/_core/secretCrypto.ts

> 稽核方法:逐行讀完兩檔全文(`secretCrypto.ts` 126 行、`connectionService.ts` 208 行),
> 再對照既有稽核結論 S-17(`X10-connectors-deepdive.md` — Drive OAuth token 明文)、
> S-08(`00-discussion-taskcards.md:37` — `CREDENTIAL_ENCRYPTION_KEY` 靜默 fallback 到
> `JWT_SECRET`,已標「已確認(V3)」)與 CC0 的缺口盤點(`CC0-completeness-critic.md:58-62`,
> 指出這兩檔「從未被獨立稽核」)。用 grep 追下游呼叫鏈——`server/db.ts`(
> `createDataSourceConnection`/`getDataSourceConnection`/`updateDataSourceConnection`/
> `deleteDataSourceConnection`,含全 repo 呼叫端窮舉)、`drizzle/schema.ts`(
> `dataSourceConnections` 欄位定義)、`server/_core/googleAuth.ts`(`getJwtSecret`/
> `assertJwtSecretReady` 的 fail-fast 機制,供對照 secretCrypto 有無同等硬化)、
> `server/subsystems/contextPackets/adapters/external.ts`(Drive/Notion adapter 實際
> 消費 `decryptSecret` 的位置)、`server/subsystems/contextPackets/contextPacketRouter.ts`
> (對外 tRPC surface)、`.env.example`、以及三份既有 secretCrypto 單元測試
> (`secret-crypto.test.ts`/`secret-crypto-key-source.test.ts`/
> `secret-crypto-key-versioning.test.ts`)——用既有回歸測試的斷言反推機制邊界,
> 而非臆測。**本報告不輸出任何真實金鑰/密文/token 值,只描述演算法、金鑰來源與資料流。**

---

## 一、發現清單(依嚴重度排序)

### 1.〔HIGH · other〕S-08 機制深挖:`CREDENTIAL_ENCRYPTION_KEY` 未設時靜默 fallback 到 `JWT_SECRET`,導致「輪替 JWT_SECRET」這個常見資安應變動作會靜默且永久打壞所有既有 Notion 憑證,且無任何錯誤面向維運者浮現

- **檔案:行號**:`server/_core/secretCrypto.ts:44-51`(`resolveKeyMaterial` 的 k1 回退鏈)、
  `:57-67`(`getKeyById` 長度檢查與快取)、`:70-81`(`encryptSecret`)、`:83-120`
  (`decryptSecret`);對照 `server/_core/googleAuth.ts:56-82`(`getJwtSecret` 的
  production fail-fast 硬化)、`.env.example:20-22`。
- **證據**:

```ts
// server/_core/secretCrypto.ts:44-51
// k1: CREDENTIAL_ENCRYPTION_KEY → JWT_SECRET_RAW → JWT_SECRET
return (
  process.env.CREDENTIAL_ENCRYPTION_KEY ||
  process.env.JWT_SECRET_RAW ||
  process.env.JWT_SECRET ||
  ""
);
```

```
# .env.example:20-22 —— 官方範本把這個欄位留白,等於預設走 fallback 路徑
# 外部資料來源憑證加密金鑰(如 Notion token)。未設時回退用 JWT_SECRET。
# 建議獨立設定並用 openssl rand -base64 32 生成(>=16 字元)。
CREDENTIAL_ENCRYPTION_KEY=
```

  `resolveKeyMaterial("k1")` 直接讀 `process.env.JWT_SECRET`,**不經過**
  `googleAuth.ts` 的 `getJwtSecret()`——也就是說它繞過了 JWT 那邊「正式環境缺失/過短
  必須 fail-fast」的硬化邏輯,自己只做一個純長度檢查(`secret.length < 16`,
  `secretCrypto.ts:58-62`),沒有 production 專屬的額外把關。這代表:一旦
  `CREDENTIAL_ENCRYPTION_KEY` 未設(範本預設值),`secretCrypto` 用來加密/解密
  Notion token 的 AES-256 金鑰,實際上是「當下這一刻」的 `JWT_SECRET` 用固定 salt
  scrypt 導出的值。

  **這不是純理論疑慮——corpus 既有的回歸測試已經自證了這個機制的脆弱面**。
  `server/secret-crypto-key-source.test.ts:75-89` 的「回歸對照」測試明確示範:
  用密鑰 A 加密一筆資料後,只要 `JWT_SECRET` 的值改變(該測試模擬的是 trim 正規化,
  但機制上與「真的輪替 JWT_SECRET」完全等價——都是同一個 env var 的值變了),
  `decryptSecret` 就會因為 AES-256-GCM 的 auth tag 驗證失敗而 `throw`
  (`expect(() => decryptSecret(ciphertext)).toThrow()`)。而 AIDV-59 補的
  `JWT_SECRET_RAW` 相容分支,只解決「JWT_SECRET 因 trim 正規化而『看起來』變了但其實
  是同一把鑰匙」這個狹窄子情境,**完全沒有處理「JWT_SECRET 真的被輪替成全新隨機值」
  這個更常見、且是官方建議的資安應變動作**(例如懷疑 session 洩漏後主動輪替簽章密鑰)。

  兩個消費端遇到這個 throw 的處理方式都是「安靜吞掉」:
  - `connectionService.ts:189-194`(`runHealthCheck` 的 Notion 分支):
    `try { token = decryptSecret(...) } catch { return false; }` ——只會把
    connection 狀態標成 `"error"`(`connectionService.ts:171-174`),不記錄原因。
  - `adapters/external.ts:196-202`(`createNotionAdapter.collect`):
    `catch { return []; }`,註解直寫「憑證壞掉 → 安靜略過(health check 會標
    error)」。

  兩處都沒有任何日誌/告警把「解密失敗」與「有人剛剛動過 JWT_SECRET」關聯起來。
- **影響**:若部署遵照 `.env.example` 的預設(留白 `CREDENTIAL_ENCRYPTION_KEY`),
  平台實際上是用「登入簽章密鑰」兼職「憑證加密密鑰」。任何未來因常規資安維運
  (例如懷疑 token 外洩、例行輪替、換團隊交接密鑰)而更換 `JWT_SECRET` 的動作,
  會在毫無預警下讓**所有既有 Notion 連接的加密憑證永久解不開**——不是效能降級,
  是不可逆的資料遺失(沒有其他地方存有明文備份),使用者只會看到連接狀態默默變成
  `"error"`,對外沒有任何訊息指出根因是「JWT 密鑰被換掉了」。這使得「JWT_SECRET
  輪替」這個原本應該安全、獨立的資安動作,被意外綁死了 Notion 憑證這個完全不相關
  子系統的可用性,形成隱性耦合陷阱。
- **建議**:
  1. 生產環境的部署檢查/啟動腳本應明確要求 `CREDENTIAL_ENCRYPTION_KEY` 必填
     (仿照 `assertJwtSecretReady()` 的模式,替 secretCrypto 也做一個
     `assertCredentialEncryptionKeyReady()` 並在開機期呼叫,而非只在第一次
     `encryptSecret`/`decryptSecret` 呼叫時才 lazily 失敗)。
  2. `.env.example` 的 `CREDENTIAL_ENCRYPTION_KEY=` 留白預設值本身就是風險來源,
     建議改成強制填寫或至少加上更醒目的警語(目前的註解已提到 fallback,但沒有
     說明「fallback 用的 JWT_SECRET 一旦被輪替,既有憑證會永久解不開」這個具體
     後果)。
  3. 若短期內無法強制要求,至少在 `decryptSecret` catch 分支處(或呼叫端)補上
     結構化告警日誌(不含明文/金鑰),讓「憑證解密失敗」這個事件可被監控系統
     觀察到,而非完全靜默。

---

### 2.〔MEDIUM · security-idor〕AES-256-GCM 未使用 AAD 綁定密文與其所屬 connection/owner;`db.getDataSourceConnection`/`updateDataSourceConnection`/`deleteDataSourceConnection` 僅以 `id` 為 WHERE 條件,DB 層無 `ownerUserId` 雙重防線(對照 X10 記錄的 `drive.ts` 雙重條件模式)

- **檔案:行號**:`server/_core/secretCrypto.ts:70-120`(`encryptSecret`/`decryptSecret`
  全程無 `cipher.setAAD`/`decipher.setAAD` 呼叫)、`server/db.ts:3664-3675`
  (`getDataSourceConnection`,WHERE 僅 `eq(id)`)、`:3702-3712`
  (`updateDataSourceConnection`,WHERE 僅 `eq(id)`)、`:3714-3720`
  (`deleteDataSourceConnection`,WHERE 僅 `eq(id)`);對照
  `connectionService.ts:68-78`(`loadOwnedConnection`,app 層擁有權檢查,是目前
  唯一的防線)。
- **證據**:

```ts
// server/_core/secretCrypto.ts:70-81 —— encryptSecret,全程無 setAAD
export function encryptSecret(plaintext: string): string {
  const keyId = process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE ?? "k1";
  const key = getKeyById(keyId);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${keyId}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}
```

```ts
// server/db.ts:3702-3712 —— 更新/刪除僅以 id 為條件,不含 ownerUserId
export async function updateDataSourceConnection(
  id: number,
  patch: Partial<InsertDataSourceConnection>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(dataSourceConnections)
    .set(patch)
    .where(eq(dataSourceConnections.id, id));   // ← 無 ownerUserId 條件
}
```

  這與 X10 記下的姊妹系統模式不同:`X10-connectors-deepdive.md` 的 negative
  result #2 指出 `drive.ts` 的 `removeLibrary` 呼叫 `db.deleteDriveLibrary(id, userId)`,
  其 WHERE 用 `and(eq(id), eq(userId))`,是「路由層 + DB 層雙保險」。
  `data_source_connections` 這條路徑的三個 db 層函式(`getDataSourceConnection`/
  `updateDataSourceConnection`/`deleteDataSourceConnection`)完全沒有這層 DB 端
  binding,全部只在 service 層的 `loadOwnedConnection`(`connectionService.ts:68-78`)
  做一次性的 `row.ownerUserId !== userId` 檢查。

  同時,GCM 的 auth tag 只保證「密文本身」沒被竄改(`secret-crypto.test.ts:34-38`
  的竄改測試證實這點),但**不保證這段密文本來就該屬於這一列 DB row**——因為沒有
  `setAAD` 把 `connectionId`/`ownerUserId`/`keyId` 這類 context 值綁進認證範圍,
  一段完整、合法的 `v2:k1:<iv>:<tag>:<cipher>` 字串若被原樣複製貼到另一個
  `ownerUserId` 不同、但用同一把 `keyId`(絕大多數情況下就是同一把 k1 主鑰)的
  `data_source_connections` row 的 `encryptedCredentialRef` 欄位,`decryptSecret`
  會正常解出「原持有者的明文憑證」,不會偵測到「這不是我的密文」。
- **影響**:**在目前這份 commit 裡,全 repo 只有 `connectionService.ts` 這一個
  call site 會寫入/讀取 `encryptedCredentialRef`(已用 grep 對全 repo 含
  `client/`、`server/routers/`、`server/jobs/` 窮舉確認,唯一寫入路徑是
  `createConnection`,見下方 Negative Results 第 5 點),且沒有任何對外端點允許
  使用者直接提交/覆寫 `encryptedCredentialRef` 的原始值——因此密文跨列替換
  **目前不可透過任何已知已上線端點觸發**,不是立即可利用的漏洞。但這是一個
  典型的「單層防線」架構缺口:一旦未來任何新程式碼(後台工具、資料遷移腳本、
  批次匯入、或某個尚未寫的 admin 編輯端點)直接呼叫這三個 db 層函式而忘記先做
  `loadOwnedConnection` 等價檢查,就沒有任何密碼學層面的防線能攔下「A 使用者的
  密文被寫進 B 使用者的 row」這種資料誤植/竄改,而是會被 `decryptSecret` 正常
  解密、當作合法憑證使用——形成日後最容易被複製貼上程式碼時不小心引入的
  IDOR 類缺口。
- **建議**:
  1. 加密時用 `cipher.setAAD(Buffer.from(String(connectionId)))`(或
     `ownerUserId`,兩者擇一或並用),解密時同樣 `decipher.setAAD(...)` 傳入
     從 DB row 取得的同一個值——這樣任何跨 row 密文替換都會讓 GCM 驗證失敗,
     把「這段密文屬於哪一列」的保證從純 app 邏輯提升到密碼學層。
  2. 比照 `drive.ts`/`deleteDriveLibrary` 的雙保險模式,把
     `updateDataSourceConnection`/`deleteDataSourceConnection`/
     `getDataSourceConnection` 也改成接受 `ownerUserId` 並在 WHERE 子句一併
     比對,讓 DB 層本身也有一道獨立防線,不完全依賴呼叫端記得先查一次
     `loadOwnedConnection`。

---

### 3.〔MEDIUM · other〕scrypt 導出金鑰使用全域寫死、原始碼公開的固定 salt,且金鑰材料只做長度檢查、不做熵/複雜度檢查

- **檔案:行號**:`server/_core/secretCrypto.ts:28`(`SCRYPT_SALT` 常數定義)、
  `:64`(`crypto.scryptSync(secret, SCRYPT_SALT, KEY_LEN)`)、`:39,58`
  (長度檢查 `>= 16` / `< 16`,無其他熵驗證)。
- **證據**:

```ts
// server/_core/secretCrypto.ts:28
const SCRYPT_SALT = "healing-studio-cred-v1";
```

```ts
// server/_core/secretCrypto.ts:64 —— 所有 keyId(k1/k2/...)一律共用同一組 salt
const key = crypto.scryptSync(secret, SCRYPT_SALT, KEY_LEN);
```

  這個 salt 是原始碼裡的字面常數,對任何能讀到這份(或未來 fork 出去的)程式碼的人
  都是已知值,且**跨所有 keyId、跨所有安裝實例共用同一個 salt**——不是每次部署
  或每個 key 版本各自隨機產生。同時,唯一的金鑰材料檢查是
  `secret.length < 16`(字元數),沒有檢查是否為高熵隨機值(例如
  `"aaaaaaaaaaaaaaaa"` 這種 16 個重複字元的字串會直接通過檢查)。
- **影響**:salt 本身公開不算致命(scrypt 的記憶體困難特性本來就設計成能抵禦
  一定程度的離線暴力破解),但「salt 固定且跨裝置共用」削弱了 salt 原本該提供的
  「防止跨環境查表攻擊」效果——如果任何一個部署的維運者沒有照 `.env.example`
  建議的 `openssl rand -base64 32` 產生金鑰,而是手動輸入一個人類可記憶但低熵的
  值(剛好 >= 16 字元即可通過檢查),攻擊者可以針對這組**已知的固定 salt**
  預先計算一份常見密碼的 scrypt 查表,並對**所有**使用這份程式碼的部署重複使用,
  而不需要針對每個部署重新計算——這正是加鹽機制原本要防止的攻擊面。
- **建議**:
  1. 至少把 `secret.length < 16` 的長度檢查,加強為額外的簡單熵檢查(例如拒絕
     全部相同字元、拒絕常見弱字串黑名單),降低人為設定弱金鑰的機率。
  2. 若要更徹底,salt 可以改成從一個獨立的、部署時產生的環境變數讀取(而非
     原始碼常數),讓每個安裝實例的 salt 都不同,徹底排除跨部署查表的可能性
     (這是破壞性變更,需要一併規劃既有密文的遷移路徑)。

---

### 4.〔LOW-MEDIUM · contract-mismatch〕`secretCrypto` 沒有等同 `assertJwtSecretReady()` 的開機期防線;具名金鑰輪替(`CREDENTIAL_ENCRYPTION_KEY_k2` 等)設定錯誤只會在「使用者實際建立新連接」當下才炸成執行期 500

- **檔案:行號**:`server/_core/secretCrypto.ts:35-51`(`resolveKeyMaterial`,
  具名 key 分支直接 `throw`,無開機期預檢)、對照 `server/_core/googleAuth.ts:101-110`
  (`assertJwtSecretReady`,由 `server/_core/index.ts:376` 在啟動流程呼叫)。
- **證據**:

```ts
// server/_core/secretCrypto.ts:35-43 —— 具名 key(k2 等)取不到值就直接 throw,
// 但這個函式只有在真的呼叫 encryptSecret/decryptSecret 時才會被觸發
function resolveKeyMaterial(keyId: string): string {
  if (keyId !== "k1") {
    const named = process.env[`CREDENTIAL_ENCRYPTION_KEY_${keyId}`] ?? "";
    if (named.length >= 16) return named;
    throw new Error(
      `secretCrypto: key "${keyId}" 需要 CREDENTIAL_ENCRYPTION_KEY_${keyId}（>=16 字元）`
    );
  }
  ...
}
```

  檔頭註解(`secretCrypto.ts:17-20`)描述的官方輪替步驟是「先設
  `CREDENTIAL_ENCRYPTION_KEY_k2`,再設 `CREDENTIAL_ENCRYPTION_KEY_ACTIVE=k2`」
  兩個獨立的 Railway 環境變數操作。這是人工操作,順序顛倒或漏設其中一步
  (例如只設定了 `ACTIVE=k2` 卻忘記同時設 `CREDENTIAL_ENCRYPTION_KEY_k2`)完全
  合理會發生。而 `server/secret-crypto-key-versioning.test.ts:91-96` 的測試
  「k2 金鑰不存在時 throw 有意義訊息」證實:這個錯誤設定下,`encryptSecret`
  會在**被呼叫的當下**才 throw——不是開機期。對照 `googleAuth.ts` 這邊,
  `assertJwtSecretReady()` 會在 `server/_core/index.ts:376` 於伺服器啟動流程
  中主動呼叫,錯誤設定會讓部署「響亮地」啟動失敗;`secretCrypto.ts` 沒有對應的
  `assertXxxReady()` 函式被任何啟動流程呼叫。
- **影響**:若運維在做 AIDV-68 描述的金鑰輪替時漏設 `CREDENTIAL_ENCRYPTION_KEY_k2`,
  服務仍會正常開機、通過健康檢查、正常服務既有流量——問題會被延遲到「第一個使用者
  嘗試新建一個 Notion 連接」的那一刻,才在該次 tRPC mutation 中以未預期的
  500(`ContextPacketAccessError` 以外的一般 Error,`contextPacketRouter.ts`
  的 `mapAccessError` 只轉譯 `ContextPacketAccessError`,這裡的 `Error` 不會被
  轉譯,會以未分類錯誤形式冒出)呈現給該使用者,而不是在部署當下就被維運者發現。
- **建議**:在伺服器啟動流程(`server/_core/index.ts` 內、與 `assertJwtSecretReady()`
  同一處)加一個等價的 `assertCredentialEncryptionKeyReady()`:讀取
  `CREDENTIAL_ENCRYPTION_KEY_ACTIVE`(若有設),驗證對應的具名金鑰環境變數確實存在
  且 >= 16 字元,讓輪替設定錯誤在部署當下就 fail-fast,而非留到使用者觸發時才爆炸。

---

### 5.〔LOW · deadcode + contract-mismatch〕`createConnection` 的 `provider` 欄位無與 `kind` 對應的白名單驗證;非 `google_drive`/`notion` 的任意 provider 仍會加密真實憑證並落地,但永遠無法被任何 adapter 消費或通過健檢變成 `active`

- **檔案:行號**:`server/subsystems/contextPackets/contextPacketRouter.ts:132-140`
  (input schema,`provider: z.string().trim().min(1).max(64)`,無 enum)、
  `connectionService.ts:102-115`(`createConnection` 只對 `provider==="google_drive"`
  特殊處理,其餘一律視為 `api_key` 且要求並加密 `credential`)、`:179-208`
  (`runHealthCheck` 只認得 `"google_drive"`/`"notion"` 兩種 provider,其餘
  `return false`)、`contextPacketService.ts:98-107`(`buildAdapters` 同樣只對
  `kind==="cloud" && provider==="google_drive"` 或
  `kind==="notes" && provider==="notion"` 建立 adapter)。
- **證據**:

```ts
// server/subsystems/contextPackets/contextPacketRouter.ts:132-139
create: protectedProcedure
  .input(
    z.object({
      kind: z.enum(CONNECTION_KINDS),
      provider: z.string().trim().min(1).max(64),   // ← 無 enum、無與 kind 的對應驗證
      ...
      credential: z.string().trim().min(1).max(4096).nullable().optional(),
      ...
    })
  )
```

  `kind` 有限定在 `CONNECTION_KINDS = ["cloud","notes","mcp","external_api"]`
  (`contracts.ts:54-59`),但 `provider` 是自由字串。使用者可以送出例如
  `{ kind: "external_api", provider: "anything-i-type", credential: "..." }`,
  `createConnection` 會因為 `provider !== "google_drive"` 而走 `api_key` 分支、
  要求並成功 `encryptSecret` 落地(`connectionService.ts:106-114`)。但這筆連接
  之後:`testConnection` 呼叫的 `runHealthCheck` 對這個 provider 一律回傳
  `false`(`connectionService.ts:207`,只認得 `"google_drive"`/`"notion"`
  兩個字面值),也不會被 `contextPacketService.ts` 的 `buildAdapters`
  配對到任何 `DataSourceAdapter`——這與 `contracts.ts:39-41` 註解「mcp /
  external_api 預留」的定位一致(功能本就还没实作),但目前的輸入驗證完全沒有
  在建立當下就擋掉/警示這種「必然無效」的組合。
  另外,`setStatus` 端點(`contextPacketRouter.ts:179-192` →
  `connectionService.ts:144-153` 的 `setConnectionStatus`)允許使用者直接把
  自己連接的 `status` 設成 `"active"`,不需要先通過 `testConnection`/
  `runHealthCheck`——`active` 這個狀態值目前沒有「代表已通過健檢」的強制契約,
  純粹是使用者自報。
- **影響**:僅限使用者對自己帳號的資源(自己的連接、自己的憑證),不構成跨使用者
  風險。主要後果是:(a) 使用者可能誤以為自己設定了一個真的能用的
  `mcp`/`external_api`/任意 provider 連接,實際上該連接的加密憑證從建立那刻起
  就是無法被任何現有程式路徑使用的死資料,直到使用者手動刪除;(b)
  `active`/`error`/`pending` 狀態值的語意在 `setStatus` 與 `testConnection`
  兩條路徑之間不一致(一個代表「使用者自報」,一個代表「系統健檢」),是契約
  層級的鬆散,日後若有其他程式碼假設「`status==="active"` 必然代表健檢通過」
  會踩到這個落差。
- **建議**:
  1. `create` 的 zod schema 對 `provider` 依 `kind` 做條件式白名單(例如
     `kind==="cloud"` 目前只允許 `"google_drive"`,`kind==="notes"` 目前只允許
     `"notion"`),對於還沒有對應 adapter 的 provider 值,建立時就明確拒絕或
     回傳警示,而非默默收下並加密一個永遠用不到的憑證。
  2. 若要保留使用者自報 `active` 的彈性,建議在文件/型別上明確標註
     `setStatus` 設定的 `active` 與 `testConnection` 健檢通過的 `active`
     語意不同(或乾脆讓 `setStatus` 的 `active` 分支內部也跑一次
     `runHealthCheck` 才允許轉態),避免兩條路徑對同一個狀態值有不同保證。

---

## 二、Negative Results(對抗式驗證後排除的可能性,附證據)

1. **IV 處理正確,無重複/靜態 IV**:`encryptSecret`(`secretCrypto.ts:73`)每次呼叫都用
   `crypto.randomBytes(IV_LEN)`(12 bytes,符合 GCM 建議的 96-bit)產生新的隨機 IV,
   沒有任何路徑重用固定 IV 或以計數器產生;`secret-crypto.test.ts:26-32`
   (「produces different ciphertext each time (random IV)」)已對此做回歸測試斷言。
2. **GCM 竄改偵測有效**:`secret-crypto.test.ts:34-38` 證實,修改密文 base64 內容後
   `decryptSecret` 會 `throw`(auth tag 驗證失敗),單一密文本身的位元組層級竄改
   會被攔下——發現 2 指出的缺口是「跨列整段合法密文替換」,不是「同一列密文被局部竄改」,
   兩者不同,不可混為一談。
3. **`v1:`/`v2:` 冒號分隔格式不會被密文/憑證內容本身破壞**:`decryptSecret` 用
   `ref.split(":")` 拆解字串,四或五段皆為 base64 編碼(iv/tag/cipher)或固定字面值
   (`v1`/`v2`/`keyId`);base64 字母表(`A-Z a-z 0-9 + /` 及補位 `=`)不含 `:`,
   故無論被加密的原始明文(如 Notion token)內容為何,編碼後都不可能在 `split(":")`
   時製造出額外欄位或破壞既有欄位邊界——沒有格式層級的注入面。
4. **credential 從未流向前端**:`connectionService.ts:51-66`(`toConnectionView`)
   的投影欄位清單裡沒有 `encryptedCredentialRef`,與檔頭註解(`:6-10`)
   「絕不回前端」的宣告一致;`server/data-source-connections.test.ts:79,114`
   兩處測試也明確斷言 `view` 物件 `not.toHaveProperty("encryptedCredentialRef")`。
5. **`encryptedCredentialRef` 目前只有一個寫入路徑**:全 repo(含 `client/`)
   grep `encryptedCredentialRef` 只有 `connectionService.ts:114`
   (`createConnection` 內的 `encryptSecret(cred)` 賦值)會寫入這個欄位的加密值;
   沒有其他 router/service/script 直接寫入或覆蓋這個欄位,也沒有任何 tRPC
   procedure 接受使用者直接提交 `encryptedCredentialRef` 原始字串——發現 2
   的跨列替換路徑目前無已知觸發端點,已在該發現內明確註記。
6. **本次兩檔案範圍內未見 SSRF 面**:`connectionService.ts` 裡唯一的
   `fetch()` 呼叫(`:196`)目標是寫死常數 `NOTION_API = "https://api.notion.com/v1"`
   (`:40`),不受使用者輸入影響;Drive 分支(`:183-186`)只呼叫
   `getValidDriveAccessToken(userId)` 取 token,本檔案內不涉及對使用者可控 host
   發起請求。實際 Drive API 呼叫的 host/query 組裝邏輯在
   `server/services/googleDrive.ts`,不在本次稽核的兩個檔案範圍內,其相關發現
   (`listFolder` 查詢語言注入)已由 `X10-connectors-deepdive.md` 發現 3 記錄,
   本檔不重複列入,僅此交叉引用。
7. **兩檔案皆無明文/金鑰外洩至 log**:通篇搜尋 `secretCrypto.ts`(126 行)與
   `connectionService.ts`(208 行),沒有任何 `console.log`/`logger.*` 呼叫會
   輸出 `plaintext`/`key`/`token`/`secret` 變數;`decryptSecret` 的錯誤路徑
   (`:119` 的 `throw new Error("secretCrypto: 無法辨識的憑證格式")`)也不含
   密文或金鑰內容。
8. **哪些連接器真正走了加密路徑(對照 S-17)**:本次逐行確認,`server/subsystems/
   contextPackets/adapters/external.ts` 內,`createNotionAdapter.collect`
   (`:196-202`)呼叫 `decryptSecret` 取得 Notion token 後才發起 API 呼叫;
   `createDriveAdapter.collect`(`external.ts:75-77`)完全不觸碰
   `connection.encryptedCredentialRef`,改用
   `getValidDriveAccessToken(input.userId)` 走既有 `userGoogleOauthTokens`
   明文欄位——與 X10 記錄的 S-17 結論(Drive OAuth token 明文,未走
   `encryptSecret`/`decryptSecret`)完全吻合,本檔獨立重新驗證後**確認無誤**,
   不構成新發現,僅作為既有 S-17 結論的二次佐證。
9. **具名金鑰輪替機制本身設計正確(排除「輪替邏輯有 bug」的疑慮)**:
   `secret-crypto-key-versioning.test.ts:51-68` 證實,切換
   `CREDENTIAL_ENCRYPTION_KEY_ACTIVE` 為新 keyId 後,新密文正確帶新 `keyId`
   前綴、舊密文仍可用舊 `keyId` 對應的金鑰正常解密——版本化格式
   (`v2:<keyId>:...`)與向下相容 `v1:` 格式的解析邏輯本身沒有發現錯誤;
   本報告發現 1 的問題**僅限於「未設定 `CREDENTIAL_ENCRYPTION_KEY` 時的 k1
   fallback鏈」**,不是輪替機制設計本身的缺陷。
10. **金鑰快取(`keyCache`)不構成跨使用者/跨金鑰污染**:`secretCrypto.ts:33,53-67`
    的 `keyCache` 以 `keyId` 字串(`"k1"`/`"k2"`…)為 key,是全域但按金鑰版本
    區分的快取,不含使用者維度,也從未把 `Buffer` 金鑰本身回傳給呼叫端——不存在
    「某使用者的操作意外沿用另一使用者金鑰」的路徑(因為金鑰本來就與使用者無關,
    是全站共用的加密根鑰)。

---

## 三、小結

`secretCrypto.ts` 的核心演算法選型(AES-256-GCM + scrypt 導出 + 隨機 IV + 金鑰版本化)
是合理的骨架,**回歸測試覆蓋了 round-trip、竄改偵測、金鑰來源優先序、版本輪替四個維度,
機制本身沒有實作錯誤**。真正的風險集中在兩處「設計留白」:一是 S-08 的
`JWT_SECRET` fallback 鏈完全沒有等同 `getJwtSecret()` 的 production 硬化與
「輪替會打壞既有資料」的顯式警示(發現 1,HIGH);二是密文與其所屬 DB row/使用者
之間缺乏密碼學層級的綁定(無 AAD),使得「誰的密文能不能被拿去解密誰的資料」
完全仰賴應用層的一次性擁有權檢查,且該檢查在 DB 層沒有第二道防線,與同一產品內
`drive.ts` 的雙保險模式不一致(發現 2,MEDIUM)。`connectionService.ts` 本身的
擁有權檢查(`loadOwnedConnection`)在目前所有已知呼叫端都有被正確套用,是這次
稽核裡最紮實的一塊;真正該優先處理的,是讓「憑證加密到底靠哪把鑰匙」這件事
在部署當下就能被驗證與失敗提示,而不是留到金鑰被換掉、或使用者踩到才發現。
