<#
=============================================================================
 AIDV / healing-studio — 一鍵本機開發環境（Windows PowerShell）
 in-repo 版：本腳本位於 repo 內 dev-environment\，假設你已在 repo（不 clone）。
 用法（在 PowerShell）：
   在 repo 根 → cd dev-environment → powershell -ExecutionPolicy Bypass -File .\setup.ps1
   或直接：powershell -ExecutionPolicy Bypass -File .\dev-environment\setup.ps1
 參數：
   -RepoDir  <path>   覆寫 repo 位置（預設自動偵測）
   -SkipDocker        自備 MySQL，不用 docker
   -SkipInstall       跳過 npm install
=============================================================================
#>
param(
  [string]$RepoDir = "",
  [switch]$SkipDocker,
  [switch]$SkipInstall
)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
function Step($m){ Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Have($c){ $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }

# ── 0. 前置檢查 ──────────────────────────────────────────────────────────
Step "0/6 檢查前置工具"
if(-not (Have git)){ throw "缺 git" }
if(-not (Have node)){ throw "缺 node（需 >=20）" }
if(-not (Have npm)){ throw "缺 npm（需 >=10）" }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if($nodeMajor -lt 20){ throw "Node 版本 $(node -v) 太舊，需 >=20" }
Ok "git / node $(node -v) / npm $(npm -v) OK"

# ── 1. 定位 repo（in-repo：不 clone）─────────────────────────────────────
Step "1/6 定位 repo 根"
if($RepoDir -ne ""){ }
else{
  $top = (git -C $ScriptDir rev-parse --show-toplevel 2>$null)
  if($LASTEXITCODE -eq 0 -and $top){ $RepoDir = $top }
  else{ $RepoDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path }
}
Ok "REPO_DIR = $RepoDir"
Set-Location $RepoDir

# ── 2. 建立 .env ─────────────────────────────────────────────────────────
Step "2/6 建立 .env（最小可跑集）"
if(Test-Path .env){ Warn ".env 已存在，略過（如要重建請先刪除）" }
else{
  Copy-Item "$ScriptDir\.env.dev.example" .env
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  (Get-Content .env -Raw).Replace("__GENERATED_BY_SETUP__", $secret) | Set-Content .env -NoNewline
  Ok "已建立 .env 並產生 JWT_SECRET（其餘金鑰留空＝OARS 警告、不崩潰）"
}

# ── 3. 安裝相依 ──────────────────────────────────────────────────────────
Step "3/6 npm install（--legacy-peer-deps，repo 慣例）"
if($SkipInstall){ Warn "SkipInstall，略過" } else { npm install --legacy-peer-deps }

# ── 4. 起 MySQL + Redis ──────────────────────────────────────────────────
Step "4/6 起本機 MySQL + Redis"
if($SkipDocker){ Warn "SkipDocker：請自備 MySQL 並確認 .env 的 DATABASE_URL 正確" }
elseif(Have docker){
  docker compose -f "$ScriptDir\docker-compose.yml" up -d
  Write-Host -NoNewline "等待 MySQL healthy "
  for($i=0; $i -lt 40; $i++){
    $s = (docker inspect --format '{{.State.Health.Status}}' aidv-mysql 2>$null)
    if($s -eq "healthy"){ Write-Host ""; Ok "MySQL ready"; break }
    Write-Host -NoNewline "."; Start-Sleep -Seconds 2
  }
}else{ Warn "未發現 docker：請改自備 MySQL，或安裝 Docker Desktop 後重跑（或 -SkipDocker）" }

# ── 5. 套 migration ──────────────────────────────────────────────────────
Step "5/6 套用 drizzle migration"
try { npm run db:push } catch { Warn "db:push 失敗：確認 MySQL 已起且 DATABASE_URL 正確後再 npm run db:push（boot 時 runMigrations 也會補套）" }

# ── 6. 完成 ──────────────────────────────────────────────────────────────
Step "6/6 完成"
Ok "本機開發環境就緒。"
@"

下一步（在 $RepoDir）：
  npm run dev          # 開發伺服器 -> http://localhost:3000
  npm run check        # 驗證門：tsc + 路由對齊
  npm run test         # 單元測試（vitest）

注意：
  - main baseline 有 13 個 vitest 失敗（jsdom29+vitest2 localStorage 既有問題，非新回歸）。
  - 留空的金鑰會在 console 出現「OARS 友善警告」屬正常；要實際生成影片/圖片再貼 FAL_API_KEY 等。
  - 正式金鑰一律貼 Railway，勿 commit 進 repo（master-plan 鐵律 3）。
"@ | Write-Host
