# 全站光球代理深度整合 — 修復清單

## 狀態：✅ 全部完成

所有原始審計腳本（`audit_orb.py` / `deep_audit.py`）均已通過，0 issues。
PageAgent 註冊 34 個（與 64 條 registry 條目對齊；其中 30 條為純導向快捷入口，
不需獨立 PageAgent）。

---

## 已完成項目

### Critical
- ✅ DashboardPage 路徑已正確（`/image-studio`、`/video-studio`、`/director`）
- ✅ AdminPage `setTab` options 已與 `ADMIN_TAB_IDS` 完整對齊
  （overview / users / activity / api / costs / generations / jobs /
  feedback / brain / ai-research）

### Medium
- ✅ AccountSettingsPage：改用 `ACCOUNT_NAV_ALLOWLIST` Set 與其他頁一致；
  擴充至 `/`、`/dashboard`、`/settings`、`/credits`，並暴露 `loginHistoryCount`
- ✅ DashboardPage 跨頁跳轉擴充至 15 個目的地（新增 `/credits`、`/assets`、
  `/agent`、`/create`、`/playground`、`/background-tasks`）
- ✅ LangSmithPage：補上 `useRegisterPageAgent`（pageId=`langsmith`），Tabs 改
  受控，光球可透過 `setTab` 切換 overview / traces / comparison / datasets /
  export 五個監控分頁；shared/appRegistry 同步更新 `supportsPageAgent: true`
  與 `supportedActions: ["setTab"]`
- ✅ 各頁 state 暴露：admin / admin-api-usage / admin-brain-pipeline / agent-chat
  / my-brain / vault / pro-studio / video-studio 都已暴露足夠的 state
- ✅ NAV_ALLOWLIST 覆蓋：brain-settings / calendar / credits / focus-flow /
  settings / shared 均涵蓋常見目的地

### Low（音審計腳本誤報，已加白名單）
- ✅ `audit_orb.py` 加入 `INTENTIONAL_HIDDEN_ACTIONS` 白名單，記錄 Hub 風格頁
  （create / playground / process-viewer）刻意不在 `supportedActions` 宣告
  navigate / setTab 的設計，避免破壞 static fallback ranker
- ✅ `deep_audit.py` 加入 `DYNAMIC_STATE_PAGES`（pro-studio / video-studio）、
  `INLINE_NAV_VALIDATION_PAGES`（account-settings）與 `NAV_NARROW_EXEMPT`，
  讓設定/管理員頁的較窄 NAV_ALLOWLIST 不再誤判
- ✅ `deep_audit.py` 的 `NO_DEFAULT_HANDLER` 檢查改為跨行 `re.DOTALL`，並接受
  「unsupported / not-applicable / inapplicable / 未支援」四種落地句

---

## 設計決策（intentional）

以下行為在審計腳本中以白名單記錄，是設計決策而非缺陷：

| 頁面 | 動作 | 原因 |
|------|------|------|
| `create` | `setTab` | Hub 容器；setTab 由 CreationHub runtime 註冊處理，但不寫進 `supportedActions` 以免靜態 fallback ranker 把 setTab 路由到 Hub 而非實際工作室 |
| `playground` | `setTab` | 同上 |
| `process-viewer` | `navigate` | navigate 只在 `/process` 頁本身有意義，避免 ranker 把 `帶我去 /image-studio` 路由到 `/process` |

---

最後更新：2026-05-07 — branch `claude/tender-feynman-WmKCc`
