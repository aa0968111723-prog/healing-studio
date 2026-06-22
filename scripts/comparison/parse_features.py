import json, re, glob, os
jira=json.load(open("scripts/comparison/jira_cards.json"))
schema=json.load(open("scripts/comparison/schema.json"))
xref=json.load(open("scripts/comparison/table_xref.json"))

by_key={c["key"]:c for c in jira}
epics={c["key"]:c["summary"] for c in jira if c["type"]=="大型工作"}

# ---------- EXISTING FEATURES (Part G) ----------
done=[c for c in jira if c["status"]=="完成"]
inprog=[c for c in jira if c["status"]=="進行中"]
# group done by parent epic
def group_by_epic(cards):
    g={}
    for c in cards:
        p=c.get("parent") or "(無父卡)"
        g.setdefault(p,[]).append(c)
    return g
done_by_epic=group_by_epic(done)
inprog_by_epic=group_by_epic(inprog)

# client pages
pages=sorted(os.path.basename(f)[:-4] for f in glob.glob("client/src/pages/*.tsx") if not f.endswith(".test.tsx"))
shells=sorted(os.path.basename(f)[:-4] for f in glob.glob("client/src/shells/*.tsx") if not f.endswith(".test.tsx") and ".flag" not in f)

existing={
 "done_by_epic":{k:[{"key":c["key"],"summary":c["summary"],"prs":c["prs"],"tables":c["tables"]} for c in v]
                 for k,v in sorted(done_by_epic.items(), key=lambda kv:-len(kv[1]))},
 "epics":epics, "pages":pages, "shells":shells,
}
json.dump(existing, open("scripts/comparison/existing.json","w"), ensure_ascii=False, indent=1)
print("existing: done", len(done), "epics", len(epics), "pages", len(pages))

# ---------- FUTURE ROADMAP (Part H) ----------
backlog=[c for c in jira if c["status"] in ("Backlog","Selected for Development")]
# future features grouped by epic
future_by_epic={}
for c in inprog+backlog:
    p=c.get("parent") or "(無父卡)"
    future_by_epic.setdefault(p,{"epic":epics.get(p,""),"inprog":[],"backlog":[]})
    bucket = "inprog" if c["status"]=="進行中" else "backlog"
    future_by_epic[p][bucket].append({"key":c["key"],"summary":c["summary"],"type":c["type"],
                                      "priority":c["priority"],"tables":c["tables"],"migs":c["migs"]})
# future CODE: cards whose desc mentions 待接/待後端/待補/待建/needs-key
KW=["待接","待後端","待補","待建","待擴","needs-key","缺金鑰","待 G","Phase 2","未接線","待 Bruce"]
future_code=[]
for c in inprog+backlog:
    hits=[k for k in KW if k in (c.get("desc","")+c.get("summary",""))]
    if hits:
        snip=re.sub(r"\s+"," ",c.get("desc","")).strip()
        future_code.append({"key":c["key"],"summary":c["summary"],"status":c["status"],
                            "hits":hits,"snip":snip[:260]})
# future DB: tables referenced only by non-done cards, or tables with zero code (planned/未接)
planned_tables=[t for t in xref if xref[t]["code_files"]==0]
future_tables_from_cards={}
done_keys={c["key"] for c in done}
for c in inprog+backlog:
    for t in c["tables"]:
        future_tables_from_cards.setdefault(t,[]).append(c["key"])

future={
 "by_epic":dict(sorted(future_by_epic.items(), key=lambda kv:-(len(kv[1]["inprog"])+len(kv[1]["backlog"])))),
 "future_code":future_code,
 "planned_tables":planned_tables,
 "future_tables_from_cards":future_tables_from_cards,
}
json.dump(future, open("scripts/comparison/future.json","w"), ensure_ascii=False, indent=1)
print("future: inprog", len(inprog), "backlog", len(backlog), "future_code cards", len(future_code),
      "epics", len(future_by_epic))
