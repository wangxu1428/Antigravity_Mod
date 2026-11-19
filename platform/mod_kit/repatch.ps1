# =============================================================================
# Antigravity 2.0 便携补丁重铸工具箱 (Repatch Kit)
# 纯相对路径编写，支持在任意盘符与目录下一键重新解包、打补丁与打包
# 支持可选参数 -TargetAppDir (-AppDir) 显式指定目标应用根目录
# 支持可选参数 -OfficialAsarHashes 或环境变量 AGM_OFFICIAL_ASAR_SHA256 扩展官方校验白名单
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [Alias("AppDir")]
    [string]$TargetAppDir,

    [Parameter(Mandatory = $false)]
    [string[]]$OfficialAsarHashes = @()
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($TargetAppDir)) {
    $RootDir = Split-Path -Parent $ScriptDir
} else {
    $RootDir = [System.IO.Path]::GetFullPath($TargetAppDir).TrimEnd('\')
}

$ResourcesDir = Join-Path $RootDir "resources"
$AsarBak = Join-Path $ResourcesDir "app.asar.bak"
$AsarTarget = Join-Path $ResourcesDir "app.asar"
$PatcherJs = Join-Path $ScriptDir "patch.js"
$UpdateYmlPath = Join-Path $ResourcesDir "app-update.yml"

# 已知官方原版 app.asar SHA256 白名单（只允许受信任官方原版作为 .bak 源）
$KnownOfficialAsarHashes = @(
    "98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46" # Antigravity 2.32.1 official app.asar
)

$AllowedOfficialHashes = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($h in $KnownOfficialAsarHashes) {
    if (-not [string]::IsNullOrWhiteSpace($h)) {
        [void]$AllowedOfficialHashes.Add($h.Trim().ToUpperInvariant())
    }
}

$ExtraOfficialHashes = @()
if ($OfficialAsarHashes) {
    $ExtraOfficialHashes += $OfficialAsarHashes
}
if (-not [string]::IsNullOrWhiteSpace($env:AGM_OFFICIAL_ASAR_SHA256)) {
    $ExtraOfficialHashes += ($env:AGM_OFFICIAL_ASAR_SHA256 -split '[,;\s]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
foreach ($eh in $ExtraOfficialHashes) {
    $normH = $eh.Trim().ToUpperInvariant()
    if ($normH -notmatch '^[0-9A-F]{64}$') {
        Write-Host ("[AGM][Repatch] ERROR: 非法的官方 SHA256 白名单哈希格式: {0}" -f $eh) -ForegroundColor Red
        exit 1
    }
    [void]$AllowedOfficialHashes.Add($normH)
}

function Test-OfficialAsarHash {
    param([string]$Sha256)
    if ([string]::IsNullOrWhiteSpace($Sha256)) {
        return $false
    }
    return $AllowedOfficialHashes.Contains($Sha256.Trim().ToUpperInvariant())
}

function Test-LockException {
    param([System.Exception]$Exception)
    $cur = $Exception
    $depth = 0
    while ($null -ne $cur -and $depth -lt 10) {
        if ($cur -is [System.IO.IOException] -or $cur -is [System.UnauthorizedAccessException]) {
            return $true
        }
        $hr = $cur.HResult
        # ERROR_SHARING_VIOLATION (0x80070020), ERROR_LOCK_VIOLATION (0x80070021), ERROR_ACCESS_DENIED (0x80070005)
        if ($hr -eq -2147024864 -or $hr -eq -2147024863 -or $hr -eq -2147024891) {
            return $true
        }
        $msg = $cur.Message
        if ($msg -and (
                $msg -match 'being used by another process' -or
                $msg -match 'sharing violation' -or
                $msg -match 'lock violation' -or
                $msg -match '正由另一进程使用' -or
                $msg -match '另一程序正在使用'
            )) {
            return $true
        }
        $cur = $cur.InnerException
        $depth++
    }
    return $false
}

function Get-Sha256Upper {
    param([Parameter(Mandatory = $true)][string]$FilePath)
    $res = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256 -ErrorAction Stop
    return $res.Hash.ToUpperInvariant()
}

function Remove-DirRobust {
    param([string]$DirPath)
    if ([string]::IsNullOrWhiteSpace($DirPath) -or !(Test-Path -LiteralPath $DirPath)) {
        return
    }
    try {
        Remove-Item -LiteralPath $DirPath -Recurse -Force -ErrorAction Stop
    } catch {
        # Windows PowerShell 5.1 Remove-Item fails on paths exceeding MAX_PATH (260 chars); delegate to Node fs.rmSync or cmd \\?\
        if ($NodeToolPath -and (Test-Path -LiteralPath $DirPath)) {
            $null = Invoke-NativeTool -FilePath $NodeToolPath -Arguments @("-e", "require('fs').rmSync(process.argv[1], { recursive: true, force: true })", $DirPath) -CaptureOutput
        }
        if (Test-Path -LiteralPath $DirPath) {
            $longPrefixed = "\\?\" + [System.IO.Path]::GetFullPath($DirPath)
            $null = & cmd.exe /c ("rd /s /q `"{0}`"" -f $longPrefixed) 2>$null
        }
    }
}

function Copy-DirRobust {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$DestDir
    )
    try {
        Copy-Item -LiteralPath $SourceDir -Destination $DestDir -Recurse -Force -ErrorAction Stop
    } catch {
        if ($NodeToolPath) {
            $cpRes = Invoke-NativeTool -FilePath $NodeToolPath -Arguments @("-e", "require('fs').cpSync(process.argv[1], process.argv[2], { recursive: true, force: true })", $SourceDir, $DestDir) -CaptureOutput
            if ($cpRes.ExitCode -eq 0) {
                return
            }
        }
        throw
    }
}

$PrevBackupPath = $null
$OrigTargetHash = $null
$TempAsarHash = $null
$FinalTargetHash = $null
$AsarBakHash = $null
$BakPolluted = $false

function Write-RollbackHint {
    $ParentDir = Split-Path -Parent $ScriptDir
    $SiblingRestore = Join-Path (Join-Path $ParentDir "scripts") "restore-official.ps1"
    $RestoreScriptRef = if (Test-Path -LiteralPath $SiblingRestore) { $SiblingRestore } else { "<repo>\platform\scripts\restore-official.ps1" }

    Write-Host ""
    Write-Host "[AGM][Rollback] 回滚命令参考:" -ForegroundColor Yellow
    if ($BakPolluted) {
        Write-Host "  [WARNING] 检测到 app.asar.bak 已被污染或非官方原版，严禁直接从当前 .bak 还原或调用 restore-official.ps1！" -ForegroundColor Red
        Write-Host "  请先从官方安装包提取纯净 app.asar 替换 resources\app.asar.bak（或放回 resources\app.asar 并移除被污染的 .bak）后再重试。" -ForegroundColor Yellow
    } else {
        Write-Host ("  1) 还原官方纯净底座: powershell -NoProfile -ExecutionPolicy Bypass -File `"{0}`" -TargetAppDir `"{1}`"" -f $RestoreScriptRef, $RootDir) -ForegroundColor Gray
        if ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath)) {
            Write-Host ("  2) 从本次重铸前快照还原: Copy-Item -LiteralPath `"{0}`" -Destination `"{1}`" -Force" -f $PrevBackupPath, $AsarTarget) -ForegroundColor Gray
        } elseif ((Test-Path -LiteralPath $AsarBak) -and (Test-OfficialAsarHash $AsarBakHash)) {
            Write-Host ("  2) 直接从官方 .bak 还原: Copy-Item -LiteralPath `"{0}`" -Destination `"{1}`" -Force" -f $AsarBak, $AsarTarget) -ForegroundColor Gray
        }
    }
}

function Invoke-NativeTool {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$CaptureOutput
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $captured = @()
    $toolExitCode = 0
    try {
        $global:LASTEXITCODE = 0
        if ($CaptureOutput) {
            $captured = @(& $FilePath @Arguments 2>&1)
        } else {
            & $FilePath @Arguments
        }
        $toolExitCode = $LASTEXITCODE
        if ($null -eq $toolExitCode) {
            $toolExitCode = 0
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }
    return [pscustomobject]@{
        ExitCode = [int]$toolExitCode
        Output   = $captured
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity 2.0 便携插件底座重铸工具箱 (Hakimi Mod Kit)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "工作根目录: $RootDir" -ForegroundColor Gray

# 1. 核验 resources 目录、patch.js 与官方原厂备份校验（绝不覆盖已有 .bak，绝不把改装版写入 .bak）
if (!(Test-Path -LiteralPath $ResourcesDir)) {
    Write-Host "[AGM][Repatch] ERROR: 未找到 resources 目录: $ResourcesDir" -ForegroundColor Red
    Write-RollbackHint
    exit 1
}

if (!(Test-Path -LiteralPath $PatcherJs)) {
    Write-Host "[AGM][Repatch] ERROR: 未找到 patch.js: $PatcherJs" -ForegroundColor Red
    Write-RollbackHint
    exit 1
}

if (Test-Path -LiteralPath $AsarBak) {
    try {
        $AsarBakHash = Get-Sha256Upper -FilePath $AsarBak
    } catch {
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: app.asar.bak 正被其他进程占用，无法校验备份: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            exit 10
        }
        throw
    }

    if (-not (Test-OfficialAsarHash $AsarBakHash)) {
        $BakPolluted = $true
        $allowedList = (@($AllowedOfficialHashes) | Sort-Object) -join ", "
        Write-Host "[AGM][Repatch] ALARM: 检测到现有 app.asar.bak 已被污染，不是受信任的官方原版！" -ForegroundColor Red
        Write-Host ("  - .bak 路径     : {0}" -f $AsarBak) -ForegroundColor Red
        Write-Host ("  - 实际 SHA256   : {0}" -f $AsarBakHash) -ForegroundColor Red
        Write-Host ("  - 期望官方白名单: {0}" -f $allowedList) -ForegroundColor Yellow
        Write-Host "  - 拒绝原因      : 为防止使用已改装或损坏归档作为底座或还原基线，已禁止解包与还原路径。目标 app.asar 与 .bak 均未做任何修改。" -ForegroundColor Yellow
        Write-RollbackHint
        exit 4
    }
    Write-Host ("[AGM][Repatch] 已校验官方原厂备份 (.bak): {0} (只读保留，绝不覆盖)" -f $AsarBakHash) -ForegroundColor Gray
} else {
    if (!(Test-Path -LiteralPath $AsarTarget)) {
        Write-Host "[AGM][Repatch] ERROR: 未找到 app.asar 或 app.asar.bak，无法继续重铸！" -ForegroundColor Red
        Write-RollbackHint
        exit 1
    }

    try {
        $OrigTargetHash = Get-Sha256Upper -FilePath $AsarTarget
    } catch {
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: 目标 app.asar 正被其他进程独占锁定（文件锁冲突），无法读取以校验官方原版备份: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            exit 10
        }
        throw
    }

    if (-not (Test-OfficialAsarHash $OrigTargetHash)) {
        $BakPolluted = $true
        $allowedList = (@($AllowedOfficialHashes) | Sort-Object) -join ", "
        Write-Host "[AGM][Repatch] ALARM: 未找到 app.asar.bak，且当前 app.asar 不是受信任的官方原版（疑似已改装或未收录版本）！" -ForegroundColor Red
        Write-Host ("  - 目标路径      : {0}" -f $AsarTarget) -ForegroundColor Red
        Write-Host ("  - 实际 SHA256   : {0}" -f $OrigTargetHash) -ForegroundColor Red
        Write-Host ("  - 期望官方白名单: {0}" -f $allowedList) -ForegroundColor Yellow
        Write-Host "  - 拒绝原因      : 严禁将非官方版本写入 app.asar.bak 以防止官方备份污染。已中止构建，未创建 .bak 且未修改目标 app.asar。" -ForegroundColor Yellow
        Write-RollbackHint
        exit 4
    }

    Write-Host ("未找到 app.asar.bak，且已核验当前 app.asar 为官方原版 ({0})，正在原子创建官方备份..." -f $OrigTargetHash) -ForegroundColor Yellow
    $bakTmp = Join-Path $ResourcesDir (".app.asar.bak.tmp_" + (Get-Date -Format "yyyyMMdd_HHmmss_fff"))
    try {
        Copy-Item -LiteralPath $AsarTarget -Destination $bakTmp -Force
        $bakTmpHash = Get-Sha256Upper -FilePath $bakTmp
        if ($bakTmpHash -ne $OrigTargetHash) {
            throw ("创建官方 .bak 临时文件校验失败 (expected={0}, actual={1})" -f $OrigTargetHash, $bakTmpHash)
        }
        if (Test-Path -LiteralPath $AsarBak) {
            Write-Host "[AGM][Repatch] 检测到并发创建的 app.asar.bak，跳过覆盖。" -ForegroundColor Gray
            $AsarBakHash = Get-Sha256Upper -FilePath $AsarBak
            if (-not (Test-OfficialAsarHash $AsarBakHash)) {
                $BakPolluted = $true
                throw ("并发写入的 app.asar.bak 校验失败 ({0})" -f $AsarBakHash)
            }
        } else {
            [System.IO.File]::Move($bakTmp, $AsarBak)
            $AsarBakHash = $OrigTargetHash
        }
    } catch {
        if (Test-Path -LiteralPath $bakTmp) {
            Remove-Item -LiteralPath $bakTmp -Force -ErrorAction SilentlyContinue
        }
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: 创建官方 .bak 时发生文件锁冲突: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            exit 10
        }
        Write-Host ("[AGM][Repatch] ERROR: 创建官方 app.asar.bak 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-RollbackHint
        if ($BakPolluted) { exit 4 } else { exit 1 }
    } finally {
        if (Test-Path -LiteralPath $bakTmp) {
            Remove-Item -LiteralPath $bakTmp -Force -ErrorAction SilentlyContinue
        }
    }
}

if (-not $OrigTargetHash -and (Test-Path -LiteralPath $AsarTarget -PathType Leaf)) {
    try {
        $OrigTargetHash = Get-Sha256Upper -FilePath $AsarTarget
    } catch {
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: 目标 app.asar 正被其他进程独占锁定（无法读取/备份/替换）: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            exit 10
        }
        throw
    }
}

# 2. 定位 node 与 asar 工具
$NodeCmdInfo = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $NodeCmdInfo) {
    Write-Host "[AGM][Repatch] ERROR: 系统未找到 node 命令，无法执行补丁注入与语法校验。" -ForegroundColor Red
    Write-RollbackHint
    exit 1
}
$NodeToolPath = $NodeCmdInfo.Source

$AsarMode = "asar"
$AsarCmdInfo = Get-Command asar -ErrorAction SilentlyContinue | Select-Object -First 1
if ($AsarCmdInfo) {
    $AsarToolPath = $AsarCmdInfo.Source
} else {
    $NpxCmdInfo = Get-Command npx -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($NpxCmdInfo) {
        $AsarMode = "npx"
        $AsarToolPath = $NpxCmdInfo.Source
    } else {
        Write-Host "[AGM][Repatch] ERROR: 系统未找到 asar 或 npx，请先安装 @electron/asar (npm i -g @electron/asar)" -ForegroundColor Red
        Write-RollbackHint
        exit 1
    }
}

function Invoke-AsarTool {
    param(
        [Parameter(Mandatory = $true)][string[]]$AsarArgs,
        [switch]$CaptureOutput
    )
    if ($AsarMode -eq "asar") {
        return Invoke-NativeTool -FilePath $AsarToolPath -Arguments $AsarArgs -CaptureOutput:$CaptureOutput
    } else {
        $npxFullArgs = @("asar") + $AsarArgs
        return Invoke-NativeTool -FilePath $AsarToolPath -Arguments $npxFullArgs -CaptureOutput:$CaptureOutput
    }
}

# 2.5 释放当前爆改版目录下可能占用 app.asar 的进程锁（绝不触碰其它盘原版）
# AGM: no blanket Stop-Process any more (it would also kill historical sidecar orphans). Abort and list instead.
$agmBusy = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($RootDir.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)
})
if ($agmBusy.Count -gt 0) {
    $agmBusy | ForEach-Object { Write-Host ("  busy: PID {0} {1}" -f $_.ProcessId, $_.ExecutablePath) -ForegroundColor Red }
    Write-Host "[AGM] C Mod processes are still running (incl. possible historical sidecar orphans). Close them / clean them with explicit approval, then retry. Nothing was changed." -ForegroundColor Red
    Write-RollbackHint
    exit 3
}
Start-Sleep -Milliseconds 300

# 3. 准备隔离临时解包目录与同卷临时打包暂存区
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if ((Test-Path -LiteralPath (Join-Path $ResourcesDir (".agm_repatch_tmp_" + $Timestamp))) -or
    (Test-Path -LiteralPath (Join-Path $ResourcesDir ("app.asar.prev_" + $Timestamp))) -or
    (Test-Path -LiteralPath (Join-Path $ResourcesDir ("app.asar.modded_prev_" + $Timestamp)))) {
    $Timestamp = (Get-Date -Format "yyyyMMdd_HHmmss") + "_" + (Get-Date -Format "fff")
}

$TempRootBase = if ([string]::IsNullOrWhiteSpace($env:TEMP)) { [System.IO.Path]::GetTempPath() } else { $env:TEMP }
$TempSrc = Join-Path $TempRootBase ("agm_rp_src_" + $Timestamp)
$TempBuildDir = Join-Path $ResourcesDir (".agm_repatch_tmp_" + $Timestamp)
$TempAsar = Join-Path $TempBuildDir "app.asar"
$ReplaceStageBak = Join-Path $TempBuildDir "app.asar.replace_bak"
$TempExtractStageDir = $null

$RequiredInjectedRelPaths = @(
    "dist/main.js",
    "dist/utils.js",
    "dist/preload.js",
    "dist/updater.js",
    "dist/ipcHandlers.js",
    "dist/languageServer.js"
)

$Succeeded = $false
$FailExitCode = 1
$AsarReplaced = $false
$UnpackedBackedUp = $false
$UnpackedSwapped = $false
$UnpackedMovedIn = $false
$KeepTempBuildDirOnCleanup = $false
$TargetUnpacked = Join-Path $ResourcesDir "app.asar.unpacked"
$TempUnpacked = Join-Path $TempBuildDir "app.asar.unpacked"
$UnpackedBackupDir = Join-Path $TempBuildDir "app.asar.unpacked.orig_bak"

try {
    if (Test-Path -LiteralPath $TempSrc) {
        Remove-DirRobust -DirPath $TempSrc
    }
    New-Item -ItemType Directory -Path $TempBuildDir -Force | Out-Null

    # 3.1 从受信任官方 .bak 解包到临时目录（若存在 app.asar.unpacked 且缺失 app.asar.bak.unpacked，则在临时区配对后再解包），显式校验 $LASTEXITCODE
    $AsarBakUnpacked = $AsarBak + ".unpacked"
    if (!(Test-Path -LiteralPath $AsarBakUnpacked) -and (Test-Path -LiteralPath $TargetUnpacked -PathType Container)) {
        $TempExtractStageDir = Join-Path $TempRootBase ("agm_rp_in_" + $Timestamp)
        New-Item -ItemType Directory -Path $TempExtractStageDir -Force | Out-Null
        $ExtractSourceAsar = Join-Path $TempExtractStageDir "a.asar"
        Copy-Item -LiteralPath $AsarBak -Destination $ExtractSourceAsar -Force
        Copy-DirRobust -SourceDir $TargetUnpacked -DestDir (Join-Path $TempExtractStageDir "a.asar.unpacked")
    } else {
        $ExtractSourceAsar = $AsarBak
    }

    Write-Host "正在从官方纯净备份还原并解包代码到临时目录..." -ForegroundColor Yellow
    $extractRes = Invoke-AsarTool -AsarArgs @("extract", $ExtractSourceAsar, $TempSrc)
    if ($extractRes.ExitCode -ne 0) {
        $FailExitCode = $extractRes.ExitCode
        throw ("asar extract failed (exit {0}); app.asar was not touched." -f $extractRes.ExitCode)
    }

    # 4. 调用精准 JS Patcher 注入
    Write-Host "正在执行安全补丁注入与语法校验..." -ForegroundColor Yellow
    $patchRes = Invoke-NativeTool -FilePath $NodeToolPath -Arguments @($PatcherJs, $TempSrc, "--update-yml", $UpdateYmlPath)
    if ($patchRes.ExitCode -ne 0) {
        $FailExitCode = 2
        throw ("[AGM] patch.js failed (exit {0}): update lock / sidecar reaper / Hakimi anchors not injected. app.asar was not touched; build stopped." -f $patchRes.ExitCode)
    }

    # 4.1 显式对注入的 JS 文件执行 node --check 校验
    foreach ($relJs in $RequiredInjectedRelPaths) {
        $winRel = $relJs.Replace("/", "\")
        $absJs = Join-Path $TempSrc $winRel
        if (!(Test-Path -LiteralPath $absJs -PathType Leaf)) {
            $FailExitCode = 5
            throw ("Missing injected JS file before pack: {0}" -f $relJs)
        }
        $chkRes = Invoke-NativeTool -FilePath $NodeToolPath -Arguments @("--check", $absJs) -CaptureOutput
        if ($chkRes.ExitCode -ne 0) {
            if ($chkRes.Output.Count -gt 0) {
                $chkRes.Output | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            }
            $FailExitCode = 5
            throw ("node --check failed for {0} (exit {1})" -f $relJs, $chkRes.ExitCode)
        }
    }

    # 5. 先打包到同卷临时暂存目录（绝不直接写目标 app.asar），显式校验 $LASTEXITCODE
    Write-Host ("正在打包到同卷临时暂存区: {0}" -f $TempAsar) -ForegroundColor Yellow
    $packRes = Invoke-AsarTool -AsarArgs @("pack", $TempSrc, $TempAsar, "--unpack", "**/chrome-devtools-mcp/**")
    if ($packRes.ExitCode -ne 0) {
        $FailExitCode = $packRes.ExitCode
        throw ("asar pack failed (exit {0}); target app.asar was not modified." -f $packRes.ExitCode)
    }

    # 5.1 校验临时产物：存在、大小 > 0、asar list 可读且包含所有关键注入文件、记录 SHA256
    if (!(Test-Path -LiteralPath $TempAsar -PathType Leaf)) {
        $FailExitCode = 7
        throw ("Staged app.asar missing after asar pack: {0}" -f $TempAsar)
    }
    $stagedItem = Get-Item -LiteralPath $TempAsar
    if ($stagedItem.Length -le 0) {
        $FailExitCode = 7
        throw ("Staged app.asar is empty (0 bytes): {0}" -f $TempAsar)
    }

    $listRes = Invoke-AsarTool -AsarArgs @("list", $TempAsar) -CaptureOutput
    if ($listRes.ExitCode -ne 0) {
        if ($listRes.Output.Count -gt 0) {
            $listRes.Output | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        }
        $FailExitCode = 7
        throw ("asar list failed on staged app.asar (exit {0})" -f $listRes.ExitCode)
    }

    $listedSet = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $listRes.Output) {
        if ($null -eq $line) { continue }
        $norm = $line.ToString().Trim().Replace("\", "/").TrimStart("/")
        if (-not [string]::IsNullOrWhiteSpace($norm)) {
            [void]$listedSet.Add($norm)
        }
    }

    $missingEntries = @()
    foreach ($reqEntry in $RequiredInjectedRelPaths) {
        if (-not $listedSet.Contains($reqEntry)) {
            $missingEntries += $reqEntry
        }
    }
    if ($missingEntries.Count -gt 0) {
        $FailExitCode = 7
        throw ("Staged app.asar missing required injected files in asar list: {0}" -f ($missingEntries -join ", "))
    }

    $TempAsarHash = Get-Sha256Upper -FilePath $TempAsar
    Write-Host ("[AGM][Repatch] 临时产物校验通过 (Size={0} bytes, SHA256={1})" -f $stagedItem.Length, $TempAsarHash) -ForegroundColor Cyan

    # 6. 校验全部通过后：按官方/改装分别备份当前 app.asar，再使用同卷 File.Replace 原子替换并校验 SHA256
    if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
        $backupName = if (Test-OfficialAsarHash $OrigTargetHash) {
            "app.asar.prev_" + $Timestamp
        } else {
            "app.asar.modded_prev_" + $Timestamp
        }
        $PrevBackupPath = Join-Path $ResourcesDir $backupName
        try {
            Copy-Item -LiteralPath $AsarTarget -Destination $PrevBackupPath -Force
            $prevHash = Get-Sha256Upper -FilePath $PrevBackupPath
            if ($OrigTargetHash -and ($prevHash -ne $OrigTargetHash)) {
                $FailExitCode = 8
                throw ("Previous app.asar backup SHA256 mismatch (expected={0}, actual={1})" -f $OrigTargetHash, $prevHash)
            }
            Write-Host ("[AGM][Repatch] 已备份替换前 app.asar 至: {0}" -f $PrevBackupPath) -ForegroundColor Gray
        } catch {
            if (Test-Path -LiteralPath $PrevBackupPath) {
                Remove-Item -LiteralPath $PrevBackupPath -Force -ErrorAction SilentlyContinue
            }
            $PrevBackupPath = $null
            if (Test-LockException $_.Exception) {
                $FailExitCode = 10
            } elseif ($FailExitCode -eq 1) {
                $FailExitCode = 8
            }
            throw
        }

        try {
            [System.IO.File]::Replace($TempAsar, $AsarTarget, $ReplaceStageBak, $true)
            $AsarReplaced = $true
        } catch {
            if (Test-LockException $_.Exception) {
                $FailExitCode = 10
                throw ("原子替换失败（目标 app.asar 正被占用，原文件未被删除或改写）: {0}" -f $_.Exception.Message)
            }
            $FailExitCode = 9
            throw ("System.IO.File.Replace failed: {0}" -f $_.Exception.Message)
        }
    } else {
        try {
            [System.IO.File]::Move($TempAsar, $AsarTarget)
            $AsarReplaced = $true
        } catch {
            if (Test-LockException $_.Exception) {
                $FailExitCode = 10
            } else {
                $FailExitCode = 9
            }
            throw ("System.IO.File.Move failed: {0}" -f $_.Exception.Message)
        }
    }

    $FinalTargetHash = Get-Sha256Upper -FilePath $AsarTarget
    if ($FinalTargetHash -ne $TempAsarHash) {
        $FailExitCode = 9
        throw ("Post-replace SHA256 mismatch! expected={0}, actual={1}" -f $TempAsarHash, $FinalTargetHash)
    }

    # 6.1 若暂存区生成了 app.asar.unpacked，同样采用备份 + 目录重命名，失败则自动恢复原 unpacked 与原 app.asar
    if (Test-Path -LiteralPath $TempUnpacked -PathType Container) {
        if (Test-Path -LiteralPath $TargetUnpacked -PathType Container) {
            try {
                [System.IO.Directory]::Move($TargetUnpacked, $UnpackedBackupDir)
                $UnpackedBackedUp = $true
            } catch {
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                    throw ("无法替换 app.asar.unpacked（目录内文件正被占用，正在回滚 app.asar）: {0}" -f $_.Exception.Message)
                }
                $FailExitCode = 9
                throw ("Backing up existing app.asar.unpacked failed: {0}" -f $_.Exception.Message)
            }

            try {
                [System.IO.Directory]::Move($TempUnpacked, $TargetUnpacked)
                $UnpackedSwapped = $true
            } catch {
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                } else {
                    $FailExitCode = 9
                }
                throw ("Moving staged app.asar.unpacked into place failed: {0}" -f $_.Exception.Message)
            }
        } else {
            try {
                [System.IO.Directory]::Move($TempUnpacked, $TargetUnpacked)
                $UnpackedMovedIn = $true
            } catch {
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                } else {
                    $FailExitCode = 9
                }
                throw ("Moving new app.asar.unpacked into place failed: {0}" -f $_.Exception.Message)
            }
        }
    }

    $Succeeded = $true
} catch {
    if (($FailExitCode -eq 1) -and (Test-LockException $_.Exception)) {
        $FailExitCode = 10
    }
    Write-Host ("[AGM][Repatch] FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red

    # 回滚 unpacked 目录（若本轮动过 unpacked）
    if ($UnpackedBackedUp -and (Test-Path -LiteralPath $UnpackedBackupDir -PathType Container)) {
        try {
            if ($UnpackedSwapped -and (Test-Path -LiteralPath $TargetUnpacked -PathType Container)) {
                $discardDir = Join-Path $TempBuildDir "app.asar.unpacked.rollback_discard"
                [System.IO.Directory]::Move($TargetUnpacked, $discardDir)
            }
            if (!(Test-Path -LiteralPath $TargetUnpacked)) {
                [System.IO.Directory]::Move($UnpackedBackupDir, $TargetUnpacked)
                Write-Host "[AGM][Repatch] 已自动恢复原 app.asar.unpacked 目录。" -ForegroundColor Yellow
            }
        } catch {
            $KeepTempBuildDirOnCleanup = $true
            Write-Host ("[AGM][Repatch] WARNING: 自动恢复 app.asar.unpacked 失败，备份保留于 {0}: {1}" -f $UnpackedBackupDir, $_.Exception.Message) -ForegroundColor Red
        }
    } elseif ($UnpackedMovedIn -and (Test-Path -LiteralPath $TargetUnpacked -PathType Container)) {
        try {
            Remove-DirRobust -DirPath $TargetUnpacked
        } catch {
            Write-Host ("[AGM][Repatch] WARNING: 清理新增 app.asar.unpacked 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
        }
    }

    # 若未完成替换（例如 File.Replace 因文件锁失败），清理本轮未使用上的前置备份以免堆积冗余文件
    if ((-not $AsarReplaced) -and $PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath)) {
        Remove-Item -LiteralPath $PrevBackupPath -Force -ErrorAction SilentlyContinue
        $PrevBackupPath = $null
    }

    # 回滚 app.asar（仅当目标缺失、已替换后后续步骤失败、或当前哈希与原哈希不一致时触发）
    $needRestore = $false
    $targetLockedInCatch = $false
    if (!(Test-Path -LiteralPath $AsarTarget)) {
        if ($AsarReplaced -or $OrigTargetHash) {
            $needRestore = $true
        }
    } elseif ($OrigTargetHash) {
        try {
            $curHash = Get-Sha256Upper -FilePath $AsarTarget
            if ($AsarReplaced -or ($curHash -ne $OrigTargetHash)) {
                $needRestore = $true
            }
        } catch {
            if (Test-LockException $_.Exception) {
                $targetLockedInCatch = $true
                Write-Host "[AGM][Repatch] 目标 app.asar 仍存在于磁盘且正被外部进程锁定，原文件未被覆写。" -ForegroundColor Yellow
            } else {
                $needRestore = $true
            }
        }
    }

    if ($needRestore -and (-not $targetLockedInCatch)) {
        $restoredOk = $false
        if (Test-Path -LiteralPath $ReplaceStageBak -PathType Leaf) {
            try {
                if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
                    [System.IO.File]::Replace($ReplaceStageBak, $AsarTarget, [NullString]::Value, $true)
                } else {
                    [System.IO.File]::Move($ReplaceStageBak, $AsarTarget)
                }
                Write-Host ("[AGM][Repatch] 已通过同卷安全备份自动恢复原 app.asar ({0})。" -f $OrigTargetHash) -ForegroundColor Yellow
                $restoredOk = $true
            } catch {
                Write-Host ("[AGM][Repatch] WARNING: 使用 ReplaceStageBak 恢复失败，尝试回退前置快照: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
            }
        }
        if ((-not $restoredOk) -and $PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath -PathType Leaf)) {
            $restoreTmp = Join-Path $TempBuildDir "app.asar.restore_tmp"
            try {
                Copy-Item -LiteralPath $PrevBackupPath -Destination $restoreTmp -Force
                if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
                    [System.IO.File]::Replace($restoreTmp, $AsarTarget, [NullString]::Value, $true)
                } else {
                    [System.IO.File]::Move($restoreTmp, $AsarTarget)
                }
                Write-Host ("[AGM][Repatch] 已从 {0} 自动恢复原 app.asar。" -f $PrevBackupPath) -ForegroundColor Yellow
                $restoredOk = $true
            } catch {
                $KeepTempBuildDirOnCleanup = $true
                Write-Host ("[AGM][Repatch] WARNING: 自动恢复原 app.asar 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
            }
        }
        if (-not $restoredOk) {
            $KeepTempBuildDirOnCleanup = $true
        }
    }

    if (Test-Path -LiteralPath $AsarTarget) {
        try {
            $keptHash = Get-Sha256Upper -FilePath $AsarTarget
            Write-Host ("[AGM][Repatch] 当前目标 app.asar SHA256: {0}" -f $keptHash) -ForegroundColor Gray
        } catch {
            $curLen = (Get-Item -LiteralPath $AsarTarget).Length
            Write-Host ("[AGM][Repatch] 当前目标 app.asar 仍在原地 (Size={0} bytes，当前正被外部进程锁定)" -f $curLen) -ForegroundColor Gray
        }
    }
    Write-RollbackHint
    if ($FailExitCode -eq 0) {
        $FailExitCode = 1
    }
} finally {
    if ($TempExtractStageDir -and (Test-Path -LiteralPath $TempExtractStageDir)) {
        Remove-DirRobust -DirPath $TempExtractStageDir
    }
    if ($TempSrc -and (Test-Path -LiteralPath $TempSrc)) {
        Remove-DirRobust -DirPath $TempSrc
    }
    if ((-not $KeepTempBuildDirOnCleanup) -and $TempBuildDir -and (Test-Path -LiteralPath $TempBuildDir)) {
        Remove-DirRobust -DirPath $TempBuildDir
    }
}

if (-not $Succeeded) {
    exit $FailExitCode
}

Write-Host ("重铸完毕！已成功更新: {0}" -f $AsarTarget) -ForegroundColor Green
Write-Host ("  - 目标 SHA256      : {0}" -f $FinalTargetHash) -ForegroundColor Gray
Write-Host ("  - 官方备份 (.bak)  : {0} ({1})" -f $AsarBak, $AsarBakHash) -ForegroundColor Gray
if ($PrevBackupPath) {
    $snapTag = if ($PrevBackupPath -like "*app.asar.modded_prev_*") { "替换前改装版快照" } else { "替换前原版快照" }
    Write-Host ("  - {0}: {1} ({2})" -f $snapTag, $PrevBackupPath, $OrigTargetHash) -ForegroundColor Gray
}
Write-RollbackHint
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
