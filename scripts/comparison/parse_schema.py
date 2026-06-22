import re, json, sys

SRC = "drizzle/schema.ts"
text = open(SRC, encoding="utf-8").read()

def split_top_level(s, seps=(",",)):
    """Split string at top-level separators, respecting (), {}, [], <>, and string literals."""
    out, buf = [], []
    depth = 0
    i = 0
    instr = None
    while i < len(s):
        c = s[i]
        if instr:
            buf.append(c)
            if c == "\\":
                if i+1 < len(s): buf.append(s[i+1]); i += 2; continue
            elif c == instr:
                instr = None
            i += 1; continue
        if c in "\"'`":
            instr = c; buf.append(c); i += 1; continue
        if c in "([{<":
            depth += 1; buf.append(c); i += 1; continue
        if c in ")]}>":
            depth -= 1; buf.append(c); i += 1; continue
        if depth == 0 and c in seps:
            out.append("".join(buf)); buf = []; i += 1; continue
        buf.append(c); i += 1
    if "".join(buf).strip():
        out.append("".join(buf))
    return out

def match_block(s, start, open_c, close_c):
    """Given index of open_c at s[start], return index just after matching close."""
    depth = 0; i = start; instr=None
    while i < len(s):
        c = s[i]
        if instr:
            if c == "\\": i += 2; continue
            if c == instr: instr=None
            i += 1; continue
        if c in "\"'`": instr=c; i+=1; continue
        if c == open_c: depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0: return i+1
        i += 1
    return -1

def strip_comments(s):
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"//[^\n]*", "", s)
    return s

tables = []
for m in re.finditer(r"export const (\w+)\s*=\s*mysqlTable\(", text):
    var = m.group(1)
    p = text.index("(", m.end()-1)
    end = match_block(text, p, "(", ")")
    body = text[p+1:end-1]
    # first string literal = table name
    nm = re.search(r"""["'`]([^"'`]+)["'`]""", body)
    tname = nm.group(1) if nm else var
    # first {...} = columns object
    bo = body.index("{")
    bend = match_block(body, bo, "{", "}")
    cols_src = body[bo+1:bend-1]
    rest = body[bend:]
    # columns
    cols = []
    for ent in split_top_level(cols_src):
        e = ent.strip()
        if not e: continue
        cm = re.match(r"^(\w+)\s*:\s*(.*)$", e, flags=re.S)
        if not cm: continue
        cname, val = cm.group(1), cm.group(2)
        valc = strip_comments(val)
        typem = re.match(r"\s*(\w+)\s*\(", valc)
        typ = typem.group(1) if typem else "?"
        # db column name
        dbm = re.search(r"""\(\s*["'`]([^"'`]+)["'`]""", valc)
        dbcol = dbm.group(1) if dbm else cname
        is_index = typ in ("index","uniqueIndex","primaryKey","foreignKey","unique") or ".on(" in valc
        # flags
        flags = []
        if ".primaryKey(" in valc: flags.append("PK")
        if ".autoincrement(" in valc: flags.append("AUTO_INC")
        if ".notNull(" in valc: flags.append("NOT NULL")
        if ".unique(" in valc: flags.append("UNIQUE")
        dq = re.search(r"\.default\(([^)]*)\)", valc)
        if ".defaultNow(" in valc: flags.append("DEFAULT now()")
        elif dq: flags.append("DEFAULT " + dq.group(1).strip().strip("\"'`")[:40])
        if ".onUpdateNow(" in valc: flags.append("ON UPDATE now()")
        ln = re.search(r"length\s*:\s*(\d+)", valc)
        length = ln.group(1) if ln else None
        # enum values
        enum_vals = None
        if typ in ("mysqlEnum",):
            em = re.search(r"\[([^\]]*)\]", valc)
            if em: enum_vals = [v.strip().strip("\"'`") for v in em.group(1).split(",") if v.strip()]
        raw = re.sub(r"\s+"," ", strip_comments(e)).strip()
        rec = dict(name=cname, db=dbcol, type=typ, length=length, flags=flags,
                   enum=enum_vals, raw=raw, is_index=is_index)
        cols.append(rec)
    columns = [c for c in cols if not c["is_index"]]
    indexes = [c for c in cols if c["is_index"]]
    # also parse callback indexes: (table) => ({ ... })
    cb = re.search(r"=>\s*\(?\s*\{", rest)
    if cb:
        bo2 = rest.index("{", cb.start())
        bend2 = match_block(rest, bo2, "{", "}")
        for ent in split_top_level(rest[bo2+1:bend2-1]):
            e = strip_comments(ent).strip()
            if not e: continue
            im = re.match(r"^(\w+)\s*:\s*(.*)$", e, flags=re.S)
            if not im: continue
            iname, ival = im.group(1), re.sub(r"\s+"," ", im.group(2)).strip()
            indexes.append(dict(name=iname, raw=ival[:160], is_index=True))
    tables.append(dict(var=var, table=tname, columns=columns, indexes=indexes))

json.dump(tables, open("scripts/comparison/schema.json","w"), ensure_ascii=False, indent=1)
print("tables:", len(tables))
print("total columns:", sum(len(t["columns"]) for t in tables))
print("total indexes:", sum(len(t["indexes"]) for t in tables))
# sanity print first table
t0 = tables[0]
print("first table:", t0["table"], "cols:", len(t0["columns"]))
for c in t0["columns"][:6]:
    print("  ", c["name"], c["type"], c["length"] or "", c["flags"])
