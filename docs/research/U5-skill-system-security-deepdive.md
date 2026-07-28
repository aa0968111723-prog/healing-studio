# U5 — 技能系統安全邊界逐行深挖(對抗式)

> 2026-07-03 · commit 7f4417da(HEAD 已推進至 1b50a89e,見下方「讀取時點」)· 「逐檔深挖 wave U」
> 範圍:`skillRegistryService`/`skillSandbox`/`skillSupplyChain`/`skillValidator`/`skillOrchestrator` + `officialSkillAdapters` + `shared/skills/` + `shared/skill-manifest.ts` + 3 個 drizzle migration(0084/0086/0087,0085 另見既有稽核檔)+ `skillRegistryRouter.ts` + `AdminPage.tsx` Skill tab + `drizzle/schema.ts` skillRegistry 表。
> 讀取時點:`git log -1` 顯示 HEAD 為 `1b50a89e`(2026-07-03 14:17:03Z);任務指定 commit `7f4417da` 為稍早版本,本檔內容以實際 HEAD 為準,兩者在本次讀取範圍內無差異(未見額外變更痕跡)。
> 已讀不重複:`docs/research/E-ai-agents.md` §8.4「Skill 三件套」段落、`docs/research/K1-security-bugs.md`(grep 無 skill 命中)、`docs/research/K4-deadcode-contracts.md` §5.1 孤兒服務表、`docs/research/01-features.md` §3.3 Admin skills 分頁列。
> 方法:逐行讀完全部 7 支核心檔案(76+228+453+359+135+151+115 = 1,517 行)+ shared/skill-manifest.ts(91 行)+ 5 個官方 skill.json + 1 個 preset.json + 3 個 drizzle migration + AdminPage.tsx skill tab 段落 + drizzle/schema.ts skillRegistry 定義。**對關鍵假設(node:vm 隔離)寫了可執行 PoC 實測,不僅讀碼推論。**

---

## 0. 系統全景(先建立心智模型,避免後續與 shared/agent-skills.ts 混淆)

**重要澄清(新發現,見 §7):`shared/agent-skills.ts`(790 行,AGENT_SKILL_REGISTRY)與本檔案討論的「Skill 安裝/執行系統」是兩個完全不相干的概念**,只是共用「skill」這個詞:
- `shared/agent-skills.ts` = 光球 12 角色/6 專家/頁面能力的路由表,純資料、無外部程式碼、無 manifest、無安裝流程,注入 system prompt 用(`server/orb-prompt-skill-injection.test.ts` 測的是這個)。
- 本檔案討論的 = `shared/skill-manifest.ts` 定義的 `SkillManifest`(可含任意 JS `code` 欄位)+ `skill_registry` DB 表 + 五支 service + 一支 router,對應「安裝外部/社群技能」的高危面。

全站 grep 確認兩者**零交叉引用**——`OFFICIAL_SKILLS`/`skillRegistry`/`SkillManifest` 從未被 `orb-agent-roles.ts`、`orb-specialized-agents.ts`、`agentToolExecutor.ts`(光球工具派發本體)引用。

---

## 1. 安裝/信任/執行流程

- **安裝**:`skillRegistryRouter.installSkill`(`server/routers/skillRegistryRouter.ts:27-51`)是**唯一**對外寫入口,`adminProcedure` 保護(`server/_core/trpc.ts:69-88`,要求 `ctx.user.role === "admin"`;`leader` 角色連 Admin 頁的 skills 分頁都看不到,`client/src/pages/AdminPage.tsx:431-433` 的 `isTabVisible` 白名單把 `skills` 排除在 leader 子集外)。**現況真的可觸發**:此路由是活的,админ 貼一段 `skill.json` manifest JSON 字串→zod parse→`installSkill()`→寫入 `skill_registry` 表,整條路徑無死碼。
- **信任等級**:`official`(全權限)/`reviewed`(materials+特定 connectors,禁 crossProject)/`community`(零權限,強制 sandboxed)三級,`TRUST_CEILING` 常數表定義(`server/services/skillRegistryService.ts:31-35`)。`validateExternalSkillManifest`(`server/services/skillSupplyChain.ts:129-151`)阻擋外部 manifest 自稱 `trust:"official"`。
- **執行**:唯一的執行入口是 `SkillOrchestrator.runPreset()`(`server/services/skillOrchestrator.ts:135-221`)。**現況(呼應 K4,再次確認):`skillOrchestrator.ts` 全站(除自身)零匯入者**——沒有任何 router/cron/job 呼叫 `skillOrchestrator` 這個 export 或 `SkillOrchestrator` 類別。因此 §2 的 vm 逃逸雖然證實可行,**目前沒有活的觸發路徑**能讓外部使用者的請求跑到 `runSandboxedSkill`。這是「骨架 vs 真跑」的關鍵分界線,以下逐條標注。

---

## 2. 【新發現 · Critical 設計缺陷 · 目前不可觸發(orchestrator 孤兒)】node:vm 沙箱本質上不是安全邊界——已用 PoC 證實可完全逃逸至 host process 並 RCE

**位置**:`server/services/skillSandbox.ts:45-85`(`buildRestrictedContext`)、`:95-135`(`runSandboxedSkill`)。

**問題**:檔頭聲稱「Isolation guarantees:No network / No filesystem / No process / Whitelist-only API surface」,但 `buildRestrictedContext` 把 **host realm 的原生物件**(`JSON, Math, Date, Array, Object, Error, ...`)直接以物件參照塞進 `vm.createContext()`。這是 Node.js 官方文件明文警告的已知陷阱(vm 模組本身聲明「is not a security mechanism」):任何 host 物件的 `.constructor` 原型鏈最終都指向 **host realm 的真正 `Function` 建構子**,而非沙箱內建的。攻擊者程式碼只需:

```js
const OuterFunction = Date.constructor.constructor;   // 拿到 host realm 的 Function
const proc = OuterFunction("return process")();       // Function() 在 host 全域執行 → process 是 host global
```

即可拿到 **真正的 Node `process` 物件**——完全跳脫「無 fetch/fs/process」的隔離承諾。

**觸發情境**:任何 `kind:"sandboxed"` skill 的 `manifest.code` 若真的執行到 `runSandboxedSkill()`。

**後果(已用可執行 PoC 實測,非推論)**:
1. 直接讀到 host `process.env`(含資料庫連線字串、API key 等機密)、`process.cwd()`、`process.pid`。
2. Node ≥20.16/22 上,`process.getBuiltinModule('node:child_process')` 可直接繞過 ESM/CJS 的 `require` 限制,PoC 於本機容器實測 `execSync('id')` 回傳 `uid=0(root) gid=0(root)`——**完整任意指令執行**,且容器內以 root 執行。

**PoC 重現(已在本次任務中實際執行,結果附於下)**:
```js
import { createContext, Script } from "node:vm";
// ...(context 建構與 skillSandbox.ts:45-85 完全一致的白名單集合)
const code = `
  const OuterFunction = Date.constructor.constructor;
  const proc = OuterFunction("return process")();
  const cp = proc.getBuiltinModule('node:child_process');
  return cp.execSync('id').toString();
`;
// 輸出: "uid=0(root) gid=0(root) groups=0(root)\n"
```
另一支 PoC 單純讀 `process.env` 的前 3 個 key(`SHELL/IS_SANDBOX/COREPACK_ENABLE_AUTO_PIN`)同樣成功,證明機密外洩路徑也同時成立,不需要 `getBuiltinModule` 這麼「巧」的 API 才能造成傷害——單是 host `process` 物件洩漏本身就已是 critical。

**現況是否可觸發**:**目前不可觸發**——因為(a)`skillOrchestrator`(唯一呼叫 `runSandboxedSkill` 者)零呼叫者(§1),且(b)即使有呼叫者,§3 會證明 `manifest.code` 目前根本不會被存進 DB,執行時一定是 `undefined` 而提前失敗。**但這是設計層級的缺陷,不是「還沒接線」的問題**——只要有人日後把 orchestrator 接上任何一個 router(這正是 `officialSkillAdapters.ts` 頭部註解自陳「S-3 orchestrator will drive」的既定方向),且順手修掉 §3 的資料遺失 bug,這個 vm 逃逸就會立刻變成可從 Admin 已裝的「community 信任層級」skill 觸發的完整 RCE。修法建議:**vm 模組不能靠加白名單堵,必須換成真正的行程層隔離**(獨立 worker process + seccomp/cgroup、或 `isolated-vm`/V8 isolate、或直接砍掉 `kind:"sandboxed"` 只保留 `kind:"declarative"`)。

---

## 3. 【新發現 · High(架構缺口,非單純孤兒)】`skill_registry` 表沒有 `code`/`kind` 欄位——manifest 的執行語意在安裝當下就整個遺失

**位置**:`drizzle/schema.ts:4558-4587`(skillRegistry 表定義)、確認 0084/0085/0086/0087 四個相關 migration 全部沒有新增 `code` 或 `kind` 欄位、`server/services/skillRegistryService.ts:141-154`(`installSkill` 的 `db.insert` values 只寫 `skillId/version/name/trust/grantedConnectors/grantedMaterials/grantedCrossProject/status/installedBy/source/manifestChecksum/needsReaudit`)。

**問題**:Admin 貼的 manifest 通過 `SkillManifestSchema` 驗證(含 `kind` 與可能的 `code` 欄位)後,`installSkill()` **只挑幾個 metadata 欄位寫入 DB,`manifest.code` 與 `manifest.kind` 從未被持久化**。`skillOrchestrator.resolveExternalSkill()`(`server/services/skillOrchestrator.ts:337-368`)之後從 DB row 重建一個「最小 SkillManifest」時,是這樣寫的:
```ts
kind: (entry as { kind?: string }).kind as "declarative" | "sandboxed" ?? "sandboxed",
...
code: (entry as { code?: string }).code ?? undefined,
```
因為 DB row 上根本沒有 `kind`/`code` 這兩個屬性,`(entry as {kind?:string}).kind` 恆為 `undefined`,`?? "sandboxed"` 恆觸發——**所有外部安裝的技能,不論原本宣告 `kind:"declarative"` 還是 `"sandboxed"`,在執行時一律被誤判為 `"sandboxed"`**;同時 `code` 恆為 `undefined`。

**後果**:
1. (意外的安全網,呼應 §2)任何嘗試 dispatch 外部 sandboxed skill 的呼叫都會在 `dispatchExternalSkill()`(`skillOrchestrator.ts:375-378`)提前丟出 `"has no code field — cannot execute"`——這是 §2 vm 逃逸目前不可觸發的第二道(意外的)防線。
2. 但同時,重建出的 manifest 的 `inputs: {}` / `outputs: {}` / `providers: []` 也都是空殼——`instantiateSkillStep()`(`server/services/skillValidator.ts:81-115`)的「必填欄位檢查」是對這個空 `inputs` 物件做的,實質上**對所有外部技能形同關閉**(因為重建出的 manifest 宣稱它不需要任何輸入,不管原始 manifest 實際宣告了什麼必填欄位)。
3. 這代表 §1 的「安裝」與 §4 的「validator」流程雖然各自邏輯正確,但**兩者之間的資料橋接斷裂**——`skill_registry` 表目前的欄位集合,結構上就不足以支撐 `skillOrchestrator` 檔頭宣稱的功能(執行外部 declarative/sandboxed 技能)。這比 K4 單純標注「skillOrchestrator 零呼叫者」更進一步:即使有人接上呼叫者,現有資料模型也需要先補 migration(加 `code`/`kind`/`inputs`/`outputs` 欄位)才能讓外部技能真正跑起來。

**現況是否可觸發**:此資料遺失本身是「一定會發生」的既有行為(只要呼叫 `installSkill` 就會遺失),但其「後果」只在 §1 所述的 orchestrator 被接線後才會被人觀察到/影響到——目前無實際危害,純屬架構債。

---

## 4. 【新發現 · Medium · 邏輯 bug,非孤兒/骨架問題】`withinTrustCeiling()` 的 connector 檢查只對 `community` 生效,`reviewed` 層級形同虛設

**位置**:`server/services/skillRegistryService.ts:38-50`。

```ts
export function withinTrustCeiling(
  trust: "official" | "reviewed" | "community",
  requested: Partial<SkillPermissions>
): boolean {
  const ceiling = TRUST_CEILING[trust];
  if (requested.crossProject && !ceiling.crossProject) return false;
  if (requested.materials && !ceiling.materials) return false;
  const extra = (requested.connectors ?? []).filter(c => !ceiling.connectors.includes(c));
  // For official the ceiling.connectors is empty (all connectors allowed); for others only
  // those pre-approved by Admin are valid. Community gets none.
  if (trust === "community" && extra.length > 0) return false;   // ← 只檢查 community
  return true;
}
```

**問題**:`TRUST_CEILING.reviewed.connectors` 也是空陣列 `[]`(`skillRegistryService.ts:33`),因此對 `reviewed` 層級來說 `extra`(請求的 connector 中不在 ceiling 允許清單裡的部分)幾乎必然非空——但判斷式只在 `trust === "community"` 時才會因 `extra.length > 0` 回傳 `false`。**`reviewed` 層級完全沒有對應的 `extra.length > 0` 檢查分支**,导致函式對 `reviewed` 永遠落到 `return true`,不論請求了什麼 connector。

這與檔頭文件註解直接矛盾——`skillRegistryService.ts:6-9` 明文:「`reviewed → materials + specific connectors allowed`」,暗示 reviewed 應該有「經 Admin 預先核准的特定 connector 清單」這個機制,但程式碼從未實作這個檢查。

**觸發情境**:
- `installSkill({trust:"reviewed", manifest: {permissions:{connectors:["anything-attacker-wants"], materials:true, crossProject:false}, ...}})` → 通過 `withinTrustCeiling("reviewed", ...)` 檢查(第 129 行呼叫點),安裝成功。
- 之後 Admin 對該技能呼叫 `grantPermissions({skillId, connectors:["anything-attacker-wants"]})`(`server/services/skillRegistryService.ts:204-233`)一樣會通過同一個(有 bug 的)`withinTrustCeiling` 檢查(第 217 行呼叫點),真的把該 connector 寫進 `grantedConnectors` 欄位。

**後果**:目前 `connectors` 欄位**全站零消費者**(grep 確認,只有 skill 系列 5 支檔案 + `drizzle/schema.ts` 提到這個詞,沒有任何實際的 connector 派發/呼叫機制存在)——所以此 bug 目前**無實際外洩管道**,純粹是「本該擋住的 ceiling 沒擋住」。但只要日後有人把 `grantedConnectors` 接成真正的外部 API/webhook 白名單(這正是欄位存在的目的),`reviewed` 層級的 skill 就能繞過「只能用 Admin 預先核准的 connector」這個設計初衷,任意宣告 connector id 並被允許——形同讓 `reviewed`(比 `official` 低一階的信任層級)實質上擁有跟 `official` 一樣「connector 無限制」的行為,卻沒有 `official` 層級應有的稽核強度。屬於明確的邏輯缺陷,建議修法:把 `if (trust === "community" && extra.length > 0)` 改成 `if (trust !== "official" && extra.length > 0)`,或給 `reviewed` 一個真正的 admin 預核准 connector 允許清單來源。

---

## 5. 【新發現 · Medium · 供應鏈設計缺口】`updateTrust()` 繞過 `checkUpgrade`/`needsReaudit` 的整套供應鏈再審機制

**位置**:`server/services/skillRegistryService.ts:236-260`(`updateTrust`)對比 `:310-359`(`upgradeSkill`,真正套用 `checkUpgrade`/`detectPermissionEscalation` 的地方)。

**問題**:系統設計了兩條完全獨立的「改變技能狀態」路徑:
1. `upgradeSkill()`——manifest **版本**升級時,套用 §「supply chain」邏輯(`checkUpgrade`),若新版請求的權限超出目前已授予範圍→ fail-closed(`status:"disabled", needsReaudit:1`)。
2. `updateTrust()`——**信任等級**直接變更(`community→official` 等),**完全沒有呼叫 `checkUpgrade`/`detectPermissionEscalation`/checksum 重新驗證**,只在「降級」(`downgrading` 布林值判斷,`:246-249`)時才會清空 `grantedMaterials/grantedCrossProject/grantedConnectors`;**升級信任等級時,舊的已授予值原封不動保留,同時新的信任天花板(ceiling)瞬間放寬**。

**觸發情境**:Admin(或被綁架的 admin session)對一顆從未經過官方稽核、原本是 `community`(零權限)的第三方技能,直接呼叫 `updateSkillTrust({skillId, trust:"official"})`(對應路由 `server/routers/skillRegistryRouter.ts:53-62`)。此呼叫**不檢查 manifest 內容、不重算 checksum、不比對權限差異**,純粹把 `trust` 欄位改字串。

**後果**:此操作本身不會立刻自動授予 `materials`/`crossProject`(那些欄位維持不變),但它**移除了本該存在的技術護欄**——`upgradeSkill()` 精心設計的「manifest 版本升級若請求擴權就 fail-closed 需要人工再審」整套供應鏈防線,對「信任等級」這個更關鍵的軸完全不適用。任何後續的 `grantPermissions()` 呼叫此時會用「official」的天花板(`materials:true, crossProject:true` 全開)來檢查,而不再受 `community` 天花板限制——等於兩次 Admin 操作(`updateSkillTrust` + `grantPermissions`)就能讓一顆未經真正官方審核的技能拿到與 `OFFICIAL_SKILLS`(五個內建、真正被 code review 的技能)同等的權限上限,而中間沒有任何 checksum 比對或「這個技能的程式碼跟安裝時一樣嗎」的驗證。建議修法:`updateTrust()` 升級路徑應該同樣呼叫 `checkUpgrade`/checksum 驗證,或至少強制升級到 `official` 需要重新跑 `validateExternalSkillManifest` + 重算 checksum 比對。

---

## 6. 【已知(K4 已標,補充細節)· 骨架程度確認】`officialSkillAdapters.ts` 五個 adapter 中四個是純 stub

**位置**:`server/services/officialSkillAdapters.ts:42-51`(`runStoryboardBreakdown`)、`:70-76`(`runWorldStyleInject`)、`:159-176`(`runShotGenerate`)、`:197-202`(`runCutRough`)全部回傳硬編碼空值/預設值,檔內註解自陳「Stub — S-3 orchestrator will drive the tRPC procedure through the caller context」。**唯一有真實邏輯的是 `runMaterialsGround`(`:97-110`),它直接呼叫 `searchTeachingArchive()`** 做 RAG 搜尋——但因為 §1 已確認 orchestrator 零呼叫者,這個唯一「活的」adapter 目前也无法被觸發。5 個官方 skill manifest(`shared/skills/official/*.skill.json`)全部宣告 `kind:"declarative"`,無一使用 `kind:"sandboxed"`,因此 §2 的 vm 風險目前完全不適用於官方技能,只適用於「假設有人裝了帶 `code` 欄位的 community/reviewed 技能」的假設情境。

---

## 7. 【新發現 · Low/資訊性】命名混淆:`shared/agent-skills.ts` 與技能安裝系統零交叉

見 §0。此為文件/未來維護角度的風險(容易誤判交會面),非執行期安全漏洞,但明確回答任務問題 5——「技能能否成為光球可呼叫工具、擁有權、requireConfirmation」:**目前完全不能**。`skillOrchestrator.PresetStep.requireConfirm`(`server/services/skillOrchestrator.ts:47`,ConfirmGate 機制)是這套系統*自己*的暫停/人工核准設計,與光球 `agentToolExecutor`/`agentScopeGuard` 的角色 scope、以及 orb 工具的 `requireConfirmation` 標記完全獨立、互不相通——安裝的技能永遠不會出現在光球可呼叫的工具清單裡,兩邊各自有一套 confirm-gate 概念但沒有共用實作。

---

## 8. 【新發現 · Low】整條技能安全邊界(§2-§6 涉及的六支檔案)零專屬單元測試

全站搜尋 `*skill*test*`,只找到 `server/orb-prompt-skill-injection.test.ts` 與 `tests/unit/shared/agent-skills.test.ts`——兩者都是 §0/§7 提到的「不相干的 AgentSkill 路由概念」,**`skillSandbox.ts`/`skillSupplyChain.ts`/`skillValidator.ts`/`skillOrchestrator.ts`/`skillRegistryService.ts`/`officialSkillAdapters.ts` 六支合計 1,441 行、被 `E-ai-agents.md` 稱讚為「Skill 三件套」安全亮點的程式碼,完整無任何 vitest 覆蓋**。哪怕一個「餵一段 `Date.constructor.constructor` 惡意 code 給 `runSandboxedSkill` 應該被擋下」的測試案例都能在合併前抓到 §2 的逃逸。這是文件宣稱的「安全設計」與實際驗證強度之間的落差,值得在後續補強清單中排前面。

---

## 9. 【已知,順手核實現況】admin 專屬寫入面確實是唯一入口,無提權捷徑

`skillRegistryRouter.ts` 四個 mutation(`installSkill`/`updateSkillTrust`/`setSkillStatus`,加上 query 的 `listSkills`/`getSkillById`)全部套 `adminProcedure`,無任何 `leaderOrAdminProcedure` 混用(對照 costs/api 分頁確實用了 leaderOrAdmin,skills 沒有)。`AdminPage.tsx` 的 skill 資料以 React JSX `{s.skillId}` 等方式渲染,無 `dangerouslySetInnerHTML`,無 XSS 面。此點與已知的「破壞性操作僅 admin」設計一致,列出是為了明確劃定 §2-§6 各項 finding 的前置信任門檻——**目前所有攻擊情境都需要先取得 admin 帳號**,屬於「防禦縱深失效後才生效」的次級風險,而非未認證/一般使用者可直接觸發。

---

## 缺讀聲明

- `server/services/teachingArchiveSearch.ts`(`runMaterialsGround` 唯一依賴)本身的權限/範圍隔離未逐行讀,僅信任其簽章(`userId` 範圍化查詢)。
- `server/_core/agentScopeGuard.ts`、`agentToolExecutor.ts` 全文未在本輪重讀(已由 E-ai-agents.md 覆蓋,且 §0/§7 已確認與本系統無交叉,故未列為本輪範圍)。
- migration `0085_skill_registry.sql` 的部署阻斷 bug(`ON UPDATE (now())` 語法錯誤)**非新發現**,已由既有稽核檔 `docs/audits/sec-patrol-2026-06-29-migration-0085.md` 記錄並修復(PR/branch `fix/migration-0085-on-update-now`),本檔僅確認其與本次分析的 `skill_registry` 表結構(§3 用到的欄位集合)一致,未重複列為 finding。
- PoC 僅在本機沙箱環境(node v22.22.2,容器內 root)驗證 `runSandboxedSkill` 的邏輯副本,未實際對 Railway prod 環境發起任何請求或連線(該路徑目前也無 HTTP 入口可達,見 §1)。
- `shared/skills/official/video-workflow.preset.json` 之外是否還有其他 preset 檔案未窮舉搜尋(僅 glob 到 `shared/skills/official/*.json` 六個檔案,含此 preset)。
