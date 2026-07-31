import json, glob, re, os
schema=json.load(open("scripts/comparison/schema.json"))
routers=json.load(open("scripts/comparison/routers.json"))
flags=json.load(open("scripts/comparison/flags.json"))
census=json.load(open("scripts/comparison/census.json"))
jira=json.load(open("scripts/comparison/jira_cards.json"))

def count_procs():
    tot=0
    for f in glob.glob("server/**/*.ts",recursive=True):
        if f.endswith(".test.ts"): continue
        b=open(f,encoding="utf-8",errors="replace").read()
        tot+=len(re.findall(r"\b\w+:\s*(?:public|protected|admin|leader)[A-Za-z]*Procedure", b))
    return tot
routes = len(re.findall(r"<Route\b", open("client/src/App.tsx",encoding="utf-8").read()))
pages = len([x for x in glob.glob('client/src/pages/*.tsx') if not x.endswith('.test.tsx')])
measured = {
 "資料表 tables": len(schema),
 "資料欄位 columns": sum(len(t['columns']) for t in schema),
 "索引/約束 indexes": sum(len(t['indexes']) for t in schema),
 "Migration 檔": len(glob.glob('drizzle/*.sql'))+len(glob.glob('db/migrations/*')),
 "前端路由 routes (App.tsx <Route>)": routes,
 "前端頁面 pages": pages,
 "tRPC router 檔 (routers/)": len(routers),
 "tRPC procedure（routers/ 內）": sum(r['n'] for r in routers),
 "tRPC procedure（全 server 實測）": count_procs(),
 "Feature flag token": len(flags),
 "原始碼檔數": census['total_files'],
 "原始碼行數": census['total_loc'],
 "Jira 任務卡（live AIDV 全量）": len(jira),
}
# SSOT/簡報 宣稱值（master-plan §1）；None=未宣稱
claimed = {
 "資料表 tables": 82,
 "資料欄位 columns": None,
 "索引/約束 indexes": None,
 "Migration 檔": None,
 "前端路由 routes (App.tsx <Route>)": 54,
 "前端頁面 pages": 50,
 "tRPC router 檔 (routers/)": 34,
 "tRPC procedure（routers/ 內）": None,
 "tRPC procedure（全 server 實測）": 565,
 "Feature flag token": None,
 "原始碼檔數": None,
 "原始碼行數": None,
 "Jira 任務卡（live AIDV 全量）": 315,
}
note = {
 "資料表 tables": "簡報 82＝舊快照；現 main 已增至 87（含 cost/orb/連接器等新表）",
 "前端路由 routes (App.tsx <Route>)": "簡報 54；現 55（含新增頁）",
 "tRPC router 檔 (routers/)": "簡報 34＝早期；現 routers/ 37 檔",
 "tRPC procedure（全 server 實測）": "簡報 ~565 為估算；本報告實測 name:xProcedure 全 server＝下方數值（含 routers.ts appRouter inline 122）",
 "Jira 任務卡（live AIDV 全量）": "Bruce 口述 315；live Jira JQL 實拉全量＝下方數值",
 "資料欄位 columns": "本報告修正解析器漏抓帶 /** */ 註解欄位後之真實全量（曾誤為 908）",
}
recon=[]
for k in measured:
    c=claimed.get(k); m=measured[k]
    diff = "" if c is None else ("一致" if c==m else f"{'+' if m>c else ''}{m-c}")
    recon.append({"item":k,"claimed":("—" if c is None else c),"measured":m,"diff":diff,"note":note.get(k,"")})
json.dump(recon, open("scripts/comparison/recon.json","w"), ensure_ascii=False, indent=1)
for r in recon: print(f"{r['item']:38s} 宣稱={r['claimed']!s:>6}  實測={r['measured']!s:>8}  差={r['diff']}")
