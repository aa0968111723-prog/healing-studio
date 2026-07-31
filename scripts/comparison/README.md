# 任務卡 × 程式碼 × 資料庫 三方逐項對比

自動產出 `docs/reports/task-card-code-db-comparison.pdf`（逐卡 / 逐行 / 逐欄位 / 部署）。

## 章節
- **A** 任務卡逐卡：live Jira 專案 AIDV 全量（323 張），逐卡＝描述/狀態/型別/優先/labels/父卡＋PR＋程式碼 file:line＋連結資料表＋migration
- **B** 資料庫逐欄位：87 表 / 908 欄 / 261 索引完整資料字典（型別/長度/約束/enum）
- **C** Migration 對帳：82 支 vs `_journal.json`（0 孤兒）
- **D** 全程式碼盤點：1,738 檔 / 587K 行逐目錄＋37 router / 284 procedure / 50 旗標
- **E** 三方一致性：有表無卡 / 有表無碼 / 卡↔碼↔庫 覆蓋
- **F** Railway / 部署 / 環境變數：railway.toml·nixpacks·Dockerfile＋.env.example 環境變數目錄（僅名稱·無值）

## 資料來源
- 任務卡：**live Atlassian Jira**（aa0968111723.atlassian.net 專案 AIDV，Rovo MCP，JQL 分頁拉取）→ `parse_jira.py` → `jira_cards.json`
- 程式碼：`server/` `client/` `shared/`（`parse_code_xref.py` router/procedure/旗標；`parse_code_and_railway.py` 全碼盤點）＋逐卡 grep 卡號取 file:line
- 資料庫：`drizzle/schema.ts`（`parse_schema.py` 逐表逐欄）+ `drizzle/*.sql` + `drizzle/meta/_journal.json`（`parse_rest.py`）
- Railway/部署：repo 部署產物 + `.env.example`（`parse_code_and_railway.py`，僅取環境變數名稱）

## 重建步驟
```bash
pip3 install fpdf2 cffi    # fpdf2 內含 fontTools
python3 - <<'PY'           # 取 CJK 字型（容器內 WenQuanYi Zen Hei）
from fontTools.ttLib import TTCollection; import os
os.makedirs("/tmp/report_assets",exist_ok=True)
TTCollection("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc").fonts[0].save("/tmp/report_assets/wqy.ttf")
PY
# Jira 頁面（page1..N.json）需先以 Rovo MCP searchJiraIssuesUsingJql 拉取放入 scripts/comparison/jira/
python3 scripts/comparison/parse_schema.py
python3 scripts/comparison/parse_rest.py
python3 scripts/comparison/parse_code_xref.py
python3 scripts/comparison/fix_xref.py
python3 scripts/comparison/parse_jira.py
python3 scripts/comparison/parse_code_and_railway.py
python3 scripts/comparison/render_pdf.py
```

## 註記
- **Railway live MCP 未連線**：本環境搜尋無 railway/gitnexus 工具（對應卡 AIDV-77＝官方遠端 MCP 已寫入設定、待 Bruce OAuth）。Part F 以 repo 部署產物盤點。
- 原始 Jira 分頁 JSON（`jira/page*.json`，每頁 ~0.5MB）不入版控（見 `.gitignore`）；保留壓縮後的 `jira_cards.json`。
