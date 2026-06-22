import re, json, csv, os, glob, subprocess

# ---------- MIGRATIONS ----------
journal = json.load(open("drizzle/meta/_journal.json"))
reg_tags = {e["tag"] for e in journal["entries"]}
migs = []
for f in sorted(glob.glob("drizzle/*.sql")) + sorted(glob.glob("db/migrations/*")):
    name = os.path.basename(f)
    tag = re.sub(r"\.sql$","",name)
    body = open(f, encoding="utf-8", errors="replace").read()
    stmts = []
    for kw in ["CREATE TABLE","ALTER TABLE","CREATE INDEX","CREATE UNIQUE INDEX","DROP TABLE","DROP INDEX","RENAME"]:
        for mm in re.finditer(kw + r"\s+(?:IF NOT EXISTS\s+)?[`\"]?(\w+)[`\"]?", body, re.I):
            stmts.append(f"{kw} {mm.group(1)}")
    nbreak = body.count("statement-breakpoint")
    registered = tag in reg_tags
    migs.append(dict(file=name, tag=tag, registered=registered,
                     statements=stmts[:40], n_break=nbreak, bytes=len(body)))
json.dump(migs, open("scripts/comparison/migrations.json","w"), ensure_ascii=False, indent=1)
orphans = [m["file"] for m in migs if not m["registered"] and m["file"].startswith("0")]
print("migrations:", len(migs), "registered:", sum(m["registered"] for m in migs), "orphans:", orphans)

# ---------- CARDS: CSV ----------
csv_cards = []
with open("docs/plan/jira-import.csv", encoding="utf-8") as fh:
    rd = csv.DictReader(fh)
    for row in rd:
        csv_cards.append({k.strip():(v or "").strip() for k,v in row.items()})
print("csv rows:", len(csv_cards))

# ---------- CARDS: AIDV-NN from master plan ----------
plan = open("docs/plan/AIDV-master-plan.md", encoding="utf-8").read()
# markdown table rows containing AIDV-NN
def clean(s): return re.sub(r"\s+"," ", s).strip()
rows = {}
for line in plan.splitlines():
    if line.strip().startswith("|") and "AIDV-" in line:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        nums = re.findall(r"AIDV-(\d+)", line)
        for n in nums:
            rows.setdefault(n, []).append(cells)
# Build per-number record: title guess = first cell of a row; status cell with emoji; PR refs
status_emoji = {"✅":"Done","🔄":"In Progress","📋":"To Do/Backlog","⛔":"Blocked","🔴":"P0/urgent"}
cards = {}
for n, rowlist in rows.items():
    title=""; status=""; prs=set(); acc=""
    for cells in rowlist:
        if cells and not title and "AIDV-" not in cells[0]:
            title = clean(cells[0])
        for cell in cells:
            for em,st in status_emoji.items():
                if em in cell and not status: status=st
            for pr in re.findall(r"#(\d{3,4})", cell): prs.add(pr)
            if len(cell)>len(acc) and "AIDV-" not in cell and "|" not in cell and cell not in title:
                acc=clean(cell)
    cards[n] = dict(num=f"AIDV-{n}", title=title, status=status, prs=sorted(prs), note=acc[:300])
# Add any AIDV-NN found anywhere in plan but not in tables (prose-only) with context snippet
for n in sorted(set(re.findall(r"AIDV-(\d+)", plan)), key=int):
    if n not in cards:
        # find first prose line mentioning it
        ctx=""
        for line in plan.splitlines():
            if f"AIDV-{n}" in line:
                ctx=clean(line)[:300]; break
        cards[n]=dict(num=f"AIDV-{n}", title="(見備註)", status="", prs=re.findall(r"#(\d{3,4})",ctx), note=ctx)
cards_list = [cards[n] for n in sorted(cards, key=int)]
print("AIDV cards:", len(cards_list))

# ---------- CODE EVIDENCE: grep AIDV-NN across code ----------
def grep_card(num):
    try:
        out = subprocess.run(["grep","-rnE",f"AIDV-{num}\\b","server","client","shared"],
                             capture_output=True,text=True,timeout=60).stdout
    except Exception:
        out=""
    refs=[]
    for ln in out.splitlines()[:25]:
        parts=ln.split(":",2)
        if len(parts)>=2:
            refs.append(f"{parts[0]}:{parts[1]}")
    return refs
for c in cards_list:
    n=c["num"].split("-")[1]
    c["code_refs"]=grep_card(n)
json.dump(cards_list, open("scripts/comparison/cards.json","w"), ensure_ascii=False, indent=1)
json.dump(csv_cards, open("scripts/comparison/csv_cards.json","w"), ensure_ascii=False, indent=1)
print("cards with code refs:", sum(1 for c in cards_list if c["code_refs"]))
