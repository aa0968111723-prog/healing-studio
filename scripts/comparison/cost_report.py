# -*- coding: utf-8 -*-
import json, datetime, os, re, statistics
from collections import defaultdict
from fpdf import FPDF
FONT="/tmp/report_assets/wqy.ttf"
pricing=json.load(open("scripts/comparison/pricing.json"))
railway=json.load(open("scripts/comparison/railway.json"))

class PDF(FPDF):
    def header(self):
        if self.page_no()==1: return
        self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,5,"全站費用盤點與成本深度研究  ·  healing-studio (AI Director / director.today)",new_x="LMARGIN",new_y="NEXT",align="C")
        self.set_draw_color(220); self.line(self.l_margin,self.get_y(),self.w-self.r_margin,self.get_y()); self.ln(2); self.set_text_color(0)
    def footer(self):
        if self.page_no()==1: return
        self.set_y(-12); self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,8,f"第 {self.page_no()} 頁  ·  產出 {datetime.date.today().isoformat()}  ·  repo 成本碼＋2026-06 網路實價研究",align="C"); self.set_text_color(0)

pdf=PDF("P","mm","A4"); pdf.set_margins(10,12,10); pdf.set_auto_page_break(True,14)
pdf.add_font("wqy","",FONT); pdf.set_font("wqy",size=10); EPW=pdf.epw
_G={"✅":"[有]","🔄":"[進行]","📋":"[待]","⛔":"[擋]","🔴":"[紅]","⚠":"[注意]","️":"","•":"-","→":"->","≈":"~","×":"x","…":"...","—":"-","　":" ","💡":"[建議]","💰":"$"}
def S(x):
    if x is None:return ""
    x=str(x)
    for k,v in _G.items(): x=x.replace(k,v)
    return "".join(c if ord(c)<0x2700 or 0x4e00<=ord(c)<=0x9fff or 0x3000<=ord(c)<=0x30ff or 0xff00<=ord(c)<=0xffef else "" for c in x)
def H(t,s,g=2,col=(25,40,75),top=0):
    if top:pdf.ln(top)
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.46,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def P(t,s=9,g=1.2,col=(0,0,0)):
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.5,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def need(h):
    if pdf.get_y()+h>pdf.h-pdf.b_margin: pdf.add_page()
def table(headers,rows,widths,fs=7.5,head=(35,55,90)):
    lh=fs*0.42+1.0; sc=EPW/sum(widths); widths=[w*sc for w in widths]
    def dh():
        pdf.set_font("wqy",size=fs);pdf.set_fill_color(*head);pdf.set_text_color(255)
        y=pdf.get_y();x=pdf.l_margin;hh=1
        for i,c in enumerate(headers):
            hh=max(hh,len(pdf.multi_cell(widths[i]-1.6,lh,S(c),dry_run=True,output="LINES",new_x="RIGHT",new_y="TOP")))
        Hh=hh*lh+1
        for i,c in enumerate(headers):
            pdf.set_xy(x,y);pdf.multi_cell(widths[i],Hh,"",border=1,fill=True,new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.8,y+0.8);pdf.multi_cell(widths[i]-1.6,lh,S(c),new_x="RIGHT",new_y="TOP");x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+Hh);pdf.set_text_color(0)
    need(lh*2+6);dh();ri=0
    for row in rows:
        pdf.set_font("wqy",size=fs);cells=[S(v) for v in row];nl=1
        for i,t in enumerate(cells):
            nl=max(nl,len(pdf.multi_cell(widths[i]-1.6,lh,t,dry_run=True,output="LINES",new_x="RIGHT",new_y="TOP")))
        rh=nl*lh+1
        if pdf.get_y()+rh>pdf.h-pdf.b_margin: pdf.add_page();dh()
        y=pdf.get_y();x=pdf.l_margin
        fill=ri%2; 
        if fill:pdf.set_fill_color(245,247,251)
        for i,t in enumerate(cells):
            pdf.set_xy(x,y);pdf.multi_cell(widths[i],rh,"",border=1,fill=bool(fill),new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.8,y+0.6);pdf.multi_cell(widths[i]-1.6,lh,t,new_x="RIGHT",new_y="TOP");x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+rh);ri+=1

# ===== COVER =====
pdf.add_page();pdf.ln(22)
pdf.set_font("wqy",size=25);pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,12,S("全站費用盤點\n與成本深度研究"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(2);pdf.set_font("wqy",size=12);pdf.set_text_color(90,90,90)
pdf.multi_cell(EPW,7,"API 生成 · 基礎設施 · 營運 · 計費機制 · 你沒想到的隱藏成本",align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(6);pdf.set_text_color(0)
P("專案：healing-studio（AI Director / director.today）。本報告兩路資料交叉：①repo 內成本碼"
  "（server/services/modelPricing.ts 200 條模型定價、cost_ledger 帳本、currency.ts 匯率、.env.example 服務清單）；"
  "②2026-06 對各供應商官網/定價頁的網路實價研究（逐項附來源）。所有金額以 USD 計，內部積分 1 USD=100 pts，"
  "報表 USD->TWD 預設匯率 31.5（currency.ts，可由 USD_TO_TWD_RATE 覆寫）。",9,2,(70,70,70))
P("重要：本報告為成本『結構與單價』盤點，非帳單對帳；實際月費取決於真實用量。標『待接/缺金鑰』者目前未產生費用。",8.5,1,(150,30,30))


# ===== 1. 全站付費服務一覽 =====
pdf.add_page()
H("1. 全站付費服務一覽（用途 · 計費模式 · 2026 現行價 · 狀態）",15,2)
P("狀態：[有]=已接線生效 · [進行]=部分/旗標下 · [待]=規劃未接 · 缺金鑰=程式已備、未貼金鑰故不計費。",8,2,(90,90,90))
svc=[
 ["Railway","主機/部署（compute+RAM+egress+volume）","用量：$20/vCPU·月、$10/GB RAM·月、egress $0.05/GB、磁碟 $0.15/GB·月；Pro $20/席含$20","[有]","railway.com/pricing"],
 ["Cloudflare R2","媒體/上傳/DB 備份 物件儲存","儲存 $0.015/GB·月、egress $0（免費）、Class A $4.50/百萬、Class B $0.36/百萬；免費 10GB","[有]","developers.cloudflare.com/r2/pricing"],
 ["MySQL (DATABASE_URL)","主資料庫（87 表）","依供應商（PlanetScale/CloudSQL）；用量或固定方案","[有]","—"],
 ["Redis (Railway)","生成防重複鎖（AIDV-20）/未來快取","Railway Redis 服務＝另計 compute+RAM（小型約 $5–10/月）","缺金鑰","railway.com"],
 ["OpenRouter","統一 LLM 閘道（主路由）","購點 +5.5% 手續費；每 token 與直連同價","[有]","openrouter.ai"],
 ["Anthropic Claude","光球/代理主引擎（直連選用）","Haiku4.5 $1/$5、Sonnet4.6 $3/$15、Opus4.8 $5/$25（每百萬 in/out）；快取-90%、批次-50%","[有]","platform.claude.com/docs pricing"],
 ["Google Gemini/Vertex","LLM＋Imagen 圖像＋Veo 影片","Imagen3 ~$0.04/張、Veo2 ~$0.35/5s（catalog 參考）；Vertex 另計","[有]","—"],
 ["fal.ai","主力生成（圖/影/音/3D/訓練）151 模型","逐模型計：圖 $0.003–0.06、影片 $0.10–0.80、訓練 $1–5/次","缺金鑰","fal.ai（帳號頁為準）"],
 ["Replicate","LoRA 訓練備援","逐模型/秒計（需 REPLICATE_API_TOKEN）","缺金鑰","replicate.com"],
 ["ElevenLabs","語音/配音","API Pro $99/月、Scale $330/月；~1 credit/字元（Flash/Turbo 0.5）","缺金鑰","elevenlabs.io/pricing/api"],
 ["Suno","配樂（無官方 API）","官方訂閱制；第三方轉售 $0.014–0.111/首","缺金鑰","suno.com/pricing"],
 ["Perplexity Sonar","聯網研究（real-earth/news/learn）","Sonar $1/$1、Sonar Pro $3/$15（每百萬）＋每千次請求 $5–14（依 context）","[進行]","docs.perplexity.ai pricing"],
 ["Pinecone","向量記憶 RAG（現用）","儲存 ~$0.33/GB·月、讀 $8.25/百萬RU、寫 $2/百萬WU；Standard 月最低 $50；免費 2GB","[有]","pinecone.io/pricing"],
 ["Supabase","規劃遷移目標（pg+pgvector）","Pro $25/月含 250GB egress；egress $0.09/GB（快取 $0.03）","[待]","supabase.com/pricing"],
 ["Stripe","金流/儲值（webhook 已備）","標準 2.9% + $0.30/筆（台灣費率以帳號為準）","[進行]","stripe.com/pricing"],
 ["Sentry","錯誤/效能監控（取樣 10%）","Dev 免費 / Team 約 $26/月起（依事件量）","選用","sentry.io/pricing"],
 ["網域 director.today",".today TLD 年費","約 $20–30/年","[有]","—"],
 ["Forge (maps proxy)","地圖/butterfly-effect 代理","依方案（外部）","[進行]","forge.butterfly-effect.dev"],
 ["Email 寄送","驗證/重設密碼信（schema 有 token 表）","未見 Resend/SES/SMTP 金鑰＝寄送供應商尚未設定（潛在缺口）","缺金鑰","—"],
]
table(["服務","用途","計費模式 / 2026 現行價","狀態","來源"],svc,[20,30,72,12,28],fs=6.8,head=(35,55,90))

# ===== 2. API 生成成本（逐類） =====
pdf.add_page()
H("2. API 生成成本 — 依類別（repo modelPricing.ts 實價，200 模型）",14,2)
P("每類列：模型數、真實 USD 成本區間、中位數、平台積分（basePoints=baseCostUsd×100）。影片與訓練最貴；"
  "免費/便宜模型多為 fal flux-schnell（$0.003）等。所有單價以 fal/各家『帳號頁』為最終準。",8,2,(90,90,90))
bycat=defaultdict(list)
for e in pricing: bycat[e["category"]].append(e["baseCostUsd"])
CN={"text-to-image":"文字生圖","image-to-image":"圖生圖/控制","text-to-video":"文字生影片","image-to-video":"圖生影片",
 "video-to-video":"影片轉影片","text-to-speech":"語音合成 TTS","text-to-audio":"音樂/音效","audio-to-text":"語音轉文字",
 "video-to-audio":"影片配音","video-to-text":"影片轉文字","text-to-3d":"文字生 3D","image-to-3d":"圖生 3D",
 "llm":"LLM 文字","reasoning":"推理模型","training":"模型訓練/LoRA","image-to-json":"圖像理解","text-to-json":"結構化","embedding":"向量嵌入"}
rows=[]
for c in sorted(bycat,key=lambda k:-statistics.median(bycat[k])):
    v=sorted(bycat[c])
    rows.append([CN.get(c,c), str(len(v)), f"${min(v):.3f}–${max(v):.3f}", f"${statistics.median(v):.3f}",
                 f"{int(round(statistics.median(v)*100))} pts"])
table(["類別","模型數","USD 成本區間（每次）","中位數","中位積分"],rows,[30,12,30,16,16],fs=8,head=(40,70,55))
pdf.ln(1)
P("最貴類別：文字生影片（$0.15–0.80/支）、圖生影片（$0.10–0.55）、模型訓練（$1–5/次）。"
  "這三類是燒錢主力——一支 8 秒精修影片可能 $0.5–0.8，等於 50–80 積分；訓練一顆 LoRA 等於 100–500 積分。",8.5,1.5,(150,30,30))


# ===== 3. 基礎設施/營運固定成本（月估） =====
pdf.add_page()
H("3. 基礎設施 / 營運固定成本（每月估算）",14,2)
P("與用量較無關、近似固定的月度開銷。數字為『典型小型正式站』量級的估算區間，非帳單。",8,2,(90,90,90))
infra=[
 ["Railway 主容器","1 vCPU + 1 GB RAM 24/7（含多支 cron 無法縮到零）","$30/月（$20 CPU+$10 RAM）","cron：dbSnapshot/outbox/reconcile/autoCredit/r2Snapshot 讓容器常駐"],
 ["Railway Pro 訂閱","每席 $20/月（含 $20 用量額度）","$20/月","團隊席位另計"],
 ["Railway egress","出站流量 $0.05/GB","用量；媒體走 R2 直傳可避免","AIDV-15 signed-URL 直傳 R2＝省這條"],
 ["Redis 服務","Railway Redis（小型）","$5–10/月","AIDV-20；缺金鑰時不計"],
 ["MySQL 資料庫","託管 MySQL（PlanetScale/CloudSQL 等）","$0–29/月起","依供應商方案"],
 ["Cloudflare R2 儲存","媒體＋每日 DB 備份累積","$0.015/GB·月（前 10GB 免費）","備份每日 PutObject＝Class A，需 TTL 控制"],
 ["Pinecone 向量庫","RAG 記憶（halfvec 3072 維，單筆~6KB）","Standard 月最低 $50","遷 Supabase pgvector 後可降為 $0（含在 Pro）"],
 ["Supabase（遷移後）","pg + pgvector 取代 MySQL+Pinecone","Pro $25/月（含 250GB egress）","遷移期間可能 MySQL+Supabase 並存＝暫時雙倍"],
 ["Sentry 監控","錯誤/效能（取樣 10%）","$0–26/月","選用；事件量大才升級"],
 ["網域","director.today 年費","~$2/月（$20–30/年）","—"],
]
table(["項目","說明","月估","備註"],infra,[24,42,22,42],fs=7,head=(35,55,90))
pdf.ln(1)
P("固定基線概估：Railway ~$50（容器+訂閱+Redis）＋Pinecone $50（或遷 Supabase 後 $25）＋DB $0–29＋網域 $2＋"
  "監控 $0–26 ≈ 每月 $100–160 的『不生成也要付』底盤；其上才是隨用量浮動的 API 生成費。",8.5,1.5,(20,90,40))

# ===== 4. 計費 / 積分機制（內部經濟） =====
pdf.add_page()
H("4. 計費 / 積分機制與內部經濟（repo 實證）",14,2)
econ=[
 ["積分匯率","1 USD = 100 pts（shared/currency.ts POINTS_PER_USD）","使用者看 pts，後台換算 USD/TWD"],
 ["USD->TWD","預設 31.5（DEFAULT_USD_TO_TWD_RATE，可由 USD_TO_TWD_RATE 覆寫）","落帳當下凍結匯率（AIDV-14）＋稽核欄"],
 ["新用戶免費額度","remainingGenerations 預設 50（schema users）","= 直接補貼：50 次生成成本由平台吸收"],
 ["自動補點","autoCreditAmount 預設 0 / 每 7 天（預設關）","開啟＝週期性免費補貼（userAutoCreditJob cron）"],
 ["計費公式","basePoints + 時長×秒費 + 字數×千字費 + 張數×張費 + 訓練步數×步費，clamp[min,max]","modelPricing.ts estimatePoints"],
 ["成本落帳","真實 costUsd（非估算）→cost_ledger；多維歸屬 member/project/workflow","AIDV-14；outbox 不漏帳＋彙總淨額"],
 ["失敗全退","估→原子扣→失敗全額退點（AIDV-160 成本同意守門）","注意：供應商可能仍對失敗/部分生成收費＝平台淨損"],
 ["免費引擎紅線","選免費引擎絕不無聲回退付費並扣點（AIDV-160）","創作者紅線：不偷扣"],
]
table(["機制","規則（原碼）","影響/備註"],econ,[20,58,42],fs=7.5,head=(40,55,90))
pdf.ln(1)
P("免費額度的真實補貼成本：50 次若都是 flux-pro 圖（$0.04）＝$2/人；若含影片（$0.3–0.8/支）可達 $15–40/人。"
  "新用戶湧入或濫用（多帳號）會直接放大這筆補貼——這是最容易被低估的成本。",8.5,1.5,(150,30,30))


# ===== 5. 你可能沒想到的隱藏 / 易漏成本 =====
pdf.add_page()
H("5. 你可能沒想到的隱藏 / 易漏成本（重點）",15,2,(150,30,30))
P("以下每一項都對應 repo 內真實機制或本研究查到的計價細節，最容易在估算時被漏掉：",8.5,2,(90,90,90))
hidden=[
 ["失敗仍付費","失敗/部分生成平台對使用者全額退點，但供應商常已對該次 API 收費 → 淨損漏帳","落帳記 costUsd；建議追蹤『退點但已付費』差額"],
 ["LLM 重試疊加","classifyLLMError 把暫時錯誤判 transient→重試，一次邏輯請求＝多次付費 token","AIDV-165 invalid_model 曾誤重試燒錢；已修為 permanent_model 不重試"],
 ["Perplexity 請求費","每千次請求 $5–14（依 context 大小）是在 token 費『之上』，極易漏算","research/news/learn/real-earth 多處呼叫＝請求費累積"],
 ["OpenRouter 5.5%","走統一閘道方便，但每筆比直連 Anthropic 貴 5.5%","$1000/月 LLM＝多付 $55/月"],
 ["多代理 token 乘數","光球＋25 精靈＋global agent 編排，每回合都是 token；多代理＝成倍 token","orchestrator/critic/verifier 各自呼叫 LLM"],
 ["Pinecone 月最低","Standard 即使幾乎沒用也月付 $50 門檻","這正是 AIDV-18 遷 Supabase pgvector 想省掉的"],
 ["向量維度成本","halfvec(3072) 單筆~6KB，記憶/RAG 條目越多儲存越貴","HNSW 索引另佔空間"],
 ["R2 操作費","egress 免費，但 PutObject/上傳=Class A($4.50/百萬)、magic-byte GetObject=Class B","AIDV-64 每次上傳多一次 Range GetObject"],
 ["DB 備份累積","每日 mysqldump→R2，無 TTL 會無限長大→儲存費爬升","建議 lifecycle 保留 N 天"],
 ["容器無法縮零","多支 cron（備份/對帳/補點/快照）讓 Railway 容器 24/7 常駐，付滿月","compute 是固定底盤"],
 ["Railway 記憶體尖峰","上傳走 base64-over-tRPC 會吃 RAM（$10/GB·月）","AIDV-15 signed-URL 直傳＝省 RAM 與 egress"],
 ["FX 匯率風險","成本記 USD、報表/收費換 TWD，匯率波動侵蝕毛利","cost_ledger 凍結匯率僅供對帳，不對沖風險"],
 ["Stripe 固定費","每筆 +$0.30；小額儲值被 $0.30 吃掉比例高","鼓勵較大額儲值包"],
 ["訓練最貴","LoRA 訓練 $1–5/次（pointsPerStep×步數），少量用戶就拉高帳單","fal/replicate；缺金鑰時未啟用"],
 ["遷移期雙跑","MySQL→Supabase 切換期間兩庫並存＝暫時雙倍 DB 費","規劃排在任務耐久化之後"],
 ["免費額度濫用","50 免費生成×多帳號＝補貼放大；無防濫用＝成本破口","建議裝置/IP/驗證門檻"],
 ["Sentry 取樣量","traces 取樣 10%，流量大時事件量→升級方案","SENTRY_TRACES_SAMPLE_RATE 可調"],
 ["Webhook 重試","fal webhook+polling 雙路徑，若不冪等可能重複觸發下游/重複計費","已用唯一鍵/idempotency 守門（AIDV-158/163）"],
]
table(["項目","為什麼會漏 / 機制","對策 / repo 對應"],hidden,[22,52,46],fs=7,head=(120,40,40))

# ===== 6. 成本優化建議 =====
pdf.add_page()
H("6. 成本優化建議（多數已在卡上）",14,2,(20,90,40))
opt=[
 ["Cloudflare AI Gateway","免費快取/觀測 LLM 回應，重複問答直接命中快取省 token","AIDV-11 已接（CF_AI_GATEWAY_*）"],
 ["Prompt caching","Claude 快取輸入 -90%；系統提示/精靈人格固定段落最適合","目前未明確啟用＝可省"],
 ["Batch 批次","Claude 批次 -50%；非即時任務（補登記/分析）可走","可評估"],
 ["signed-URL 直傳","大檔不過 Node＝省 Railway RAM＋egress＋不重複儲存","AIDV-15 已上（預設 ON 可回退）"],
 ["遷 Supabase 退役 Pinecone","pgvector 併入 Pro $25，省 Pinecone $50 月最低","AIDV-18（缺金鑰，排耐久化後）"],
 ["免費引擎優先","遊樂場/試生成優先 flux-schnell($0.003)/imagen-fast($0.01)","registry 已分 tier"],
 ["R2 lifecycle","DB 備份/暫存設 TTL，避免儲存無限長","建議補 lifecycle rule"],
 ["成本同意守門","高價生成前先估＋確認門，避免誤觸貴模型","AIDV-160 成本常駐儀表"],
 ["免費額度防濫用","Email 驗證＋裝置/IP 限制，降低多帳號補貼破口","emailVerified 已有，可加限制"],
]
table(["手段","效益","狀態 / 卡"],opt,[26,56,30],fs=7.5,head=(40,90,55))

# ===== 7. 範例每月帳單情境 =====
H("7. 範例每月帳單情境（量級概估，非報價）",13,2,top=3)
P("假設：固定底盤＝Railway $50＋Pinecone $50＋DB $10＋網域/監控 $5 ≈ $115/月。其上隨用量：",8.5,1.5,(90,90,90))
scen=[
 ["啟動期（缺生成金鑰）","底盤 $115；LLM 少量（OpenRouter）$5–20；無圖/影/音生成","約 $120–135/月"],
 ["小量上線（100 活躍用戶）","底盤 $115＋圖像 $20–60＋少量影片 $30–120＋LLM/研究 $20–60","約 $185–355/月"],
 ["成長期（1000 用戶·含影片）","底盤 $140（升配）＋影片為主 $300–1200＋LLM/研究 $100–300＋語音/音樂 $50–200","約 $590–1840/月"],
]
table(["情境","主要組成","月費量級"],scen,[34,56,22],fs=8,head=(35,55,90))
P("結論：①不生成也有約 $115/月底盤（Railway+Pinecone 為大宗，遷 Supabase 可砍 Pinecone）；"
  "②一旦開影片生成，單項就可能蓋過所有基礎設施——影片是頭號成本中心，務必前置成本確認門；"
  "③免費 50 額度＋自動補點是隱性補貼，規模化前要先設防濫用與儲值轉換。",8.5,1.5,(20,90,40))

out="docs/reports/website-cost-analysis.pdf"
os.makedirs("docs/reports",exist_ok=True); pdf.output(out)
print("WROTE",out,os.path.getsize(out),"bytes, pages:",pdf.page_no())
