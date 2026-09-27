<#
.SYNOPSIS
  HexOps installer for Windows 10/11. Safe to run again: it never overwrites backend\.env,
  never drops a database, and never touches accounts, records or files.

.DESCRIPTION
  Run from the repository folder, without changing the system execution policy:

    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -CreateDatabase
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -DatabaseUrl "postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DB"
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1          # when backend\.env exists

  (-ExecutionPolicy Bypass applies to this one PowerShell process only.)

.PARAMETER DatabaseUrl
  Existing database (used only when backend\.env does not exist yet).
.PARAMETER CreateDatabase
  Create role "hexops" and database "hexops" with a random password using psql as the
  "postgres" superuser (psql asks for the postgres password). Asks first; never drops.
#>
[CmdletBinding()]
param(
  [string]$DatabaseUrl = "",
  [switch]$CreateDatabase,
  [int]$ApiPort = 8000,
  [int]$UiPort = 4173,
  [switch]$SkipStartCheck,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$EnvFile = Join-Path $Backend ".env"
$Venv = Join-Path $Backend ".venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$Helper = Join-Path $Root "scripts\install_helper.py"
$script:Step = "starting"

function Say([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Info([string]$Text) { Write-Host "    $Text" }
function Fail([string]$Message, [string[]]$Hints = @()) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  foreach ($h in $Hints) { Write-Host "       $h" }
  Write-Host ""
  Write-Host "HexOps was NOT installed completely (failed at: $script:Step)." -ForegroundColor Red
  exit 1
}
# Native programs are judged by their exit code, never by writing to stderr. Windows
# PowerShell 5.1 turns redirected stderr lines into error records, and with
# $ErrorActionPreference = "Stop" the first one ends the script (pip, alembic and the
# "py" launcher all write to stderr). So both helpers relax it for their own call only.

# Run a native program; fail with $Message unless it exits with 0.
function Invoke-Checked([string]$Message, [scriptblock]$Block, [string[]]$Hints = @()) {
  $ErrorActionPreference = "Continue"
  & $Block
  if ($LASTEXITCODE -ne 0) { Fail $Message $Hints }
}
# Run a native program whose failure is an expected answer (a missing Python version, a
# busy port). Returns its stdout and exit code; stderr is discarded; never throws.
function Invoke-Probe([string]$Exe, [string[]]$Arguments = @()) {
  $ErrorActionPreference = "Continue"
  $global:LASTEXITCODE = 0
  try {
    $out = & $Exe @Arguments 2>$null
    $code = $LASTEXITCODE
  } catch {
    $out = $null; $code = 1
  }
  return [pscustomobject]@{ Output = @($out); ExitCode = $code }
}
function Test-VersionAtLeast([string]$Have, [string]$Need) {
  return ([version]$Have) -ge ([version]$Need)
}
# The first interpreter that exists and is 3.12 or newer. Tested versions come first;
# a missing one (py: "No runtime installed that matches 3.13") just moves on.
function Find-HexopsPython {
  $candidates = @(@("py", "-3.13"), @("py", "-3.12"), @("py", "-3"), @("python"))
  foreach ($candidate in $candidates) {
    $exe = $candidate[0]
    $extra = @($candidate | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    $probe = Invoke-Probe $exe ($extra + @("-c", "import sys; print('%d.%d' % sys.version_info[:2])"))
    $v = ($probe.Output | Select-Object -Last 1)
    if ($probe.ExitCode -eq 0 -and "$v" -match '^\d+\.\d+$' -and (Test-VersionAtLeast $v "3.12")) {
      return [pscustomobject]@{ Exe = $exe; Args = $extra; Version = "$v" }
    }
  }
  return $null
}

trap {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "HexOps was NOT installed completely (failed at: $script:Step)." -ForegroundColor Red
  exit 1
}

# --- 1. prerequisites ------------------------------------------------------------------------
$script:Step = "checking prerequisites"
Say "Checking prerequisites"

$Found = Find-HexopsPython
if (-not $Found) {
  Fail "Python 3.12 or newer was not found" @(
    "Install it:  winget install Python.Python.3.12   (or from https://www.python.org/)",
    "Then open a NEW PowerShell window and run this installer again.")
}
$Python = $Found.Exe
$PythonArgs = $Found.Args
Info ("Python  " + (& $Python @PythonArgs -c "import platform; print(platform.python_version())"))

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "Node.js and npm were not found" @(
    "Install it:  winget install OpenJS.NodeJS.LTS   (or from https://nodejs.org/)",
    "Then open a NEW PowerShell window and run this installer again.")
}
$NodeVersion = (& node -p "process.versions.node").Trim()
if (-not (Test-VersionAtLeast $NodeVersion "20.19.0")) {
  Fail "Node.js $NodeVersion is too old (need 20.19 or newer)" @("winget install OpenJS.NodeJS.LTS")
}
Info "Node.js $NodeVersion, npm $((& npm --version).Trim())"

$Psql = (Get-Command psql -ErrorAction SilentlyContinue)
if ($Psql) { $Psql = $Psql.Source }
else {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { $Psql = $found.FullName }
}
if ($Psql) { Info "PostgreSQL client: $Psql" }
else { Info "PostgreSQL client (psql) not found - fine if the server is reachable with the URL in .env." }

# --- 2. configuration (backend\.env) ---------------------------------------------------------------
$script:Step = "preparing backend\.env"
Say "Configuration"

function Invoke-HexopsDatabaseSetup {
  if (-not $Psql) {
    Fail "psql is needed for -CreateDatabase" @(
      "Install PostgreSQL:  winget install PostgreSQL.PostgreSQL.17",
      "or create the role and database yourself and use -DatabaseUrl.")
  }
  Info "This will run PostgreSQL commands as the 'postgres' superuser (psql asks for its password):"
  Info "  CREATE ROLE hexops LOGIN PASSWORD <random>   - only if the role does not exist"
  Info "  CREATE DATABASE hexops OWNER hexops          - only if the database does not exist"
  Info "Nothing is dropped or changed otherwise. The random password is written only to backend\.env."
  if (-not $Yes) {
    $answer = Read-Host "    Continue? [y/N]"
    if ($answer -notmatch '^(y|yes)$') { Fail "database creation cancelled" @("Use -DatabaseUrl with an existing database instead.") }
  }
  $roleExists = & $Psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='hexops'"
  if ($LASTEXITCODE -ne 0) { Fail "could not connect as the postgres user" @("Is PostgreSQL running on 127.0.0.1:5432? Is the postgres password right?") }
  if ("$roleExists".Trim() -eq "1") {
    Fail "the PostgreSQL role 'hexops' already exists, and its password is not known to the installer" @(
      "Use it with: -DatabaseUrl ""postgresql+psycopg://hexops:<password>@127.0.0.1:5432/hexops""",
      "(nothing was changed)")
  }
  $dbExists = & $Psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='hexops'"
  $password = (& $Python @PythonArgs $Helper secret) -replace '[^A-Za-z0-9]', ''
  $password = $password.Substring(0, [Math]::Min(32, $password.Length))
  # SQL goes through standard input, so the password never appears in the process list.
  "CREATE ROLE hexops LOGIN PASSWORD '$password';" | & $Psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not create the role" }
  if ("$dbExists".Trim() -ne "1") {
    & $Psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE hexops OWNER hexops" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "could not create the database 'hexops'" }
  }
  Info "Created role 'hexops' and database 'hexops'."
  return "postgresql+psycopg://hexops:$password@127.0.0.1:5432/hexops"
}

if (Test-Path $EnvFile) {
  Info "backend\.env exists - keeping it unchanged."
  if ($DatabaseUrl -or $CreateDatabase) { Info "(-DatabaseUrl/-CreateDatabase ignored because .env exists)" }
} else {
  if (-not $DatabaseUrl) {
    if ($CreateDatabase) { $DatabaseUrl = Invoke-HexopsDatabaseSetup }
    else {
      Fail "backend\.env does not exist yet and no database was given" @(
        "Either let the installer create one:  .\install-windows.ps1 -CreateDatabase",
        "or use an existing database:          .\install-windows.ps1 -DatabaseUrl ""postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DB""")
    }
  }
  Invoke-Checked "could not create backend\.env" {
    & $Python @PythonArgs $Helper make-env (Join-Path $Backend ".env.example") $EnvFile $DatabaseUrl "$ApiPort" "$UiPort"
  }
  Info "Created backend\.env with a new random secret key."
}

function Get-EnvValue([string]$Name, [string]$Default) {
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^$Name=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^$Name=", "").Trim() }
  return $Default
}
$ApiPort = [int](Get-EnvValue "HEXOPS_PORT" "8000")
$UiPort = [int](Get-EnvValue "HEXOPS_UI_PORT" "4173")

# --- 3. backend ------------------------------------------------------------------------------------
$script:Step = "installing the backend"
Say "Backend (Python virtual environment)"
if ((Test-Path $VenvPython)) {
  if ((Invoke-Probe $VenvPython @("-c", "import sys")).ExitCode -ne 0) { Info "The existing virtual environment is broken (moved folder?) - recreating it."; Remove-Item -Recurse -Force $Venv }
}
if (-not (Test-Path $VenvPython)) { Invoke-Checked "could not create the virtual environment" { & $Python @PythonArgs -m venv $Venv } }
Invoke-Checked "pip upgrade failed" { & $VenvPython -m pip install --quiet --upgrade pip }
Invoke-Checked "installing the backend packages failed" { & $VenvPython -m pip install --quiet -e $Backend }
Info "Backend packages installed."

$script:Step = "installing the PDF renderer (Chromium)"
Say "PDF renderer (Chromium, ~100 MB, once)"
# Playwright's download first; if it fails, the helper downloads the same official archives
# with curl.exe, verifies them and hands them to Playwright from 127.0.0.1 (D-94).
Invoke-Checked "the PDF renderer could not be installed (see the messages above)" { & $VenvPython $Helper install-browser }
Push-Location $Backend
try { Invoke-Checked "Chromium was downloaded but cannot print a PDF" { & $VenvPython $Helper check-pdf } }
finally { Pop-Location }
Info "Chromium works (a test PDF was printed)."

# --- 4. database ---------------------------------------------------------------------------------------
$script:Step = "checking the database"
Say "Database"
Push-Location $Backend
try {
  Invoke-Checked "cannot connect to PostgreSQL with HEXOPS_DATABASE_URL from backend\.env" { & $VenvPython $Helper check-db } @(
    "Is the PostgreSQL service running? Are the user, password and database name right?")
  Info "Connected."
  $script:Step = "running database migrations"
  Invoke-Checked "database migration failed (nothing was dropped)" { & (Join-Path $Venv "Scripts\alembic.exe") upgrade head 2>&1 | Out-Null }
  Info ("Schema is up to date (" + ((Invoke-Probe (Join-Path $Venv "Scripts\alembic.exe") @("current")).Output | Select-Object -Last 1) + ").")
} finally { Pop-Location }

# --- 5. frontend ----------------------------------------------------------------------------------------
$script:Step = "installing the frontend"
Say "Frontend (npm packages and production build)"
Push-Location $Frontend
try {
  Invoke-Checked "npm ci failed" { & npm ci --no-audit --no-fund --loglevel=error | Out-Null }
  Invoke-Checked "the frontend build failed" { & npm run -s build | Out-Null }
} finally { Pop-Location }
Info "Built frontend\dist."

# --- 6. start check ---------------------------------------------------------------------------------------
$Setup = ""
if (-not $SkipStartCheck) {
  $script:Step = "starting HexOps for a check"
  Say "Starting HexOps briefly to check it"
  foreach ($p in @($ApiPort, $UiPort)) {
    if ((Invoke-Probe $Python ($PythonArgs + @($Helper, "port-free", "$p"))).ExitCode -ne 0) { Fail "port $p is already in use (is HexOps already running?)" @("Stop it first, or use -SkipStartCheck.") }
  }
  $logDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hexops-install-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $logDir | Out-Null
  $api = Start-Process -FilePath $VenvPython -ArgumentList "-m", "app" -WorkingDirectory $Backend -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "api.out") -RedirectStandardError (Join-Path $logDir "api.err")
  $env:HEXOPS_API_URL = "http://127.0.0.1:$ApiPort"
  $ui = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx vite preview --port $UiPort" -WorkingDirectory $Frontend -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "ui.out") -RedirectStandardError (Join-Path $logDir "ui.err")
  try {
    & $Python @PythonArgs $Helper wait-http "http://127.0.0.1:$ApiPort/api/health" "http://127.0.0.1:$UiPort/" "http://127.0.0.1:$UiPort/api/health" --timeout 90
    if ($LASTEXITCODE -ne 0) {
      Get-Content (Join-Path $logDir "api.err") -Tail 5 -ErrorAction SilentlyContinue
      Fail "HexOps did not answer on http://127.0.0.1:$ApiPort (API) and http://127.0.0.1:$UiPort (UI, and its /api proxy)"
    }
    $Setup = (& $Python @PythonArgs $Helper setup-status "http://127.0.0.1:$UiPort").Trim()
    Info "API health: OK   UI: OK   UI -> API proxy: OK"
  } finally {
    foreach ($proc in @($api, $ui)) {
      if ($proc -and -not $proc.HasExited) { Invoke-Probe "taskkill" @("/PID", "$($proc.Id)", "/T", "/F") | Out-Null }
    }
    Remove-Item Env:\HEXOPS_API_URL -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $logDir -ErrorAction SilentlyContinue
  }
}

Say "HexOps is installed."
Write-Host ""
Write-Host "  Start it:   powershell -ExecutionPolicy Bypass -File .\start-windows.ps1   (stop with Ctrl+C)"
Write-Host "  Open:       http://127.0.0.1:$UiPort"
Write-Host ""
if ($Setup -eq "required") {
  Write-Host "  First run: the page asks you to create the owner account - choose your own"
  Write-Host "  username and password there. No account exists yet."
} elseif ($Setup -eq "done") {
  Write-Host "  An account already exists: sign in with it (nothing was changed)."
}
Write-Host ""
exit 0
