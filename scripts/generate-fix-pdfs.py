#!/usr/bin/env python3
"""Generate one PDF per fix item (36 total) with Claude Code prompts."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted, Table,
    TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
pdfmetrics.registerFont(TTFont("CJK", FONT_PATH, subfontIndex=0))

OUT_DIR = "/home/user/healing-studio/docs/fix-prompts"
os.makedirs(OUT_DIR, exist_ok=True)

# ── styles ────────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
TITLE = ParagraphStyle("title", parent=ss["Title"], fontName="CJK", fontSize=22,
                      leading=28, spaceAfter=8, textColor=colors.HexColor("#1a3a5c"))
SUBTITLE = ParagraphStyle("sub", parent=ss["Normal"], fontName="CJK", fontSize=11,
                         leading=16, textColor=colors.HexColor("#6b7c93"), spaceAfter=14)
H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="CJK", fontSize=14,
                   leading=20, spaceAfter=6, spaceBefore=10,
                   textColor=colors.HexColor("#2d5876"))
BODY = ParagraphStyle("body", parent=ss["BodyText"], fontName="CJK", fontSize=10.5,
                     leading=17, spaceAfter=6, alignment=TA_LEFT)
CALLOUT = ParagraphStyle("call", parent=BODY, fontName="CJK", fontSize=11,
                        leading=18, leftIndent=8, borderPadding=8,
                        backColor=colors.HexColor("#fff4dc"),
                        borderColor=colors.HexColor("#e9c46a"), borderWidth=1,
                        spaceAfter=10)
CODE = ParagraphStyle("code", parent=ss["Code"], fontName="CJK", fontSize=9.5,
                     leading=15, leftIndent=6, backColor=colors.HexColor("#f5f7fa"),
                     borderColor=colors.HexColor("#d0d7de"), borderWidth=0.5,
                     borderPadding=8, spaceAfter=10)
PROMPT_BOX = ParagraphStyle("prompt", parent=BODY, fontName="CJK", fontSize=10,
                           leading=17, leftIndent=10, rightIndent=10,
                           backColor=colors.HexColor("#eef6ff"),
                           borderColor=colors.HexColor("#2d5876"), borderWidth=1,
                           borderPadding=12, spaceAfter=10)

def H(text): return Paragraph(text, H2)
def P(text): return Paragraph(text, BODY)
def Box(text): return Paragraph(text, CALLOUT)
def Prompt(text):
    escaped = (text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\n", "<br/>"))
    return Paragraph(escaped, PROMPT_BOX)
def Code(text): return Preformatted(text, CODE)

# ── 36 個項目資料 ────────────────────────────────────────────────────────────
ITEMS = []

def add(num, kind, title_short, title_long, tech_code, why, current, problem, change,
        files, prompt, verify, eta):
    ITEMS.append(dict(num=num, kind=kind, short=title_short, long=title_long,
                      tech=tech_code, why=why, current=current, problem=problem,
                      change=change, files=files, prompt=prompt, verify=verify, eta=eta))

# ============ 修復類（第 1-12 項）===========================================

add(1, "修復", "媒體入庫", "圖片影片過陣子壞掉", "S-P0-1",
    "AI 生成的圖跟影片放在 FAL / Suno / Gemini 的暫存連結，過幾小時就會失效。",
    "外部生成服務回傳的連結是臨時 CDN，數小時內會過期。",
    "使用者「我的歷史紀錄」會逐漸出現大量斷鏈圖。已有 internalMedia.ts 內 localizeResultUrls() 部分入庫，但同步路徑、Gemini 直回 URL、舊資料 backfill 無覆蓋。",
    "新增背景 worker（cron 每日 03:00）+ 同步點補強，把所有外部 URL 永久複製到自家 R2/GCS，DB 寫永久連結；補追蹤欄位（sourceUrl/provider/archivedAt/expiresAt/checksum）。",
    [
        "server/services/internalMedia.ts（既有 persistExternalMediaUrl / localizeResultUrls）",
        "server/services/postGenActions.ts（doPostGenComplete 結尾 enqueue）",
        "server/services/mediaArchivalService.ts（新增）",
        "server/jobs/mediaArchivalWorker.ts（新增，仿 r2SnapshotJob 寫法）",
        "drizzle/schema.ts（digitalAssetLibrary / generationHistory 加 5 欄）",
        "drizzle/migrations/0058_media_archival_fields.sql（新增）",
    ],
    """請依照計畫附錄 A.1 實作 S-P0-1 媒體入庫保底機制：

1. 在 drizzle/schema.ts 為 digitalAssetLibrary 與 generationHistory 兩張表各加 5 個欄位：sourceUrl（text）、provider（varchar 32）、archivedAt（timestamp）、expiresAt（timestamp）、archivalChecksum（varchar 64）。並建立 index (archivedAt IS NULL, createdAt)。

2. 產生 migration 檔 drizzle/migrations/0058_media_archival_fields.sql。

3. 新增 server/services/mediaArchivalService.ts，匯出 archiveAsset(asset) 與 archiveBackgroundJobMedia(jobId) 兩個函式。重用既有的 internalMedia.ts:persistExternalMediaUrl() 與 isInternalUrl()。idempotency 用 archivedAt 欄位判斷。

4. 新增 server/jobs/mediaArchivalWorker.ts，仿 server/jobs/r2SnapshotJob.ts 的寫法：cron "0 3 * * *"、isRunning lock、每次 processBatch(50)、graceful shutdown。匯出 runMediaArchival() 與 initMediaArchivalCron() / stopMediaArchivalCron()。

5. 修改 server/services/postGenActions.ts 的 doPostGenComplete()，在函式結尾 enqueue 一個保底入庫任務：若 resultUrl 存在且 !isInternalUrl(resultUrl)，呼叫 enqueueMediaArchivalTask({ userId, backgroundJobId, resultUrl, modality }).catch(logger.warn)。

6. 在 server/_core/index.ts（或主啟動檔）初始化 cron：initMediaArchivalCron()，並在 SIGTERM 時 stopMediaArchivalCron()。

7. 寫一條 vitest 整合測試：模擬一筆 generationHistory 含外部 URL、archivedAt IS NULL，跑 runMediaArchival() 後該筆應變成自家 URL + archivedAt 有值。

不要做的事：不要動 fal queue / webhook 路徑（既有 localizeResultUrls 不要改）。不要新增 Replicate / Suno 直連。不要建 CDN。""",
    "啟動後手動 trigger runMediaArchival()，SQL：SELECT COUNT(*) FROM digital_asset_library WHERE archivedAt IS NULL AND createdAt < NOW() - INTERVAL 1 DAY 應趨近 0。刻意跑一次 FAL image gen 且關閉 webhook → 24h 內輪詢路徑會被 worker 補上。",
    "1-2 天")

add(2, "修復", "啟用多代理路由", "25 個精靈合作被開關關掉", "A-P0-1",
    "「導導 + 圖圖 + 聲聲 + 品品」一起合作的程式碼都寫好了，但被一個環境變數 ORB_MULTI_AGENT_ENABLED 關掉。",
    "server/routers.ts:413 已有 isMultiAgentRoutingEnabled() 分流，但旗標預設為 0。",
    "使用者下「做支影片配音配旁白」時只用一個精靈做，做不完整。多代理協作完整框架已就緒只差按開關。",
    "把旗標預設改為 on，加成本上限熔斷（避免協作鏈失控）、加 detection 觀測指標、補整合測試。前置依賴：第 3 條（持久化）必須先做。",
    [
        "server/services/multiAgentIntegration.ts:238（isMultiAgentRoutingEnabled 預設改 on）",
        "server/services/multiAgentIntegration.ts:99-140（在 detection 後插入成本熔斷）",
        "server/services/orbCostGuard.ts（新增 calculateMultiAgentEstimatedCost）",
        "Dockerfile / railway.toml / .env.example（環境變數預設值）",
        "server/services/__tests__/multi-agent-integration.test.ts（新增整合測試）",
    ],
    """請依照計畫附錄 A.2 實作 A-P0-1 啟用多代理路由：

⚠️ 前置：必須先確認第 3 條（A-P0-2 collaboration 持久化）已完成，否則重啟會吃掉進行中協作。請先用 grep 確認 AgentCollaborationOrchestrator 是否已從 Map 換成 drizzle repository。若否，請停止本任務並先做第 3 條。

1. 修改 server/services/multiAgentIntegration.ts:238 的 isMultiAgentRoutingEnabled()，把預設改為 true（同時保留 process.env.ORB_MULTI_AGENT_ENABLED 為 "0" 或 "false" 時可關閉的 kill-switch）。

2. 在 multiAgentIntegration.ts 的 detectMultiAgentNeed() 之後、collaboration 啟動之前（line 99-140 附近），插入成本熔斷：
   - 若 detection.shouldCollaborate === true，呼叫 calculateMultiAgentEstimatedCost(detection) 估算點數
   - 用 getUserRemainingPoints(input.userId) 取使用者剩餘點數
   - 若 userPoints < estimatedCost，logger.warn 後 fallback 到 runOrbTaskWithContinuationLoop，回傳 mode: "single-agent" + reason 含「成本熔斷」

3. 在 server/services/orbCostGuard.ts 新增 export function calculateMultiAgentEstimatedCost(detection): number。公式：base = (suggestedAgents.length ?? 1) * 80；hazardBonus = toolNames.filter(/train|video|render|3d/).length * 150；return base + hazardBonus。

4. 加觀測：在路由決策後 metrics.increment("multi_agent.routed", { mode, reason })。

5. 把 ORB_MULTI_AGENT_ENABLED=1 加到 .env.example 與 Dockerfile / railway.toml（若使用）的預設環境變數。

6. 新增 server/services/__tests__/multi-agent-integration.test.ts，至少 3 條測試：
   - 簡單任務（「生一張圖」）應走 single-agent 分支
   - 複雜跨模態任務（「做一支 30 秒產品影片配音樂與旁白」）應走 multi-agent-collaboration 分支
   - 模擬使用者 points=5，應觸發熔斷 fallback 到 single-agent，reason 含「成本熔斷」

不要做的事：不要改 detectMultiAgentNeed() 內部邏輯。不要重寫 AgentCollaborationOrchestrator。不要新增新精靈。""",
    "ORB_MULTI_AGENT_ENABLED=1 npm run dev，丟一條複雜 prompt → logger 看到 multi-agent-collaboration 分支。設環境變數=0 → 走 single-agent。模擬使用者 points=5 → 看到熔斷 log。",
    "1 天")

add(3, "修復", "協作持久化", "精靈合作進度重啟消失", "A-P0-2 / D-P0-1",
    "精靈合作中間狀態記在記憶體裡的 Map，伺服器一重啟全部丟失。",
    "AgentCollaborationOrchestrator 內 activeSessions: Map<string, CollaborationSession>，TTL 1 小時 setTimeout 自動刪。",
    "進行中的協作會 lost，跨容器無法 resume。資料庫裡 5 張表（agentCollaborationSessions/Steps/Messages/Handoffs + agentPerformanceMetrics）早就建好等著但沒接線。",
    "新增 AgentCollaborationRepository（drizzle），改 orchestrator 從 Map 切到 read-through cache 模式。activeSessions 留作熱資料、底層永遠寫 DB。",
    [
        "server/repositories/mysql/AgentCollaborationRepository.mysql.ts（新增）",
        "server/services/agentCollaborationOrchestrator.ts（startCollaboration / executeHandoff / completeCollaboration 改寫）",
        "server/services/agentCommunicationBus.ts:publish()（非阻塞寫 DB）",
        "drizzle/schema.ts（5 張表已存在無需改）",
    ],
    """請依照計畫附錄 A.3 實作 A-P0-2 / D-P0-1 collaboration 持久化：

1. 新增 server/repositories/mysql/AgentCollaborationRepository.mysql.ts，仿 server/repositories/mysql/UserAuthRepository.mysql.ts 的寫法。匯出 IAgentCollaborationRepository interface 含 11 個方法：
   - createSession / getSession / getUserSessions / updateSessionStatus / updateSessionAgent / finalizeSession
   - recordHandoff / getHandoffHistory
   - createStep / updateStepStatus / getStepsByCollaboration
   - logMessage / getMessagesByCorrelation
   - recordMetric

2. 修改 server/services/agentCollaborationOrchestrator.ts：
   - 保留 activeSessions: Map 作為熱資料 cache
   - 新增 private getSessionCached(id) 方法：先查 Map，miss 時呼叫 repo.getSession(id)，命中後填回 Map
   - startCollaboration() 內 session 建立後立刻呼叫 repo.createSession()
   - executeHandoff() 內呼叫 repo.recordHandoff()
   - completeCollaboration() / cancelCollaboration() 後呼叫 repo.finalizeSession() 並 activeSessions.delete(id)
   - 既有 1 小時 TTL setTimeout 保留作熱資料失效

3. 修改 server/services/agentCommunicationBus.ts 的 publish() 函式：
   - 既有的 in-memory pub/sub 保留
   - 在 publish() 結尾非阻塞地呼叫 repo.logMessage(toInsertMessage(msg)).catch(noop)（用 queueMicrotask）

4. 寫 vitest 測試確認：建立 session → 模擬伺服器重啟（清空 activeSessions Map）→ 再次 getSession() 應從 DB 還原。

不要做的事：不要新增新表（5 張表已存在）。不要改 schema。不要動 agentCommunicationBus 既有的 in-memory bus 行為（只是非阻塞加 DB log）。不要把 activeSessions 完全去除（保留作快取效能）。""",
    "啟動 → 啟動一個多代理協作 → kill -9 並重啟伺服器 → 用 SQL 看 agent_collaboration_sessions 表該 session 存在 → 用 API getSession() 能還原資料。",
    "1-2 天")

add(4, "修復", "DAG 並行啟用", "可同時做的事被排隊", "A-P0-3",
    "「同時做多件事」的拓樸排序程式碼已寫好（Kahn 演算法），但主流程沒呼叫它。",
    "shared/orb-dag-scheduler.ts 已有 topologicalBatches() 與 runBatchesWithConcurrency()，但 orbTaskChainRunner 仍用 for-loop 順序執行。",
    "明明可平行（音樂、旁白、封面同時生）卻一條一條跑，跨模態工作流時程多花 40%。",
    "把 orbTaskChainRunner 主迴圈改成呼叫 scheduler 拿批次列表，每批跑 Promise.allSettled（同 path 已由 scheduler 自動序列化）。",
    [
        "server/services/orbTaskChainRunner.ts（主 step loop 改寫）",
        "server/services/orbTaskOrchestrator.ts（傳入 scheduler 配置）",
        "server/services/agentCollaborationOrchestrator.ts:startCollaboration（session 建立後排程）",
        "shared/orb-dag-scheduler.ts（既有，不改）",
    ],
    """請依照計畫附錄 A.4 實作 A-P0-3 DAG 並行真正啟用：

⚠️ 前置建議：A-P1-4 補償鏈（白話版第 17 條）尚未做時，並行模式失敗時無法乾淨退場。本任務可先做，但測試時要驗證失敗 fallback 安全。

1. 修改 server/services/orbTaskChainRunner.ts，把目前 for (const step of task.steps) 的順序迴圈改成：

```typescript
import { topologicalBatches, runBatchesWithConcurrency } from "../../shared/orb-dag-scheduler";

const dagSteps = task.steps.map((step, idx) => ({
  ...step,
  id: step.id ?? `step_${idx}`,
  path: step.pagePath,
  dependsOn: planData?.dependencies?.[step.id] ?? [],
}));

const schedule = topologicalBatches(dagSteps);
if (schedule.cycle) {
  logger.error("step_cycle_detected", { taskId, cycle: schedule.cycle });
  return executeSequentiallyFallback(task, ...);  // 既有迴圈作 fallback
}

const concurrencyCap = Math.min(3, Math.max(1, Number(process.env.ORB_BATCH_CONCURRENCY ?? 3)));

const batchResult = await runBatchesWithConcurrency({
  batches: schedule.batches,
  concurrency: concurrencyCap,
  runStep: (step) => executeCurrentStepTools({
    task: { ...task, currentStepIndex: task.steps.findIndex((s) => s.id === step.id) },
    ...input,
    perStepToolResults: cumulativeResults,
  }),
});

if (batchResult.failed) {
  return { outcome: "failed", reason: "batch_step_failed", stepsRun: batchResult.results.length };
}
```

2. 把既有的順序 for-loop 包裝成 executeSequentiallyFallback() 作為 cycle 偵測時的 fallback。

3. 修改 server/services/agentCollaborationOrchestrator.ts:startCollaboration()：session 建立後呼叫 topologicalBatches() 把結果存進 session.sharedContext.scheduledBatches，並把 implicitChainEdges 寫入 audit log：appendOrbAgentTaskAuditEvent(taskId, "scheduling.same_page_sequencing", `${e.from} → ${e.to}`)。

4. 補 vitest 測試 server/services/__tests__/orb-task-chain-runner-parallel.test.ts：
   - 4 步驟 plan（2 同 path、2 獨立）應產出至少 2 批，同 path 不同批
   - 5 步驟並行（cap=3）應觀察 inFlight 永不超過 3
   - 觸發 cycle 應 fallback 到 sequential，不爆炸

不要做的事：不要重寫 shared/orb-dag-scheduler.ts（既有實作正確）。不要刪除 sequential fallback 路徑。不要把 concurrency 預設值改大於 3（保護外部 API 配額）。""",
    "跑 4 步驟 plan（2 條同 path、2 條獨立）→ logger 看到 >=2 批；同 path 必在不同批。並行 5 步驟（cap=3）→ inFlight 永不超過 3。手動構造 cycle → 走 sequential fallback。",
    "0.5-1 天")

add(5, "修復+新增", "語音對話 MVP", "語音對話按了沒反應", "VA-P0-1~4",
    "麥克風按鈕、後台 WebSocket 通道、25 位精靈中的「聲聲」12 個工具都已存在，但完全沒接起來。",
    "前端 useOrbVoice.ts 是 WebSocket UI 骨架，無 getUserMedia / MediaRecorder。後端 orbVoiceGateway 收到音訊只回 '(stub) 收到語音資料'。STT/TTS 是 batch 模式未 streaming。",
    "按麥克風純粹是裝飾，使用者無法真的用語音創作。",
    "四件事接通：(1) 前端 MediaRecorder + Push-to-talk，(2) 後端 Gateway 接通 batch Whisper，(3) ElevenLabs streaming TTS，(4) voice-only MVP demo 工作流（說 → STT → multi-agent router → 結果 → TTS 朗讀）。",
    [
        "client/src/hooks/useVoicePermissions.ts（新增）",
        "client/src/hooks/useVoiceRecorder.ts（新增）",
        "client/src/hooks/useOrbVoice.ts（既有改）",
        "client/src/hooks/useAudioPlayback.ts（新增）",
        "client/src/components/orb/OrbVoiceButton.tsx（既有改）",
        "client/src/pages/VoiceAgentPage.tsx（新增）",
        "shared/voice-protocol.ts（新增訊息協定 v2）",
        "server/ws/orbVoiceGateway.ts（改寫 stub 為真實處理）",
        "server/voice/voiceAgentSession.ts（新增）",
        "server/voice/voiceStreamingTts.ts（新增）",
        "server/voice/voiceAgentOrchestrator.ts（新增）",
    ],
    """請依照計畫附錄 E.1 ~ E.5 實作 VA-P0 語音對話 MVP：

⚠️ 前置：建議先完成第 2、3 條（多代理路由與持久化），因為語音任務會走 runOrbTaskWithOptionalMultiAgent。

【第 1 部分：訊息協定 v2】
1. 新增 shared/voice-protocol.ts，匯出 VoiceClientMessage / VoiceServerMessage union types。11 種 server message：ready、user-transcript-partial、user-transcript-final、agent-thinking、agent-text-chunk、agent-tool-call、agent-tool-result、audio-chunk、audio-end、error、session-stats。

【第 2 部分：前端錄音】
2. 新增 client/src/hooks/useVoicePermissions.ts，匯出 useVoicePermissions() 回傳 { status, ensure }。ensure() 呼叫 navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true, sampleRate:16000 } })，測試完 stop tracks。

3. 新增 client/src/hooks/useVoiceRecorder.ts，匯出 useVoiceRecorder({ onChunk, onStop, mode: "stream" | "push-to-talk" })。內部用 MediaRecorder + audio/webm;codecs=opus，串流模式 250ms timeslice、push-to-talk 模式累積到 stop。

4. 新增 client/src/hooks/useAudioPlayback.ts，匯出 useAudioPlayback() 回傳 { enqueue, cancel }。內部用 AudioContext + decodeAudioData，順序播放 audio chunk。cancel() 清空 queue + suspend context。

5. 修改 client/src/hooks/useOrbVoice.ts：整合上述三個 hook，加 pushToTalk: { start, stop } API。WebSocket 收到 audio-chunk 用 enqueue 播放、收到 user-transcript-final 更新 UI、收到 error 顯示 toast。

6. 修改 client/src/components/orb/OrbVoiceButton.tsx 加 push-to-talk 模式：onMouseDown/onTouchStart 呼 start()、onMouseUp/onTouchEnd 呼 stop()。

【第 3 部分：後端接通 STT】
7. 修改 server/ws/orbVoiceGateway.ts，把 message handler 從 stub 換成呼叫新建的 VoiceAgentSession：binary chunks → session.handleAudioChunk()、JSON 訊息 → session.handleClientMessage()。

8. 新增 server/voice/voiceAgentSession.ts，class VoiceAgentSession 維護 chunks: Buffer[]、handleClientMessage(msg) 處理 start-utterance/end-utterance/interrupt、handleAudioChunk(chunk) 累積、transcribeAndDispatch() 用 Buffer.concat + internalMedia.storagePutBuffer 上傳暫存（key prefix voice-tmp/），呼叫 transcribeAudio() 取 transcript，呼叫 voiceAgentOrchestrator.dispatch()。

【第 4 部分：streaming TTS】
9. 新增 server/voice/voiceStreamingTts.ts，匯出 streamTts({ text, voiceId, modelId, onChunk, onEnd, signal })。內部呼叫既有 elevenLabsExtended.textToSpeechStream，預設 eleven_flash_v2_5 模型，mp3_44100_128 格式，for await chunk push 給 onChunk。

【第 5 部分：MVP 工作流】
10. 新增 server/voice/voiceAgentOrchestrator.ts，匯出 dispatch({ session, transcript, lang })。流程：session.send agent-thinking → 呼叫 runOrbTaskWithOptionalMultiAgent（既有的多代理路由）→ 把結果 summarizeOutcomeForVoice 壓成 < 80 字短句 → session.respondWithVoice 用 streamTts 朗讀 → 若有 assetUrl 送 agent-tool-result event。

11. 新增 client/src/pages/VoiceAgentPage.tsx：中央大麥克風按鈕、上方對話歷史、下方生成結果預覽。預設 push-to-talk。收到 agent-tool-result 顯示縮圖。

【測試】
12. demo 腳本：使用者按住麥「幫我生成森林晨霧的圖」→ 應在 5 秒內看到 transcript → 圖生成 → TTS 朗讀「已完成」+ 圖出現。

不要做的事：不要做 streaming STT（Whisper 用 batch 即可，屬於進階）。不要做 barge-in / VAD（屬第 26 條進階版）。不要做 wake word。不要實作 Gemini Live API。""",
    "前端按住麥克風說「你好」放開 → 1-2 秒內收到 user-transcript-final → AI 回應後 ElevenLabs streaming TTS 開始播放（chunk 連續播放、不是等完整檔下載完）。完整 demo 腳本（語音生圖）跑通。",
    "3-5 天")

add(6, "修復", "LLM 快取", "同問題重複付費", "A-P0-4 / G-P0-2",
    "AI 服務的快取系統已寫好，但很多呼叫端忘了打開「使用快取」這個選項。",
    "server/_core/cache.ts CacheService 完整；server/_core/llm.ts:invokeLLM 已支援 cacheable / cacheTtlSeconds 參數。但 planner / critic / replan 入口都沒傳。",
    "規劃 / 評論 / 重新規劃這三類請求相同 prompt 重複付費，浪費 30-60% AI 成本。",
    "對 planner、critic、replan 入口預設打開快取；同時把 Anthropic prompt caching 自動套到 system prompt 尾部。",
    [
        "server/_core/llm.ts:invokeLLM（line ~197-202 預設值 / ~1614 callEngine 注入 cache_control）",
        "server/services/agentPlanner.ts（呼叫 invokeLLM 處）",
        "shared/orb-plan-critic.ts（critic LLM 呼叫處）",
        "server/services/orbLLMReplan.ts（replan 呼叫處）",
        "server/services/ai-adapters/providers/anthropic.adapter.ts",
    ],
    """請依照計畫附錄 A.5 實作 A-P0-4 / G-P0-2 LLM Cache 接通：

1. 確認 server/_core/cache.ts:CacheService 與 server/_core/llm.ts:invokeLLM 既有的 cacheable / cacheTtlSeconds 機制（line 197-202 與 1534-1557）正常運作。寫一條測試確認：連跑兩次相同 prompt，第二次 latency < 50ms 且 metrics llm.cache.hit +1。

2. 修改 server/services/agentPlanner.ts、shared/orb-plan-critic.ts、server/services/orbLLMReplan.ts 等所有呼叫 invokeLLM 的入口，加上 cacheable: true 與 cacheTtlSeconds: 1800（30 min）。

3. 修改 server/_core/llm.ts 在 callEngine() (line ~1614) 之前加入 Anthropic prompt caching 自動套用：
   - 新增 enablePromptCache?: boolean 參數，預設 true
   - engine === "anthropic" 且 enablePromptCache !== false 時，在 systemPromptBlocks 尾部 push { type: "text", text: SYSTEM_FRAGMENT_END_MARKER, cache_control: { type: "ephemeral" } }
   - Gemini 同樣支援（依 SDK 欄位）

4. emit metrics：llm.cache.hit / llm.cache.miss / llm.prompt_cache.creation_tokens / llm.prompt_cache.read_tokens。

5. 跑既有的 server/_core/llm-cache-dedupe.test.ts 確認無回歸。

不要做的事：不要新增 Redis（屬於第 30 條未來擴張）。不要動 buildLlmKey() 的 hash 演算法。不要對 streaming 呼叫加 cache（streaming response 不適合 cache）。""",
    "連跑兩次相同 planner prompt → 第二次 < 50ms 完成。檢查 Anthropic API response headers 看到 cache_creation_input_tokens / cache_read_input_tokens > 0。檢查 metrics dashboard llm.cache.hit 比率上升。",
    "1-2 天")

add(7, "修復", "個資遮蔽", "個資洩漏在日誌", "O-P0-1",
    "PII 遮蔽函式（把 email、API key 等換成 [REDACTED]）已寫好，但只用在記憶系統。",
    "shared/orb-memory.ts 已有 containsSensitiveText / sanitizeMemoryText / sanitizeMemoryMetadata。但 server/_core/logger.ts:write() 與 server/services/langsmithTracer.ts:summarize() 只部分覆蓋。",
    "登入紀錄、錯誤訊息、LangSmith trace 可能洩漏使用者 email / API key / 信用卡 / 身份證。",
    "新增 server/_core/pii-redactor.ts 模組（補 email/phone/身份證 pattern），hook 到 logger 與 langsmithTracer 全部寫入路徑。",
    [
        "server/_core/pii-redactor.ts（新增）",
        "server/_core/logger.ts:write()（line 119-126，改用 redacted 序列化）",
        "server/services/langsmithTracer.ts:summarize()（line 20-37，加強）",
        "shared/orb-memory.ts（重用 sanitizeMemoryText / containsSensitiveText）",
    ],
    """請依照計畫附錄 A.7 實作 O-P0-1 PII 遮蔽：

1. 新增 server/_core/pii-redactor.ts，匯出三個函式：

```typescript
import { sanitizeMemoryText, containsSensitiveText } from "../../shared/orb-memory";

const EMAIL_RE = /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi;
const PHONE_RE = /\\b\\+?\\d{1,3}[\\s-]?\\(?\\d{2,4}\\)?[\\s-]?\\d{3,4}[\\s-]?\\d{3,4}\\b/g;
const TWID_RE = /\\b[A-Z][12]\\d{8}\\b/g;

export function redactForLogging(text: string): string {
  return sanitizeMemoryText(text)
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, "[PHONE]")
    .replace(TWID_RE, "[TWID]");
}

export function redactLLMParams<T extends { messages?: { content: string }[] }>(params: T): T { ... }
export { containsSensitiveText };
```

2. 修改 server/_core/logger.ts:write() (line 119-126)，新增 safeSerializeWithRedaction(meta) 函式：先 JSON.stringify(meta) → 對結果字串跑 redactForLogging → 回傳。把原本 safeSerialize 換成 safeSerializeWithRedaction。

3. 修改 server/services/langsmithTracer.ts:summarize()（line 20-37）：把現有 partial 過濾改成統一呼叫 redactForLogging。對 input / output 兩個欄位都處理。

4. 寫一條 vitest 測試：log 一條包含「我的 email 是 abc@example.com、API key 是 sk-xxx、身份證 A123456789」→ logger 輸出應為 [EMAIL] + [REDACTED] + [TWID]。LangSmith trace 同樣應遮蔽。orbLongTermMemories.content 既有 sanitize 路徑不應變更（雙保險）。

不要做的事：不要動 shared/orb-memory.ts 既有 sanitize 函式。不要做 AI 模型化偵測（屬未來擴張）。不要把 redaction 套到 user-facing UI（會破壞 prompt 顯示）。""",
    "跑一條包含 email / API key 的 prompt → grep server log 確認無明文 email；LangSmith UI 看 trace 內 content 也已遮蔽。",
    "0.5-1 天")

add(8, "修復", "死按鈕清理", "介面上有按了沒反應的按鈕", "U-P0-2",
    "「ZIP 匯出」按鈕、評估提示的「建議套用」連結都顯示著。",
    "ZIP 匯出按下去只彈 toast.info('ZIP 匯出功能即將推出')。evaluatePrompt suggestions 是純文字 div，不可點。",
    "使用者覺得被騙、產品看起來未完成。",
    "ZIP 匯出：要嘛用 jszip 真做、要嘛把按鈕隱藏（推薦做）。evaluatePrompt suggestions：每條 suggestion 改為可點擊 Button，按下後 apply 到當前 prompt 輸入框。",
    [
        "client/src/pages/HistoryPage.tsx（ZIP 匯出按鈕）",
        "client/src/components/orb-agent/ 或 ProactiveOrbWidget.tsx（evaluatePrompt suggestions）",
        "server/routes/history-export.ts（新增 ZIP 端點，可選）",
    ],
    """請依照計畫附錄 A.15 實作 U-P0-2 死按鈕清理：

【第 1 部分：ZIP 匯出】
1. 在 client/src/pages/HistoryPage.tsx 找到含 "ZIP 匯出功能即將推出" 的按鈕。
2. 實作真功能：
   - 前端用 jszip (package.json 已有依賴) 把選取的 history items 打包
   - 後端新增 server/routes/history-export.ts: POST /api/history/export-zip，body { historyIds: number[] }，response stream ZIP（含 metadata.json + 各檔案）
   - 前端按鈕改 disabled={selectedIds.length === 0}，按下後 trigger download
3. 若時程吃緊，先把按鈕隱藏（移除或 hidden）並更新 toast 訊息為「請選擇要匯出的項目」。

【第 2 部分：evaluatePrompt suggestions】
4. grep "evaluatePrompt" 找到 suggestions 顯示處（多半在 ProactiveOrbWidget.tsx 或 orb-agent/ 內）。
5. 把每條 suggestion 從 純文字 div 改為 <Button variant="ghost" size="sm" onClick={() => applySuggestion(s)}>。
6. applySuggestion(s) 應該把 suggestion 文字 set 到當前 prompt 輸入框（呼叫對應 store 的 setPrompt）。
7. 套用後 emit metric "prompt.suggestion.applied" 並關閉 suggestions popover。

不要做的事：不要新增 ZIP 格式以外的匯出（PDF / CSV 等）。不要重設計 HistoryPage 的卡片排版（只動匯出按鈕）。""",
    "HistoryPage 選 3 個 history items 點「匯出 ZIP」→ 下載 .zip 含 3 個檔案 + metadata.json。在 Orb 對話中點 suggestion → 看到 prompt 輸入框被填入該文字。",
    "1-2 天")

add(9, "修復", "重做傳參數", "重做按鈕少傳一半參數", "U-P0-1",
    "歷史卡片點「重做」回到 Studio，只傳 prompt + modality。",
    "HistoryPage.tsx:1142-1145 的 dispatchToStudio() 呼叫只傳 parameterSnapshot 的少數欄位。",
    "原圖 seed / temperature / 風格卡 / 負面 prompt / LoRA / 解析度全部丟失，使用者重做出來不一樣，要手動全部重設。",
    "擴充 ParameterSnapshot 介面到 20+ 欄位，HistoryPage 用 enrichSnapshotFromHistory() 抽完整參數，Studio 端在 store 自動 apply 到對應控制項。",
    [
        "shared/orb-studio-actions.ts（ParameterSnapshot 介面擴充）",
        "client/src/lib/send-to-studio.ts（enrichSnapshotFromHistory 新增）",
        "client/src/stores/workspaceStore.ts（pendingParameterSnapshot 欄位 + apply 方法）",
        "client/src/pages/HistoryPage.tsx:1142（dispatchToStudio 呼叫改用 enrich）",
        "client/src/pages/ImageStudioPage.tsx / VideoStudioPage.tsx / ProStudioPage.tsx（掛載時 apply）",
    ],
    """請依照計畫附錄 A.14 實作 U-P0-1 跨頁參數連續性：

1. 修改 shared/orb-studio-actions.ts 擴充 ParameterSnapshot 介面：

```typescript
export interface ParameterSnapshot {
  // 既有
  prompt?: string;
  compiledPrompt?: string;
  generationType?: string;
  overrideEngine?: string;
  resultUrl?: string;
  // 新增
  seed?: number;
  temperature?: number;
  topP?: number;
  vibeCardIds?: string[];
  negativePrompt?: string;
  loraIds?: string[];
  loraScales?: number[];
  referenceImageUrls?: string[];
  aspectRatio?: string;
  resolution?: string;
  numImages?: number;
  // 音訊
  musicStyle?: string;
  audioScript?: string;
  voiceId?: string;
  speakerEmotionId?: string;
  musicDurationSec?: number;
  // 角色 / 一致性
  consistencyVaultId?: string;
  characterRoleId?: string;
  sceneSettingId?: string;
}
```

2. 在 client/src/lib/send-to-studio.ts 新增 enrichSnapshotFromHistory(item: HistoryItem): ParameterSnapshot 函式。從 generationHistory.parameterSnapshot JSON 完整抽出所有欄位。

3. 修改 client/src/stores/workspaceStore.ts：WorkspaceState 加 pendingParameterSnapshot?: ParameterSnapshot；新增 action applySnapshotToActiveTab(snapshot)。

4. 修改 client/src/pages/HistoryPage.tsx 第 1142 行附近的 dispatchToStudio() 呼叫：先用 enrichSnapshotFromHistory(item) 抽出完整欄位，再 dispatch。

5. 修改 client/src/pages/ImageStudioPage.tsx / VideoStudioPage.tsx / ProStudioPage.tsx：useEffect 監聽 workspaceStore.pendingParameterSnapshot，掛載或變化時自動 apply 到對應控制項（seed input、temperature slider、lora picker、negative prompt textarea 等），然後 clear pending。

6. 補一條 vitest / playwright 測試：History 點「重做」→ Studio 預填的 seed / lora / negativePrompt 都有正確值。

不要做的事：不要動 generationHistory 表 schema（parameterSnapshot 是 JSON 欄位已可塞任意欄位）。不要新增「重做為新模型」這種變體（屬未來擴張）。""",
    "在 ImageStudio 用具體 seed/lora/negativePrompt 生一張圖 → 看 History 該卡片 → 點「重做」→ Studio 自動填回所有參數 → 不需手動調整即可重生（結果應接近原圖）。",
    "1 天")

add(10, "修復", "Migration 編號", "資料庫變更檔重號", "D-P0-3",
    "drizzle/migrations/ 有兩對檔案編號相同：0008 與 0033 各兩份。",
    "0008_admin_api_usage.sql 與 0008_numerous_mother_askani.sql 同號；0033_add_plan_status_to_sessions.sql 與 0033_agent_model_picks.sql 同號。drizzle-kit 依檔名排序、相同前綴行為不可預測。",
    "未來部署可能套用順序錯誤，schema 與 prod DB 失同步。",
    "保留先到那份、把後到那份 rename 為下一可用編號（0033a 或續編），同步更新 drizzle/meta/_journal.json。",
    [
        "drizzle/migrations/0008_admin_api_usage.sql",
        "drizzle/migrations/0008_numerous_mother_askani.sql",
        "drizzle/migrations/0033_add_plan_status_to_sessions.sql",
        "drizzle/migrations/0033_agent_model_picks.sql",
        "drizzle/meta/_journal.json",
    ],
    """請依照計畫附錄 A.10 修復 D-P0-3 migration 命名衝突：

1. 先讀 drizzle/meta/_journal.json，記錄每條 migration entry 的雜湊與順序，確認當前 prod DB 已套用次序。

2. 用 npx drizzle-kit introspect 比對 prod schema 與 schema.ts，確認兩者一致。若不一致先停止本任務，發現 schema drift 要先處理。

3. 處理 0008：
   - 確認 0008_admin_api_usage.sql 與 0008_numerous_mother_askani.sql 內容是否相容（兩個 ALTER 不衝突）
   - 保留檔名最先到的那份（依 git log 看 commit 時間）
   - 後到那份 rename 為下一可用編號（檢查目前最大編號，例如改為 0008a_admin_api_usage.sql 或統一往後遞移）
   - 同步更新 drizzle/meta/_journal.json 對應 entry

4. 處理 0033：同上方式處理 0033_add_plan_status_to_sessions.sql 與 0033_agent_model_picks.sql。

5. 跑 npx drizzle-kit check 確認 0 衝突。

6. 寫一條測試或文件記錄變更，避免未來再撞號。

⚠️ 風險：若 prod 已套用「後到」那份的內容（雜湊已記）但編號重複，需用 drizzle-kit introspect 比對 prod schema 與 schema.ts；不一致時補 patch migration。**絕不可直接重發 SQL**（會重跑造成資料破壞）。

不要做的事：不要 drop / recreate 任何 migration 已建立的表。不要動 schema.ts。不要修改 0008 / 0033 兩份 SQL 內容（只改檔名與 journal）。""",
    "npx drizzle-kit check 通過 0 衝突。npx drizzle-kit introspect 比對 prod 與 schema.ts 完全一致。重新部署一次 staging 確認 migration 順序正確。",
    "0.5 天")

add(11, "修復", "Webhook 去重", "外部通知會被重複處理", "D-P0-4",
    "FAL / Replicate / Suno / Stripe / Orb 5 個 webhook 各自有 HMAC 簽名驗證，但無 idempotency 機制。",
    "外部服務有時會 retry 同一個事件（網路問題、確認超時），我們的 webhook 路由會重複處理（再次扣點、再次發通知、再次入庫）。",
    "重複扣點、重複入庫、使用者點數異常消耗。",
    "新增 webhook_receipts 表（provider + external_id 唯一索引），所有 webhook 路由前掛 middleware 檢查「我收過了沒」。",
    [
        "drizzle/migrations/00XX_webhook_receipts.sql（新增）",
        "drizzle/schema.ts（新增 webhookReceipts 表）",
        "server/middleware/webhookIdempotency.ts（新增）",
        "server/routers.ts（5 個 webhook 路由前掛 middleware）",
    ],
    """請依照計畫附錄 A.11 實作 D-P0-4 Webhook idempotency：

1. 新增 migration drizzle/migrations/00XX_webhook_receipts.sql（取下一個可用編號）：

```sql
CREATE TABLE webhook_receipts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(32) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  status ENUM('received','processed','failed') DEFAULT 'received',
  error TEXT NULL,
  UNIQUE KEY uq_provider_external (provider, external_id),
  INDEX idx_provider_received (provider, received_at)
);
```

2. 在 drizzle/schema.ts 新增 webhookReceipts 表 schema。

3. 新增 server/middleware/webhookIdempotency.ts：

```typescript
export async function checkWebhookIdempotency(provider: string) {
  return async (req, res, next) => {
    const externalId = req.body.request_id ?? req.body.id ?? req.body.event_id;
    if (!externalId) return res.status(400).json({ error: "missing_external_id" });
    const payloadHash = sha256(req.rawBody);
    try {
      await db.insert(webhookReceipts).values({ provider, externalId, payloadHash });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        logger.info("webhook_duplicate_ignored", { provider, externalId });
        return res.status(200).json({ status: "duplicate_ignored" });
      }
      throw err;
    }
    next();
  };
}

export async function markWebhookProcessed(provider: string, externalId: string) {
  await db.update(webhookReceipts).set({ processedAt: new Date(), status: "processed" })
    .where(and(eq(webhookReceipts.provider, provider), eq(webhookReceipts.externalId, externalId)));
}
```

4. 在 server/routers.ts 找到所有 webhook 路由（grep "/webhook/"），在每個路由前掛 checkWebhookIdempotency(providerName)。處理完成後呼叫 markWebhookProcessed。

5. 確保 Express 有保留 rawBody 用於 sha256（可能需要 raw-body middleware）。

6. 寫一條 vitest 測試：同一個 webhook payload 連送兩次 → 第一次 200、第二次 200 with status "duplicate_ignored"，且業務邏輯只執行一次。

不要做的事：不要動既有的 HMAC 簽名驗證邏輯（保留作第一層防線）。不要把 webhook_receipts 設 TTL 自動清除（保留 90 天作審計）。""",
    "用 curl 連送兩次同一個 FAL webhook payload → 第二次回 200 with duplicate_ignored，DB 看 generationHistory 只新增一筆、點數只扣一次。",
    "1 天")

add(12, "修復", "成本告警", "成本超標沒人通知", "O-P0-2",
    "每天 / 每小時花了多少錢只能等月底報表才看到。",
    "server/jobs/apiUsageAlertJob.ts 有月度預算告警但無 hourly threshold。閾值 hardcoded 在 line 67：monthlyBudget = Number(serverEnv.AI_MONTHLY_BUDGET_USD || 500)。",
    "被攻擊狂打 API、模型定價突然上漲、cron 失控導致狂跑、使用者帳號被盜用大量呼叫都要月底才發現。",
    "新增 hourly / daily threshold + Discord 告警 channel（既有 Discord webhook 在 apiHealthMonitor.ts 已用）。",
    [
        "server/jobs/apiUsageAlertJob.ts（fireAlert 加 Discord 分支、新增 checkHourlyAlerts）",
        "server/_core/notification.ts（新增 sendDiscordAlert）",
        "server/_core/env.validated.ts（新增 env vars）",
    ],
    """請依照計畫附錄 A.8 實作 O-P0-2 即時成本告警：

1. 在 server/_core/env.validated.ts 新增四個 env vars：
   - ALERT_DISCORD_WEBHOOK（主用，可從 apiHealthMonitor.ts 借用同一個）
   - ALERT_SLACK_WEBHOOK（保留既有）
   - COST_ALERT_DAILY_USD（預設 50）
   - COST_ALERT_HOURLY_USD（預設 20）

2. 在 server/_core/notification.ts 新增 sendDiscordAlert(message, severity: "info"|"warn"|"crit")：
   - 用 fetch POST 到 ALERT_DISCORD_WEBHOOK
   - 用 Discord embed 結構，severity 對應 embed color（info=藍、warn=黃、crit=紅）
   - 加 timeout 5s + try-catch logger.warn

3. 修改 server/jobs/apiUsageAlertJob.ts：
   - 把現有 fireAlert(key, message) 加第三參數 severity，內部同時呼叫 sendSlackAlert（既有）與 sendDiscordAlert（新增）
   - 新增 async checkHourlyAlerts() 函式：getHourlySpend() → 若 > COST_ALERT_HOURLY_USD 則 fireAlert(`hourly_${new Date().toISOString().slice(0,13)}`, msg, "crit")
   - 同樣新增 checkDailyAlerts()
   - 在 main job runner 內加上這兩個 check 的呼叫

4. 把 cron 頻率從 15 min 改成 5 min（cron 表達式 "*/5 * * * *"），讓 hourly 偵測更靈敏。

5. 確認 shouldAlert(key) 的 1 小時 dedup 邏輯對 hourly_xxx key 仍正常（slice(0,13) 拿小時級 key 確保同一小時內不重複）。

6. 寫 vitest 測試：mock 過去一小時 spend = $25 → 應觸發告警；spend = $5 → 不觸發。

不要做的事：不要在這條任務做「使用量 dashboard UI」（屬第 20 條）。不要為了告警阻擋業務流程（告警只是通知）。不要把預算改成硬上限（cost guard 第 18 條才處理上限）。""",
    "模擬一小時內跑 30 條 Sora 影片（會破 $20 / hr）→ Discord channel 應收到紅色 embed 告警，內容含時間、金額、超出閾值。1 小時內不重複。",
    "1 天")

# ============ 微調優化類（第 13-25 項）======================================

add(13, "優化", "介面風格統一", "30+ 檔案硬編寫法", "U-P1-1",
    "30 多個檔案各自硬編 text-[10px]、text-gray-900 dark:text-white、tracking-[0.18em] 等。",
    "Tailwind utility 沒統一、設計 token 沒徹底套用，看起來像不同人做的。",
    "整個產品「不像同一套設計」，品牌一致性差。",
    "用 jscodeshift codemod 一次掃過 30+ 檔案，替換為統一 token（.text-2xs / .text-foreground / .tracking-cjk-wide）。分三批 PR 降低風險，搭配 Playwright visual regression。",
    [
        "client/src/index.css（補 .text-2xs / .text-3xs / .tracking-cjk-wide 等 utility class）",
        "codemods/tokenizeTypography.js（新增 jscodeshift rule）",
        "client/src/**/*.tsx（30+ 檔案，分批處理）",
        "tests/visual-regression/（Playwright screenshot 對照）",
    ],
    """請依照計畫附錄 C.6 實作 U-P1-1 Typography codemod：

【第 1 部分：補 utility】
1. 在 client/src/index.css 補上缺的 utility class：
   - .text-2xs { font-size: 10px; line-height: 14px; }
   - .text-3xs { font-size: 9px; line-height: 12px; }
   - .tracking-cjk-wide { letter-spacing: 0.18em; }
   - .tracking-display { letter-spacing: 0.22em; }
   - 色彩語義 token：.text-foreground / .text-foreground-muted / .text-foreground-subtle（從現有 OKLCH 色系延伸）

【第 2 部分：codemod】
2. 新增 codemods/tokenizeTypography.js，用 jscodeshift API：
   - 規則 1：找 className 含 text-[10px] / text-[9px] → 替換為 text-2xs / text-3xs
   - 規則 2：找 className 同時含 text-gray-900 + dark:text-white → 合併為 text-foreground
   - 規則 3：找 tracking-[0.18em] / tracking-[0.22em] → tracking-cjk-wide / tracking-display
   - 規則 4：處理 template literal 內字串（小心 dynamic className）

3. 跑 grep 統計：grep -r "text-\\[10px\\]\\|text-gray-900 dark:text-white\\|tracking-\\[" client/src/ | wc -l 應得到約 1000+ 行匹配，分散在 30+ 檔案。

【第 3 部分：三批 PR】
4. **Batch 1**（10 檔案）：純 text-[10px/9px] 無副作用文件
   - jscodeshift -t codemods/tokenizeTypography.js [10 個指定檔案]
   - 跑既有測試 + visual regression

5. **Batch 2**（10 檔案）：含 color + tracking 的複合規則文件
   - 同上

6. **Batch 3**（10+ 檔案）：含 className template literal / styled-components
   - 手動處理風險點，逐一檢查

【第 4 部分：visual regression】
7. 新增 tests/visual-regression/typography.spec.ts，對 5 個關鍵頁（Home / ImageStudio / History / Dashboard / Settings）截圖比對。

不要做的事：不要重新設計整體色彩系統。不要動 Tailwind config（只加 utility）。不要一次跑全部檔案（一定要分批 PR，因為 codemod 邊界情境很容易壞）。""",
    "三批 PR 各自跑通既有測試 + visual regression < 5% diff。grep text-\\[10px\\] 在 client/src/ 應 0 匹配。設計師肉眼確認 Home / Studio / Settings 字體一致。",
    "3-4 天")

add(14, "優化", "鍵盤無障礙", "Tab 鍵跳不到位置", "U-P1-4",
    "鍵盤族、視障使用者用不順。",
    "焦點框（focus ring）沒有標準元件、ARIA 標籤稀稀落落（grep 統計只有 ~30 個 aria-label、5 個 role=）、無 prefers-reduced-motion 系統化套用。",
    "違反 WCAG 2.1 AA、視障使用者完全無法操作關鍵流程。",
    "建一個標準 focus ring 元件 + 把所有 button/link 補 aria-label + modal 加 role=dialog aria-modal aria-labelledby + 鍵盤 Tab order 補。",
    [
        "client/src/_core/animation.ts（useMotionPreference 新增）",
        "client/src/components/ui/FocusRing.tsx（新增標準元件）",
        "client/src/components/**/*.tsx（補 aria-label 30+ 處）",
        "client/src/contexts/*.tsx（modal 加 role=dialog）",
    ],
    """請依照計畫附錄 C.7 與 D.1 實作 U-P1-4 無障礙系統化：

【第 1 部分：基礎 hook】
1. 新增 client/src/_core/animation.ts，匯出 useMotionPreference() 與 getAnimationDuration(prefersReduced, base)：

```typescript
export function useMotionPreference() {
  const [prefersReduced, setReduced] = useState(false);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, []);
  return { prefersReduced };
}
```

【第 2 部分：Focus ring 元件】
2. 新增 client/src/components/ui/FocusRing.tsx：

```tsx
export function FocusRing({ children, ...rest }) {
  return <span className="focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary rounded-md" {...rest}>{children}</span>;
}
```
配合 CSS：使用既有 Morandi OKLCH 色彩，不要刺眼藍。

【第 3 部分：ARIA 規範化】（依優先序）

3. **Critical 級**：
   - 所有 button / a / focusable 加 aria-label 或 aria-labelledby
   - 表單欄位配 <label htmlFor=""> 或 aria-label
   - 所有 Dialog / Modal 元件加 role="dialog" + aria-modal="true" + aria-labelledby="dialog-title"

4. **Medium 級**：
   - List role：role="listbox/menu/tree" 搭 role="option/menuitem/treeitem"
   - Status messages：role="status"
   - Loading spinners：aria-busy="true" 或 role="status" + 視覺隱藏文案

5. **Nice 級**（時程允許再做）：
   - Combobox：role="combobox" aria-expanded aria-owns
   - Custom slider：role="slider" aria-valuemin/max/now

【第 4 部分：MotionConfig】
6. 在 client/src/App.tsx 根節點包 <MotionConfig reducedMotion="user">（Framer Motion）。

【第 5 部分：套用 reduced motion】
7. 修改既有的 AmbientEnvironmentContext / VisualSoul / JewelOrbStage：呼叫 useMotionPreference()，prefersReduced 時 cancel Canvas raf、Three.js scene 切靜態截圖或 disable orbit auto-rotate。

不要做的事：不要全面改寫設計系統。不要把 focus ring 改成方塊（保留 rounded）。不要 i18n（屬未來擴張）。""",
    "用鍵盤 Tab 從 Home 跑完 30 + 頁面，所有互動元素都有可見 focus ring。NVDA / VoiceOver 讀得到所有按鈕用途。系統設「減少動態效果」→ 光球與四季背景靜止、無粒子動畫。",
    "4-5 天")

add(15, "優化", "動畫降階", "光球在低階機器卡頓", "U-P1-5 / V-P1-3",
    "光球、四季背景對所有人用同等強度。",
    "舊筆電 / 手機跑不順。AmbientEnvironment 四季背景只能全開全關、VisualSoul/JewelOrbStage 無 LOD / frustum culling / WebWorker offload。",
    "低階機器使用體驗差、可能勸退使用者。",
    "依硬體（navigator.deviceMemory、hardwareConcurrency）自動降階；同時尊重 prefers-reduced-motion；提供四級設定 Off / Subtle / Standard / Immersive。",
    [
        "client/src/contexts/AmbientEnvironmentContext.tsx（接受 animationTier，依 factor 調 particleCount/speed）",
        "client/src/components/visual-soul/VisualSoul.tsx（依 tier 選 GLB snapshot / 低 FPS / 預設 / 高 FPS）",
        "client/src/components/visual-soul/JewelOrbStage.tsx（依 tier 調 orbit speed）",
        "client/src/_core/animation.ts（tierToFactor 函式 + 硬體偵測）",
    ],
    """請依照計畫附錄 D.8 實作 U-P1-5 / V-P1-3 動畫強度分級：

⚠️ 前置：請先做第 14 條（useMotionPreference hook 已建）。

1. 在 client/src/_core/animation.ts 新增四級 tier 與 helper：

```typescript
export const ANIMATION_TIERS = ["off", "subtle", "standard", "immersive"] as const;
export type AnimationTier = typeof ANIMATION_TIERS[number];

export function tierToFactor(tier: AnimationTier): number {
  return { off: 0, subtle: 0.3, standard: 1, immersive: 1.4 }[tier];
}

export function detectHardwareTier(): AnimationTier {
  const memory = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (memory < 4 || cores < 4) return "subtle";
  if (memory >= 8 && cores >= 8) return "standard";
  return "standard";
}
```

2. 修改 client/src/contexts/AmbientEnvironmentContext.tsx：
   - 接受 animationTier prop / context value
   - factor = tierToFactor(animationTier)
   - particleCount = Math.round(BASE_PARTICLES * factor)
   - factor === 0 時不啟動 raf loop
   - 同時 useMotionPreference().prefersReduced === true 強制 factor = 0（不可被 immersive 覆蓋）

3. 修改 client/src/components/visual-soul/VisualSoul.tsx：
   - off：載入靜態 GLB snapshot 取代 live Three.js scene
   - subtle：requestAnimationFrame 限制 15 FPS、orbit 速度 0.3x
   - standard：預設
   - immersive：60 FPS、orbit 速度 1.4x

4. 修改 client/src/components/visual-soul/JewelOrbStage.tsx：依 tier disable orbit auto-rotate（off / subtle）。

5. emit metrics vision.animation.tier_distribution：每次設定變更時記錄。

6. Settings 新增 slider（將整合到第 25 條的 Vision Wellness panel）：四級可手動調，預設 detectHardwareTier()。

不要做的事：不要做 WebWorker offload（屬未來優化）。不要重寫 Three.js render loop。不要禁用所有動畫（保留 standard 為預設 healing 體驗）。""",
    "deviceMemory < 4 或 hardwareConcurrency < 4 的環境（用 Chrome DevTools 模擬）→ 預設動畫降到 subtle。手動切到 immersive → 光球轉得更快。系統「減少動態效果」勝出（強制 off）。",
    "2 天")

add(16, "優化", "串流進度", "長任務看起來像當機", "G-P0-1 / U-P1-2 / V-P1-5",
    "影片合成、長對話 LLM 都是「整體返回」，使用者看到「等待中」黑盒。",
    "server/sseRoute.ts 有 SSE 框架、server/services/falQueueAwaiter.ts 有指數退避輪詢、elevenLabsExtended.textToSpeechStream 有 WebSocket，但這三條沒統一抽象、沒接到前端。",
    "30 秒影片合成 / 60 秒對話 LLM，使用者以為當機。",
    "把 FAL queue awaiter、Gemini stream、ElevenLabs WebSocket 統一為 AsyncIterable<StepEvent>，透過既有 SSE 推給前端，前端 useStreamingStep hook 顯示進度。",
    [
        "shared/streaming-events.ts（StepEvent / StreamProvider 介面，新增）",
        "server/services/streamingProviders.ts（FalStreamProvider / GeminiStreamProvider / ElevenLabsStreamProvider，新增）",
        "server/sseRoute.ts（加 /api/stream/:stepId 路由）",
        "client/src/hooks/useStreamingStep.ts（新增 EventSource hook）",
        "client/src/components/OrbTaskObservationStrip.tsx（接 streaming）",
    ],
    """請依照計畫附錄 B.1 實作 G-P0-1 / U-P1-2 / V-P1-5 Streaming 全鏈：

【第 1 部分：抽象】
1. 新增 shared/streaming-events.ts：

```typescript
export type StepEventType = "step.start" | "step.progress" | "step.chunk" | "step.partial" | "step.complete" | "step.error" | "step.cancel";

export interface StepEvent {
  type: StepEventType;
  stepId: string;
  traceId: string;
  timestamp: number;
  progress?: number;
  message?: string;
  data?: { url?: string; mediaType?: "image"|"video"|"audio"|"text"; duration?: number; metadata?: Record<string, unknown> };
  error?: { code: string; message: string; retryable: boolean };
}

export interface StreamProvider {
  subscribe(stepId: string, onEvent: (ev: StepEvent) => void): Promise<() => void>;
  cancel(stepId: string): Promise<void>;
}
```

【第 2 部分：三家 Provider】
2. 新增 server/services/streamingProviders.ts，匯出三個 class：
   - FalStreamProvider：包裝既有 falQueueAwaiter，每 3s emit step.progress、完成時 step.complete + cleanup
   - GeminiStreamProvider：把 generateVideoSync 的輪詢改 callback driven
   - ElevenLabsStreamProvider：把 textToSpeechStream 的 ReadableStream 轉為 step.chunk 序列

3. 同檔案匯出 selectStreamProvider(stepId, metadata) 工廠函式。

【第 3 部分：SSE 升級】
4. 修改 server/sseRoute.ts：新增 GET /api/stream/:stepId 路由，內部呼叫 selectStreamProvider 取得 provider，呼叫 provider.subscribe，每個 event res.write(`data: ${JSON.stringify(event)}\\n\\n`)。
   - 心跳改 20s（既有 15s 太密）
   - step.complete / step.error / step.cancel 後 300ms cleanup + res.end()
   - req.on("close") 觸發 unsubscribe（取消後端輪詢）

【第 4 部分：前端 hook】
5. 新增 client/src/hooks/useStreamingStep.ts：

```typescript
export function useStreamingStep(stepId: string, onEvent?: (ev: StepEvent) => void) {
  const [status, setStatus] = useState<"idle"|"running"|"completed"|"error">("idle");
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<StepEvent["data"]>(null);
  useEffect(() => {
    const es = new EventSource(`/api/stream/${stepId}`);
    es.addEventListener("message", (e) => {
      const event: StepEvent = JSON.parse(e.data);
      onEvent?.(event);
      if (event.type === "step.progress") setProgress(event.progress ?? 0);
      if (event.type === "step.complete") { setStatus("completed"); setData(event.data); es.close(); }
      if (event.type === "step.error") { setStatus("error"); es.close(); }
    });
    es.addEventListener("error", () => { setStatus("error"); es.close(); });
    return () => es.close();
  }, [stepId]);
  return { status, progress, data };
}
```

【第 5 部分：UI 集成 + 不閃跳】
6. 修改既有 OrbTaskObservationStrip / LazyStreamdown / OrbThinkingTimeline：接收 streamingStatus，進度條用 <motion.div animate={{ width: `${progress}%` }} transition={{ type: "tween", duration: 0.6, ease: "easeOut" }} />（不要 spring，會抖）。

7. Toast 通知節流到每 2s 最多一條（避免高頻 progress event 連續彈窗）。

8. prefers-reduced-motion 時，進度條改 stepwise（0% → 25% → 50% → 75% → 100% 四段，無 transition）。

不要做的事：不要重寫 falQueueAwaiter（包裝即可）。不要做 streaming STT（屬第 26 條）。不要把所有舊 LLM 呼叫都改成 streaming（只動 step-level）。""",
    "跑一支 30 秒影片合成 → 前端進度條每 3 秒平滑前進。Network panel 看到 /api/stream/:stepId 一直流 event。系統「減少動態效果」→ 進度條變 4 段 stepwise。中途關閉 tab → backend log 看到 unsubscribe。",
    "5-7 天")

add(17, "優化", "失敗補償", "失敗任務不會清理", "A-P1-4",
    "一連串步驟其中一步失敗，前面已完成步驟結果留著（產生孤立資產、半成品垃圾）。",
    "shared/agent-plan-schema.ts 已有 compensationAction 與 rollbackPolicy 欄位，但 orbTaskChainRunner 沒有實際執行路徑。",
    "影片合成、LoRA 訓練等高成本步驟失敗時無法乾淨退場，資料庫留半成品 + 已扣點數無法退款。",
    "新增 compensation chain 執行邏輯（LIFO）+ compensating state + audit log 記錄。失敗的 compensation 本身不再遞迴補償，只記錄留人工介入。",
    [
        "shared/orb-task-state-machine.ts（加 compensating state）",
        "server/services/orbTaskChainRunner.ts（initializeCompensationContext / executeCompensationStep / runCompensationChain）",
        "shared/agent-plan-schema.ts（compensationAction 文件強化）",
    ],
    """請依照計畫附錄 B.2 實作 A-P1-4 Compensation / Rollback 鏈：

1. 修改 shared/orb-task-state-machine.ts，在 ORB_TASK_STATES 加 "compensating" state：

```typescript
export const ORB_TASK_STATES = [
  "idle", "planning", "awaiting_approval", "approved",
  "executing", "paused", "recovering",
  "compensating",  // ← 新增
  "completed", "failed", "cancelled", "blocked",
] as const;

export interface OrbAgentTaskStep {
  // 既有 + 新增：
  rollbackStatus?: "pending" | "completed" | "failed" | "skipped";
  compensationRetryCount?: number;
}

export const DEFAULT_COMPENSATION_RETRY_BUDGET = 1;  // ⚠️ 補償失敗不再遞迴
```

2. 在 server/services/orbTaskChainRunner.ts 新增三個函式：

```typescript
export interface CompensationStep {
  originalStepId: string;
  compensationAction: unknown;
  executedAt: number;
  completedAt?: number;
  failedAt?: number;
  failureReason?: string;
}

export function initializeCompensationContext(task: OrbAgentTask, failedStepId: string) {
  const completed = task.steps
    .filter((s) => s.status === "completed" && s.id !== failedStepId)
    .sort((a, b) => b.id.localeCompare(a.id));  // LIFO
  return {
    taskId: task.taskId,
    failedAtStepId: failedStepId,
    compensationQueue: completed
      .filter((s) => s.compensationAction)
      .map((s) => ({ originalStepId: s.id, compensationAction: s.compensationAction, executedAt: Date.now() })),
    startedAt: Date.now(),
  };
}

export async function runCompensationChain(ctx, tools, updateTask) {
  await updateTask({ status: "compensating" });
  for (const step of ctx.compensationQueue) {
    try {
      await executeOrbToolCall(step.compensationAction, tools, { timeoutMs: 60_000 });
      step.completedAt = Date.now();
      appendOrbAgentTaskAuditEvent({ taskId: ctx.taskId, type: "step.rollback_completed", message: `${step.originalStepId} rollback OK` });
    } catch (err) {
      step.failedAt = Date.now();
      step.failureReason = String(err);
      appendOrbAgentTaskAuditEvent({ taskId: ctx.taskId, type: "step.rollback_failed", message: `${step.originalStepId} rollback failed: ${err}` });
      // ⚠️ 不遞迴 — 補償失敗只記錄
    }
  }
  const allOk = ctx.compensationQueue.every((s) => s.completedAt);
  await updateTask({ status: allOk ? "cancelled" : "failed" });
}
```

3. 在 orbTaskChainRunner 主 step loop 內，當任何 step status === "failed" 且 task.policy.rollbackPolicy === "auto-on-failure" 時：

```typescript
const ctx = initializeCompensationContext(task, failedStep.id);
await runCompensationChain(ctx, tools, (patch) => updateOrbAgentTask(task.taskId, patch));
```

4. 寫 vitest 測試：
   - 三步 plan，第二步刻意 throw → 第一步的 compensation 應被執行、第三步 skip
   - Compensation 本身 throw → audit log 有 step.rollback_failed、task 狀態為 failed（非 cancelled）
   - rollbackPolicy: "manual" 時不自動執行

不要做的事：不要遞迴補償（補償失敗不再補償）。不要動 plan schema（既有欄位已備）。不要做 partial rollback（要嘛全部、要嘛失敗，沒中間態）。""",
    "建一個三步 plan（生圖 → 加旁白 → 合成影片），第三步 throw → 看 audit log：step.rollback_completed 兩條（第二、第一步）→ task 狀態 cancelled。模擬第二步 compensation throw → step.rollback_failed → task 狀態 failed。",
    "3-4 天")

add(18, "優化", "成本接通", "預估費用顯示不準", "A-P1-6",
    "「執行前預估費用」卡片用粗略估算。",
    "server/services/modelPricing.ts 是 3500 行完整 catalog（5 級 tier、basePoints + 超量加乘）、estimatePoints() / getModelPricing() 都已寫好，但 server/services/orbCostGuard.ts 用 tier-based heuristic 沒查它。",
    "使用者看到的預估費用與實際差很多，無法做明智決定。",
    "把 cost guard 接到 modelPricing catalog；plan-time 預估卡片改顯示真實 points + USD breakdown；對 catalog 加 30 min cache。",
    [
        "server/services/orbCostGuard.ts（接通 modelPricing）",
        "client/src/components/PlanApprovalCard.tsx（新增或重構，顯示真實成本）",
        "server/services/modelPricing.ts（既有，不改）",
    ],
    """請依照計畫附錄 B.4 實作 A-P1-6 Cost catalog 接線：

【第 1 部分：cost guard 接通】
1. 在 server/services/orbCostGuard.ts 新增 helper：

```typescript
export async function enrichCostEstimateWithPricing(
  estimate: OrbCostEstimate,
  stepTools: string[],
): Promise<OrbCostEstimate & { totalPoints: number; breakdown: string }> {
  const { estimatePoints, getModelPricing } = await import("./modelPricing");
  let totalPoints = 0;
  const breakdown: string[] = [];
  for (const toolName of stepTools) {
    const modelId = getUserSelectedModel(toolName);
    const pricing = getModelPricing(modelId);
    if (pricing) {
      const points = estimatePoints({
        modelId,
        durationSec: estimate.estimatedDurationSec,
        charCount: estimate.estimatedCharCount,
        imageCount: estimate.estimatedAssetCount,
      });
      totalPoints += points.totalPoints;
      breakdown.push(`${toolName}=${points.totalPoints}pts`);
    }
  }
  return { ...estimate, totalPoints, breakdown: breakdown.join(" + ") };
}
```

【第 2 部分：catalog cache】
2. 新增 catalog cache（30 min TTL）：

```typescript
const PRICING_CACHE_TTL_MS = 30 * 60 * 1000;
let cachedCatalog: typeof MODEL_PRICING_CATALOG | null = null;
let cachedAt = 0;
export async function getPricingCatalogCached() {
  if (cachedCatalog && Date.now() - cachedAt < PRICING_CACHE_TTL_MS) return cachedCatalog;
  const { MODEL_PRICING_CATALOG } = await import("./modelPricing");
  cachedCatalog = MODEL_PRICING_CATALOG;
  cachedAt = Date.now();
  return cachedCatalog;
}
```

【第 3 部分：approval card UI】
3. 新增（或重構既有 CostGateCard）client/src/components/PlanApprovalCard.tsx：

```tsx
export interface PlanApprovalCardProps {
  taskId: string;
  steps: AgentPlanStep[];
  costEstimate: { totalPoints: number; breakdown: string; tier: "free"|"economy"|"standard"|"premium"|"ultra" };
  userBudget?: number;
  onApprove: () => void;
  onCancel: () => void;
}
export function PlanApprovalCard(props) {
  const pointsToUsd = (pts: number) => `$${(pts / 100).toFixed(2)}`;
  const budgetRemaining = props.userBudget ? props.userBudget - props.costEstimate.totalPoints : null;
  // 顯示：N 步驟分解 + 每步 points + 合計（pts + USD）+ 預算徽章 + tier badge + 詳細 breakdown details
  // ...
}
```

4. 在 server/services/orbTaskOrchestrator.ts 或 planner，把 plan 編譯後呼叫 enrichCostEstimateWithPricing()，把結果塞入 plan metadata，前端 approval card 接收顯示。

5. 整合到既有 ProactiveOrbWidget 的 approval flow（重用 PlanApprovalCard，刪除舊版內嵌版本）。

不要做的事：不要動 modelPricing.ts catalog 本身（既有 3500 行 SSOT）。不要把 cost guard 改成硬阻擋（保留 cost-aware 但讓使用者決定）。不要顯示細部 USD 計算公式給使用者（複雜、容易誤導，只顯示總金額）。""",
    "在 ImageStudio 用 kling-v2-pro 跑 5s 影片 → approval card 顯示「30 pt = $0.30」（真實定價，非粗估）。詳細 breakdown 點開看到 kling-v2-pro=30pts。修改 modelPricing.ts 內某個價格 → 30 分鐘內 catalog 自動刷新。",
    "2-3 天")

add(19, "優化", "Eval 擴張", "回歸測試只有 6 個", "A-P1-5 / O-P1-1",
    "server/eval/cases/ 只有 6 個 eval case，純 pass/fail。",
    "改任何 prompt / planner / tool 都容易壞別的功能，現有 case 覆蓋不到 prompt injection / quota exhaustion / cross-provider / replan quality / collab。",
    "回歸風險高、無法量化「我們有沒有變強」。",
    "擴張到 30+ case 分 9 類，新增 AgentEvalPareto 多目標分析 JSON 輸出，加 CLI flag --category 與 --output。",
    [
        "server/eval/cases/（從 6 個擴張到 30+，分 9 個子目錄）",
        "shared/agent-eval.ts（AgentEvalCase / AgentEvalResult / AgentEvalPareto 介面擴充）",
        "server/eval/runEval.ts（CLI flags、Pareto 輸出）",
        "reports/（新增目錄存 Pareto JSON 歷史）",
    ],
    """請依照計畫附錄 B.3 實作 A-P1-5 / O-P1-1 Eval 框架升級：

【第 1 部分：介面擴展】
1. 修改 shared/agent-eval.ts：

```typescript
export interface AgentEvalCase {
  id: string;
  description: string;
  category: "basic"|"injection"|"quota"|"failover"|"replan"|"collab"|"regression"|"compliance"|"a11y";
  pageId: string;
  userMessage: string;
  attachments?: PlannerMultimodalPartSummary[];
  expectedPlanProperties: {
    minSteps?: number;
    maxSteps?: number;
    requiredActionTypes?: string[];
    forbiddenActionTypes?: string[];
    expectedRouting?: Partial<AgentPlanRouting>;
    shouldNotBeBlocked?: boolean;
    shouldBeBlocked?: boolean;
    expectedSpecialistAgent?: string;
  };
  executeStep?: {
    allowExecution?: boolean;
    expectedOutcome?: "success"|"failure"|"partial";
    timeoutMs?: number;
  };
  tags?: string[];
}

export interface AgentEvalResult {
  caseId: string;
  category: string;
  passed: boolean;
  score: number;
  violations: string[];
  pareto: { plannedSteps: number; estimatedTokens: number; estimatedCost: number };
}

export interface AgentEvalPareto {
  frontierCases: Array<{ caseId; score; plannedSteps; estimatedTokens; estimatedCost; dominated: string[] }>;
  overallMetrics: { caseCount; avgScore; stdDev; percentile95 };
}
```

【第 2 部分：補 24+ 案例】
2. 在 server/eval/cases/ 新增子目錄 + 案例（合計補到 30+）：
   - PROMPT_INJECTION (5)：忽略前指令、SQLi 風格、提示外洩、模型偽冒、使用者冒充
   - QUOTA_EXHAUSTION (3)：單次超額、DDoS-style burst、超時恢復
   - CROSS_PROVIDER_FAILOVER (4)：FAL→Gemini、ElevenLabs 配額滿→替代、多模型備援、部分結果可用
   - REPLAN_QUALITY (6)：計畫不符意圖、步驟順序錯、工具選錯、參數映射錯、收斂性、規劃時間超閾
   - MULTI_AGENT_COLLABORATION (5)：訊息傳遞、角色衝突、共享記憶、async timeout、agent failover
   - REGRESSION (8)：LLM 降級退化、API schema 變更、cache 失效、並行競爭、狀態機異常、資源耗盡、長會話穩定性、邊界值
   - COMPLIANCE (3)：GDPR 刪除、年齡驗證、地理限制

【第 3 部分：runEval CLI】
3. 修改 server/eval/runEval.ts：
   - 加 yargs/commander 解析 --category --output --tags
   - 跑所有 case 後輸出 Pareto frontier JSON 到 --output 指定路徑
   - 每次跑完寫 reports/eval-YYYY-MM-DD.json（歷史追蹤）

【第 4 部分：CI 整合】
4. 在 package.json scripts 加：
   - "eval:run": "ts-node server/eval/runEval.ts"
   - "eval:injection": "ts-node server/eval/runEval.ts --category=injection"
   - "eval:pareto": "ts-node server/eval/runEval.ts --output=reports/pareto-$(date +%Y-%m-%d).json"

5. 在 CI 設定（如 GitHub Actions）每次 PR 自動跑 eval 並貼 Pareto 圖到 PR comment。

不要做的事：不要做 LLM-as-judge 評分（屬未來擴張，需要 baseline）。不要把 eval 當作生產阻擋（只是迴歸保護）。不要包含真實使用者資料（隱私）。""",
    "npm run eval 跑 30+ case < 10 分鐘。reports/pareto-YYYY-MM-DD.json 產出含 frontierCases 與 overallMetrics。PR comment 看到 Pareto 圖。故意 break 某個 planner 邏輯 → eval injection / replan 類別應紅。",
    "6-8 天")

add(20, "優化", "Job 面板", "看不到背景任務狀態", "O-P1-2",
    "12 個排程任務（apiHealthMonitor / r2SnapshotJob / newsFetcher 等）只能看伺服器 log。",
    "「今天有失敗的任務嗎？」要工程師 ssh 進去 grep log。",
    "運維困難、出問題反應慢。",
    "新增 admin tRPC endpoints + Admin 頁面新增「jobs」tab，顯示背景任務列表 + 排程工作 + 估計剩餘時間。",
    [
        "server/routers/adminRouter.ts（新增 jobs.listBackground / jobs.cronMap query）",
        "client/src/pages/AdminPage.tsx（新增 jobs tab）",
        "client/src/components/admin/JobsPanel.tsx（新增）",
        "shared/job-types.ts（estimateRemainingMs helper）",
    ],
    """請依照計畫附錄 B.5 實作 O-P1-2 Job Dashboard：

【第 1 部分：tRPC endpoints】
1. 在 server/routers/adminRouter.ts 新增兩個 query：

```typescript
adminRouter
  .query("jobs.listBackground", {
    input: z.object({ limit: z.number().default(50), offset: z.number().default(0), status: z.enum(["queued","processing","completed","failed","cancelled"]).optional(), userId: z.number().optional() }),
    async resolve({ input, ctx }) {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "UNAUTHORIZED" });
      const jobs = await db.query.backgroundJobs.findMany({
        where: and(input.status ? eq(backgroundJobs.status, input.status) : undefined, input.userId ? eq(backgroundJobs.userId, input.userId) : undefined),
        limit: input.limit, offset: input.offset,
        orderBy: desc(backgroundJobs.updatedAt),
      });
      return { jobs: jobs.map((j) => ({ ...j, estimatedRemainingMs: estimateRemainingMs(j) })), total: await db.query.backgroundJobs.count() };
    },
  })
  .query("jobs.cronMap", {
    async resolve({ ctx }) {
      if (ctx.user?.role !== "admin") throw new TRPCError({ code: "UNAUTHORIZED" });
      const scheduled = await db.query.orbScheduledJobs.findMany();
      return { jobs: scheduled.map((j) => ({ ...j, nextRunAt: computeNextCronTime(j.cronExpression) })) };
    },
  });
```

2. 新增 estimateRemainingMs helper：

```typescript
const AVG_DURATION_MS: Record<JobType, number> = {
  imageGen: 12_000,
  videoGen: 180_000,
  audioGen: 30_000,
  loraTraining: 1_200_000,
};
function estimateRemainingMs(job): number {
  const avg = AVG_DURATION_MS[job.jobType] ?? 60_000;
  const elapsed = Date.now() - job.createdAt.getTime();
  return Math.max(0, avg - elapsed);
}
```

【第 2 部分：UI】
3. 修改 client/src/pages/AdminPage.tsx 新增 "jobs" tab。

4. 新增 client/src/components/admin/JobsPanel.tsx：
   - 上方：3 個 StatCard（進行中 / 今日完成 / 失敗未處理）
   - 中段：DataTable backgroundJobs 列表（id、jobType、progress、status、createdAt、estimatedRemainingMs，附狀態徽章）
   - 下段：DataTable orbScheduledJobs 列表（cronExpression、enabled、lastRunAt、lastRunStatus、nextRunAt）

5. 用既有 GlassCard / DataTable / Badge 元件，配色 Morandi OKLCH。

不要做的事：不要做「重試失敗任務」功能（手動操作，屬未來擴張）。不要顯示 sensitive metadata（過濾掉使用者密鑰）。不要直接顯示原始 JSON（用 DataTable formatter）。""",
    "登入 admin 帳號 → AdminPage 新「jobs」tab → 看到當前進行中的背景任務、過去 24h 完成 / 失敗統計、12 個 cron 工作下次執行時間。手動觸發一個 imageGen 任務 → 看到 progress 即時更新。",
    "4-5 天")

add(21, "優化", "斷路器面板", "看不到 AI 服務當機", "O-P1-3",
    "斷路器（circuit breaker）邏輯有，狀態散落在記憶體。",
    "server/jobs/circuitBreaker.ts 自動修復但無 UI；使用者反映「ElevenLabs 不能用」要等開發者去看 log。",
    "故障診斷慢、運維反應差。",
    "暴露 circuitBreakerRegistry 全域 Map + 新增 tRPC 暴露 + admin 頁加面板 + 強制重置按鈕。",
    [
        "server/jobs/circuitBreaker.ts（暴露 registry Map）",
        "server/routers/adminRouter.ts（system.circuitBreakers query + resetCircuitBreaker mutation）",
        "client/src/pages/AdminPage.tsx（新增 system tab）",
        "client/src/components/admin/CircuitBreakerPanel.tsx（新增）",
    ],
    """請依照計畫附錄 B.6 實作 O-P1-3 Circuit Breaker UI：

【第 1 部分：暴露 registry】
1. 修改 server/jobs/circuitBreaker.ts，新增全域：

```typescript
export const circuitBreakerRegistry = new Map<string, CircuitBreaker>();
export function getCircuitBreakerRegistry() { return circuitBreakerRegistry; }
```

確保所有 CircuitBreaker 建構時自動註冊到此 Map（key = breaker name）。

【第 2 部分：tRPC】
2. 在 server/routers/adminRouter.ts 新增：

```typescript
adminRouter
  .query("system.circuitBreakers", async ({ ctx }) => {
    if (ctx.user?.role !== "admin") throw new TRPCError({ code: "UNAUTHORIZED" });
    const reg = getCircuitBreakerRegistry();
    return {
      breakers: Array.from(reg.values()).map((cb) => ({
        name: cb.name, state: cb.getState(),
        metadata: {
          failureThreshold: cb.failureThreshold,
          cooldownMs: cb.cooldownMs,
          consecutiveFailures: cb.consecutiveFailures,
          lastFailureTime: cb.lastFailureTime,
          secondsUntilProbe: cb.getState() === "OPEN" ? Math.max(0, Math.ceil((cb.lastFailureTime + cb.cooldownMs - Date.now()) / 1000)) : 0,
        },
      })),
      globalHealthScore: calculateHealthScore(reg),
    };
  })
  .mutation("system.resetCircuitBreaker", { input: z.object({ name: z.string() }), async resolve({ input, ctx }) {
    if (ctx.user?.role !== "admin") throw new TRPCError({ code: "UNAUTHORIZED" });
    const cb = getCircuitBreakerRegistry().get(input.name);
    if (!cb) throw new TRPCError({ code: "NOT_FOUND" });
    cb.recordSuccess();
    await appendAuditLog({ userId: ctx.user.id, action: "circuit_breaker_reset", resource: input.name });
  }});
```

3. 實作 calculateHealthScore(registry) — 例如所有 CLOSED 為 100、每個 HALF_OPEN -10、OPEN -30，clamp [0, 100]。

【第 3 部分：UI】
4. 新增 client/src/components/admin/CircuitBreakerPanel.tsx：
   - 頂部 Health bar：globalHealthScore（>80 綠 / >50 黃 / 其他紅）
   - Per-breaker card：name + state badge + countdown（OPEN 狀態顯示「X 秒後嘗試恢復」） + 連續失敗 + 強制重置按鈕（OPEN 才出現）
   - Alert section：若任何 breaker !== CLOSED，紅色警示橫幅

5. 整合到 AdminPage 「system」tab。

6. 自動 refresh：每 10 秒重新 query。

不要做的事：不要把 CB 邏輯改成「永久關閉」（保留 HALF_OPEN 自動探測）。不要對非 admin 暴露細節（OAuth flow / 密鑰名稱）。不要做「手動觸發失敗」測試按鈕（風險高）。""",
    "Admin 頁開 system tab → Health bar 顯示 100/100 全綠。模擬一家 AI 服務當機（mock API 5xx 多次）→ 看到對應 breaker 變黃 → 達閾值變紅，countdown 開始倒數。按「強制重置」→ 變綠。",
    "3-4 天")

add(22, "優化", "軟刪除", "誤刪無法救回", "D-P0-2",
    "刪除就是直接從資料庫 DELETE。",
    "無 deletedAt 欄位、無 GDPR 合規入口、誤刪只能 from backup 救（沒做 PITR）。",
    "使用者誤刪一個專案就永久消失、客服處理困難、GDPR 風險。",
    "對 12 張關鍵表加 deletedAt 欄位、新增 whereActive helper、Repository 預設套用 filter、新增 GDPR DSR endpoint + 30 天硬刪 worker。",
    [
        "drizzle/migrations/00XX_soft_delete_columns.sql（新增）",
        "drizzle/schema.ts（12 張表加 deletedAt）",
        "server/repositories/base/SoftDelete.ts（新增 whereActive / softDelete helper）",
        "server/routes/dsr.ts（新增 POST /api/account/dsr-erase）",
        "server/jobs/gdprPurgeWorker.ts（新增 30 天硬刪 worker）",
    ],
    """請依照計畫附錄 A.9 實作 D-P0-2 軟刪除 + GDPR 入口：

【第 1 部分：Schema 加欄位】
1. 新增 migration drizzle/migrations/00XX_soft_delete_columns.sql（取下一可用編號）：

對下列 12 張表各加 deleted_at TIMESTAMP NULL 與 INDEX idx_xxx_deleted_at (deleted_at)：
- users
- agentCollaborationSessions
- orbConversations
- orbConversationMessages
- orbLongTermMemories
- generationHistory
- digitalAssetLibrary
- fineTunedModels
- orbScheduledJobs
- teachingMaterials
- projectNotesCalendar
- featuredShowcase

ALTER TABLE 不設 default（避免鎖表）：
```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL;
CREATE INDEX idx_users_deleted_at ON users (deleted_at);
-- 其餘 11 張同樣 pattern
```

2. 修改 drizzle/schema.ts 對應 12 張表加 deletedAt: timestamp("deleted_at")。

【第 2 部分：helper】
3. 新增 server/repositories/base/SoftDelete.ts：

```typescript
import { sql, type SQL } from "drizzle-orm";

export function whereActive<T extends { deletedAt: any }>(tb: T): SQL {
  return sql`${tb.deletedAt} IS NULL`;
}

export async function softDelete<T extends { deletedAt: any }>(table: T, whereClause: SQL, db: DrizzleDB) {
  await db.update(table).set({ deletedAt: new Date() }).where(whereClause);
}
```

【第 3 部分：repository 預設套用】
4. 修改既有 repository（UserAuthRepository、SpiritMemoryRepository 等）的 find / list 方法：預設套 whereActive(table)。對需要看到被軟刪除資料的場景（admin / restore flow）提供顯式 opt-out。

【第 4 部分：GDPR DSR endpoint】
5. 新增 server/routes/dsr.ts：

```typescript
POST /api/account/dsr-erase
Auth required.
Steps:
1. 軟刪 users + 所有 user-owned 列（透過 cascade 或顯式逐表）
2. 排程 30 天後 hard-delete worker（寫一筆 task 到 backgroundJobs 表，jobType="gdpr_purge", scheduledFor=Date.now()+30天）
3. appendAuditLog({ userId, action: "dsr_erase_initiated", details: { scheduledPurgeAt } })
4. 回傳 confirmation + 撤回 link（30 天內可呼叫 dsr-revoke）
```

【第 5 部分：硬刪 worker】
6. 新增 server/jobs/gdprPurgeWorker.ts（cron 每日 03:00）：
   - 找所有 gdpr_purge task scheduledFor < now()
   - 對每個對象實際 DELETE FROM 所有 user-owned 表（不能再回滾）
   - 寫 audit log gdpr_purge_completed

不要做的事：不要在 DELETE FROM 上加觸發器自動軟刪（複雜、容易出 bug）。不要對「無使用者主權」的表加軟刪（如 newsArticles）。不要實作 hard restore（軟刪後刪除 deletedAt 即可）。""",
    "建一個測試帳號 → 建一個 generation → 呼叫 DELETE → 看 SQL：該 row 仍存在但 deletedAt IS NOT NULL → UI 看不到。修改 deletedAt = NULL → UI 又看到。呼叫 dsr-erase → 30 天後 hard delete 真正清除。",
    "3-4 天")

add(23, "優化", "簽名連結", "媒體連結直接暴露", "S-P0-2 / S-P0-3",
    "所有人拿到 R2 / GCS 連結都能直接看。",
    "server/storage.ts 內 s3Upload / gcsUpload 只回公開 URL，未實作 signed URL。S3 versioning 未開、無 lifecycle policy。",
    "使用者「私人草稿」可能被連結外流。誤覆寫無法救回。",
    "新增 getSignedAssetUrl() 中介層、對外永遠經此拿短期簽名連結（15 min）。手動開啟 S3 versioning + 對 tmp/ failed/ 設 7 天 TTL。",
    [
        "server/services/internalMedia.ts（新增 getSignedAssetUrl）",
        "server/storage.ts（s3SignUrl / gcsSignUrl helper）",
        "server/routers.ts（既有對外 asset 端點全部改用 getSignedAssetUrl）",
        "scripts/setup-bucket-lifecycle.sh（新增 idempotent 套用工具）",
    ],
    """請依照計畫附錄 A.12 與 A.13 實作 S-P0-2 簽名 URL 中介 + S-P0-3 bucket 設定：

【第 1 部分：signed URL】
1. 在 server/services/internalMedia.ts 新增：

```typescript
export async function getSignedAssetUrl(relKey: string, expiresInSec = 900): Promise<string> {
  const provider = detectStorageProvider();
  if (provider === "s3") return s3SignUrl(relKey, expiresInSec);
  if (provider === "gcs") return gcsSignUrl(relKey, expiresInSec);
  return getPublicUrl(relKey);  // local fallback
}
```

2. 在 server/storage.ts 實作 s3SignUrl 與 gcsSignUrl：
   - S3：用 @aws-sdk/s3-request-presigner 的 getSignedUrl
   - GCS：用 @google-cloud/storage 的 file.getSignedUrl({ version: 'v4', action: 'read', expires: now+expiresInSec*1000 })

3. 修改所有對外 API 端點（asset list、history detail、generation result 等），把直接吐 bucket URL 的地方換成 getSignedAssetUrl(assetId, 900)。對敏感資源（私人草稿、未公開 LoRA）改為 300（5 min）。

4. 確認前端載入流程：圖片 / 影片 / 音檔每次都呼叫 API 拿新 signed URL，不要 cache 過長時間（避免 URL 過期前圖片仍掛著但已不可用）。

【第 2 部分：S3 versioning + lifecycle】
5. 新增 scripts/setup-bucket-lifecycle.sh（idempotent，CI 可重跑）：

```bash
#!/bin/bash
# Open versioning
aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled

# Lifecycle policy
cat <<EOF > /tmp/bucket-lifecycle.json
{
  "Rules": [
    { "ID": "expire-tmp", "Filter": { "Prefix": "tmp/" }, "Status": "Enabled", "Expiration": { "Days": 7 } },
    { "ID": "expire-failed", "Filter": { "Prefix": "failed/" }, "Status": "Enabled", "Expiration": { "Days": 7 } },
    { "ID": "old-versions", "Status": "Enabled", "NoncurrentVersionExpiration": { "NoncurrentDays": 90 } }
  ]
}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET --lifecycle-configuration file:///tmp/bucket-lifecycle.json
```

6. 修改 internalMedia.ts:classifyByKey 確保失敗 / 暫存任務分別寫到 failed/ 與 tmp/ prefix。

不要做的事：不要做 CDN 整合（屬第 33 條未來擴張）。不要對「公開資產」（公開 showcase）做 signed URL（會破壞分享功能）。不要把 signed URL 過期時間設太短（< 5 min 會破壞使用者瀏覽體驗）。""",
    "在前端開啟一張私人圖 → 開 DevTools Network 看 src URL 含 X-Amz-Signature 或 X-Goog-Signature → 15 分鐘後再用同 URL → 403 Forbidden。Bucket console 看到 versioning enabled、tmp/ 7 天 expiration rule。",
    "2-3 天")

add(24, "優化", "視覺舒適", "預設動畫太強眼睛累", "V-P0-1 / V-P0-2 / V-P0-3",
    "光球、四季背景對所有人用同等強度。系統「減少動態效果」偏好沒套用。無自動深色模式、無閱讀模式。",
    "useMotionPreference hook 待建。next-themes 已用但無時段判斷。Reader Mode 無 CSS layer。",
    "與「Healing」品牌承諾不符、長時間使用眼睛累。",
    "三件事：(1) prefers-reduced-motion 全站套用、(2) 自動 dark mode（時段 19:00-07:00）、(3) Reader Mode CSS layer（長文章頁加按鈕）。",
    [
        "client/src/_core/animation.ts（已在第 14 條建立 useMotionPreference）",
        "client/src/_core/theme.ts（新增 useAutoDarkMode）",
        "client/src/index.css（新增 .reader-mode CSS layer）",
        "client/src/components/ReaderModeToggle.tsx（新增）",
        "client/src/pages/LearnHubPage.tsx / NotesPage.tsx / TeachingMaterialPage.tsx（加 Reader Mode 按鈕）",
    ],
    """請依照計畫附錄 D.2 / D.3 / D.4 實作 V-P0-1 / V-P0-2 / V-P0-3 視覺舒適：

⚠️ 前置：第 14 條（useMotionPreference）已建。

【第 1 部分：prefers-reduced-motion 全站】
1. 確認 client/src/_core/animation.ts 的 useMotionPreference 與 MotionConfig（第 14 條已建）正常運作。

2. 第 14 條已套到 AmbientEnvironment / VisualSoul / JewelOrbStage。本步補：所有 Framer Motion 用點包根節點 <MotionConfig reducedMotion="user">（已含在第 14 條的工作）。

【第 2 部分：自動 dark mode】
3. 新增 client/src/_core/theme.ts：

```typescript
import { useTheme } from "next-themes";
import { useEffect } from "react";

const AUTO_DARK_START_HOUR = 19;
const AUTO_DARK_END_HOUR = 7;

export function useAutoDarkMode(enabled: boolean) {
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const h = new Date().getHours();
      const shouldDark = h >= AUTO_DARK_START_HOUR || h < AUTO_DARK_END_HOUR;
      const target = shouldDark ? "dark" : "light";
      if (theme !== target && theme !== "system") setTheme(target);
    };
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [enabled, theme, setTheme]);
}
```

4. 在 next-themes provider 加 "auto-time" 為第四種選項（除 system / dark / light）。

【第 3 部分：Reader Mode】
5. 在 client/src/index.css 新增 layer：

```css
@layer reader {
  .reader-mode {
    --reader-max-width: 68ch;
    --reader-font-size: clamp(1rem, 1.05rem + 0.2vw, 1.1875rem);
    --reader-line-height: 1.78;
    --reader-letter-spacing: 0.012em;
    --reader-margin-y: clamp(2rem, 4vw, 4rem);
    max-width: var(--reader-max-width);
    margin-inline: auto;
    padding-block: var(--reader-margin-y);
    font-size: var(--reader-font-size);
    line-height: var(--reader-line-height);
    letter-spacing: var(--reader-letter-spacing);
    color: oklch(0.32 0.012 250);
  }
  .reader-mode :is(h1, h2, h3) { letter-spacing: 0.018em; }
  .reader-mode p + p { margin-top: 1.2em; }
  .reader-mode pre { font-size: 0.92em; line-height: 1.55; }
}

@media (prefers-color-scheme: dark) {
  .reader-mode { color: oklch(0.86 0.012 250); }
}
```

6. 新增 client/src/components/ReaderModeToggle.tsx：簡單 toggle button，點擊切換父容器是否套 .reader-mode className。

7. 在以下頁面 toolbar 加 ReaderModeToggle：
   - client/src/pages/LearnHubPage.tsx
   - client/src/pages/NotesPage.tsx
   - client/src/pages/TeachingMaterialPage.tsx
   - client/src/pages/NewsArticlePage.tsx（若存在）

不要做的事：不要做 night shift / 色溫調整（屬未來擴張 V-P1-2）。不要做 20-20-20 microbreak（屬未來擴張）。不要對所有頁套 reader-mode（只長文章頁）。""",
    "系統「減少動態效果」偏好開啟 → 光球變靜態 / 四季背景無粒子。19:00 後打開網站 → 5 分鐘內自動切深色（Settings 設 auto-time 模式）。LearnHub 點 Reader 按鈕 → 主內容套寬行距 + 柔色背景。",
    "2-3 天")

add(25, "優化", "視覺總開關", "舒適設定散落多處", "V-P0-4",
    "上述舒適設定散在不同地方（系統偏好 / Settings / next-themes）。",
    "使用者要逐項找，不知道有哪些可調。",
    "沒有「一鍵啟用完整 healing 體驗」入口、配置不集中。",
    "Settings 頁新增「🌿 視覺健康」panel，集中五個 toggle + 一個 slider，全部寫進 agentPreferences.visionWellness。",
    [
        "client/src/pages/SettingsPage.tsx（加 VisionWellnessPanel）",
        "client/src/components/settings/VisionWellnessPanel.tsx（新增）",
        "client/src/contexts/VisionWellnessContext.tsx（新增，狀態集中管理）",
        "shared/agent-preferences.ts（加 visionWellness 欄位）",
    ],
    """請依照計畫附錄 D.5 實作 V-P0-4 Vision Wellness Settings panel：

⚠️ 前置：第 14、15、24 條的 hook（useMotionPreference、tier、useAutoDarkMode）已建。

【第 1 部分：Schema】
1. 修改 shared/agent-preferences.ts 加 visionWellness 欄位：

```typescript
visionWellness?: {
  autoDarkMode: boolean;           // V-P0-2
  animationTier: AnimationTier;    // V-P1-3 / 第 15 條
  readerModeDefault: boolean;      // V-P0-3
  reducedMotionEnforce?: boolean;  // 強制（覆蓋系統偏好）
};
```

2. 後端：在 users.userPreferences JSON 欄位內加 visionWellness key（不需新 migration，JSON 欄位可塞）。

【第 2 部分：Context】
3. 新增 client/src/contexts/VisionWellnessContext.tsx：
   - 暴露 animationTier / autoDarkMode / readerModeDefault 與對應 setter
   - 持久化到 localStorage + 同步寫 agentPreferences.visionWellness API
   - 載入時優先從 agentPreferences 取，fallback 到 localStorage、再 fallback 預設值

4. 在 client/src/App.tsx 根節點包 <VisionWellnessProvider>。

【第 3 部分：Panel UI】
5. 新增 client/src/components/settings/VisionWellnessPanel.tsx：

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">🌿 視覺健康（Vision Wellness）</CardTitle>
    <CardDescription>Healing Studio 的核心承諾：使用後感到放鬆而非疲憊。</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <ToggleRow label="自動深色模式" hint="日落後自動切換到深色配色" value={autoDark} onChange={setAutoDark} />
    <ToggleRow label="閱讀模式（預設啟用）" hint="長文章自動套大字級 + 寬行距" value={readerDefault} onChange={setReaderDefault} />
    <ToggleRow label="尊重系統「減少動態效果」偏好" hint="眼睛舒適優先" value={reducedMotion} onChange={setReducedMotion} />
    <SliderRow label="背景動畫強度" min={0} max={3} step={1} ticks={["關閉", "微妙", "標準", "沉浸"]} value={tierIdx} onChange={setTier} />
    <Separator />
    <Button variant="ghost" onClick={resetToDefaults}>恢復健康預設值</Button>
  </CardContent>
</Card>
```

6. 在 client/src/pages/SettingsPage.tsx 加入 <VisionWellnessPanel />（建議放在「外觀」section）。

【第 4 部分：與第 14、15、24 條的 hook 串連】
7. 各 hook（useMotionPreference / useAnimationTier / useAutoDarkMode / useReaderModeDefault）改為從 VisionWellnessContext 讀設定，而非直接讀 localStorage。

不要做的事：不要做 night shift（屬未來擴張）。不要做 microbreak 20-20-20（屬未來擴張）。不要做環境光感應（屬未來擴張）。不要對所有 Setting 重新設計（只新增此 panel）。""",
    "Settings 頁看到 🌿 視覺健康 panel。切換動畫強度滑桿到「微妙」→ 立刻看到光球變慢、四季背景粒子少。重新整理頁面 → 設定仍在（從 agentPreferences 還原）。",
    "2 天")

# ============ Item 26：語音對話進階階段 B/C =================================

add(26, "新增", "語音進階", "語音對話進階體驗（階段 B / C）", "VA-P1 / VA-P2 部分",
    "MVP（第 5 條）完成後，使用者體驗自然度仍不及 ChatGPT Advanced Voice / Gemini Live。",
    "MVP 須按住麥克風講話、機器在說時不能打斷、跨會話不記得上次說過什麼、混語對話 TTS 不會切引擎。",
    "對話不夠自然，使用者用一次就覺得「還是要打字」。",
    "三件事（分階段）：(B) VAD 自動偵測說完 + barge-in 中斷 + 多輪會話記憶；(C) 中英混語自動切 TTS、Wake word「嘿暖暖」、個人聲線預設。階段 C 可砍。",
    [
        "client/src/hooks/useSileroVad.ts（新增）",
        "server/voice/voiceStreamingTranscriber.ts（新增）",
        "server/voice/voiceInterruptionHandler.ts（新增）",
        "server/voice/voiceHistoryManager.ts（新增）",
        "client/src/hooks/useWakeWord.ts（新增，C 階段）",
        "server/voice/voiceMultimodalIntake.ts（新增）",
    ],
    """請依照計畫附錄 E.6 / E.7 / E.8 / E.10 / E.12 / E.13 實作 VA-P1 / VA-P2 語音進階：

⚠️ 前置：第 5 條（語音 MVP）必須先完成。

【階段 B（建議做）】

【B-1：STT streaming + 語意 VAD（VA-P1-1）】
1. 新增 server/voice/voiceStreamingTranscriber.ts，匯出 createTranscriber(provider: "gemini-live" | "elevenlabs-realtime"): StreamingTranscriber 介面，含 feedAudio / flush / onPartial / onFinal / cancel 方法。
   - Gemini Live：用 @google/genai 的 live.connect() API
   - ElevenLabs：WebSocket 連 wss://api.elevenlabs.io/v1/speech-to-text/stream
2. 在 voiceAgentSession 改為串流模式（不是按完一次才轉錄）。
3. 新增 client/src/hooks/useSileroVad.ts，用 @ricky0123/vad-web（Silero WebAssembly）：偵測 800ms 靜音 → 觸發 end-utterance；偵測說話開始 → emit speech-start（給 barge-in 用）。

```typescript
export function useSileroVad(stream: MediaStream | null, onSpeechEnd: () => void) {
  useEffect(() => {
    if (!stream) return;
    let vad: any;
    (async () => {
      const { MicVAD } = await import("@ricky0123/vad-web");
      vad = await MicVAD.new({
        stream,
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: 0.35,
        minSpeechFrames: 5,
        redemptionFrames: 12,
        onSpeechEnd,
      });
      vad.start();
    })();
    return () => vad?.destroy();
  }, [stream, onSpeechEnd]);
}
```

【B-2：Barge-in（VA-P1-2）】
4. 新增 server/voice/voiceInterruptionHandler.ts，維護 Map<orbTraceId, AbortController>，cancel() 觸發所有 in-flight abort（包含 TTS stream、tool execution）。
5. 前端 useOrbVoice 在收到 speech-start 時 emit {type: "interrupt"} 給 WebSocket、同時呼叫 useAudioPlayback.cancel() 清空播放佇列。
6. 確認 MediaRecorder constraints echoCancellation: true（防止機器自己 TTS 觸發 VAD）。

【B-3：多輪會話記憶（VA-P1-3）】
7. 新增 server/voice/voiceHistoryManager.ts：每個 voice turn 寫入既有 orbConversations + orbConversationMessages 表（含 mediaType: "voice"、audioUrl）。
8. 下次 dispatch 前撈最近 10 條 messages 注入 planner system prompt：

```typescript
const memory = await voiceHistoryManager.getRecentTurns(session.userId, session.orbTraceId, 10);
const memorySummary = memory.map((t) => `${t.role}: ${t.text}`).join("\\n");
plannerSystemPrompt += `\\n\\n# 本次語音會話歷史\\n${memorySummary}`;
```

【B-4：多語言混語 TTS 自動切（VA-P1-5）】
9. 在 voiceAgentOrchestrator 增加 splitByLanguage(text) 把 TTS 回應依語言分段。
10. 每段用既有 voiceSpecialistTools:pickTtsEngine(lang) 選引擎：zh/ja/ko → Qwen、en/es/fr/de → ElevenLabs V3、其他 → ElevenLabs Multilingual V2。
11. server 端依序 stream 多 TTS engine 結果到同 WebSocket。

【階段 C（可選做，時程吃緊可砍）】

【C-1：Wake word（VA-P2-1）】
12. 新增 client/src/hooks/useWakeWord.ts，用 @picovoice/porcupine-web：
   - 本地 WebAssembly 偵測「嘿暖暖」（在 Picovoice Console 訓練）
   - 預設關閉，Settings 必須使用者明確開啟
   - 偵測完全本地、不傳音訊到 server
   - 喚醒後顯示「🌿 暖暖在聽…」3 秒無人聲自動關閉

【C-2：個人聲線預設（VA-P2-2）】
13. 在 agentPreferences 新增 voicePreferences: { defaultAssistantVoiceId?: string; defaultLanguageVoiceMap?: Record<string, string>; }
14. 使用者首次訓練聲線完成 → toast「要把暖暖的聲音換成你自己的嗎？」
15. 接受 → 寫 defaultAssistantVoiceId、之後 voiceAgentOrchestrator 用此 voiceId。

不要做的事：不要做 emotion-adaptive TTS（屬季度級工程）。不要做 voice-only Studio 完整模式（依賴 V-P2 全套未做）。不要做離線本地 fallback。""",
    "階段 B：使用者不用按按鈕，說完 800ms 自動觸發轉錄。機器在說的時候開口立即停（< 200ms）。下次連線記得「上次說的森林風」。中英混語自動切引擎、無不自然停頓。階段 C：「嘿暖暖」喚醒可用、個人聲線可設為預設。",
    "10-15 天")

# ============ 未來擴張類（第 27-36 項）======================================

add(27, "未來", "MCP 化", "把工具 USB 化", "A-P2-1",
    "你的網站有 60 多個 AI 工具（圖圖、影影、聲聲等精靈能做的事），但只能在你的網站內呼叫。",
    "server/services/agentToolExecutor.ts 既有的 tool spec 是自有格式，無業界標準介面。",
    "別人裝了 Claude Desktop / Cursor 的人無法呼叫你的精靈、你也用不到別人的 MCP 工具。",
    "把 60+ 工具按精靈分組，包裝成 5 個 MCP server（image-specialist / video-specialist / voice-specialist / music-specialist / director），用標準 MCP 介面 expose。同時 healing-studio 也能 consume 外部 MCP（Notion / GitHub / Filesystem）。",
    [
        "server/services/mcp/（新目錄）",
        "server/services/mcp/specToMcpDescriptor.ts（自動轉換 tool spec）",
        "server/services/mcp/image-specialist-mcp.ts 等 5 個 MCP server",
        "server/services/agentToolExecutor.ts（重用）",
        "server/services/mcpClient.ts（消費外部 MCP）",
    ],
    """請依照計畫附錄 C.10 實作 A-P2-1 MCP 化代理工具集：

⚠️ 這是季度級工程，預估 6-8 週。建議先完成第 1-26 條再做。

【第 1 部分：spec 自動轉換】
1. 新增 server/services/mcp/specToMcpDescriptor.ts：把既有 agentToolExecutor.ts 的 tool spec（OrbApiTool format）自動轉成 MCP tool descriptor 格式。讀 既有 server/services/agentToolExecutor.ts 內所有 tool 定義作為 source。

【第 2 部分：5 個 MCP server】
2. 在 server/services/mcp/ 內新增 5 個 MCP server（用 @modelcontextprotocol/sdk）：
   - image-specialist-mcp.ts：generateImage / upscale / edit / recommend
   - video-specialist-mcp.ts：generateVideo / enhanceVideo / animateSpeaker
   - voice-specialist-mcp.ts：cloneVoice / generateVoice / designVoice
   - music-specialist-mcp.ts：generateAudio / generateSfx / separateStems
   - director-mcp.ts：所有上述 + orchestration

3. Authentication：每個 MCP server 持 VALID_SESSION_TOKENS env var 清單，呼叫端 header 帶 x-mcp-token。director-mcp 用 JWT (sub=agent-id) 與內部 router 共用。

4. Deployment 設計：
   - 同 process：director-mcp（頻繁呼叫、低延遲）
   - Sidecar（VM/K8s same pod）：image/video/voice/music specialists（資源隔離）

【第 3 部分：外部 MCP 消費】
5. 新增 server/services/mcpClient.ts：能 connect 外部 MCP server（用 MCP SDK 的 client API）。
6. 在 agentToolExecutor 加 MCP tool source：除自有 tool 外，可從註冊的外部 MCP server 取得工具，整合到 25 精靈可呼叫的工具池。
7. 範例：接 Notion MCP、GitHub MCP、Filesystem MCP，讓「記記」精靈可寫 Notion、「導導」可看 GitHub PR。

【第 4 部分：文件 & 測試】
8. 撰寫 docs/agent/MCP_SERVER_GUIDE.md，說明如何用 Claude Desktop / Cursor 接 healing-studio MCP。
9. 補一條 e2e 測試：跑外部 MCP client 呼叫 healing-studio image-specialist-mcp，正確生成圖。

不要做的事：不要重寫 agentToolExecutor 內部邏輯（複用 dispatch）。不要把 MCP 當作唯一介面（保留 tRPC / WebSocket 對前端）。不要做工具計費 / billing over MCP（屬企業需求，未來再做）。""",
    "在 Claude Desktop 設定加 healing-studio image-specialist MCP server URL → 在 Claude 對話中說「用我的 healing studio 生一張森林晨霧圖」→ Claude 呼叫 MCP → healing-studio 真的生圖 → 結果 URL 顯示。反向：healing-studio 「記記」精靈能把資料寫進你的 Notion。",
    "6-8 週")

add(28, "未來", "Computer Use", "給精靈一雙能上網的手", "A-P2-2",
    "精靈只能在你的網站內動作。",
    "server/services/agentToolExecutor.ts 無 browser tool。shared/orb-perception-loop.ts 僅針對自家 page state。",
    "「導導」想幫你截圖競品、創作完想自動發 IG / Threads 都做不到。",
    "新增 BrowserAgent 精靈，用 Anthropic Computer Use beta + Playwright，能 takeScreenshot / click / type / submitForm / scroll。",
    [
        "server/services/browserAgent.ts（新增）",
        "shared/orb-agent-roles.ts（新增 browser-executor 角色）",
        "shared/orb-perception-loop.ts（抽象出 Observable 介面）",
        "package.json（加 playwright 依賴）",
    ],
    """請依照計畫附錄 C.11 實作 A-P2-2 Computer Use / Browser tool：

⚠️ 季度級工程，6-8 週。**前置：必須先做 Prompt shield 模型化**（屬「完全不做」清單）— 沒有 prompt shield 不要做 Computer Use（會被惡意網頁劫持）。

【第 1 部分：工具層】
1. 安裝 playwright 依賴：npm install playwright @playwright/test
2. 新增 server/services/browserAgent.ts：

```typescript
import { Browser, Page, chromium } from "playwright";

export class BrowserAgent {
  private browser?: Browser;
  private page?: Page;

  async start(headless = true) {
    this.browser = await chromium.launch({ headless });
    this.page = await this.browser.newPage();
  }

  async takeScreenshot(): Promise<string> {
    if (!this.page) throw new Error("not started");
    const buf = await this.page.screenshot({ fullPage: false });
    return buf.toString("base64");
  }

  async click(selector: string): Promise<void> { await this.page?.click(selector); }
  async type(selector: string, text: string): Promise<void> {
    if (text.length > 1000) throw new Error("type-too-long");
    await this.page?.type(selector, text);
  }
  async submitForm(formSelector: string): Promise<void> { await this.page?.locator(formSelector).press("Enter"); }
  async scroll(deltaY: number): Promise<void> { await this.page?.mouse.wheel(0, deltaY); }
  async navigate(url: string): Promise<void> {
    if (!this.isWhitelistedDomain(url)) throw new Error("domain-not-whitelisted");
    await this.page?.goto(url);
  }
  private isWhitelistedDomain(url: string): boolean {
    const u = new URL(url);
    return ["instagram.com","threads.net","x.com","linkedin.com","youtube.com"].some(d => u.hostname.endsWith(d));
  }

  async stop() { await this.browser?.close(); }
}
```

【第 2 部分：新增 browser-executor 角色】
3. 修改 shared/orb-agent-roles.ts 加新角色：

```typescript
"browser-executor": {
  label: "瀏覽器執行精靈",
  nickname: "網網",
  abilities: ["takeScreenshot", "click", "type", "navigate", "scroll", "submitForm"],
  cannotCall: ["generateImage", "generateVideo", "trainLora"],  // 防止濫用生成額度
  requiresApproval: true,
  riskLevel: "high",
}
```

【第 3 部分：Anthropic Computer Use beta 整合】
4. 用 @anthropic-ai/sdk computer-use tools 把 BrowserAgent 包成 Claude 可呼叫的 tool 介面。
5. 在 voiceAgentOrchestrator / multiAgentIntegration 內當路由偵測到需要「瀏覽器」時 dispatch 給 browser-executor 角色。

【第 4 部分：安全約束】
6. 必須先有 prompt shield（A-P2-7 屬「完全不做」清單，要先做才能做這條）。
7. coordinate 必須在 viewport 範圍 (0 <= x < width, 0 <= y < height)。
8. type 長度上限 1000 字（above 程式碼已有）。
9. navigation 須白名單 domain。
10. 每個 browser session 限 timeout 5 分鐘自動關閉。

不要做的事：不要實作「無頭挖網頁資料」工具（爬蟲屬不同議題）。不要讓 BrowserAgent 連線 healing-studio 自家 URL（避免代理循環）。不要儲存 browser cookie（每個 session 都是 fresh）。""",
    "說「幫我打開競品 Krea 網站截圖」→ 「網網」呼叫 takeScreenshot → 截圖 URL 顯示。說「把這張圖發到 IG」→ 開 IG 登入頁、貼圖、寫文案、發布。整個流程含明確人工 approval。",
    "6-8 週")

add(29, "未來", "向量記憶", "從查字典升級成聽懂意思", "D-P1-2 / A-P1-2",
    "精靈的記憶是關鍵字標籤搜尋。",
    "shared/orb-memory.ts 11 種類型 + embeddingVector 欄位（已備未激活）。orbLongTermMemory.search 是 LIKE 文本，TODO 註記需語義搜尋。",
    "問「跟森林有關的」找得到、問「自然系」就找不到。記憶利用率低。",
    "用 OpenAI text-embedding-3-small 把記憶轉成向量、存 Pinecone（最小擾動）、search() 改向量檢索 + 純文本 fallback。",
    [
        "server/services/memory/embeddingClient.ts（新增）",
        "server/services/orbLongTermMemory.ts（search 改向量檢索）",
        "shared/orb-memory.ts（既有，不改）",
        "drizzle/schema.ts（embeddingVector 已備）",
    ],
    """請依照計畫附錄 C.1 實作 D-P1-2 / A-P1-2 向量記憶：

⚠️ 季度級工程，3-4 週。

【第 1 部分：embedding client】
1. 開 Pinecone 帳號（serverless tier 即可）、建一個 index：
   - name: healing-studio-memory
   - dimensions: 1536（對應 OpenAI text-embedding-3-small）
   - metric: cosine
   - cloud: aws / region us-east-1（或就近）

2. 新增 server/services/memory/embeddingClient.ts：

```typescript
export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  search(vector: number[], topK: number, filter?: Record<string, unknown>): Promise<MemoryHit[]>;
  upsert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>;
}

export class OpenAIPineconeClient implements EmbeddingClient {
  // 用 openai.embeddings.create({ model: "text-embedding-3-small", input: text })
  // 用 pinecone.Index("healing-studio-memory").query({ vector, topK, filter })
}
```

3. 從 env var 讀 OPENAI_API_KEY 與 PINECONE_API_KEY。

【第 2 部分：寫入時機】
4. 修改 server/services/orbLongTermMemory.ts:create()，在返回前 fire-and-forget 呼叫 embeddingClient.embed + upsert：

```typescript
queueMicrotask(async () => {
  try {
    if (containsSensitiveText(memory.content)) {
      logger.warn("memory_embed_skipped_pii", { id: memory.id });
      return;
    }
    const vector = await embeddingClient.embed(memory.content);
    await embeddingClient.upsert(memory.id, vector, { userId: memory.userId, type: memory.type, createdAt: memory.createdAt });
    await db.update(orbLongTermMemories).set({ embeddingVector: vector }).where(eq(orbLongTermMemories.id, memory.id));
  } catch (err) { logger.warn("memory_embed_failed", { err }); }
});
```

【第 3 部分：檢索】
5. 修改 orbLongTermMemory.search()：先呼叫 embeddingClient.embed(query) 取向量、search top-K（預設 5）；
   - 若 embedding 失敗（API down）降級為純 LIKE 文本搜尋
   - 若無結果，並用文本搜尋作補充

【第 4 部分：注入 planner】
6. 在 agentPlanner 系統 prompt 組裝處，加入 top-K 相似記憶：

```typescript
const memories = await orbLongTermMemory.search(userMessage, 5, { userId });
const memoryContext = memories.map((m) => `[過往: ${m.summary}]`).join("\\n");
systemPrompt += `\\n\\n# 相關記憶\\n${memoryContext}`;
```

【第 5 部分：成本控制】
7. 設 monthly cap：在 modelPricing.ts 加 embedding 計費，每月 cap（建議起始 $50 / 月）。
8. 不對 < 50 字的記憶做 embed（沒意義）。

不要做的事：不要遷移到 PostgreSQL pgvector（屬大型 migration）。不要自訓 embedding model。不要把所有對話訊息都 embed（只 long-term memory）。""",
    "建一條記憶「使用者偏好森林氛圍 + 暖色調」→ 下次使用者問「我以前喜歡什麼風」→ planner 系統 prompt 看到該條記憶。同樣問「自然系」也能召回（語義近）。Pinecone dashboard 看到 vectors > 0。embedding API 故障時降級到 LIKE 不會 throw。",
    "3-4 週")

add(30, "未來", "Redis 快取", "從個人筆記本搬到公共筆記本", "D-P1-1",
    "快取放在單台伺服器記憶體（in-process LRU 1000 條 TTL 300s）。",
    "server/_core/cache.ts CacheService 內部 LRU。multi-instance 部署時每台各自快取、不一致。",
    "未來擴張多台伺服器時浪費 + 不一致。",
    "把 cache.ts 抽象為 interface、新增 RedisAdapter、graceful degrade 到 in-memory；灰度遷移：5% → llm:* → search:* → prefs:*。",
    [
        "server/_core/cache.ts（抽 interface）",
        "server/_core/cacheAdapters/RedisAdapter.ts（新增）",
        "server/_core/cacheAdapters/LruAdapter.ts（從原檔拆出）",
        "Dockerfile / docker-compose / railway 加 Redis service",
    ],
    """請依照計畫附錄 C.2 實作 D-P1-1 Redis 分散式快取：

⚠️ 何時做：當你準備擴張到多台伺服器同時跑的時候做。在此之前沒迫切需求。預估 1-2 週。

【第 1 部分：開 Redis】
1. 在你的雲端開 Redis（建議 Upstash / Railway Redis / AWS ElastiCache）。
2. 設定 maxmemory-policy allkeys-lru。
3. 新增 env var REDIS_URL。

【第 2 部分：抽象介面】
4. 修改 server/_core/cache.ts，把 CacheService 抽為 interface：

```typescript
export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, val: T, opts?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
```

5. 把既有 LRU 實作搬到 server/_core/cacheAdapters/LruAdapter.ts。

【第 3 部分：Redis adapter】
6. 新增 server/_core/cacheAdapters/RedisAdapter.ts：

```typescript
import Redis from "ioredis";

export class RedisAdapter implements CacheService {
  private client: Redis;
  constructor(url: string) { this.client = new Redis(url, { maxRetriesPerRequest: 2 }); }
  async get<T>(key: string) { const v = await this.client.get(key); return v ? JSON.parse(v) : null; }
  async set<T>(key, val, opts) { await this.client.setex(key, opts?.ttl ?? 300, JSON.stringify(val)); }
  async delete(key) { await this.client.del(key); }
  async deleteByPrefix(prefix) {
    const keys = await this.client.keys(`${prefix}*`);
    if (keys.length) await this.client.del(...keys);
  }
}
```

【第 4 部分：工廠 + graceful degrade】
7. 在 cache.ts 頂部：

```typescript
export function initCache(): CacheService {
  if (serverEnv.REDIS_URL) {
    try { return new RedisAdapter(serverEnv.REDIS_URL); }
    catch (err) { logger.warn("redis_init_failed_fallback_lru", { err }); }
  }
  return new LruAdapter();
}
```

【第 5 部分：灰度遷移】
8. Feature flag CACHE_REDIS_TRAFFIC_PERCENT（0-100，預設 5）：5% 流量試 Redis、95% 走 LRU。
9. 監控 p95 延遲、命中率 7 天。
10. 階段升級：llm:* （最貴）→ search:* → prefs:*。
11. 同時設「LRU 為永遠 L1、Redis 為 L2」旁路非強依賴。

【第 6 部分：依賴】
12. npm install ioredis

不要做的事：不要把所有 in-memory state 都改 Redis（只 cache）。不要對 collaboration session 用 Redis（屬 DB 該做的事，已在第 3 條完成）。不要設無 TTL key（會 memory leak）。""",
    "REDIS_URL 設了 → 重啟伺服器 → metrics 看到 cache.backend=redis。連跑兩次相同 LLM prompt → 第二次 < 50ms。手動 stop Redis → 應降級到 LRU、無 crash。",
    "1-2 週")

add(31, "未來", "團隊管理", "個人版升級成 Workspace 版", "A-P2-5 / D-P2-2 / U-P2-2 / O-P2-3",
    "每個帳號獨立，看不到別人的東西。",
    "drizzle/schema.ts 已有 teams + teamMemberships 表（visibility: private / team_shared 欄位也有）。但無 team-aware repository、無 RLS middleware、無 SSO。",
    "工作室同事無法共享 LoRA / 資產、老闆看不到員工用了多少額度、B2B 客戶不能採購。",
    "三件事：(1) team-aware RLS middleware、(2) 共享資產 UI（共享 LoRA / 資產庫）、(3) SAML / OIDC SSO（Okta / Azure AD / Google Workspace）。",
    [
        "server/middleware/rls.ts（新增）",
        "server/repositories/（全部加 RLSContext 參數）",
        "client/src/pages/TeamsPage.tsx（新增）",
        "server/services/auth/saml.ts + oidc.ts（新增）",
    ],
    """請依照計畫附錄 C.13 實作 A-P2-5 / D-P2-2 / U-P2-2 / O-P2-3 多用戶 + RLS + SSO：

⚠️ 季度級工程，10 週。建議拆三個 sub-sprint。

【Sub-sprint 1：RLS middleware（4 週）】

1. 新增 server/middleware/rls.ts：

```typescript
export interface RLSContext { userId: number; teamId: number | null; role: "owner"|"admin"|"member" }

export async function withRLS<T>(ctx: RLSContext, query: (db: Db, scope: RLSContext) => Promise<T>): Promise<T> {
  return query(db, ctx);
}

// helper：套到所有 SELECT
export function teamAwareWhere(table: any, ctx: RLSContext): SQL {
  return or(
    and(eq(table.ownership, "private"), eq(table.ownerId, ctx.userId)),
    and(eq(table.ownership, "team_shared"), ctx.teamId ? eq(table.teamId, ctx.teamId) : sql`false`),
  );
}
```

2. 修改所有 repository 接收 RLSContext，每個 find / list 預設套 teamAwareWhere(table, ctx)。
3. 改 tRPC context middleware 自動填入 RLSContext（從 JWT 解 userId、查 teams 表取 teamId）。

【Sub-sprint 2：共享 UI（3 週）】

4. 新增 client/src/pages/TeamsPage.tsx：
   - 建團隊 / 邀請成員 / 角色管理（owner/admin/member）
   - 切換「個人 / 團隊 X」viewport（影響所有資產列表）
   - 額度監控：每個成員今月用了多少 points

5. 新增 client/src/pages/SharedAssetsPage.tsx：在 ImageStudio / VideoStudio 加「來自團隊」tab，能用團隊成員訓練的 LoRA / 角色 / 配方。

6. 修改 fineTunedModels / digitalAssetLibrary 加 ownership 欄位（private / team_shared / public showcase）。

【Sub-sprint 3：SSO（3 週）】

7. 新增 server/services/auth/saml.ts：用 passport-saml，支援 Okta / Azure AD / Google Workspace。

8. 新增 server/services/auth/oidc.ts：用 passport-openidconnect，支援 Google / GitHub OIDC。

9. Just-in-time 建用戶：SSO 登入成功後，若用戶不存在自動建帳號 + 加入預設 team。

10. 新增 client/src/pages/EnterpriseSettings.tsx：admin 可設定 SAML metadata / OIDC client。

不要做的事：不要做「跨團隊資產分享」（複雜權限）。不要把所有歷史一次性遷成 team-aware（保留 ownership = private 為預設）。不要做企業計費自動 invoice（手動處理）。""",
    "建一個團隊 T1 → 邀請使用者 U2 → U1 訓練一個 LoRA 標為 team_shared → U2 在 ImageStudio 能用此 LoRA。SAML 配 Okta → 員工用 Okta SSO 登入自動加入 T1。Admin 看到 T1 今月用了 5000 points。",
    "10 週")

add(32, "未來", "LoRA 收藏冊", "個人化模型版本管理", "A-P2-3 / G-P2-2",
    "使用者訓練了 LoRA 只拿到一個 URL。",
    "server/services/loraTrainer.ts 限 Replicate，無版本管理、無 parentVersion、無 trainingSetHash、無評估。",
    "訓練 v1/v2/v3 沒地方比較哪個好、要自己手動記。",
    "建 lora_versions / lora_metrics / lora_evaluations 三表、訓練完自動評估、UI 並排比較版本。",
    [
        "drizzle/migrations/00XX_lora_lifecycle.sql（新增三表）",
        "drizzle/schema.ts（loraVersions / loraMetrics / loraEvaluations）",
        "server/services/loraTrainer.ts（每次訓練寫入 lora_versions）",
        "server/services/loraEvaluationService.ts（新增自動評估）",
        "client/src/pages/MyLorasPage.tsx（新增）",
    ],
    """請依照計畫附錄 C.12 實作 A-P2-3 / G-P2-2 LoRA 生命週期管理：

⚠️ 季度級工程，5-6 週。

【第 1 部分：Schema】
1. 新增 migration drizzle/migrations/00XX_lora_lifecycle.sql：

```sql
CREATE TABLE lora_versions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  model_id INT NOT NULL,
  version_number INT,
  parent_version_id INT,
  trigger_word VARCHAR(64),
  training_params JSON,
  file_path VARCHAR(255),
  training_started_at TIMESTAMP,
  completed_at TIMESTAMP,
  status ENUM('pending','training','completed','failed'),
  error_message TEXT,
  training_job_id VARCHAR(128),
  INDEX idx_model_version (model_id, version_number)
);

CREATE TABLE lora_metrics (
  id INT PRIMARY KEY AUTO_INCREMENT,
  version_id INT NOT NULL,
  epoch INT,
  loss FLOAT,
  validation_loss FLOAT,
  timestamp TIMESTAMP,
  INDEX idx_version_epoch (version_id, epoch)
);

CREATE TABLE lora_evaluations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  version_id INT NOT NULL,
  eval_type ENUM('sample_generation','user_feedback','qa_test'),
  score FLOAT,
  sample_prompt VARCHAR(512),
  sample_result_url VARCHAR(255),
  evaluator_id INT,
  created_at TIMESTAMP,
  INDEX idx_version_score (version_id, score)
);
```

2. 修改 drizzle/schema.ts 新增三表的 TS 定義。

【第 2 部分：寫入訓練紀錄】
3. 修改 server/services/loraTrainer.ts：
   - 每次 startTraining 寫入 lora_versions（status=pending）
   - 訓練過程 webhook callback 寫 lora_metrics（每 epoch）
   - 完成時更新 lora_versions（status=completed、file_path、completed_at）

【第 3 部分：自動評估】
4. 新增 server/services/loraEvaluationService.ts：訓練完成後 trigger runLoraEvaluation(versionId)：
   - 跑 10 條代表 prompt（依 modality 預定義）
   - 用 Claude vision API 評分（0-10）
   - 寫入 lora_evaluations
   - 通知使用者「v2 已評估，平均分 8.2，比 v1 高 1.4」

【第 4 部分：UI】
5. 新增 client/src/pages/MyLorasPage.tsx：
   - 列出所有 LoRA + 每個 LoRA 展開看版本歷史
   - 版本卡片：縮圖、評分、loss curve（recharts）
   - 「比較版本」按鈕 → side-by-side：v1 vs v2 loss curve、metrics heatmap、樣本生圖並列

6. Promotion 規則：loss 下降 + user feedback mean ≥ 7 → 自動標記為「正式版」（在 fineTunedModels.activeVersionId 紀錄）。

7. 在 ImageStudio LoRA picker 顯示「我的 LoRAs」列表（依精靈推薦排序）。

不要做的事：不要做「LoRA 公開市集」（屬商業考量）。不要把舊 LoRA 自動刪除（保留以備使用者切回）。不要實作 LoRA 組合 (multi-LoRA stacking)（屬另一個議題）。""",
    "訓練「我的角色」三次 v1/v2/v3 → MyLorasPage 看到三個版本、loss curve 差異。點「比較 v2 vs v3」→ 並排看樣本圖 + metrics 差。系統自動標 v3 為「正式版」（如果評分最高）。",
    "5-6 週")

add(33, "未來", "全球 CDN", "全球加速 + 流量降費", "S-P1-1",
    "圖片影片從 S3 / R2 bucket 直接送。",
    "海外使用者載入慢、每次傳輸花流量錢。無邊緣節點 cache。",
    "全球體驗差 + 不必要的流量費。",
    "套 Cloudflare CDN（若用 R2 幾乎免費）或 CloudFront；對 thumb/preview 設長 cache、對 generated/ 設短 TTL（24h）。",
    [
        "Cloudflare dashboard / CloudFront console（手動設定為主）",
        "server/services/internalMedia.ts（產 URL 時改用 CDN 域名）",
        "scripts/setup-cdn-cache-rules.sh（新增 idempotent 套用）",
    ],
    """請依照計畫附錄 C.8.1 實作 S-P1-1 CDN 接入：

⚠️ 1-2 週工程，主要是設定不是寫程式。

【路 A：若你用 Cloudflare R2（推薦）】

1. 在 Cloudflare dashboard 把 R2 bucket 綁定 custom domain（如 cdn.healing.studio）。
2. 在 Cloudflare 後台設定 Page Rules：
   - URL: `cdn.healing.studio/thumb/*` → Cache Level: Cache Everything、Edge Cache TTL: 1 month
   - URL: `cdn.healing.studio/preview/*` → Cache Level: Cache Everything、Edge Cache TTL: 1 week
   - URL: `cdn.healing.studio/generated/*` → Cache Level: Cache Everything、Edge Cache TTL: 1 day
   - 其他 → Bypass cache（私人草稿等用 signed URL 路徑）

3. 在 Cloudflare 後台確認 Compression（Brotli）開啟、Auto Minify HTML/CSS/JS 開啟（不影響圖片）。

【路 B：若你用 AWS S3 → CloudFront】

4. 在 CloudFront console 建立 distribution：
   - Origin: 你的 S3 bucket
   - Behaviors: 同上 cache rules
   - Compress objects: Yes
   - Viewer protocol: HTTPS only

5. 設定 origin access identity (OAI)：S3 bucket 只允許 CloudFront 讀取（移除 public read）。

【路 C：程式碼整合】

6. 修改 server/services/internalMedia.ts：產對外 URL 時，把 S3_PUBLIC_URL / GCS public URL 換成 CDN 域名（新增 env var CDN_BASE_URL）。

7. 對需要簽名的私人草稿，仍經 getSignedAssetUrl()（第 23 條），bypass CDN。

【路 D：scripts】

8. 新增 scripts/setup-cdn-cache-rules.sh（CI 可重跑）：用 cloudflare CLI 或 aws cloudfront create-cache-policy 確保 cache rules 一致。

不要做的事：不要對所有資源都套 long-TTL（會破壞 signed URL 邏輯）。不要對 generated/ 用 30 天 cache（使用者刪了還能看到舊版）。不要拆多個 CDN（保持一家簡單）。""",
    "海外 VPN 連上 healing-studio → 載入第一張圖 → DevTools 看 Header: cf-cache-status: HIT 或 CloudFront X-Cache: Hit。對比未接 CDN 前載入時間應降 50-80%。Cloudflare dashboard 看到流量分擔到全球邊緣。",
    "1-2 週")

add(34, "未來", "Replicate 備援", "開第二家供應商備援", "G-P1-3",
    "Replicate 在你的網站只用了 LoRA 訓練。",
    "server/services/loraTrainer.ts 只整合 Replicate 訓練端點。FAL 主力故障時無備援。",
    "FAL 偶爾當機（5% 機率），使用者看到「生成失敗」。",
    "把 Replicate 的圖 / 影 / 3D 也接進來、與 unifiedModelRegistry 的 fallbackChain 整合（cross-provider fallback）。",
    [
        "server/services/replicateClient.ts（新增，仿 sunoClient 結構）",
        "server/services/falModels.ts（disabled 模型加 replacement: replicate/xxx）",
        "shared/unifiedModelRegistry.ts（fallbackChain 加 Replicate 條目）",
        "server/services/falDispatcher.ts（dispatchWithFallback 串 Replicate）",
    ],
    """請依照計畫附錄 C.3 / C.4 實作 G-P1-3 Replicate 模態擴張：

⚠️ 3-4 週工程，分階段。

【Phase 1：text-to-image（最高優先）】

1. 新增 server/services/replicateClient.ts，仿 server/services/loraTrainer.ts 既有的 Replicate 用法：

```typescript
export class ReplicateClient {
  async runModel(modelId: string, input: Record<string, unknown>, opts?: { webhookUrl?: string }) {
    // 用 replicate.run() 或 replicate.predictions.create()
    // 支援同步 + 非同步（webhook callback）
  }
  async checkStatus(predictionId: string) { ... }
}
```

2. 接入這些 Replicate 模型作為 FAL Flux 的備援：
   - replicate/black-forest-labs/flux-1.1-pro
   - replicate/black-forest-labs/flux-dev
   - replicate/black-forest-labs/flux-schnell

3. 修改 shared/unifiedModelRegistry.ts 加 fallbackChain：

```typescript
"fal-ai/flux-pro/v1.1": {
  ...,
  fallbackChain: ["replicate/black-forest-labs/flux-1.1-pro", "gemini/imagen-4"],
}
```

4. 修改 server/services/falDispatcher.ts:dispatchWithFallback：依 chain 逐家試，遇 429 / 5xx / 超時降級下一家。

【Phase 2：image-to-video（3 週後）】

5. 接 replicate/luma/ray-2、replicate/genmo/mochi-1 作為 fal kling 的備援。

6. 更新 fallbackChain：

```typescript
"fal-ai/kling-v2-pro": {
  fallbackChain: ["replicate/luma/ray-2", "replicate/genmo/mochi-1"],
}
```

【Phase 3：video-to-video / 3D（時程吃緊可砍）】

7. 接 replicate/cjwbw/kling-v2v 等 v2v 模型。
8. 接 replicate/lucataco/hunyuan3d-v2 等 3D 模型。

【共用：dispatcher 改造】

9. 修改 dispatchWithFallback 統一抽象（之前在計畫附錄 C.3.2）：

```typescript
async function dispatchWithFallback(modelId: string, category: FalCategory, inputs): Promise<DispatchResult> {
  const chain = [modelId, ...(getModelById(modelId)?.fallbackChain ?? [])];
  for (const [i, id] of chain.entries()) {
    try { return await callModelByProvider(id, category, inputs); }
    catch (err) {
      if (i === chain.length - 1) throw err;
      logger.warn("fallback_attempt", { from: id, to: chain[i + 1], err });
    }
  }
}
```

callModelByProvider 依 modelId prefix 路由：fal-ai/... → falDispatcher、replicate/... → replicateClient、gemini/... → geminiMedia。

不要做的事：不要把所有 fal 模型都接 Replicate 對應品（只接主力模型）。不要做「主動 health check 切換」（被動 fallback 即可）。不要做使用者可選「我要用 Replicate」（透明降級）。""",
    "故意把 fal-ai/flux-pro/v1.1 設成不可用（mock 5xx）→ 生圖請求自動切到 replicate flux-1.1-pro → 使用者不感知任何錯誤、只是 latency 多 2-3 秒。log 看到 fallback_attempt: fal-ai/flux-pro → replicate/flux-1.1-pro。",
    "3-4 週")

add(35, "未來", "Suno 直連", "音樂生成跳過中間商", "G-P1-2",
    "Suno 透過 FAL 中轉。",
    "FAL → Suno → 音檔，延遲多 30-50%、FAL 加收手續費。",
    "音樂生成慢且貴。",
    "申請 Suno 官方 API key、新增 SunoDirectClient class（含 401 自動降級 FAL）、修改 falDispatcher.dispatchAudioGeneration 優先試直連。",
    [
        "server/services/sunoClient.ts（新增 SunoDirectClient）",
        "server/services/falDispatcher.ts:dispatchAudioGeneration（修改）",
        "server/_core/env.validated.ts（加 SUNO_API_KEY / SUNO_WEBHOOK_SECRET）",
        "server/routers.ts（新增 POST /api/webhook/suno）",
    ],
    """請依照計畫附錄 B.7 實作 G-P1-2 Suno 直連：

⚠️ 1-2 週工程，先要申請 Suno API key（要有訂閱方案）。

【第 1 部分：env vars】
1. 在 .env.example 加 SUNO_API_KEY、SUNO_WEBHOOK_SECRET。
2. server/_core/env.validated.ts 加 schema 驗證。

【第 2 部分：SunoDirectClient】
3. 新增 server/services/sunoClient.ts：

```typescript
export class SunoDirectClient {
  private apiKey: string | null;
  private baseUrl = "https://api.suno.ai";

  constructor() {
    this.apiKey = process.env.SUNO_API_KEY?.trim() ?? null;
  }

  get isAvailable(): boolean { return !!this.apiKey; }

  async generateMusic(params: { prompt: string; duration?: number; tags?: string[]; title?: string; negative?: string }) {
    if (!this.apiKey) return this.fallbackGenerateViaFal(params);
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: params.prompt,
          is_custom: false,
          duration: params.duration ?? 15,
          tags: params.tags,
          title: params.title,
          negative: params.negative,
          model_name: "chirp-v3-0",
          wait_audio: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        if (res.status === 401) {
          logger.warn("suno_api_key_invalid_fallback_fal");
          return this.fallbackGenerateViaFal(params);
        }
        throw new Error(`Suno API ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return { jobId: data.id, clips: data.clips ?? [] };
    } catch (err) {
      logger.error("suno_direct_failed_fallback_fal", { err });
      return this.fallbackGenerateViaFal(params);
    }
  }

  async handleWebhook(payload) {
    const { generationBus } = await import("../generationEvents");
    generationBus.emit(`suno-job-${payload.id}`, {
      type: payload.status === "complete" ? "complete" : "error",
      jobId: payload.id, status: payload.status, result: { clips: payload.clips },
    });
  }

  async getJobStatus(jobId: string) { ... }

  private async fallbackGenerateViaFal(params) {
    const { callFalModel } = await import("./falModels");
    return callFalModel("fal-ai/sonauto", { prompt: params.prompt, duration_s: params.duration ?? 15 });
  }
}

let _sunoClient: SunoDirectClient | null = null;
export function getSunoClient(): SunoDirectClient {
  if (!_sunoClient) _sunoClient = new SunoDirectClient();
  return _sunoClient;
}
```

【第 3 部分：dispatcher 整合】
4. 修改 server/services/falDispatcher.ts:dispatchAudioGeneration：

```typescript
if (modelId.includes("suno")) {
  const sunoClient = getSunoClient();
  if (sunoClient.isAvailable) {
    try {
      const result = await sunoClient.generateMusic({ prompt, duration, tags });
      const points = estimatePoints({ modelId: "suno-v4", durationSec: duration }).totalPoints;
      await deductUserPoints(userId, points);
      return { status: "success", requestId: result.jobId, outputUrl: result.clips[0]?.audio_url, points, durationMs: Date.now() - startMs };
    } catch (err) {
      logger.warn("suno_direct_failed_fallback_fal", { err });
    }
  }
}
return dispatchViaFal("audio", modelId, params);
```

【第 4 部分：webhook】
5. 新增 server/routers.ts 內 POST /api/webhook/suno，過 D-P0-4 的 checkWebhookIdempotency middleware（第 11 條），呼叫 sunoClient.handleWebhook()。

不要做的事：不要把所有音訊生成都改 Suno 直連（保留 ElevenLabs / Qwen 等其他引擎）。不要對 fal-ai/sonauto 完全棄用（作為備援）。不要實作「Suno credits 自動補額」（屬商業流程）。""",
    "設 SUNO_API_KEY → 跑音樂生成 → 比較直連 vs FAL 中轉延遲（直連應快 30-50%）。故意設錯 API key → 自動降級 FAL（log 看 suno_api_key_invalid_fallback_fal）。Webhook 通知正確觸發 generationBus event。",
    "1-2 週")

add(36, "未來", "越用越懂你", "把資料蒸餾成個人風格", "完整資料庫個人化",
    "你的網站累積了使用者大量資料（生成歷史、評分、偏好、對話、什麼風格被刪 / 被保存）。",
    "這些資料只用來「顯示給使用者看歷史」，沒拿來「訓練 AI 更懂這個使用者」。preference distiller 已存在但只做偵測，未做模型蒸餾。",
    "AI 始終不夠了解個別使用者、跨會話風格不一致、使用者要每次重複表達偏好。",
    "定期（每週）把使用者全部資料整理成「他喜歡 / 不喜歡」對比、蒸餾成一個 DPO / RLHF-lite 個人小模型、套到 prompt 前。",
    [
        "server/services/personalization/preferenceDistiller.ts（既有，擴充）",
        "server/services/personalization/personalStyleDistillation.ts（新增）",
        "server/jobs/weeklyStyleDistillationJob.ts（新增）",
        "server/services/agentPlanner.ts（注入個人風格）",
        "shared/agent-preferences.ts（personalStyleProfile 欄位）",
        "client/src/pages/MyStyleProfilePage.tsx（新增使用者透明檢視）",
    ],
    """請依照計畫附錄 A-P2-4 / preferenceDistiller 延伸實作完整資料庫個人化訓練：

⚠️ 季度級工程，6-8 週。**特別需要使用者明確同意**（涉及個資 + 風格擁有權）。

【第 1 部分：資料蒐集】
1. 擴充既有 server/services/personalization/preferenceDistiller.ts：每週遍歷使用者的：
   - generationHistory（含 parameterSnapshot、評分、書簽、刪除狀態）
   - orbConversations 對話訊息（特別是「我要更...」「不要再...」這類偏好表達）
   - userPreferences JSON 既有設定
   - fineTunedModels 訓練紀錄（風格偏好）
   - 觀看時段（深夜 / 早晨）

2. 整理為「對比配對」格式（DPO format）：
   - chosen：使用者保存 / 高評分的 prompt + parameter
   - rejected：使用者刪除 / 低評分的同類請求

【第 2 部分：蒸餾】
3. 新增 server/services/personalization/personalStyleDistillation.ts：
   - 每使用者建立一份 styleProfile JSON：
     - color_preference: { warm: 0.8, cool: 0.2, dark: 0.6 }
     - composition_preference: { symmetric: 0.7, minimalist: 0.9 }
     - emotional_tone: { calm: 0.8, energetic: 0.2 }
     - lighting_preference: { soft: 0.9, dramatic: 0.3 }
     - preferred_models: ranked list
     - preferred_negative_prompts: extracted from history
     - language_style: 用語特徵
   - 用 Claude / Gemini 跑 prompt：「依以下對比配對，總結這個使用者的視覺 / 風格偏好特徵」生成 styleProfile

4. 寫入 agentPreferences.personalStyleProfile（新增欄位）。

【第 3 部分：注入 planner】
5. 修改 server/services/agentPlanner.ts，每次生成 plan 前注入 styleProfile：

```typescript
const profile = await getPersonalStyleProfile(userId);
systemPrompt += `\\n\\n# 使用者風格指紋（請參考）\\n${JSON.stringify(profile, null, 2)}`;
```

6. 預設模型選擇、預設配色、預設提示詞都依 profile 調整。

【第 4 部分：自動執行】
7. 新增 server/jobs/weeklyStyleDistillationJob.ts（cron 每週日 02:00）：對所有 active 使用者跑 distillation。

【第 5 部分：UI 透明度】
8. 新增 client/src/pages/MyStyleProfilePage.tsx：
   - 「我們在學什麼」可視化展示 styleProfile
   - 使用者可手動修正某項偏好
   - 大開關「停止學習我的風格」
   - 「清除我的風格指紋」按鈕

9. 首次蒸餾完成 → toast「我們學到一些關於你的事，要看嗎？」→ 引導到 MyStyleProfilePage。

【第 6 部分：隱私 / 合規】
10. 蒐集前必須使用者明確同意（onboarding 加 opt-in step）。
11. styleProfile 屬使用者資產：可下載 JSON、可永久刪除。
12. 不分享到團隊（即使第 31 條團隊管理做了也不共享 personal profile）。
13. GDPR DSR-erase（第 22 條）時連同 styleProfile 一起刪除。

不要做的事：不要做 LoRA 級全量 fine-tune（成本太高）。不要把 profile 跨使用者比對（隱私）。不要強制 opt-in（必須明確同意）。不要對「未授權使用者」蒐集 profile（無意義）。""",
    "使用 1 週後查看 MyStyleProfilePage → 看到「你偏好暖色 + 簡約構圖 + 柔光」。下次生圖不寫風格提示詞、AI 自動套這些偏好。手動關掉「學習」開關 → 下次 plan system prompt 內無 styleProfile。一鍵清除 profile → 全部資料消失。",
    "6-8 週")

# ── render 函式 ─────────────────────────────────────────────────────────────
KIND_COLOR = {
    "修復": "#c0392b",
    "新增": "#16a085",
    "修復+新增": "#8e44ad",
    "優化": "#2980b9",
    "未來": "#7f8c8d",
}

def make_pdf(item, out_path):
    doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                            topMargin=18*mm, bottomMargin=18*mm,
                            title=f"#{item['num']:02d} {item['short']}", author="healing-studio plan")
    story = []

    # 封面
    story.append(Paragraph(f"#{item['num']:02d} · {item['short']}", TITLE))
    badge_color = KIND_COLOR.get(item['kind'], '#555')
    story.append(Paragraph(
        f"<font color='{badge_color}'><b>[{item['kind']}]</b></font> "
        f"<font color='#888'>技術代號 {item['tech']} · 約 {item['eta']}</font>",
        SUBTITLE))

    story.append(Paragraph("一句話：" + item['long'], BODY))
    story.append(Box("<b>為什麼要修</b><br/>" + item['why']))

    # 背景
    story.append(H("現在怎樣"))
    story.append(P(item['current']))
    story.append(H("問題在哪"))
    story.append(P(item['problem']))
    story.append(H("要改什麼"))
    story.append(P(item['change']))

    # 涉及檔案
    story.append(H("涉及檔案"))
    for f in item['files']:
        story.append(P("• " + f))

    # 提示詞
    story.append(PageBreak())
    story.append(H("Claude Code 提示詞（複製貼上）"))
    story.append(Paragraph("把下面這段話完整複製，貼到 Claude Code（或 /claude 對話）。"
                          "Claude Code 會依此完成此項修復。完成後跑下方驗證步驟確認。", BODY))
    story.append(Prompt(item['prompt']))

    # 驗證
    story.append(H("如何驗證做完了"))
    story.append(P(item['verify']))

    # 預估
    story.append(H("預估耗時"))
    story.append(P(item['eta']))

    doc.build(story)


def main():
    for item in ITEMS:
        # 檔名格式：01_short-name.pdf
        fname = f"{item['num']:02d}_{item['short'].replace('/', '-').replace(' ', '')}.pdf"
        out_path = os.path.join(OUT_DIR, fname)
        try:
            make_pdf(item, out_path)
            print(f"✓ {fname}")
        except Exception as e:
            print(f"✗ {fname}: {e}")

if __name__ == "__main__":
    main()
