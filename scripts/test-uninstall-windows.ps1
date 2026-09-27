<#
.SYNOPSIS
  Tests for the decisions in uninstall-windows.ps1. Runs on Windows PowerShell 5.1 and on
  PowerShell 7 (Windows, Linux, macOS). Changes nothing outside a temporary folder.

    powershell -ExecutionPolicy Bypass -File .\scripts\test-uninstall-windows.ps1
    pwsh -File ./scripts/test-uninstall-windows.ps1

  The script is dot-sourced, which loads its functions without running it. Processes are
  fake objects shaped like Win32_Process; files live in a temporary folder.
#>
$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "uninstall-windows.ps1")

$failed = 0
function Check([string]$Name, $Got, $Want) {
  if ("$Got" -ceq "$Want") { Write-Host "ok   $Name" }
  else { Write-Host "FAIL $Name -> '$Got' (expected '$Want')" -ForegroundColor Red; $script:failed++ }
}
function J { param([Parameter(ValueFromRemainingArguments)][string[]]$Parts)
  $p = $Parts[0]; foreach ($x in ($Parts | Select-Object -Skip 1)) { $p = Join-Path $p $x }; return $p }
function P([string]$Name, [string]$Exe, [string]$Cmd) {
  [pscustomobject]@{ ProcessId = 1; ParentProcessId = 0; Name = $Name; ExecutablePath = $Exe; CommandLine = $Cmd }
}

$tmp = J ([System.IO.Path]::GetTempPath()) ("hexops-uninstall-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $F = J $tmp "HexOps"
  $other = J $tmp "HexOps-old"   # same prefix: must not count as inside $F
  $nodeExe = J $tmp "nodejs" "node.exe"

  # --- which processes belong to this installation ------------------------------------------
  Check "venv python (launcher) in this folder" (Get-HexopsProcessKind (P "python.exe" (J $F "backend" ".venv" "Scripts" "python.exe") "python -m app") $F) ("program " + (J "backend" ".venv" "Scripts" "python.exe"))
  Check "Playwright's node.exe in this venv" ((Get-HexopsProcessKind (P "node.exe" (J $F "backend" ".venv" "Lib" "site-packages" "playwright" "driver" "node.exe") "node run-driver") $F) -like "program *") "True"
  Check "system node running this folder's vite" (Get-HexopsProcessKind (P "node.exe" $nodeExe ('"node.exe" "' + (J $F "frontend" "node_modules" "vite" "bin" "vite.js") + '" preview --port 4173')) $F) "node (vite)"
  Check "vite of another installation" (Get-HexopsProcessKind (P "node.exe" $nodeExe ('"node.exe" "' + (J $other "frontend" "node_modules" "vite" "bin" "vite.js") + '" preview')) $F) ""
  Check "venv python of another installation (same prefix)" (Get-HexopsProcessKind (P "python.exe" (J $other "backend" ".venv" "Scripts" "python.exe") "python -m app") $F) ""
  Check "editor opening a file in node_modules" (Get-HexopsProcessKind (P "Code.exe" (J $tmp "VSCode" "Code.exe") ('Code.exe "' + (J $F "frontend" "node_modules" "x.js") + '"')) $F) ""
  Check "system python -m app (not ours)" (Get-HexopsProcessKind (P "python.exe" (J $tmp "Python312" "python.exe") "python.exe -m app") $F) ""
  Check "anything on port 8000 is irrelevant" (Get-HexopsProcessKind (P "httpd.exe" (J $tmp "Apache" "httpd.exe") "httpd -p 8000") $F) ""
  Check "PowerShell running start-windows.ps1 of this folder" (Get-HexopsProcessKind (P "powershell.exe" (J $tmp "powershell.exe") ('powershell -File "' + (J $F "start-windows.ps1") + '"')) $F) "start-windows.ps1"
  Check "a process whose path is unknown (other user)" (Get-HexopsProcessKind (P "python.exe" $null $null) $F) ""

  # --- database URL and refusals ---------------------------------------------------------------
  $db = ConvertFrom-DatabaseUrl "postgresql+psycopg://hexops:s3cr%40t@127.0.0.1:5432/hexops"
  Check "URL: user, host, port, database" ("{0}|{1}|{2}|{3}" -f $db.User, $db.Host, $db.Port, $db.Database) "hexops|127.0.0.1|5432|hexops"
  Check "URL: the password is not kept" (($db | Out-String) -match "s3cr") "False"
  $db = ConvertFrom-DatabaseUrl "postgresql+psycopg://hex%20ops:pw@[::1]/my%20db"
  Check "URL: encoded names, IPv6, default port" ("{0}|{1}|{2}|{3}" -f $db.User, $db.Host, $db.Port, $db.Database) "hex ops|::1|5432|my db"
  Check "URL: not PostgreSQL" ((ConvertFrom-DatabaseUrl "mysql://a:b@127.0.0.1/x") -eq $null) "True"
  Check "URL: garbage" ((ConvertFrom-DatabaseUrl "not a url") -eq $null) "True"
  Check "local host 127.0.0.1" (Test-LocalDatabaseHost "127.0.0.1") "True"
  Check "local host localhost" (Test-LocalDatabaseHost "LOCALHOST") "True"
  Check "remote host" (Test-LocalDatabaseHost "db.example.org") "False"
  Check "remote host 10.0.0.5" (Test-LocalDatabaseHost "10.0.0.5") "False"

  $clean = @("db_exists=1", "role_exists=1", "db_owner=hexops", "role_privileged=0", "other_dbs_owned=",
    "deps_elsewhere=", "memberships=0", "sessions_db=0", "sessions_elsewhere=0")
  $schema = @("alembic=0008", "foreign_tables=", "tables=13", "foreign_extensions=")
  function Refusals($Cluster, $Schema, [bool]$Running = $false) { @(Get-DatabaseRefusals $Cluster $Schema "hexops" "hexops" $Running) }
  function With($Lines, [string]$Kv) { $k = $Kv.Split("=")[0]; @($Lines | Where-Object { $_ -notlike "$k=*" }) + $Kv }
  Check "a dedicated HexOps database: no refusal" (Refusals $clean $schema).Count 0
  Check "owned by another role" ((Refusals (With $clean "db_owner=erp") $schema) -join ";") "database 'hexops' belongs to role 'erp', not to 'hexops'"
  Check "foreign table" ((Refusals $clean (With $schema "foreign_tables=public.invoices")) -join ";") "database 'hexops' contains tables HexOps did not create: public.invoices"
  Check "no schema version but tables" (Refusals $clean (With (With $schema "alembic=") "tables=3")).Count 1
  Check "empty database is fine" (Refusals $clean (With (With $schema "alembic=") "tables=0")).Count 0
  Check "privileged role" (Refusals (With $clean "role_privileged=1") $schema).Count 1
  Check "role owns another database" ((Refusals (With $clean "other_dbs_owned=hexops_test") $schema) -join ";") "role 'hexops' also owns database(s): hexops_test"
  Check "role used elsewhere" (Refusals (With $clean "deps_elsewhere=erp") $schema).Count 1
  Check "someone else connected" (Refusals (With $clean "sessions_db=2") $schema $false).Count 1
  Check "HexOps itself connected (stopped first)" (Refusals (With $clean "sessions_db=2") $schema $true).Count 0

  # --- confirmation ------------------------------------------------------------------------------
  Check "typed confirmation" (Test-TypedConfirmation "DELETE HEXOPS") "True"
  foreach ($a in @("", "y", "yes", "delete hexops", "DELETE HEXOPS ", "DELETE")) {
    Check "not a confirmation: '$a'" (Test-TypedConfirmation $a) "False"
  }

  # --- which files go --------------------------------------------------------------------------------
  $inst = J $tmp "inst"
  foreach ($d in @((J $inst "frontend" "node_modules"), (J $inst "backend" "app"), (J $inst "backend" ".venv"),
                   (J $inst "data" "uploads"), (J $inst "docs"), (J $inst "scripts"))) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  foreach ($f in @((J $inst "README.md"), (J $inst "uninstall-windows.ps1"), (J $inst "my-notes.txt"),
                   (J $inst "backend" ".env"), (J $inst "backend" "mine.txt"), (J $inst "data" "uploads" "e.png"))) { Set-Content -LiteralPath $f -Value "x" }
  $rel = { param($list) @($list | ForEach-Object { $_.Substring($inst.Length + 1).Replace("\", "/") } | Sort-Object) -join "," }
  $plan = Get-RemovalPlan $inst $false
  Check "remove-app deletes" (& $rel $plan.Delete) "backend/.venv,backend/app,docs,frontend,README.md,scripts,uninstall-windows.ps1"
  Check "remove-app leaves the user's files" (& $rel $plan.Left) "backend/mine.txt,my-notes.txt"
  $plan = Get-RemovalPlan $inst $true
  Check "purge also deletes .env and data" (& $rel $plan.Delete) "backend/.env,backend/.venv,backend/app,data,docs,frontend,README.md,scripts,uninstall-windows.ps1"

  # --- deleting never follows a link ----------------------------------------------------------------
  $outside = J $tmp "outside"
  New-Item -ItemType Directory -Path $outside | Out-Null
  Set-Content -LiteralPath (J $outside "keep.txt") -Value "keep"
  $victim = J $tmp "victim"
  New-Item -ItemType Directory -Path (J $victim "sub") | Out-Null
  $ro = J $victim "sub" "readonly.txt"
  Set-Content -LiteralPath $ro -Value "ro"
  (Get-Item -LiteralPath $ro).Attributes = [System.IO.FileAttributes]::ReadOnly
  $linkType = "SymbolicLink"; if ($env:OS -eq "Windows_NT") { $linkType = "Junction" }
  New-Item -ItemType $linkType -Path (J $victim "link") -Target $outside | Out-Null
  Remove-Tree $victim
  Check "the folder with a $linkType is deleted" (Test-Path -LiteralPath $victim) "False"
  Check "the link's target survives" (Get-Content -LiteralPath (J $outside "keep.txt")) "keep"
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failed -gt 0) { Write-Host "$failed test(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "all tests passed"
