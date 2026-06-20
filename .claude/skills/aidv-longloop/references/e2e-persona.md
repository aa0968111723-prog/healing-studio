# E2E / Persona 完成度測試（步驟 8 · 對應 AIDV-35）

> 目的：UI 卡寫完不是「tsc 綠」就算完，要**模擬真實創作者**把這張卡所在的流程走一遍，看會不會卡住。對應 Jira **AIDV-35**（瀏覽器模擬創作者實測）。
> 工具：`playwright.config.ts` 已備；`npm run test:e2e`。persona 走查可用 Playwright 腳本或 Claude in Chrome 實際點。

## 測試門（步驟 8）通過條件
- [ ] **冒煙**：卡所在頁能載入、無 console error、四態（載入/空/錯誤/正常）皆可達。
- [ ] **persona 任務**：用下方 persona 走「這張卡負責的那一步」，能完成不卡關。
- [ ] **旗標雙跑**：旗標 ON＝新行為；`?flag=0`＝舊行為逐像素回退（可秒回滾）。
- [ ] **RWD**：桌機三欄、手機 `<lg` 單欄＋底部頁籤都能走完該步。
- [ ] **回歸**：受影響鄰頁未壞（扣掉 main baseline 既有 13 failed）。

## 北極星 persona（惹瓊巴 30 秒成片）
主場景＝**手機**創作者，要走六步：logline → 世界觀/風格 → 劇本→分鏡 → 生成（圖/影/聲）→ 初剪 → 匯出。
每張 Wave U 卡對應其中一步，persona 測試就驗「這一步在真瀏覽器順不順」。

## Persona 範本（依卡選 1–2 個走）
| Persona | 情境 | 重點驗 |
|---|---|---|
| 新手手機創作者 | 第一次進站、走引導表單→第一支草稿 | onboarding（AIDV-87 Sense）、四態文案、命中區 ≥44pt |
| 回訪桌機創作者 | 已有專案，進 /video 六步座艙改一個鏡 | ShotCard/確認門（AIDV-95）、重用既有 procedure |
| 社群短影音作者 | 走 /social 九步旅程 S1–S9 | 步進器（AIDV-96）、跨庫 PromptVault（AIDV-99） |
| 學習者 | 進 /learn 找模型/研究/貼 API 金鑰 | /learn（AIDV-97）、金鑰只貼不外洩 |

## 失敗處置
任何 persona 卡關／console error／旗標回退不一致 → 進步驟 9 回頭修復 → 重跑本門。連兩輪同因失敗 → `AskUserQuestion` 問 Bruce 縮範圍或拆卡。
