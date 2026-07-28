# W5 — 計費核心(db.ts 點數函式 + 退款服務層)原子性/冪等性逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:993099d5
- 稽核檔案:server/db.ts 計費函式 + refundStatus.ts + postGenActions.ts + orbCostGuard.ts

## 前言:這輪結論會修正前置文件(W3)的部分假設

W3 的假設是「`refundUserPoints` 無鎖、`atomicClaimJobRefund` 是後補的 CAS」——**這句話在字面上正確,但推論到「所以會雙重退款/lost update」在目前 HEAD(993099d5)並不成立**。逐行讀完 `db.ts` 的點數函式與所有呼叫點後,證據顯示:

- 核心扣點/退點原語(`deductUserPoints`/`refundUserPoints`/`deductUserQuota`/`refundUserQuota`)**都是**「交易 + `SELECT...FOR UPDATE` 鎖 + SQL 端 delta 運算」,不是「讀 balance→算→寫回」的危險序列。
- `atomicClaimJobRefund` 的 CAS 鎖**確實被系統性套用**在每一個「多條路徑可能同時判定失敗」的場景(webhook / polling / stale-checker / 直接 catch),並有專門的併發回歸測試(`postGenActions.refund.test.ts`、`aidv-771-orphan-refund.test.ts`)。看起來像「無鎖」的三十多個 `refundUserPoints` 呼叫點,逐一追蹤後都是「job 尚未建立、或此路徑是此 job 唯一可能的失敗出口」的單路徑情境,鎖不是必要的——這件事本身也被寫死在程式碼註解裡(AIDV-577/650/771/968),顯示團隊已經對這個問題做過至少四輪修補。

**但這輪深挖找到一個先前文件都沒抓到、貨真價實的 P0 級新缺口**(見下方發現 1):ProStudio 的通用 fal.ai 輪詢端點 `checkAudioStatus` 涵蓋約 20 個生成端點,扣點後若非同步任務最終判定 FAILED,**完全沒有任何退款路徑**——不是雙退,是「永遠不退」。這比 W3 猜測的「雙重退款」方向相反,但對使用者體感一樣糟(甚至更糟:是穩定發生,不是併發競態才發生)。

---

## 發現 1(P0 · 已坐實 · 大範圍持續發生的「有扣未退」缺口)

**現象**:ProStudio 音訊/影片/語音家族(`textToMusic`、`compiledTextToMusic`、`soundEffects`、`elevenLabsTTS`、`qwenCloneVoice`、`qwenCloneAndSpeak`、`diaTTSVoiceClone`、`elevenLabsVoiceClone`、`demucs`、`audioIsolation`、`mergeAudios`、`voiceChanger`、`speechToText`、`speechToVideo`、`echoMimic`、`stableAvatar`、`dubbing`、`longcatAvatar`、`ltxAudioToVideo` 等,`server/routers/proStudio.ts:522-1656`、`1832-1943`)在 fal.ai queue 提交**成功**後,一律回傳 `{ request_id, is_async_polling: true }`,**不建立 `backgroundJobs` 資料列、不帶 jobId**。

前端(`client/src/pages/ProStudio.tsx:282`、`client/src/components/home/OrbCreationStage.tsx:2344`)每 3 秒輪詢共用端點 `proStudio.checkAudioStatus`(`server/routers/proStudio.ts:1688-1820`)。該端點的 FAILED 分支:

```ts
// server/routers/proStudio.ts:1802-1817
if (s === "FAILED") {
  const errMsg = status?.error ?? status?.message ?? "未知錯誤";
  recordErrorTrace({ ... });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `任務失敗 [${input.model}]: ${errMsg}`,
  });
}
```

**只記錯誤軌跡、拋錯,沒有任何 `refundUserPoints` / `refundJobIfBilled` 呼叫。** 我在 `proStudio.ts` 全檔搜尋 `refundJobIfBilled`,只在註解裡出現(提及 Suno 的獨立流程),從未被 import 或呼叫(`grep -n "refundJobIfBilled\|import.*postGenActions" server/routers/proStudio.ts` 只命中三行註解)。

因為這些任務**從未寫入 `backgroundJobs`**,以下三道既有的安全網全部繞不到它們:
- `server/jobs/staleJobChecker.ts`(每分鐘掃 `background_jobs` 表)——查無此表列,無法介入。
- `webhookFal.ts` / `webhookSuno.ts` 的 `refundJobIfBilled(jobId)` ——需要 jobId,這條流程沒有。
- `checkStudioJob`(`generate.ts:2176`)的 FAILED 偵測——那是另一條(image/video 主工作室)完全獨立的路徑,不覆蓋 ProStudio 的這 20 個端點。

client 端(`ProStudio.tsx:304-306`、`OrbCreationStage.tsx`)在 FAILED 時只是彈 toast「生成失敗」,**沒有任何補償性退款呼叫**。

**影響**:使用者在提交後、fal.ai 端非同步失敗(模型逾時、上游 5xx、內容審核拒絕等)時,點數已經在提交當下被 `chargeForFalTask`(內部呼叫 `deductUserPoints`)扣除,永久拿不回來。這不是邊角案例——是這個 checkAudioStatus 覆蓋的**所有**「非 Suno 音訊/語音/影片」ProStudio 端點的**唯一**失敗處理路徑,只要 fal 佇列端非同步判定失敗(而不是同步 submit 就丟例外),100% 不退款。

**建議**:
1. 比照 `generate.ts` 主工作室的作法,在這些 endpoint 的提交流程建立 `backgroundJobs` 列(帶 `costPoints`),`checkAudioStatus` 的 FAILED 分支改呼叫 `refundJobIfBilled(jobId)`(沿用既有 CAS 語意,不必重造輪子)。
2. 過渡期最小修補:若不想動資料結構,`checkAudioStatus` 的 FAILED 分支至少要能定位「這次提交扣了多少點」並呼叫 `refundUserPoints`——但這樣仍缺乏冪等鎖(見發現 2 的風險),優先做法 1。
3. 這是使用者實際會感知並投訴的缺口(付費點數消失、沒有任何產出),建議列為本輪最高優先修復項。

---

## 發現 2(P1 · 已坐實)記帳系統多套並存、且退款「先天不寫入」複式帳本

`server/services/cost/ledger.ts` 提供一套 append-only 複式分錄帳本(`cost_ledger` 表,migration 0076),自身冪等/餘額計算寫得很嚴謹(`idempotencyKey` 唯一鍵 + 先查後寫 + `ER_DUP_ENTRY` 捕捉、`assertGlobalBalanced` 全域借貸平衡檢查)。但:

```ts
// server/_core/env.validated.ts:671-678
// OPEN DECISIONS(待 Bruce 拍板,本基礎版尚未實作):
//   1) 切權威時機:ledger 何時取代 users.remainingGenerations 成為「餘額真相」。
//      需先補 hold/credit 全流程接線與一致性保證後才能切(目前 ledger 僅為旁觀
//      帳本,不參與實際扣點/授權)。
//   2) 退款接線:refundUserPoints(server/db.ts)目前【未接 ledger】,production
//      不會寫出任何 credit 列(holdEntry/postTransaction credit/computeBalance 已
//      有碼有測但生產零接線)。
ENABLE_COST_LEDGER: z.string().optional().default("false"),
```

也就是說,`healing-studio` 目前並存(至少)三套記帳語意:
1. **`users.remainingGenerations`**——單一可變整數,**唯一實際用於授權/扣款判斷的餘額**,`server/services/cost/ledger.ts:4-5` 註解自承「就地 mutate、無不可變交易 log」。
2. **`generation_history.costCredits`**——每筆生成的「顯示用」花費紀錄,寫入包在 `try/catch` 靜默吞錯(`postGenActions.ts:399-429`),失敗不影響主流程,但也代表這張表**不保證**跟 `remainingGenerations` 的扣款完全對得上。
3. **`cost_ledger`**——複式分錄,預設 `ENABLE_COST_LEDGER=false` 全關,即使打開,`refundUserPoints` 也不會寫入 credit 分錄(只有 debit 側,即 AI usage event 那條線有接),**就算開了旗標,退款發生時借貸也不會平衡**(這正是 `assertGlobalBalanced` 存在的意義——它現在拿去驗的資料本身就先天有已知缺口)。

**影響**:一旦 `users.remainingGenerations` 因任何原因(bug、手動 DB 操作、部分寫入失敗)偏移,**沒有一套獨立的真相帳本可以拿來重建正確餘額**——`cost_ledger` 目前只記「消耗」(debit)不記「退款」(credit),`generation_history` 是 best-effort 展示層而非帳務層。這正是 R4「多套並存記帳系統、無單一真相源」的直接證據。

**建議**:在完成發現 1 的修復(把所有生成端點納入可退款追蹤)之前,`cost_ledger` 的退款接線(env.validated.ts 列的 OPEN DECISION #2)優先度應該提高——沒有 credit 分錄,ledger 對退款密集的失敗場景是失真的,無法拿來做真對帳。

---

## 發現 3(P1 · 已坐實)`refundRestoreFailed` 缺乏自動修復/後台工具

`refundJobIfBilled`(`server/services/postGenActions.ts:575-618`)的邏輯:先 CAS 搶鎖(`atomicClaimJobRefund`)標記 `refunded=true`,才實際呼叫 `refundUserPoints`。若搶到鎖後 `refundUserPoints` 本身丟例外(DB 暫時不可用、連線中斷等),會補寫 `refundRestoreFailed: true` 並回傳 `false`。

```ts
// server/services/postGenActions.ts:597-615
try {
  await db.refundUserPoints(job.userId, points);
} catch (err) {
  console.error(
    `[refundJobIfBilled] Refund failed for job=${jobId} user=${job.userId} points=${points} (refunded flag already set — needs manual audit):`,
    err
  );
  try {
    await db.mergeBackgroundJobResultJson(jobId, { refundRestoreFailed: true });
  } catch { /* 靜默忽略 */ }
  return false;
}
```

`refundStatus.ts:97-102` 正確地把這種狀態降級顯示為 `not_refunded`(不會誤報「已退款」給使用者)——這個防禦寫得很好。**但**:
- 全庫搜尋 `refundRestoreFailed` 只出現在寫入端(`postGenActions.ts`、`director.ts`)與讀取顯示端(`refundStatus.ts`),**沒有任何 cron / job 會去掃描 `refundRestoreFailed=true` 的紀錄並重試退款**。
- `server/routers/admin.ts` 沒有任何 refund 相關的 admin 端點(`grep -n "refund\|Refund" server/routers/admin.ts` 零命中)。

**影響**:一旦真的撞到「搶到 CAS 鎖但錢包寫入失敗」這個窄窗口,目前**唯一**的修復手段是工程師手動下 SQL——沒有自動重試、沒有後台工具。機率低(需要「CAS UPDATE 成功、緊接著的 `refundUserPoints` 交易失敗」),但一旦發生,使用者的點數會卡在「不確定」狀態直到人工介入。

**建議**:新增一支輕量 cron(仿 `staleJobChecker.ts` 的模式),定期掃描 `resultJson.refundRestoreFailed=true` 的 job,對其重試 `refundUserPoints`(refund 邏輯本身冪等——多加點數對使用者有利,不會雙退,因為 `refunded` CAS 鎖已經卡住其他路徑重複「認領」,只是「執行」失敗需要重試),成功後清除該旗標。

---

## 發現 4(P2 · 已坐實)`admin.updateUserQuota` 是「絕對值覆寫」,無交易/CAS,存在 TOCTOU 風險

```ts
// server/db.ts:591-598
export async function updateUserQuota(userId: number, amount: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ remainingGenerations: amount })   // 絕對值覆寫,非 delta
    .where(eq(users.id, userId));
}
```

被 `server/routers/admin.ts:29-39`(`adminProcedure`)呼叫,管理員在後台輸入一個「新的剩餘點數」直接覆寫。

**風險說明(精確版,避免誇大)**:InnoDB 的 `UPDATE` 本身會取得列鎖,所以這**不是**「兩個 UPDATE 語句互相踩踏造成資料損毀」的物理競態——兩條 SQL 仍會序列化執行,不會 torn write。真正的風險是**邏輯層的 TOCTOU**:管理員在後台頁面載入當下看到「使用者剩餘 500 點」,决定「補到 600」,送出 `updateUserQuota(userId, 600)`;如果在管理員讀取畫面與送出表單之間,使用者自己觸發了好幾次生成(`remainingGenerations` 降到 380),管理員送出的 `600` 會**直接覆蓋掉**使用者這段期間真實發生的扣款——使用者「免費」多拿回 220 點,且沒有任何稽核軌跡指出這是覆寫造成的落差(這個 UPDATE 也沒有寫入 `cost_ledger`/`generation_history`)。

**建議**:`updateUserQuota` 改成 delta 語意(比照 `runDueAutoCreditGrant`/`refundUserQuota` 用 `sql`${users.remainingGenerations} + ${delta}`` 而非絕對值),或至少在 admin UI 上以「加/扣多少點」取代「設為多少點」,從產品語意上消除這個覆寫風險。

---

## 發現 5(P3 · 已坐實,僅影響舊資料)`director.ts` 舊任務退款回退路徑用「重新估算」而非「實際扣款金額」

`server/routers/director.ts:3364-3393`(無 `chargedPoints` 快照的分支,即 AIDV-968 之前建立的舊 job):

```ts
} else {
  const { estimatePoints } = await import("../services/modelPricing");
  const durationSec = ...
  const refund = estimatePoints(modelId, { durationSec });   // 重新估算,非原始扣款額
  claimed = await dbModule.atomicClaimJobRefund(job.id, refund.totalPoints);
  if (claimed) await dbModule.refundUserPoints(ctx.user.id, refund.totalPoints);
}
```

程式碼註解自己承認這個問題(`director.ts:2886-2890`:「recomputing from a partial set of inputs...would be silently dropped on refund」),這也是為什麼新版走 `chargedPoints` 快照。但**這個 recompute fallback 分支本身還留著**,只覆蓋「快照欄位不存在的歷史 job」。若定價(`modelPricing.ts`)在扣款當下與退款當下之間變動,或者 `params` 缺少某些計費輸入(範例本身點出的 voice 的 `charCount`),退款金額會與實際扣款金額不一致(通常是少退)。

**影響範圍**:僅限 AIDV-968 上線前建立、且事後才失敗被判定退款的少量舊 job,非持續性問題。

**建議**:低優先。若要徹底修,需要為缺快照的舊 job 補一次性資料回填(從 `generation_history`/`api_usage_logs` 反推原始扣款額),而非在退款當下重新估價。

---

## 逐題作答

### 1. 原子性:扣點/退點是否為「讀→算→寫」的非原子序列?

**否,不是。** `deductUserPoints`(`db.ts:808-893`)、`refundUserPoints`(`db.ts:898-921`)、`deductUserQuota`(`db.ts:707-763`)、`refundUserQuota`(`db.ts:769-796`)全部走同一模式:

```ts
await db.transaction(async tx => {
  await tx.execute(sql`SELECT ... FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`);
  await tx.update(users).set({
    remainingGenerations: sql`${users.remainingGenerations} - ${toDeduct}`,  // SQL 端 delta,非應用層算好寫回
  }).where(eq(users.id, userId));
});
```

`FOR UPDATE` 悲觀鎖 + SQL 端 `col ± delta`(而非「應用層讀值、算新值、SET 新值」)——兩個機制疊加,對同一使用者並發呼叫扣點/退點**不會 lost update**。`runDueAutoCreditGrant`(`db.ts:642-698`)的自動加值批次同樣走 `FOR UPDATE` + SQL delta。

**例外**:`updateUserQuota`(`db.ts:591-598`,admin 用)是唯一一個「絕對值覆寫、無交易、無鎖」的寫入函式——見發現 4。這是本檔案裡我唯一找到的真原子性缺口,但屬 admin-only、低頻操作。

### 2. 冪等性:退款有無 idempotency key / CAS claim?雙退防護在哪些呼叫點生效?

`atomicClaimJobRefund`(`db.ts:2160-2181`)提供的 CAS 是靠**單一 UPDATE 語句的 WHERE 條件**達成(`WHERE resultJson IS NULL OR ... != 'true'`),MySQL 保證該語句只有一個併發呼叫方能拿到 `affectedRows>0`,不需要額外的應用層鎖。

**這個 CAS 被系統性套用在所有「多條路徑可能同時判定失敗」的場景**——見下方對照表。單一路徑(job 尚未建立、或這是該 job 唯一可能的失敗出口)的呼叫點確實直接呼叫 `refundUserPoints` 不經過 CAS,但逐一追蹤後,這些都是「沒有其他併發路徑可能對同一筆退款送第二次請求」的情境,且多數留有明確註解說明互斥理由,並有測試(`aidv-771-orphan-refund.test.ts`)反向驗證「create-job 失敗必須緊跟退款」的程式碼結構。

**已坐實的真缺口不是「雙退」,而是發現 1 描述的「完全沒有退款路徑」**(ProStudio `checkAudioStatus` 家族)——這族群甚至沒有 `refundUserPoints` 呼叫可言,談不上冪等與否。

### 3. 對帳一致性:多套記帳系統是否會漂移?有無單一真相源?

**會漂移,且目前刻意設計成沒有單一真相源。** 詳見發現 2。`users.remainingGenerations` 是唯一「活的」餘額,`cost_ledger` 預設關閉且退款不接線(即使開啟也不平衡),`generation_history.costCredits` 是 best-effort 展示層。三者職責不同、彼此不作為對方的校驗來源,`env.validated.ts:671-678` 的註解本身就承認這是尚未拍板的「OPEN DECISION」。

### 4. 失敗處理:生成失敗→退款,是否有「退了但其實成功」或「成功但仍退款」的窗口?

在有 `backgroundJobs` 追蹤的路徑(image/video 主工作室 `generate.ts`、Suno `proStudio.ts`、`director.ts` 各流程)上,`refundJobIfBilled` 的 CAS 鎖 + `mergeBackgroundJobResultJson`(局部 JSON patch,而非整包覆寫)明確是為了避免「`doPostGenComplete`(標記成功)與 `refundJobIfBilled`(標記已退款)並發互踩」而設計(`db.ts:2183-2189` 註解直接點名這個 race,並用 `JSON_MERGE_PATCH` 而非 `JSON_SET` 整包覆寫解決)。這條防護線做得紮實。

**真正確定存在的窗口是發現 1**:ProStudio 通用非同步端點完全沒有「失敗→退款」這條線,是「持續 100% 不退款」而非偶發競態窗口——嚴格說比競態窗口更嚴重,因為它不需要任何併發條件就會發生。

### 5. 零計費繞過:有無函式可在不扣點下改 balance 或發點?

- `updateUserQuota`(絕對值覆寫)與 `updateAutoCreditPolicy`(設定自動加值規則)都鎖在 `adminProcedure`/`leaderOrAdminProcedure`(`server/routers/admin.ts:29-51`),不是一般使用者可觸發的路徑——不算「繞過」,是設計內的管理功能,但發現 4 描述的覆寫風險仍然真實存在。
- `runDueAutoCreditGrant`(`db.ts:642-698`)是排程性質的自動加值,依 `autoCreditEnabled`/`autoCreditNextAt` 條件觸發,由後台排程驅動,非使用者可控輸入。
- `server/services/spiritTools/accountantTools.ts`(「財財」AI 精靈的工具集)**純唯讀**(`estimateCost`/`compareModels`/`getMonthlyUsage`/`getBudget`,全部只呼叫 `getUserAccountInfo`/`getUserCostSummary` 等查詢函式,零 mutation)——確認沒有 AI agent 可調用的加點/改 balance 工具。
- `isDemoMode()`(`server/_core/googleAuth.ts:428-435`)= `!process.env.DATABASE_URL`(且測試環境強制關閉),只有在**完全沒接資料庫**時才會跳過扣款——這種狀態下也沒有真實的 `remainingGenerations` 可言,不構成生產環境的繞過管道。

**未在本檔驗證**:金流儲值/訂閱升級(`billing`/`plans` 相關 router,如有)如何把外部金流事件轉換成 `remainingGenerations` 加值,不在本次稽核範圍(brief 指定的四個檔案未涵蓋),建議另立稽核項目。

---

## 退款呼叫點 有無冪等保護對照表

| 呼叫點(檔案:行號) | 觸發情境 | 是否用 `atomicClaimJobRefund` CAS | 是否有並發風險 | 備註 |
|---|---|---|---|---|
| `postGenActions.ts:594-598`(`refundJobIfBilled`,被 webhookFal/webhookSuno/checkStudioJob 共用) | 生成失敗的**唯一共用退款函式**,可能被 webhook + polling + stale-checker 同時觸發 | **有**(CAS 先於實際退款) | 已消除(有併發測試 `postGenActions.refund.test.ts` 驗證 3 個併發呼叫只退一次) | 唯一入口設計,退款失敗補寫 `refundRestoreFailed`(見發現 3) |
| `webhookFal.ts:268, 338` | fal.ai webhook 判定完成無 URL / ERROR | 間接有(呼叫 `refundJobIfBilled`) | 已消除 | |
| `webhookSuno.ts:224` | Suno webhook 判定失敗 | 間接有(呼叫 `refundJobIfBilled`) | 已消除 | |
| `generate.ts:2205, 2301, 2350`(`checkStudioJob`) | polling 偵測 FAILED / 逾時 / URL 缺失 | 間接有(呼叫 `refundJobIfBilled`) | 已消除,與 webhook 路徑互斥（同一鎖） | |
| `generate.ts:2125-2126`(`submitMultimodalAsync` catch) | fal queue **submit 當下**拋例外 | **有**(先 `atomicClaimJobRefund` 才 `refundUserPoints`) | 已消除 | |
| `proStudio.ts:2126-2128`(`generateMusicSuno` catch) | Suno API 呼叫當下拋例外 | **有** | 已消除 | |
| `director.ts:3068/3072, 3345-3363, 3375-3393` | director 各生成流程 catch / polling 失敗判定 | **有**(三處皆先 CAS 才退款) | 已消除;唯 3364-3393 的 recompute fallback 分支金額可能與原始扣款不符(發現 5) | |
| `generate.ts:190, 529, 903, 916, 1003, 1016, 1104, 1117, 1212, 1225, 1498, 1914` | 主工作室**同步**流程內:job 尚未建立 / 安全檢查未過 / dispatch 失敗且未產生可被其他路徑觸及的 jobId 追蹤狀態 | **無**,但屬單一執行路徑(同一 request 內完成扣款→生成→[失敗]→退款,無 webhook/polling 可能對同一筆重複觸發) | 未發現實際風險(逐一追蹤皆為互斥的單路徑;`aidv-771-orphan-refund.test.ts` 針對 create-job 失敗分支做結構性斷言) | 這些 job 的 `resultJson` 通常未寫 `costPoints`,故 `refundStatus` 對其顯示 `none`(非「未退款」),屬已知、文件化的觀測落差,非帳務錯誤 |
| `proStudio.ts:598, 628, 652, 670, 725, 746, 773, 916, 967, 1001, ...(約 30 處,textToMusic/soundEffects/elevenLabsTTS/qwenCloneVoice/... 等)` | fal queue **submit 當下**(非非同步結果)拋例外 | **無**,同上理由(單路徑、job 未建立) | 未發現實際風險(submit 失敗屬單次同步例外,無競態路徑) | |
| **ProStudio `checkAudioStatus` FAILED 分支(`proStudio.ts:1802-1817`)** | fal queue **非同步**判定 FAILED(約 20 個端點共用) | **不存在任何退款呼叫**(非「無鎖」,是完全没有退款邏輯) | **N/A——保證發生,非併發風險** | **見發現 1,本輪最高優先級發現** |
| `server/services/orbCostGuard.ts:156, 171`(`deductCredits`/`reconcileCredits`,被 `falDispatcher.ts:482,484,620,622` 呼叫) | Orb 智能體工具執行的實際成本核銷(estimate vs actual) | 無 CAS、無 idempotency key | **未證實有雙重呼叫路徑**(本次稽核範圍內未找到會對同一次 dispatch 重複呼叫 `dispatchFalTask` 的上游重試邏輯),但函式本身不具備防護;若上游未來加入重試/重送機制,會直接雙扣/雙退 | 建議在導入任何 orb 工具重試機制前,先補上 idempotency key |

---

## 總結(給後續 wave 的交接重點)

1. **最高優先**:ProStudio 非 Suno 音訊/影片/語音端點(約 20 個)的 `checkAudioStatus` FAILED 路徑完全沒有退款邏輯——這是持續性、非併發性的「使用者扣款無產出」缺口,應立即修(建議做法見發現 1)。
2. **次高優先**:`cost_ledger` 退款側未接線(即使開啟旗標也不記 credit),使其無法作為「真相帳本」用於未來對帳/異常餘額重建;`refundRestoreFailed` 無自動修復機制,純靠人工。
3. **確認澄清**:核心扣點/退點原語本身是原子的(交易 + FOR UPDATE + SQL delta),`atomicClaimJobRefund` CAS 已系統性覆蓋所有真實存在併發風險的呼叫點,並有回歸測試佐證——W3 提出的「雙重退款」風險在目前 HEAD 版本**未被坐實**;真正坐實的是方向相反的「有扣未退」缺口(發現 1)。
4. **低優先待辦**:`admin.updateUserQuota` 改 delta 語意(發現 4);`director.ts` 舊任務 recompute 退款分支的金額準確性(發現 5)。
