<#
.SYNOPSIS
  Start HexOps (API + production UI) on 127.0.0.1. Stop with Ctrl+C.

    powershell -ExecutionPolicy Bypass -File .\start-windows.ps1          # start and print the URL
    powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 -Open    # also open the browser
#>
[CmdletBinding()]
param([switch]$Open)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$EnvFile = Join-Path $Backend ".env"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$Helper = Join-Path $Root "scripts\install_helper.py"

if (-not (Test-Path $EnvFile) -or -not (Test-Path $VenvPython) -or -not (Test-Path (Join-Path $Frontend "dist\index.html"))) {
  Write-Host "ERROR: HexOps is not installed yet. Run install-windows.ps1 first." -ForegroundColor Red
  exit 1
}

function Get-EnvValue([string]$Name, [string]$Default) {
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^$Name=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^$Name=", "").Trim() }
  return $Default
}
$ApiPort = Get-EnvValue "HEXOPS_PORT" "8000"
$UiPort = Get-EnvValue "HEXOPS_UI_PORT" "4173"
$Url = "http://127.0.0.1:$UiPort"

$api = Start-Process -FilePath $VenvPython -ArgumentList "-m", "app" -WorkingDirectory $Backend -PassThru -NoNewWindow
$env:HEXOPS_API_URL = "http://127.0.0.1:$ApiPort"
$ui = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx vite preview --port $UiPort" -WorkingDirectory $Frontend -PassThru -NoNewWindow
try {
  & $VenvPython $Helper wait-http "http://127.0.0.1:$ApiPort/api/health" "$Url/" --timeout 60
  if ($LASTEXITCODE -ne 0) { throw "HexOps did not start within 60 seconds (database running? ports $ApiPort/$UiPort free?)" }
  Write-Host ""
  Write-Host "HexOps is running: $Url   (Ctrl+C to stop)" -ForegroundColor Green
  Write-Host ""
  if ($Open) { Start-Process $Url }
  while (-not $api.HasExited -and -not $ui.HasExited) { Start-Sleep -Seconds 1 }
  if ($api.HasExited) { throw "the API stopped - see the messages above" }
  throw "the UI stopped - see the messages above"
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  # taskkill reports an already-exited process on stderr; Windows PowerShell 5.1 would
  # turn that into a terminating error under "Stop", so only its exit code matters here.
  $ErrorActionPreference = "Continue"
  foreach ($proc in @($api, $ui)) {
    if ($proc -and -not $proc.HasExited) { & taskkill /PID $proc.Id /T /F 2>$null | Out-Null }
  }
}
