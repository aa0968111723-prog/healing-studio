# 交接給 Claude Design — 前端 UI/UX 落地工程師（把設計交接包變成真實 React）

> **Bruce 用法**：把本檔整段貼給 Claude Design（或讓它在 repo 內讀本檔）。**自足**簡報——讀完即可在自己的分支與資料夾開工，不踩別人。
> **專案**：`healing-studio`（AI-Director 4-shell 重構）｜**事實基準**：`main` HEAD `2888a36`（React19 / Vite7 / Wouter3.7.1(patched) / Tailwind 4 / shadcn / tRPC v11 / Drizzle）。**PR #852 已開、未合併（head `500a4e4d`）；`ENABLE_4SHELL` 預設 OFF**。
> **協作模型**：四代理並行——**守門 Claude**（架構守門／整合／QC／唯一推 GitHub）、**你 Claude Design**（前端 UI/UX 落地）、**Codex**（/video 深垂直＋影片後端）、**Antigravity**（/social＋/learn＋Gemini）。各守資料夾、只透過 5 接縫契約交換。

---

## 1. 你是誰

你是 **前端 UI/UX 落地工程師**。`AI-Director-UIUX設計/` 已備一整套**紙上設計 SSOT**（設計系統 token、脊椎 chrome、四 shell 全規格、共用元件契約、`/video` 六步 + `/social` 九步工作流）。你的工作 = **把它落地成真實、可運行的 React 元件**，掛在守門 Claude 凍結的 5 接縫之後，全程 **flag-gated、預設 OFF、不破壞既有 54 路由**。

**你的所長對位**：把高保真規格忠實轉成乾淨的 React + Tailwind 4 + shadcn 元件、嚴守設計 token、四態齊全、a11y/RWD 到位、亮色 Claude 質感不走樣。

**最高準則（一句話）**：**只綁語意 token、不寫死 hex；shell 不互嵌、只走脊椎；確認門是唯一品管脊椎；先 parity 再換、只加不刪（strangler-fig）。** 違反 15 條鎖定紅線 **L1–L15**（見 `00_總交接_START_HERE.md §E`）即偏離計畫。

---

## 2. 你要做什麼（checklist · 每項標 輸入／輸出／依賴／DoD）

> 全部在 `client/src/` 內、旗標 OFF＝零行為改變。**porting 源 = `AI-Director-模擬/`**（已有 mock 版四 shell 骨架）；**設計權威 = `AI-Director-UIUX設計/`**。`react/*.tsx` 5 個元件**直接搬用**（貼到 `client/src/components`）。

### ☐ D1 — 設計系統 token 落地（先做，不等任何人）
- **輸入**：`AI-Director-UIUX設計/00_設計系統/{tokens.oklch.css, theme.css, tokens.css, 設計系統.md(§2–§7,§11), react/tokens.ts}`。
- **輸出**：① `tokens.oklch.css`（shadcn `:root` 語意變數 + Tailwind 4 `@theme inline`）貼進 `client/src/index.css` 覆蓋淺色主題；② `react/tokens.ts`（`cn`/`PROVIDER_META`/`GateState`/`GenStatus`/`SourceGrade`/`Persona`/`LOW_CREDITS=120`/`creditsForCost`）搬入 `client/src/components`；③ 確認 51 元件全綁**語意別名層**（`--text/--accent/--bd`…），不直接綁原色。
- **依賴**：無（最先做）。
- **DoD**：`npm run build` 過；切主題只改 token 層、元件零改動；靜態檢核 0 個未定義變數、括號平衡（規格載明 158 變數/227 class）；shadcn 對映正確（`--background←--bg`/`--card←--surface`/`--primary←--clay`/`--border←--line`/`--ring←--clay`，且 shadcn `--accent`＝低調 hover 底色 ≠ 品牌 accent，品牌 clay＝`--primary`/`--brand-clay`）。

### ☐ D2 — 脊椎 chrome（跨 shell 外框，可早做）
- **輸入**：`AI-Director-UIUX設計/01_殼層/殼層規格.md`（§3 chrome 元件 + §2 路由地圖）；`react/primitives.tsx`。
- **輸出**：`client/src/components/chrome/*` — `Rail`(.rail 76px：logo→4 shell 鈕→⌘K)、`TopBar`(.topbar 58px：crumb+ProjectSwitcher+ProviderChip+credits+⌘K)、`ProjectSwitcher`(.projpill)、`ProviderChip`(.provchip，down→`/settings/provider`)、`CommandPalette`(.cmdk，⌘/Ctrl+K，群組 前往/代理動作/切換專案/Provider/主題)、`Toasts`(.toast ok·warn·bad·info 4.8s)、`MobileNav`(.mnav ≤780)、`StateInspector`(.inspector，僅 demo/驗收)。+ 12 個 primitives（`Button`/`Pill`/`Tag`/`Kbd`/`Eyebrow`/`Toggle`/`Meter`/`Spinner`/`Card`/`Input`…）。
- **依賴**：D1 token；守門 Claude 的 `appRegistry` group→shell 映射（讀，不改）。
- **DoD**：四 shell 切換 Rail `.sw.on` 高亮正確（`loc.startsWith(path)`，clay→gold）；`aria-current="page"`；credits<120 顯示 `.badge`/`.tbtn.down`；providerDown 顯 `.provchip.down`；⌘K `role=dialog aria-modal` + focus trap + Esc/↑↓↵；≤780 `.hideSm` 收合 + `.mnav` FAB；**ProjectSwitcher 切換帶動 `contextPacket.compileProject`（走 IDataStore，不直連）**。

### ☐ D3 — 共用元件（四 shell 共用，含光球與工作流編輯器）
- **輸入**：`react/{PromptVault,ShotCard,GateCard}.tsx`；`設計系統.md §9`（生成→存庫→重用）；`shell-social/03`（Flow 電視牆 + OrbAssistant）；`shell-social/09`（可設定工作流）；`實站截圖觀察.md §1`（OrbAssistant 真身、ProactiveBubble、6 context tabs、25 精靈）。
- **輸出**：
  - 搬用 `PromptVault.tsx`（`SaveToVault`/`VaultBrowser`/`PromptCard` + `VaultEntry` 型別）、`ShotCard.tsx`（+`frameStyle(seed)`）、`GateCard.tsx`（+`computeGate`/`countGate`）。
  - **新建 `OrbAssistant` + `FlowWall`**（脊椎層，亮色玻璃質感：暖白半透 + backdrop-blur + 柔影 + clay 高光；保留 6 context tabs 本頁/提示詞/對話/專注流/積分/筆記 + ProactiveBubble + persona+mood）。「提示詞」tab = `VaultBrowser`；Flow 牆 = 其 showcase scope 皮膚。
  - **新建 WorkflowEditor 家族**（`WorkflowEditor`/`StepCard`(.wf-step)/`StepLibrary`(.wf-lib)/`WorkflowBar`(.wf-bar = `/video` `StageBar` 的可設定泛化)/`TemplateMenu`）。
- **依賴**：D1/D2；守門 Claude 通用 cockpit 骨架（`components/cockpit/`，實例化用）。
- **DoD**：PromptVault 三態（存檔中/成功/失敗/重複偵測 uses+1）；`SaveToVault` `aria-live="polite"`；VaultBrowser 三 SubTab（我的/團隊/block 組合）；**再生成仍先 `generate.estimateCost`、插入素材不計費、fork 走 `promptLibrary.create(forkedFrom)`**；OrbAssistant ProactiveBubble 觸發碼接得上（`prompt_too_short`/`feature_not_used`/`notes_capture_suggested` 等 16 觸發）；reduced-motion 關閉放映/呼吸動畫；WorkflowEditor 衝突 C1–C7 擋「套用」、允許「另存草稿」。

### ☐ D4 — `/video` shell 六步 + 可設定工作流
- **輸入**：`shell-video/video規格.md`（§2 六步 + §9 route↔procedure 表）；porting 源 `AI-Director-模擬/client/src/shells/video/`。
- **輸出**：`client/src/shells/video/*`（**實例化通用 cockpit 骨架**，三欄：左專案上下文／中主控台+分鏡清單／右資產+提示詞積木）。六步：① 腳本意圖 + 腳本專案庫 → ② 非線性入口 StageBar（補齊精靈）→ ③ 多模態素材創作（SourceSelector 站內/上傳/外部 + 先估成本）→ ④ 打包素材 + **簡易初剪 rough-cut**（時間軸排序/裁切/影格↔配音配樂；UI **待建**）→ ⑤ 確認門 + 反覆修改（GateCard + 逐鏡 ShotCard，改角色→受影響鏡 `stale`）→ ⑥ 完成（成片卡 + 匯出 + 歸檔 + 分享到 `/social/publish`）。
- **依賴**：D2/D3；守門 Claude `IDataStore`/`GenerationProvider`/通用 cockpit；**初剪 UI 與 Codex 的初剪/時間軸協調**（你出殼，Codex 出 `/video` 深功能與後端；初剪視圖以設計規格為準、與 Codex 對齊資料形狀）。
- **DoD**：六步全可走（mock）；鏡號 `S0X` 唯一主鍵；確認門 `ready/partial/blocked` 與 `computeGate` 一致；三鐵律永遠顯示（角色未定版不進分鏡·關鍵影格未核准不跑 i2v·生成前先估成本）；route↔procedure 全對真實名（`director.*`/`generate.*`/`worldStoryboard.*`/`vault.update`），**不得出現不存在名**（如 `imageStudio.generate`、`vault.setApproval`）。

### ☐ D5 — `/social` shell 九步 + 可設定範本編輯器
- **輸入**：`shell-social/{00 總覽,01 九步狀態機,02 S1–S3,03 S4–S5+Flow,04 S6 圖層,05 S7 Canva/Adobe,06 S8–S9 brandlock/多尺寸/發佈,07 microcopy,08 route表,09 可設定工作流}.md`；porting 源 `AI-Director-模擬/client/src/shells/social/`。
- **輸出**：`client/src/shells/social/*`（**實例化通用 cockpit 骨架，不是 import Codex `/video`**）。九步 S1 設計類型→S2 brief 六問→S3 收集素材(嵌入 `/assets` 視圖)→S4 創作(PromptVault+Flow 牆)→S5 修改→S6 圖層拼接合成→S7 Canva/Adobe 往返→S8 反覆修正→S9 完成(brand-lock 門→多尺寸匯出→發佈/行事曆/精選)。**九步 = 預設可編輯範本**：用 WorkflowEditor 增/刪/重排/啟用停用/改名、設必經可選、存自訂範本（快速貼文3步/活動海報7步/品牌系列9步）、reset 回預設。
- **依賴**：D2/D3/D4（共用 cockpit + PromptVault + WorkflowEditor）；S6 `composeLayout`、S9 `exportSizes`/`PostingProvider`、可設定工作流持久化 procedure **⏳pending（後端待建）**→ 前端先用 mock/介面契約頂住，標清楚。
- **DoD**：九步全可走（mock）；**與 `/video` 不互嵌、共用脊椎與 active project、零新表**（重用 `consistency_vault`/`block_combos`/`featured_showcase`）；**安全門與步驟解耦**——確認門（成本/品牌/來源）不隨刪步消失，鎖定步 `designType`/`create`/`complete` 不可刪不可停；文字層**不進擴散**（中文/精準排版走確定式 `composeLayout`）；mock==real 語意一致（核准/鎖定/成本/發佈判斷切真實不翻盤）。

### ☐ D6 — `/learn` shell 四區
- **輸入**：`shell-learn/{00 總覽,01 模型瀏覽器 115,02 學習中心/積分/新聞,03 研究代理/知識存庫/API金鑰,04 microcopy/route表}.md`；porting 源 `AI-Director-模擬/client/src/shells/learn/`。
- **輸出**：`client/src/shells/learn/*` — 模型情報瀏覽器(115 模型 4 統計卡 + 5 腦指派 + 虛擬化大列表)、學習中心(80 篇 6 分類)、積分/用量(餘額<120 紅 + 退點對帳)、情報新聞、研究面板(Sonar+Brave 帶引用 + 存為筆記/提示詞/知識庫 + Flow 牆)、API 金鑰/BYOMCP 入口 UI。`?sub=` 同步（6 tab key：`research/models/hub/credits/keys/news`，不可變）。
- **依賴**：D2/D3；`SonarCommanderAdapter`（Antigravity 做）；BYOMCP 治理在 `/settings`（守門 Claude）。
- **DoD**：每屏六態（空/載入/錯誤/長內容/權限[+降級]）；研究無 key 正確降級（Brave-only →「未經即時查證」橫幅）；procedure 全對真實名（`aiModels.list`/`agentModelPicks.recordPick`/`orbProxy.unifiedSearch`/`news.list`，**不得用 `agentModelPicks.assign`/`sense.research`/`sense.feed`/`credits.spend` 等不存在名**）；admin-only query `enabled:isAdmin`。

### ☐ D7 — `/settings` shell 五區 + RBAC
- **輸入**：`shell-settings/{00 總覽/RBAC,01 一般/Provider,02 代理偏好/觀測,03 RBAC後台/API金鑰UX,04 microcopy/route表}.md`；porting 源 sim `settings/`。
- **輸出**：`client/src/shells/settings/*` — 一般(外觀/導覽個人化即時生效/通知/帳號)、生成引擎 Provider(B 案 4 卡 + 回退鏈 + 故障注入)、代理偏好(3 人格 + 六代理層狀態)、觀測(LangSmith + admin-only 系統概覽/背景任務)、管理後台 RBAC(5 sub-tab：使用者·積分/內容/功能開關/資料修復誠實標待建/稽核)。5 tab key：`general/provider/agent/obs/admin`（admin leader+ only）。
- **依賴**：D2/D3；`SpineProvider.setProvider/faults`（守門 Claude）；治理後端（守門 Claude）。
- **DoD**：RBAC 三級（user<leader<admin）前端 UX 隱藏正確、**admin-only query 不送（`enabled:isAdmin`）、後端強制**；**永不顯示 secret**（平台金鑰只 isSet：`.pill.ok`/`.pill.mute`，前端不輸入 platform secret）；功能開關建置旗標唯讀（ENABLE_4SHELL/SHELL_SOCIAL/SHELL_LEARN）+ 執行時 toggle 走 `settings.update extraSettings`；資料修復誠實標「待建」（`admin.dataRepair` 不存在）。

### ☐ D8 — 跨切：四態 · a11y · RWD · microcopy · 亮色 Claude 質感
- **輸入**：`設計系統.md §0/§11`；各 shell 的 `*microcopy*` 字串表（zh-TW）；`tokens.oklch.css §16 A11Y/MOTION`。
- **輸出**：每屏四態鐵律（empty/loading/error/success，含長內容/權限/降級）；zh-TW localization（用各 shell microcopy key）；亮色 Claude 質感（暖象牙層 surface 不死白 + 黏土/珊瑚橘 clay/coral 主強調 + Fraunces 標題 + Inter 內文 + 大圓角柔陰影）。
- **依賴**：D1–D7。
- **DoD**：對比 ≥4.5:1（大字/圖示 ≥3:1）；`:focus-visible` 一律 clay 光環；`prefers-reduced-motion` 關所有動畫（掃描/旋轉/光球呼吸/放映）；共用元件「被引用不被重定義」；**無寫死 hex、無真實 API key 字串、前端不輸入 secret**；保留原系統 class 名一一對應（`.app/.rail/.card/.btn/.cockpit/.gate/.shot`…），升級在上不重建。

---

## 3. 讀哪些檔（依序）

1. **`COORDINATION.md`**（repo 根）：開工必讀（§0 旗標 · §2 看板 · §3 給你的 CCR · §6 資料夾所有權）。
2. **`00_總交接_START_HERE.md`**（本包）：§E 15 紅線、§F 安全、§C 依賴順序、§D 路徑地圖。
3. `AI-Director-UIUX設計/README.md` + `00_設計系統/設計系統.md`（SSOT，§0 鐵律 / §2–§7 token / §8 51 元件 / §9 生成→存庫→重用 / §11 四態·RWD·a11y / §12 貼回對映 / §13 凍結）。
4. `01_殼層/殼層規格.md`、`shell-video/video規格.md`、`shell-social/00–09`、`shell-learn/00–04`、`shell-settings/00–04`、`實站截圖觀察.md`、`_reference原型/index.html`（點按原型）、`_research/{02,03}.md`。
5. `AI-Director_GitNexus深度整合分析.md §D`（adapter→真實 procedure 校正，避免用到不存在的 procedure 名）。
6. **已準備好的（你 build 在其上）**：`AI-Director-P0補丁/`（4-shell 路由 + SpineProvider + 5 adapter，旗標 OFF）、`AI-Director-模擬/`（porting 源）。
7. ⏳**pending（被引用、未產出）**：`AI-Director-UIUX設計/{_GitNexus程式碼真實對照表,比對與優化報告,網站細節深掘}.md` → **不需等**，用 `_research/03` + GitNexus §D 替代；落地後補對照與 25 精靈名單。

---

## 4. 分支 / flag

- **分支**：`claude/4shell-ui-design`（從 umbrella `feat/4-shell-restructure` 開；與守門 Claude 的後端 `claude/4shell-{p1-spine,p3-supabase,settings-qa}` 不同檔、不撞車）。做完開 PR 回 umbrella。
- **flag**：前端旗標 `VITE_ENABLE_4SHELL`（總開關，OFF）、`VITE_SHELL_LEARN_RICH`(ON)、`VITE_RESEARCH_PROVIDER`(mock) 等；**你的所有產出旗標 OFF＝行為 == main**。
- **不 rebase umbrella、不碰別人分支、不開旗標、不擅改 server**；push／合併由守門 Claude 做（Bruce 拍板）。

---

## 5. 你依賴的接縫契約（守門 Claude 凍結，你只 import、不改簽章）

| # | 接縫 | 介面 | env 旗標 | 你的角色 |
|---|---|---|---|---|
| 1 | DataStore | `IDataStore` | `DATA_STORE=mock\|trpc` | **消費**（四 shell 讀寫走它，不直連後端、不 `callClaude`/`window.storage`） |
| 2 | Generation | `GenerationProvider` | `GENERATION_PROVIDER=mock\|hf\|gemini\|fal` | **消費**（UI 觸發，先 `estimateCost` 再生成） |
| 3 | Commander | `CommanderAdapter` | `COMMANDER_ADAPTER=fallback\|sonar\|subq` | **消費**（研究面板/導演計畫） |
| 4 | ContextPacket | `IContextPacketCompiler` | `CONTEXT_PACKET_MODE=mock\|rag-pinecone\|rag-pgvector` | **消費**（切專案 compile） |
| 5 | Storage（選配） | `IAssetStorage` | `STORAGE_PROVIDER=mock\|r2\|gcs\|supabase` | **消費** |

- 介面定義在 `client/src/adapters/types.ts`（守門 Claude 擁有）。**通用 cockpit 骨架**在 `client/src/components/cockpit/`（守門 Claude 擁有，你 `/video`、`/social` 各自實例化它）。
- **要改任何介面簽章 / `appRegistry` group→shell 映射 / 脊椎 provider 樹 → 不准自己動**：到 `COORDINATION.md §3` 開 **CCR**，守門 Claude 用 GitNexus 查影響面後拍板、bump 契約版本、廣播；你再 rebase 取新契約。**mock 與 real 同簽章同語意**。

---

## 6. 共用元件契約速查（四 shell 都會用到）

- **PromptVault（生成→存庫→重用）** `react/PromptVault.tsx`：`[prompt]→generate.estimateCost→submitStudioJob→jobStatus→recordGenResult→存庫 promptLibrary.create(prompt+params+assetId)`；重用三路 ①一鍵再生成(仍先估成本) ②插入素材(不計費) ③fork(`forkedFrom`)。真實落點已驗證（`promptLibrary.create`/`promptCollection.*`/`blockCombos.create`/`generate.recordGenResult`→`digital_asset_library`）。⏳ prompt↔asset 明確 FK 可能需後端 additive（`prompt_library` 或缺 `assetId`）→ 標清楚、前端先頂。
- **Flow 電視牆**（`shell-social/03`）：**不是新元件**，是 `VaultBrowser`+`PromptCard`（showcase scope）的展示皮膚。卡面顯 seed+prompt；**延伸**=把 seed+prompt 推回 S4 input（固定 seed 一致變體）；**套**=套風格組合+排版範本（不重生）；放映模式（reduced-motion 關）。繼承全部 token，**不可另立新色**。
- **可設定工作流**（`shell-social/09`）：`WorkflowTemplate{id,name,scope,isDefault,version,steps[]}`；`WorkflowStep{stepKey,label,order,enabled,required,removable,togglable,route,dependsOn[],gate?}`；`ActiveWorkflowBinding{scopeId,templateId,pinnedVersion?}`。前端預設 9 步=內建常數；**⏳持久化 procedure 待建**（`social.{list,get,save,delete,setActive}WorkflowTemplate` + `workflow_templates` 表，**範本＝既有 `director.{templates,saveSession,...}` 的鏡像**）→ 前端先 mock。安全鐵則：**門 ≠ 步**，鎖定步 `designType`/`create`/`complete` 不可裁；衝突 C1–C7 擋套用。
- **OrbAssistant / 光球助手**（`實站截圖觀察.md §1`）：脊椎層常駐右下浮球，主動冒泡（ProactiveBubble，emoji+精靈名+一句+CTA）；面板 6 context tab（本頁/提示詞/對話/專注流/積分/筆記）+ persona+mood；「提示詞」tab = `VaultBrowser`。亮色玻璃但保留全部行為。⏳ 25 精靈完整名單待「網站細節深掘」從程式碼補。

---

## 7. 輸出 / 驗收（Definition of Done）

**輸出**：D1–D8 真實 React 元件 + 各屏四態 + 介面契約消費（mock 可跑）+ 點按可走完 `/video` 六步、`/social` 九步、`/learn`、`/settings`。PR 用 `AI-Director-整合包/PR說明範本.md` 填，DoD 全綠。

**DoD（每個 PR，硬門檻）**：
1. **回歸三件套全綠**：`npm run check:routes`／`check:smoke`／`check:navigation`（**54 路由全可達、舊連結不斷**——`/director`/`/image-studio`… 仍 redirect 到新 `/video/*`，永不 404）。
2. `npm run build`＋`npm run typecheck` 通過；`vitest` 既有測試不退步。
3. 你的前端 flag（`VITE_ENABLE_4SHELL` 等）**預設 OFF；OFF 時行為 == main**。
4. **不改 `drizzle/schema.ts` 既有 82 表、不碰 server/**；只在 `client/src/` 加法。
5. **設計合規**：100% 語意 token、零寫死 hex；四態鐵律；對比/focus/reduced-motion 達標；共用元件被引用不被重定義；procedure 名全對真實（無不存在名）；亮色 Claude 質感、zh-TW。

**驗收劇本**：
- **token 切換**：改 token 層，全站視覺換皮、元件零改動；保留原 class 名（`.cockpit/.gate/.shot`…）。
- **四 shell 端到端（mock）**：`/video` 六步、`/social` 九步（含可設定範本增刪重排、安全門不隨刪步消失）、`/learn` 研究降級、`/settings` RBAC 隱藏——皆可走且四態齊全。
- **不互嵌**：`/social` 與 `/video` 共用脊椎與 active project，但**不互相 import UI**；切 shell 帶同一專案。
- **a11y/RWD**：⌘K focus trap、`:focus-visible` clay 光環、≤780 收合 + MobileNav、reduced-motion 全關。

---

## 8. 與其他 agent 的接縫（會合在哪、不准碰哪）

- **← 守門 Claude**：你依賴 `client/src/adapters/types.ts`（5 介面）、`components/cockpit/`（通用骨架）、`shared/appRegistry.ts`（group→shell）、`client/src/index.css`（token 落點，與你 D1 協調由誰最終貼入——預設你貼、守門 Claude review）。**介面/映射/脊椎 provider 樹不准自己改——提 CCR。**
- **↔ Codex**：`/video` 殼與初剪 UI 由你出（依設計規格）；Codex 出 `/video` 深功能（確認門窮舉分支、`director.*` 後端、HF/Fal 生成、影片 job 後端）。**初剪/時間軸的資料形狀與 Codex 對齊**（你綁 UI、它綁狀態機/後端）；Codex 沉澱可被 `/social` 重用的 cockpit 片，經守門 Claude 提取進通用骨架。
- **↔ Antigravity**：`/social`、`/learn` 的**視覺殼與共用元件由你提供**；Antigravity 接 `GeminiGenerationAdapter`/`SonarCommanderAdapter`、PostingProvider、canvas 拼接深功能、帳務視圖資料。你出 `OrbAssistant`/`FlowWall`/`VaultBrowser`/`WorkflowEditor`/canvas 殼，Antigravity 填邏輯與 provider。**S6 圖層拼接的 canvas 元件**：你出 UI 殼與 `composeLayout` 介面對接，Antigravity 接 konva/fabric 實作（見其交接 §F）——**邊界先在 `COORDINATION.md` 對齊**。
- **✗ 不要碰**：`server/*`、`drizzle/*`、`client/src/adapters/types.ts`（簽章）、`components/cockpit/`（骨架本體，只實例化）、別人 shell 的 `shells/*` 與 `components/{director,gate,social,learn}/*` 領域檔。

---

## 9. 你的工作如何合併進主線

1. 你在 `claude/4shell-ui-design` commit，做完開 PR 回 umbrella `feat/4-shell-restructure`。
2. **守門 Claude 是你 PR 的第一 reviewer**（守 token 合規、脊椎、不互嵌、不破壞路由）；Codex/Antigravity 第二（看各自 shell 的元件契約對位）。
3. DoD 全綠後，**守門 Claude** rebase umbrella、合你的子分支、跑回歸三件套、重建 GitNexus 索引。
4. 整包對 `main` 的 PR（#852，head `500a4e4d`）由守門 Claude 維護，**push／合 PR 由 Bruce 最後拍板**。
5. **排序**：D1 token / D2 chrome 可最先做（只等 P0 落地）；D3–D7 shell 等 P1 契約凍結 + 通用 cockpit 骨架；`composeLayout`/`exportSizes`/可設定工作流持久化等 ⏳後端 procedure 由守門 Claude 補後再接真實。

---

## 10. 協作規則（一句話清單）

開工讀 `COORDINATION.md` + `00_總交接_START_HERE.md` + 查 GitNexus（動既有元件前先查反向依賴）；**只綁語意 token 不寫死 hex**；**shell 不互嵌只走脊椎**；共用元件被引用不被重定義；procedure 名只用真實存在的；你的成果掛 flag 預設 OFF；不改 schema/不碰 server；不 rebase umbrella、不碰別人分支；push／合併由守門 Claude 做、Bruce 拍板。**先 parity 再換功能、只加不刪。**

---

*本簡報對齊 `00_總交接_START_HERE.md`、`AI-Director-UIUX設計/`（設計 SSOT：設計系統 + 殼層 + shell-video/social/learn/settings + 實站截圖觀察）、`AI-Director_開發計畫.md`（P0–P6）、`AI-Director_四大系統架構.md`（4-shell/脊椎/六代理）、`COORDINATION.md`（§0 旗標 / §3 CCR / §6 所有權 / §7 DoD）、`AI-Director_GitNexus深度整合分析.md §D`（procedure 校正）。⏳ pending 輸入見 §3 與 `00_總交接 §G`。*
