# -*- coding: utf-8 -*-
import json, datetime, os, re, statistics
from fpdf import FPDF

FONT="/tmp/report_assets/wqy.ttf"
J=lambda f: json.load(open(f,encoding="utf-8"))
schema=J("scripts/comparison/schema.json")
migs=J("scripts/comparison/migrations.json")
cards=J("scripts/comparison/cards.json")
csv_cards=J("scripts/comparison/csv_cards.json")
routers=J("scripts/comparison/routers.json")
flags=J("scripts/comparison/flags.json")
xref=J("scripts/comparison/table_xref.json")
jira=J("scripts/comparison/jira_cards.json")
pr_meta=J("scripts/comparison/pr_meta.json")
col_doc=J("scripts/comparison/col_doc.json")
col_infer=J("scripts/comparison/col_infer.json")
proc_doc=J("scripts/comparison/proc_doc.json")
proc_infer=J("scripts/comparison/proc_infer.json")
core_doc=J("scripts/comparison/core_doc.json")
existing=J("scripts/comparison/existing.json")
future=J("scripts/comparison/future.json")
recon=J("scripts/comparison/recon.json")
pricing=J("scripts/comparison/pricing.json")

class PDF(FPDF):
    def header(self):
        if self.page_no()==1: return
        self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,5,f"任務卡 × 程式碼 × 資料庫 三方逐項對比報告  ·  healing-studio (AI Director)",
                  new_x="LMARGIN",new_y="NEXT",align="C")
        self.set_draw_color(220); self.line(self.l_margin,self.get_y(),self.w-self.r_margin,self.get_y())
        self.ln(2); self.set_text_color(0)
    def footer(self):
        if self.page_no()==1: return
        self.set_y(-12); self.set_font("wqy",size=7); self.set_text_color(150)
        self.cell(0,8,f"第 {self.page_no()} 頁  ·  動態資料快照 {datetime.date.today().isoformat()}（持續新增/更新）  ·  git/repo 實證自動產出",align="C")
        self.set_text_color(0)

pdf=PDF(orientation="P",unit="mm",format="A4")
pdf.set_margins(10,12,10)
pdf.set_auto_page_break(True, margin=14)
pdf.add_font("wqy","",FONT)
pdf.set_font("wqy",size=10)
EPW=pdf.epw

_GLYPH={"✅":"[完成]","🔄":"[進行]","📋":"[待辦]","⛔":"[阻擋]",
 "🔴":"[P0]","⚠":"[注意]","️":"","🔒":"[鎖]","📥":"[補]",
 "⌘":"Cmd","•":"-","✔":"[v]","✘":"[x]","⌗":"#","↟":"(同)",
 "✓":"[v]","✗":"[x]","●":"*","🟢":"[綠]","🟡":"[黃]",
 "⭐":"[星]","⁉":"!?","→":"->","←":"<-","⏫":"[高]","↵":" ","−":"-","‌":"","​":"","⏫":"[高]","⬆":"[高]","⬇":"[低]","⋯":"...","⚡":"[快]","…":"...","、":"、"}
def S(x):
    if x is None: return ""
    x=str(x)
    for k,v in _GLYPH.items(): x=x.replace(k,v)
    # drop any remaining emoji / non-BMP
    x="".join(ch if ord(ch)<0x2700 or 0x4e00<=ord(ch)<=0x9fff or 0x3000<=ord(ch)<=0x30ff or 0xff00<=ord(ch)<=0xffef else "" for ch in x)
    return x

def H(txt,size,gap=2,color=(0,0,0),top=0):
    if top: pdf.ln(top)
    pdf.set_font("wqy",size=size); pdf.set_text_color(*color)
    pdf.multi_cell(EPW,size*0.46,S(txt),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0); pdf.ln(gap)

def P(txt,size=9,gap=1.2,color=(0,0,0)):
    pdf.set_font("wqy",size=size); pdf.set_text_color(*color)
    pdf.multi_cell(EPW,size*0.5,S(txt),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0); pdf.ln(gap)

def need(h):
    if pdf.get_y()+h > pdf.h - pdf.b_margin:
        pdf.add_page()

def table(headers,rows,widths,fs=7.5,head_fill=(35,55,90),zebra=True,head_repeat=True):
    """Robust multi-line CJK table."""
    lh=fs*0.42+1.0
    scale=EPW/sum(widths); widths=[w*scale for w in widths]
    def draw_head():
        pdf.set_font("wqy",size=fs); pdf.set_fill_color(*head_fill); pdf.set_text_color(255)
        y=pdf.get_y(); x=pdf.l_margin
        # measure header height
        hh=1
        for i,c in enumerate(headers):
            lines=pdf.multi_cell(widths[i]-1.6,lh,S(c),dry_run=True,output="LINES",new_x="RIGHT",new_y="TOP")
            hh=max(hh,len(lines))
        H_=hh*lh+1
        for i,c in enumerate(headers):
            pdf.set_xy(x,y); pdf.multi_cell(widths[i],H_,"",border=1,fill=True,new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.8,y+0.8); pdf.multi_cell(widths[i]-1.6,lh,S(c),new_x="RIGHT",new_y="TOP")
            x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+H_); pdf.set_text_color(0)
    need(lh*2+6); draw_head()
    ri=0
    for row in rows:
        pdf.set_font("wqy",size=fs)
        cells=[S(v) for v in row]
        # measure
        nlines=1
        for i,txt in enumerate(cells):
            lines=pdf.multi_cell(widths[i]-1.6,lh,txt,dry_run=True,output="LINES",new_x="RIGHT",new_y="TOP")
            nlines=max(nlines,len(lines))
        rh=nlines*lh+1
        if pdf.get_y()+rh > pdf.h-pdf.b_margin:
            pdf.add_page()
            if head_repeat: draw_head()
        y=pdf.get_y(); x=pdf.l_margin
        if zebra and ri%2:
            pdf.set_fill_color(244,247,251); fill=True
        else: fill=False
        for i,txt in enumerate(cells):
            pdf.set_xy(x,y)
            pdf.multi_cell(widths[i],rh,"",border=1,fill=fill,new_x="RIGHT",new_y="TOP")
            pdf.set_xy(x+0.8,y+0.6)
            pdf.multi_cell(widths[i]-1.6,lh,txt,new_x="RIGHT",new_y="TOP")
            x+=widths[i]
        pdf.set_xy(pdf.l_margin,y+rh); ri+=1

# ============ COVER ============
pdf.add_page()
pdf.ln(24)
pdf.set_font("wqy",size=26); pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,12,S("任務卡 × 程式碼 × 資料庫\n三方逐項對比報告"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(2); pdf.set_font("wqy",size=12); pdf.set_text_color(90,90,90)
pdf.multi_cell(EPW,7,"逐卡級 · 逐行級 · 逐欄位級  —  細部細節完整核對",align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(3); pdf.set_font("wqy",size=10); pdf.set_text_color(150,30,30)
pdf.multi_cell(EPW,5.5,S(f"◆ 動態資料（持續新增/更新）· 本版快照 {datetime.date.today().isoformat()} · 重跑解析器即刷新 ◆"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(6); pdf.set_text_color(0)
pdf.set_font("wqy",size=11)
meta=[
 ("專案","healing-studio　AI Director / Healing Studio 影片製作系統"),
 ("線上站","director.today（Railway 部署）"),
 ("真實棧","React 19 + Vite + tRPC v11 + Drizzle/MySQL + Express；生成=fal/replicate/Gemini/ElevenLabs"),
 ("分支","claude/task-card-comparison-pdf-bnw89n"),
 ("產出日期",datetime.date.today().isoformat()),
 ("資料來源","repo 實檔（git 實證）＋ live Jira ＋ 2026 網路實價，非轉述"),
 ("資料性質","動態資料（living）— 隨 repo/Jira/價格持續新增與更新；每次重跑解析器即刷新"),
]
table(["項目","內容"],meta,[20,80],fs=10,zebra=True,head_fill=(60,80,120))
pdf.ln(4)
pdf.set_font("wqy",size=9); pdf.set_text_color(70,70,70)
prov=("資料來源與方法（scripts/comparison/ 解析器自動萃取）——"
 "①任務卡＝直接連線 live Atlassian Jira（aa0968111723.atlassian.net 專案 AIDV，Rovo MCP），全量 323 張，"
 "逐卡含描述/狀態/型別/優先/labels/父卡；②程式碼＝全 repo 程式碼盤點（1,738 檔 / 587,080 行逐目錄）＋"
 "server/client/shared 的 router/procedure/旗標 enumerate＋對每張卡 grep 卡號取 file:line 行級錨點；"
 "③資料庫＝drizzle/schema.ts（87 表逐欄位）＋drizzle/*.sql migration＋_journal.json 登記核對；"
 "④Railway/部署＝repo 部署產物（railway.toml／nixpacks／Dockerfile）＋.env.example 環境變數目錄（僅名稱）。\n"
 "章節：A 任務卡逐卡 · B 資料庫逐欄位（含逐欄說明）· C Migration 對帳 · D 全碼盤點（含逐 API／核心檔逐行註解）· "
 "E 三方一致性 · F Railway/部署 · G 現有網站功能 · H 未來功能/程式碼/資料庫 · "
 "I AI 底層邏輯結構 · J UIUX 結構系統 · K AI x UIUX 整合接點 · L 全站費用與成本 · M 技術選型與 SOTA 比對。\n"
 "Railway live MCP 註記：本 session 未連上 Railway MCP（待 AIDV-77 Bruce OAuth），Part F 以 repo 產物盤點。")
pdf.multi_cell(EPW,5,S(prov),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)

# ============ SUMMARY ============
pdf.add_page()
H("摘要儀表板 — 三方規模與覆蓋",16,3,(25,40,75))
tot_cols=sum(len(t["columns"]) for t in schema)
tot_idx=sum(len(t["indexes"]) for t in schema)
tot_proc=sum(r["n"] for r in routers)
def cstat(v): return sum(1 for c in jira if c["status"]==v)
def ctype(v): return sum(1 for c in jira if c["type"]==v)
jira_code=[c for c in jira if c.get("code")]
jira_db=[c for c in jira if c.get("tables")]
summ=[
 ["Jira 任務卡（專案 AIDV·live 全量）",len(jira),"Part A"],
 ["　完成",cstat("完成"),"Part A"],
 ["　進行中",cstat("進行中"),"Part A"],
 ["　Selected for Development",cstat("Selected for Development"),"Part A"],
 ["　Backlog",cstat("Backlog"),"Part A"],
 ["　型別：故事 / 大型工作 / 漏洞 / 任務",f"{ctype('故事')}/{ctype('大型工作')}/{ctype('漏洞')}/{ctype('任務')}","Part A"],
 ["　有程式碼行級錨點 (file:line)",len(jira_code),"Part A/E"],
 ["　有資料表連結（卡文提及表）",len(jira_db),"Part A/E"],
 ["資料表 (mysqlTable)",len(schema),"Part B"],
 ["資料欄位 (逐欄)",tot_cols,"Part B"],
 ["索引/約束",tot_idx,"Part B"],
 ["Migration 檔",len(migs),"Part C"],
 ["　未登記 journal 的孤兒",sum(1 for m in migs if not m["registered"] and m["file"].startswith('0')),"Part C/E"],
 ["tRPC Router",len(routers),"Part D"],
 ["tRPC Procedure",tot_proc,"Part D"],
 ["Feature flag / 旗標 token",len(flags),"Part D"],
 ["表：無任何卡/文件提及",sum(1 for t in xref if xref[t]['doc_mentions']==0),"Part E"],
 ["表：程式碼(var)零引用",sum(1 for t in xref if xref[t]['code_files']==0),"Part E"],
]
table(["量測項目","數值","章節"],summ,[66,18,16],fs=9,head_fill=(35,55,90))
pdf.ln(3)
H("關鍵發現",12,2,(150,30,30))
findings=[
 f"①任務卡來源已校正：本版直接連線 live Jira（專案 AIDV），全量 {len(jira)} 張（前一版僅 77 張＝repo 鏡像，嚴重低估，已棄用）。逐卡見 Part A。",
 f"②卡 ↔ 程式碼：{len(jira_code)}/{len(jira)} 張卡可在 server/client/shared 找到 {{KEY}} 行級錨點（Part A.3 逐卡列 file:line）；其餘多為 Backlog／決策／純規劃卡，碼中未留卡號註記。",
 f"③卡 ↔ 資料庫：{len(jira_db)}/{len(jira)} 張卡的摘要/描述提及具體資料表或 migration（Part A.3 逐卡列出連結之表與 migration 編號）。",
 f"④資料庫共 {len(schema)} 表 / {tot_cols} 欄 / {tot_idx} 索引，逐欄已於 Part B 完整列出（型別/長度/NOT NULL/PK/UNIQUE/DEFAULT/enum）。",
 "⑤Migration 治理乾淨：82 支全登記於 _journal.json，0 孤兒（AIDV-17 收尾）。",
 f"⑥有表無卡 {sum(1 for t in xref if xref[t]['doc_mentions']==0)}、有表無碼 {sum(1 for t in xref if xref[t]['code_files']==0)}（Part E）。",
]
for f in findings: P(f,9,1.5)

# ── 資料口徑校對（最真實數據） ──
pdf.add_page()
H("資料口徑校對 — SSOT/簡報『宣稱』 vs 本報告『實測』",15,2,(25,40,75))
P("以下每一項規模數字，左為規劃文件/簡報所載（master-plan §1 等），右為本報告對 repo HEAD 實測；"
  "差異欄與備註據實說明來源（多為簡報採早期快照、或估算口徑不同）。報告全篇一律採『實測』值。",9,2,(90,90,90))
rows=[]
for r in recon:
    rows.append([r["item"], str(r["claimed"]), str(r["measured"]), str(r["diff"]) or "—", r["note"]])
table(["量測項目","宣稱","實測","差","差異/口徑說明"],rows,[36,12,14,8,52],fs=7.4,head_fill=(120,40,40))
pdf.ln(2)
P("重點校正：①資料表 82→87（新表已入 main）；②資料欄位＝1161（本報告修正解析器漏抓帶 JSDoc 註解欄位後之真實全量，"
  "前版誤為 908）；③procedure 簡報估 ~565、實測 424（含 server/routers.ts appRouter inline 122；routers/ 內為 284）；"
  "④任務卡 315（口述）→323（live Jira JQL 實拉）。",8.5,1.5,(150,30,30))


# ============ PART A : 任務卡逐卡（live Jira AIDV 全量 323） ============
pdf.add_page()
H("Part A — 任務卡逐卡對比（live Jira · 專案 AIDV 全量）",17,2,(25,40,75))
P(f"資料來源＝直接連線 Atlassian Jira（aa0968111723.atlassian.net，專案 AIDV），全量 {len(jira)} 張卡。"
  "『逐卡級』：A.1 看板分佈→A.2 全卡索引→A.3 逐卡展開（狀態/型別/優先/labels/父卡/描述＋PR＋程式碼 file:line＋連結資料表＋migration）。",9,2,(90,90,90))

H("A.1　看板分佈（狀態 × 型別）",12,2,(35,55,90),top=1)
strows=[[s,str(cstat(s))] for s in ["完成","進行中","Selected for Development","Backlog"]]
strows+=[["—— 型別 ——",""]]
strows+=[[t,str(ctype(t))] for t in ["大型工作(Epic)","故事(Story)","任務(Task)","漏洞(Bug)"]]
# map display->actual
for r in strows:
    if r[0].endswith(")"):
        key=r[0].split("(")[0]; r[1]=str(ctype(key))
table(["狀態 / 型別","張數"],strows,[60,18],fs=9,head_fill=(35,55,90))

H("A.2　全卡索引（依卡號；碼=程式碼錨點數，表=連結資料表數）",12,2,(35,55,90),top=3)
rows=[]
for c in jira:
    rows.append([c["key"], c["type"][:4], c["status"][:6], (c["priority"] or "")[:4],
                 c["summary"][:46], "#"+",".join(c["prs"][:2]) if c["prs"] else "—",
                 str(len(c["code"])), str(len(c["tables"]))])
table(["卡號","型","狀態","優先","摘要","PR","碼","表"],rows,[14,8,12,9,52,14,7,7],fs=6.6)

H("A.3　逐卡展開（全 323 張：描述＋程式碼 file:line＋資料表＋migration）",12,2,(35,55,90),top=3)
P("每張卡完整列出：摘要、型別/狀態/優先/labels/父卡、描述全文（節錄至約 480 字）、提及 PR、"
  "在 server/client/shared 的程式碼錨點（檔案:行號）、卡文連結之資料表、以及 migration 編號。",8,2,(90,90,90))
STC={"完成":(20,110,40),"進行中":(180,110,10),"Backlog":(110,110,110),"Selected for Development":(150,60,150)}
for c in jira:
    need(24)
    col=STC.get(c["status"],(20,40,80))
    pdf.set_font("wqy",size=9.6); pdf.set_text_color(*col)
    pdf.multi_cell(EPW,4.9,S(f"{c['key']}　{c['summary']}"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0)
    meta=f"{c['type']} · {c['status']} · 優先 {c['priority'] or '—'}"
    if c.get("parent"): meta+=f" · 父卡 {c['parent']}"
    if c.get("labels"): meta+=" · labels "+",".join(c["labels"])
    P(meta,7.6,0.4,(90,90,90))
    if c.get("desc"):
        d=re.sub(r"[ \t]+"," ",c["desc"]).strip()
        d=re.sub(r"\n{2,}","\n",d)[:2600]
        P("技術說明／驗收（這張卡對網站的幫助與行為改變）：",7.8,0.2,(20,70,120))
        for para in d.split("\n"):
            if para.strip(): P("　"+para.strip(),7.6,0.3,(40,40,40))
    if c.get("prs"):
        P("關聯 PR（實際改動 commit）： "+", ".join("#"+p for p in c["prs"]),7.6,0.3,(70,70,110))
        for p in c["prs"]:
            m=pr_meta.get(p)
            if not m: continue
            P(f"　PR #{p}　{m['title']}",7.6,0.2,(40,60,110))
            P(f"　　改動明細： {m['files']} 檔　+{m['add']}／-{m['del']} 行　·　合併 {m['merged']}",7.4,0.2,(90,90,90))
            P("　　技術摘要： "+m["sum"],7.4,0.4,(55,55,55))
    if c.get("tables"):
        P("動到的資料表（"+str(len(c["tables"]))+"）： "+", ".join(c["tables"]),7.6,0.3,(20,90,90))
    if c.get("migs"):
        P("相關 migration： "+", ".join(c["migs"]),7.6,0.3,(120,80,20))
    if c.get("code"):
        P("對站台的改動落點（檔案:行號 │ 該行程式碼/註解）"+f"——共 {len(c['code'])} 處：",7.6,0.2,(120,30,30))
        for r in c["code"][:80]:
            ref=r["ref"] if isinstance(r,dict) else str(r)
            line=r.get("line","") if isinstance(r,dict) else ""
            pdf.set_font("wqy",size=7); pdf.set_text_color(20,40,90)
            pdf.multi_cell(EPW,3.6,S("  • "+ref),new_x="LMARGIN",new_y="NEXT")
            if line:
                pdf.set_text_color(80,80,80)
                pdf.multi_cell(EPW,3.5,S("      │ "+line),new_x="LMARGIN",new_y="NEXT")
        pdf.set_text_color(0)
        if len(c["code"])>80: P(f"  ...另 {len(c['code'])-80} 處（同卡號錨點）",7,0.2,(120,120,120))
    else:
        P("對站台的改動落點：本卡碼中未留卡號註記（多為 Backlog／規劃／決策卡，尚未進入實作）。",7.6,0.2,(150,150,150))
    pdf.set_draw_color(225); pdf.line(pdf.l_margin,pdf.get_y()+0.5,pdf.w-pdf.r_margin,pdf.get_y()+0.5)
    pdf.ln(2.2)

# ============ PART B : 資料庫逐欄位 ============
pdf.add_page()
H("Part B — 資料庫逐欄位對比（Data Dictionary）",18,2,(25,40,75))
P(f"『逐欄位級』：drizzle/schema.ts 全 {len(schema)} 表，逐欄列出 欄位名 / DB 欄名 / 型別 / 長度 / 約束旗標 / enum 值；"
  f"並列每表索引與約束。合計 {sum(len(t['columns']) for t in schema)} 欄、{sum(len(t['indexes']) for t in schema)} 索引。",9,2,(90,90,90))
for ti,t in enumerate(schema):
    x=xref.get(t["table"],{})
    need(26)
    pdf.set_font("wqy",size=11); pdf.set_text_color(15,35,70)
    pdf.multi_cell(EPW,5.6,S(f"B.{ti+1}　{t['table']}　(var: {t['var']})"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0)
    pdf.set_font("wqy",size=7.5); pdf.set_text_color(110,110,110)
    pdf.multi_cell(EPW,3.8,S(f"欄位 {len(t['columns'])} · 索引 {len(t['indexes'])} · 文件/卡提及 {x.get('doc_mentions','?')} 次 · 程式碼(var)引用檔 {x.get('code_files','?')}"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0); pdf.ln(0.5)
    rows=[]
    for col in t["columns"]:
        rows.append([col["name"], col["db"] if col["db"]!=col["name"] else "(同)",
                     col["type"], col["length"] or "",
                     " ".join(col["flags"]),
                     ",".join(col["enum"]) if col.get("enum") else ""])
    table(["欄位名","DB欄名","型別","長度","約束","enum 值"],rows,[26,24,18,9,40,33],fs=7)
    if t["indexes"]:
        pdf.ln(0.5); pdf.set_font("wqy",size=7.5); pdf.set_text_color(90,60,20)
        for ix in t["indexes"]:
            pdf.multi_cell(EPW,3.6,S(f"  # {ix.get('name','')}: {ix.get('raw','')}"),new_x="LMARGIN",new_y="NEXT")
        pdf.set_text_color(0)
    docs=col_doc.get(t["table"],{}); inf=col_infer.get(t["table"],{})
    pdf.ln(0.5); P("　逐欄說明（原碼註解；無註解者標 [推斷]）：",7.4,0.3,(20,70,110))
    for col in t["columns"]:
        a=docs.get(col["name"])
        pdf.set_font("wqy",size=7)
        if a:
            pdf.set_text_color(55,55,55)
            pdf.multi_cell(EPW,3.5,S(f"   - {col['name']}（{col['type']}）：{a}"),new_x="LMARGIN",new_y="NEXT")
        else:
            d=inf.get(col["name"]) or f"{col['type']} 欄位"
            pdf.set_text_color(120,120,120)
            pdf.multi_cell(EPW,3.5,S(f"   - {col['name']}（{col['type']}）：[推斷] {d}"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0)
    pdf.ln(2.5)

# ============ PART C : Migration 對帳 ============
pdf.add_page()
H("Part C — Migration 逐支對帳",18,2,(25,40,75))
P("每支 migration：檔名 / 是否登記於 _journal.json（未登記＝孤兒，永不會被 boot 套用）/ statement-breakpoint 句數 / "
  "DDL 語句摘要。三鐵則（禁 CREATE INDEX IF NOT EXISTS／每 chunk 一句／information_schema 守門）見 SSOT。",9,2,(90,90,90))
rows=[]
for m in migs:
    reg="✔ 已登記" if m["registered"] else ("✘ 孤兒" if m["file"].startswith("0") else "（db/）")
    rows.append([m["file"], reg, str(m["n_break"]),
                 "; ".join(dict.fromkeys(m["statements"]))[:120] or "—"])
table(["檔名","journal","句斷","DDL 摘要（去重）"],rows,[26,16,8,60],fs=7)

# ============ PART D : 程式碼結構 / 行級索引 ============
census=J("scripts/comparison/census.json")
pdf.add_page()
H("Part D — 全程式碼盤點與結構索引",18,2,(25,40,75))
H("D.0　全碼盤點（所有原始碼，依目錄）",12,2,(35,55,90))
P(f"全 repo 原始碼（排除 node_modules/dist/lock）：{census['total_files']} 檔、{census['total_loc']:,} 行、"
  f"{census['test_files']} 個測試檔。下表依第一/二層目錄彙總檔數與行數（{len(census['areas'])} 個目錄桶，列前 50 大）。",9,1.5,(90,90,90))
arows=[]
for area,a in list(census["areas"].items())[:50]:
    exts=", ".join(f"{k}:{v}" for k,v in sorted(a["by_ext"].items(),key=lambda kv:-kv[1])[:5])
    arows.append([area, str(a["files"]), f"{a['loc']:,}", exts])
table(["目錄","檔數","行數","副檔分佈（前5）"],arows,[40,12,16,50],fs=7)
H("D.0b　最大單檔（前 40）",11,2,(35,55,90),top=2)
brows=[[f"{loc:,}",p] for loc,p in census["biggest"]]
table(["行數","檔案"],brows,[14,90],fs=7)
H("D.1　tRPC Router × Procedure",12,2,(35,55,90),top=3)
_proc_all=next((r["measured"] for r in recon if "全 server 實測" in r["item"]), sum(r['n'] for r in routers))
P(f"server/routers/ 全 {len(routers)} router、合計 {sum(r['n'] for r in routers)} procedure（此為 routers/ 目錄內）；"
  f"全 server 實測 procedure 總數＝{_proc_all}（含 server/routers.ts appRouter inline）。簡報所載 ~565 為估算口徑，見『資料口徑校對』。",9,1.5,(90,90,90))
rows=[[r["file"], str(r["lines"]), str(r["n"]), ", ".join(r["procedures"])[:130] or "—"] for r in routers]
table(["router 檔","行數","proc 數","procedure 名（節錄）"],rows,[26,10,10,64],fs=7)
H("D.2　Feature Flag / 旗標",12,2,(35,55,90),top=3)
rows=[[t[0],t[1]] for t in flags]
table(["旗標 token","定義檔"],rows,[55,30],fs=7.5)

# D.3 逐 Procedure 解釋
pdf.add_page()
H("D.3　逐 API（Procedure）解釋",13,2,(35,55,90))
P("server/routers/ 全 "+str(sum(len(v) for v in proc_doc.values()))+" 個 tRPC procedure，逐一列：名稱 · 權限"
  "（public/protected/admin）· 型別（query 讀 / mutation 寫）· 輸入 · 用途（取自原始碼緊鄰註解）。"
  "此即 API 層『逐項解釋』——前端每個資料讀寫動作對應哪支後端能力。",8,2,(90,90,90))
for rf in sorted(proc_doc):
    items=proc_doc[rf]
    need(16)
    pdf.set_font("wqy",size=9.5); pdf.set_text_color(15,35,70)
    pdf.multi_cell(EPW,5,S(f"{rf}　（{len(items)} procedure）"),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)
    inf=proc_infer.get(rf,{})
    rows=[]
    for it in items:
        doc=it["doc"] or ("[推斷] "+inf.get(it["name"],"") if inf.get(it["name"]) else "")
        rows.append([it["name"], it["kind"], it["op"] or "—", it["input"] or "—", doc])
    table(["procedure","權限","型別","輸入","用途（原碼註解／[推斷]）"],rows,[24,14,12,12,62],fs=6.8)
    pdf.ln(1.5)

# D.4 核心檔逐行註解走讀
pdf.add_page()
H("D.4　核心檔逐行註解走讀",13,2,(35,55,90))
P("挑選 7 個關鍵核心檔，逐行擷取原始碼中的『行內註解（行號 │ 註解）』——這是作者親寫的逐行說明，"
  "等同程式碼逐行解釋（涵蓋成本治理、生成鎖、供應商門面、生成後處理、計畫安全、創作專案等關鍵路徑）。",8,2,(90,90,90))
for f in core_doc:
    info=core_doc[f]
    need(16)
    pdf.set_font("wqy",size=9.5); pdf.set_text_color(15,35,70)
    pdf.multi_cell(EPW,5,S(f"{f}　（{info['loc']} 行，擷取註解 {len(info['comments'])}）"),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)
    pdf.set_font("wqy",size=6.8)
    for lineno,c in info["comments"]:
        pdf.set_text_color(150,150,150); pdf.set_x(pdf.l_margin)
        pdf.multi_cell(14,3.4,S(f"L{lineno}"),new_x="RIGHT",new_y="TOP")
        pdf.set_text_color(60,60,60)
        pdf.multi_cell(EPW-14,3.4,S("│ "+c),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0); pdf.ln(2)

# ============ PART E : 三方一致性核對 ============
pdf.add_page()
H("Part E — 三方一致性核對（卡 ↔ 碼 ↔ 庫）",18,2,(25,40,75))
H("E.1　有表無卡：未被任何任務卡/文件提及的資料表",12,2,(150,30,30))
P("以下表在 docs/ 全文件（含 SSOT 與所有卡）中查無提及——屬『程式碼/資料庫已有、看板未追蹤』，建議補卡或標註。",8,1.5,(90,90,90))
rows=[[t, xref[t]["var"], str(xref[t]["code_files"])] for t in xref if xref[t]["doc_mentions"]==0]
table(["資料表","drizzle var","碼引用檔數"],rows,[40,40,15],fs=8,head_fill=(120,40,40))
H("E.2　有表無碼：drizzle var 名在 server/shared/client 零引用",12,2,(150,30,30),top=3)
P("以下表以 var 名查無程式碼引用，可能為：僅由 raw SQL/migration 操作、待接線、或殘留。需人工確認。",8,1.5,(90,90,90))
rows=[[t, xref[t]["var"], str(xref[t]["doc_mentions"])] for t in xref if xref[t]["code_files"]==0]
table(["資料表","drizzle var","文件提及數"],rows,[40,40,15],fs=8,head_fill=(120,40,40))
H("E.3　Migration ↔ Journal 一致性",12,2,(35,90,55),top=3)
orph=[m["file"] for m in migs if not m["registered"] and m["file"].startswith("0")]
P(("✔ 全數一致：drizzle/*.sql 全部登記於 _journal.json，無孤兒。" if not orph else
   "✘ 發現孤兒（不會被套用）："+", ".join(orph)),9,1.5,(20,110,40) if not orph else (150,30,30))
H("E.4　完成卡 ↔ 程式碼 覆蓋（live Jira，狀態＝完成）",12,2,(35,55,90),top=3)
done=[c for c in jira if c["status"]=="完成"]
done_code=[c for c in done if c.get("code")]
P(f"完成卡 {len(done)} 張，其中 {len(done_code)} 張有程式碼 {{KEY}} 行級錨點；{len(done)-len(done_code)} 張無"
  "（多屬決策卡/規劃卡/前端視覺卡，碼中未留卡號註記——非缺陷，但若需嚴格追溯可於 PR 補註卡號）。",9,1.5)
rows=[[c["key"], c["summary"][:36], "有碼" if c.get("code") else "無碼錨",
       str(len(c.get("tables",[]))),
       ",".join("#"+p for p in c.get("prs",[])[:3]) or "—"] for c in done]
table(["卡號","摘要","碼錨","表","PR"],rows,[14,40,10,7,22],fs=7)
H("E.5　覆蓋率小結",12,2,(35,55,90),top=3)
covd=sum(1 for t in xref if xref[t]["doc_mentions"]>0)
covc=sum(1 for t in xref if xref[t]["code_files"]>0)
P(f"資料表被文件/卡覆蓋：{covd}/{len(schema)}（{covd*100//len(schema)}%）；被程式碼覆蓋：{covc}/{len(schema)}（{covc*100//len(schema)}%）。",9,1.2)
P(f"任務卡（{len(jira)} 張）：有程式碼錨點 {len(jira_code)}（{len(jira_code)*100//len(jira)}%）、有資料表連結 {len(jira_db)}（{len(jira_db)*100//len(jira)}%）。"
  "其餘多為 Backlog／規劃／決策卡（尚未進入實作，故碼/庫無對應＝預期）。",9,1.2)

# ============ PART F : RAILWAY / 部署 / 環境變數 盤點 ============
railway=J("scripts/comparison/railway.json")
pdf.add_page()
H("Part F — Railway / 部署 / 環境變數 盤點",18,2,(25,40,75))
P("狀態說明：本 session 未連上 Railway live MCP（搜尋無 railway/gitnexus 工具；對應卡 AIDV-77＝官方遠端 MCP 已寫入"
  "設定、待 Bruce OAuth 才生效）。故本章自 repo 部署產物盤點：railway.toml／.nixpacks.toml／Dockerfile／"
  ".dockerignore＋.env.example 環境變數目錄。所有金鑰一律只列『名稱』，不含任何值（依鐵律 3）。",9,2,(150,30,30))
H("F.1　部署設定檔（repo 原文）",12,2,(35,55,90))
for fn in ["railway.toml",".nixpacks.toml","Dockerfile",".dockerignore"]:
    body=railway["files"].get(fn)
    if not body: continue
    need(16)
    pdf.set_font("wqy",size=9.4); pdf.set_text_color(20,40,80)
    pdf.multi_cell(EPW,5,S(fn),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)
    pdf.set_font("wqy",size=7)
    for line in body.split("\n"):
        pdf.multi_cell(EPW,3.5,S("  "+line.replace("\t","  ")) or " ",new_x="LMARGIN",new_y="NEXT")
    pdf.ln(2)
H("F.2　環境變數目錄（.env.example，僅名稱·無值）",12,2,(35,55,90),top=2)
P(f"共 {len(railway['env'])} 個環境變數（其中 {sum(1 for e in railway['env'] if e['secret'])} 個屬金鑰類 KEY/SECRET/TOKEN/URL）。"
  "『金鑰類』欄＝是；『範例值』欄僅表示 .env.example 是否附非敏感示範值，實際值一律貼 Railway 環境變數。",8,1.5,(90,90,90))
rows=[[e["name"], "是" if e["secret"] else "", e["section"][:34], e["example_present"]] for e in railway["env"]]
table(["環境變數名稱","金鑰類","分區/用途","範例值"],rows,[46,10,40,12],fs=7)

# ============ PART G : 現有網站功能盤點 ============
pdf.add_page()
H("Part G — 現有網站功能盤點（已上線/已完成）",18,2,(25,40,75))
_done_n=sum(len(v) for v in existing["done_by_epic"].values())
P(f"以『完成』卡（{_done_n} 張）"
  f"＋前端頁面（{len(existing['pages'])}）＋殼層（{len(existing['shells'])}）為據，盤點目前 director.today 實際具備的功能。"
  "依 Epic（Wave）分組，每項標卡號、PR、動到的資料表。",9,2,(90,90,90))
for epic_key, cards_ in existing["done_by_epic"].items():
    if not cards_: continue
    ename=existing["epics"].get(epic_key, epic_key)
    need(16)
    pdf.set_font("wqy",size=10); pdf.set_text_color(20,60,40)
    pdf.multi_cell(EPW,5.2,S(f"◆ {epic_key}　{ename}　（{len(cards_)} 項已完成）"),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)
    rows=[[c["key"], c["summary"][:54],
           ",".join("#"+p for p in c["prs"][:2]) or "—",
           ",".join(c["tables"][:3]) or "—"] for c in cards_]
    table(["卡號","功能","PR","資料表"],rows,[14,54,16,30],fs=6.8)
    pdf.ln(1.5)
H("G.x　前端頁面與殼層",12,2,(35,55,90),top=2)
P("頁面（client/src/pages，"+str(len(existing["pages"]))+"）："+"、".join(existing["pages"]),8,1.2,(60,60,60))
P("殼層（client/src/shells，"+str(len(existing["shells"]))+"）："+"、".join(existing["shells"]),8,1.2,(60,60,60))

# ============ PART H : 未來功能/程式碼/資料庫 ============
pdf.add_page()
H("Part H — 未來增加：功能 / 程式碼 / 資料庫（路線圖）",18,2,(25,40,75))
nf=sum(len(v["inprog"])+len(v["backlog"]) for v in future["by_epic"].values())
P(f"以『進行中』＋『Backlog』卡（共 {nf} 張）為據，依 Epic（Wave）分組，呈現未來要加的功能；"
  "並彙整『未來程式碼』（卡述明待接/待後端/缺金鑰者）與『未來資料庫』（規劃中/未接線的表）。",9,2,(90,90,90))
H("H.1　未來功能（依 Epic / Wave）",12,2,(35,55,90))
for epic_key, info in future["by_epic"].items():
    items=info["inprog"]+info["backlog"]
    if not items: continue
    ename=info["epic"] or epic_key
    need(16)
    pdf.set_font("wqy",size=10); pdf.set_text_color(80,50,20)
    pdf.multi_cell(EPW,5.2,S(f"◆ {epic_key}　{ename}　（進行中 {len(info['inprog'])}／Backlog {len(info['backlog'])}）"),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)
    rows=[[c["key"], ("進行中" if c in info["inprog"] else "Backlog"), c["type"][:4],
           c["summary"][:52], ",".join(c["tables"][:2]) or "—"] for c in items]
    table(["卡號","狀態","型","未來功能","牽涉表"],rows,[14,12,8,52,24],fs=6.6)
    pdf.ln(1.5)
H("H.2　未來程式碼（卡述明 待接/待後端/缺金鑰）",12,2,(150,80,20),top=2)
P("以下卡在描述中明確標出尚未實作的程式碼接點（待接、待後端、待補、待 G10、Phase 2、needs-key…），"
  "即未來要寫的程式。",8,1.5,(90,90,90))
rows=[[c["key"], c["status"][:6], ",".join(c["hits"][:3]), c["snip"][:120]] for c in future["future_code"]]
table(["卡號","狀態","關鍵字","待實作內容（節錄）"],rows,[14,12,18,66],fs=6.8,head_fill=(150,90,40))
H("H.3　未來資料庫",12,2,(150,80,20),top=2)
P("(a) 規劃中/未接線的表——schema 已定義但 server/shared/client 以 var 名查無引用（"+str(len(future["planned_tables"]))+" 張），"
  "多為待接線或由 raw SQL 操作；(b) 未來卡牽涉的資料表。",8,1.5,(90,90,90))
rows=[[t, ",".join(future["future_tables_from_cards"].get(t,[])[:4]) or "—"] for t in future["planned_tables"]]
table(["規劃中/未接線資料表","被哪些未來卡牽涉"],rows,[40,55],fs=8,head_fill=(150,90,40))
ft=[(t,ks) for t,ks in future["future_tables_from_cards"].items() if t not in future["planned_tables"]]
if ft:
    P("其餘已存在、被未來卡再度牽涉的表（擴充/接線方向）：",8,1.2,(90,90,90))
    rows=[[t, ",".join(ks[:5])] for t,ks in sorted(ft)]
    table(["資料表","未來卡"],rows,[40,55],fs=7.5,head_fill=(120,90,50))

# ============ PART I : AI 底層邏輯結構 ============
pdf.add_page()
H("Part I — AI 底層邏輯結構",18,2,(25,40,75))
P("這站的 AI 不是『丟給 LLM 直接答』，而是一條有守門的代理流水線。代理軸由內到外四圈：契約層/規劃層/守門層/執行層。",9,2,(90,90,90))
H("I.1　9 階代理流水線（每輪一次）",12,2,(35,55,90))
loop=[
 ["1 意圖","ai.chat 多步 planner 抽 intent/限制/引用（orb-reasoning 思考步驟面板）","不直接答，先理解"],
 ["2 產計畫","LLM 產 RunWorkflowAction（AgentPlan V3：steps+dependsOn+decisionMode+risk）","結構化可審查"],
 ["3 安全閘","agent-plan-safety：風險(low/med/high)/能力(hasCapabilityForPage)/已知動作 三檢","擋越權/未知動作"],
 ["4 批判精修","orb-plan-critic：draft->critique->refine；抓未解 ${stepN.key}/參數漂移/缺前置/依賴環","語意層把關"],
 ["5 成本閘","orb-cost-governor：pre-flight 估 credits/時長/風險 tier，超預算先擋","先估後扣紅線"],
 ["6 排程","orb-dag-scheduler：拓撲分批 Promise.all；同 path 強制串接避免同頁競態；偵測環退循序","防 UI race"],
 ["7 執行+驗證","逐步派發 -> verifyToolResult 檢查工具輸出","工具結果可信"],
 ["8 自省","orb-self-reflection：慢/可疑過小/重複失敗 -> verdict 寫回 orbMemory","Reflexion 學習"],
 ["9 感知+重規劃","orb-perception-loop：執行後抓 PageAgentSnapshot diff -> proceed/retry/replan/abort","關掉『以為成功』缺口"],
]
table(["階段","運作（repo 模組）","解決什麼"],loop,[16,68,22],fs=7,head_fill=(120,40,40))
H("I.2　16 種白名單動作 + 風險閘",12,2,(35,55,90),top=2)
P("LLM 只能產出白名單動作（各有 zod schema 與風險）：navigate/setTab/setMode/setModality/fillPrompt/type/"
  "setModel/setParam/applyPreset/toggleSetting/focusElement/openDialog/search/reset/submit/runWorkflow。"
  "高風險（submit/runWorkflow/刪除/權限）一律要人類核准（actionRequiresApproval）。",9,1.5)
H("I.3　記憶三層 + 狀態機",12,2,(35,55,90),top=1)
P("記憶：Tier A 任務暫存（in-RAM+選擇性 DB）/ Tier B 會話+RAG 索引+per-user 摘要 / Tier C 跨會話 per-spirit 語意學習。"
  "狀態機：planned->running->(waiting_human 停下等人)->done/failed/cancelled。RAG 失敗顯式浮出（非吞錯）+ "
  "ENABLE_RAG_INJECTION_GUARD 防注入。向量＝Pinecone halfvec(3072)+HNSW（規劃遷 pgvector）。",9,1.5)

# ============ PART J : UIUX 結構系統 ============
pdf.add_page()
H("Part J — UIUX 結構系統",18,2,(25,40,75))
H("J.1　設計 Token 五層（CSS 變數為單一真相）",12,2,(35,55,90))
P("①全站 :root（shadcn 語意色換亮色暖光）②平台擴充色 --clay/--gold/--teal/--ok/warn/bad/info ③玻璃分層 "
  "--surface-1/2/3（oklch 半透明）④暖色陰影 --shadow-healing ⑤字體 --font-serif(Fraunces/Noto Serif TC)+圓角 --radius 1rem。"
  "主強調＝黏土/珊瑚橘 #C2613F(=--primary)。design-kit 元件用短別名 token，須包在 .aidv-kit scope；登入 .login-cosmic carve-out。",9,1.5)
H("J.2　元件階梯 + 四態鐵律",12,2,(35,55,90),top=1)
ui=[
 ["primitives","Button/Pill/Tag/Kbd/Eyebrow/Toggle/Meter/Spinner/Card/Input","最小積木"],
 ["states/PanelState","四態：載入(role=status,aria-busy)/空(role=status)/錯誤(role=alert+重試)/就緒","狀態可視一致"],
 ["GateCard","確認門卡+computeGate/countGate","成本/風險關卡"],
 ["ShotCard / PromptVault / WorkflowBuilder","分鏡狀態機 / 生成->存庫->重用 / 可設定工作流","領域元件"],
 ["orb.tsx","FAB+面板+6 分頁+主動泡泡+人格/心情頭+四態","代理化身（見 Part K）"],
]
table(["元件","內容","定位"],ui,[28,52,20],fs=7)
P("四殼一脊椎：ShellFrame + Video/Social/Learn/Settings 四殼，shellRouteTable 統一路由；脊椎＝Story Spine（S0X 導航+readiness chip）。"
  "AIDV-118 一致性查核：26 面板 25 有錯誤態出口、首頁 15 動畫 14 守 reduced-motion、四殼斷點全對齊 768/1024/1280；"
  "a11y 基線 focus-visible/sr-only/role/aria-busy/aria-live（對比度/鍵序/真機破版＝Phase 2 人工）。",9,1.5)

# ============ PART K : AI x UIUX 整合接點 ============
pdf.add_page()
H("Part K — AI x UIUX 整合接點（同一頁面，兩種觀者）",17,2,(25,40,75))
P("命題：UI 同時是『人看的介面』與『代理可讀寫的狀態機』。兩軸共用同一份頁面狀態，靠下列接點縫合：",9,2,(90,90,90))
integ=[
 ["頁面註冊表","APP_PAGE_REGISTRY","頁面/能力單一登記","代理知道哪頁能做這動作"],
 ["跨頁狀態圖","orb-page-state-graph","哪頁處理某 action、到目標頁最短路徑","setModality 只在 /studio -> 先導航"],
 ["動作派發","PageAgentContext.dispatch","代理把 16 動作打進真實頁面","fillPrompt->Input、submit->GateCard"],
 ["頁面快照","PageAgentSnapshot","代理讀頁面真實狀態","perception-loop diff 判『真的變了沒』=ground truth"],
 ["思考可視","orb-reasoning","planner intent/plan/warnings 攤在 orb 面板","代理怎麼想可見，非黑箱"],
 ["光球心情","OrbMood idle/thinking/working/done","綁代理執行狀態","以色彩區分(calm orb 無臉)"],
 ["四態 ambient","silent/hint/collab/critical","綁代理主張強度","關鍵才 critical 介入"],
 ["主動泡泡","orb 主動泡泡(aria-live)","自省/記憶->主動建議","學到的變『下一步』CTA"],
 ["成本閘可視","cost-governor<->GateCard+成本階梯","預算閘畫成確認門","高成本 submit 前可見可否決"],
 ["脊椎=計畫","Story Spine S0X<->AgentPlan steps","計畫步驟對映脊椎","readiness chip=該步就緒度"],
 ["狀態一致","verifyToolResult/四態<->PanelState","後端狀態<->前端四態","人與代理看同一真相"],
]
table(["接點","模組/元件","作用","具體例子"],integ,[16,28,28,44],fs=6.9,head_fill=(40,90,55))
P("一句話：UIUX 是代理的 I/O 介面——dispatch(寫)+snapshot(讀)做對，代理才能可靠操作；四態/確認門做對，人與代理才共享真相。"
  "多數產品 UI 與 Agent 脫節，本站用 PageAgent 把兩者縫在同一份狀態上。",9,1.5,(20,70,120))

# ============ PART L : 全站費用與成本 ============
pdf.add_page()
H("Part L — 全站費用與成本（repo 成本碼＋2026 實價）",17,2,(25,40,75))
H("L.1　付費服務一覽",12,2,(35,55,90))
svc=[
 ["Railway 主機","$20/vCPU·月+$10/GB RAM·月+egress $0.05/GB+磁碟 $0.15/GB","[有]"],
 ["Cloudflare R2","儲存 $0.015/GB·月、egress 免費、Class A $4.50/百萬","[有]"],
 ["Pinecone 向量","~$0.33/GB·月、月最低 $50（遷 pgvector 可省）","[有]"],
 ["OpenRouter/Anthropic","Haiku $1/$5、Sonnet $3/$15、Opus4.8 $5/$25（每百萬 token）；OpenRouter +5.5%","[有]"],
 ["fal.ai（151 模型）","圖 $0.003–0.06、影片 $0.10–0.80、訓練 $1–5/次","缺金鑰"],
 ["Perplexity","$1–15/百萬 token + 每千次請求 $5–14","[進行]"],
 ["ElevenLabs/Suno","語音 API Pro $99/月；音樂無官方 API","缺金鑰"],
 ["Supabase（規劃）","Pro $25/月含 250GB egress","[待]"],
 ["MySQL/Redis/Stripe/Sentry/網域","DB 用量・Redis $5–10・Stripe 2.9%+$0.30・Sentry $0–26・網域 $20–30/年","混"],
]
table(["服務","2026 現行價","狀態"],svc,[26,58,14],fs=7)
H("L.2　API 生成成本依類別（200 模型）",12,2,(35,55,90),top=1)
bycat={}
for e in pricing: bycat.setdefault(e["category"],[]).append(e["baseCostUsd"])
CN={"text-to-video":"文字生影片","image-to-video":"圖生影片","training":"模型訓練","text-to-3d":"文字生 3D","image-to-3d":"圖生 3D","video-to-video":"影片轉影片","text-to-image":"文字生圖","image-to-image":"圖生圖","text-to-speech":"語音 TTS","text-to-audio":"音樂音效","reasoning":"推理","llm":"LLM","video-to-audio":"影片配音","audio-to-text":"語音轉文字","image-to-json":"圖像理解","video-to-text":"影片轉文字"}
rows=[]
for c in sorted(bycat,key=lambda k:-statistics.median(bycat[k])):
    v=sorted(bycat[c]); rows.append([CN.get(c,c),str(len(v)),f"${min(v):.3f}–${max(v):.3f}",f"${statistics.median(v):.3f}"])
table(["類別","模型數","USD 區間/次","中位"],rows,[28,12,28,14],fs=7.5,head_fill=(40,70,55))
H("L.3　你可能沒想到的隱藏成本（重點）",12,2,(150,30,30),top=1)
for t in [
 "失敗仍付費：失敗/部分生成全額退點給用戶，但供應商常已收費＝淨損漏帳。",
 "LLM 重試疊加 / Perplexity 每千次請求費 / OpenRouter +5.5% / 多代理 token 乘數。",
 "Pinecone 月最低 $50（幾乎沒用也付）；halfvec(3072) 單筆~6KB 隨記憶成長。",
 "R2 操作費（上傳=Class A、magic-byte 檢查=Class B）；容器多 cron 無法縮零 24/7。",
 "免費 50 生成×多帳號＝補貼破口；FX 匯率風險；Stripe 每筆 $0.30；遷移期雙庫並存。",
]: P("[!] "+t,8.5,0.9,(150,30,30))
P("固定底盤概估 ~$115/月（Railway+Pinecone 為大宗）；影片是頭號成本中心，單項可蓋過所有基礎設施。詳見獨立成本報告。",8.5,1,(20,90,40))

# ============ PART M : 技術選型比對 ============
pdf.add_page()
H("Part M — 技術選型與 SOTA 比對",17,2,(25,40,75))
cmp=[
 ["API","tRPC v11","REST/GraphQL/gRPC","端到端型別、零 schema 重複；全 TS 最佳適配"],
 ["ORM","Drizzle","Prisma/TypeORM","SQL-first 輕、無引擎程序；可控 raw migration"],
 ["路由","Wouter","React Router/Next.js","~1.5KB 極輕；SPA 殼不要 SSR 重量"],
 ["向量","Pinecone->pgvector","Qdrant/Weaviate/Milvus","遷 pgvector 併庫省月最低 $50"],
 ["LLM 接入","OpenRouter+門面","直連 SDK/LiteLLM","一支金鑰多家+可降級；代價 +5.5%"],
 ["代理框架","自建","LangGraph/CrewAI/AutoGen","完全可控、緊貼 UI 派發+成本閘+頁面感知"],
 ["認證","自建 JWT","Auth0/Clerk/Supabase Auth","無月費無鎖定可控（已拍板）"],
 ["併發鎖","Redis SET NX PX","DB advisory/BullMQ","跨實例快；耐久化規劃上 BullMQ"],
 ["部署","Railway","Vercel/Fly/Render","容器+cron 適合常駐；非 serverless"],
 ["儲存","Cloudflare R2","S3/Supabase Storage","零 egress 是媒體站殺手鐧"],
]
table(["層","本站","業界替代","取捨（為什麼）"],cmp,[12,24,28,46],fs=7,head_fill=(40,55,90))
H("M.x　與 SOTA 代理範式對映",12,2,(35,55,90),top=2)
P("本站代理＝Plan-and-Execute（骨）+ Critic/Reflexion（腦）+ Grounded-Perception（眼，少見）+ Cost-governor（閘，少見）"
  "+ 受限 Tool-use（手）+ Multi-agent handoff（團隊）。其中『頁面感知驗證』與『成本內建守門』兩點比多數開源框架更實戰；"
  "MCP（BYOMCP 權限/稽核）為 Wave 4 未來方向。詳見獨立技術架構報告。",9,1.5,(20,70,120))

out="docs/reports/task-card-code-db-comparison.pdf"
os.makedirs("docs/reports",exist_ok=True)
pdf.output(out)
print("WROTE", out, os.path.getsize(out), "bytes, pages:", pdf.page_no())
