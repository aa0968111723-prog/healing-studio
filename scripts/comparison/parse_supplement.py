import re, json, glob, os, subprocess
from collections import defaultdict, Counter
out={}

# 1) TESTS by area
tests=glob.glob("server/**/*.test.ts",recursive=True)+glob.glob("client/**/*.test.tsx",recursive=True)+glob.glob("client/**/*.test.ts",recursive=True)+glob.glob("shared/**/*.test.ts",recursive=True)
area=Counter()
for t in tests:
    top=t.split("/")[0]; area[top]+=1
out["tests"]={"total":len(tests),"by_top":dict(area),
  "server":len(glob.glob('server/**/*.test.ts',recursive=True)),
  "client":len(glob.glob('client/**/*.test.tsx',recursive=True))+len(glob.glob('client/**/*.test.ts',recursive=True)),
  "shared":len(glob.glob('shared/**/*.test.ts',recursive=True))}
# theme buckets by filename keyword
themes={"agent/orb":r"agent|orb|planner|spirit","cost/credit":r"cost|credit|ledger|pricing|deduct","auth/security":r"auth|jwt|rbac|verifyToken|idor|webhook|moderation|defense|2fa|password","migration/db":r"migration|schema|drizzle|journal","generation":r"generat|fal|video|image|voice|lora|studio","ui/shell":r"shell|panel|state|chrome|cockpit|design-kit|route|navigation"}
tb={}
for k,rx in themes.items(): tb[k]=sum(1 for t in tests if re.search(rx,os.path.basename(t),re.I))
out["tests"]["themes"]=tb

# 2) SPIRITS / roles
roles=[]
src=open("shared/orb-agent-roles.ts",encoding="utf-8").read()
for m in re.finditer(r"\bid:\s*\"([a-z0-9_-]+)\"[^}]*?\bname:\s*\"([^\"]+)\"", src, re.S):
    roles.append((m.group(1),m.group(2)))
# fallback: name fields
names=re.findall(r'name:\s*"([^"]+精?[師靈手家者長官]?[^"]*)"', src)
out["spirits"]={"role_pairs":roles[:60],"name_count":len(set(re.findall(r'\bname:\s*"([^"]+)"',src))),
  "file_lines":src.count(chr(10))+1}

# 3) FK edges across migrations
fks=[]
for f in sorted(glob.glob("drizzle/*.sql")):
    b=open(f,encoding="utf-8",errors="replace").read()
    for m in re.finditer(r"ALTER TABLE\s+[`\"]?(\w+)[`\"]?[^;]*?FOREIGN KEY\s*\(\s*[`\"]?(\w+)[`\"]?\s*\)\s*REFERENCES\s+[`\"]?(\w+)[`\"]?\s*\(\s*[`\"]?(\w+)", b, re.I|re.S):
        fks.append({"from":m.group(1),"col":m.group(2),"to":m.group(3),"ref":m.group(4),"mig":os.path.basename(f)})
    for m in re.finditer(r"REFERENCES\s+[`\"]?(\w+)[`\"]?\s*\(\s*[`\"]?(\w+)", b, re.I):
        pass
out["fks"]=fks
out["fk_count"]=len(fks)

# 4) CRON jobs
jobs=[]
for f in sorted(glob.glob("server/jobs/*.ts")):
    if f.endswith(".test.ts"): continue
    head=open(f,encoding="utf-8",errors="replace").read()[:600]
    desc=""
    mm=re.search(r"/\*\*?\s*\n?\s*\*?\s*([^\n*][^\n]{6,90})", head)
    if mm: desc=mm.group(1).strip()
    jobs.append({"file":os.path.basename(f),"desc":desc[:90]})
out["jobs"]=jobs

# 5) prompt library / slash commands
out["prompts"]={
 "promptReferenceLibrary_lines": (open("shared/promptReferenceLibrary.ts").read().count(chr(10))+1) if os.path.exists("shared/promptReferenceLibrary.ts") else 0,
 "slash_commands": re.findall(r'name:\s*"(/?[a-z][a-z0-9-]+)"', open("shared/slash-commands.ts").read()) if os.path.exists("shared/slash-commands.ts") else [],
}

# 6) env perf knobs
envk=[]
if os.path.exists(".env.example"):
    for line in open(".env.example",encoding="utf-8"):
        m=re.match(r"^\s*(CACHE_TTL_SECONDS|LLM_TIMEOUT_SECONDS|MAX_CONCURRENT_LLM_CALLS|SENSE_INTENT_TIMEOUT_SECONDS|JWT_ACCESS_TOKEN_EXPIRES_IN|PERPLEXITY_PER_USER_PER_DAY|PERPLEXITY_GLOBAL_PER_MINUTE|REDIS_KEY_PREFIX)\s*=(.*)$",line)
        if m: envk.append([m.group(1),m.group(2).strip() or "(空)"])
out["perf_env"]=envk

json.dump(out,open("scripts/comparison/supplement.json","w"),ensure_ascii=False,indent=1)
print("tests",out["tests"]["total"],"themes",tb)
print("spirits name_count",out["spirits"]["name_count"],"role_pairs",len(out["spirits"]["role_pairs"]))
print("FK edges",out["fk_count"])
print("cron jobs",len(jobs))
print("slash",len(out["prompts"]["slash_commands"]),"perf_env",len(envk))
