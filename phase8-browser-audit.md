# Phase 8 Browser Audit - Studio Page

## 靈感積木系統 (Visual Blocks)
- 6 大分類全部顯示：主體(8)、風格(8)、氛圍(8)、場景(8)、光線(8)、鏡頭(8) = 48 個積木
- 每個積木有獨立按鈕，顏色編碼區分分類
- 積木面板預設開啟，位於 Prompt 輸入框上方

## 自注意力 UI (Self-Attention)
- 創作描述區域有 textarea + Vibe Cards
- 進階提示詞建構器可展開

## 思維島鏈 (ThoughtIslandChain)
- 位於生成按鈕下方（需要觸發生成才會展開）

## Z-index 確認
- PromptBuilder 在 z-20，ThoughtIslandChain 在 z-10
- 滑桿不會被 D3 畫布蓋住

## 積木點擊測試
- 需要點擊積木測試是否自動填入 Prompt

## 積木點擊測試結果 - 成功
- 點擊「武士」積木後：
  1. 已選組合區顯示「武士 ×」（可取消）
  2. Prompt 自動填入 "a samurai warrior"
  3. 自注意力控制台自動展開，顯示 1 個 Token "a samurai warrior"
  4. ProactiveOrbWidget 右下角浮出氣泡提示
  5. 靈感積木標題更新為「1 個已選」

## 自注意力 UI 驗證
- Token 標籤顯示正確
- 提示文字：「點擊 Token 調整 AI 注意力權重，權重越高，AI 越關注該元素。」
- 編譯後預覽顯示 "a samurai warrior"

## 多積木選擇測試 - 成功
- 點擊「賽博龐克」後：
  1. 已選組合區顯示「武士 × | 賽博龐克 ×」
  2. Prompt 自動組合為 "a samurai warrior, cyberpunk style"
  3. 自注意力控制台更新為 2 個 Token: "a samurai warrior" + "cyberpunk style"
  4. 編譯後預覽同步更新
  5. ProactiveOrbWidget 氣泡更新提示
  6. 靈感積木標題更新為「2 個已選」
- 流水線完美運作：積木 → 自動填寫 → Token 解析 → 自注意力控制

## 下一步：測試 Token 權重滑桿

## 自注意力權重滑桿測試 - 成功
- 點擊 "a samurai warrior" Token 後：
  1. 浮出權重滑桿面板（深色毛玻璃背景）
  2. 顯示「注意力權重」標題 + 當前值 1.00
  3. 滑桿範圍 0.5 到 2.0
  4. 左側標示「淡化 0.5」右側標示「強調 2.0」
  5. 編譯後預覽同步更新
- 完整流水線驗證通過：積木 → 自動填寫 → Token 解析 → 點擊 Token → 權重滑桿

## 生成 + 思維島鏈測試 - 成功
- 點擊「開始創作」後：
  1. ZenProgressOverlay 顯示「渲染場景構圖...50%」→「最終品質檢查...90%」
  2. 光球呼吸動效持續
  3. ThoughtIslandChain 展開，顯示 3 個節點：安全檢查、提示詞編譯、AI 生成
  4. 三級縮放按鈕可見：總覽、細節、JSON
  5. ProactiveOrbWidget 持續顯示提示氣泡
  
## 時間戳問題發現
- ThoughtIslandChain 節點顯示的時間戳為原始 ms（1773762824205ms）而非格式化時間
- 需要修正 ThoughtIslandChain 的時間戳顯示格式

## 生成完成 + 思維島鏈完整展示 - 成功
- 生成完成後：
  1. ThoughtIslandChain 顯示 5/6 完成，6 個節點：安全檢查、提示詞編譯、視覺權重計算、圖像生成、配額扣除、歷史紀錄
  2. 三級縮放按鈕可見：總覽、細節、JSON
  3. 節點之間有連線和狀態圖標
  4. 生成結果區顯示完整詳情：模態、模式、Temperature、Seed、LoRA 權重
  5. 下載 PNG 和匯出 ZIP 包按鈕可見
  6. 編譯後提示詞顯示正確

## 需修正：時間戳格式
- 節點顯示原始毫秒時間戳（1773762812111ms）而非相對耗時
- 應改為顯示「耗時 Xms」或「X.Xs」格式
