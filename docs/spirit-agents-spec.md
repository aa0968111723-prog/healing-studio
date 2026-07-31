# 全站光球代理 — 5 系列使用情境 × 25 精靈完整規格書

> 本檔來源：`shared/orb-agent-roles.ts`（AgentRole / KEYWORD_RULES / SPIRIT_COLLAB_PROTOCOL / SPIRIT_PROACTIVE_TRIGGERS）、`docs/15-spirits-architecture.md`、首頁 `client/src/pages/Home.tsx`。
>
> 每節都統一三段結構：① **運行方式** ② **精靈間互相協作方式** ③ **主要功能與如何幫助使用者**。可直接做為 Canva《網站功能白皮書》中「全站光球代理系列」與「精靈篇」各頁的文案來源。

---

## Part I — 全站光球代理 5 大系列

### 系列 1｜多步驟代理（Multi-Step Agent）

**① 運行方式**
觸發點是使用者一句目標（例：「幫我做一支 30 秒品牌短片」）。光球先進入 `companion` 暖場確認目標 → `director` 把目標拆成可執行步驟 → 計畫 ≥ 3 步且使用者按下「自動執行」後，整條 workflow 交給 `plan-executor`（步步）一條龍跑完。每一步在當頁的細節操作會 handoff 給 `composer` 真正送出，做完後 `critic` 收尾總評。

**② 精靈間協作方式**
`companion → director → plan-executor → composer → critic` 為主軸。`plan-executor` 起跑前會 ping `accountant`（財財）估算總點數，中途出現站台錯誤則 ping `inspector`（守守）回報，被 mute 的精靈整條 KEYWORD_RULE 會跳過。事件 `multi_step_plan_ready` 觸發步步主動接管。

**③ 主要功能與使用者價值**
讓使用者用「講一句目標」就能跨頁完成原本需要點 10 幾個按鈕、跑遍 3 個工作室的工作。把「想清楚→做出來」的距離從 30 分鐘壓到 10 分鐘。

---

### 系列 2｜計畫（Planning）

**① 運行方式**
由 `chief-orchestrator`（總總）與 `director`（導導）負責。`chief-orchestrator` 站在團隊角度，先決定要召喚哪幾位精靈、彼此誰先誰後；`director` 把目標翻譯成有先後順序的步驟卡（Plan Card），每張卡含「目的 / 預期產出 / 預估點數 / 預估時間」。

**② 精靈間協作方式**
`chief-orchestrator` → `director` → `accountant`（先估算重預算）→ `plan-executor`（一條龍）或 `composer`（單頁執行）。若計畫涉及版權敏感素材，路由會帶上 `legal-advisor`（律律）檢查。

**③ 主要功能與使用者價值**
給使用者一份「可以拒絕、可以修改、看得到成本」的計畫，不是黑盒。新手能看懂每步在幹嘛、熟手可以直接「全部接受」交給步步跑。

---

### 系列 3｜跳頁（Cross-Page Navigation）

**① 運行方式**
由 `navigator`（路路）主導。使用者說「帶我到圖片工作室 / 帶我去調預算」，路路解析意圖、查 PageAgent 註冊表（`PageAgentContext`），確認該頁支援的 capability 後直接 navigate。光球在每一頁都保有 context，跨頁後可立即接續對話。

**② 精靈間協作方式**
`companion`/`director`/`inspector` → `navigator`。到達目標頁後：若是工作室就 handoff `composer` 上場，若是 `/learn` 教程就交給 `learning-specialist`（學學）帶讀。`PageAgent` 註冊表會聲明每頁的允許跳轉清單，路路只在白名單內跳。

**③ 主要功能與使用者價值**
解決「我知道要做什麼，但找不到入口」的痛點。使用者不必記得功能在哪個選單第幾層，光球記得就好。

---

### 系列 4｜功能詢問（Feature Inquiry）

**① 運行方式**
由 `researcher`（查查）+ `learning-specialist`（學學）合作。問「Flux 跟 Nano Banana 差在哪 / 這個訓練步驟為什麼要做」這類問題時，查查從站內模型登記、`docs/`、外部文件搜尋取答；學學負責把答案翻成「3 句新手版」與「進階參數版」並排呈現。

**② 精靈間協作方式**
`companion` → `researcher` → `learning-specialist`。查查比較完若涉及付費差異 → `accountant` 算成本；學學教完後若使用者準備動手 → `navigator` 帶到實作頁；若使用者還沒準備好 → `companion` 陪聊。

**③ 主要功能與使用者價值**
讓使用者不必離站到 Google / 論壇查資料，也不用看冗長 docs。查查＋學學會給「直接可動手的下一步」，而非倒一堆理論。

---

### 系列 5｜精靈篇（Spirit Roster）

**① 運行方式**
25 隻精靈分為 4 個家族：6 通用（director / composer / critic / researcher / navigator / companion）＋ 6 專精（image / video / music / voice / training / learning）＋ 3 主動（accountant / quality-coach / inspector）＋ 10 擴充（legal / security / community / chief / onboarding / notes / settings / plan-exec / inspiration / anatomy）。路由器 `selectRoleForIntent` 依關鍵字、上下文、靜音清單決定誰接話；`@暱稱` 強指定優先。

**② 精靈間協作方式**
協作網絡由 `SPIRIT_COLLAB_PROTOCOL` 明示，每隻精靈有 `handoffs[]`（會交給誰）與 `receivedFrom[]`（會被誰找）。例：影片完成→聲聲配旁白→音音配 BGM→品品總評。可在 UI 顯示「他做完會交給誰」的同事網絡。

**③ 主要功能與使用者價值**
人格化分身降低 AI 對話的陌生感；每隻精靈有專長領域，使用者不用學提示詞工程，叫對人就會得到對的答案。`mutedSpirits` / `favoriteSpirits` 偏好讓每個人都能客製自己的團隊。

---

## Part II — 25 精靈個別說明

> 圖示與暱稱對應自使用者列表；技術 id 對應 `AgentRole` union。

### 01｜導導 🎯（director / 跨頁工作流規劃）

**① 運行方式**
被 KEYWORD_RULE「腳本 / 計畫 / 流程 / 從 0 開始」觸發。把目標拆成有先後順序、含預估點數與時間的 Plan Card。LLM 偏好：Gemini（推理重）。

**② 協作**
- handoffs → `plan-executor`（≥3 步且想自動跑）/ `composer`（單頁執行）/ `accountant`（>2 個付費步先估算）/ `critic`（workflow 完成總評）
- receivedFrom ← `companion`、`researcher`、`navigator`、`inspector`、`plan-executor`

**③ 主要功能**
把「想做一支短片」轉成 7 步可執行的卡，使用者點「接受」就能把工程量壓到 1/3。

---

### 02｜編編 ✍️（composer / 當頁直接執行）

**① 運行方式**
在使用者已經站在工作室頁時觸發短指令（「再試一次」、「換深一點的藍」）。直接拿著當頁 context 送出 API 呼叫、不重新規劃。LLM 偏好：default_llm（純執行用便宜的）。

**② 協作**
- handoffs → `critic`（送完讓品品挑改進）/ `quality-coach`（使用者不滿意改 prompt）
- receivedFrom ← `director`、6 位專精精靈、`quality-coach`

**③ 主要功能**
讓「在工作室裡的小指令」不用再開新對話、不用重新解釋背景。編編是手感最快的一位。

---

### 03｜品品 🔎（critic / 1–3 個改進建議）

**① 運行方式**
看完作品後給「不超過 3 個」可立刻動手改的建議，每個都附「為什麼這麼建議」。不會空泛說「可以更好」。

**② 協作**
- handoffs → `composer`（套用建議到當頁）/ `quality-coach`（如果是 prompt 層問題）
- receivedFrom ← `composer`、`director`、4 位視覺/音訊專精

**③ 主要功能**
取代「請問這張圖哪裡需要改」這種無方向問句，永遠給「下一步具體做什麼」。

---

### 04｜查查 🧭（researcher / 比模型・查資料）

**① 運行方式**
被「比較 / 找 / 哪個比較好 / 是什麼」觸發。動用站內模型登記、`docs/`、必要時外部搜尋，回傳並排對照表。LLM 偏好：Gemini。

**② 協作**
- handoffs → `director`（查完排計畫）/ `accountant`（含付費選項先算成本）
- receivedFrom ← `companion`、`director`、`accountant`

**③ 主要功能**
省去離站搜尋的成本，回答永遠帶「在我們站上的對應入口」。

---

### 05｜路路 🧳（navigator / 帶到對的頁面）

**① 運行方式**
被「帶我到 / 跳到 / 開啟」觸發。檢查 PageAgent 註冊表、確認目標頁在允許跳轉清單後執行 navigate。LLM 偏好：default_llm。

**② 協作**
- handoffs → `composer`（目標是工作室）/ `learning-specialist`（目標是 `/learn`）
- receivedFrom ← `companion`、`director`、`inspector`

**③ 主要功能**
記住功能位置，使用者不必。降低「找不到入口就放棄」的流失。

---

### 06｜暖暖 🌿（companion / 開放對話・暖身）

**① 運行方式**
任何沒有明確意圖的訊息預設都進暖暖。她的工作是聊出「使用者真正要的是什麼」，再交棒給對的精靈。LLM 偏好：default_llm。

**② 協作**
- handoffs → `director`（聊清楚目標）/ `navigator`（只想去某頁）
- receivedFrom ← （所有沒被路由命中的都會默默 fallback 到她）

**③ 主要功能**
避免使用者第一句說錯就被冷冰冰拒絕。暖暖是新手的緩衝層。

---

### 07｜總總 🎩（chief-orchestrator / 團隊總管）

**① 運行方式**
站在團隊視角，被「現在誰在跑 / 整個團隊在做什麼 / 排程一下」觸發。維護任務狀態板，決定哪幾隻精靈先後輪班、誰需要 mute、誰需要召喚。事件 `team_status_overview` 主動現身。

**② 協作**
- handoffs → `director`（拆計畫）/ `plan-executor`（批准後自動跑）/ `accountant`（重預算先估）/ `critic`（完成總評）
- receivedFrom ← （無 — 總總是入口）

**③ 主要功能**
當使用者同時有 3–4 條工作流並行（影片＋圖片＋訓練）時，由總總統一報告進度，避免使用者去 4 個頁面分別看狀態。

---

### 08｜記記 📒（notes-curator / 筆記・排程・素材庫）

**① 運行方式**
被「記下 / 之後再做 / 排程 / 找剛剛那張圖」觸發。連通規劃筆記、行事曆、素材庫三個面。事件 `notes_capture_suggested`：對話中浮現重要決策時主動建議建檔。

**② 協作**
- handoffs → `composer`（翻到舊素材後套到當頁）/ `researcher`（站內沒有就上網查）/ `accountant`（排程涉及付費）
- receivedFrom ← `director`、`companion`、`community-manager`、`chief-orchestrator`

**③ 主要功能**
把「之前我做過類似的東西」變成 3 秒就翻得到，省下重新發想的時間。

---

### 09｜細細 ⚙️（settings-detail / 偏好・設定・微調）

**① 運行方式**
被「打開 / 關掉 / 偏好 / 預設 / 兩步驟驗證」觸發。直接帶使用者到設定頁對應區塊或代為勾選，不會自己亂改重要設定（需 confirm）。事件 `settings_drift_detected`：偏好與行為衝突時主動提醒。

**② 協作**
- handoffs → `security-guard`（改密碼/金鑰先讓安安檢查）/ `accountant`（改額度/訂閱讓財財估）
- receivedFrom ← `companion`、`security-guard`、`onboarding-coach`、`chief-orchestrator`

**③ 主要功能**
設定頁通常有 30+ 開關，細細幫使用者只開該開的、不誤觸危險的。

---

### 10｜步步 🧩（plan-executor / 多步驟自動執行）

**① 運行方式**
拿到 `director` 或 `chief-orchestrator` 給的 Plan Card 後，自己跨頁、跨精靈把每一步真實送出。每完成一步寫回任務狀態。事件 `multi_step_plan_ready` 觸發主動接管。

**② 協作**
- handoffs → `accountant`（起跑前估點數）/ `composer`（落地當頁細節）/ `critic`（完成總評）/ `inspector`（某步真壞了報修）
- receivedFrom ← `director`、`chief-orchestrator`、`community-manager`、`training-specialist`

**③ 主要功能**
把「全自動 AI 工作流」從口號變成可看可改可暫停的真實流程。每一步可審計，不是黑盒。

---

### 11｜圖圖 🎨（image-specialist / 出圖・修圖・放大・風格）

**① 運行方式**
站在圖片工作室。被「畫 / 出圖 / 改圖 / 放大 / 風格化」觸發。對接 Flux / Nano Banana / Imagen 等引擎。LLM 偏好：Gemini（多模態理解）。

**② 協作**
- handoffs → `composer`（出圖完套到當頁）/ `video-specialist`（圖完成接動畫）/ `critic`（總評）
- receivedFrom ← `director`、`training-specialist`、`quality-coach`

**③ 主要功能**
首頁四背景背後的「圖」由圖圖支援；使用者要主視覺、商品照、貼文圖都先找她。

---

### 12｜影影 🎬（video-specialist / 圖轉影・文生影・對嘴）

**① 運行方式**
站在影片工作室。被「影片 / 動畫 / 對嘴 / 轉場」觸發。對接 Kling / Wan / MiniMax Hailuo。LLM 偏好：Gemini。

**② 協作**
- handoffs → `voice-specialist`（配旁白）→ `music-specialist`（配 BGM）→ `critic`（總評）
- receivedFrom ← `director`、`image-specialist`

**③ 主要功能**
從一張靜圖到一支可上社群的短影音，影影把分鏡、運鏡、聲音通通一條鏈跑完。

---

### 13｜音音 🎵（music-specialist / BGM・音效・混音）

**① 運行方式**
站在音樂工作室。被「配樂 / BGM / 音效 / 混音」觸發。對接 ACE-Step 等引擎。LLM 偏好：Gemini。

**② 協作**
- handoffs → `video-specialist`（音樂做完丟回影影合成）/ `critic`（總評）
- receivedFrom ← `director`、`video-specialist`

**③ 主要功能**
影片配樂從「找版權音樂庫」改成「描述情緒就生」。一鍵契合影片節奏。

---

### 14｜聲聲 🎙️（voice-specialist / 配音・克隆・變聲・聽寫）

**① 運行方式**
站在語音工作室。被「配音 / 旁白 / 聽寫 / 我的聲音」觸發。注意：「聲音」由聲聲擁有，避免被音樂專精誤接。

**② 協作**
- handoffs → `video-specialist`（配音完接回影影對嘴）/ `music-specialist`（混底）
- receivedFrom ← `director`、`video-specialist`

**③ 主要功能**
讓沒有錄音設備的使用者也能做出帶旁白的影片；想保留個人聲線的可以用語音克隆。

---

### 15｜練練 🧪（training-specialist / 訓 LoRA・客製模型）

**① 運行方式**
站在 LoRA 訓練頁。被「訓練 / LoRA / 客製 / 我的角色」觸發。指導資料集準備、訓練參數、驗證。

**② 協作**
- handoffs → `image-specialist`（LoRA 訓好出第一張示範）/ `critic`（看示範圖評估資料集）
- receivedFrom ← `director`

**③ 主要功能**
讓使用者把「我的吉祥物」變成可重複使用的模型，從此不必每次解釋角色長相。

---

### 16｜學學 📚（learning-specialist / 教程・新手導引）

**① 運行方式**
被「怎麼用 / 教我 / 新手 / 教程」觸發。LEARNING_OVERRIDE 規則：使用者明示要學的話，會優先於其他 keyword。LLM 偏好：default_llm。

**② 協作**
- handoffs → `navigator`（教完帶實作）/ `companion`（還沒準備好就陪聊）
- receivedFrom ← `companion`、`navigator`、`inspector`、`onboarding-coach`、`chief-orchestrator`

**③ 主要功能**
把站內 30+ 篇 docs 翻譯成「3 句新手版＋進階版」並排，搭配「現在就試試看」按鈕。

---

### 17｜群群 📣（community-manager / 社群策略・分齡趨勢）

**① 運行方式**
被「貼文 / 社群 / IG / TikTok / 漲粉」觸發。維護分齡＋分平台的趨勢檔。事件 `social_post_ready`：生成完且偵測社群關鍵字時主動提排程。

**② 協作**
- handoffs → `image-specialist`（貼文視覺）/ `video-specialist`（短影音）/ `notes-curator`（排進貼文行事曆）
- receivedFrom ← `director`、`researcher`、`companion`、`chief-orchestrator`

**③ 主要功能**
把「我有作品但不知怎麼發」變成「貼文版本＋封面圖＋發文時段建議」一條龍。

---

### 18｜靈靈 💡（inspiration-specialist / 靈感・創意啟發）

**① 運行方式**
被「沒靈感 / 沒方向 / 給我點子 / 風格參考」觸發。用 inspiration.fetch 拉趨勢與參考圖，給 2–3 個方向 + 示範提示詞。

**② 協作**
- handoffs → `image-specialist` / `video-specialist` / `music-specialist`（選定方向後對應實作）/ `researcher`（要比較風格差異）/ `notes-curator`（想存下來）
- receivedFrom ← `companion`、`director`、`quality-coach`、`community-manager`、`chief-orchestrator`

**③ 主要功能**
解決「打開工作室卻不知做什麼」的空白頁恐懼。靈靈永遠給 2–3 個方向，使用者只要選一個。

---

### 19｜體體 🫀（anatomy-specialist / 身體解剖・醫學插圖）

**① 運行方式**
被「解剖 / 人體 / 醫學插圖 / 肌肉 / 骨骼」觸發。先確認部位＋用途＋風格再給精確提示詞，呼叫 studio.generateImage。

**② 協作**
- handoffs → `critic`（確認準確度）/ `composer`（疊文字標註）/ `director`（整套教學簡報）/ `image-specialist`（做 3D 可旋轉版）
- receivedFrom ← `companion`、`director`、`learning-specialist`、`community-manager`、`chief-orchestrator`

**③ 主要功能**
讓教育者、醫學圖文創作者不必去 stock 找解剖圖，可指定部位、角度、風格直接生成。

---

### 20｜財財 💰（accountant / 全站成本控制）

**① 運行方式**
主動型。事件 `monthly_spend_threshold`（用量超過閾值）、`expensive_op_about_to_run`（要花大錢前 blocking 提示）。被動被「點數 / 預算 / 多少錢 / 訂閱」觸發。LLM 偏好：default_llm（算數便宜即可）。

**② 協作**
- handoffs → `researcher`（要查省錢替代品）/ `composer`（接受後切模型）
- receivedFrom ← `director`、`researcher`、`image-specialist`、`video-specialist`

**③ 主要功能**
讓「不知不覺燒完額度」這件事消失。每次重花費前都會有財財擋一下，提供省 30–50% 的替代方案。

---

### 21｜巧巧 ✨（quality-coach / 提示詞・品質教練）

**① 運行方式**
主動型。事件 `low_quality_generation`（最近 N 張品質低）、`prompt_too_short`（prompt 模糊）。被動被「prompt / 結果不好 / 怎麼寫」觸發。QUALITY_OVERRIDE 規則優先。

**② 協作**
- handoffs → `composer`（改寫的 prompt 送出）/ `critic`（新一輪結果複看）
- receivedFrom ← `critic`、`composer`、`image-specialist`、`video-specialist`

**③ 主要功能**
教使用者寫出帶「主體 / 風格 / 構圖 / 光線」四要素的 prompt。讓品質不再靠運氣。

---

### 22｜守守 🛡️（inspector / 全站糾察・巡邏）

**① 運行方式**
主動型。事件 `site_error_detected` / `page_perf_bad` / `feature_not_used`。當使用者抱怨「壞掉 / 開不起來 / 為什麼這樣」時也會接話。

**② 協作**
- handoffs → `navigator`（找到繞過頁就帶過去）/ `learning-specialist`（是使用者卡關不是 bug）
- receivedFrom ← （無 — 守守是入口）

**③ 主要功能**
比使用者更早發現站台問題並提供 workaround。讓「平台壞了」變成「我已經幫你記下並繞過去」。

---

### 23｜律律 ⚖️（legal-advisor / AI 著作權守門）

**① 運行方式**
被「版權 / 商標 / 肖像 / 授權 / 名人」觸發。事件 `ip_risk_detected`：prompt 或上傳含名人、商標、版權 IP 時主動警示。給安全替代寫法而非單純拒絕。

**② 協作**
- handoffs → `quality-coach`（改寫成安全 prompt）/ `researcher`（查授權條款）/ `settings-detail`（開嚴格政策）
- receivedFrom ← `director`、`composer`、4 位視覺/音訊專精、`training-specialist`、`community-manager`、`chief-orchestrator`

**③ 主要功能**
把「不能做 IP 仿冒」這條紅線從「擋下並冷冷拒絕」轉成「給你 3 個合法的相近寫法」。

---

### 24｜安安 🔒（security-guard / 帳號・憑證安全）

**① 運行方式**
被「密碼 / API key / 兩步驟 / 帳號被盜 / 釣魚」觸發。事件 `credential_leak_detected`：偵測對話中貼進 API key / token / password 時 blocking 警示。

**② 協作**
- handoffs → `settings-detail`（帶到設定頁改密碼／開 2FA）/ `inspector`（懷疑站台漏洞時協同）
- receivedFrom ← `companion`、`composer`、`inspector`、`settings-detail`、`chief-orchestrator`

**③ 主要功能**
防止使用者把 API key 不小心貼進對話、防止被釣魚信騙。是平台層的安全網。

---

### 25｜帶帶 🤝（onboarding-coach / 卡關偵測・操作輔導）

**① 運行方式**
事件 `user_stuck_detected`（連續錯誤 / 長時間無動作 / 重複問同件事）主動現身。被動被「我卡住了 / 不知道下一步 / 它沒反應」觸發。

**② 協作**
- handoffs → `navigator`（教完帶實作頁）/ `learning-specialist`（想要更深入概念）/ `inspector`（卡關其實是 bug）
- receivedFrom ← `companion`、`inspector`、`chief-orchestrator`

**③ 主要功能**
把「使用者放棄」攔截在 30 秒內。每偵測一次連續錯誤就提供一個下一步、不指責、不講術語。

---

## 附錄 A：協作網絡速查圖

```
companion (暖暖) ─── 入口 / 暖場
   │
   ├─→ director (導導) ─── 拆計畫 ─┬─→ plan-executor (步步) ─── 自動跑
   │                              ├─→ composer (編編) ─── 當頁執行
   │                              └─→ accountant (財財) ─── 估點數
   │
   ├─→ navigator (路路) ─── 跨頁帶路
   │
   └─→ specialists ─── 圖圖 / 影影 / 音音 / 聲聲 / 練練 / 學學 / 靈靈 / 體體

inspector (守守) / accountant (財財) / quality-coach (巧巧) ─── 主動三人組
chief-orchestrator (總總) ─── 全團隊調度
legal-advisor (律律) / security-guard (安安) ─── 雙守門
notes-curator (記記) / settings-detail (細細) / onboarding-coach (帶帶) / community-manager (群群) ─── 生活機能
```

## 附錄 B：精靈 ID 對照表

| 暱稱 | Emoji | AgentRole id | 家族 |
|---|---|---|---|
| 導導 | 🎯 | `director` | 通用 |
| 編編 | ✍️ | `composer` | 通用 |
| 品品 | 🔎 | `critic` | 通用 |
| 查查 | 🧭 | `researcher` | 通用 |
| 路路 | 🧳 | `navigator` | 通用 |
| 暖暖 | 🌿 | `companion` | 通用 |
| 圖圖 | 🎨 | `image-specialist` | 專精 |
| 影影 | 🎬 | `video-specialist` | 專精 |
| 音音 | 🎵 | `music-specialist` | 專精 |
| 聲聲 | 🎙️ | `voice-specialist` | 專精 |
| 練練 | 🧪 | `training-specialist` | 專精 |
| 學學 | 📚 | `learning-specialist` | 專精 |
| 靈靈 | 💡 | `inspiration-specialist` | 專精 |
| 體體 | 🫀 | `anatomy-specialist` | 專精 |
| 財財 | 💰 | `accountant` | 主動 |
| 巧巧 | ✨ | `quality-coach` | 主動 |
| 守守 | 🛡️ | `inspector` | 主動 |
| 總總 | 🎩 | `chief-orchestrator` | 擴充 |
| 步步 | 🧩 | `plan-executor` | 擴充 |
| 記記 | 📒 | `notes-curator` | 擴充 |
| 細細 | ⚙️ | `settings-detail` | 擴充 |
| 帶帶 | 🤝 | `onboarding-coach` | 擴充 |
| 群群 | 📣 | `community-manager` | 擴充 |
| 律律 | ⚖️ | `legal-advisor` | 擴充 |
| 安安 | 🔒 | `security-guard` | 擴充 |
