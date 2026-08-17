# AIOS 電腦版專案頁優化 brief

## 目標

將 `/projects` 與 `/projects/:id` 從資訊平鋪的骨架頁提升為桌面版創作工作台入口。使用者進入頁面後，應能快速知道目前專案、完成進度、所在階段，以及下一個最值得執行的動作。

## 盤點結論

目前詳情頁把頁首、進度、目前步驟、綁定狀態與下一步依序堆疊，每個區塊視覺權重接近，導致桌面寬度的空間沒有被用來建立「摘要／決策／流程」層級。主 CTA 位於頁面下方，使用者需要先讀完多個區塊才找到下一步。

目前列表頁已具備必要的專案欄位和複製操作，但缺少搜尋、狀態篩選、排序與摘要統計；卡片雖然資訊完整，卻不利於在多個專案間快速比較。

資料層目前由 `ProjectsContext` 統一提供，專案詳情頁可以安全使用 `title`、`type`、`status`、`progress`、`currentStep`、`nextAction`、`createdAt`、`updatedAt` 與三個 binding 欄位。既有路由、data-testid 及 CTA 導向契約必須保留。

## 改版方向

| 區域 | 桌面版處理 | 保留契約 |
| --- | --- | --- |
| 詳情頁首屏 | Hero 顯示返回、專案名稱、類型、狀態、最後更新與主 CTA；主 CTA 置於首屏右側 | 保留 `project-detail-back-home`、type/status/progress test id |
| 專案摘要 | 以進度卡聚合百分比、目前步驟與更新時間，避免三張低資訊密度卡片分散內容 | 保留 `project-detail-current-step` 與文字 test id |
| 創作流程 | 使用三階段流程卡呈現世界觀、分鏡、導演工作室的已完成／進行中／待開始狀態，每一格可進入對應工作區 | 保留三個快速入口 href 與 `data-bound` binding test id |
| 下一步 | 右欄 sticky 高對比卡，展示 `nextAction` 並提供主 CTA；視窗較窄時堆疊到內容上方 | 保留 `project-detail-continue` 及依 binding 狀態計算的 href |
| 專案列表 | 新增統計摘要、搜尋、狀態 filter 與最後更新排序；維持卡片 grid 與每張卡的主 CTA | 保留 `projects-list`、`project-card-*`、`project-progress-*`、`continue-*` |
| 狀態處理 | loading、error、empty、pending 都有清楚訊息與避免誤操作的 disabled 狀態 | 保留既有 guards 測試期待 |

## 視覺與互動原則

延續 AIOS 既有暖米白、黏土橘與玻璃表面 token。以較大的圓角、柔和陰影、低對比邊框建立工作台層次；只對 hover、focus、按鈕按下與卡片進場使用短促 transform/opacity 動效，並尊重 `prefers-reduced-motion`。桌面版使用 `lg` 以上的雙欄詳情布局，窄於 `lg` 時自然堆疊，不造成水平溢位。

## 驗證標準

1. 既有 `projectsPages` 與 guard 測試全部通過。
2. 詳情頁的主 CTA 在首屏可見，並依「世界觀 → 分鏡 → 導演工作室」順序導向正確工作區。
3. 搜尋、filter、排序可以在前端即時作用，沒有改動資料來源或後端契約。
4. 鍵盤可操作搜尋、filter、CTA 與流程入口，並保留可見 focus ring。
5. 變更只集中在專案頁相關 UI 與 brief，不觸碰框架核心或敏感設定檔。
