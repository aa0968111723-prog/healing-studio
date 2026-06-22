import json,glob,re,subprocess
schema=json.load(open("scripts/comparison/schema.json"))
tnames=sorted({t["table"] for t in schema}, key=len, reverse=True)
tvars={t["var"]:t["table"] for t in schema}

nodes=[]
for f in sorted(glob.glob("scripts/comparison/jira/page*.json")):
    nodes+=json.load(open(f))["issues"]["nodes"]
# de-dup by key
seen={}; 
for n in nodes: seen[n["key"]]=n
nodes=[seen[k] for k in sorted(seen, key=lambda x:int(x.split('-')[1]))]
print("unique cards:",len(nodes))

def grep_code(key):
    try:
        out=subprocess.run(["grep","-rnE",f"{key}\\b","server","client","shared"],
                           capture_output=True,text=True,timeout=60).stdout
    except Exception: out=""
    refs=[]
    for ln in out.splitlines():
        p=ln.split(":",2)
        if len(p)>=2: refs.append(f"{p[0]}:{p[1]}")
    return refs

cards=[]
status_count={}; type_count={}
for n in nodes:
    f=n["fields"]; key=n["key"]
    st=(f.get("status") or {}).get("name","")
    it=(f.get("issuetype") or {}).get("name","")
    pr=(f.get("priority") or {}).get("name","")
    labels=f.get("labels") or []
    parent=(f.get("parent") or {}).get("key","")
    desc=f.get("description") or ""
    if not isinstance(desc,str): desc=json.dumps(desc,ensure_ascii=False)
    summ=f.get("summary","")
    blob=summ+" "+desc
    # DB linkage: tables & migrations mentioned
    tbls=sorted({t for t in tnames if re.search(r"\b"+re.escape(t)+r"\b",blob)})
    tbls+= [tvars[v] for v in tvars if re.search(r"\b"+re.escape(v)+r"\b",blob) and tvars[v] not in tbls]
    migs=sorted(set(re.findall(r"\b(00\d\d|0\d\d\d)(?:_[a-z])?", blob)))
    prs=sorted(set(re.findall(r"#(\d{3,4})", blob)))
    code=grep_code(key)
    status_count[st]=status_count.get(st,0)+1
    type_count[it]=type_count.get(it,0)+1
    cards.append(dict(key=key,summary=summ,status=st,type=it,priority=pr,labels=labels,
                      parent=parent,desc=desc,tables=tbls[:12],migs=migs[:12],prs=prs[:8],code=code))
json.dump(cards, open("scripts/comparison/jira_cards.json","w"),ensure_ascii=False,indent=1)
print("status:",status_count)
print("types:",type_count)
print("cards w/ code anchor:",sum(1 for c in cards if c["code"]))
print("cards w/ table linkage:",sum(1 for c in cards if c["tables"]))
print("cards w/ PR:",sum(1 for c in cards if c["prs"]))
