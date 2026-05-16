# Healing Studio 文件導覽

本資料夾收錄專案的架構、整合、稽核、計畫、筆記與操作指南。檔案曾散落
於根目錄,經整理後依用途分類於下方子資料夾,根目錄僅保留
`README.md`、`AGENTS.md`、`todo.md` 三份常駐文件。

## 目錄結構

```
docs/
├── README.md                ← 本檔(分類導覽)
├── *.md                     ← 架構與系統級權威文件(扁平,共存)
├── agent/                   ← 光球代理系統設計與實作
├── audits/                  ← 稽核 / 健檢報告
├── reports/                 ← 測試 / 連線 / 健康報告
├── plans/                   ← 修復計畫、優化計畫、未完項目
├── notes/                   ← 巡檢筆記、UI 走查、截圖發現
└── guides/                  ← 部署 / OAuth / 密碼救援 / 整合操作手冊
```

## 入門(從哪份開始讀)

- 想了解整站架構 → `ASSISTANT_ARCHITECTURE.md`、`AI_BRAIN_OVERVIEW.md`、
  `BACKEND_PIPELINE.md`、`SITE_MAP.md`
- 想了解光球代理(Global Orb)→ `GLOBAL_ORB_CHAT_INTEGRATION.md`、
  `global-orb-coverage-matrix.md`、`agent/COMPLETE_ORB_SYSTEM_PLAN.md`
- 想了解 AI 大腦組態 → `BRAIN_CONFIGURATION.md`、
  `unified-model-registry-guide.md`
- 想部署 / 排障 → `guides/DEPLOY_ENV_RAILWAY.md`、
  `guides/GOOGLE_OAUTH_TROUBLESHOOTING.md`、
  `guides/PASSWORD_RECOVERY_GUIDE.md`

## audits/ — 稽核報告

| 檔案 | 內容 |
|---|---|
| `audit-findings.md` | 初版整站稽核發現 |
| `audit-phase3a.md` / `audit-phase3b.md` | Phase 3 分階稽核 |
| `brain-config-gap-audit-2026-04-20.md` | AI 大腦組態落差稽核(SSOT、KPI) |
| `brain-route-scan-2026-04-21.md` | 大腦路由全掃 |
| `browser-audit-findings.md` | 瀏覽器面稽核發現 |
| `healing_studio_deep_audit_report.md` | 全站深度稽核總報告 |
| `Healing_Studio_深度檢修總結.md` | 深度檢修總結(中文版) |
| `pdf-audit-notes.md` | PDF 流程稽核筆記 |
| `phase8-browser-audit.md` | Phase 8 瀏覽器稽核 |

## reports/ — 測試 / 連線報告

| 檔案 | 內容 |
|---|---|
| `API_PIPELINE_TEST_REPORT_2026-04-30.md` | 創作工作室四模態 API 管道線上測試報告 |
| `orb_connection_report.md` | 光球代理連線狀態報告 |

## plans/ — 計畫與待辦

| 檔案 | 內容 |
|---|---|
| `deep_fix_plan.md` | 深度修復計畫 |
| `orb_optimization_plan.md` | 光球代理優化計畫 |
| `FUTURE_ENHANCEMENTS_SUMMARY.md` | 未來增強功能彙整 |
| `MANUAL_FIX_CHECKLIST_2026-04-30.md` | 人工修復檢查清單 |

## notes/ — 巡檢與走查筆記

| 檔案 | 內容 |
|---|---|
| `homepage-pdf-notes.md` | 首頁 / PDF 巡檢筆記 |
| `ui-walkthrough-notes.md` | UI 走查筆記 |
| `notes-soul-invitation.md` | 「靈魂邀請」流程筆記 |
| `notes-ambient-check.txt` | Ambient 區段檢查 |
| `notes-bento-check.txt` | Bento 區段檢查 |
| `notes-scrollytelling-check.txt` | Scrollytelling 區段檢查 |
| `notes-sound-check.txt` | 聲音模組檢查 |
| `screenshot-findings.txt` / `*-p10.txt` / `*-p11.txt` | 截圖比對發現 |

## guides/ — 操作手冊

| 檔案 | 內容 |
|---|---|
| `DEPLOY_ENV_RAILWAY.md` | Railway 部署環境變數對照 |
| `GOOGLE_OAUTH_TROUBLESHOOTING.md` | Google OAuth 排障 |
| `PASSWORD_RECOVERY_GUIDE.md` | 密碼救援操作 |
| `INTEGRATION_NOTES.md` | 跨系統整合筆記 |

## agent/ — 光球代理系統(原本就在 docs/)

詳見 `agent/` 內各檔,以 `COMPLETE_ORB_SYSTEM_PLAN.md`、
`ARCHITECTURE_DEEP_DIVE.md` 為主要入口。
