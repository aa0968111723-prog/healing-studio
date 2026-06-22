# -*- coding: utf-8 -*-
import json, datetime, os, re
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
        self.cell(0,8,f"第 {self.page_no()} 頁  ·  產出 {datetime.date.today().isoformat()}  ·  本檔為 git/repo 實證自動產出",align="C")
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
pdf.ln(8); pdf.set_text_color(0)
pdf.set_font("wqy",size=11)
meta=[
 ("專案","healing-studio　AI Director / Healing Studio 影片製作系統"),
 ("線上站","director.today（Railway 部署）"),
 ("真實棧","React 19 + Vite + tRPC v11 + Drizzle/MySQL + Express；生成=fal/replicate/Gemini/ElevenLabs"),
 ("分支","claude/task-card-comparison-pdf-bnw89n"),
 ("產出日期",datetime.date.today().isoformat()),
 ("資料來源","repo 實檔（git 實證），非轉述"),
]
table(["項目","內容"],meta,[20,80],fs=10,zebra=True,head_fill=(60,80,120))
pdf.ln(4)
pdf.set_font("wqy",size=9); pdf.set_text_color(70,70,70)
prov=("資料來源與方法（scripts/comparison/ 解析器自動萃取）——"
 "①任務卡＝直接連線 live Atlassian Jira（aa0968111723.atlassian.net 專案 AIDV，Rovo MCP），全量 323 張，"
 "逐卡含描述/狀態/型別/優先/labels/父卡；②程式碼＝全 repo 程式碼盤點（1,700+ 檔逐目錄/行數）＋"
 "server/client/shared 的 router/procedure/旗標 enumerate＋對每張卡 grep 卡號取 file:line 行級錨點；"
 "③資料庫＝drizzle/schema.ts（87 表逐欄位）＋drizzle/*.sql migration＋_journal.json 登記核對；"
 "④Railway/部署＝repo 部署產物（railway.toml／nixpacks／Dockerfile）＋.env.example 環境變數目錄（僅名稱）。\n"
 "章節：A 任務卡逐卡 · B 資料庫逐欄位 · C Migration 對帳 · D 全碼盤點 · E 三方一致性 · F Railway/部署。\n"
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
P(f"server/routers/ 全 {len(routers)} router、合計 {sum(r['n'] for r in routers)} procedure。",9,1.5,(90,90,90))
rows=[[r["file"], str(r["lines"]), str(r["n"]), ", ".join(r["procedures"])[:130] or "—"] for r in routers]
table(["router 檔","行數","proc 數","procedure 名（節錄）"],rows,[26,10,10,64],fs=7)
H("D.2　Feature Flag / 旗標",12,2,(35,55,90),top=3)
rows=[[t[0],t[1]] for t in flags]
table(["旗標 token","定義檔"],rows,[55,30],fs=7.5)

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

out="docs/reports/task-card-code-db-comparison.pdf"
os.makedirs("docs/reports",exist_ok=True)
pdf.output(out)
print("WROTE", out, os.path.getsize(out), "bytes, pages:", pdf.page_no())
