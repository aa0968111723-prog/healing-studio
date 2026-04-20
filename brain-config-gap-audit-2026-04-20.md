# 大腦組態缺漏與優化掃描（2026-04-20）

## 掃描範圍
- `server/routers/brain.ts`（大腦組態 API、catalog、upsert）
- `server/middleware/brainContext.ts`（預設值、健康檢查、fallback 鏈）
- `server/ai-brain-settings.test.ts`（現有測試覆蓋）
- `server/services/falDispatcher.ts`（Fal 任務 fallback 與超時策略）

---

## 主要缺漏（按優先級）

### P0：型號命名缺乏單一真實來源（SSOT），存在漂移風險
**觀察**
- 前台/路由 catalog 使用 `fal/...` 風格，例如 `fal/flux-pro-1.1`。  
- middleware 預設與 fallback 使用 `fal-ai/...` 風格，例如 `fal-ai/flux-pro/v1.1`。  
- Dispatcher 也以 `fal-ai/...` 為主。  

**風險**
- 需靠轉換邏輯維持一致，一旦漏轉會出現「UI 可選、執行時不可用」或 fallback 失效。

**優化建議**
1. 建立單一 `canonical model id` 註冊表（建議放 `shared/`）。
2. UI 顯示、DB 儲存、dispatcher 呼叫全部使用 canonical id。
3. 舊 id 僅在邊界層做一次 alias 正規化。

---

### P0：`upsert` 對 model/engine 值僅做 `string` 驗證，缺乏白名單約束
**觀察**
- `upsert` 中 `directorModel`、`imageEngine`、`falTextToImageEngine` 等欄位都是 `z.string().optional()`。

**風險**
- 任意字串可寫入 DB，造成執行期 fallback/計費/追蹤不一致，或觸發 404/422。

**優化建議**
1. 由 catalog 自動生成 `z.enum([...])` 或 `z.union` 驗證。
2. 對 16 類 Fal task 欄位同步套用 enum 驗證。
3. 在 mutation 回傳中標註「是否觸發 alias 正規化」。

---

### P1：健康檢查採樂觀回傳，首請求對異常模型可視為健康
**觀察**
- `getHealthStatus` 在無快取時會先回 `true`，探測在背景執行。

**風險**
- 首次切換到失效模型時，第一批請求仍可能直接打到壞模型。

**優化建議**
1. 新模型首次被選用時，提供「快速同步探測（短 timeout）」選項。
2. 針對高成本模型（影音）加入 `preflight` 機制。
3. 在 UI 顯示「未驗證 / 已驗證」狀態，而非單純 Online。

---

### P1：Fallback 鏈分散在 middleware 與 dispatcher，策略可能分叉
**觀察**
- `ENGINE_FALLBACK_CHAIN`（brainContext）與 `FALLBACK_CHAINS`（falDispatcher）各自維護。

**風險**
- 同一模型在不同路徑可能走不同降級路線，增加除錯成本。

**優化建議**
1. 將 fallback policy 抽為共用模組。
2. 增加一致性測試：同一 category 的第一、二備援在兩層需一致（或明確標記例外）。

---

### P2：測試案例語義偏舊，未形成「設定一致性」防線
**觀察**
- 測試仍含多個舊模型預期（如 `gpt-4o`、`suno-v4` 起始值）。
- 目前多數測試在驗「有無字串」與「有幾個選項」，較少驗證 catalog/default/fallback 互相對齊。

**風險**
- 重構後容易出現 silent drift（測試仍過、線上才出錯）。

**優化建議**
1. 新增一致性測試：`catalog ⊇ defaults`、`defaults ∈ fallback chain`。
2. 新增 alias 正規化測試：舊 ID 寫入後要映射到 canonical ID。
3. 針對 `upsert` 加入 invalid enum 的負向測試。

---

## 建議執行順序（兩週內）
1. **第 1 週（防呆）**：完成 enum 白名單 + canonical id 正規化。
2. **第 2 週（可觀測）**：統一 fallback policy + 新增一致性測試。
3. **持續項（體驗）**：UI 健康狀態加上「未驗證」標示與 preflight 提示。

---

## 可量化 KPI
- 無效 model/engine 寫入率：`< 0.1%`
- 首次請求 fallback 觸發率：下降 `30%+`
- model/fallback 相關 incident：月減少 `50%+`
- 設定一致性測試覆蓋：新增至少 `8` 條規則型測試
