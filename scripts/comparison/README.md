# 任務卡 × 程式碼 × 資料庫 三方逐項對比

自動產出 `docs/reports/task-card-code-db-comparison.pdf`（逐卡 / 逐行 / 逐欄位）。

## 重建步驟
```bash
pip3 install fpdf2          # 內含 fontTools
# 取 CJK 字型（容器內 WenQuanYi Zen Hei）
python3 - <<'PY'
from fontTools.ttLib import TTCollection; import os
os.makedirs("/tmp/report_assets",exist_ok=True)
TTCollection("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc").fonts[0].save("/tmp/report_assets/wqy.ttf")
PY
python3 scripts/comparison/parse_schema.py
python3 scripts/comparison/parse_rest.py
python3 scripts/comparison/parse_code_xref.py
python3 scripts/comparison/fix_xref.py
python3 scripts/comparison/render_pdf.py
```

## 資料來源（皆 repo 實檔，git 實證）
- 任務卡：`docs/plan/jira-import.csv` + `docs/plan/AIDV-master-plan.md` + 全 `docs/**.md` 內 AIDV-NN
- 程式碼：`server/` `client/` `shared/`（router/procedure/旗標枚舉＋逐卡 grep AIDV-NN 取 file:line）
- 資料庫：`drizzle/schema.ts`（逐表逐欄）+ `drizzle/*.sql` + `drizzle/meta/_journal.json`
