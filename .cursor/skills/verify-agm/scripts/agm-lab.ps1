<#
.SYNOPSIS
  AGM verification lab: build, launch, check, stop and clean one isolated
  Antigravity_Mod test instance under C:\AGM_TestLab\VERIFY_<RunId>\.

.DESCRIPTION
  Actions (run them in this order):
    setup    copy an official clean base into <RunDir>\app, install the repo's
             platform with install-or-update.ps1 -SkipRepatch, run the COPY's
             mod_kit\repatch.ps1 against <RunDir>\app, then run the update-lock gate.
    launch   start <RunDir>\app\Antigravity.exe with its own user-data dir, a
             redirected APPDATA/LOCALAPPDATA/USERPROFILE/HOME/TEMP, a CDP port,
             and wait until the AGM sidebar entry (#agm-nav-hub) is in the DOM.
    doctor   read-only health check of the instance this run started.
    stop     close only the PID this run started, then any leftover process whose
             executable lives under <RunDir>\app\. Keeps user data for relaunch.
    cleanup  stop, then delete app/userdata/env/tmp. Keeps <RunDir>\proof\ and
             writes proof\MANIFEST.txt.

  Hard rules enforced here:
    * every path written must be under C:\AGM_TestLab\
    * never touches D:\AI_Studio\Apps\Antigravity\, %USERPROFILE%\.gemini\ or 02_Personal
    * never kills by process name, never uses taskkill /T
    * refuses CDP port 9223 (the production IDE's) and any port already listening
    * never runs the production repatch.ps1 or any updater

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1 -Action setup -RunId r1
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet('setup', 'launch', 'doctor', 'stop', 'cleanup')][string]$Action,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{1,40}$')][string]$RunId,
    [string]$BaseDir = 'C:\AGM_TestLab\IPC_SEC_A02\bases\2.32.1',
    [string]$RepoDir = '',
    [int]$Port = 9341,
    [int]$ReadyTimeoutSec = 120,
    [string[]]$OfficialAsarHashes = @('5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LabRoot   = 'C:\AGM_TestLab'
$ProdApp   = 'D:\AI_Studio\Apps\Antigravity\'
$ProdPort  = 9223
$RunDir    = Join-Path $LabRoot ('VERIFY_' + $RunId)
$AppDir    = Join-Path $RunDir 'app'
$UserData  = Join-Path $RunDir 'userdata'
$EnvDir    = Join-Path $RunDir 'env'
$TmpDir    = Join-Path $RunDir 'tmp'
$StateDir  = Join-Path $RunDir 'state'
$ProofDir  = Join-Path $RunDir 'proof'
$CdpJs     = Join-Path $PSScriptRoot 'agm-cdp.mjs'
$Utf8      = New-Object System.Text.UTF8Encoding($false)

if ([string]::IsNullOrWhiteSpace($RepoDir)) {
    $RepoDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
}

function Say([string]$m) { Write-Host ('[agm-lab] ' + $m) }

function Assert-InLab([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p).TrimEnd('\')
    $forbidden = @($ProdApp.TrimEnd('\'), (Join-Path $env:USERPROFILE '.gemini'))
    foreach ($f in $forbidden) {
        if ($full.StartsWith($f, [System.StringComparison]::OrdinalIgnoreCase)) { throw "GUARD: protected path $full" }
    }
    if ($full -match '(^|\\)02_Personal(\\|$)') { throw "GUARD: 02_Personal path $full" }
    if (-not $full.StartsWith($LabRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "GUARD: path outside $LabRoot -> $full"
    }
    return $full
}

function Remove-InLab([string]$p) {
    $full = Assert-InLab $p
    if (-not $full.StartsWith($RunDir + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "GUARD: delete outside RunDir -> $full" }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Write-Text([string]$p, [string[]]$lines) {
    $full = Assert-InLab $p
    $dir = Split-Path -Parent $full
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllLines($full, $lines, $Utf8)
}

function Sha([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return 'MISSING' }
    return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Stamp { return (Get-Date -Format 'yyyyMMdd-HHmmss') }

function Read-State([string]$name) {
    $p = Join-Path $StateDir $name
    if (Test-Path -LiteralPath $p) { return ([System.IO.File]::ReadAllText($p)).Trim() }
    return $null
}

# Read-only view of the production IDE: PIDs and file metadata, never content.
function Get-ProdSnapshot {
    $pids = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($ProdApp, [System.StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { [int]$_.ProcessId } | Sort-Object)
    $files = @()
    foreach ($rel in @('resources\app.asar', 'resources\app-update.yml', 'Antigravity.exe')) {
        $fp = Join-Path $ProdApp $rel
        if (Test-Path -LiteralPath $fp) {
            $it = Get-Item -LiteralPath $fp
            $files += ('{0}|{1}|{2}' -f $rel, $it.Length, $it.LastWriteTimeUtc.ToString('o'))
        } else { $files += ('{0}|MISSING' -f $rel) }
    }
    return [PSCustomObject]@{ Pids = $pids; Files = $files }
}

function Compare-Prod([string]$label) {
    $beforePath = Join-Path $StateDir 'prod_before.json'
    if (-not (Test-Path -LiteralPath $beforePath)) { return @("$label prod-compare: no baseline (setup not run)") }
    $before = Get-Content -LiteralPath $beforePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $now = Get-ProdSnapshot
    $missing = @($before.Pids | Where-Object { $now.Pids -notcontains $_ })
    $filesSame = (($before.Files -join ';') -eq ($now.Files -join ';'))
    return @(
        "$label prod PIDs before=$(@($before.Pids).Count) now=$(@($now.Pids).Count) missing=[$($missing -join ',')]",
        "$label prod file metadata unchanged=$filesSame"
    )
}

function Invoke-Captured([string]$file, [string]$arguments, [string]$outFile, [int]$timeoutSec = 600) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $file
    $psi.Arguments = $arguments
    $psi.WorkingDirectory = $RunDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.EnvironmentVariables['TEMP'] = $TmpDir
    $psi.EnvironmentVariables['TMP'] = $TmpDir
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($timeoutSec * 1000)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue   # only the PID we started
        throw "timeout after ${timeoutSec}s: $file $arguments"
    }
    $p.WaitForExit()
    $code = $p.ExitCode
    Write-Text $outFile @("COMMAND: $file $arguments", "EXIT: $code", '--- STDOUT ---', $o.Result, '--- STDERR ---', $e.Result)
    return $code
}

function Get-OwnPid {
    $s = Read-State 'pid.txt'
    if (-not $s) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$s) -ErrorAction SilentlyContinue
    $exe = Join-Path $AppDir 'Antigravity.exe'
    if ($proc -and $proc.ExecutablePath -and $proc.ExecutablePath.Equals($exe, [System.StringComparison]::OrdinalIgnoreCase)) { return [int]$s }
    return $null
}

function Get-RunProcs {
    $prefix = $AppDir + '\'
    return @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

# ---------------------------------------------------------------- setup
function Do-Setup {
    foreach ($p in @($RunDir, $BaseDir, $RepoDir)) { [void](Assert-InLab $p) }
    if (Get-OwnPid) { throw "an instance of this run is still running; run -Action stop first" }
    $installer = Join-Path $RepoDir 'platform\scripts\install-or-update.ps1'
    if (-not (Test-Path -LiteralPath $installer)) { throw "RepoDir has no platform\scripts\install-or-update.ps1: $RepoDir" }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node not on PATH' }
    if (-not (Get-Command asar -ErrorAction SilentlyContinue)) { throw 'global asar not on PATH; refusing (npx fallback would write the shared npm cache)' }
    $baseExe = Join-Path $BaseDir 'Antigravity.exe'
    $baseAsar = Join-Path $BaseDir 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $baseExe)) { throw "BaseDir has no Antigravity.exe: $BaseDir" }
    if (Test-Path -LiteralPath (Join-Path $BaseDir 'UserData')) { throw "BaseDir contains UserData; pick a clean base" }
    $baseSha = Sha $baseAsar
    if ($OfficialAsarHashes -notcontains $baseSha) { throw "BaseDir app.asar $baseSha is not in the official whitelist" }

    foreach ($d in @($AppDir, $UserData, $EnvDir, $TmpDir, (Join-Path $ProofDir 'setup'))) { Remove-InLab $d }
    New-Item -ItemType Directory -Force -Path $StateDir, $TmpDir, (Join-Path $ProofDir 'setup') | Out-Null
    Remove-InLab (Join-Path $StateDir 'setup.json')
    $snap = Get-ProdSnapshot
    [System.IO.File]::WriteAllText((Join-Path $StateDir 'prod_before.json'), ($snap | ConvertTo-Json -Depth 4), $Utf8)

    Say "robocopy base -> $AppDir"
    & robocopy $BaseDir $AppDir /E /XD UserData /R:1 /W:1 /NFL /NDL /NJH /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
    # empty data dir: drop runtime state the base may carry
    foreach ($rel in @('plugins\config.json', 'plugins\state', 'plugins\packages', 'resources\app.asar.bak')) {
        Remove-InLab (Join-Path $AppDir $rel)
    }

    $ps = 'powershell.exe'
    $c1 = Invoke-Captured $ps ("-NoProfile -ExecutionPolicy Bypass -File `"$installer`" -TargetAppDir `"$AppDir`" -DryRun") (Join-Path $ProofDir 'setup\1_install_dryrun.txt')
    Say "install-or-update -DryRun exit=$c1"
    if ($c1 -ne 0) { throw 'DryRun failed; see proof\setup\1_install_dryrun.txt' }
    $c2 = Invoke-Captured $ps ("-NoProfile -ExecutionPolicy Bypass -File `"$installer`" -TargetAppDir `"$AppDir`" -SkipRepatch") (Join-Path $ProofDir 'setup\2_install_skiprepatch.txt')
    Say "install-or-update -SkipRepatch exit=$c2"
    if ($c2 -ne 0) { throw 'install failed; see proof\setup\2_install_skiprepatch.txt' }
    $repatch = Assert-InLab (Join-Path $AppDir 'mod_kit\repatch.ps1')
    $c3 = Invoke-Captured $ps ("-NoProfile -ExecutionPolicy Bypass -File `"$repatch`" -TargetAppDir `"$AppDir`"") (Join-Path $ProofDir 'setup\3_repatch_testcopy.txt')
    Say "test-copy repatch.ps1 exit=$c3"
    if ($c3 -ne 0) { throw 'repatch failed; see proof\setup\3_repatch_testcopy.txt' }

    # update-lock gate: refuse to ever launch an instance that could self-update
    $asar = Join-Path $AppDir 'resources\app.asar'
    $yml = Join-Path $AppDir 'resources\app-update.yml'
    $ymlText = ''
    if (Test-Path -LiteralPath $yml) { $ymlText = [System.IO.File]::ReadAllText($yml) }
    $probeJs = Join-Path $TmpDir 'asar_probe.js'
    [System.IO.File]::WriteAllText($probeJs, @'
const fs = require('fs');
function read(asarPath, target) {
  const fd = fs.openSync(asarPath, 'r');
  const h = Buffer.alloc(16); fs.readSync(fd, h, 0, 16, 0);
  const len = h.readUInt32LE(12); const jb = Buffer.alloc(len); fs.readSync(fd, jb, 0, len, 16);
  const hdr = JSON.parse(jb.toString('utf8')); const base = 8 + h.readUInt32LE(4);
  let n = hdr; for (const p of target.split('/')) { n = n.files && n.files[p]; if (!n) return ''; }
  if (n.unpacked) return ''; const b = Buffer.alloc(n.size); fs.readSync(fd, b, 0, n.size, base + Number(n.offset));
  fs.closeSync(fd); return b.toString('utf8');
}
const a = process.argv[2];
console.log(JSON.stringify({
  updaterLock: read(a, 'dist/updater.js').includes('AGM_UPDATE_LOCK helper'),
  ipcLock: read(a, 'dist/ipcHandlers.js').includes('blocked IPC updater:quit-and-install'),
  legacyZh: read(a, 'dist/preload.js').includes('AGY_ZH_ENGINE_START')
}));
'@, $Utf8)
    $probe = (& node $probeJs $asar | Out-String).Trim() | ConvertFrom-Json
    $hostMatch = ((Sha (Join-Path $AppDir 'plugins\agm-plugin-host.js')) -eq (Sha (Join-Path $RepoDir 'platform\agm-plugin-host.js')))
    $i18nMatch = ((Sha (Join-Path $AppDir 'plugins\hakimi-i18n.js')) -eq (Sha (Join-Path $RepoDir 'plugins\builtin\hakimi-i18n\hakimi-i18n.js')))
    $dockMatch = ((Sha (Join-Path $AppDir 'plugins\ai-sidedock.js')) -eq (Sha (Join-Path $RepoDir 'plugins\builtin\ai-sidedock\ai-sidedock.js')))
    $deadUrl = $ymlText -match 'url:\s*http://127\.0\.0\.1:9/agm-update-disabled/'
    $cacheDir = $ymlText -match 'updaterCacheDirName:\s*antigravity-mod-updater'
    $bakSha = Sha (Join-Path $AppDir 'resources\app.asar.bak')
    $pass = $deadUrl -and $cacheDir -and $probe.updaterLock -and $probe.ipcLock -and (-not $probe.legacyZh) -and $hostMatch -and $i18nMatch -and $dockMatch -and ($OfficialAsarHashes -contains $bakSha) -and (-not (Test-Path -LiteralPath (Join-Path $AppDir 'UserData')))
    $gate = if ($pass) { 'PASS' } else { 'FAIL' }
    $asarSha = Sha $asar
    Write-Text (Join-Path $ProofDir 'setup\4_update_lock_gate.txt') @(
        "time                      : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
        "base app.asar (official)  : $baseSha",
        "app.asar.bak              : $bakSha",
        "patched app.asar          : $asarSha",
        "yml dead update url       : $deadUrl",
        "yml updaterCacheDirName   : $cacheDir",
        "asar updater lock         : $($probe.updaterLock)",
        "asar IPC quit-install lock: $($probe.ipcLock)",
        "asar legacy AGY_ZH absent : $(-not $probe.legacyZh)",
        "host js == repo           : $hostMatch",
        "hakimi-i18n.js == repo    : $i18nMatch",
        "ai-sidedock.js == repo    : $dockMatch",
        "GATE                      : $gate",
        '--- app-update.yml ---', $ymlText)
    $setup = [PSCustomObject]@{ Gate = $gate; BaseDir = $BaseDir; RepoDir = $RepoDir; AsarSha = $asarSha; Time = (Get-Date).ToString('o') }
    [System.IO.File]::WriteAllText((Join-Path $StateDir 'setup.json'), ($setup | ConvertTo-Json), $Utf8)
    Say "update-lock gate: $gate (proof\setup\4_update_lock_gate.txt)"
    if (-not $pass) { exit 2 }
}

# ---------------------------------------------------------------- launch
function Do-Launch {
    [void](Assert-InLab $RunDir)
    $setupPath = Join-Path $StateDir 'setup.json'
    if (-not (Test-Path -LiteralPath $setupPath)) { throw 'run -Action setup first' }
    $setup = Get-Content -LiteralPath $setupPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($setup.Gate -ne 'PASS') { throw 'update-lock gate is not PASS; refusing to launch' }
    if (Get-OwnPid) { throw 'this run already has a live instance; use doctor or stop' }
    if (@(Get-RunProcs).Count -gt 0) { throw "processes still running from $AppDir; run -Action stop" }
    if ($Port -eq $ProdPort) { throw "port $ProdPort belongs to the production IDE; refusing" }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "port $Port already listening; pick another -Port" }

    $roam = Join-Path $EnvDir 'AppData\Roaming'; $local = Join-Path $EnvDir 'AppData\Local'
    $prof = Join-Path $EnvDir 'UserProfile'; $etmp = Join-Path $EnvDir 'Temp'
    New-Item -ItemType Directory -Force -Path $UserData, $roam, $local, $prof, $etmp, $ProofDir | Out-Null
    $log = Join-Path $ProofDir ('electron-' + (Stamp) + '.log')
    $exe = Join-Path $AppDir 'Antigravity.exe'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = "--user-data-dir=`"$UserData`" --remote-debugging-port=$Port --enable-logging=file --log-file=`"$log`""
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute = $false
    # own hidden console: otherwise the client shares the caller's console and quits
    # gracefully (CTRL_CLOSE) as soon as the calling shell session ends
    $psi.CreateNoWindow = $true
    foreach ($kv in @(@('APPDATA', $roam), @('LOCALAPPDATA', $local), @('USERPROFILE', $prof), @('HOME', $prof), @('TEMP', $etmp), @('TMP', $etmp))) {
        $psi.EnvironmentVariables[$kv[0]] = $kv[1]
    }
    $p = [System.Diagnostics.Process]::Start($psi)
    [System.IO.File]::WriteAllText((Join-Path $StateDir 'pid.txt'), "$($p.Id)", $Utf8)
    [System.IO.File]::WriteAllText((Join-Path $StateDir 'port.txt'), "$Port", $Utf8)
    [System.IO.File]::WriteAllText((Join-Path $StateDir 'log.txt'), $log, $Utf8)
    Write-Text (Join-Path $ProofDir ('launch-' + (Stamp) + '.txt')) @("COMMAND: `"$exe`" $($psi.Arguments)", "PID: $($p.Id)", 'ENV: APPDATA/LOCALAPPDATA/USERPROFILE/HOME/TEMP/TMP -> ' + $EnvDir)
    Say "started PID $($p.Id) on CDP port $Port; waiting for #agm-nav-hub (max ${ReadyTimeoutSec}s)"
    $code = 1
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($p.HasExited) { throw "client exited early (code $($p.ExitCode)); see $log" }
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
            & node $CdpJs wait --run $RunId --selector '#agm-nav-hub' --timeout 5000 | Out-Null
            $code = $LASTEXITCODE
            if ($code -eq 0) { break }
        } catch { Start-Sleep -Seconds 2 }
    }
    if ($code -ne 0) {
        Say "NOT READY after ${ReadyTimeoutSec}s; run -Action doctor; log: $log"
        try {
            $pages = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3 | Where-Object { $_.type -eq 'page' -and $_.url -match '^https?://127\.0\.0\.1:' })
            foreach ($pg in $pages) {
                Say "page: $($pg.url)"
                if ($pg.url -match '/onboarding') { Say 'client is on the first-run ONBOARDING page; see SKILL.md "First-run onboarding"' }
            }
        } catch {}
        exit 1
    }
    Say "READY: PID $($p.Id), CDP 127.0.0.1:$Port, log $log"
}

# ---------------------------------------------------------------- doctor
function Do-Doctor {
    $ok = $true
    $lines = @("run      : $RunDir")
    $setupPath = Join-Path $StateDir 'setup.json'
    if (Test-Path -LiteralPath $setupPath) {
        $setup = Get-Content -LiteralPath $setupPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $asarNow = Sha (Join-Path $AppDir 'resources\app.asar')
        $lines += "gate     : $($setup.Gate)"
        $lines += "asar     : $(if ($asarNow -eq $setup.AsarSha) { 'matches setup' } else { "CHANGED ($asarNow)" })"
        if ($setup.Gate -ne 'PASS' -or $asarNow -ne $setup.AsarSha) { $ok = $false }
    } else { $lines += 'gate     : NO SETUP'; $ok = $false }
    $ownPid = Get-OwnPid
    $lines += "pid      : $(if ($ownPid) { "$ownPid alive, exe under app\" } else { 'NOT RUNNING' })"
    if (-not $ownPid) { $ok = $false }
    $portS = Read-State 'port.txt'
    if ($portS -and $ownPid) {
        $owners = @(Get-NetTCPConnection -LocalPort ([int]$portS) -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess })
        $lines += "port     : $portS owners=[$($owners -join ',')] $(if ($owners -contains $ownPid) { 'OURS' } else { 'NOT OURS' })"
        if ($owners -notcontains $ownPid) { $ok = $false }
        try {
            $v = Invoke-RestMethod -Uri "http://127.0.0.1:$portS/json/version" -TimeoutSec 3
            $lines += "cdp      : $($v.Browser)"
            $probe = (& node $CdpJs eval --run $RunId --expr "JSON.stringify({title: document.title, hub: !!document.getElementById('agm-nav-hub'), dock: !!document.getElementById('hakimi-sidedock-root'), sidebar: ((document.querySelector('[data-testid=sidebar-navigation-items]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 80)})" | Out-String).Trim()
            $lines += "dom      : $probe"
            if ($probe -notmatch '"hub":true') { $ok = $false }
        } catch { $lines += "cdp      : UNREACHABLE ($($_.Exception.Message))"; $ok = $false }
    }
    $lines += "env      : profile redirect dir exists=$(Test-Path -LiteralPath (Join-Path $EnvDir 'UserProfile'))"
    $lines += Compare-Prod 'guard   :'
    $lines += "VERDICT  : $(if ($ok) { 'HEALTHY' } else { 'NOT HEALTHY' })"
    $lines | ForEach-Object { Write-Host $_ }
    if (-not $ok) { exit 1 }
}

# ---------------------------------------------------------------- stop
function Do-Stop {
    [void](Assert-InLab $RunDir)
    $lines = @("stop at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')")
    $ownPid = Get-OwnPid
    if ($ownPid) {
        $proc = Get-Process -Id $ownPid -ErrorAction SilentlyContinue
        if ($proc) {
            [void]$proc.CloseMainWindow()
            if (-not $proc.WaitForExit(10000)) { Stop-Process -Id $ownPid -Force -ErrorAction SilentlyContinue; $lines += "PID ${ownPid}: CloseMainWindow timed out -> Stop-Process -Id" }
            else { $lines += "PID ${ownPid}: closed via CloseMainWindow" }
        }
    } else { $lines += 'no live PID recorded for this run' }
    for ($i = 0; $i -lt 15; $i++) {
        $left = @(Get-RunProcs)
        if ($left.Count -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    foreach ($lp in @(Get-RunProcs)) {
        # children of OUR instance: executable lives under this run's app dir
        Stop-Process -Id ([int]$lp.ProcessId) -Force -ErrorAction SilentlyContinue
        $lines += "leftover PID $($lp.ProcessId) $($lp.Name) under app\ -> Stop-Process -Id"
    }
    Start-Sleep -Seconds 1
    $lines += "leftover under app\ after stop: $(@(Get-RunProcs).Count)"
    # keep the client's own logs (main.log, language_server.log) as evidence
    $udLogs = Join-Path $UserData 'logs'
    if ((Test-Path -LiteralPath $udLogs) -and (Test-Path -LiteralPath $ProofDir)) {
        $dest = Assert-InLab (Join-Path $ProofDir ('userdata-logs-' + (Stamp)))
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        Get-ChildItem -LiteralPath $udLogs -File | Copy-Item -Destination $dest -Force
        $lines += "client logs copied to $dest"
    }
    $lines += Compare-Prod 'guard:'
    Remove-InLab (Join-Path $StateDir 'pid.txt')
    if (Test-Path -LiteralPath $ProofDir) { Write-Text (Join-Path $ProofDir ('stop-' + (Stamp) + '.txt')) $lines }
    $lines | ForEach-Object { Write-Host $_ }
}

# ---------------------------------------------------------------- cleanup
function Do-Cleanup {
    [void](Assert-InLab $RunDir)
    Do-Stop
    if (@(Get-RunProcs).Count -gt 0) { throw 'processes still alive under app\; not deleting' }
    foreach ($d in @($AppDir, $UserData, $EnvDir, $TmpDir)) { Remove-InLab $d }
    if (Test-Path -LiteralPath $ProofDir) {
        $files = @(Get-ChildItem -LiteralPath $ProofDir -Recurse -File | Where-Object { $_.Name -ne 'MANIFEST.txt' })
        $man = @("proof manifest $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')") + @($files | ForEach-Object { '{0}  {1}  {2}' -f (Sha $_.FullName), $_.Length, $_.FullName.Substring($ProofDir.Length + 1) })
        Write-Text (Join-Path $ProofDir 'MANIFEST.txt') $man
        Say "cleanup done; proof kept: $ProofDir ($($files.Count) files, MANIFEST.txt)"
    } else { Say 'cleanup done; no proof dir' }
}

switch ($Action) {
    'setup'   { Do-Setup }
    'launch'  { Do-Launch }
    'doctor'  { Do-Doctor }
    'stop'    { Do-Stop }
    'cleanup' { Do-Cleanup }
}
