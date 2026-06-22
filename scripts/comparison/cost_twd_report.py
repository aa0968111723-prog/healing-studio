# -*- coding: utf-8 -*-
import datetime, os, json, statistics, math
from collections import defaultdict
from fpdf import FPDF
FONT="/tmp/report_assets/wqy.ttf"
E=json.load(open("scripts/comparison/pricing_full.json"))
FX=31.5  # DEFAULT_USD_TO_TWD_RATE (shared/currency.ts)
PT=0.01*FX  # 1 pt = 0.01 USD = NT$0.315

class PDF(FPDF):
    def header(self):
        if self.page_no()==1: return
        self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,5,f"每個 API 呼叫 -> 真實台幣 換算表（FX {FX} NT$/US$）· healing-studio",new_x="LMARGIN",new_y="NEXT",align="C")
        self.set_draw_color(220); self.line(self.l_margin,self.get_y(),self.w-self.r_margin,self.get_y());self.ln(2);self.set_text_color(0)
    def footer(self):
        if self.page_no()==1: return
        self.set_y(-12);self.set_font("wqy",size=7);self.set_text_color(150)
        self.cell(0,8,f"第 {self.page_no()} 頁 · 動態資料快照 {datetime.date.today().isoformat()}（持續新增/更新）· 單價以各家帳號頁為最終準",align="C");self.set_text_color(0)
pdf=PDF("P","mm","A4");pdf.set_margins(8,12,8);pdf.set_auto_page_break(True,14)
pdf.add_font("wqy","",FONT);pdf.set_font("wqy",size=10);EPW=pdf.epw
_G={"→":"->","×":"x","—":"-","…":"...","　":" ","•":"-","≈":"~","−":"-"}
def S(x):
    if x is None:return ""
    x=str(x)
    for k,v in _G.items(): x=x.replace(k,v)
    return "".join(c if ord(c)<0x2700 or 0x4e00<=ord(c)<=0x9fff or 0x3000<=ord(c)<=0x30ff or 0xff00<=ord(c)<=0xffef else "" for c in x)
def H(t,s,g=2,col=(25,40,75),top=0):
    if top:pdf.ln(top)
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.46,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def P(t,s=8.6,g=1.2,col=(0,0,0)):
    pdf.set_font("wqy",size=s);pdf.set_text_color(*col);pdf.multi_cell(EPW,s*0.52,S(t),new_x="LMARGIN",new_y="NEXT");pdf.set_text_color(0);pdf.ln(g)
def table(headers,rows,widths,fs=7,head=(35,55,90)):
    lh=fs*0.46+1.0;sc=EPW/sum(widths);widths=[w*sc for w in widths]
    def dh():
        pdf.set_font("wqy",size=fs);pdf.set_fill_color(*head);pdf.set_text_color(255)
        y=pdf.get_y();x=pdf.l_margin
        for i,c in enumerate(headers):
            pdf.set_xy(x,y);pdf.multi_cell(widths[i],lh+1,"",border=1,fill=True,new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.6,y+0.6);pdf.multi_cell(widths[i]-1.2,lh,S(c),new_x="RIGHT",new_y="TOP");x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+lh+1);pdf.set_text_color(0)
    need=lh*2+6
    if pdf.get_y()+need>pdf.h-pdf.b_margin: pdf.add_page()
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

def mult(e):
    s=[]
    if e.get("pointsPerSecond"): s.append(f"+{e['pointsPerSecond']:g}pts/秒"+(f"(起跳{e['freeSecondsInBase']:g}s)" if e.get("freeSecondsInBase") else ""))
    if e.get("pointsPer1kChars"): s.append(f"+{e['pointsPer1kChars']:g}pts/千字")
    if e.get("pointsPerImage"): s.append(f"+{e['pointsPerImage']:g}pts/張")
    if e.get("pointsPerStep"): s.append(f"+{e['pointsPerStep']:g}pts/步")
    return " ".join(s) or "-"

# ===== COVER =====
pdf.add_page();pdf.ln(20)
pdf.set_font("wqy",size=24);pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,12,S("每個 API 呼叫 -> 真實台幣"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(1);pdf.set_font("wqy",size=12.5);pdf.set_text_color(90,90,90)
pdf.multi_cell(EPW,7,f"200 個生成模型逐一換算 · FX {FX} NT$/US$ · 含加乘規則與實算範例",align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(3);pdf.set_font("wqy",size=10);pdf.set_text_color(150,30,30)
pdf.multi_cell(EPW,6,S(f"* 動態資料（持續新增/更新）· 快照 {datetime.date.today().isoformat()} · 單價以各家帳號頁為最終準 *"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(6);pdf.set_text_color(0)
P("換算基準（shared/currency.ts / server/services/modelPricing.ts）：①真實成本以 USD 計（baseCostUsd，每次呼叫基線）。"
  f"②匯率預設 {FX} NT$/US$（DEFAULT_USD_TO_TWD_RATE，可由 USD_TO_TWD_RATE 覆寫）。③站內積分 1 USD = 100 pts，"
  f"∴ 1 pt = NT${PT:.3f}、NT$1 ≈ {1/PT:.2f} pts。④變動成本（影片時長/TTS 字數/批次張數/訓練步數）按加乘額外計，"
  "最後 clamp 到 [minPoints, maxPoints]。下表『真實 NT$』= baseCostUsd × 匯率（每次基線，未含加乘）；變動部分見實算範例。",9,2,(70,70,70))
# quick stats
allt=sorted(e["baseCostUsd"]*FX for e in E)
P(f"全 200 模型每次基線真實成本：最低 NT${min(allt):.2f}、中位 NT${statistics.median(allt):.2f}、最高 NT${max(allt):.2f}。"
  "影片與訓練居高、flux-schnell 等便宜模型墊底。",9,1,(20,90,40))

# ===== 逐模型表（依類別） =====
CN={"text-to-image":"文字生圖","image-to-image":"圖生圖/控制","text-to-video":"文字生影片","image-to-video":"圖生影片",
 "video-to-video":"影片轉影片","text-to-speech":"語音 TTS","text-to-audio":"音樂/音效","audio-to-text":"語音轉文字",
 "video-to-audio":"影片配音","video-to-text":"影片轉文字","text-to-3d":"文字生 3D","image-to-3d":"圖生 3D",
 "llm":"LLM 文字","reasoning":"推理","training":"模型訓練/LoRA","image-to-json":"圖像理解","text-to-json":"結構化","embedding":"向量嵌入"}
bycat=defaultdict(list)
for e in E: bycat[e["category"]].append(e)
order=sorted(bycat,key=lambda k:-statistics.median([x["baseCostUsd"] for x in bycat[k]]))
pdf.add_page()
H("逐模型：每次 API 呼叫真實台幣（基線，未含加乘）",13,2)
P(f"欄：模型 · 單位 · 真實 US$ · 真實 NT$(@{FX}) · 平台積分 · 加乘規則 · 需金鑰。「真實」=供應商成本基線。",8,1.5,(90,90,90))
for cat in order:
    items=sorted(bycat[cat],key=lambda x:-x["baseCostUsd"])
    H(f"{CN.get(cat,cat)}（{len(items)} 模型）",10.5,1.5,(35,55,90),top=2)
    rows=[]
    for e in items:
        rows.append([e["modelId"].replace("fal-ai/","f/"), e.get("unit") or "-",
                     f"${e['baseCostUsd']:.3f}", f"NT${e['baseCostUsd']*FX:.2f}",
                     f"{e.get('basePoints') or '-':g}" if isinstance(e.get('basePoints'),(int,float)) else "-",
                     mult(e), "是" if e.get("requiresKey") else ""])
    table(["模型","單位","真實US$","真實NT$","積分","加乘規則","金鑰"],rows,[46,16,13,15,8,30,7],fs=6.6)


# ===== 實算範例（變動成本） =====
pdf.add_page()
H("變動成本實算範例（base + 加乘 -> 積分 -> US$ -> NT$）",13,2)
P("公式：total_pts = base + round(max(0,秒−起跳)×每秒) + ceil(字/1000×每千字) + max(0,張−1)×每張 + 步×每步，"
  "再 clamp[min,max]。US$ = pts/100；NT$ = US$ × 31.5。下列取代表性模型實算：",8.5,1.5,(90,90,90))
def find(mid):
    for e in E:
        if e["modelId"]==mid: return e
    return None
def calc(e,sec=0,chars=0,imgs=0,steps=0):
    t=e["basePoints"] or 0
    if sec and e.get("pointsPerSecond"):
        free=e.get("freeSecondsInBase") or 0; t+=round(max(0,sec-free)*e["pointsPerSecond"])
    if chars and e.get("pointsPer1kChars"): t+=math.ceil(chars/1000*e["pointsPer1kChars"])
    if imgs and e.get("pointsPerImage"): t+=max(0,imgs-1)*e["pointsPerImage"]
    if steps and e.get("pointsPerStep"): t+=steps*e["pointsPerStep"]
    mn=e.get("minPoints") or 0; mx=e.get("maxPoints")
    if mx: t=min(t,mx)
    t=max(t,mn)
    return t
examples=[
 ("fal-ai/kling-video/v2.1/standard/text-to-video","5 秒影片",dict(sec=5)),
 ("fal-ai/kling-video/v2.1/standard/text-to-video","10 秒影片",dict(sec=10)),
 ("fal-ai/kling-video/v2.1/pro/text-to-video","10 秒影片(Pro)",dict(sec=10)),
 ("elevenlabs/eleven-v3","1000 字配音",dict(chars=1000)),
 ("elevenlabs/eleven-v3","5000 字配音",dict(chars=5000)),
 ("fal-ai/flux/schnell","單張圖",dict(imgs=1)),
 ("fal-ai/flux/schnell","批次 10 張",dict(imgs=10)),
 ("fal-ai/flux-lora-fast-training","LoRA 1000 步",dict(steps=1000)),
 ("fal-ai/flux-lora-portrait-trainer","LoRA 1500 步",dict(steps=1500)),
]
rows=[]
for mid,desc,kw in examples:
    e=find(mid)
    if not e: continue
    pts=calc(e,**kw)
    rows.append([mid.replace("fal-ai/","f/"),desc,f"{e['basePoints']:g} pts",mult(e),
                 f"{pts:g} pts",f"${pts/100:.3f}",f"NT${pts/100*FX:.2f}"])
table(["模型","情境","基線積分","加乘","總積分","US$","真實 NT$"],rows,[40,22,14,26,12,12,14],fs=7)
pdf.ln(1)
P("讀法：同一支 Kling Standard，5 秒 NT$ 與 10 秒 NT$ 差一倍——影片成本對『秒數』極敏感；TTS 對『字數』、LoRA 對『步數』同理。"
  "這就是為什麼影片要做雙層（草稿選版再精修），以及為什麼長配音/大步數訓練要前置成本確認門。",8.5,1.5,(150,30,30))

# ===== 積分 <-> 台幣 速查 + FX 敏感度 =====
H("積分 <-> 台幣 速查",12,2,(35,55,90),top=2)
rows=[[f"{p} pts",f"${p/100:.2f}",f"NT${p/100*FX:.2f}"] for p in [1,5,10,30,50,100,200,500]]
table(["積分","US$","NT$@31.5"],rows,[14,14,16],fs=8)
H("匯率敏感度（同一筆成本，匯率不同的 NT$）",12,2,(35,55,90),top=2)
samp=[("flux-schnell 單圖",0.003),("flux-pro 單圖",0.04),("Kling Std 5s",0.30),("Veo 8s 級",0.55),("LoRA base",2.0)]
rows=[[n,f"${u:.3f}",f"NT${u*31.5:.2f}",f"NT${u*32.5:.2f}",f"NT${u*33.5:.2f}"] for n,u in samp]
table(["項目","US$","@31.5","@32.5","@33.5"],rows,[26,12,14,14,14],fs=8)
P("匯率每升 1 元，成本約增 3%——成本記 USD、收費/報表換 TWD，匯率波動直接侵蝕毛利（cost_ledger 落帳當下凍結匯率僅供對帳、不對沖）。",8.5,1.2,(150,30,30))

# ===== Top 貴/便宜 + 細節註記 =====
H("每次基線最貴 / 最便宜（真實 NT$）",12,2,(35,55,90),top=2)
srt=sorted(E,key=lambda e:-e["baseCostUsd"])
top=[[e["modelId"].replace("fal-ai/","f/"),f"NT${e['baseCostUsd']*FX:.2f}",e["category"]] for e in srt[:6]]
bot=[[e["modelId"].replace("fal-ai/","f/"),f"NT${e['baseCostUsd']*FX:.2f}",e["category"]] for e in srt[-6:]]
table(["最貴 6（基線）","NT$","類別"],top,[40,14,24],fs=7.5,head=(120,40,40))
pdf.ln(1)
table(["最便宜 6（基線）","NT$","類別"],bot,[40,14,24],fs=7.5,head=(40,90,55))
H("細節與注意",12,2,(150,30,30),top=2)
for t in [
 "『真實 NT$』是供應商成本基線（baseCostUsd），不是平台向使用者收的錢；使用者付的是積分（basePoints，已含起跳量）。",
 "影片價以 fal 帳號頁為最終準（avoidance 卡 caution）；catalog 數字為參考，實際以帳單為憑。",
 "訓練（LoRA）按步數線性增：1000 步約 +100 pts、1500 步約 +180 pts，base 之上疊加，是單筆最貴情境之一。",
 "ElevenLabs catalog 採『平台補貼價』(~4 pts/千字)，低於其官方 ~$0.18/千字真實成本——這段差額是平台補貼。",
 "免費/便宜引擎（flux-schnell $0.003=NT$0.09、imagen-fast）優先用於試生成，可大幅壓低試錯成本。",
 "clamp[min,max]：極端參數不會無限暴衝（maxPoints 上限）也不低於 minPoints，保護雙方。",
 f"全表 FX={FX}；線上實際匯率改 USD_TO_TWD_RATE 後，所有 NT$ 同步重算（動態）。",
]: P("[*] "+t,8.5,0.9,(60,60,60))

out="docs/reports/api-call-cost-twd.pdf"
os.makedirs("docs/reports",exist_ok=True);pdf.output(out)
print("WROTE",out,os.path.getsize(out),"bytes, pages:",pdf.page_no())
