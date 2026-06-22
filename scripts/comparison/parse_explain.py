import re, json, glob, os

# ───────────── 1. PER-COLUMN EXPLANATIONS (from schema.ts comments) ─────────────
TYPES = r"(int|bigint|varchar|text|mediumtext|longtext|mysqlEnum|json|boolean|timestamp|datetime|decimal|date|float|double|char|tinyint|serial)"
var2tbl = {t["var"]: t["table"] for t in json.load(open("scripts/comparison/schema.json"))}
lines = open("drizzle/schema.ts", encoding="utf-8").read().split("\n")
col_doc = {}            # table -> {col -> explanation}
cur_table = None
pending = []            # accumulated comment lines
in_block = False
block_buf = []
await_name = False
for ln in lines:
    s = ln.strip()
    m_tbl = re.search(r'export const (\w+)\s*=\s*mysqlTable\(', ln)
    if m_tbl:
        cur_table = var2tbl.get(m_tbl.group(1), m_tbl.group(1))
        col_doc.setdefault(cur_table, {})
        nm = re.search(r'mysqlTable\(\s*"([a-z_0-9]+)"', ln)
        await_name = nm is None
        pending = []; continue
    if cur_table is None:
        continue
    if await_name:
        if re.match(r'^"[a-z_0-9]+",?$', s):
            await_name = False
        continue
    # block comment /** ... */
    if in_block:
        block_buf.append(re.sub(r'^\*+', '', s).strip(' */'))
        if "*/" in s:
            in_block = False
            pending.append(" ".join(x for x in block_buf if x).strip())
            block_buf = []
        continue
    if s.startswith("/**") and "*/" in s:
        pending.append(s.strip("/* ").strip())
        continue
    if s.startswith("/**"):
        in_block = True; block_buf=[s.strip("/* ").strip()]; continue
    if s.startswith("//"):
        c = s.lstrip("/ ").strip()
        if c and not re.match(r'^[─=–\-—\s]+$', c) and "──" not in c:
            pending.append(c)
        continue
    # column line?
    mc = re.match(rf'^(\w+):\s*{TYPES}\(', s)
    if mc and cur_table:
        col = mc.group(1)
        inline = ""
        im = re.search(r'//\s*(.+)$', ln)
        if im: inline = im.group(1).strip()
        expl = " ".join([p for p in pending if p] + ([inline] if inline else [])).strip()
        if expl:
            col_doc[cur_table][col] = expl[:240]
        pending = []
        continue
    # blank or other resets short pending noise but keep JSDoc attached to next col
    if s == "" :
        # keep pending (JSDoc may be separated by nothing); but drop if too far — reset on blank
        pending = []
ncols = sum(len(v) for v in col_doc.values())
json.dump(col_doc, open("scripts/comparison/col_doc.json","w"), ensure_ascii=False, indent=1)
print("columns with explanation:", ncols, "across", sum(1 for v in col_doc.values() if v), "tables")

# ───────────── 2. PER-PROCEDURE EXPLANATIONS (router leading comments) ─────────────
proc_doc = {}
for f in sorted(glob.glob("server/routers/*.ts")):
    if f.endswith(".test.ts"): continue
    L = open(f, encoding="utf-8").read().split("\n")
    rf = os.path.basename(f); items=[]
    pend=[]
    for i, ln in enumerate(L):
        s=ln.strip()
        if s.startswith("//"):
            c=s.lstrip("/ ").strip()
            if c and "──" not in c and not re.match(r'^[─=–\-—\s]+$', c): pend.append(c)
            continue
        mp=re.match(r'^(\w+):\s*(public|protected|admin|leader)\w*Procedure', s)
        if mp:
            name=mp.group(1); kind=mp.group(2)
            # find op type + input within next ~8 lines
            op=""; inp=""
            for j in range(i, min(i+12,len(L))):
                if re.search(r'\.query\(', L[j]) and not op: op="query"
                if re.search(r'\.mutation\(', L[j]) and not op: op="mutation"
                mi=re.search(r'\.input\(\s*z\.(\w+)\(', L[j])
                if mi and not inp: inp=mi.group(1)
            items.append(dict(name=name, kind=kind, op=op, input=inp,
                              doc=" ".join(pend)[:160]))
            pend=[]
            continue
        if s=="" : pend=[]
    if items: proc_doc[rf]=items
json.dump(proc_doc, open("scripts/comparison/proc_doc.json","w"), ensure_ascii=False, indent=1)
print("routers with proc docs:", len(proc_doc), "procedures:", sum(len(v) for v in proc_doc.values()))

# ───────────── 3. CORE-FILE LINE-LEVEL COMMENT WALKTHROUGH ─────────────
CORE = [
 "server/services/postGenActions.ts",
 "server/_core/generationLock.ts",
 "server/_core/providerFacade.ts",
 "server/_core/redisGenerationLockStore.ts",
 "shared/orb-cost-governor.ts",
 "shared/agent-plan-safety.ts",
 "server/routers/creativeProject.ts",
]
core_doc={}
for f in CORE:
    if not os.path.exists(f): continue
    L=open(f,encoding="utf-8").read().split("\n")
    rows=[]
    for i,ln in enumerate(L,1):
        s=ln.strip()
        c=None
        if s.startswith("//"):
            c=s.lstrip("/ ").strip()
        elif s.startswith("/**") or (s.startswith("*") and not s.startswith("*/")):
            c=s.strip("/* ").strip()
        if c and len(c)>4 and "──" not in c and not re.match(r'^[─=–\-—\s]+$',c):
            rows.append([i, c[:170]])
    if rows: core_doc[f]={"loc":len(L),"comments":rows[:120]}
json.dump(core_doc, open("scripts/comparison/core_doc.json","w"), ensure_ascii=False, indent=1)
print("core files annotated:", len(core_doc), "comment lines:", sum(len(v["comments"]) for v in core_doc.values()))
