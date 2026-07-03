# F — 任務卡 × PR × 程式碼三方對照

- 產生日期:2026-07-03
- 程式碼基準 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(`origin/main` HEAD,2026-07-03,即合併列車 Wave-1 #1297)
- **Jira / GitHub 快照時間:2026-07-03**(Jira 專案 AIDV,cloudId `a70fd562-…`;GitHub `aa0968111723-prog/healing-studio`)
- 方法:Jira 以 JQL 全量分頁(Done 9 頁 + 未完成 1 頁,全數取完);GitHub open PR/issues 全量取完;每個 open PR 以本地 git(`refs/pull/N/head` + `git merge-tree`)實測對 HEAD 的衝突與落後程度;抽樣卡逐一對 HEAD 程式碼查證
- 共同詞彙依據:`00-overview.md`;半成品/死碼清單依據:`01-features.md §7`

---

## 1. Jira AIDV 盤點

### 1.1 總量與狀態分佈(快照 2026-07-03)

| 項目 | 數量 |
|---|---|
| 總卡數 | **970**(最大 key AIDV-970,與逐頁計數 873+97 吻合) |
| 完成(statusCategory=Done,狀態名「完成」) | **873(90%)** |
| 未完成 | **97** |
| — 進行中 | **41** |
| — Selected for Development | 3(AIDV-8、AIDV-103、AIDV-694) |
| — Backlog | 53 |

未完成卡優先級分佈:Highest 6、High 21、Medium 34、Low 28、Lowest 8。
類型分佈:故事 41、任務 27、漏洞 16、大型工作(Epic)13。

### 1.2 Epic 結構(19 個 Epic)

| Epic | 狀態 | 主題 |
|---|---|---|
| AIDV-30 | 完成 | Wave 0 前端骨架/導演台 |
| AIDV-31~34 | Backlog | Wave 1 SSOT接線 / Wave 2 耐久任務 / Wave 3 重後端 / Wave 4 代理建置區 |
| AIDV-55 | Backlog | Wave H 營運與安全硬化 |
| AIDV-74 | Backlog | Wave U:UIUX 視覺實裝(46 頁落地) |
| AIDV-78 | Backlog | Wave I 現有功能整合 |
| AIDV-89 | 進行中 | 📥 AIDISC 討論區(Jira 暫代) |
| **AIDV-102** | **進行中(High)** | **🔄 AIDV 開放工作流程 hub(看板作業 SOP·單一作業面)**——QA/routing 卡大量掛在它名下([QA R50][AIDV-102] 等) |
| AIDV-105~109 | 完成 | 🚫 重複作廢(指回 74/30/31/32/33) |
| AIDV-125 | Backlog(High) | Wave S:AI Skill 工作層 |
| AIDV-284 | Backlog | Wave G:目標導向定位(產品北極星) |
| AIDV-296 | Backlog | Wave T:團隊運作與管理 |
| AIDV-301 | Backlog | Wave D:專案資料模型 |

未完成卡有 64/97 張**無 parent Epic**(散卡,多為 [opt]/[QA探查]/[資安巡檢] bot 產卡);有 parent 的集中在 AIDV-33(5)、AIDV-74(5)、AIDV-34(4)、AIDV-55(4)、AIDV-296(4)、AIDV-301(4)。

### 1.3 「誰在做什麼」

**全部 97 張未完成卡的 assignee 都是同一帳號(Bruce B)**——bots(qa-explore、資安巡檢、aidv-optimize、autodev)共用此帳號。AGENTS.md 規定「認領=轉進行中、一卡一人、WIP=1」,但實際**41 張同時掛「進行中」**,「進行中」已失去認領語意,變成「已研究過/半做完」的模糊狀態。進行中的 41 張裡:

- **合併列車在飛**(有對應 open PR #1298):AIDV-16(fal 雙層生影片)、AIDV-45(LoRA 調度 UI)、AIDV-148(connectors Phase 2)、AIDV-277(Creator 可見性)
- **已落地但卡未關**(見 §3):AIDV-897、AIDV-847、AIDV-254、AIDV-548(HEAD #1297 Wave-1 四卡)
- **資安高優先**:AIDV-341(Highest,realtime.subscription 缺表)、AIDV-386/388(RLS 未啟用)、AIDV-780/815(needs-bruce 安全批次)、AIDV-808(攻擊面壓縮 sprint)
- **長期半成品掛名**:AIDV-13(BullMQ)、AIDV-167(Stripe)、AIDV-23/133(Lowest 故事)

### 1.4 抽樣 20 張卡 × HEAD 程式碼實況

(逐一對 `aef4214` 查證;✅=已實作、🟡=半成品/部分、❌=未動工、⚠=卡內容已過時)

| 卡 | 狀態(Jira) | 程式碼實況 | 證據 |
|---|---|---|---|
| AIDV-897 prompt 資產連結旗標 | 進行中 | ✅ 已落地且**預設 ON** | `server/services/postGenActions.ts:40-45`(「AIDV-897 起預設 ON」註解);HEAD 即 #1297 |
| AIDV-847 getCompositionSuggestions mock | 進行中 | ✅ 已落地(真服務取代 mock) | `server/services/compositionSuggestionService.ts`(檔頭標 AIDV-847),`server/routers/worldbuilding.ts:796` 已接 |
| AIDV-548 orbFeatureDiscovery 空殼 | 進行中 | ✅ 已落地(方案 A 頻率統計,真 DB 聚合) | `server/services/orbFeatureDiscovery.ts:437+` generateRecommendations 讀 `orb_feature_usage_stats` |
| AIDV-254 /video 語音客製 | 進行中 | ✅ 已落地(Wave-1 #1297 四卡之一) | HEAD commit 標題 |
| AIDV-16/45/148/277(Wave-2 四卡) | 進行中 | 🟡 已寫完待合——在 open PR **#1298**(43 檔,對 HEAD 零衝突) | #1298 diff:`server/routers/creatorDashboard.ts`、`falTrainer.ts`、`connectors/` 等 |
| AIDV-167 Stripe webhook 空殼 | 進行中 | ❌ 仍空殼:6 個 handler 全是 console.log + TODO | `server/routes/stripeWebhook.ts:166-255` |
| AIDV-13 BullMQ+Redis 任務耐久化 | 進行中 | ❌ 未動工(package.json 無 bullmq,僅 ioredis) | `package.json:109` |
| AIDV-170 migration 重複編號 0008/0033/0067 | 進行中 | 🟡⚠ 0033/0067 已修,**0008 仍雙檔** | `drizzle/migrations/0008_admin_api_usage.sql` 與 `0008_numerous_mother_askani.sql` 並存 |
| AIDV-907 ragMemory.ts:25 TODO Pinecone 未決策 | 進行中 | ⚠ 卡過時:TODO 已不存在,Pinecone 已實作(gemini-embedding-001,dim 3072) | `server/services/ragMemory.ts:20-31`,全檔無 TODO |
| AIDV-561 後端假功能盤點 II | 進行中 | 🟡 其中 getCompositionSuggestions 項已被 AIDV-847 修掉,卡需重驗縮範圍 | 同 AIDV-847 |
| AIDV-956 Suno V4 接 audioEngine | 進行中 | 🟡 suno-v4/v3.5 已在 registry 與 proStudio 直呼,「可選引擎」抽象未完成 | `shared/audioModelRegistry.ts:20-43`、`server/routers/proStudio.ts:2029-2049` |
| AIDV-477 CLAUDE_CODE_DEBUG 洩漏 | 進行中 | ❓ repo 內無此字串——屬 Railway env 層,無法從 code 驗證 | 全 repo grep 0 hits |
| AIDV-341/386/388 Supabase RLS/realtime | 進行中(341=Highest) | ❌ 屬 Supabase prod 設定,repo 僅有現況文件(AIDV-786 #1292) | `docs/`(3fa0d959) |
| AIDV-873 /video funnel dead(Highest) | Backlog | ⚠ 其前置「AIDV-855 PORT fix」已由 #1264~#1271 一連串 commit 落地,且 AIDV-964(a726ff8a)已清掉 PORT debug 殘留 | git log 06-30~07-01 PORT 系列 |
| AIDV-949 SEO 已修但線上仍舊版 | Backlog | ✅ 程式碼已在 main(#1256, 620d2e6a 改 vite.config/robots.txt)——落差在**部署**未跟上 | commit 620d2e6a |
| AIDV-958 CI PR Gate 秒掛 | Backlog | ✅ 卡屬實:抽 30 筆 Actions runs,「PR Gate」**全部 failure 且 3-16 秒內結束**(runner/帳務問題,非 PR 本身壞) | actions_list 快照 |
| AIDV-511/871 API key blackout(Highest) | Backlog | ❓ 屬 prod env 金鑰,repo 不可驗;為看板上最高優先未結案 | — |
| AIDV-694 autodev repo credentials | Selected | ❓ 開發基建卡(與 AIDV-958、962 同族:CI/網路政策) | — |

---

## 2. GitHub 盤點

### 2.1 Open PR 總覽(**89 個**,非傳聞的 69;快照 2026-07-03)

| 統計 | 數量 |
|---|---|
| open PR 總數 | 89(draft 34) |
| 對 HEAD 有 merge 衝突(git merge-tree 實測) | **64** |
| docs-only | 20 |
| base 落後 ≤50 commits(活的) | 9 |
| 落後 51–300(過期邊緣) | 9 |
| 落後 >300(2026-04~05 殭屍,離 HEAD 550~2500 commits) | **71** |
| 依建立月份 | 2026-04:15、**2026-05:51**、2026-06:19、2026-07:4 |

**CI 注意**:所有近期 run 的「PR Gate」workflow 均在 2-16 秒內 failure(runner/帳務問題,AIDV-958)——**CI 紅不代表 PR 壞**,以下分類以本地 merge-tree+檔案分析為準。

### 2.2 活的 PR(base 落後 ≤50)逐一現況

| PR | 分類 | 現況一句話 |
|---|---|---|
| **#1298** 合併列車 Wave-2(AIDV-16/277/45/148) | **可合** | behind 0、零衝突、43 檔(creatorDashboard/falTrainer/connectors/migration 0107);draft 只差轉 ready——**首要合併對象** |
| **#1299** docs(research) 本研究分支 | 可合(docs-only) | behind 0、零衝突、持續產出中 |
| #1278 docs(plan) 開發順序重排快照 | 可合(docs-only) | behind 20、零衝突 |
| #1259 docs R9 opt-cycle 鏡像 | 可合(docs-only) | behind 38、零衝突 |
| #1268 PORT debug logging | **關閉(已被覆蓋)** | 同功能已由 #1271(f3691159)合入,且 AIDV-964(a726ff8a)又把 debug 殘留清掉了;與 `server/_core/index.ts` 衝突 |
| #1250 AIDV-926 agent_dlq correlation_id | **關閉(已被覆蓋)** | AIDV-926 已由 #1260(6ad93faa)落地;migration `0105_agent_dlq_correlation_id.sql` add/add 衝突 |
| #1255 AIDV-931/926 雙卡 | **大部分被覆蓋** | 926 部分同上;931(screenshotKey 守衛)已由 #1275(e4f11495)落地——僅剩 `server/routers/feedback.ts` 差異需人工比對後關閉 |
| #1249 AIDV-859 GuidedJourney error banner | **衝突待 rebase(仍有效)** | AIDV-859 未在 main 落地;behind 50,與 CreationFlowBar/env.validated/brainContext 衝突 |
| #1251 docs R8 鏡像(AIDV-938~940) | 衝突(docs) | 與 #1244/#1229 改**同一檔** `docs/audits/opt-cycle-2026-06-30-r8.md`,三選一 |

### 2.3 過期邊緣(51–300)

#1244、#1229(同上 R8 鏡像三胞胎)、#1214(R6 附錄,衝突)、#1151/#1147/#1071/#1052/#1006/#989(6-25~6-29 opt-cycle 鏡像,docs-only,多數僅 1 檔)、#1065(FreeLLMAPI 聚合器,與 `llmRouter.ts` 衝突,若仍要 dev/test 免費層需 rebase)、#1038(11 卡大雜燴 fix:其中 AIDV-520 已由 #1044、AIDV-251/206/238 已各自落地——**拆解價值已被逐卡 PR 吃掉,建議關**)。

### 2.4 殭屍隊列(behind >300,共 71 個,全部建議批次關閉)

- **railway bot 系列 13 個**(#202/209/211/239/245/274/565/577/583/585/586/587/588):2026-04~05 的 hotfix 提案,對應問題(migration 編號、upsertUser、rate limiter…)早已在 main 以其他方式修畢。
- **codex 系列 ~24 個**(#140~#828):多組**同題雙開**(#423=#424、#561=#562、#571≈#574、#573≈#579、#148≈#158、#695≈#697),orb agent/記憶/任務執行器等主題後來全部被 orb* 服務層重寫覆蓋。
- **claude 系列**(#345/#414/#429/#443/#507/#528/#620/#627/#628/#629/#695/#697/#741…):光球/精靈時代的功能 PR,架構已翻代。
- **docs 快照**(#621/#720/#847/#849/#851/#874/#970/#243/#349/#567):歷史稽核文件,內容已被 `docs/research/`(00/01/02)取代,擇要歸檔後關。
- #713/#593/#595(migration 0038/0047 修復):journal idx 已推進到 91+(現到 0107),完全過時。
- #98(copilot 解衝突 PR 的 PR):對象 PR #96 已無意義。

### 2.5 合併列車/同檔群(撞車風險)

1. **migration 列車**:`drizzle/schema.ts` + `drizzle/meta/_journal.json` 被 #1298、#1255、#1250(+殭屍 #1038)同時改;#1298 用 idx 0107,#1255/#1250 用 0105(已被 #1260 佔用)→ 只有 #1298 能直接上,其餘必衝(呼應 AGENTS.md 防撞協定 §2「journal idx 接續勿撞」)。
2. **R8 鏡像三胞胎**:#1251/#1244/#1229 改同一份 `docs/audits/opt-cycle-2026-06-30-r8.md`——bot 重試產生,三選一其餘關。
3. `docs/plan/AIDV-master-plan.md`:#1278 與 #1065 都動,先合 #1278(較新快照)。
4. `server/_core/env.validated.ts`:#1249 與 #1065 都動,依序 rebase。

### 2.6 Open issues(15 個,全數)

- **11 個 `[AI]` 自動提案**(2026-05-01 產,#286~#299):4 個 dangerouslySetInnerHTML XSS、1 個 new Function、2 個 process.exit、4 個引擎精準度。其中 XSS 類已被 AIDV-224(isomorphic-dompurify 全站收斂,完成)與 AIDV-251(CSP,完成)大幅覆蓋;`passwordHasher.ts` 的 `new Function` 是 dynamic-import shim,屬誤報候選;`minimax-m2.7` 404 屬模型下架。→ 全部應遷 Jira 驗證後關閉。
- **4 個 2026-04 手寫 issue**(#160 post-merge QA gate、#165 Codex schema-first planner、#176 multimodal QA、#178 Railway deploy checklist):`shared/agent-plan-schema.ts` 等目標物早已在 main,任務體系已整體遷至 Jira AIDV → 歷史性關閉。

---

## 3. 三方落差(卡 × PR × 程式碼,具體例證)

### 3.1 已合進 main 但 Jira 卡未關(GitHub 超前 Jira)

| 例證 | 細節 |
|---|---|
| AIDV-897/847/254/548 × PR #1297 × HEAD | HEAD `aef4214` 本身就是「合併列車 Wave-1:四卡落地」,但四卡快照時仍全在「進行中」(postGenActions.ts、compositionSuggestionService.ts、orbFeatureDiscovery.ts 皆可驗)。列車模式的收尾(Jira 轉完成+留言)慢於合併。 |
| AIDV-949 × #1256(620d2e6a)× vite.config.ts | 卡說「AIDV-948 標完成但 director.today 仍舊版」——程式碼確已在 main,落差在 **Railway 部署**未跟上(與 PORT 風暴/healthcheck 事故同期)。 |

### 3.2 卡已 Done(或已被別的 PR 落地)但 PR 還開著(Jira 超前 GitHub)

| 例證 | 細節 |
|---|---|
| AIDV-926 × PR #1250/#1255 × #1260 | 926 已由 #1260(`6ad93faa`,drizzle 0105)合入且卡不在未完成清單;#1250 整包、#1255 一半是殭屍,還會跟已存在的 0105 migration add/add 衝突。 |
| AIDV-931 × PR #1255 × #1275 | screenshotKey 所有權守衛已由 #1275(`e4f11495`)落地(autodev 卡 AIDV-937 也標「implemented」完成),#1255 過時。 |
| AIDV-520/251/206/238 × PR #1038 | 大雜燴 PR #1038 裡 11 卡至少 4 張已被獨立 PR 落地(#1044 等),PR 仍掛著。 |
| PORT fix × PR #1268 × #1271/AIDV-964 | debug logging 已合入又已被清除,#1268 成了雙重過時。 |

### 3.3 有卡、未實作(卡真實有效,程式碼確認缺口)

- **AIDV-167** Stripe webhook:`server/routes/stripeWebhook.ts` 6 個 handler 全 TODO/console.log——與 01-features §7「Stripe/訂閱半成品」互證。
- **AIDV-13** BullMQ 任務耐久化:無 bullmq 依賴,背景任務仍 `background_jobs` 表+in-process worker。
- **AIDV-341/386/388**(Supabase RLS/realtime)、**AIDV-511/871**(API key blackout):prod 側缺口,repo 只有文件記錄,Highest/High 未結。
- **AIDV-298~306**(Wave T/D 團隊與資料骨幹):與 §7「TeamsPage 看板+成員治理缺口」對應,均 Backlog 未動工。

### 3.4 卡內容已過時(程式碼跑在卡前面,需重驗關卡)

- **AIDV-907**(ragMemory TODO):TODO 已消失,Pinecone RAG 已實作(3072 維)。
- **AIDV-170**:三個重複編號只剩 0008 一組未修。
- **AIDV-561**:清單內至少一項(composition mock)已被 847 修掉。
- **AIDV-873**(Highest):其宣稱的阻塞前提(PORT fix 未部署)已被 #1264~#1271+#1285 系列處理,需重測 /video funnel 後降級或關閉。

### 3.5 已實作/已存在但無卡(對照 01-features)

- 01-features §7 的**死碼類**(OrbFloatButton 孤兒、AssetsLibrary section 聚合 5 分支、App.tsx 死 lazy import、BackgroundTasksDrawer、DashboardLayout flyout)在 Jira 文字搜尋**無專屬清理卡**(僅 AIDV-133「刪除舊 UI 路徑 strangler」Lowest 概括)——建議在 AIDV-133 下補子卡或直接掛清單。
- 半成品類多數**已有卡**覆蓋:export 鏈(AIDV-347/623/646/647 已完成)、LearnHub/AIModelsHub 持久化(AIDV-214 完成)、Commander/IntentComposer 與 LightOrbCreationStudio 純演示頁**未搜得對應卡**(以 text 搜尋為證,非窮舉)。

### 3.6 流程性落差

- **WIP=1 形同虛設**:41 張「進行中」/單一帳號,狀態失去「誰正在做」的資訊價值。
- **CI 全紅**(AIDV-958):PR Gate 3-16 秒必掛 → 所有合併依賴本機 gate(tsc/vitest/Docker 演練),merge 保護名存實亡。
- **同題 bot 重複開 PR**(R8 鏡像三胞胎、codex 雙開六組)——缺「開 PR 前查同分支/同檔 open PR」的防撞步驟。

---

## 4. 收斂建議(對齊 AGENTS.md 優先序:P0/P1 壞核心 > sev-high 資安 > 在飛收尾 > Wave-H > backlog by Rank > 低/UX)

### 4.1 PR 處置順序

1. **先合 #1298**(Wave-2 列車,behind 0 零衝突):合前照防撞協定 fetch+rebase、Docker 真跑 migration 0107;合後把 AIDV-16/45/148/277 轉完成,**並補關 Wave-1 四卡**(897/847/254/548)。
2. **立即關閉 4 個已被覆蓋 PR**:#1268(PORT)、#1250(926)、#1038(大雜燴)、#1255(先人工確認 feedback.ts 殘差,必要時開 5 行小 PR 再關)。
3. **#1249 rebase 收尾**(AIDV-859 未落地、卡仍開)——在飛卡收尾優先級。
4. **#1065 決策**:FreeLLMAPI 免費層若仍要,rebase 解 llmRouter 衝突;不要則關卡關 PR。
5. **docs 鏡像去重後批次合**:R8 三胞胎(#1251/#1244/#1229)擇一;#1278/#1259 直接合;#1151/#1147/#1071/#1052/#1006/#989 打包成單一 docs commit(避免六次 merge)。#1299 待研究完成後合。
6. **批次關閉 71 個殭屍 PR**(2026-04~05,behind>300):附統一留言「已被 main 演進覆蓋,對應工作見 Jira AIDV」;railway bot 13 個與 codex 重複組可先關,無任何損失。
7. **修 CI runner(AIDV-958)提前到基建最優先**——否則每次合併都在裸奔,且 mergeable 判斷永遠要人工。

### 4.2 Jira 卡治理

1. **「進行中」大掃除**:41 張裡僅保留真正在飛的(#1298 四卡+正在收尾者),其餘退回 Backlog/Selected——恢復 WIP 語意。
2. **驗證後關閉過時卡**:AIDV-907、AIDV-873(重測後)、AIDV-561(縮範圍改寫)、AIDV-170(改題為「僅剩 0008」)。
3. **Highest 未結案排最前**:AIDV-511/871(API key blackout,壞核心生成路徑=P0 級)→ AIDV-341+767+448(Supabase 資安,sev-high,AIDV-808 已是壓縮 sprint 卡,照它執行)→ AIDV-780/815(needs-bruce 安全批次,需 Bruce 拍板)。
4. **GitHub issues 清零**:11 個 [AI] 提案逐一對 AIDV-224/251 驗證後關;#160/165/176/178 標記 superseded by Jira 關閉。GitHub issues 不再作任務佇列(單一佇列=AIDV)。
5. **Epic 收攏散卡**:64 張無 parent 的 bot 卡按主題掛回 Wave H(資安)/AIDV-102(流程)/對應 Wave,讓「backlog by Rank」可操作。
6. **AIDV-102 hub 保持進行中**是合理的(常駐 SOP 卡),但掛它名下的 escalation 卡(805/809/866/873)應有 TTL:重驗不再成立即關。

### 4.3 防再發

- 開 PR 前查「同檔 open PR」(migration 類必查 `_journal.json` 最新 idx);bot 產 docs 鏡像改為 append 到當日單一分支。
- 合併列車收尾清單加一步:「合併後 5 分鐘內 Jira 轉完成+留言」,消除 §3.1 型落差。
- 每週跑一次本檔 §2 的 merge-tree 掃描(腳本化),殭屍 PR 超過 30 天自動標記。

---

## 5. 缺讀/限制聲明

- Jira `computeIssueCount` 參數無效(回傳仍是節點清單),Done 計數改以 9 頁全量分頁人工加總(873),非 API 官方 count。
- GitHub PR 的 `mergeable_state` 不在 MCP list 回傳欄位,且環境無 gh CLI;衝突判定改用本地 `git merge-tree --write-tree` 對 `aef4214` 實測(等價但非 GitHub 端 mergeable 旗標;GitHub 端另計 base 分支保護等條件)。
- CI 判定依 30 筆最新 Actions runs 快照(PR Gate 全 failure);未逐 PR 拉 check-runs。
- 卡×程式碼對照為**抽樣 20 張**(高優先/近期/進行中),其餘 77 張未完成卡未逐張驗證;873 張 Done 卡僅統計、未逐張回驗(已知反例 AIDV-949 顯示 Done≠已部署)。
- AIDV-477/511/871/341 等 prod env/Supabase 設定類缺口無法從 repo 驗證,以卡面描述為準。
- 「已實作但無卡」僅以 Jira text 全文搜尋抽查(LightOrbCreationStudio、IntentComposer、OrbFloatButton 等關鍵詞),非窮舉證明。
