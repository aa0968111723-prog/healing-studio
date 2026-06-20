# 交接提示詞模板（步驟 5：🤖 → 💻）

> 目的：把一張 Wave U 卡，從「規劃側想清楚的工作表」變成「建置側 Code 一看就能動手、不用回頭問」的提示詞。
> 鐵則：交接提示詞**不含任何金鑰**（缺金鑰寫「向 Bruce 取，貼 Railway」）；術語附白話；只給一條明確下一步。

## 何時用
步驟 5 把 `/aidv-workflow sheet <KEY>` 填好的工作表，轉成給建置側 agent（你的 Code）的開工指令。一卡一則。

## 模板（複製填實）

```
# 交接 — <AIDV-XX> <標題>

## 北極星對位
<這張卡推進 logline→成片 六步的哪一步；為什麼現在做>

## 範圍（一句話）
<做什麼。例：把 /video 第 3 步 ShotCard 換成 design-kit 元件並接真實 procedure>

## 現況對齊（步驟 2 產出，務必先讀）
- live：<對應頁 URL ＋ 目前長相/問題>
- main：<HEAD、相關既有檔/procedure 路徑>
- 與舊稿差異：<不照舊圖做的點>

## 必須重用（先搜碼，避免重造）
- procedure：<server/routers/...＞具體名>
- 元件：<client/src/...＞具體名（如 _shared/PanelState、AidvShellChrome）>

## 視覺資產（步驟 4 產出）
- <資產類型：hero/icon/插畫/背景＞存放連結＞最終 repo 落點>
- token：一律用 design-kit 語意 token（uiux/AIDV_design-tokens_TokensStudio.json），禁硬編色

## 旗標
- <flag 名>：預設 ON＋退路 env `VITE_<X>=0`／runtime `?<x>=0`

## 檔案（要改/新增）
- <路徑清單>

## 驗收（第三人可驗）
- [ ] <可觀察條件 1>
- [ ] <可觀察條件 2>
- [ ] 四態（載入/空/錯誤/正常）皆有出口
- [ ] 旗標 OFF 時逐像素回到舊行為

## 驗證門（推送前全綠）
npx tsc --noEmit
npm run check:routes
npm run check:navigation
npx vitest run <新測> <鄰測>

## 設計門狀態
<自動通過 ✓（零後端＋可回滾＋預設 ON 含退路）／待 Bruce 拍板（原因）>

## 風險／避雷
- <例：jsdom29+vitest2 的 13 failed＝既有，勿當新回歸>

## 下一步（唯一）
<進階 2 開發 ＝ 在分支 claude/<…> 開工；或 停下等 Bruce 拍板（原因）>
```

## 交接「做完的感覺」（送出前自檢，七訊號全中）
1. 每欄都是實話（無 TODO/待補/空白）。
2. 範圍一句話講得完。
3. 重用是搜過碼的具體名。
4. 驗收第三人能驗（非「做好/正常」）。
5. 設計門一翻兩瞪眼（自動通過 ✓／待拍板寫明原因）。
6. 下一步唯一。
7. 風險開工前就寫。

> 收尾自問：『Code 只看這則、不問我半句，做得出來且會過驗收嗎？』答得出「會」才送。
