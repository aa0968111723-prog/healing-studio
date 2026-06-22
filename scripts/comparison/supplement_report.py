# -*- coding: utf-8 -*-
import datetime, os, json, glob
from fpdf import FPDF
FONT="/tmp/report_assets/wqy.ttf"
D=json.load(open("scripts/comparison/supplement.json"))
class PDF(FPDF):
    def header(self):
        if self.page_no()==1: return
        self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,5,"補遺合輯 — 12 個未收錄面向一次補完 · healing-studio (AI Director)",new_x="LMARGIN",new_y="NEXT",align="C")
        self.set_draw_color(220); self.line(self.l_margin,self.get_y(),self.w-self.r_margin,self.get_y());self.ln(2);self.set_text_color(0)
    def footer(self):
        if self.page_no()==1: return
        self.set_y(-12);self.set_font("wqy",size=7);self.set_text_color(150)
        self.cell(0,8,f"第 {self.page_no()} 頁 · 動態資料快照 {datetime.date.today().isoformat()}（持續新增/更新）· 紮根 repo 實檔",align="C");self.set_text_color(0)
pdf=PDF("P","mm","A4");pdf.set_margins(10,12,10);pdf.set_auto_page_break(True,14)
pdf.add_font("wqy","",FONT);pdf.set_font("wqy",size=10);EPW=pdf.epw
_G={"→":"->","×":"x","—":"-","…":"...","　":" ","•":"-","≈":"~","≥":">=","≤":"<=","✅":"[可接]","⚠":"[半接]","🚪":"[門]"}
def S(x):
    if x is None:return ""
    x=str(x)
    for k,v in _G.items(): x=x.replace(k,v)
    return "".join(c if ord(c)<0x2700 or 0x4e00<=ord(c)<=0x9fff or 0x3000<=ord(c)<=0x30ff or 0xff00<=ord(c)<=0xffef else "" for c in x)
def H(t,s,g=2,col=(25,40,75),top=0):
    if top:pdf.ln(top)
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.46,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def P(t,s=8.8,g=1.3,col=(0,0,0)):
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.52,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def sec(n,title):
    if pdf.get_y()>pdf.h-60: pdf.add_page()
    pdf.ln(1);pdf.set_font("wqy",size=13);pdf.set_text_color(150,30,30)
    pdf.multi_cell(EPW,6.2,S(f"補遺 {n}. {title}"),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(1)
def table(headers,rows,widths,fs=7.2,head=(35,55,90)):
    lh=fs*0.46+1.0;sc=EPW/sum(widths);widths=[w*sc for w in widths]
    def dh():
        pdf.set_font("wqy",size=fs);pdf.set_fill_color(*head);pdf.set_text_color(255)
        y=pdf.get_y();x=pdf.l_margin
        for i,c in enumerate(headers):
            pdf.set_xy(x,y);pdf.multi_cell(widths[i],lh+1,"",border=1,fill=True,new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.6,y+0.6);pdf.multi_cell(widths[i]-1.2,lh,S(c),new_x="RIGHT",new_y="TOP");x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+lh+1);pdf.set_text_color(0)
    if pdf.get_y()+lh*3>pdf.h-pdf.b_margin: pdf.add_page()
    dh();ri=0
    for row in rows:
        pdf.set_font("wqy",size=fs);cells=[S(v) for v in row];nl=1
        for i,t in enumerate(cells): nl=max(nl,len(pdf.multi_cell(widths[i]-1.2,lh,t,dry_run=True,output="LINES",new_x="RIGHT",new_y="TOP")))
        rh=nl*lh+1
        if pdf.get_y()+rh>pdf.h-pdf.b_margin: pdf.add_page();dh()
        y=pdf.get_y();x=pdf.l_margin;fill=ri%2
        if fill:pdf.set_fill_color(245,247,251)
        for i,t in enumerate(cells):
            pdf.set_xy(x,y);pdf.multi_cell(widths[i],rh,"",border=1,fill=bool(fill),new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.6,y+0.6);pdf.multi_cell(widths[i]-1.2,lh,t,new_x="RIGHT",new_y="TOP");x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+rh);ri+=1

# COVER
pdf.add_page();pdf.ln(20)
pdf.set_font("wqy",size=25);pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,12,S("補遺合輯"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(1);pdf.set_font("wqy",size=12.5);pdf.set_text_color(90,90,90)
pdf.multi_cell(EPW,7,"12 個先前未收錄面向 — 一次補完",align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(3);pdf.set_font("wqy",size=10);pdf.set_text_color(150,30,30)
pdf.multi_cell(EPW,6,S(f"* 動態資料（持續新增/更新）· 快照 {datetime.date.today().isoformat()} · 紮根 repo 實檔 *"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(6);pdf.set_text_color(0)
P("本輯補上前 7 份報告未專章涵蓋的 12 個面向：①資安姿態 ②測試體系 ③精靈系統 ④世界觀子系統 ⑤ER 關係圖 "
  "⑥開發治理 ⑦外部整合 ⑧可觀測性 ⑨18 影片子系統 ⑩提示詞庫 ⑪詞彙表 ⑫效能調節。皆紮根 repo 實檔，可逐一覆核。",9.5,2,(70,70,70))

# 1 資安
pdf.add_page()
sec(1,"資安姿態（認證·授權·稽核·防禦）")
P("分層防線：",9)
rows=[
 ["認證 JWT","server/middleware/verifyToken.ts · googleAuth.ts","自簽 JWT、scrypt 密碼雜湊、2FA TOTP；prod 密鑰<16 字元開機 fail-fast（AIDV-59）；token 壽命 365->30 天"],
 ["資料層 RBAC","authz/resourceAccess.ts · rbac router · resourceShares(0078)","canAccess(resource,subject,action)；資源角色 owner/editor/viewer 與系統角色 admin/leader/user 正交；share/revoke/listShares/transferOwnership 全 owner-gated；旗標 ENABLE_DATA_RBAC 預設 OFF"],
 ["稽核軌跡","audit/auditLog.ts · global_audit_log(0076)","append-only(bigint PK,無 updatedAt)；recordAuditEvent 記 登入/CRUD/共享/撤銷；admin 唯讀查詢+匯出"],
 ["Webhook 硬化","FAL webhook(AIDV-158)","per-job token 強制+簽章 fail-closed+replay idempotency；Stripe webhook HMAC 驗章(prod fail-closed)"],
 ["Prompt 注入防禦","orb-prompt-defense.ts · ENABLE_RAG_INJECTION_GUARD","防把外部檢索內容當指令執行"],
 ["內容審核","orb-content-moderation.ts","生成內容審核"],
 ["限流","aiProxy 限流器(H5,AIDV-60)","/api/ai 由可匿名->verifyToken 401；fail-open->fail-closed 503；補掛三個未掛限流器"],
 ["IDOR 一致性","AIDV-184","promptLibrary 可見性/IDOR 一致、incrementUseCount 防灌他人私有"],
]
table(["面向","實作位置","重點"],rows,[18,38,52],fs=7)
P("成熟度：認證/稽核/webhook 已硬化上線；資料層 RBAC 為基礎版（旗標 OFF、待 Bruce 拍板角色集後分卡接線）。",8.5,1,(20,90,40))

# 2 測試
sec(2,"測試體系")
t=D["tests"]
P(f"全 repo 測試檔 {t['total']} 個（server {t['server']} / client {t['client']} / shared {t['shared']}）。依主題（檔名關鍵字）分布：",9)
th=t["themes"]
rows=[[k,str(v)] for k,v in sorted(th.items(),key=lambda x:-x[1])]
table(["主題","測試檔數"],rows,[40,16],fs=8)
P("三道驗證門（AIDV dev-workflow）：tsc --noEmit · check:routes(54)/check:navigation · vitest run。"
  "已知 baseline 13 failed＝本機 jsdom29+vitest2 localStorage 相容性等既有環境問題（與功能無關，逐 PR 比對確認）。"
  "代理層（planner/critic/verifier/scheduler）與四態元件覆蓋密；端到端『代理操作某頁成功』整合測較少（缺口）。",9,1.2)

# 3 精靈
sec(3,"精靈系統（Multi-agent roster）")
ns=D["spirits"]["tool_namespaces"]
real=[x for x in ns if x not in ("chain","haystack","muted","reasons","recent","sources","text","tokens","when","intentSummary")]
P(f"orb-agent-roles.ts {D['spirits']['file_lines']} 行定義精靈陣容（25 精靈為核心+專責子代理）。"
  f"從工具命名空間萃出的專責精靈（spirit.method）：",9)
P("、".join(real),8.5,1,(40,60,110))
P("代表角色：accountant（財財·錢包/用量/工作流估點）、critic（多輪比較/改寫建議）、imageSpecialist/videoSpecialist/"
  "anatomySpecialist/trainingSpecialist（各模態專家）、inspirationSpecialist（參考圖/情緒板）、qualityCoach（品質教練）、"
  "settingsDetail（設定問答）、companion（陪伴/推薦下一棒）、director（導導·計畫/交接）、research（模型比較）。"
  "每精靈有 system slice+工具+交接協議（spirit-handoff-protocol）+per-spirit 記憶（Tier C）。",9,1.2)

# 4 世界觀
sec(4,"世界觀子系統（Worldbuilding）")
wb=sorted(os.path.basename(f)[:-3] for f in glob.glob("shared/worldbuilding-*.ts") if not f.endswith(".test.ts"))
P(f"一個獨立大子系統，{len(wb)} 個模組（types 2709 行、animation 1825 行）：",9)
P("、".join(wb),8.5,1,(40,60,110))
P("職責：世界框架(frameworks)/紀元(era)/時間軸(timeline)/靈感(inspiration)/就緒度(readiness)/生成任務(generation-tasks)/"
  "製作包(production-package)/動畫(animation)/進度(progress)/代理工作流(agent-workflow)。對映導演台『世界觀->劇本->分鏡->生成->成片』五步脊椎的第一步。"
  "schema 對應 worldbuilding_frameworks/era 等表。",9,1.2)


# 5 ER 關係圖
pdf.add_page()
sec(5,"資料模型關係圖（ER / 外鍵）")
P(f"schema.ts 慣例不寫 references()，FK 由 raw-SQL migration 補（0055 模式）。實際捕獲 {D['fk_count']} 條跨表外鍵："
  "（空白來源＝orb 系列 migration 以 PREPARE 包裝，來源表為對應 orb_* 表）",9)
rows=[]
for x in D["fks"]:
    rows.append([x["from"] or "(orb_*)", x["col"], "->", x["to"], "CASCADE" if x["cascade"] else "", x["mig"][:18]])
table(["來源表","欄","","參照表","刪除","migration"],rows,[30,22,4,30,12,20],fs=7)
P("關係樞紐：users 是最大被參照表（teams.ownerId/team_memberships/teaching_materials/audit/orb 記憶皆指向它）；"
  "prompt_assets 是 prompt_library<->digital_asset_library 的 junction（雙向 CASCADE）；teaching_material_access_log "
  "對 teaching_materials+users CASCADE。多數刪除走 ON DELETE CASCADE（一端刪、關聯邊自動清）。",9,1.2)

# 6 開發治理
sec(6,"開發治理 / 工作流（這站怎麼被蓋出來）")
P("鐵則：任何開發（含 hotfix）都要一張『工作表』，逐欄走九階、過三道門、不跳關。分工：Agent 跑 0–7 階全自動；"
  "Bruce 只管三件事——①設計門拍板（碰後端/金鑰/待議）②金鑰貼 Railway ③按合併＋真站走查。",9)
rows=[
 ["設計門(階1->2)","零後端+可回滾+預設 ON(含關閉退路)=自動通過；碰後端/金鑰/待議/破壞性=需 Bruce 拍板"],
 ["驗證門(階3->4)","tsc/check:routes/check:navigation/vitest 全綠才放行"],
 ["審查門(階6->7)","Codex/CodeRabbit 事件逐條 triage、修真問題+加回歸測試、重跑驗證門"],
]
table(["三道門","通過條件"],rows,[26,74],fs=7.5)
sk=[os.path.basename(p) for p in glob.glob(".claude/skills/aidv-*")]
P("元流程工具：6 個 /aidv skills（"+("、".join(sorted(sk)) if sk else "aidv-autodev/board/longloop/optimize/plan/workflow")+
  "）＋docs/plan SSOT（master-plan/dev-workflow）＋COORDINATION.md/AGENTS.md。卡狀態以 live Jira AIDV 為準。",9,1.2)

# 7 外部整合
pdf.add_page()
sec(7,"外部整合 / Webhook / OAuth")
rows=[
 ["Google OAuth 2.0","googleAuth.ts","替換 Manus OAuth；登入發自簽 JWT"],
 ["FAL webhook","AIDV-158","生成回呼：per-job token+簽章 fail-closed+replay idempotency"],
 ["Stripe webhook","STRIPE_WEBHOOK_SECRET","HMAC 驗章；prod 未設=fail-closed 503"],
 ["供應商門面","providerFacade","8 家 LLM/生成集中路由；CF AI Gateway 可選快取"],
 ["R2/S3","storage.ts","signed-URL 直傳（AIDV-15）+DB 備份"],
 ["Notion/雲端連接器","dataConnections","個人外部資料來源(餵 contextPacket)"],
]
table(["整合","位置/卡","守門/機制"],rows,[24,26,50],fs=7.5)

# 8 可觀測性
sec(8,"可觀測性 / 監控 / 排程")
P(f"背景排程 {len(D['jobs'])} 支 cron（讓容器 24/7 常駐，見成本報告）；監控 Sentry(取樣 10%)+global_audit_log+apiUsage 聚合+langsmith+circuitBreaker。",9)
rows=[[j["file"], j["desc"] or "-"] for j in D["jobs"][:18]]
table(["cron job","用途（檔頭註解）"],rows,[34,66],fs=6.8)

# 9 18 影片子系統
pdf.add_page()
sec(9,"18 影片子系統矩陣")
P("master-plan §1：影片 18 子系統＝8 ✅可接 / 10 ⚠半接 / 0 全空。可接者在 #862 導演台已接真實 procedure；"
  "半接者多缺金鑰或待後端（M3 段落狀態機/上傳/LoRA 等）。代表子系統：",9)
rows=[
 ["腳本(2-1)","✅","director.videoScriptTypes/generateVideoScript/importScript"],
 ["分鏡素材(2-3)","✅","generate.submitStudioJob->jobStatus->recordGenResult(fal)"],
 ["配音環境(2-5)","✅","proStudio.qwenTTS(無鑰)/elevenLabsTTS(需鑰)/soundEffects"],
 ["配樂(2-6)","✅","proStudio.textToMusic(fal；無 Suno 接點)"],
 ["FlowTV(2-12)","✅","promptLibrary.list/create/incrementUseCount+fork"],
 ["遊樂場(2-13)","✅","aiModels.list+director.generationModels"],
 ["上傳/外部帶入","⚠","digital_asset_library 缺 upload/external sourceStudio(待後端)"],
 ["段落狀態機 M3","⚠","video_generation_sessions/segment_jobs+generateSegment(待 Wave2/3)"],
 ["工作流持久化","⚠","user_workflows/workflow_steps(目前前端狀態)"],
 ["LoRA 微調(2-7~9)","⚠","loraTrainer.trainWithReplicate 需 REPLICATE_API_TOKEN"],
]
table(["子系統","狀態","接點 / 缺口"],rows,[26,12,62],fs=7)

# 10 提示詞庫
sec(10,"提示詞參考庫 / Slash 指令")
P(f"promptReferenceLibrary.ts {D['prompts']['promptReferenceLibrary_lines']} 行（站內可重用提示詞資產）+site-prompt-catalog+"
  f"slash-commands。Slash 指令（{len(D['prompts']['slash_commands'])}）：",9)
P("、".join(D["prompts"]["slash_commands"]) or "(見 shared/slash-commands.ts)",8.5,1,(40,60,110))
P("另：25 精靈各自的 system slice（人格+能力）也是提示詞資產；prompt_library 表存使用者生成的提示詞（去重 upsert-by-content），"
  "prompt_assets junction 連到生成的資產。",9,1.2)

# 11 詞彙表
pdf.add_page()
sec(11,"詞彙表（讀其他報告的鑰匙）")
gl=[
 ["四殼一脊椎","video/social/learn/settings 四殼 + Story Spine 脊椎（左欄 S0X 導航）"],
 ["S0X","脊椎導航主軸：專案->場景->鏡頭(S01/S02..)->角色任務樹"],
 ["readiness chip","就緒度標籤；點了 deep-link 到修復點"],
 ["確認門 / 成本階梯","高成本/刪除/權限前的 GateCard+常駐成本儀表"],
 ["光球四態","silent/hint/collab/critical（ambient 主張強度）；心情 idle/thinking/working/done"],
 ["Wave 0–4","開發階段：0 前端骨架/1 SSOT+接線/2 耐久任務/3 重後端基建/4 代理建置區"],
 ["Wave U / U-series","UIUX 視覺實裝 Epic(AIDV-74)；U-1..U-15 子卡"],
 ["Wave H / I","H 營運安全硬化 / I 現有功能整合"],
 ["旗標 strangler-fig","新功能躲旗標後預設 OFF、只加不刪、可秒回滾"],
 ["junction","prompt_assets 多對多關聯表（relation derived/variant/rewrite/extended）"],
 ["四態","empty/loading/error/success 面板狀態鐵律(PanelState)"],
 ["三鐵則","migration 可重跑守則（禁 IF NOT EXISTS/一句一 breakpoint/information_schema 守門）"],
 ["積分 pts","站內計費單位；1 USD=100 pts、1 pt=NT$0.315"],
]
table(["詞","解釋"],gl,[24,76],fs=7.5)

# 12 效能調節
sec(12,"效能 / 調節旋鈕（env）")
rows=[[k,v] for k,v in D["perf_env"]]
table(["環境變數","預設/值"],rows,[44,30],fs=7.5)
P("快取：server/_core/cache.ts LRU（CACHE_TTL_SECONDS 預設 300）；LLM 並行上限 MAX_CONCURRENT_LLM_CALLS（預設 5，超過排隊）；"
  "所有 LLM HTTP 呼叫 AbortSignal timeout LLM_TIMEOUT_SECONDS（60）；Sense 意圖推論 45s；Perplexity per-user/day+global/min 限流。"
  "CF AI Gateway 快取命中可直接省 LLM token（AIDV-11）。",9,1.2)

# 結語
pdf.ln(2);H("補完後的整體覆蓋",12,2,(20,90,40))
P("加上本輯 12 章，全套報告現涵蓋：任務卡/碼/DB 三方對比、AI 邏輯與底層演算法、UIUX 與整合、費用與每呼叫台幣、"
  "資安/測試/精靈/世界觀/ER/治理/整合/可觀測/影片矩陣/提示詞/詞彙/效能。仍屬動態資料——重跑解析器即刷新。",9.5,1.5,(20,70,120))

out="docs/reports/supplement-12-gaps.pdf"
os.makedirs("docs/reports",exist_ok=True);pdf.output(out)
print("WROTE",out,os.path.getsize(out),"bytes, pages:",pdf.page_no())
