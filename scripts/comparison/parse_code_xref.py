import re, json, glob, os, subprocess

# ---------- ROUTERS & PROCEDURES ----------
routers=[]
for f in sorted(glob.glob("server/routers/*.ts")):
    if f.endswith(".test.ts"): continue
    body=open(f,encoding="utf-8",errors="replace").read()
    procs=[]
    for mm in re.finditer(r"^\s*(\w+)\s*:\s*(public|protected|admin|leader)\w*Procedure", body, re.M):
        procs.append(mm.group(1))
    # also routerName.proc style: name: t.procedure / .query/.mutation
    routers.append(dict(file=os.path.basename(f), procedures=procs, n=len(procs),
                        lines=body.count(chr(10))+1))
json.dump(routers, open("scripts/comparison/routers.json","w"), ensure_ascii=False, indent=1)
print("routers:", len(routers), "total procedures:", sum(r["n"] for r in routers))

# ---------- FLAGS ----------
flags=[]
for f in glob.glob("client/src/config/*Flags.ts")+["server/_core/env.validated.ts"]:
    if not os.path.exists(f): continue
    body=open(f,encoding="utf-8",errors="replace").read()
    for mm in re.finditer(r"(ENABLE_[A-Z0-9_]+|[A-Z][A-Z0-9_]*_FLAGS?)", body):
        flags.append((mm.group(1), os.path.basename(f)))
flags=sorted(set(flags))
json.dump(flags, open("scripts/comparison/flags.json","w"), ensure_ascii=False, indent=1)
print("flag tokens:", len(flags))

# ---------- BROADEN CARDS across all docs ----------
allnums=set()
docfiles=glob.glob("docs/**/*.md",recursive=True)+["todo.md","COORDINATION.md","AGENTS.md"]
for f in docfiles:
    if not os.path.exists(f): continue
    allnums |= set(re.findall(r"AIDV-(\d+)", open(f,encoding="utf-8",errors="replace").read()))
cards=json.load(open("scripts/comparison/cards.json"))
have={c["num"] for c in cards}
for n in sorted(allnums,key=int):
    if f"AIDV-{n}" not in have:
        # context from any doc
        ctx=""
        for f in docfiles:
            if not os.path.exists(f): continue
            for line in open(f,encoding="utf-8",errors="replace"):
                if f"AIDV-{n}" in line:
                    ctx=re.sub(r"\s+"," ",line).strip()[:300]; break
            if ctx: break
        cards.append(dict(num=f"AIDV-{n}",title="(見備註)",status="",prs=re.findall(r"#(\d{3,4})",ctx),note=ctx,code_refs=[]))
cards.sort(key=lambda c:int(c["num"].split("-")[1]))
json.dump(cards, open("scripts/comparison/cards.json","w"), ensure_ascii=False, indent=1)
print("total cards (all docs):", len(cards))

# ---------- TABLE <-> CARD / MIGRATION CROSS-REF ----------
schema=json.load(open("scripts/comparison/schema.json"))
tnames=[t["table"] for t in schema]
# corpus = plan + csv + per-card docs
corpus=""
for f in docfiles:
    if os.path.exists(f): corpus+=open(f,encoding="utf-8",errors="replace").read()+"\n"
xref={}
for t in tnames:
    # which card/doc lines mention this table
    cnt=corpus.count(t)
    # code usage: grep schema import usage
    try:
        c2=subprocess.run(["grep","-rlE",rf"\b{re.escape(t)}\b","server","shared"],
                          capture_output=True,text=True,timeout=60).stdout.splitlines()
    except Exception: c2=[]
    xref[t]=dict(doc_mentions=cnt, code_files=len(c2))
json.dump(xref, open("scripts/comparison/table_xref.json","w"), ensure_ascii=False, indent=1)
tables_no_doc=[t for t in tnames if xref[t]["doc_mentions"]==0]
tables_no_code=[t for t in tnames if xref[t]["code_files"]==0]
print("tables not mentioned in any doc/card:", len(tables_no_doc))
print("tables not referenced in server/shared code:", len(tables_no_code), tables_no_code[:10])
