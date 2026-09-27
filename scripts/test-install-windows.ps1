<#
.SYNOPSIS
  Regression tests for the Python detection in install-windows.ps1. Runs on Windows
  PowerShell 5.1 and PowerShell 7 (Windows, Linux, macOS); installs nothing.

    powershell -ExecutionPolicy Bypass -File .\scripts\test-install-windows.ps1
    pwsh -File ./scripts/test-install-windows.ps1

  The installer's functions are loaded from its syntax tree, so the installer itself does
  not run. "py" and "python" are replaced by fakes. A missing version writes the real
  launcher's message with Write-Error: under $ErrorActionPreference = "Stop" that ends a
  script the same way Windows PowerShell 5.1 does with a native program's stderr.
#>
$ErrorActionPreference = "Stop"
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) "install-windows.ps1"

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { Write-Host "FAIL install-windows.ps1 does not parse" -ForegroundColor Red; exit 1 }
foreach ($name in @("Invoke-Probe", "Test-VersionAtLeast", "Find-HexopsPython")) {
  $def = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $def) { Write-Host "FAIL function $name not found in install-windows.ps1" -ForegroundColor Red; exit 1 }
  . ([scriptblock]::Create($def.Extent.Text))
}

# Fake interpreters: $script:Py maps a py flag to a version ("" = not installed);
# $script:PythonVersion is what "python" reports ("" = no python on PATH).
function Invoke-Fake([string]$Version, [string]$Missing) {
  if (-not $Version) {
    Write-Error "[ERROR] No runtime installed that matches $Missing. Try running `"py install $Missing`"."
    $global:LASTEXITCODE = 103
    return
  }
  $global:LASTEXITCODE = 0
  return $Version
}
function py { Invoke-Fake $script:Py[$args[0]] ($args[0] -replace '^-', '') }
function python { Invoke-Fake $script:PythonVersion "python" }

$failed = 0
function Check([string]$Name, [hashtable]$Py, [string]$PythonVersion, [string]$Want) {
  $script:Py = $Py; $script:PythonVersion = $PythonVersion
  try {
    $found = Find-HexopsPython
    $got = if ($found) { (@($found.Exe) + $found.Args) -join " " } else { "none" }
  } catch {
    $got = "THREW: $($_.Exception.Message)"
  }
  if ($got -eq $Want) { Write-Host "ok   $Name -> $got" }
  else { Write-Host "FAIL $Name -> $got (expected $Want)" -ForegroundColor Red; $script:failed++ }
}

Check "3.13 missing, 3.12 present, python is 3.14" @{ "-3.13" = ""; "-3.12" = "3.12"; "-3" = "3.14" } "3.14" "py -3.12"
Check "3.13 present" @{ "-3.13" = "3.13"; "-3.12" = "3.12"; "-3" = "3.13" } "3.13" "py -3.13"
Check "only 3.14 through py" @{ "-3.13" = ""; "-3.12" = ""; "-3" = "3.14" } "" "py -3"
Check "py has only 3.11, python is 3.12" @{ "-3.13" = ""; "-3.12" = ""; "-3" = "3.11" } "3.12" "python"
Check "only 3.11 anywhere" @{ "-3.13" = ""; "-3.12" = ""; "-3" = "3.11" } "3.11" "none"
Check "nothing installed" @{ "-3.13" = ""; "-3.12" = ""; "-3" = "" } "" "none"

if ($failed -gt 0) { Write-Host "$failed test(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "all tests passed"
