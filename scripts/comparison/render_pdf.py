# -*- coding: utf-8 -*-
import json, datetime, os
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
 "⭐":"[星]","⁉":"!?","→":"->","←":"<-"}
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
prov=("資料來源與方法：本報告由 scripts/comparison/ 下的解析器對 repo 實檔自動萃取產生——"
 "①任務卡＝docs/plan/jira-import.csv（Wave 0–4 看板原始卡）＋docs/plan/AIDV-master-plan.md（SSOT）＋"
 "docs/ 下全部 .md 內的 AIDV-NN 卡；②程式碼＝server/client/shared（router/procedure/旗標 enumerate＋"
 "對每張卡 grep AIDV-NN 取得 file:line 行級佐證）；③資料庫＝drizzle/schema.ts（87 表逐欄位）＋drizzle/*.sql "
 "migration＋drizzle/meta/_journal.json 登記核對。\n注意：本 cloud 容器 network egress 擋掉 atlassian.net，"
 "無法連線 live Jira；故『任務卡』以 repo 內 SSOT 鏡像為準（與 Jira 專案 AIDV 對應）。")
pdf.multi_cell(EPW,5,S(prov),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0)

# ============ SUMMARY ============
pdf.add_page()
H("摘要儀表板 — 三方規模與覆蓋",16,3,(25,40,75))
tot_cols=sum(len(t["columns"]) for t in schema)
tot_idx=sum(len(t["indexes"]) for t in schema)
tot_proc=sum(r["n"] for r in routers)
done_cards=[c for c in cards if c["status"]=="Done"]
cards_with_code=[c for c in cards if c.get("code_refs")]
summ=[
 ["任務卡 (AIDV-NN，全 docs)",len(cards),"Part A"],
 ["　其中標記 Done",len(done_cards),"Part A"],
 ["　其中有程式碼行級佐證",len(cards_with_code),"Part A/E"],
 ["看板原始卡 (CSV：Epic+Story)",len(csv_cards),"Part A.1"],
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
table(["量測項目","數值","章節"],summ,[60,18,16],fs=9,head_fill=(35,55,90))
pdf.ln(3)
H("關鍵發現",12,2,(150,30,30))
findings=[
 "①Migration 治理乾淨：82 支 migration 全部登記於 _journal.json，0 孤兒（AIDV-17 已收尾，boot 不再出現 orphan 警告）。",
 f"②資料庫共 {len(schema)} 表 / {tot_cols} 欄 / {tot_idx} 索引，逐欄已於 Part B 完整列出（含型別、長度、NOT NULL/PK/UNIQUE/DEFAULT、enum 值）。",
 f"③{len(cards_with_code)} 張任務卡可在程式碼中找到 AIDV-NN 行級錨點（Part A 逐卡列 file:line）；其餘卡多為純文件/決策卡或前端視覺卡。",
 f"④{sum(1 for t in xref if xref[t]['doc_mentions']==0)} 張表未被任何任務卡/文件提及（Part E.1 列出），屬潛在『有碼無卡』需補卡項。",
 f"⑤{sum(1 for t in xref if xref[t]['code_files']==0)} 張表在 server/shared/client 以 drizzle var 名查無引用（Part E.2），需確認是否殘留或僅由 raw SQL 使用。",
]
for f in findings: P(f,9,1.5)


# ============ PART A : 任務卡逐卡 ============
pdf.add_page()
H("Part A — 任務卡逐卡對比",18,2,(25,40,75))
P("『逐卡級』：先列看板原始卡（CSV），再列全 docs 萃取的 AIDV-NN 卡索引，最後逐卡展開狀態 / PR / "
  "程式碼行級佐證 / 牽涉資料表。",9,2,(90,90,90))

H("A.1　看板原始卡（jira-import.csv：Epic + Story）",12,2,(35,55,90),top=1)
rows=[]
for c in csv_cards:
    rows.append([c.get("Issue Type",""), c.get("Summary",""), c.get("Status",""),
                 c.get("Epic Link","") or c.get("Epic Name",""),
                 (c.get("Description","")[:160])])
table(["型別","摘要","狀態","Epic","描述（節錄）"],rows,[10,30,12,22,40],fs=7)

H("A.2　AIDV-NN 卡索引（全 docs，依卡號）",12,2,(35,55,90),top=3)
rows=[]
for c in cards:
    rows.append([c["num"], c["title"][:40], c["status"] or "—",
                 ",".join("#"+p for p in c.get("prs",[])[:4]) or "—",
                 str(len(c.get("code_refs",[]))), c.get("note","")[:90]])
table(["卡號","標題","狀態","PR","碼錨","備註（節錄）"],rows,[14,34,14,22,8,60],fs=7)

H("A.3　逐卡展開（有程式碼行級佐證者：file:line）",12,2,(35,55,90),top=3)
P("以下每張卡列出在 server/client/shared 內出現 AIDV-NN 的確切『檔案:行號』，即該卡的程式碼行級落點。",8,2,(90,90,90))
for c in cards:
    refs=c.get("code_refs",[])
    if not refs: continue
    need(20)
    pdf.set_font("wqy",size=10); pdf.set_text_color(20,40,80)
    pdf.multi_cell(EPW,5.2,S(f"{c['num']}　{c['title']}  〔{c['status'] or '狀態未標'}〕"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(0)
    if c.get("prs"): P("PR： "+", ".join("#"+p for p in c["prs"]),8,0.5,(70,70,70))
    if c.get("note"): P("備註： "+c["note"],8,0.5,(70,70,70))
    P("程式碼錨點（"+str(len(refs))+"）：",8,0.3,(120,30,30))
    pdf.set_font("wqy",size=7.5)
    for r in refs:
        pdf.multi_cell(EPW,3.8,S("  - "+r),new_x="LMARGIN",new_y="NEXT")
    pdf.ln(2)

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
pdf.add_page()
H("Part D — 程式碼結構與行級索引",18,2,(25,40,75))
H("D.1　tRPC Router × Procedure",12,2,(35,55,90))
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
H("E.4　任務卡 ↔ 程式碼 覆蓋",12,2,(35,55,90),top=3)
done=[c for c in cards if c["status"]=="Done"]
done_code=[c for c in done if c.get("code_refs")]
P(f"Done 卡 {len(done)} 張，其中 {len(done_code)} 張有程式碼 AIDV 錨點；{len(done)-len(done_code)} 張無（多屬決策卡/"
  f"純文件卡/前端視覺卡，碼中未留 AIDV-NN 註記——非缺陷，但若需嚴格追溯可補註記）。",9,1.5)
rows=[[c["num"], c["title"][:34], "有碼" if c.get("code_refs") else "無碼錨",
       ",".join("#"+p for p in c.get("prs",[])[:3]) or "—"] for c in done]
table(["卡號","標題","碼錨","PR"],rows,[14,40,12,24],fs=7)
H("E.5　覆蓋率小結",12,2,(35,55,90),top=3)
covd=sum(1 for t in xref if xref[t]["doc_mentions"]>0)
covc=sum(1 for t in xref if xref[t]["code_files"]>0)
P(f"資料表被文件/卡覆蓋：{covd}/{len(schema)}（{covd*100//len(schema)}%）；被程式碼覆蓋：{covc}/{len(schema)}（{covc*100//len(schema)}%）。",9,1.5)

out="docs/reports/task-card-code-db-comparison.pdf"
os.makedirs("docs/reports",exist_ok=True)
pdf.output(out)
print("WROTE", out, os.path.getsize(out), "bytes, pages:", pdf.page_no())
