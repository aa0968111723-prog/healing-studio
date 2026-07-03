# healing-studio 全站大盤點 — 進度追蹤(PROGRESS)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(branch `claude/healing-studio-audit-m2v1o4`)
- 規則:每完成一個階段/子代理立即更新本檔。中斷後從未完成處接續,不重做已完成部分。
- 狀態圖例:☐ 未開始 / ◐ 進行中 / ☑ 完成

## 階段清單

| 階段 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| Phase 0:建立地圖 | `00-overview.md` | ☑ 完成 | 技術棧(React19+wouter+tRPC+雙DB)、4-shell 路由全表、60+ tRPC 命名空間、102 MySQL 表、30+ cron、詞彙表(修正:非 Nixpacks 而是 Dockerfile;gamification 不存在;光球/精靈/4-shell 為核心詞彙) |
| Phase 1-1:功能全貌 | `01-features.md` | ☑ 完成 | 逐頁功能表+現況判定(完整/半成品/停用+證據);重大修正:無 Veo 3.1/Suno V5、DirectorAI 頁被 Cockpit 旗標接管、/assets section 聚合死碼、social 發佈 mock、LearnHub 影片/測驗 ephemeral;§7 全站非完整項目彙總 |
| Phase 1-2:全端接線 | `02-fullstack.md` | ☑ 完成 | 生成統一管線(扣點→fal/Gemini→doPostGenComplete 三表→R2 歸檔)、逐頁接線表、RAG 全鏈(Pinecone gemini-embedding-001)、光球接線(FSM in-memory)、SSE/WS 總表、featureFlags 全表、cron→表對應 |
| 子代理 A:成本 × 外部整合 | `A-cost-integrations.md` | ☑ 完成 | 依賴地圖+cron 常駐消耗+四情境成本結構(全屬架構推估);關鍵:大腦 4 slot 預設 Opus 檔=最大 LLM 成本槓桿、LLM_CACHE 覆蓋僅 2 處、cron 產出進記憶體=外呼白燒、R2 只進不出、導演批次=單擊放大器且 budget guard 預設 OFF、Suno 第三方 proxy 供應鏈風險 |
| 子代理 B:基礎設施 × DB × 安全 × 測試 | `B-infra.md` | ☑ 完成 | env 盤點(風險分級)、雙 DB 分工與 Supabase 23 migrations 實掃、安全防護層總盤、測試/CI/部署、可觀測性、技術債 15 項+近中長期優化路徑 |
| 子代理 C:UIUX 優缺點 | `C-uiux.md` | ☐ 未開始 | |
| 子代理 D:實用性 × 業界對照 | `D-adoption.md` | ☐ 未開始 | |
| 子代理 E:AI 代理架構 | `E-ai-agents.md` | ☑ 完成 | 光球後端管線(ai.ts 3366 行實讀)、精靈/具名代理/多代理協作、CO-STAR 實作、planner+eval、llmRouter 多供應商抽象、RAG「雙引擎」查證、MCP 現況、安全邊界與優化建議 |
| 子代理 F:任務卡 × PR × 程式碼三方對照 | `F-tasks-prs.md` | ☐ 未開始 | |
| Phase 3:彙整 | `00-summary.md` | ☐ 未開始 | |

## 執行備註
- **2026-07-03 Bruce 指示:不用逐階段等確認,連續執行到全案完成**(僅每階段更新本檔+commit push 留檔)。
- Phase 2 順序:A → B → E → F →(C、D)。
- Railway 部署問題本次不處理;實際用量數字集中列「待補清單」。
