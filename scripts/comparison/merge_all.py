# -*- coding: utf-8 -*-
import datetime, os
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter
FONT="/tmp/report_assets/wqy.ttf"

# constituent reports in order
parts=[
 ("docs/reports/task-card-code-db-comparison.pdf","主報告：任務卡×程式碼×資料庫×AI×UIUX×費用 全集（A–M）"),
 ("docs/reports/website-cost-analysis.pdf","深入附錄一：全站費用盤點與成本深度研究"),
 ("docs/reports/ai-tech-architecture-comparison.pdf","深入附錄二：AI 技術底層邏輯與技術選型/SOTA 比對"),
 ("docs/reports/ai-uiux-integrated-architecture.pdf","深入附錄三：AI 底層邏輯結構 × UIUX 結構系統 整合架構"),
 ("docs/reports/deep-logic-dive.pdf","深入附錄四：底層邏輯深挖 — 核心演算法逐一拆解"),
]
lens=[len(PdfReader(p).pages) for p,_ in parts]

# ---- build cover/index (1 page) ----
class PDF(FPDF):
    def footer(self):
        if self.page_no()==1:
            self.set_y(-12); self.set_font("wqy",size=7); self.set_text_color(150)
            self.cell(0,8,f"動態資料快照 {datetime.date.today().isoformat()}（持續新增/更新）· git/repo 實證自動產出 · 合本由 merge_all.py 串接",align="C")
pdf=PDF("P","mm","A4"); pdf.set_margins(14,14,14); pdf.set_auto_page_break(True,14)
pdf.add_font("wqy","",FONT); EPW=pdf.epw
def S(x):
    x=str(x)
    for k,v in {"×":"x","—":"-","◆":"*","→":"->","·":"·","•":"-"}.items(): x=x.replace(k,v)
    return "".join(c if ord(c)<0x2700 or 0x4e00<=ord(c)<=0x9fff or 0x3000<=ord(c)<=0x30ff or 0xff00<=ord(c)<=0xffef else "" for c in x)
pdf.add_page(); pdf.ln(14)
pdf.set_font("wqy",size=24); pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,12,S("healing-studio 全套技術盤點\n合本（單一檔）"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(2); pdf.set_font("wqy",size=12); pdf.set_text_color(90,90,90)
pdf.multi_cell(EPW,7,S("AI Director / director.today · 任務卡·程式碼·資料庫·AI·UIUX·費用·技術比對"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(3); pdf.set_font("wqy",size=10.5); pdf.set_text_color(150,30,30)
pdf.multi_cell(EPW,6,S(f"* 動態資料（持續新增/更新）· 本版快照 {datetime.date.today().isoformat()} · 重跑解析器即刷新 *"),align="C",new_x="LMARGIN",new_y="NEXT")
pdf.ln(8); pdf.set_text_color(0)
pdf.set_font("wqy",size=13); pdf.set_text_color(25,40,75)
pdf.multi_cell(EPW,8,S("總目錄（合本頁碼）"),new_x="LMARGIN",new_y="NEXT"); pdf.set_text_color(0); pdf.ln(2)
# page map: cover is page 1, content starts at 2
cur=2
pdf.set_font("wqy",size=10.5)
for (p,title),n in zip(parts,lens):
    rng=f"p.{cur}–{cur+n-1}（{n} 頁）"
    pdf.set_text_color(20,40,80)
    pdf.multi_cell(EPW,6.2,S(f"• {title}"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_text_color(110,110,110); pdf.set_font("wqy",size=9)
    pdf.multi_cell(EPW,5,S(f"    {rng}  ·  {os.path.basename(p)}"),new_x="LMARGIN",new_y="NEXT")
    pdf.set_font("wqy",size=10.5); pdf.ln(1.5)
    cur+=n
pdf.ln(3); pdf.set_text_color(70,70,70); pdf.set_font("wqy",size=9)
total=1+sum(lens)
pdf.multi_cell(EPW,5.2,S(f"合本共 {total} 頁（封面 1 + 四份報告 {sum(lens)}）。主報告已內含各附錄之精要章（Part I–M）；"
  "三份附錄為對應主題的深入版。全部由 scripts/comparison/ 解析器對 repo/live Jira/2026 定價自動萃取——"
  "屬動態資料，重跑即刷新。"),new_x="LMARGIN",new_y="NEXT")
pdf.output("/tmp/report_assets/_cover.pdf")
print("cover built; lens=",lens,"total=",total)

# ---- merge ----
w=PdfWriter()
for src in ["/tmp/report_assets/_cover.pdf"]+[p for p,_ in parts]:
    for pg in PdfReader(src).pages: w.add_page(pg)
out="docs/reports/healing-studio-complete-report.pdf"
with open(out,"wb") as fh: w.write(fh)
print("WROTE",out,os.path.getsize(out),"bytes,",len(PdfReader(out).pages),"pages")
