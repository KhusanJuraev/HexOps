<#
.SYNOPSIS
  Uninstall HexOps from this folder. Choose one mode explicitly:

    powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1 -RemoveApp
        Remove the application; KEEP the database, backend\.env and data\ (reinstall any time).
    powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1 -Purge
        Remove EVERYTHING: application, the HexOps PostgreSQL database and role,
        backend\.env and data\. Always asks you to type DELETE HEXOPS.

  Add -DryRun to see the plan first; nothing is changed.

.DESCRIPTION
  Never touched: Python, Node.js, PostgreSQL itself, other databases and roles, browsers,
  and the shared Playwright cache (%LOCALAPPDATA%\ms-playwright). Only processes whose
  program lies in this folder are stopped (never "whatever uses port 8000"). A database on
  another computer, or a database/role that anything else uses, is refused.

.PARAMETER RemoveApp
  Remove the application files; keep the database, backend\.env and data\.
.PARAMETER Purge
  Remove everything, including the database and role named in backend\.env.
.PARAMETER DryRun
  Show what would be stopped and deleted; change nothing.
.PARAMETER Yes
  Do not ask before -RemoveApp. It does NOT authorise -Purge.
.PARAMETER ExportPath
  First save an encrypted .hexops export of all records and evidence to this file, which
  must be outside this folder. Asks for a passphrase.
.PARAMETER PostgresUser
  PostgreSQL administrator for -Purge (default "postgres"). Its password is asked once, or
  taken from the PGPASSWORD environment variable if that is set.
#>
[CmdletBinding()]
param(
  [switch]$RemoveApp,
  [switch]$Purge,
  [switch]$DryRun,
  [switch]$Yes,
  [string]$ExportPath = "",
  [string]$PostgresUser = "postgres"
)

$ErrorActionPreference = "Stop"
$Sep = [System.IO.Path]::DirectorySeparatorChar
$Root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)).TrimEnd($Sep)
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$EnvFile = Join-Path $Backend ".env"
$VenvPython = Join-Path (Join-Path (Join-Path $Backend ".venv") "Scripts") "python.exe"
$script:SetPassword = $false
$SqlDir = Join-Path (Join-Path $Root "scripts") "uninstall"
$ConfirmWord = "DELETE HEXOPS"

# What the application consists of. Anything else in this folder is left in place.
$AppTop = @("frontend", "docs", "scripts", ".git", ".github", ".gitignore", ".gitattributes",
  "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md", "install-linux.sh", "install-windows.ps1",
  "start-linux.sh", "start-windows.ps1", "uninstall-linux.sh", "uninstall-windows.ps1")
$AppBackend = @("app", "alembic", "alembic.ini", "tests", "pyproject.toml", ".env.example", ".venv",
  ".pytest_cache", ".ruff_cache", "__pycache__")

function Say([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Info([string]$Text) { Write-Host "    $Text" }
function Fail([string]$Message, [string[]]$Hints = @()) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  foreach ($h in $Hints) { Write-Host "       $h" }
  exit 1
}

function Test-Inside([string]$Path, [string]$Folder) {
  if (-not $Path) { return $false }
  $full = [System.IO.Path]::GetFullPath($Path)
  return $full.StartsWith($Folder.TrimEnd($Sep) + $Sep, [System.StringComparison]::OrdinalIgnoreCase)
}

# --- processes -------------------------------------------------------------------------------

# A process belongs to this installation only if its program lies in this folder (the venv's
# python.exe, Playwright's node.exe), or it is node.exe running a script from this folder's
# frontend\node_modules (vite), or PowerShell running this folder's start-windows.ps1.
# Ports are never used to decide.
function Get-HexopsProcessKind($Proc, [string]$Folder) {
  $front = (Join-Path $Folder "frontend") + $Sep + "node_modules" + $Sep
  $exe = [string]$Proc.ExecutablePath
  $cmd = [string]$Proc.CommandLine
  $name = ([string]$Proc.Name).ToLowerInvariant()
  if ($exe -and (Test-Inside $exe $Folder)) { return "program " + $exe.Substring($Folder.Length + 1) }
  if (($name -eq "node.exe" -or $name -eq "node") -and
      $cmd.IndexOf($front, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return "node (vite)" }
  $start = Join-Path $Folder "start-windows.ps1"
  if (($name -match '^(powershell|pwsh)(\.exe)?$') -and
      $cmd.IndexOf($start, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return "start-windows.ps1" }
  return $null
}

function Get-ProcessTable {
  return @(Get-CimInstance Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)
}

function Get-SelfAndAncestors($All) {
  $ids = @{}
  $id = $PID
  while ($id -and -not $ids.ContainsKey($id)) {
    $ids[$id] = $true
    $p = $All | Where-Object { $_.ProcessId -eq $id } | Select-Object -First 1
    if (-not $p) { break }
    $id = $p.ParentProcessId
  }
  return $ids
}

function Find-HexopsProcesses([string]$Folder) {
  $all = Get-ProcessTable
  $skip = Get-SelfAndAncestors $all
  $found = @()
  foreach ($p in $all) {
    if ($skip.ContainsKey($p.ProcessId)) { continue }
    $kind = Get-HexopsProcessKind $p $Folder
    if ($kind) { $found += [pscustomobject]@{ Id = $p.ProcessId; Kind = $kind } }
  }
  return $found
}

# taskkill writes to stderr for processes that already exited; only the result matters.
function Stop-ProcessTree([int]$Id) {
  $ErrorActionPreference = "Continue"
  & taskkill /PID $Id /T /F 2>$null | Out-Null
}

function Stop-HexopsProcesses($Procs) {
  foreach ($p in $Procs) { Stop-ProcessTree $p.Id }
  for ($i = 0; $i -lt 20; $i++) {
    $left = @(Find-HexopsProcesses $Root)
    if ($left.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $left = @(Find-HexopsProcesses $Root)
  if ($left.Count -gt 0) {
    Fail ("these HexOps processes could not be stopped: " + (($left | ForEach-Object { $_.Id }) -join ", ")) @(
      "Close them (Task Manager) and run this again. Nothing was deleted.")
  }
  Info ("Stopped " + @($Procs).Count + " HexOps process(es).")
}

# --- database ------------------------------------------------------------------------------

function Get-EnvValue([string]$File, [string]$Name) {
  if (-not (Test-Path -LiteralPath $File)) { return "" }
  $line = Get-Content -LiteralPath $File | Where-Object { $_ -match "^$Name=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^$Name=", "").Trim().Trim('"', "'") }
  return ""
}

# User, host, port and database name from HEXOPS_DATABASE_URL. The password is not kept.
function ConvertFrom-DatabaseUrl([string]$Url) {
  if (-not $Url) { return $null }
  $u = $null
  if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$u)) { return $null }
  if (-not $u.Scheme.StartsWith("postgresql")) { return $null }
  $user = [System.Uri]::UnescapeDataString(($u.UserInfo -split ":", 2)[0])
  $db = [System.Uri]::UnescapeDataString($u.AbsolutePath.TrimStart("/"))
  if (-not $user -or -not $db) { return $null }
  $port = $u.Port
  if ($port -le 0) { $port = 5432 }
  return [pscustomobject]@{ User = $user; Host = $u.Host.Trim("[", "]"); Port = $port; Database = $db }
}

function Test-LocalDatabaseHost([string]$HostName) {
  return @("127.0.0.1", "localhost", "::1", "") -contains $HostName.ToLowerInvariant()
}

function Find-Psql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

# Runs a shared SQL file as the PostgreSQL administrator; returns its output lines.
function Invoke-AdminSql([string]$SqlFile, [string]$Database, [string[]]$Vars) {
  $ErrorActionPreference = "Continue"
  $args2 = @("-X", "-q", "-h", $script:Db.Host, "-p", "$($script:Db.Port)", "-U", $PostgresUser,
    "-d", $Database, "-w")
  foreach ($v in $Vars) { $args2 += @("-v", $v) }
  $out = Get-Content -LiteralPath $SqlFile -Raw | & $script:Psql @args2 2>&1
  return [pscustomobject]@{ Output = @($out | ForEach-Object { "$_" }); ExitCode = $LASTEXITCODE }
}

function Get-Kv($Lines, [string]$Key) {
  $line = @($Lines | Where-Object { $_ -like "$Key=*" }) | Select-Object -Last 1
  if ($line) { return $line.Substring($Key.Length + 1) }
  return ""
}

# Returns the list of reasons to refuse (empty = the database and role are only HexOps').
function Get-DatabaseRefusals($Cluster, $Schema, [string]$Role, [string]$Database, [bool]$HexopsRunning) {
  $r = @()
  if ((Get-Kv $Cluster "db_exists") -eq "1") {
    $owner = Get-Kv $Cluster "db_owner"
    if ($owner -ne $Role) { $r += "database '$Database' belongs to role '$owner', not to '$Role'" }
    $foreign = Get-Kv $Schema "foreign_tables"
    if ($foreign) { $r += "database '$Database' contains tables HexOps did not create: $foreign" }
    $ext = Get-Kv $Schema "foreign_extensions"
    if ($ext) { $r += "database '$Database' uses extensions HexOps does not: $ext" }
    if (-not (Get-Kv $Schema "alembic") -and (Get-Kv $Schema "tables") -notin @("", "0")) {
      $r += "database '$Database' has tables but no HexOps schema version"
    }
  }
  if ((Get-Kv $Cluster "role_exists") -eq "1") {
    if ((Get-Kv $Cluster "role_privileged") -ne "0") { $r += "role '$Role' has administrator powers (superuser/createdb/createrole/...)" }
    $owned = Get-Kv $Cluster "other_dbs_owned"
    if ($owned) { $r += "role '$Role' also owns database(s): $owned" }
    $deps = Get-Kv $Cluster "deps_elsewhere"
    if ($deps) { $r += "role '$Role' owns or may use objects in: $deps" }
    if ((Get-Kv $Cluster "memberships") -ne "0") { $r += "role '$Role' is a member of, or has members in, other roles" }
    if ((Get-Kv $Cluster "sessions_elsewhere") -ne "0") { $r += "role '$Role' is connected to another database right now" }
  }
  if ((Get-Kv $Cluster "sessions_db") -notin @("", "0") -and -not $HexopsRunning) {
    $r += "something that is not this HexOps installation is connected to '$Database'"
  }
  return , $r
}

# --- files ---------------------------------------------------------------------------------

function Get-RemovalPlan([string]$Folder, [bool]$IsPurge) {
  $be = Join-Path $Folder "backend"
  $delete = @(); $left = @()
  foreach ($n in $AppTop) { $p = Join-Path $Folder $n; if (Test-Path -LiteralPath $p) { $delete += $p } }
  if (Test-Path -LiteralPath $be) {
    foreach ($n in $AppBackend) { $p = Join-Path $be $n; if (Test-Path -LiteralPath $p) { $delete += $p } }
    Get-ChildItem -LiteralPath $be -Force -Filter "*.egg-info" -ErrorAction SilentlyContinue |
      ForEach-Object { $delete += $_.FullName }
  }
  if ($IsPurge) {
    $envf = Join-Path $be ".env"; if (Test-Path -LiteralPath $envf) { $delete += $envf }
    $data = Join-Path $Folder "data"; if (Test-Path -LiteralPath $data) { $delete += $data }
  }
  $known = @($AppTop) + @("backend", "data")
  Get-ChildItem -LiteralPath $Folder -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($known -notcontains $_.Name) { $left += $_.FullName }
  }
  if (Test-Path -LiteralPath $be) {
    $knownBe = @($AppBackend) + @(".env")
    Get-ChildItem -LiteralPath $be -Force -ErrorAction SilentlyContinue | ForEach-Object {
      if ($knownBe -notcontains $_.Name -and $_.Name -notlike "*.egg-info") { $left += $_.FullName }
    }
  }
  return [pscustomobject]@{ Delete = @($delete); Left = @($left) }
}

function Test-IsLink([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  return ($item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint))
}

# Deletes a file or folder. A junction or symbolic link is removed as a link: its target is
# never entered. Read-only files (in .git and node_modules) are deleted too.
function Remove-Tree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    if (Test-IsLink $Path) { [System.IO.Directory]::Delete($Path) }
    return
  }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    if ($item.PSIsContainer) { [System.IO.Directory]::Delete($Path) } else { [System.IO.File]::Delete($Path) }
    return
  }
  if (-not $item.PSIsContainer) {
    $item.Attributes = [System.IO.FileAttributes]::Normal
    [System.IO.File]::Delete($Path)
    return
  }
  foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force)) { Remove-Tree $child.FullName }
  $item.Attributes = [System.IO.FileAttributes]::Directory
  [System.IO.Directory]::Delete($Path)
}

function Get-Description([string]$Path) {
  if (Test-IsLink $Path) { return "$Path  (link: only the link is removed)" }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item -and $item.PSIsContainer) {
    $size = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum
    return ("{0}{1}  ({2:N1} MB)" -f $Path, $Sep, ($size / 1MB))
  }
  return $Path
}

function Get-OutsideDataFolders {
  $out = @()
  foreach ($name in @("HEXOPS_UPLOADS_DIR", "HEXOPS_PDF_DIR", "HEXOPS_TRANSFER_DIR", "HEXOPS_BACKUPS_DIR")) {
    $dir = Get-EnvValue $EnvFile $name
    if (-not $dir) { continue }
    if (-not [System.IO.Path]::IsPathRooted($dir)) { $dir = Join-Path $Backend $dir }
    $dir = [System.IO.Path]::GetFullPath($dir)
    if (-not (Test-Inside $dir $Root)) { $out += "$name=$dir" }
  }
  return $out
}

function Test-TypedConfirmation([string]$Answer) { return ($Answer -ceq $ConfirmWord) }

# --- main ----------------------------------------------------------------------------------

function Invoke-Uninstall {
  if ($RemoveApp -and $Purge) { Fail "choose either -RemoveApp or -Purge" }
  if (-not $RemoveApp -and -not $Purge) {
    Fail "choose what to do: -RemoveApp (keep your data) or -Purge (delete everything)" @(
      "Add -DryRun to see the plan first. Get-Help .\uninstall-windows.ps1 -Detailed for details.")
  }
  $mode = "app"; if ($Purge) { $mode = "purge" }
  $homeDir = [System.Environment]::GetFolderPath("UserProfile")
  if ($Root.Length -le 3 -or $Root -eq $homeDir.TrimEnd($Sep)) { Fail "refusing to uninstall from $Root" }
  if (-not (Test-Path -LiteralPath (Join-Path $Root "uninstall-windows.ps1")) -or
      -not ((Test-Path -LiteralPath $Backend) -or (Test-Path -LiteralPath $Frontend) -or (Test-Path -LiteralPath (Join-Path $Root "data")))) {
    Fail "$Root does not look like a HexOps folder."
  }

  $export = ""
  if ($ExportPath) {
    $export = [System.IO.Path]::GetFullPath($ExportPath)
    if (Test-Inside $export $Root) { Fail "the export must be saved outside $Root, which is being removed." }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $export))) { Fail "the folder for the export does not exist: $(Split-Path -Parent $export)" }
    if (Test-Path -LiteralPath $export) { Fail "$export already exists; choose a new file name." }
    $venvPy = $VenvPython
    if (-not (Test-Path -LiteralPath $venvPy) -or -not (Test-Path -LiteralPath $EnvFile) -or -not (Test-Path -LiteralPath (Join-Path $Backend "app"))) {
      Fail "an export needs the installed application (backend\.venv, backend\app, backend\.env)." @(
        "Run install-windows.ps1 first, or export from Settings -> Data, or uninstall without -ExportPath.")
    }
  }

  Say "HexOps in $Root"
  $procs = @(Find-HexopsProcesses $Root)
  if ($procs.Count -gt 0) {
    Info "Processes of this installation (will be stopped):"
    foreach ($p in $procs) { Info ("  pid {0}: {1}" -f $p.Id, $p.Kind) }
  } else { Info "No HexOps processes of this installation are running." }

  $script:Db = $null; $dropDb = $false; $dropRole = $false; $dbNote = ""
  if ($mode -eq "purge") {
    if (-not (Test-Path -LiteralPath $EnvFile)) { $dbNote = "backend\.env not found: no database is known to this installation." }
    else {
      $url = Get-EnvValue $EnvFile "HEXOPS_DATABASE_URL"
      if (-not $url) { $dbNote = "backend\.env has no HEXOPS_DATABASE_URL: no database to drop." }
      else {
        $script:Db = ConvertFrom-DatabaseUrl $url
        if (-not $script:Db) { Fail "HEXOPS_DATABASE_URL in backend\.env cannot be read; nothing was changed." }
        if (-not (Test-LocalDatabaseHost $script:Db.Host)) {
          Fail "the database is on another computer ($($script:Db.Host)); -Purge only removes a database on this computer." @(
            "Nothing was changed. Remove the application with -RemoveApp and delete that database yourself.")
        }
        if (@("postgres", "template0", "template1") -contains $script:Db.Database) { Fail "refusing to drop the system database '$($script:Db.Database)'." }
        if ($script:Db.User -eq "postgres" -or $script:Db.User.StartsWith("pg_")) {
          Fail "HexOps connects as the PostgreSQL role '$($script:Db.User)', which is not a dedicated HexOps role; nothing was changed."
        }
        $script:Psql = Find-Psql
        if (-not $script:Psql) { Fail "psql was not found (it comes with PostgreSQL); nothing was changed." }
        if (-not $env:PGPASSWORD) {
          $script:SetPassword = $true
          $secure = Read-Host "    Password of the PostgreSQL administrator '$PostgresUser'" -AsSecureString
          $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        }
        $vars = @("db=$($script:Db.Database)", "role=$($script:Db.User)")
        $cluster = Invoke-AdminSql (Join-Path $SqlDir "cluster_check.sql") "postgres" $vars
        if ($cluster.ExitCode -ne 0) {
          Fail "cannot check the database as the PostgreSQL administrator '$PostgresUser'; nothing was changed." @(
            (($cluster.Output | Select-Object -Last 2) -join " "), "Is PostgreSQL running on port $($script:Db.Port)? Is the password right?")
        }
        $schema = @()
        if ((Get-Kv $cluster.Output "db_exists") -eq "1") {
          $s = Invoke-AdminSql (Join-Path $SqlDir "schema_check.sql") $script:Db.Database @()
          if ($s.ExitCode -ne 0) { Fail "cannot inspect database '$($script:Db.Database)'; nothing was changed." }
          $schema = $s.Output
          $dropDb = $true
        }
        if ((Get-Kv $cluster.Output "role_exists") -eq "1") { $dropRole = $true }
        $refuse = Get-DatabaseRefusals $cluster.Output $schema $script:Db.User $script:Db.Database ($procs.Count -gt 0)
        if ($refuse.Count -gt 0) {
          Fail "the database and role are not only used by this HexOps installation:" (@($refuse) + @(
            "Nothing was changed. Use -RemoveApp instead, and clean up PostgreSQL yourself."))
        }
        if (-not $dropDb -and -not $dropRole) {
          $dbNote = "database '$($script:Db.Database)' and role '$($script:Db.User)' do not exist (already removed)."
        }
      }
    }
  }

  $plan = Get-RemovalPlan $Root ($mode -eq "purge")
  if ($mode -eq "purge") { Say "Plan (FULL PURGE)" } else { Say "Plan (remove the application, keep data)" }
  if ($mode -eq "purge") {
    if ($dropDb) { Info ("PostgreSQL (this computer, port {0}): DROP DATABASE ""{1}""" -f $script:Db.Port, $script:Db.Database) }
    if ($dropRole) { Info ("PostgreSQL (this computer, port {0}): DROP ROLE ""{1}""" -f $script:Db.Port, $script:Db.User) }
    if ($dbNote) { Info "PostgreSQL: $dbNote" }
  } else {
    if (Test-Path -LiteralPath $EnvFile) { Info "Kept: $EnvFile (database address and secret key)" }
    if (Test-Path -LiteralPath (Join-Path $Root "data")) { Info ("Kept: " + (Join-Path $Root "data") + "$Sep (evidence uploads, backups)") }
    Info "Kept: the PostgreSQL database and role."
  }
  if ($export) { Info "First saved: encrypted export to $export" }
  if ($plan.Delete.Count -gt 0) {
    Info "Deleted:"
    foreach ($p in $plan.Delete) { Info ("  " + (Get-Description $p)) }
  } else { Info "No application files left to delete." }
  if ($plan.Left.Count -gt 0) {
    Info "Left in place (not part of HexOps):"
    foreach ($p in $plan.Left) { Info "  $p" }
  }
  if ($mode -eq "purge") {
    $outside = @(Get-OutsideDataFolders)
    if ($outside.Count -gt 0) {
      Info "Configured outside this folder and NOT deleted (delete by hand if you want):"
      foreach ($o in $outside) { Info "  $o" }
    }
  }
  Info "Never touched: Python, Node.js, PostgreSQL itself, other databases, browsers, %LOCALAPPDATA%\ms-playwright."

  if ($procs.Count -eq 0 -and $plan.Delete.Count -eq 0 -and -not $dropDb -and -not $dropRole) {
    Say "Nothing to do: HexOps is already removed from $Root."
    return
  }
  if ($DryRun) { Say "Dry run: nothing was changed."; return }

  if ($mode -eq "purge") {
    if (-not $export) {
      Info ""
      Info "No backup requested. To keep your data, cancel and rerun with -ExportPath <file>,"
      Info "or export it from Settings -> Data. After this, the data cannot be recovered."
    }
    Write-Host ""
    $answer = Read-Host "Type $ConfirmWord to delete all of the above"
    if (-not (Test-TypedConfirmation $answer)) { Fail "not confirmed; nothing was changed." }
  } elseif (-not $Yes) {
    Write-Host ""
    $answer = Read-Host "Remove the HexOps application from $Root? [y/N]"
    if ($answer -notmatch '^(y|yes)$') { Fail "cancelled; nothing was changed." }
  }

  Say "Stopping HexOps"
  if ($procs.Count -gt 0) { Stop-HexopsProcesses $procs } else { Info "Nothing was running." }

  if ($export) {
    Say "Saving the encrypted export"
    Push-Location $Backend
    try {
      $ErrorActionPreference = "Continue"
      & $VenvPython -m app.modules.transfer.cli export $export
      $code = $LASTEXITCODE
      $ErrorActionPreference = "Stop"
    } finally { Pop-Location }
    if ($code -ne 0) { Fail "the export failed; nothing was deleted (HexOps was only stopped)." }
  }

  if ($mode -eq "purge" -and ($dropDb -or $dropRole)) {
    Say "Removing the PostgreSQL database and role"
    $vars = @("db=$($script:Db.Database)", "role=$($script:Db.User)")
    $again = Invoke-AdminSql (Join-Path $SqlDir "cluster_check.sql") "postgres" $vars
    if ($again.ExitCode -ne 0) { Fail "cannot check the database again; nothing was deleted." }
    if ((Get-Kv $again.Output "sessions_db") -ne "0") {
      Fail "something is still connected to '$($script:Db.Database)'; nothing was deleted." @(
        "Close whatever uses it (another HexOps copy? pgAdmin?) and run this again.")
    }
    $yn = @{ $true = "yes"; $false = "no" }
    $drop = Invoke-AdminSql (Join-Path $SqlDir "drop.sql") "postgres" ($vars + @("drop_db=$($yn[$dropDb])", "drop_role=$($yn[$dropRole])"))
    if ($drop.ExitCode -ne 0) {
      Fail "PostgreSQL refused to drop the database or role; no files were deleted." @(
        (($drop.Output | Select-Object -Last 2) -join " "), "Fix the reason and run this again; it continues where it stopped.")
    }
    if ($dropDb) { Info "Dropped database ""$($script:Db.Database)""." }
    if ($dropRole) { Info "Dropped role ""$($script:Db.User)""." }
  }

  Say "Deleting files"
  # Nothing may keep this folder open: leave it first (the parent shell may still be in it).
  Set-Location -LiteralPath (Split-Path -Parent $Root)
  $failed = @()
  foreach ($p in $plan.Delete) {
    try { Remove-Tree $p } catch { $failed += $p }
    if ((Test-Path -LiteralPath $p) -or (Test-IsLink $p)) { if ($failed -notcontains $p) { $failed += $p } }
  }
  foreach ($dir in @($Backend, $Root)) {
    if ($dir -eq $Root -and $mode -ne "purge") { continue }
    if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) {
      try { [System.IO.Directory]::Delete($dir) }
      catch { Write-Verbose "not removed yet: $dir ($($_.Exception.Message))" }  # reported below
    }
  }
  if ($failed.Count -gt 0) {
    Fail "some files could not be deleted (a program may still use them):" (@($failed) + @("Close that program and run this again."))
  }

  if ($mode -eq "purge") {
    Say "HexOps was removed completely."
    if (Test-Path -LiteralPath $Root) {
      if ($plan.Left.Count -gt 0) { Info "$Root still holds files that are not part of HexOps (listed above)." }
      else {
        # Windows cannot delete a folder that a window still has open as its current folder.
        Info "The empty folder $Root could not be removed because a window still uses it"
        Info "as its current folder. Close that window (or cd elsewhere), then run:"
        Info "  Remove-Item -LiteralPath '$Root'"
      }
    } else { Info "The folder $Root is gone." }
  } else {
    Say "The HexOps application was removed. Your data is kept:"
    if (Test-Path -LiteralPath $EnvFile) { Info $EnvFile }
    if (Test-Path -LiteralPath (Join-Path $Root "data")) { Info ((Join-Path $Root "data") + $Sep) }
    Info "The PostgreSQL database is unchanged."
    Info ""
    Info "To reinstall with the same data: put a fresh copy of HexOps into $Root"
    Info "(unpack the ZIP from https://github.com/KhusanJuraev/HexOps there, or git clone),"
    Info "keep backend\.env and data\ where they are, and run install-windows.ps1."
  }
}

# Only run when started as a script, not when a test loads the functions above.
if ($MyInvocation.InvocationName -ne ".") {
  try { Invoke-Uninstall }
  finally { if ($script:SetPassword) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue } }
}
