import json, re
schema=json.load(open("scripts/comparison/schema.json"))
col_doc=json.load(open("scripts/comparison/col_doc.json"))
proc_doc=json.load(open("scripts/comparison/proc_doc.json"))

FK={"userId":"使用者(users.id)","teamId":"團隊(teams.id)","promptId":"提示詞(prompt_library.id)",
 "assetId":"資產(digital_asset_library.id)","projectId":"創作專案(creative_projects.id)",
 "worldId":"世界觀框架","sessionId":"工作階段","modelId":"模型","jobId":"背景任務",
 "conversationId":"對話","messageId":"訊息","parentId":"父層項目","ownerId":"擁有者(users.id)",
 "templateId":"範本","collectionId":"收藏夾","ruleId":"規則","stepId":"步驟","frameworkId":"框架"}

def infer_col(c):
    n=c["name"]; t=c["type"]; flags=c.get("flags",[]); enum=c.get("enum")
    low=n.lower()
    if n=="id": return "主鍵：此列的唯一識別碼"
    if low.endswith("id") and t in ("int","bigint","varchar","char"):
        base=n[:-2] if n.endswith("Id") else n.rsplit("_",1)[0]
        tgt=FK.get(n) or FK.get(base+"Id")
        return f"外鍵：對應{tgt}" if tgt else f"外鍵/識別碼：指向 {base} 實體"
    if n in ("createdAt","created_at"): return "建立時間戳"
    if n in ("updatedAt","updated_at"): return "最後更新時間戳（onUpdate 自動）"
    if n in ("deletedAt","deleted_at"): return "軟刪除時間戳（NULL=未刪）"
    if low.endswith("at") and t in ("timestamp","datetime","date"): return f"{n[:-2]} 的時間戳"
    if enum: return "列舉狀態，可選值：" + "、".join(enum)
    if t=="boolean" or re.match(r"^(is|has|can|should|enable|allow)[A-Z]",n) or low.endswith(("enabled","done","active","verified","public","shared","favorite","pinned","archived")):
        return f"布林開關：是否{n}（true/false）"
    if low.endswith("url"): return f"{n[:-3] or '資源'} 的網址/連結"
    if low.endswith("hash"): return f"{n[:-4]} 的雜湊值（不可逆）"
    if low.endswith(("secret","token")): return f"{n} 憑證/權杖（敏感，勿外洩）"
    if low.endswith("key") and t in ("varchar","char","text"): return f"{n[:-3]} 金鑰/鍵值"
    if t=="json" or low.endswith("json"): return f"JSON 結構資料：{n[:-4] if low.endswith('json') else n} 設定/內容"
    if low.endswith("count"): return f"{n[:-5]} 計數（數量）"
    if low.endswith(("amount","credits","points","price","cost")): return f"{n} 數值（金額/點數）"
    if low.endswith("days"): return f"{n[:-4]} 天數"
    if low.endswith(("index","order","sort","seq","position")): return f"{n} 排序/序位值"
    if low.endswith(("score","rating","weight")): return f"{n} 分數/權重"
    if n in ("title","name","label"): return "名稱/標題（顯示用）"
    if low in ("description","desc","summary","note","notes"): return "描述/說明文字"
    if low in ("content","body","text","prompt"): return "主要內文/提示詞內容"
    if low=="email": return "電子郵件地址"
    if low=="status": return "狀態欄（流程/生命週期）"
    if low=="role": return "角色/權限層級"
    if low in ("category","kind","type","mode","sourcetype","source"): return f"{n}：分類/類型標記"
    if low in ("language","lang","locale"): return "語系/地區設定"
    if low in ("visibility",): return "可見性（private/team_shared 等）"
    if low.endswith("url") : return "網址"
    return f"{t} 欄位（依欄名推斷）"

col_infer={}
for t in schema:
    tbl=t["table"]; d={}
    for c in t["columns"]:
        if not col_doc.get(tbl,{}).get(c["name"]):
            d[c["name"]]=infer_col(c)
    col_infer[tbl]=d
json.dump(col_infer, open("scripts/comparison/col_infer.json","w"), ensure_ascii=False, indent=1)
print("inferred columns:", sum(len(v) for v in col_infer.values()),
      "authored:", sum(len(v) for v in col_doc.values()))

# ---- procedure inference ----
VERB=[("listPublic","列出公開"),("listAll","列出全部"),("list","列出"),("getById","取得單一"),
 ("getAll","取得全部"),("get","取得"),("fetch","取得"),("create","新增"),("add","新增"),
 ("update","更新"),("edit","編輯"),("save","儲存"),("set","設定"),("delete","刪除"),
 ("remove","移除"),("toggle","切換"),("backfill","批次回填"),("search","搜尋"),
 ("seed","種子資料"),("stats","統計"),("summary","彙總"),("count","計數"),("export","匯出"),
 ("import","匯入"),("start","啟動"),("run","執行"),("execute","執行"),("cancel","取消"),
 ("stop","停止"),("status","查詢狀態"),("my","我的"),("upsert","新增或更新")]
TOPIC={"adminRouter":"管理員","agentCollaborationRouter":"代理協作","agentModelPicksRouter":"代理選型",
 "agentPreferencesRouter":"代理偏好","aiModels":"AI 模型","apiUsage":"API 用量","auditLog":"稽核日誌",
 "brain":"AI 大腦","brainPipeline":"大腦管線","creativeProject":"創作專案","director":"導演",
 "externalServices":"外部服務","imageStudio":"圖像工作室","langsmith":"LangSmith 觀測","learnHub":"學習中心",
 "loraTrainer":"LoRA 訓練","modelConsents":"模型同意","modelWishesRouter":"模型許願","news":"新聞情報",
 "orbCapabilitiesRouter":"光球能力","orbConversationsRouter":"光球對話","orbProxyRouter":"光球代理",
 "orbSchedulerRouter":"光球排程","proStudio":"專業工作室","promptCollection":"提示詞收藏",
 "promptLibrary":"提示詞庫","rbac":"權限控管","realEarth":"真實地球","sense":"意圖感知",
 "showcase":"作品展示","spiritRouter":"精靈","teachingArchive":"教材庫","teams":"團隊",
 "videoStudio":"影片工作室","worldStoryboard":"世界分鏡","worldbuilding":"世界觀建構"}
def infer_proc(rf, it):
    n=it["name"]; topic=TOPIC.get(rf[:-3], rf[:-3])
    verb=""
    for k,v in VERB:
        if n.lower().startswith(k.lower()): verb=v; break
    if not verb:
        for k,v in VERB:
            if k.lower() in n.lower(): verb=v; break
    op="寫入" if it["op"]=="mutation" else "讀取"
    if not verb: verb=("更新/寫入" if op=="寫入" else "查詢")
    return f"{verb}{topic}相關資料（{op}；procedure {n}）"

proc_infer={}
for rf, items in proc_doc.items():
    d={}
    for it in items:
        if not it.get("doc"):
            d[it["name"]]=infer_proc(rf, it)
    proc_infer[rf]=d
json.dump(proc_infer, open("scripts/comparison/proc_infer.json","w"), ensure_ascii=False, indent=1)
print("inferred procedures:", sum(len(v) for v in proc_infer.values()),
      "authored:", sum(1 for items in proc_doc.values() for it in items if it.get("doc")))
