import re, json, subprocess
schema=json.load(open("scripts/comparison/schema.json"))
xref=json.load(open("scripts/comparison/table_xref.json"))
for t in schema:
    var=t["var"]; tbl=t["table"]
    try:
        files=subprocess.run(["grep","-rlw",var,"server","shared","client"],
            capture_output=True,text=True,timeout=60).stdout.splitlines()
        # exclude the schema file itself
        files=[f for f in files if not f.endswith("drizzle/schema.ts")]
    except Exception: files=[]
    xref[tbl]["var"]=var
    xref[tbl]["code_files"]=len(files)
    xref[tbl]["code_sample"]=files[:3]
json.dump(xref, open("scripts/comparison/table_xref.json","w"), ensure_ascii=False, indent=1)
no_code=[t for t in xref if xref[t]["code_files"]==0]
no_doc=[t for t in xref if xref[t]["doc_mentions"]==0]
print("tables with 0 code refs (by var):", len(no_code), no_code)
print("tables with 0 doc/card mentions:", len(no_doc))
