import os,re,json,glob,subprocess

# ---------- FULL CODE CENSUS ----------
exts=(".ts",".tsx",".js",".jsx",".mjs",".cjs",".sql",".css",".json",".md",".py",".yml",".yaml")
skip=("node_modules",".git","dist","build",".cache","coverage","patches","package-lock.json")
areas={}
filecount=0; loctotal=0
biggest=[]
for root,dirs,files in os.walk("."):
    dirs[:]=[d for d in dirs if d not in skip and not d.startswith(".git")]
    if any(s in root for s in skip): continue
    for fn in files:
        if not fn.endswith(exts): continue
        p=os.path.join(root,fn).replace("./","",1)
        if any(s in p for s in skip): continue
        try: loc=sum(1 for _ in open(p,encoding="utf-8",errors="replace"))
        except Exception: loc=0
        top=p.split("/")[0]
        sub="/".join(p.split("/")[:2]) if "/" in p else top
        ext=os.path.splitext(fn)[1]
        a=areas.setdefault(sub,{"files":0,"loc":0,"by_ext":{}})
        a["files"]+=1; a["loc"]+=loc; a["by_ext"][ext]=a["by_ext"].get(ext,0)+1
        filecount+=1; loctotal+=loc
        biggest.append((loc,p))
biggest.sort(reverse=True)
census={"total_files":filecount,"total_loc":loctotal,
        "areas":dict(sorted(areas.items(),key=lambda kv:-kv[1]["loc"])),
        "biggest":biggest[:40]}
# test files count
testfiles=subprocess.run(["bash","-lc","grep -rl '' --include='*.test.ts' --include='*.test.tsx' server client shared 2>/dev/null | wc -l"],capture_output=True,text=True).stdout.strip()
census["test_files"]=testfiles
json.dump(census,open("scripts/comparison/census.json","w"),ensure_ascii=False,indent=1)
print("CODE CENSUS files:",filecount,"loc:",loctotal,"areas:",len(areas),"tests:",testfiles)

# ---------- RAILWAY / DEPLOY INVENTORY (from repo) ----------
rail={}
for f in ["railway.toml",".nixpacks.toml","Dockerfile",".dockerignore","railway.json","Procfile","nixpacks.toml"]:
    if os.path.exists(f):
        rail[f]=open(f,encoding="utf-8",errors="replace").read()
# env var catalog from .env.example (NAMES ONLY — strip any values for safety)
envcat=[]
if os.path.exists(".env.example"):
    cur_section=""
    for line in open(".env.example",encoding="utf-8",errors="replace"):
        s=line.rstrip("\n")
        if re.match(r"^\s*#",s):
            t=s.strip("# ").strip()
            if t and len(t)<80: cur_section=t
            continue
        m=re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$",s)
        if m:
            name=m.group(1); val=m.group(2).strip()
            # classify: looks like secret?
            secret=bool(re.search(r"KEY|SECRET|TOKEN|PASSWORD|DSN|URL|CREDENTIAL|PRIVATE|WEBHOOK",name))
            has_val = "yes" if (val and not val.startswith("<") and val not in('""',"''")) else "no"
            envcat.append({"name":name,"section":cur_section,"secret":secret,"example_present":has_val})
rail["_env_count"]=len(envcat)
json.dump({"files":rail,"env":envcat},open("scripts/comparison/railway.json","w"),ensure_ascii=False,indent=1)
print("RAILWAY files:",[k for k in rail if not k.startswith('_')],"env vars cataloged:",len(envcat),
      "secret-class:",sum(1 for e in envcat if e['secret']))
