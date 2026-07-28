# DV4 — vite/vitest 弱點(dev/build/test-only)風險評估
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:npm 弱點在本 repo 的可達性分析

## 範圍與方法

負責稽核 npm audit 清單中的兩顆:
- `[high] vite <=6.4.2:path traversal in optimized deps .map handling`
- `[critical] vitest <=3.2.5:Vitest UI server 任意檔案讀取/執行`

依序查證:package.json 依賴位置、`npm ls` 實際解析版本、`package-lock.json` 巢狀樹、`npm audit --json` 對應 GHSA、CI workflow(`.github/workflows/pr-gate.yml`)、`vite.config.ts`、`vitest.config.ts`、`server/_core/vite.ts`、`server/_core/index.ts` 的實際呼叫點。全部有檔案:行號佐證,無臆測。

---

## 弱點一:vite — Path Traversal in Optimized Deps `.map` Handling

**CVE 摘要**:GHSA-4w7w-66w2-5vf9,Vite dev server 在處理 `optimizeDeps` 產生的 `.map` sourcemap 請求時,對路徑未正確驗證,允許透過 dev server 讀取專案目錄外的任意檔案(CWE-22 / CWE-200)。官方公告受影響範圍為 `<=6.4.1`。

**套件位置(直接依賴)**:
- `/home/user/healing-studio/package.json:172` — `"vite": "^7.1.7"`(devDependencies)
- `npm ls vite` 實際解析:頂層 `vite@7.3.2`(`node_modules/vite`)
- 巢狀第二份:`vitest@2.1.9` 內建 `vite-node`(`node_modules/vite-node/node_modules/vite@5.4.21`,以及 `node_modules/vitest/node_modules/vite@5.4.21`)—— 這是 vitest 2.x 為了自己的模組轉譯（run test 檔案用）而綁定的舊版 vite,與 top-level 的 vite 7.3.2 並存、互不影響。

**版本核對結果(關鍵發現)**:
- `npm audit --json` 回報 `GHSA-4w7w-66w2-5vf9` 的受影響範圍是 `<=6.4.1`。
- 頂層直接依賴解析到的是 **vite@7.3.2**,已經 > 6.4.1,**該顆 CVE 對頂層 vite 已經不適用**(已被較新版本自然帶過)。npm audit 之所以仍把 vite 列入「高風險」,是因為同一個 `vite` advisory group 底下還混了另外兩個更晚公告、影響 7.x 的問題(`GHSA-v6wh-96g9-6wx3` launch-editor NTLMv2 hash 洩漏、`GHSA-fx2h-pf6j-xcff` `server.fs.deny` Windows 繞過,兩者範圍含 `>=7.0.0 <=7.3.4`),**但這兩個不在本次任務指派的 CVE(path traversal .map)清單內**,故僅附註、不列入本弱點的可達性判定。
- 真正落在 `<=6.4.1` 受影響範圍內的是**巢狀** `vite-node`/`vitest` 內建的 **vite@5.4.21**。

**脆弱路徑是否被呼叫**:
- 頂層 vite dev server 唯一啟動點:`/home/user/healing-studio/server/_core/vite.ts:16` `createViteServer({...serverOptions, appType: "custom"})`,並在 `:23` `app.use(vite.middlewares)` 掛載中介層。
- 該函式 `setupVite` 只在 `/home/user/healing-studio/server/_core/index.ts:1012-1013` 被呼叫:
  ```
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  ```
  即:**只有 `NODE_ENV === "development"` 才會啟動 Vite dev server**;其餘情況(含 production)一律走 `serveStatic`(純靜態檔案,無 Vite 執行期)。
- `npm start`(`/home/user/healing-studio/package.json:14`)明確寫 `NODE_ENV=production node dist/index.js`,**強制跳過** `setupVite` 分支。production 部署跑的是 `dist/index.js`(esbuild 產物)+ `dist/public`(vite build 靜態產物),**Vite 執行期完全不在 prod runtime 內**。
- `npm run dev`(`tsx watch server/_core/index.ts`)靠 `.env`(`dotenv/config`,見 `index.ts:1`)提供 `NODE_ENV`;`.env.example:7` 預設 `NODE_ENV=development`,代表本機開發預設會啟動 `setupVite`。
- 就算本機啟動 `setupVite`,實際掛載的 Vite 版本是**頂層 vite@7.3.2**(`viteConfig` 來自 `/home/user/healing-studio/vite.config.ts`,由頂層 `vite` 套件的 `createServer` 建立),**不是** vitest 內建的 5.4.21。頂層 7.3.2 已不在 `<=6.4.1` 受影響範圍內,故本機 dev server 對「本顆 CVE」也不可達。
- 巢狀的 vite@5.4.21(在 `<=6.4.1` 範圍內、確實脆弱)只被 `vite-node` 用來在 **Node 進程內**轉譯/執行 vitest 測試檔案(見下一節說明),**不會對外開啟可被瀏覽器/攻擊者請求的 HTTP dev server**,因此該漏洞利用手法(對 Vite dev server 發送帶路徑穿越的 `.map` 請求)沒有對應的可攻擊 HTTP 端點。

**攻擊者輸入來源**:此漏洞需要攻擊者能對「正在跑的 Vite dev server」發出 HTTP 請求(例如透過瀏覽器 CORS/CSRF 或直接網路存取 dev server 埠)。
- Prod:不適用(dev server 未啟動)。
- Dev 本機:頂層 dev server 版本已不在受影響範圍。
- Dev server 對外暴露性(附註,非本 CVE 但影響風險評級):`/home/user/healing-studio/vite.config.ts:321-331` 設定 `server.host: true`、`allowedHosts` 含 `.manuspre.computer` `.manus.computer` `.manus-asia.computer` `.manuscomputer.ai` `.manusvm.computer`(疑似團隊使用的雲端預覽/開發沙箱網域)。這代表**開發期 Vite dev server 可能被綁定到非 loopback 介面並允許特定外部網域存取**——若未來 vite 版本降級或再度出現同類 path-traversal 弱點,這個對外暴露面會放大風險,建議列為衛生項目追蹤,但**與本次指派的 CVE(已因版本 7.3.2 不受影響)無直接關聯**。

**prod / dev 判定**:**dev-only**。Prod runtime 不含 Vite 執行期(僅靜態產物),`npm start` 強制 `NODE_ENV=production` 跳過 `setupVite`。

**可達性判定:not-reachable(prod)/ not-reachable(dev,頂層版本已不在受影響範圍;巢狀脆弱版本無對外 HTTP 端點)**

**修法與破壞性風險**:
- 頂層 `vite` 已是 7.3.2(`^7.1.7` 範圍內最新 patch),對本顆 CVE 已修復,**理論上不需再動**;但 npm audit 仍標記 vite 為 high(因另兩顆 7.x 公告),若要一併清掉,`npm audit fix` 應可在 `^7.1.7` semver 範圍內拿到後續 patch(需另行 dry-run 確認,不在本次任務範圍)。
- 巢狀 vite@5.4.21(來自 vitest 2.x 的 vite-node 依賴)無法透過 `npm audit fix` 單獨升級——它是 `vitest@2.1.9 → vite-node@2.1.9 → vite@^5.0.0` 這條鏈鎖定的,**必須整條升級 vitest 大版(2→4)才會連帶把內建 vite 換掉**(詳見下一顆弱點的修法)。單獨升級無破壞性風險(prod 不受影響);升級 vitest 大版有測試框架 API 破壞性風險,見下節。

---

## 弱點二:vitest — Vitest UI Server 任意檔案讀取/執行(critical)

**CVE 摘要**:GHSA-5xrq-8626-4rwp,當 `vitest --ui`(需搭配 `@vitest/ui` 套件)啟動的 UI server 在監聽時,缺乏存取控制(CWE-862),遠端可讀取並執行任意檔案。CVSS 9.8(`AV:N/AC:L/PR:N/UI:N`)。官方公告受影響版本 `<3.2.6`。

**套件位置(直接依賴)**:
- `/home/user/healing-studio/package.json:174` — `"vitest": "^2.1.9"`(devDependencies)
- `npm ls vitest` 解析結果:`vitest@2.1.9`,落在 `<3.2.6` 受影響範圍內。
- `@vitest/ui`:**只出現在 `package-lock.json:18660,18674` 的 `peerDependenciesMeta`(`optional: true`)**,即 vitest 宣告它是「可選 peer dependency」,**並未實際安裝**。已核實 `node_modules/@vitest/ui` 目錄不存在(`node_modules/@vitest/` 下只有 `expect`、`mocker`、`pretty-format`、`runner`、`snapshot`、`spy`、`utils`,無 `ui`),`node_modules/.bin/` 下也沒有任何 `vitest-ui`/UI 專屬執行檔。

**脆弱路徑是否被呼叫**:
- 觸發此漏洞的前提是「Vitest UI server 正在監聽」,也就是必須執行 `vitest --ui`(或等效 API),而該指令**需要先安裝 `@vitest/ui`**。本 repo 該套件根本不在 `node_modules` 內,**UI server 這段程式碼路徑目前無法被觸發**(缺少必要套件,不是「有裝但沒開」,是「連裝都沒裝」)。
- 全 repo 搜尋 `--ui` / `@vitest/ui` 用法(排除 `node_modules`):僅命中兩份既有稽核文件的**文字敘述**(`/home/user/healing-studio/docs/research/N4-cost-ops-decisions.md:169` 與 `/home/user/healing-studio/docs/research/G4-misc-audit.md:20`,內容為既有研究對此漏洞的討論與結論,與本次獨立查證結論一致),**沒有任何 script、CI 設定、或原始碼實際呼叫 `--ui` 旗標或 `@vitest/ui` API**。
- CI(`/home/user/healing-studio/.github/workflows/pr-gate.yml:59-60`)執行的是:
  ```
  - name: 測試（vitest run · 全量把關）
    run: npx vitest run
  ```
  `vitest run` 是一次性批次執行模式,**不啟動任何 server**(不論 UI 或 watch-mode API server),執行完即結束進程。GitHub Actions hosted runner 上**不會**有 Vitest UI server 監聽。
- `package.json` scripts 中唯一的 vitest 呼叫是 `/home/user/healing-studio/package.json:29` `"test": "vitest run"`,同樣是批次模式,不啟動 server。

**攻擊者輸入來源**:此漏洞需要攻擊者能對「正在監聽的 Vitest UI server」發出 HTTP 請求(遠端未驗證,CVSS `AV:N`)。由於:
1. `@vitest/ui` 套件未安裝,
2. 沒有任何 script/CI 使用 `--ui`,
3. CI 只執行 `vitest run`(無 server),

**目前沒有任何情境下這個 server 會被啟動**,因此也沒有「攻擊者可控輸入」的問題——攻擊面本身不存在。若開發者**日後**手動 `npm install --save-dev @vitest/ui` 並在本機執行 `vitest --ui`,且該本機埠又被暴露到非 loopback 網路(例如透過 `vite.config.ts` 中出現的 `.manus*.computer` 類雲端預覽環境的 port-forward 機制),才會產生真實可攻擊面——此為假設情境,目前 repo 狀態下不成立。

**prod / dev / CI 判定**:**dev-only,且目前連 dev 也不可達**(缺必要套件 + 從未使用 `--ui` 旗標)。CI 不會開啟 UI server。

**可達性判定:not-reachable**(現狀;若未來安裝 `@vitest/ui` 並執行 `--ui`,才會變成 `reachable-limited`,取決於該埠是否對外暴露)

**修法與破壞性風險**:
- `npm audit` 給出的修復是 `vitest@4.1.9`(`fixAvailable.isSemVerMajor: true`)——**vitest 2 → 4 是兩個大版跳躍**,屬 semver major,有實質破壞性風險:
  - Vitest 3/4 對設定檔 API、`environment` 解析、`deps.inline` 行為、reporter API 等有 breaking changes,需要重新驗證 `/home/user/healing-studio/vitest.config.ts` 全部設定(尤其 `deps.inline: [/file-type/]`、`environment: "node"` 預設 + per-file `@vitest-environment jsdom` 覆寫是否仍受支援)。
  - 連帶效應:升級後 vitest 內建的 `vite-node` 依賴會跟著換成新版 vite(而非鎖死在 `^5.0.0`),**這同時會解決弱點一裡巢狀 vite@5.4.21 的殘留版本**,一次升級兩顆一起清。
  - 需要跑滿現有測試套件(CI `pr-gate.yml` 內的 `vitest run`,repo 內既有研究提到約 610 個測試)驗證無回歸,且 `@vitejs/plugin-react`(peer 於 vitest.config.ts:2)、`jsdom@29`、`@testing-library/*` 等版本相容性需一併檢查。
  - 建議:**排一張獨立卡處理 vitest 2→4 大版升級**(而非隨手 `npm audit fix --force`),因為這是 semver major、有實際回歸風險,但**不是安全急件**——因為目前完全不可達(見上)。可以與弱點一裡「巢狀 vite 5.4.21」的修復合併成同一張卡,一次解決。
  - 在完成大版升級前,**衛生底線**建議:(a) 明確在 team 規範/CI 中禁止安裝 `@vitest/ui` 或使用 `vitest --ui`(尤其在任何可能對外的雲端沙箱環境中),(b) 若未來確有除錯需求要用 UI 模式,只能綁定 `127.0.0.1` 且不得對外 port-forward。

---

## 總結判定表

| 套件 | CVE | 直接/transitive | 脆弱程式碼是否被呼叫 | 攻擊輸入來源 | prod/dev | 可達性判定 |
|---|---|---|---|---|---|---|
| vite | GHSA-4w7w-66w2-5vf9(path traversal `.map`,受影響 `<=6.4.1`) | 直接 devDependency(頂層 7.3.2);另有 vitest 內建巢狀 vite@5.4.21(transitive,在受影響範圍內) | 頂層 dev server 僅 `NODE_ENV==="development"` 啟動(`server/_core/index.ts:1012`),且版本 7.3.2 已高於受影響範圍;巢狀 5.4.21 無對外 HTTP 端點 | 需攻擊者對執行中 dev server 發請求;prod 無此 server,dev 版本已不受影響 | dev-only(build 時用,prod runtime 不含) | **not-reachable**(頂層版本已修復;巢狀版本無可攻擊端點) |
| vitest | GHSA-5xrq-8626-4rwp(UI server 任意檔案讀取/執行,critical,受影響 `<3.2.6`) | 直接 devDependency(2.1.9,在受影響範圍) | `@vitest/ui` 未安裝(僅 optional peerDependency 宣告);repo 內從無 `--ui` 用法;CI 只跑 `vitest run` | 需攻擊者對監聽中的 UI server 發請求;該 server 目前無法被啟動 | dev/test-only;CI 不開 UI server | **not-reachable**(現狀;若未來安裝 `@vitest/ui` 並用 `--ui`,降為 `reachable-limited`,視網路暴露而定) |

**結論**:两顆都確認為 **devDependencies**,**prod build/runtime 完全不含**(`npm start` 強制 `NODE_ENV=production` 走 `serveStatic`,無 Vite 執行期;CI 只用 `vitest run`,無 UI server)。開發者本機/CI 風險現況為 **not-reachable**(非僅「降級」,而是查證後兩者的實際觸發前提在本 repo 都不成立)。仍建議升版作為**依賴衛生**與**未來防呆**措施:
1. vitest 2→4 大版升級(連帶清掉 vite-node 內建的舊版 vite),需獨立排卡驗證測試回歸,非安全急件。
2. 團隊規範明確禁止在共享/對外可達的開發沙箱(`vite.config.ts:323-330` 列出的 `.manus*.computer` 類預覽網域)安裝或啟用 `@vitest/ui` / `vitest --ui`,避免未來版本或設定變更後才產生真實可達面。
3. 頂層 `vite` 已因版本升級自然規避本次指派的 path-traversal CVE,可視情況另行处理 npm audit 標出的另兩顆 7.x 公告(NTLMv2 hash 洩漏、`server.fs.deny` 繞過),但那不在本任務範圍內,僅附註留意。
