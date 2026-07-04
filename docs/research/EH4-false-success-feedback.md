# EH4 — 失敗回報成功/UI 無回饋
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:router mutation 回 {success:true} 但底層可能沒成功;client 對 FAILED/error 狀態的回饋

## 方法
1. 全站掃 `server/routers/*.ts` 中所有 `return { success: true, ... }` 出口(87 處),逐一往回檢查其所在
   mutation 是否有 catch 吞錯後仍落到該 return、是否有未 await 的旁路寫入。
2. 全站掃 client `refetchInterval` / 輪詢元件(42 個檔案)與 `status === "FAILED" / "failed"` 分支(約 40 處),
   檢查輪詢到 FAILED/error 狀態時,UI 是否真的從「處理中」轉為「失敗」呈現,或只是 fire 一次 toast 後
   畫面卡住。
3. 對比同類元件的姊妹實作(例如 VideoStudio 的 AsyncVideoPoller vs ProStudio 的 AsyncAudioPoller),用
   「同款元件、其中一個有 AIDV 修過、另一個沒有」作為找漏網之魚的訊號。
4. 確認框關閉時機:找 `.finally()` / `onOpenChange` 是否在 mutation 成功前就關閉;此波未發現新的無條件關閉
   確認框案例(ProjectNotesDrawer 已知案例維持既有紀錄,不重複)。

---

## 發現(按嚴重度排序)

### 1〔HIGH〕ProStudio AsyncAudioPoller:任務 FAILED 後 UI 卡在「背景生成中」,無限轉圈
- **cluster**: false-success
- **檔案**: `client/src/pages/ProStudio.tsx:267-349`(元件定義),FAILED 分支在 `:304-306`,無回饋的
  fallback 轉圈畫面在 `:322-346`
- **失敗情境(行號)**:
  - `checkAudioStatus` 輪詢(`:282-293`)偵測到 `poll?.status === "FAILED"` 時(`:304`),只執行
    `toast.error(...)`(`:305`)——toast 幾秒後自動消失,**沒有任何 setState 把「失敗」寫進本地狀態**。
  - 元件的渲染分支只有四種:`audioUrl` 存在 → 播放器(`:309`);`isError`(tRPC query 本身丟例外)→
    紅框錯誤卡(`:311-317`);`dismissed` → null(`:320`);否則只要 `result.request_id && !audioUrl` 就
    畫「背景生成中...」轉圈圈(`:322-346`)。
  - `poll?.status === "FAILED"` 屬於「query 成功回傳、但業務狀態是失敗」,不會觸發 `isError`;
    `refetchInterval`(`:286-288`)在 FAILED 時确實停止輪詢,但 `audioUrl` 永遠不會出現、`dismissed`
    預設 false —— 於是永遠落入最後一個分支,**畫面對使用者呈現「還在生成中」的假象,實際上任務已死、
    也不會再更新**,直到使用者自己按右上角 X 關閉。
  - 對照組:同一份檔案裡 `client/src/pages/VideoStudio.tsx` 的姊妹元件 `AsyncVideoPoller`
    (`:706-790`)在 FAILED 時會把 `raw.failed = true` 寫回 result(`:748`),並在渲染時多一個
    `isError || asRecord(result.raw)?.failed` 分支(`:758`)畫出「生成失敗」紅卡 + 「點數紀錄」連結
    ——這正是 AsyncAudioPoller 缺少的那塊。`ImageStudio.tsx:3131-3135` 也有等效的
    「failed/cancelled → 釋放 local loading state」處理,附註明確寫著「不然面板會轉個不停」。
  - **影響面**:`AsyncAudioPoller` 在 `ProStudio.tsx` 被使用 8 處(音樂/TTS/配音/歌詞/音效等多個分頁,
    行號 1440、1787、2268、2655、2720、2827、2961、3413),換言之 ProStudio 的音訊類分頁失敗時全部
    會卡假處理中,只有一次性 toast 提示、且很容易被使用者錯過。
- **建議**:比照 `AsyncVideoPoller` 的做法,FAILED 時把失敗旗標寫回 `result`(經由 `onUpdate`),渲染時
  增加對應分支顯示「生成失敗」卡片(含重試/點數紀錄連結),而不是讓最後一個 catch-all 分支吃掉 FAILED
  狀態。

### 2〔MEDIUM-HIGH〕`models.syncReplicateStatus` 同步失敗時以 `toast.info` 呈現,語氣蓋掉「失敗」語義
- **cluster**: false-success / lost-error-context
- **檔案**: `server/routers/models.ts:196-198`(server 端 catch);
  `client/src/pages/LoraTrainer.tsx:544-551`、`client/src/pages/ModelsPage.tsx:586-593`(client 端消費)
- **失敗情境(行號)**:
  - `syncReplicateStatus` mutation 呼叫 Replicate `predictions.get` 若拋例外(網路逾時、Replicate
    503 等),`catch (e: any)` 直接 `return { status: model.status, message: `同步失敗:${e.message}` }`
    (`models.ts:196-198`)——**不 throw、DB 狀態也不變更**,對 tRPC 而言這是一次成功的 mutation。
  - client 端兩處呼叫都只用 `onSuccess`/`onError` 分流:`onSuccess` 內部用
    `if (data.status === "ready") ... else if (data.status === "failed") ... else toast.info(...)`
    (`LoraTrainer.tsx:547-549`、`ModelsPage.tsx:589-591`)。因為 server 端把「同步失敗」也走
    `onSuccess` 通道、且 `data.status` 維持原本的 `"training"`/`"pending"`,client 一律落入
    `else` 分支,顯示 **藍色/中性的 `toast.info("狀態已同步:同步失敗:ETIMEDOUT ...")`**。
  - 使用者實際看到的是一則「資訊」通知,字面上前半段還寫著「狀態已同步」,真正的失敗原因被夾在後半段
    當作细节文字,色調與其他普通狀態更新（如 `toast.info("狀態已同步:狀態：training")`)完全一樣，
    很容易被當作正常心跳略過，不會意識到這次「重新整理狀態」按鈕其實什麼都沒查到。
  - 需執行期驗證:此路徑只在 Replicate API 暫時不可用時觸發，未在本次稽核中實際重現網路逾時場景，
    上述行為推論基於程式碼路徑靜態分析。
- **建議**:server 端該 catch 分支回傳型別加一個明確的 `synced: false` 或改走 `TRPCError`(讓 client
  的 `onError` 接手,天生走紅色 toast);至少 client 端要對 `message` 內容做失敗語意判斷再決定
  `toast.error` vs `toast.info`,不要讓「同步失敗」文字混在 info 語氣裡。

### 3〔MEDIUM〕影片專案 `save` 的自動版本快照 fire-and-forget 靜默失敗,使用者以為有存版本紀錄
- **cluster**: fire-and-forget / false-success
- **檔案**: `server/routers/videoProject.ts:405-409`(save mutation 內的快照建立),對照
  `server/routers/videoProject.ts:328-336`(restoreSnapshot 內同一函式改為 await 且有前置安全快照的
  嚴謹用法)
- **失敗情境(行號)**:
  - `save` mutation 在完成 `db.updateVideoProject`(已確認更新成功,`:393-403`)之後,若前端有帶
    `snapshotData`,用 `void db.createProjectSnapshot(input.id, input.snapshotData, snapshotSource)
    .catch(() => {})`(`:408`)寫入版本快照——**完全靜默的 catch,連 log 都沒有**。
  - mutation 本身仍正常回傳(帶新 `version`、設定 `ETag`、寫 audit log,`:410-429`),用戶端與
    `videoProject.save` 呼叫方看到的是徹頭徹尾的「成功」,對「這次編輯有沒有進版本歷史」完全沒有
    可觀測性。
  - 對照同檔案 `restoreSnapshot`(`:307-336`)在回溯前建立 `pre-restore` 安全快照時是 **await 且不
    吞錯**——若這裡失敗會直接讓整個 restoreSnapshot 拋錯,凸顯開發者原本清楚「快照建立失敗不該被
    默默放過」,但 `save` 路徑的自動快照卻選擇整個吞掉、且不像其他 best-effort 案例(如
    `assets.ts:313-323` 的刪除物件)有加註解說明「這裡是刻意的取捨、有後備機制」。
  - **使用者可見的壞狀態**:若該次快照沒存成功,使用者之後想用「回溯到某個時間點」功能時,會發現
    版本清單少了一筆,但沒有任何當下的錯誤提示可以回溯原因;此類間歇性失敗基本無法追查。
  - 需執行期驗證:`createProjectSnapshot` 在什麼條件下會拋例外(例如 DB 瞬斷、payload 過大)未在此次
    靜態分析中確認,實際觸發率未知。
- **建議**:至少補一行 `console.warn`/`logger.warn` 留痕(比照 `postGenActions.ts:553-557` 的
  `mergeBackgroundJobResultJson` 失敗處理方式),讓失敗可被觀測;若快照對這個功能是「版本歷史」的
  核心資料,可考慮讓 mutation 回傳一個 `snapshotSaved: boolean` 供前端在失敗時提示「本次變更已存檔,
  但版本快照未成功記錄」。

---

## 已正確處理錯誤(negative results,列出以避免重複稽核)

以下是本波掃描中特別檢查、確認「失敗會被正確傳遞、不構成假成功」的案例:

1. **`server/services/postGenActions.ts:575-618` `refundJobIfBilled`** — 用 CAS 旗標
   (`atomicClaimJobRefund`)先佔位再退款,退款本身失敗時明確補寫 `refundRestoreFailed` 旗標
   (`:605-613`),搭配 `server/services/refundStatus.ts:97-103` 的推導邏輯,確保「搶到退款鎖但錢包
   沒入帳」不會被誤報成 `full` 退款——這是本輪掃描中對「退款 no-op 卻顯示已退」這個題型設計最嚴謹的
   一處,值得作為其他退款/扣點路徑的參考範本。

2. **`client/src/contexts/BackgroundTasksContext.tsx`(全域背景任務中心)** —
   - `submitTask`(`:489-550`)呼叫端原本會把送出失敗整個吞掉(程式碼註解 `:539-542` 明白記載了這段
     修復歷史),現況已改成 `console.error` + `toast.error` 顯性化失敗,同時維持 `return null` 契約。
   - 逐一 polling `checkStudioJob` 時對 `completed`/`failed` 兩種終態都有完整的 toast + 音效 +
     桌面通知處理(`:316-384`),FAILED 分支(`:367-383`)確實觸發 `toast.error` 並刷新任務列表,狀態
     機沒有卡死的分支。

3. **`server/routers/generate.ts:2176-2365` `checkStudioJob`** — fal.ai 暫時查詢失敗時明確
   `logger.warn` 並維持 `processing`(`:2353-2362`,註解標註 AIDV-792),不會靜默轉終態;COMPLETED
   但解析不到結果 URL 時也刻意改標 `failed` + 退款(`:2284-2307`)而非留一張假成功的空卡片。

4. **`client/src/pages/VideoStudio.tsx:706-790` `AsyncVideoPoller`**、
   **`client/src/pages/ImageStudio.tsx:3115-3136`** — 两处对 FAILED/cancelled 状态都有对应的
   本地状态释放与错误卡片渲染,是本报告发现 1(ProStudio AsyncAudioPoller)本该对齐、却没对齐的正确
   参照实现。

5. **`client/src/pages/TeachingArchive.tsx:1883-1925` `TranscriptionSection`**、
   **`client/src/components/learn-hub/PersonalDatabasePanel.tsx:74-101` `StatusBadge`** —
   转文字/OCR 的 pending/processing/failed 三态都有对应 UI(含失败态的「重跑」按钮),不构成本轮题型的
   问题案例。

6. **`client/src/pages/DirectorAI.tsx:1591-1718`(单个生成任务卡)、
   `client/src/contexts/GlobalOrbChatContext.tsx:1670-1770`(工作流执行面板)** — FAILED 状态都有
   独立的红色标签、重试按钮、失败原因翻译(`formatWorkflowFailure`),UI 与实际状态一致。

7. **`server/routers/apiKeyRouter.ts:69-80` `revoke`** — 用 `affectedRows === 0` 判断
   是否真的撤销成功,撤销 0 笔时明确 throw `NOT_FOUND`,不构成「没改到东西却回 success」。

8. **`server/routers/notes.ts:265-307`、`vault.ts:67-106`、`assets.ts:201-223`** —
   各类 update/delete mutation 均先做归属检查(`userId` 比对)再 `await` 实际 DB 操作,DB 操作失败会
   自然抛出 tRPC 错误而非被 catch 吞掉,不构成假成功。

9. **`client/src/components/VideoProjectCreateDialog.tsx:66-85`、
   `client/src/pages/PromptCollectionPage.tsx:163-259`** — 检查的多个「确认框关闭」用例,均在
   `onSuccess` 回调内才关闭对话框/清空表单,`onError` 均有对应 `toast.error`,未发现无条件关闭确认框
   的新案例(ProjectNotesDrawer 既有案例维持不变,不重复列出)。

10. **`server/routers/agentCollaborationRouter.ts:490-517` `autoDiscussion`（fire-and-forget
    runner)** — 属于有意识的设计取舍：注释明确写明「任何错误都记 log 不丢出来 — 失败的 turn 已经
    写进 bus、UI 端 polling 仍然能看到既有讯息与最后状态」，配合 `logger.error`
    留痕，不构成静默失败。

---

## 结论与优先级建议
1. 先修 **发现 1（ProStudio AsyncAudioPoller）**——影响面最广（8 处调用点）、且已有同项目内的
   正确参照实现（AsyncVideoPoller）可以直接抄，改动成本低。
2. **发现 2（syncReplicateStatus 语气问题）** 次之——虽然只是 toast 严重度分类错误，但直接影响
   LoRA 训练这个高成本操作的可观测性，用户可能因为看到「资讯」通知而误以为一切正常。
3. **发现 3（videoProject 自动快照静默失败）** 优先级最低——功能本身（自动版本历史）不是核心产出，
   失败也不影响当次编辑保存成功，仅建议补 log。
