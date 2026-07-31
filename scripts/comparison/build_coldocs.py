import re, json
text=open("drizzle/schema.ts",encoding="utf-8").read()

def match_block(s,start,o,c):
    depth=0;i=start;instr=None
    while i<len(s):
        ch=s[i]
        if instr:
            if ch=="\\":i+=2;continue
            if ch==instr:instr=None
            i+=1;continue
        if ch in "\"'`":instr=ch;i+=1;continue
        if ch==o:depth+=1
        elif ch==c:
            depth-=1
            if depth==0:return i+1
        i+=1
    return -1

def split_top(s):
    out=[];buf=[];depth=0;i=0;instr=None
    while i<len(s):
        ch=s[i]
        if instr:
            buf.append(ch)
            if ch=="\\" and i+1<len(s):buf.append(s[i+1]);i+=2;continue
            if ch==instr:instr=None
            i+=1;continue
        if ch in "\"'`":instr=ch;buf.append(ch);i+=1;continue
        if ch in "([{<":depth+=1;buf.append(ch);i+=1;continue
        if ch in ")]}>":depth-=1;buf.append(ch);i+=1;continue
        if depth==0 and ch==",":out.append("".join(buf));buf=[];i+=1;continue
        buf.append(ch);i+=1
    if "".join(buf).strip():out.append("".join(buf))
    return out

def lead_comment(entry):
    """extract leading /** */ or // comments from a column entry"""
    cs=[]
    s=entry.lstrip()
    while True:
        s=s.lstrip()
        m=re.match(r"/\*\*?(.*?)\*/",s,flags=re.S)
        if m:
            cs.append(re.sub(r"\s*\*\s*"," ",m.group(1)).strip())
            s=s[m.end():];continue
        m=re.match(r"//([^\n]*)\n",s)
        if m:
            c=m.group(1).strip()
            if c and "──" not in c and not re.match(r"^[─=–\-—\s]+$",c): cs.append(c)
            s=s[m.end():];continue
        break
    # trailing inline // on the column line
    tail=re.search(r"//\s*(.+)$", entry.strip().split("\n")[-1])
    if tail and "──" not in tail.group(1): cs.append(tail.group(1).strip())
    return " ".join(x for x in cs if x).strip()

col_doc={}
for m in re.finditer(r"export const (\w+)\s*=\s*mysqlTable\(", text):
    p=text.index("(",m.end()-1); end=match_block(text,p,"(",")")
    body=text[p+1:end-1]
    nm=re.search(r"""["'`]([^"'`]+)["'`]""",body); tname=nm.group(1) if nm else m.group(1)
    bo=body.index("{"); bend=match_block(body,bo,"{","}")
    cols=body[bo+1:bend-1]
    d={}
    for ent in split_top(cols):
        cm=re.match(r"\s*(?:/\*.*?\*/\s*|//[^\n]*\n\s*)*(\w+)\s*:",ent,flags=re.S)
        if not cm: continue
        name=cm.group(1)
        # only real column types
        if not re.search(rf"{name}\s*:\s*(int|bigint|varchar|text|mediumtext|longtext|mysqlEnum|json|boolean|timestamp|datetime|decimal|date|float|double|char|tinyint|serial)\(",ent):
            continue
        c=lead_comment(ent)
        if c: d[name]=c[:240]
    col_doc[tname]=d
json.dump(col_doc,open("scripts/comparison/col_doc.json","w"),ensure_ascii=False,indent=1)
# verify against schema
schema=json.load(open("scripts/comparison/schema.json"))
sc={(t["table"],c["name"]) for t in schema for c in t["columns"]}
ak=[(tb,cn) for tb,cs in col_doc.items() for cn in cs]
print("authored:",len(ak),"match real schema col:",sum(1 for k in ak if k in sc))
