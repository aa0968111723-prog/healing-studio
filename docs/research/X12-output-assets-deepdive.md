# X12 — 輸出/打包 + 素材管理（videoProject + assets）逐行深挖（地毯掃描 wave X）
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核檔案：server/routers/videoProject.ts(567)、server/routers/assets.ts(343)

## 稽核方法與範圍
逐行讀完 `server/routers/videoProject.ts`（567 行）與 `server/routers/assets.ts`（343 行）；
為驗證關鍵推論（是否構成可利用漏洞），額外交叉讀取以下支援檔案（僅作佐證，非本次稽核主檔）：
`server/db.ts`（updateVideoProject / getTeamSharedAssetsFiltered / getDigitalAsset 等）、
`drizzle/schema.ts`（video_projects 欄位定義）、`server/_core/env.validated.ts`（ENABLE_DATA_RBAC 預設值）、
`server/signedUpload.ts`（presigned URL 機制）、`shared/video-input-assets.ts`（inputAssets 契約）、
以及 `node_modules/drizzle-orm`（mapUpdateSet / buildUpdateSet 原始碼，用來確認 mass-assignment 是否真的會落到 SQL）。
所有結論均以實際讀到的程式碼為準；無法在兩份主檔內驗證的下游消費點，一律標註「未在本檔驗證」。

---

## 發現（按嚴重度排序）

### 1、[CRITICAL｜billing] `videoProject.save` 完全漏掉 4K 付費方案檢查，付費閘門可被繞過

**發現**：
`create`（第 80 行）與 `update`（第 167 行）都對 4K 解析度做了強制檢查：
```ts
// server/routers/videoProject.ts:80
if (input.outputSpec?.resolution === "4K") await assertPaidFor4K(ctx.user.id);
// server/routers/videoProject.ts:167
if (input.outputSpec?.resolution === "4K") await assertPaidFor4K(ctx.user.id);
```
但 `save` mutation（第 363–434 行）同樣接受 `outputSpec: outputSpecSchema.optional()`（第 369 行）並會把它寫進 `patch.outputSpec`（第 388 行）：
```ts
// server/routers/videoProject.ts:378-397（節錄）
.mutation(async ({ ctx, input }) => {
  checkAgentRateLimit(ctx.user.id, ctx.req, ctx.res);
  const row = await db.getVideoProject(input.id);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
  if (row.userId !== ctx.user.id)
    throw new TRPCError({ code: "FORBIDDEN" });

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.aspectRatio !== undefined) patch.aspectRatio = input.aspectRatio;
  if (input.outputSpec !== undefined) patch.outputSpec = input.outputSpec;
  ...
```
全函式（378–434 行）搜尋不到任何 `assertPaidFor4K` 呼叫。已用 `grep -n "assertPaidFor4K" server/routers/videoProject.ts` 確認全檔僅出現在第 55 行（定義）、80 行（create）、167 行（update），第 379 行附近（save）完全沒有呼叫。

**影響**：任何免費方案使用者可直接呼叫 `videoProject.save({ id, outputSpec: { resolution: "4K", ... } })`，把自己專案的 `output_spec.resolution` 持久化為 `"4K"`，繞過「AIDV-788：4K 需付費方案」的商業規則。由於 `save` 是前端編輯器最常用的自動存檔路徑（相對於 `update`），此缺口極易在正常使用流程中被觸發，且無需任何特殊技巧。下游（Fal.ai 派發）是否真的讀取 `output_spec.resolution` 決定計費/畫質未在本檔驗證，但依檔頭註解「管理影片專案的格式選擇…供 Fal.ai 派發時從 DB 讀取」，此欄位確實是計費相關規格的唯一真實來源。

**建議**：在 `save` mutation 內、更新 patch 前補上與 `create`/`update` 一致的檢查：
```ts
if (input.outputSpec?.resolution === "4K") await assertPaidFor4K(ctx.user.id);
```
並建議把三處重複的呼叫收斂成單一「進 patch 前統一跑」的守門邏輯，避免未來新增第四個 mutation 時再度遺漏。

---

### 2、[HIGH｜security-idor] `restoreSnapshot` 對 `snapshotData` 做無 allowlist 的 mass-assignment，可覆寫 `userId`／`creativeProjectId` 等真實欄位

**發現**：
`save` mutation 接受完全開放的快照資料：
```ts
// server/routers/videoProject.ts:375
snapshotData: z.record(z.string(), z.unknown()).optional(),
```
並原樣存進 `project_snapshots.snapshot`：
```ts
// server/routers/videoProject.ts:406-409
const agentId = ctx.req?.headers?.["x-agent-id"] as string | undefined;
if (input.snapshotData) {
  const snapshotSource: "auto" | `agent:${string}` = agentId ? `agent:${agentId}` : "auto";
  void db.createProjectSnapshot(input.id, input.snapshotData, snapshotSource).catch(() => {});
}
```
`restoreSnapshot` 之後把儲存的快照**整包**轉型丟給 `db.updateVideoProject`，完全沒有欄位白名單（對比 `update`/`save` 都是逐欄位手動組 `patch`）：
```ts
// server/routers/videoProject.ts:338-340
const patch = snap.snapshot as Parameters<typeof db.updateVideoProject>[1];
const { updated } = await db.updateVideoProject(input.projectId, patch);
if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
```
`as` 只是 TypeScript 編譯期斷言，執行期不做任何欄位驗證。`db.updateVideoProject` 內部直接把整個 `data` 物件 spread 進 Drizzle 的 `.set()`：
```ts
// server/db.ts:5605-5617
export async function updateVideoProject(
  id: number,
  data: Partial<InsertVideoProject>,
  opts?: { expectedVersion?: number }
): Promise<{ updated: boolean }> {
  ...
  const setData = { ...data, version: sql`\`version\` + 1` };
  const whereClause = ... eq(videoProjects.id, id);
  const result = await db.update(videoProjects).set(setData).where(whereClause);
```
已交叉確認 Drizzle 執行期行為（非臆測）：`mapUpdateSet`（`node_modules/drizzle-orm/utils.js:81-93`）不會過濾未知鍵；真正決定「哪些鍵會落到 SQL」的是 `buildUpdateSet`（`node_modules/drizzle-orm/mysql-core/dialect.js:85-100`），其邏輯是**遍歷資料表定義的每一個真實欄位**，只要 `set[colName] !== undefined` 就會產生 `SET colName = value`。也就是說：`snapshot` 物件裡任何**恰好與 `video_projects` 表真實欄位同名**的鍵都會被寫入，其餘未知鍵才會被忽略。而 `video_projects` 的欄位定義（`drizzle/schema.ts:4604-4632`）包含：
```ts
userId: int("userId").notNull(),
creativeProjectId: int("creativeProjectId"),
outputStoragePath: text("output_storage_path"),
outputSignedUrl: text("output_signed_url"),
outputExpiresAt: timestamp("output_expires_at"),
```
因此攻擊者可以：
1. 呼叫 `save`，帶 `snapshotData: { userId: <任意數字>, creativeProjectId: <任意數字>, outputSignedUrl: "...", outputExpiresAt: "..." }`（自己擁有的專案）。
2. 呼叫 `restoreSnapshot` 還原該快照。
3. 該專案列的 `userId`/`creativeProjectId`/`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt` 等真實欄位會被整批覆寫——這些欄位在正常 `update`/`save` 端點中**完全不可由使用者直接寫入**（`update`/`save` 的 input schema 根本沒有 `userId`/`creativeProjectId`/`outputSignedUrl` 欄位）。

**影響**：`restoreSnapshot` 的擁有權檢查（第 319–322 行 `project.userId !== ctx.user.id` → FORBIDDEN）只保證「你在改自己的專案列」，但沒有限制「你能改哪些欄位」。最直接的濫用是把自己專案的 `userId` 改成任意存在的使用者 ID——之後該筆（可能帶惡意/未消毒標題，見發現 6）專案會出現在受害者帳號底下的 `list`/`get`，形成非自願的跨帳號資料植入；也可任意覆寫快取的 `outputSignedUrl`/`outputExpiresAt`，或繞過 `create` 端對 `creativeProjectId` 完全沒做的擁有權檢查（見發現 4）之外再開一條「事後改綁」的路。由於 WHERE 子句仍鎖定呼叫者自己的 `projectId`，此洞無法直接讀取/竊取他人資料，屬於「破壞完整性/推資料給他人」型 IDOR，而非直接的橫向讀取。

**建議**：`restoreSnapshot` 還原時應比照 `update`/`save`，只從 `snap.snapshot` 中挑出白名單欄位（`title`/`aspectRatio`/`outputSpec`/`deadlineAt`/`priorityClass`/`inputAssets`）組出 `patch`，禁止任何形式的「整包快照直接當 DB patch」；同時建議 `save.snapshotData` 的 zod schema 收斂為與快照真正需要的欄位一致，而非 `z.record(z.string(), z.unknown())` 全開放。

---

### 3、[HIGH｜security-idor] `assets.teamAssets` 在預設設定下（`ENABLE_DATA_RBAC` 預設 OFF）回傳「全平台」team_shared 資產，未按團隊/使用者範圍

**發現**：
```ts
// server/routers/assets.ts:122-159（節錄）
let result = await db.getTeamSharedAssetsFiltered({
  assetType: input?.assetType,
  sourceStudio: input?.sourceStudio,
  search: input?.search,
});
// ── AIDV-121 enforcement（旗標 gate）──────────────────────────
// 旗標 OFF（預設）= 完全保持現狀：回（SQL 過濾後的）team_shared 資產（既有
//   行為，含已知 cross-tenant 洩漏；本 PR 刻意不在 OFF 時改它）。
// 旗標 ON = 經 canAccess 過濾，只留 ctx.user 真正能看到的 …
if (isDataRbacEnabled()) {
  const memberTeamIds = await db.listTeamIdsForUser(ctx.user.id);
  ...
  result = result.filter(asset => canAccess(...));
}
return result;
```
`db.getTeamSharedAssetsFiltered`（`server/db.ts:1493-1541`）的 WHERE 條件只有 `eq(digitalAssetLibrary.visibility, "team_shared")` 加上 assetType/sourceStudio/search 篩選——**完全沒有任何 userId 或 teamId 範圍限制**，是全表掃描所有使用者的 `team_shared` 資產（預設上限 200 筆，第 1540 行 `.limit(opts.limit ?? 200)`）。而 `isDataRbacEnabled()` 讀的旗標 `ENABLE_DATA_RBAC` 預設值確認為關閉：
```ts
// server/_core/env.validated.ts:603
ENABLE_DATA_RBAC: z.string().optional().default("false"),
```

**影響**：在目前預設設定下，任何已登入使用者呼叫 `assets.teamAssets`，都能看到**平台上所有使用者**曾標記為 `team_shared` 的資產（不限自己所屬團隊），而不是文件/UI 語意暗示的「僅我的團隊」。程式碼註解本身已承認這是「已知 cross-tenant 洩漏」，且本次稽核確認：修正路徑（`canAccess` 過濾）存在，但預設關閉，因此漏洞在預設組態下處於「開啟」狀態，而非僅為理論風險。

**建議**：既然修正邏輯（`isDataRbacEnabled` + `canAccess` 過濾）已經寫好且經過批次化優化（AIDV-651 註解），應儘速把 `ENABLE_DATA_RBAC` 的預設值改為 `true`（或至少排定明確的旗標開啟時程），否則「team_shared」在對外文案/使用者心智模型中等同於「全站公開」，與命名嚴重不符。

---

### 4、[MEDIUM｜security-idor] `videoProject.create` 的 `creativeProjectId` 未驗證擁有權即可綁定

**發現**：
```ts
// server/routers/videoProject.ts:70
creativeProjectId: z.number().int().positive().optional(),
...
// server/routers/videoProject.ts:85
creativeProjectId: input.creativeProjectId ?? null,
```
`create` mutation（65–116 行）全程沒有任何一次針對 `creativeProjectId` 呼叫「確認此 creativeProject 屬於 `ctx.user.id`」的檢查（對照同函式對 `outputSpec.resolution === "4K"` 都會呼叫 `assertPaidFor4K`）。也就是說，任何使用者都可以把自己新建的影片專案指向**任意存在的（甚至他人擁有的）** `creativeProjectId`。

**影響**：在本次稽核的兩個檔案範圍內，`get`/`list`/`create` 回傳的物件都**沒有**把 `creativeProjectId` 回傳給前端（已逐一核對 91-116、130-144、236-251 行的回傳物件形狀，均無此欄位），且 `server/db.ts` 中查無任何以 `creativeProjectId` 做 WHERE 過濾的查詢函式（`grep -n "creativeProjectId" server/db.ts` 僅命中第 5695 行的 `duplicateVideoProject` 賦值）。因此**在本次稽核範圍內**尚未證實有下游功能會依賴此欄位做存取控制或跨表查詢（故不判定為可直接利用的資料外洩）。但這是一個未經驗證的跨物件綁定：一旦未來任何功能（例如「顯示某創作專案底下的所有影片」）信任 `video_projects.creativeProjectId` 做授權判斷，此缺口就會立即變成真實 IDOR。另外，同樣的缺口（沒有擁有權檢查）也出現在 `server/routes/videoRoute.ts:151`（非本次稽核主檔，僅供佐證），顯示這不是單一端點的疏漏，而是系統性慣例缺口。

**建議**：`create`（以及未來若開放 `update`/`save` 改綁）都應在寫入前確認 `creativeProjectId` 對應的創作專案 `userId === ctx.user.id`，否則應拒絕請求或直接忽略該欄位。

---

### 5、[MEDIUM｜persistence] `restoreSnapshot` 略過樂觀鎖（CAS），可無條件覆蓋併發編輯

**發現**：
`update`/`save` 都支援 `expectedVersion` 並傳給 `db.updateVideoProject` 做 CAS：
```ts
// server/routers/videoProject.ts:175-179（update）
const { updated } = await db.updateVideoProject(
  input.id,
  patch as Parameters<typeof db.updateVideoProject>[1],
  { expectedVersion: input.expectedVersion }
);
```
但 `restoreSnapshot` 呼叫時完全不帶第三參數：
```ts
// server/routers/videoProject.ts:338-339
const patch = snap.snapshot as Parameters<typeof db.updateVideoProject>[1];
const { updated } = await db.updateVideoProject(input.projectId, patch);
```
`db.updateVideoProject` 的 WHERE 子句在沒有 `opts?.expectedVersion` 時退化為僅 `eq(videoProjects.id, id)`（`server/db.ts:5613-5616`），因此該次更新必定成功，不論資料庫目前版本為何。

**影響**：若協作者（人類或代理）在快照建立之後、`restoreSnapshot` 呼叫之前修改了同一專案，這些中間編輯會被「回溯」操作靜默覆蓋，且不會回報 409 CONFLICT——這正是 AIDV-241 為 `update`/`save` 特地引入 CAS 想避免的情境，`restoreSnapshot` 卻繞過了它。

**建議**：`restoreSnapshot` 呼叫 `db.updateVideoProject` 時應要求呼叫方提供 `expectedVersion`（比照 `update`/`save`），版本不符時回 409，讓前端提示「有更新的版本，確定要回溯嗎」。

---

### 6、[MEDIUM｜injection] `assets.ts` 的 `upload`/`update` 未對 `title`/`description` 做 `sanitizePlainText`，與 videoProject.ts 的慣例不一致

**發現**：
`videoProject.ts` 的 `create`/`update` 對 `title` 一致套用消毒：
```ts
// server/routers/videoProject.ts:68, 151
title: z.string().min(1).max(255).transform(sanitizePlainText).default("未命名影片"),
title: z.string().min(1).max(255).transform(sanitizePlainText).optional(),
```
但 `assets.ts` 的 `upload`（165-198 行）與 `update`（201-223 行）對應欄位完全沒有 `.transform(sanitizePlainText)`：
```ts
// server/routers/assets.ts:168-169（upload）
title: z.string().min(1).max(255),
description: z.string().max(500).optional(),
// server/routers/assets.ts:205-206（update）
title: z.string().min(1).max(255).optional(),
description: z.string().max(500).optional(),
```
`sanitizePlainText`（`server/utils/sanitize.ts:18-20`）用 DOMPurify 剝除所有標籤/屬性，是專案既有的既定防線，但 `assets.ts` 兩處全然未使用。

**影響**：資產標題/描述可包含任意 HTML/腳本字串並原樣存庫，若前端任何呈現位置（例如未來的資產卡片、分享頁）改用 `dangerouslySetInnerHTML` 或非跳脫渲染，就會構成 stored XSS。本次稽核僅限這兩個路由檔，**前端消費點是否有跳脫渲染未在本檔驗證**；但作為後端資料契約層，與 `videoProject.ts` 慣例不一致本身已是一個值得補齊的防禦缺口（縱深防禦原則：後端不應假設前端一定正確跳脫）。

**建議**：在 `assets.ts` 的 `upload`/`update` 的 `title`/`description` 欄位加上與 `videoProject.ts` 相同的 `.transform(sanitizePlainText)`。

---

### 7、[MEDIUM｜billing] `toggleVisibility` 的獎勵點數存在 TOCTOU race condition，可能重複發放

**發現**：
```ts
// server/routers/assets.ts:232-267（節錄）
.mutation(async ({ ctx, input }) => {
  const asset = await db.getDigitalAsset(input.id);          // 一次性讀取
  ...
  await db.updateDigitalAsset(input.id, { visibility: input.visibility });
  if (
    !isDemoMode() &&
    input.visibility === "team_shared" &&
    asset.visibility !== "team_shared"                        // 用同一份舊 snapshot 判斷
  ) {
    const alreadyRewarded = (asset.rewardCredits ?? 0) > 0;    // 同上，非即時再查
    if (!alreadyRewarded) {
      await db.refundUserQuota(ctx.user.id, 2);
      await db.updateDigitalAsset(input.id, { rewardCredits: 2 });
      ...
    }
  }
```
「是否已經發過獎勵」的判斷完全基於函式一開始讀到的 `asset`（第 233 行），中間沒有任何交易鎖或「原子性 UPDATE … WHERE reward_credits = 0」的寫法保護。

**影響**：對同一 `assetId` 併發送出兩個（或更多）`toggleVisibility({ visibility: "team_shared" })` 請求，兩者都可能讀到 `rewardCredits = 0`／`visibility = "private"` 的舊狀態，各自判定「尚未發過獎勵」，各自呼叫 `refundUserQuota(+2)`，造成同一次分享被重複發放點數（`2 × N` 併發請求數）。由於後續 `updateDigitalAsset(input.id, { rewardCredits: 2 })` 是覆寫而非累加，DB 最終狀態看起來「正常」（`rewardCredits = 2`），但使用者的點數餘額已被多發，不易從資料表事後稽核發現。註解中「only on first share — prevent toggle exploit」只防住了「反覆切換 private/team_shared 序列重複領獎」的情境，未涵蓋併發請求。

**建議**：把「檢查 + 發獎」改為單一原子操作，例如 `UPDATE digital_asset_library SET reward_credits = 2 WHERE id = ? AND reward_credits = 0`（用受影響列數判斷是否真的觸發了獎勵），只有影響列數為 1 時才呼叫 `refundUserQuota`；或在 `refundUserQuota` 之外包一層以 `assetId` 為鍵的分散鎖/資料庫交易。

---

## 已驗證排除的疑慮（Negative Results）

以下項目經逐行檢查後**未發現問題**，一併記錄以避免報告偏向「只報壞消息」：

1. **owner 檢查一致性（videoProject.ts）**：`get`（123-124）、`update`（165-166）、`duplicate`（265-266）、`listSnapshots`（295-296）、`restoreSnapshot`（321-322）、`save`（382-383）、`requestExport`（481-482 專案 + 487-488 資產）、`getExportUrl`（445）都一致做了 `row.userId !== ctx.user.id → FORBIDDEN`（或 `NOT_FOUND`）檢查，沒有發現漏檢的端點。
2. **requestDownloadByUrl 的 userId 範圍查詢**：`db.getDigitalAssetByUrl(ctx.user.id, input.assetUrl)`（`server/db.ts:1210-1225`）在 SQL WHERE 裡直接帶 `eq(digitalAssetLibrary.userId, userId)`，非「查完才在應用層比對」，無 IDOR 空間。
3. **inputAssets 不是資產 IDOR 的路徑**：`shared/video-input-assets.ts` 中的 `videoInputAssetSchema`（80-98 行）欄位是 `url`（經 `isSafeExternalUrl` 防 SSRF）+ `role`/`type`，不是 `digital_asset_library` 的 `assetId` 外鍵引用，因此 videoProject 的 `inputAssets` 不構成「引用他人資產 ID」型 IDOR。
4. **myAssets / linkedPrompts / recentLineage（assets.ts）**：分別以 `ctx.user.id` 做 SQL 層或先行擁有權檢查（`linkedPrompts` 第 73-77 行先 `getDigitalAsset` 比對 `userId` 再查詢），未發現跨用戶讀取路徑。
5. **teamAssets 旗標開啟後的批次授權邏輯（AIDV-651）**：`isDataRbacEnabled()` 為 true 時，`memberTeamIds`/`sharesMap` 為批次查詢（非逐筆 N+1），邏輯與 `canAccess` 純函式組合，未發現該分支本身的正確性問題（風險僅在於預設關閉，見發現 3）。
6. **SQL 注入面**：`assets.ts`/`videoProject.ts` 涉及的搜尋條件（`getDigitalAssetsByUserFilteredPaged`、`getTeamSharedAssetsFiltered`）都先呼叫 `escapeLikePattern` 跳脫 `%`/`_`/`\`，且一律經 Drizzle 參數化查詢，未發現字串拼接的原始 SQL。
7. **presigned URL 機制本身**：`presignGetDownload`（`server/signedUpload.ts:319-328`）使用 AWS SDK 標準 `getSignedUrl` + `GetObjectCommand`，7 天效期是 R2 對 presigned URL 的官方上限（非任意選擇），`requestExport`/`requestDownloadByUrl`/`getExportUrl` 三處都先做「資產屬於 R2 已設定 + fileKey 存在 + assetType 正確」的前置檢查才簽發（`videoProject.ts:494-504`），未發現簽章邏輯本身的弱點（例如可控 Key 導致路徑穿越——`fileKey` 全程來自 DB 既有值，非本次請求輸入）。
8. **delete 的 R2 級聯刪除與孤兒共享清理**（`assets.ts:284-342`）：刪除前用 `countOtherDigitalAssetsByFileKey` 確認沒有其他列共用同一 `fileKey` 才刪除實體物件，且刪除失敗/孤兒共享清理失敗都不阻塞主流程（best-effort，符合註解描述），越權刪除嘗試（`asset.userId !== ctx.user.id`）也會落一筆 `result: "failure"` 的稽核事件，屬於良好稽核實踐。
9. **`duplicateVideoProject`**（`server/db.ts:5681-5701`）刻意不複製 `outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`，避免把來源專案已快取但可能過期/屬於不同素材的簽章 URL 誤帶進新複本。

---

## 附錄：支援性程式碼位置（僅供交叉驗證，非本次稽核主檔）
- `server/db.ts:5605-5620`（updateVideoProject）、`:1493-1541`（getTeamSharedAssetsFiltered）、`:1298-1341`（getDigitalAssetsByUserFilteredPaged）、`:1199-1225`（getDigitalAsset / getDigitalAssetByUrl）、`:1543-1553`（updateDigitalAsset）、`:5681-5701`（duplicateVideoProject）
- `drizzle/schema.ts:4604-4655`（video_projects / project_snapshots 欄位定義）
- `server/_core/env.validated.ts:603`（ENABLE_DATA_RBAC 預設值）
- `server/utils/sanitize.ts:18-20`（sanitizePlainText）
- `server/signedUpload.ts:67-105, 313-328`（isR2Configured / presignGetDownload / EXPORT_PRESIGN_EXPIRES_SECONDS）
- `shared/video-input-assets.ts:80-103`（videoInputAssetSchema / videoInputAssetsSchema）
- `node_modules/drizzle-orm/utils.js:81-93`（mapUpdateSet）、`node_modules/drizzle-orm/mysql-core/dialect.js:85-100`（buildUpdateSet）——用以驗證發現 2 的 mass-assignment 是否真的落到 SQL
