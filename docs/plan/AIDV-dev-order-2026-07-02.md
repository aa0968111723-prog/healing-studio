# AIDV 任務卡開發順序總表（2026-07-02 看板治理・/aidv-board apply）

> **這份文件在做什麼（白話）**：把 Jira 專案 AIDV 全部 967 張卡（839 張已完成、128 張未完成）
> 依 `AIDV-dev-workflow.md` §4.1 分級表排成「七個梯次」的開發順序。
> Jira 為準（本檔為鏡像）；hub 留言見 AIDV-102（2026-07-02）。
> 排序原則：**生產 P0/資安最先 → 進行中收尾 → 就緒 lane → High 下一棒 → 一般 Backlog → 等拍板/金鑰 → 遠期**。

## 本次異動摘要

- 升 **Highest** ×2：AIDV-871、AIDV-873（生產 P0）
- 升 **High** ×6：AIDV-35／576／650／881／945／963（進行中卡對齊「進行中=High」）
- 降 **Low** ×27：掛 `待議`/`decision`/`needs-key`/`needs-bruce` 的 Backlog 卡（詳梯次 5）
- 降 **Lowest** ×1：AIDV-133（strangler 刪除類）
- 就緒 lane +3：AIDV-8／103／899（各補 🗂 工作表留言）
- 依賴連結（Blocks）+9：297→298/299/300、302→303/304/305/306、871→873、511→956
- 完成卡一律不動（鐵律 4）

---

## 梯次 0｜生產 P0／資安（Highest・立刻）

| 順位 | 卡 | 摘要 | 備註 |
|---|---|---|---|
| 0-1 | AIDV-511 | 外部供應商 API 金鑰全面斷線（10+ 家 fetch failed）——零生成能量 | Bruce：Railway 檢查/重設供應商金鑰 |
| 0-2 | AIDV-871 | prod ANTHROPIC_API_KEY 401（已降級走備援） | Bruce：Railway 換有效金鑰；blocks AIDV-873 |
| 0-3 | AIDV-873 | /video 漏斗 dead 126h+：等 redeploy＋金鑰輪換 | 855/830 修復已合併，缺部署確認 |
| 0-4 | AIDV-807 | 連鎖解卡協議（733 已解，剩 511 鏈） | 與 0-1 同組 |
| 0-5 | AIDV-808 | 安全攻擊面壓縮 sprint（341 RLS＋767 leaked-pwd＋789 IDOR） | 進行中 |
| 0-6 | AIDV-341 | realtime.subscription 表缺失：RLS 頻道授權未執行 | 進行中；C8 資安 |

## 梯次 1｜進行中收尾（High）——先做完手上的

| 卡 | 摘要 |
|---|---|
| AIDV-350 | Auth 雙重連鎖重啟（C9） |
| AIDV-386 | auth OAuth/WebAuthn 5 表 RLS 未啟用（C15） |
| AIDV-388 | realtime.schema_migrations RLS 未啟用（C15） |
| AIDV-477 | prod/CI 關閉 CLAUDE_CODE_DEBUG=true |
| AIDV-952 | deploy-currency 驗證（build-version endpoint/footer） |
| AIDV-710 | Autodev 人工升級 SOP |
| AIDV-589 | OPT-3 任務 checkpoint schema＋per-segment SSE |
| AIDV-270 | /video 多模態輸入支援 |
| AIDV-650 | 任務失敗後退款確認（⬆High） |
| AIDV-945 | /learn 版面左緣被側欄裁切（⬆High） |
| AIDV-35 | 瀏覽器模擬創作者實測 E2E persona（⬆High） |
| AIDV-963 | providerHealthProbeJob 補 SSRF guard（⬆High） |
| AIDV-576 | videoProject.list 排序回歸（⬆High；進行中但屬待議，拍板後收尾） |
| AIDV-881 | feedback.screenshotKey ownership 驗證（同上） |
| AIDV-89 | 📥 AIDISC 討論區 hub（容器卡，持續運作） |
| AIDV-13 | 任務耐久化 BullMQ+Redis（進行中但 ⬇Low：卡 Redis 金鑰） |

## 梯次 2｜就緒 lane（Selected for Development）

| 卡 | 摘要 | 工作表 |
|---|---|---|
| AIDV-694 | Autodev pipeline bruce-gate（原有） | 卡上既有 |
| AIDV-8 | junction backfill 真 DB 實跑 | ✅ 2026-07-02 補 |
| AIDV-103 | ui-ux-pro-max 設計智庫接入收尾 | ✅ 2026-07-02 補 |
| AIDV-899 | 四 Studio 頁生成邏輯去重複（useGenerationTask） | ✅ 2026-07-02 補 |

## 梯次 3｜High Backlog 下一棒

AIDV-805（TTS 離線 4 循環・needs-bruce CRITICAL）、AIDV-809（TTS recovery＋queue-age triage）、
AIDV-866（/video funnel R54，873 的前導卡）、AIDV-767（安全自動修復 R47）、
AIDV-696（RLS Day-9 升級・Supabase support ticket）、AIDV-780／AIDV-815（兩張 needs-bruce 安全批次，待 Bruce 過目分批放行）、
AIDV-88（Confluence MCP 連線・Bruce 動手）、AIDV-349（Agent 能力協商協議——blocker AIDV-378 已完成，已解鎖）、
AIDV-466（/video multi-agent gap R38）、AIDV-494（/video 真實創作者工作流未實測 R41）、
AIDV-125（Wave S：AI Skill 工作層 Epic）

## 梯次 4｜Medium Backlog（一般排隊）

**QA／賦能／營運**：AIDV-254（旁白語音客製）、AIDV-256（批次生成）、AIDV-400／401（C16 RLS 二張）、
AIDV-403（H16 驗收異常）、AIDV-448（leaked password protection）、AIDV-452（cron heartbeat TTL）、
AIDV-464（unused indexes）、AIDV-478／479／480（環境/工具三張）、AIDV-504（SLO 樣本數）、
AIDV-539／540（R46 兩張）、AIDV-786（Realtime schema 調查）、AIDV-861（creator 回饋 digest hub）、
AIDV-949（部署確認 SEO）、AIDV-956（Suno V4 接線——被 AIDV-511 blocks，金鑰恢復後做）、
AIDV-964（PORT 風暴殘留清理）、AIDV-965／966／967（賦能三張：分角色新手路徑／人格教材補完／回訪引導）

**Wave 地基卡（依賴鏈已建 Blocks）**：
- Wave G：AIDV-285（G-1 儲存）、AIDV-286（G-2 成本定盤）
- Wave T：AIDV-297（T-1 組別模型）→ AIDV-298（T-2 Admin Console）／AIDV-299（T-3 SOP）／AIDV-300（T-4 配額）
- Wave D：AIDV-302（D-1 資料模型 SSOT）→ AIDV-303／304／305／306（D-2～D-5）

**Epic 容器（隨子卡動，不單獨排工）**：AIDV-31／32／33／34（Wave 1–4）、AIDV-55（Wave H）、
AIDV-70（M7 staging）、AIDV-74（Wave U）、AIDV-77（Railway MCP）、AIDV-78（Wave I・待議）、
AIDV-122（資料治理）、AIDV-141（U-SOP Figma）、AIDV-148（U-12 Phase 2・掛 decision）、
AIDV-284（Wave G）、AIDV-296（Wave T）、AIDV-301（Wave D）

## 梯次 5｜Low（等金鑰／拍板才動；27 張本次降級＋原有 Low）

| 分組 | 卡 |
|---|---|
| 缺金鑰 needs-key | AIDV-13（Redis）、AIDV-16（FAL_KEY）、AIDV-19（Supabase） |
| 計費/金流拍板 | AIDV-166（預扣款競態）、AIDV-167（Stripe webhook）、AIDV-194（成本占位） |
| migration/部署拍板 | AIDV-170（重號修）、AIDV-171（pre-deploy migrate）、AIDV-655（background_jobs FK/TTL）、AIDV-898（CI migration+e2e） |
| 後端架構拍板 | AIDV-164（fal 派發收斂）、AIDV-169（生成資料完整性）、AIDV-548／561（stub 盤點）、AIDV-593（brain 推理槽）、AIDV-664（skill_registry router）、AIDV-675（SSE 總線統一）、AIDV-661／662（ADP PR-only） |
| 產品/流程拍板 | AIDV-277（Creator 可見性收斂）、AIDV-288（G-4 MCP 化研究）、AIDV-290（per-client 配額）、AIDV-359（能力聲明協議・needs-design-gate）、AIDV-683（Wave T 啟動決策）、AIDV-750（735 關卡核實）、AIDV-768（733 解卡計畫——733 已完成，此卡可能過時、待收斂）、AIDV-847（mock 建議落地方案）、AIDV-897（旗標預設值） |
| 基建設定（Bruce 權限） | AIDV-958（PR Gate CI 秒失敗）、AIDV-962（remote session 網路政策） |
| 其他既有 Low | AIDV-143（Code Connect 回流）、AIDV-565（LIKE 全表掃描 perf）、AIDV-907（RAG Pinecone 決策） |

## 梯次 6｜Lowest（遠期 Wave 3/4／strangler 收尾）

AIDV-18（M3 段落狀態機）、AIDV-21（Yjs/Hocuspocus）、AIDV-22（XState 收斂）、
AIDV-23／24／25（Wave 4 builder/BYOMCP/orchestrator）、AIDV-53（暗色次模式）、
AIDV-133（刪除舊 UI 路徑・⬇本次補降 Lowest）

---

*維護規則：本檔為單次治理快照；日常以 Jira 看板優先序＋就緒 lane 為準。下次 /aidv-board audit 若發現落差，以新快照覆蓋（不刪本檔，移 Archive）。*

— 智能助手 🤖
