# healing-studio 全站大盤點 — 進度追蹤(PROGRESS)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(branch `claude/healing-studio-audit-m2v1o4`)
- 規則:每完成一個階段/子代理立即更新本檔。中斷後從未完成處接續,不重做已完成部分。
- 狀態圖例:☐ 未開始 / ◐ 進行中 / ☑ 完成

## 階段清單

| 階段 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| Phase 0:建立地圖 | `00-overview.md` | ☑ 完成 | 技術棧(React19+wouter+tRPC+雙DB)、4-shell 路由全表、60+ tRPC 命名空間、102 MySQL 表、30+ cron、詞彙表(修正:非 Nixpacks 而是 Dockerfile;gamification 不存在;光球/精靈/4-shell 為核心詞彙) |
| Phase 1-1:功能全貌 | `01-features.md` | ◐ 進行中 | 5 個子代理平行盤點(video shell / learn / settings+admin / 跨shell脊椎+social / 全域系統) |
| Phase 1-2:全端接線 | `02-fullstack.md` | ◐ 進行中 | 與 1-1 同批子代理收集接線資料 |
| 子代理 A:成本 × 外部整合 | `A-cost-integrations.md` | ☐ 未開始 | |
| 子代理 B:基礎設施 × DB × 安全 × 測試 | `B-infra.md` | ☐ 未開始 | |
| 子代理 C:UIUX 優缺點 | `C-uiux.md` | ☐ 未開始 | |
| 子代理 D:實用性 × 業界對照 | `D-adoption.md` | ☐ 未開始 | |
| 子代理 E:AI 代理架構 | `E-ai-agents.md` | ☐ 未開始 | |
| 子代理 F:任務卡 × PR × 程式碼三方對照 | `F-tasks-prs.md` | ☐ 未開始 | |
| Phase 3:彙整 | `00-summary.md` | ☐ 未開始 | |

## 執行備註
- Phase 2 建議順序:A → B → E → F →(C、D)。每個完成後停下等 Bruce 確認。
- Railway 部署問題本次不處理;實際用量數字集中列「待補清單」。
