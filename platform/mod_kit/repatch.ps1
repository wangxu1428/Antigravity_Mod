# =============================================================================
# Antigravity 2.0 便携补丁重铸工具箱 (Repatch Kit)
# 纯相对路径编写，支持在任意盘符与目录下一键重新解包、打补丁与打包
# 支持可选参数 -TargetAppDir (-AppDir) 显式指定目标应用根目录
# 支持可选参数 -OfficialAsarHashes 或环境变量 AGM_OFFICIAL_ASAR_SHA256 扩展官方校验白名单
# 支持可选参数 -StagedUpdateYmlPath 由安装器传入待原子提交的 app-update.yml 暂存文件
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [Alias("AppDir")]
    [string]$TargetAppDir,

    [Parameter(Mandatory = $false)]
    [string[]]$OfficialAsarHashes = @(),

    [Parameter(Mandatory = $false)]
    [string]$StagedUpdateYmlPath
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
$TemplateYmlInModKit = Join-Path $ScriptDir "app-update.template.yml"

$DefaultUpdateYmlContent = @(
    "# AGM: auto-update disabled 2026-11-18 by user decision. Original url: https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/",
    "provider: generic",
    "url: http://127.0.0.1:9/agm-update-disabled/",
    "updaterCacheDirName: antigravity-mod-updater"
) -join "`n"
$DefaultUpdateYmlContent = $DefaultUpdateYmlContent + "`n"

# 已知官方原版 app.asar SHA256 白名单（只允许受信任官方原版作为 .bak 源）
$KnownOfficialAsarHashes = @(
    "5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F" # Antigravity 2.32.1 official clean app.asar (resources/app.asar.bak); 98A4308C is current app.asar with preloaded AGY_ZH_ENGINE, not official
    "B33C81600E82E65593AA8430EF01B37D6B28D9D98F0FAF45E25957783B71E64B" # Antigravity 2.33.0 official clean app.asar
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
        Write-Host "[AGM][Status] EXIT_CODE=1 RECOVERY_STATE=CLEAN_NO_CHANGE CONSISTENCY_STATE=CONSISTENT_ORIG"
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

function Test-FaultInject {
    param([Parameter(Mandatory = $true)][string]$FaultName)
    if ([string]::IsNullOrWhiteSpace($env:AGM_TEST_FAULT_INJECT)) {
        return $false
    }
    $tokens = $env:AGM_TEST_FAULT_INJECT -split '[,;\s]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    foreach ($tok in $tokens) {
        if ($tok.Equals($FaultName, [System.StringComparison]::OrdinalIgnoreCase)) {
            Write-Host ("[AGM][FaultInject] Triggered: {0}" -f $FaultName) -ForegroundColor Magenta
            return $true
        }
    }
    return $false
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
    # Use .NET SHA256 so this works when Microsoft.PowerShell.Utility
    # is not auto-loaded (observed on GitHub windows-latest with -NoProfile).
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $bytes = $hasher.ComputeHash($stream)
            return ([BitConverter]::ToString($bytes)).Replace("-", "")
        } finally {
            $stream.Dispose()
        }
    } finally {
        $hasher.Dispose()
    }
}

function Get-SafeFileHashOrTag {
    param(
        [string]$FilePath,
        [switch]$ForceLocked
    )
    if ($ForceLocked) {
        return "LOCKED"
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or !(Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return "MISSING"
    }
    try {
        return (Get-Sha256Upper -FilePath $FilePath)
    } catch {
        if (Test-LockException $_.Exception) {
            return "LOCKED"
        }
        return "UNREADABLE"
    }
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

$PrevBackupPath = $null
$OrigTargetHash = $null
$TargetExistedBefore = $false
$TempAsarHash = $null
$FinalTargetHash = $null
$AsarBakHash = $null
$OfficialBakCreatedThisRun = $false
$BakPolluted = $false
$SimulatedTargetLocked = $false

$YamlExistedBefore = (Test-Path -LiteralPath $UpdateYmlPath -PathType Leaf)
$YamlOrigHash = if ($YamlExistedBefore) { Get-SafeFileHashOrTag -FilePath $UpdateYmlPath } else { "MISSING" }
$YamlBackupPath = $null
$YamlCommitAttempted = $false
$YamlRecoveryState = "NOT_MODIFIED"

$UnpackedExistedBefore = (Test-Path -LiteralPath (Join-Path $ResourcesDir "app.asar.unpacked") -PathType Container)
$UnpackedSwapState = "NOT_APPLICABLE"
$AsarRecoveryState = "NOT_STARTED"
$OverallRecoveryState = "CLEAN_NO_CHANGE"
$ConsistencyState = "CONSISTENT_ORIG"
$TempBuildDir = $null
$ReplaceStageBak = $null
$UnpackedBackupDir = $null

function Set-UnpackedState {
    param([Parameter(Mandatory = $true)][string]$NewState)
    $old = $UnpackedSwapState
    $script:UnpackedSwapState = $NewState
    Write-Host ("[AGM][Unpacked] State: {0} -> {1}" -f $old, $NewState) -ForegroundColor Gray
}

function Write-RollbackHint {
    $ParentDir = Split-Path -Parent $ScriptDir
    $SiblingRestore = Join-Path (Join-Path $ParentDir "scripts") "restore-official.ps1"
    $RestoreScriptRef = if (Test-Path -LiteralPath $SiblingRestore) { $SiblingRestore } else { "<repo>\platform\scripts\restore-official.ps1" }

    Write-Host ""
    Write-Host "[AGM][Rollback] 回滚与人工恢复命令参考:" -ForegroundColor Yellow
    if ($BakPolluted) {
        Write-Host "  [WARNING] 检测到 app.asar.bak 已被污染或非官方原版，严禁直接从当前 .bak 还原或调用 restore-official.ps1！" -ForegroundColor Red
        Write-Host "  请先从官方安装包提取纯净 app.asar 替换 resources\app.asar.bak（或放回 resources\app.asar 并移除被污染的 .bak）后再重试。" -ForegroundColor Yellow
    } else {
        Write-Host ("  1) 还原官方纯净底座: powershell -NoProfile -ExecutionPolicy Bypass -File `"{0}`" -TargetAppDir `"{1}`"" -f $RestoreScriptRef, $RootDir) -ForegroundColor Gray
        if ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath)) {
            Write-Host ("  2) 从本次重铸前快照原子还原: [System.IO.File]::Replace(`"{0}`", `"{1}`", [NullString]::Value, `$true)" -f $PrevBackupPath, $AsarTarget) -ForegroundColor Gray
        } elseif ((Test-Path -LiteralPath $AsarBak) -and (Test-OfficialAsarHash $AsarBakHash)) {
            Write-Host ("  2) 直接从官方 .bak 还原: Copy-Item -LiteralPath `"{0}`" -Destination `"{1}`" -Force" -f $AsarBak, $AsarTarget) -ForegroundColor Gray
        }
    }
    if ($ReplaceStageBak -and (Test-Path -LiteralPath $ReplaceStageBak -PathType Leaf)) {
        Write-Host ("  3) 同卷替换前暂存备份保留于: `"{0}`" (可用于解除锁定后手工原子替换恢复 app.asar)" -f $ReplaceStageBak) -ForegroundColor Yellow
    }
    if ($UnpackedBackupDir -and (Test-Path -LiteralPath $UnpackedBackupDir -PathType Container)) {
        $targetUnpackedPath = Join-Path $ResourcesDir "app.asar.unpacked"
        Write-Host ("  4) 人工恢复 app.asar.unpacked: 解除占用后移走残余目录并执行 [System.IO.Directory]::Move(`"{0}`", `"{1}`")" -f $UnpackedBackupDir, $targetUnpackedPath) -ForegroundColor Yellow
    }
    if ($YamlBackupPath -and (Test-Path -LiteralPath $YamlBackupPath -PathType Leaf)) {
        Write-Host ("  5) 人工恢复 app-update.yml: [System.IO.File]::Replace(`"{0}`", `"{1}`", [NullString]::Value, `$true)" -f $YamlBackupPath, $UpdateYmlPath) -ForegroundColor Yellow
    }
}

function Write-StructuredStatus {
    param([int]$ExitCode)
    $targetHashOut = Get-SafeFileHashOrTag -FilePath $AsarTarget -ForceLocked:$SimulatedTargetLocked

    $chosenBakPath = "NONE"
    $chosenBakHash = "NONE"
    if ($ReplaceStageBak -and (Test-Path -LiteralPath $ReplaceStageBak -PathType Leaf)) {
        $chosenBakPath = $ReplaceStageBak
        $chosenBakHash = Get-SafeFileHashOrTag -FilePath $ReplaceStageBak
    } elseif ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath -PathType Leaf)) {
        $chosenBakPath = $PrevBackupPath
        $chosenBakHash = Get-SafeFileHashOrTag -FilePath $PrevBackupPath
    } elseif ((Test-Path -LiteralPath $AsarBak -PathType Leaf) -and (Test-OfficialAsarHash $AsarBakHash)) {
        $chosenBakPath = $AsarBak
        $chosenBakHash = $AsarBakHash
    }

    $unpackedBakOut = if ($UnpackedBackupDir -and (Test-Path -LiteralPath $UnpackedBackupDir -PathType Container)) { $UnpackedBackupDir } else { "NONE" }
    $yamlPostOut = Get-SafeFileHashOrTag -FilePath $UpdateYmlPath
    $retainedBuildOut = if ($TempBuildDir -and (Test-Path -LiteralPath $TempBuildDir -PathType Container)) { $TempBuildDir } else { "NONE" }

    Write-Host ("[AGM][Status] EXIT_CODE={0} RECOVERY_STATE={1} CONSISTENCY_STATE={2}" -f $ExitCode, $OverallRecoveryState, $ConsistencyState)
    Write-Host ("[AGM][Status] TARGET_ASAR_SHA256={0} BACKUP_PATH={1} BACKUP_SHA256={2}" -f $targetHashOut, $chosenBakPath, $chosenBakHash)
    Write-Host ("[AGM][Status] UNPACKED_STATE={0} UNPACKED_BACKUP_DIR={1}" -f $UnpackedSwapState, $unpackedBakOut)
    Write-Host ("[AGM][Status] YAML_PRE_EXISTS={0} YAML_PRE_SHA256={1} YAML_POST_SHA256={2} YAML_STATE={3}" -f $YamlExistedBefore, $YamlOrigHash, $yamlPostOut, $YamlRecoveryState)
    Write-Host ("[AGM][Status] RETAINED_RECOVERY_DIR={0}" -f $retainedBuildOut)
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity 2.0 便携插件底座重铸工具箱 (Hakimi Mod Kit)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "工作根目录: $RootDir" -ForegroundColor Gray
Write-Host ("[AGM][Yaml] Pre-state: exists={0}, sha256={1} ({2})" -f $YamlExistedBefore, $YamlOrigHash, $UpdateYmlPath) -ForegroundColor Gray

# 1. 核验 resources 目录、patch.js 与官方原厂备份校验（绝不覆盖已有 .bak，绝不把改装版写入 .bak）
if (!(Test-Path -LiteralPath $ResourcesDir)) {
    Write-Host "[AGM][Repatch] ERROR: 未找到 resources 目录: $ResourcesDir" -ForegroundColor Red
    Write-RollbackHint
    Write-StructuredStatus -ExitCode 1
    exit 1
}

if (!(Test-Path -LiteralPath $PatcherJs)) {
    Write-Host "[AGM][Repatch] ERROR: 未找到 patch.js: $PatcherJs" -ForegroundColor Red
    Write-RollbackHint
    Write-StructuredStatus -ExitCode 1
    exit 1
}

if (Test-Path -LiteralPath $AsarBak) {
    try {
        $AsarBakHash = Get-Sha256Upper -FilePath $AsarBak
    } catch {
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: app.asar.bak 正被其他进程占用，无法校验备份: {0}" -f $_.Exception.Message) -ForegroundColor Red
            $OverallRecoveryState = "CLEAN_NO_CHANGE"
            Write-RollbackHint
            Write-StructuredStatus -ExitCode 10
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
        Write-StructuredStatus -ExitCode 4
        exit 4
    }
    Write-Host ("[AGM][Repatch] 已校验官方原厂备份 (.bak): {0} (只读保留，绝不覆盖)" -f $AsarBakHash) -ForegroundColor Gray
} else {
    if (!(Test-Path -LiteralPath $AsarTarget)) {
        Write-Host "[AGM][Repatch] ERROR: 未找到 app.asar 或 app.asar.bak，无法继续重铸！" -ForegroundColor Red
        Write-RollbackHint
        Write-StructuredStatus -ExitCode 1
        exit 1
    }

    try {
        $OrigTargetHash = Get-Sha256Upper -FilePath $AsarTarget
        $TargetExistedBefore = $true
    } catch {
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: 目标 app.asar 正被其他进程独占锁定（文件锁冲突），无法读取以校验官方原版备份: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            Write-StructuredStatus -ExitCode 10
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
        Write-StructuredStatus -ExitCode 4
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
            $OfficialBakCreatedThisRun = $true
        }
    } catch {
        if (Test-Path -LiteralPath $bakTmp) {
            Remove-Item -LiteralPath $bakTmp -Force -ErrorAction SilentlyContinue
        }
        if (Test-LockException $_.Exception) {
            Write-Host ("[AGM][Repatch] FAILED: 创建官方 .bak 时发生文件锁冲突: {0}" -f $_.Exception.Message) -ForegroundColor Red
            Write-RollbackHint
            Write-StructuredStatus -ExitCode 10
            exit 10
        }
        Write-Host ("[AGM][Repatch] ERROR: 创建官方 app.asar.bak 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-RollbackHint
        $ec = if ($BakPolluted) { 4 } else { 1 }
        Write-StructuredStatus -ExitCode $ec
        exit $ec
    } finally {
        if (Test-Path -LiteralPath $bakTmp) {
            Remove-Item -LiteralPath $bakTmp -Force -ErrorAction SilentlyContinue
        }
    }
}

if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
    $TargetExistedBefore = $true
    if (-not $OrigTargetHash) {
        try {
            $OrigTargetHash = Get-Sha256Upper -FilePath $AsarTarget
        } catch {
            if (Test-LockException $_.Exception) {
                Write-Host ("[AGM][Repatch] FAILED: 目标 app.asar 正被其他进程独占锁定（无法读取/备份/替换）: {0}" -f $_.Exception.Message) -ForegroundColor Red
                Write-RollbackHint
                Write-StructuredStatus -ExitCode 10
                exit 10
            }
            throw
        }
    }
}

# 2. 定位 node 与 asar 工具
$NodeCmdInfo = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $NodeCmdInfo) {
    Write-Host "[AGM][Repatch] ERROR: 系统未找到 node 命令，无法执行补丁注入与语法校验。" -ForegroundColor Red
    Write-RollbackHint
    Write-StructuredStatus -ExitCode 1
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
        Write-StructuredStatus -ExitCode 1
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
    if ($OfficialBakCreatedThisRun) {
        $OverallRecoveryState = "ABORTED_PROCESS_RUNNING_BACKUP_CREATED"
        Write-Host ("[AGM][Repatch] 目标进程正在运行（含可能残留的 Sidecar 进程），未替换 app.asar；已创建可信官方备份：{0}（SHA256={1}）。请先关闭目标进程后再重试（本脚本绝不强制杀进程）。" -f $AsarBak, $AsarBakHash) -ForegroundColor Red
    } elseif (Test-Path -LiteralPath $AsarBak -PathType Leaf) {
        $OverallRecoveryState = "ABORTED_PROCESS_RUNNING"
        Write-Host ("[AGM][Repatch] 目标进程正在运行（含可能残留的 Sidecar 进程），未替换 app.asar；已保留既有可信官方备份：{0}（SHA256={1}）。请先关闭目标进程后再重试（本脚本绝不强制杀进程）。" -f $AsarBak, $AsarBakHash) -ForegroundColor Red
    } else {
        $OverallRecoveryState = "ABORTED_PROCESS_RUNNING"
        Write-Host "[AGM][Repatch] 目标进程正在运行（含可能残留的 Sidecar 进程），未替换 app.asar。请先关闭目标进程后再重试（本脚本绝不强制杀进程）。" -ForegroundColor Red
    }
    Write-RollbackHint
    Write-StructuredStatus -ExitCode 3
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
$YamlBackupPath = Join-Path $TempBuildDir "app-update.yml.orig_bak"
$YamlInputForPatch = Join-Path $TempBuildDir "app-update.yml.input"
$YamlStagedTarget = Join-Path $TempBuildDir "app-update.yml.staged"
$YamlReplaceStageBak = Join-Path $TempBuildDir "app-update.yml.replace_bak"
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
$ReplaceAttempted = $false
$AsarReplaced = $false
$KeepTempBuildDirOnCleanup = $false
$KeepPrevBackup = $false
$TargetUnpacked = Join-Path $ResourcesDir "app.asar.unpacked"
$TempUnpacked = Join-Path $TempBuildDir "app.asar.unpacked"
$UnpackedBackupDir = Join-Path $TempBuildDir "app.asar.unpacked.orig_bak"

try {
    if (Test-Path -LiteralPath $TempSrc) {
        Remove-DirRobust -DirPath $TempSrc
    }
    New-Item -ItemType Directory -Path $TempBuildDir -Force | Out-Null

    # 3.0 准备 app-update.yml 暂存备份与暂存输入（绝不在 ASAR 校验及替换前修改活动 app-update.yml）
    if ($YamlExistedBefore) {
        Copy-Item -LiteralPath $UpdateYmlPath -Destination $YamlBackupPath -Force
        $bakYamlHash = Get-Sha256Upper -FilePath $YamlBackupPath
        if ($bakYamlHash -ne $YamlOrigHash) {
            $FailExitCode = 8
            throw ("app-update.yml backup SHA256 mismatch (expected={0}, actual={1})" -f $YamlOrigHash, $bakYamlHash)
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($StagedUpdateYmlPath) -and (Test-Path -LiteralPath $StagedUpdateYmlPath -PathType Leaf)) {
        Copy-Item -LiteralPath $StagedUpdateYmlPath -Destination $YamlInputForPatch -Force
    } elseif ($YamlExistedBefore) {
        Copy-Item -LiteralPath $UpdateYmlPath -Destination $YamlInputForPatch -Force
    } elseif (Test-Path -LiteralPath $TemplateYmlInModKit -PathType Leaf) {
        Copy-Item -LiteralPath $TemplateYmlInModKit -Destination $YamlInputForPatch -Force
    } else {
        [System.IO.File]::WriteAllText($YamlInputForPatch, $DefaultUpdateYmlContent, (New-Object System.Text.UTF8Encoding($false)))
    }

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

    # 4. 调用精准 JS Patcher 注入（使用 --update-yml-out 写入暂存 YAML，不触碰活动 app-update.yml）
    Write-Host "正在执行安全补丁注入与语法校验..." -ForegroundColor Yellow
    $patchRes = Invoke-NativeTool -FilePath $NodeToolPath -Arguments @($PatcherJs, $TempSrc, "--update-yml", $YamlInputForPatch, "--update-yml-out", $YamlStagedTarget)
    if ($patchRes.ExitCode -ne 0) {
        $FailExitCode = 2
        throw ("[AGM] patch.js failed (exit {0}): update lock / sidecar reaper / Hakimi anchors not injected. app.asar was not touched; build stopped." -f $patchRes.ExitCode)
    }
    if (!(Test-Path -LiteralPath $YamlStagedTarget -PathType Leaf)) {
        $FailExitCode = 2
        throw ("Staged app-update.yml missing after patch.js: {0}" -f $YamlStagedTarget)
    }
    $YamlStagedHash = Get-Sha256Upper -FilePath $YamlStagedTarget

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

        $ReplaceAttempted = $true
        try {
            if (Test-FaultInject "replace_partial_fail") {
                # 模拟替换期间发生部分写入破坏且抛出 IOException（此时 ReplaceStageBak 尚未生成，需依靠 PrevBackupPath 安全恢复）
                [System.IO.File]::WriteAllText($AsarTarget, "CORRUPTED_PARTIAL_WRITE_DURING_REPLACE", (New-Object System.Text.UTF8Encoding($false)))
                throw [System.IO.IOException]::new("Simulated partial failure during File.Replace")
            }
            if (Test-FaultInject "replace_throw_target_unreadable") {
                $SimulatedTargetLocked = $true
                throw [System.IO.IOException]::new("Simulated File.Replace error with locked unreadable target (being used by another process)")
            }

            [System.IO.File]::Replace($TempAsar, $AsarTarget, $ReplaceStageBak, $true)
            $AsarReplaced = $true
        } catch {
            if (Test-LockException $_.Exception) {
                $FailExitCode = 10
                throw ("原子替换抛出异常（禁止仅凭异常类型推断目标未改，待核验目标与备份完整性）: {0}" -f $_.Exception.Message)
            }
            $FailExitCode = 9
            throw ("System.IO.File.Replace failed: {0}" -f $_.Exception.Message)
        }
    } else {
        $ReplaceAttempted = $true
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

    if (Test-FaultInject "post_replace_target_locked") {
        $SimulatedTargetLocked = $true
        $FailExitCode = 10
        throw [System.IO.IOException]::new("Simulated target locked immediately after File.Replace (being used by another process)")
    }

    $FinalTargetHash = Get-Sha256Upper -FilePath $AsarTarget
    if ($FinalTargetHash -ne $TempAsarHash) {
        $FailExitCode = 9
        throw ("Post-replace SHA256 mismatch! expected={0}, actual={1}" -f $TempAsarHash, $FinalTargetHash)
    }

    if (Test-FaultInject "post_replace_exception") {
        $FailExitCode = 9
        throw [System.InvalidOperationException]::new("Simulated exception immediately after File.Replace succeeded and verified")
    }

    # 6.1 若暂存区生成了 app.asar.unpacked，同样采用显式状态机 + 目录重命名，失败则自动恢复原 unpacked 与原 app.asar
    if (Test-Path -LiteralPath $TempUnpacked -PathType Container) {
        Set-UnpackedState "NOT_STARTED"
        if (Test-Path -LiteralPath $TargetUnpacked -PathType Container) {
            try {
                if (Test-FaultInject "unpacked_first_move_fail") {
                    throw [System.InvalidOperationException]::new("Simulated first directory move failure (TargetUnpacked -> UnpackedBackupDir)")
                }
                [System.IO.Directory]::Move($TargetUnpacked, $UnpackedBackupDir)
                Set-UnpackedState "ORIG_MOVED_TO_BACKUP"
            } catch {
                Set-UnpackedState "BACKUP_MOVE_FAILED"
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                    throw ("无法替换 app.asar.unpacked（目录内文件正被占用，正在回滚 app.asar）: {0}" -f $_.Exception.Message)
                }
                $FailExitCode = 9
                throw ("Backing up existing app.asar.unpacked failed: {0}" -f $_.Exception.Message)
            }

            try {
                if (Test-FaultInject "unpacked_second_move_fail") {
                    throw [System.InvalidOperationException]::new("Simulated second directory move failure (TempUnpacked -> TargetUnpacked)")
                }
                [System.IO.Directory]::Move($TempUnpacked, $TargetUnpacked)
                Set-UnpackedState "NEW_MOVED_IN"
            } catch {
                Set-UnpackedState "NEW_MOVE_FAILED"
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                } else {
                    $FailExitCode = 9
                }
                throw ("Moving staged app.asar.unpacked into place failed: {0}" -f $_.Exception.Message)
            }
        } else {
            try {
                if (Test-FaultInject "unpacked_second_move_fail") {
                    throw [System.InvalidOperationException]::new("Simulated directory move failure (TempUnpacked -> TargetUnpacked)")
                }
                [System.IO.Directory]::Move($TempUnpacked, $TargetUnpacked)
                Set-UnpackedState "NEW_CREATED"
            } catch {
                Set-UnpackedState "NEW_MOVE_FAILED"
                if (Test-LockException $_.Exception) {
                    $FailExitCode = 10
                } else {
                    $FailExitCode = 9
                }
                throw ("Moving new app.asar.unpacked into place failed: {0}" -f $_.Exception.Message)
            }
        }

        # 后置校验新目录
        if (Test-FaultInject "unpacked_post_verify_fail") {
            $FailExitCode = 9
            throw [System.InvalidOperationException]::new("Simulated post-swap verification failure on new app.asar.unpacked")
        }
        if (!(Test-Path -LiteralPath $TargetUnpacked -PathType Container)) {
            $FailExitCode = 9
            throw ("Post-swap verification failed: app.asar.unpacked missing at {0}" -f $TargetUnpacked)
        }
        $unpackedFiles = @(Get-ChildItem -LiteralPath $TargetUnpacked -Recurse -File -ErrorAction Stop)
        if ($unpackedFiles.Count -le 0) {
            $FailExitCode = 9
            throw ("Post-swap verification failed: app.asar.unpacked is empty at {0}" -f $TargetUnpacked)
        }
        Set-UnpackedState "VERIFIED_NEW"
    }

    # 6.2 在 ASAR 与 unpacked 全部完成校验后再原子提交 app-update.yml（已符合目标配置时不作无意义写入）
    if ($YamlExistedBefore -and ($YamlStagedHash -eq $YamlOrigHash)) {
        $YamlRecoveryState = "UNCHANGED_ALREADY_CONFORMANT"
        Write-Host ("[AGM][Yaml] app-update.yml 已符合锁定配置，跳过无意义写入 (SHA256={0})" -f $YamlOrigHash) -ForegroundColor Gray
    } else {
        $yamlCommitTmp = Join-Path $TempBuildDir "app-update.yml.commit_tmp"
        Copy-Item -LiteralPath $YamlStagedTarget -Destination $yamlCommitTmp -Force
        $yamlCommitTmpHash = Get-Sha256Upper -FilePath $yamlCommitTmp
        if ($yamlCommitTmpHash -ne $YamlStagedHash) {
            $FailExitCode = 8
            throw ("Staged app-update.yml commit temp hash mismatch (expected={0}, actual={1})" -f $YamlStagedHash, $yamlCommitTmpHash)
        }
        $YamlCommitAttempted = $true
        try {
            if (Test-FaultInject "yaml_write_partial_fail") {
                [System.IO.File]::WriteAllText($UpdateYmlPath, "PARTIAL_CORRUPT_YAML_DURING_WRITE`n", (New-Object System.Text.UTF8Encoding($false)))
                throw [System.InvalidOperationException]::new("Simulated partial failure while committing app-update.yml")
            }
            if (Test-FaultInject "yaml_write_fail") {
                throw [System.InvalidOperationException]::new("Simulated write failure while committing app-update.yml")
            }
            if (Test-Path -LiteralPath $UpdateYmlPath -PathType Leaf) {
                [System.IO.File]::Replace($yamlCommitTmp, $UpdateYmlPath, $YamlReplaceStageBak, $true)
                $YamlRecoveryState = "UPDATED_ATOMICALLY"
            } else {
                [System.IO.File]::Move($yamlCommitTmp, $UpdateYmlPath)
                $YamlRecoveryState = "CREATED_ATOMICALLY"
            }
        } catch {
            if (Test-LockException $_.Exception) {
                $FailExitCode = 10
            } else {
                $FailExitCode = 12
            }
            throw ("Committing app-update.yml failed: {0}" -f $_.Exception.Message)
        }

        $yamlPostHash = Get-Sha256Upper -FilePath $UpdateYmlPath
        if ($yamlPostHash -ne $YamlStagedHash) {
            $FailExitCode = 12
            throw ("Post-commit app-update.yml SHA256 mismatch (expected={0}, actual={1})" -f $YamlStagedHash, $yamlPostHash)
        }
        Write-Host ("[AGM][Yaml] app-update.yml 事务提交成功 ({0}, SHA256={1})" -f $YamlRecoveryState, $yamlPostHash) -ForegroundColor Gray
    }

    $ConsistencyState = "CONSISTENT_NEW"
    $OverallRecoveryState = "SUCCESS"
    $Succeeded = $true
} catch {
    if (($FailExitCode -eq 1) -and (Test-LockException $_.Exception)) {
        $FailExitCode = 10
    }
    Write-Host ("[AGM][Repatch] FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red

    # -------------------------------------------------------------------------
    # A. 回滚 app-update.yml（若本轮尝试过提交 YAML）
    # -------------------------------------------------------------------------
    if (-not $YamlCommitAttempted) {
        $YamlRecoveryState = "CLEAN_NO_CHANGE"
    } else {
        if ($YamlExistedBefore) {
            $curYamlHash = Get-SafeFileHashOrTag -FilePath $UpdateYmlPath
            if ($curYamlHash -eq $YamlOrigHash) {
                $YamlRecoveryState = "CLEAN_NO_CHANGE"
            } else {
                $yamlRestored = $false
                if ($YamlBackupPath -and (Test-Path -LiteralPath $YamlBackupPath -PathType Leaf)) {
                    $bakCheckHash = Get-SafeFileHashOrTag -FilePath $YamlBackupPath
                    if ($bakCheckHash -eq $YamlOrigHash) {
                        $yamlRestoreTmp = Join-Path $TempBuildDir "app-update.yml.restore_tmp"
                        $yamlRestoreDisplaced = Join-Path $TempBuildDir "app-update.yml.rollback_displaced"
                        try {
                            Copy-Item -LiteralPath $YamlBackupPath -Destination $yamlRestoreTmp -Force
                            if ((Get-Sha256Upper -FilePath $yamlRestoreTmp) -ne $YamlOrigHash) {
                                throw "YAML restore temp copy hash mismatch"
                            }
                            if (Test-FaultInject "yaml_restore_fail") {
                                throw [System.InvalidOperationException]::new("Simulated YAML restore failure")
                            }
                            if (Test-Path -LiteralPath $UpdateYmlPath -PathType Leaf) {
                                [System.IO.File]::Replace($yamlRestoreTmp, $UpdateYmlPath, $yamlRestoreDisplaced, $true)
                            } else {
                                [System.IO.File]::Move($yamlRestoreTmp, $UpdateYmlPath)
                            }
                            $verifiedYamlHash = Get-Sha256Upper -FilePath $UpdateYmlPath
                            if ($verifiedYamlHash -ne $YamlOrigHash) {
                                throw ("Post-restore YAML SHA256 mismatch (expected={0}, actual={1})" -f $YamlOrigHash, $verifiedYamlHash)
                            }
                            $YamlRecoveryState = "RECOVERED_AUTO"
                            $yamlRestored = $true
                            Write-Host ("[AGM][Yaml] 已从暂存备份自动恢复原 app-update.yml ({0})。" -f $YamlOrigHash) -ForegroundColor Yellow
                        } catch {
                            $YamlRecoveryState = "RESTORE_FAILED_BACKUP_RETAINED"
                            $KeepTempBuildDirOnCleanup = $true
                            if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                            Write-Host ("[AGM][Yaml] WARNING: 自动恢复 app-update.yml 失败，备份保留于 {0}: {1}" -f $YamlBackupPath, $_.Exception.Message) -ForegroundColor Red
                        }
                    } else {
                        $YamlRecoveryState = "RESTORE_FAILED_BACKUP_RETAINED"
                        $KeepTempBuildDirOnCleanup = $true
                        if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                        Write-Host ("[AGM][Yaml] WARNING: 暂存 YAML 备份哈希校验失败，保留暂存目录 {0}" -f $TempBuildDir) -ForegroundColor Red
                    }
                } else {
                    $YamlRecoveryState = "RESTORE_FAILED_BACKUP_RETAINED"
                    $KeepTempBuildDirOnCleanup = $true
                    if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                }
            }
        } else {
            # 首次安装前不存在 app-update.yml，若已写入则移除
            if (Test-Path -LiteralPath $UpdateYmlPath -PathType Leaf) {
                try {
                    if (Test-FaultInject "yaml_restore_fail") {
                        throw [System.InvalidOperationException]::new("Simulated YAML cleanup/restore failure on first install")
                    }
                    Remove-Item -LiteralPath $UpdateYmlPath -Force -ErrorAction Stop
                    if (Test-Path -LiteralPath $UpdateYmlPath) {
                        throw "app-update.yml still present after removal"
                    }
                    $YamlRecoveryState = "RECOVERED_AUTO"
                    Write-Host "[AGM][Yaml] 已清理失败安装新增的 app-update.yml，恢复初始缺失状态。" -ForegroundColor Yellow
                } catch {
                    $YamlRecoveryState = "RESTORE_FAILED_BACKUP_RETAINED"
                    $KeepTempBuildDirOnCleanup = $true
                    if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                    Write-Host ("[AGM][Yaml] WARNING: 清理失败安装新增的 app-update.yml 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
                }
            } else {
                $YamlRecoveryState = "CLEAN_NO_CHANGE"
            }
        }
    }

    # -------------------------------------------------------------------------
    # B. 回滚 app.asar.unpacked 目录（严格保留唯一旧副本直至恢复成功且验证完成）
    # -------------------------------------------------------------------------
    if ($UnpackedSwapState -in @("ORIG_MOVED_TO_BACKUP", "NEW_MOVE_FAILED", "NEW_MOVED_IN", "VERIFIED_NEW")) {
        if (Test-Path -LiteralPath $UnpackedBackupDir -PathType Container) {
            try {
                if (Test-Path -LiteralPath $TargetUnpacked -PathType Container) {
                    $discardDir = Join-Path $TempBuildDir "app.asar.unpacked.rollback_discard"
                    [System.IO.Directory]::Move($TargetUnpacked, $discardDir)
                }
                if (Test-Path -LiteralPath $TargetUnpacked) {
                    throw ("残余 app.asar.unpacked 仍存在于目标位置，无法原子移回旧目录: {0}" -f $TargetUnpacked)
                }
                if (Test-FaultInject "unpacked_restore_locked") {
                    throw [System.IO.IOException]::new("Simulated lock error restoring app.asar.unpacked (being used by another process)")
                }
                if (Test-FaultInject "unpacked_restore_fail") {
                    throw [System.InvalidOperationException]::new("Simulated directory move failure restoring app.asar.unpacked")
                }
                [System.IO.Directory]::Move($UnpackedBackupDir, $TargetUnpacked)
                if (!(Test-Path -LiteralPath $TargetUnpacked -PathType Container) -or (Test-Path -LiteralPath $UnpackedBackupDir)) {
                    throw "Post-restore verification of app.asar.unpacked failed"
                }
                Set-UnpackedState "RESTORED_ORIG"
                Write-Host "[AGM][Repatch] 已自动恢复原 app.asar.unpacked 目录。" -ForegroundColor Yellow
            } catch {
                Set-UnpackedState "RESTORE_FAILED_BACKUP_RETAINED"
                $KeepTempBuildDirOnCleanup = $true
                if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                Write-Host ("[AGM][Repatch] WARNING: 自动恢复 app.asar.unpacked 失败，旧目录备份严格保留于 {0}: {1}" -f $UnpackedBackupDir, $_.Exception.Message) -ForegroundColor Red
            }
        } else {
            Set-UnpackedState "RESTORE_FAILED_BACKUP_RETAINED"
            $KeepTempBuildDirOnCleanup = $true
            if ($FailExitCode -ne 10) { $FailExitCode = 11 }
            Write-Host ("[AGM][Repatch] WARNING: 未找到旧 app.asar.unpacked 备份目录 {0}" -f $UnpackedBackupDir) -ForegroundColor Red
        }
    } elseif ($UnpackedSwapState -eq "NEW_CREATED") {
        if (Test-Path -LiteralPath $TargetUnpacked -PathType Container) {
            try {
                Remove-DirRobust -DirPath $TargetUnpacked
                if (Test-Path -LiteralPath $TargetUnpacked) {
                    throw "Failed to remove newly created app.asar.unpacked"
                }
                Set-UnpackedState "NEW_REMOVED_ON_ROLLBACK"
            } catch {
                Set-UnpackedState "NEW_REMOVE_FAILED"
                $KeepTempBuildDirOnCleanup = $true
                Write-Host ("[AGM][Repatch] WARNING: 清理新增 app.asar.unpacked 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
            }
        } else {
            Set-UnpackedState "CLEAN_NO_CHANGE"
        }
    } elseif ($UnpackedSwapState -eq "BACKUP_MOVE_FAILED") {
        if (Test-Path -LiteralPath $TargetUnpacked -PathType Container) {
            Set-UnpackedState "CLEAN_NO_CHANGE"
        } else {
            Set-UnpackedState "RESTORE_FAILED_BACKUP_RETAINED"
            $KeepTempBuildDirOnCleanup = $true
        }
    }

    # -------------------------------------------------------------------------
    # C. 核验目标 app.asar 状态与备份完整性，绝不凭异常类型误判，绝不先删恢复材料
    # -------------------------------------------------------------------------
    $stageBakValid = $false
    if ($ReplaceStageBak -and (Test-Path -LiteralPath $ReplaceStageBak -PathType Leaf) -and $OrigTargetHash) {
        $sbHash = Get-SafeFileHashOrTag -FilePath $ReplaceStageBak
        if ($sbHash -eq $OrigTargetHash) {
            $stageBakValid = $true
        }
    }
    $prevBakValid = $false
    if ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath -PathType Leaf) -and $OrigTargetHash) {
        $pbHash = Get-SafeFileHashOrTag -FilePath $PrevBackupPath
        if ($pbHash -eq $OrigTargetHash) {
            $prevBakValid = $true
        }
    }

    if (-not $TargetExistedBefore) {
        if (!(Test-Path -LiteralPath $AsarTarget)) {
            $AsarRecoveryState = "CLEAN_NO_CHANGE"
        } else {
            try {
                Remove-Item -LiteralPath $AsarTarget -Force -ErrorAction Stop
                $AsarRecoveryState = "RECOVERED_AUTO"
            } catch {
                $AsarRecoveryState = if (Test-LockException $_.Exception) { "UNKNOWN/NEEDS_RECOVERY" } else { "FAILED_NEEDS_MANUAL_RECOVERY" }
                $KeepTempBuildDirOnCleanup = $true
            }
        }
    } else {
        $targetCheckError = $null
        $targetExistsNow = $false
        $curTargetHash = $null
        try {
            if ($SimulatedTargetLocked) {
                throw [System.IO.IOException]::new("Simulated lock prevents verifying target app.asar hash (being used by another process)")
            }
            $targetExistsNow = Test-Path -LiteralPath $AsarTarget -PathType Leaf
            if ($targetExistsNow) {
                $curTargetHash = Get-Sha256Upper -FilePath $AsarTarget
            }
        } catch {
            $targetCheckError = $_.Exception
        }

        if ($null -ne $targetCheckError) {
            # 目标在磁盘状态无法确认或正被锁定：绝不能断言原文件未发生变化，绝不删除任何可信恢复材料！
            $AsarRecoveryState = "UNKNOWN/NEEDS_RECOVERY"
            $KeepTempBuildDirOnCleanup = $true
            $KeepPrevBackup = $true
            Write-Host ("[AGM][Repatch] CRITICAL: 目标 app.asar 状态无法确认或正被锁定 ({0})；已保留全部可信恢复材料，状态标记为 UNKNOWN/NEEDS_RECOVERY。" -f $targetCheckError.Message) -ForegroundColor Red
        } elseif ($targetExistsNow -and ($curTargetHash -eq $OrigTargetHash)) {
            $AsarRecoveryState = "CLEAN_NO_CHANGE"
            Write-Host ("[AGM][Repatch] 已实测校验目标 app.asar 与替换前 SHA256 一致 ({0})。" -f $curTargetHash) -ForegroundColor Gray
            # 仅在确认未发生替换且已实测证实目标哈希完全一致时，才清理未使用的前置快照
            if ((-not $AsarReplaced) -and (-not $KeepPrevBackup) -and $PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath)) {
                Remove-Item -LiteralPath $PrevBackupPath -Force -ErrorAction SilentlyContinue
                $PrevBackupPath = $null
            }
        } else {
            # 目标缺失或哈希与替换前不一致 -> 必须通过原子方式安全回滚并二次校验 SHA256
            $restoredOk = $false
            $rollbackCandidates = @()
            if ($stageBakValid) {
                $rollbackCandidates += [pscustomobject]@{ Tag = "stage_bak"; Path = $ReplaceStageBak }
            }
            if ($prevBakValid) {
                $rollbackCandidates += [pscustomobject]@{ Tag = "prev_bak"; Path = $PrevBackupPath }
            }

            foreach ($cand in $rollbackCandidates) {
                if ($restoredOk) { break }
                $restoreTmp = Join-Path $TempBuildDir ("app.asar.restore_tmp_" + $cand.Tag)
                $rollbackDisplaced = Join-Path $TempBuildDir ("app.asar.rollback_displaced_" + $cand.Tag)
                try {
                    Copy-Item -LiteralPath $cand.Path -Destination $restoreTmp -Force
                    $tmpHash = Get-Sha256Upper -FilePath $restoreTmp
                    if ($tmpHash -ne $OrigTargetHash) {
                        throw ("Restore temp SHA256 mismatch (expected={0}, actual={1})" -f $OrigTargetHash, $tmpHash)
                    }
                    if (Test-FaultInject "rollback_asar_fail") {
                        throw [System.IO.IOException]::new("Simulated rollback atomic replace failure")
                    }
                    if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
                        [System.IO.File]::Replace($restoreTmp, $AsarTarget, $rollbackDisplaced, $true)
                    } else {
                        [System.IO.File]::Move($restoreTmp, $AsarTarget)
                    }
                    $postRollbackHash = Get-Sha256Upper -FilePath $AsarTarget
                    if ($postRollbackHash -ne $OrigTargetHash) {
                        throw ("Post-rollback SHA256 mismatch (expected={0}, actual={1})" -f $OrigTargetHash, $postRollbackHash)
                    }
                    if ($cand.Tag -eq "stage_bak") {
                        Write-Host ("[AGM][Repatch] 已通过同卷安全备份自动恢复原 app.asar ({0})。" -f $OrigTargetHash) -ForegroundColor Yellow
                    } else {
                        Write-Host ("[AGM][Repatch] 已从 {0} 原子恢复原 app.asar ({1})。" -f $cand.Path, $OrigTargetHash) -ForegroundColor Yellow
                    }
                    $AsarRecoveryState = "RECOVERED_AUTO"
                    $restoredOk = $true
                } catch {
                    Write-Host ("[AGM][Repatch] WARNING: 使用 {0} ({1}) 原子恢复 app.asar 失败: {2}" -f $cand.Tag, $cand.Path, $_.Exception.Message) -ForegroundColor Yellow
                } finally {
                    if (Test-Path -LiteralPath $restoreTmp) {
                        Remove-Item -LiteralPath $restoreTmp -Force -ErrorAction SilentlyContinue
                    }
                }
            }

            if (-not $restoredOk) {
                $AsarRecoveryState = "FAILED_NEEDS_MANUAL_RECOVERY"
                $KeepTempBuildDirOnCleanup = $true
                $KeepPrevBackup = $true
                if ($FailExitCode -ne 10) { $FailExitCode = 11 }
                Write-Host "[AGM][Repatch] CRITICAL: 自动回滚 app.asar 失败！已严格保留全部唯一可用恢复备份，需要人工介入。" -ForegroundColor Red
            }
        }
    }

    # -------------------------------------------------------------------------
    # D. 综合一致性与最终恢复状态判定
    # -------------------------------------------------------------------------
    $asarOk = $AsarRecoveryState -in @("NOT_STARTED", "CLEAN_NO_CHANGE", "RECOVERED_AUTO")
    $unpackedOk = $UnpackedSwapState -in @("NOT_APPLICABLE", "NOT_STARTED", "CLEAN_NO_CHANGE", "RESTORED_ORIG", "NEW_REMOVED_ON_ROLLBACK")
    $yamlOk = $YamlRecoveryState -in @("NOT_MODIFIED", "CLEAN_NO_CHANGE", "RECOVERED_AUTO")

    if ($AsarRecoveryState -eq "UNKNOWN/NEEDS_RECOVERY") {
        $OverallRecoveryState = "UNKNOWN/NEEDS_RECOVERY"
        $ConsistencyState = "UNKNOWN_STATE"
        $KeepTempBuildDirOnCleanup = $true
        $KeepPrevBackup = $true
    } elseif ((-not $asarOk) -or (-not $unpackedOk) -or (-not $yamlOk)) {
        $OverallRecoveryState = "FAILED_NEEDS_MANUAL_RECOVERY"
        $KeepTempBuildDirOnCleanup = $true
        $KeepPrevBackup = $true
        $FailExitCode = 11
        if (-not $unpackedOk) {
            $ConsistencyState = "INCONSISTENT_ASAR_UNPACKED"
        } elseif (-not $yamlOk) {
            $ConsistencyState = "INCONSISTENT_YAML"
        } else {
            $ConsistencyState = "INCONSISTENT_ASAR"
        }
    } elseif (($AsarRecoveryState -eq "RECOVERED_AUTO") -or ($UnpackedSwapState -in @("RESTORED_ORIG", "NEW_REMOVED_ON_ROLLBACK")) -or ($YamlRecoveryState -eq "RECOVERED_AUTO")) {
        $OverallRecoveryState = "RECOVERED_AUTO"
        $ConsistencyState = "CONSISTENT_ORIG"
    } else {
        $OverallRecoveryState = "CLEAN_NO_CHANGE"
        $ConsistencyState = "CONSISTENT_ORIG"
    }

    if (Test-Path -LiteralPath $AsarTarget) {
        if ($SimulatedTargetLocked) {
            Write-Host "[AGM][Repatch] 当前目标 app.asar 状态不可读取（模拟锁/占用，需要恢复核验）" -ForegroundColor Yellow
        } else {
            try {
                $keptHash = Get-Sha256Upper -FilePath $AsarTarget
                Write-Host ("[AGM][Repatch] 当前目标 app.asar SHA256: {0}" -f $keptHash) -ForegroundColor Gray
            } catch {
                $curLen = (Get-Item -LiteralPath $AsarTarget).Length
                Write-Host ("[AGM][Repatch] 当前目标 app.asar 仍在原地 (Size={0} bytes，当前正被外部进程锁定)" -f $curLen) -ForegroundColor Gray
            }
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

    # 物理不变量守卫：失败时只要暂存目录内仍有未完成恢复的唯一材料，绝对禁止删除 $TempBuildDir
    $mustRetainForUnpacked = (-not $Succeeded) -and $UnpackedBackupDir -and (Test-Path -LiteralPath $UnpackedBackupDir -PathType Container) -and ($UnpackedSwapState -ne "RESTORED_ORIG")
    $mustRetainForAsar = (-not $Succeeded) -and $ReplaceStageBak -and (Test-Path -LiteralPath $ReplaceStageBak -PathType Leaf) -and ($AsarRecoveryState -notin @("NOT_STARTED", "CLEAN_NO_CHANGE", "RECOVERED_AUTO"))
    $mustRetainForYaml = (-not $Succeeded) -and $YamlBackupPath -and (Test-Path -LiteralPath $YamlBackupPath -PathType Leaf) -and ($YamlRecoveryState -notin @("NOT_MODIFIED", "CLEAN_NO_CHANGE", "RECOVERED_AUTO", "UNCHANGED_ALREADY_CONFORMANT"))

    if ($mustRetainForUnpacked -or $mustRetainForAsar -or $mustRetainForYaml) {
        $KeepTempBuildDirOnCleanup = $true
    }

    if ((-not $KeepTempBuildDirOnCleanup) -and $TempBuildDir -and (Test-Path -LiteralPath $TempBuildDir)) {
        Remove-DirRobust -DirPath $TempBuildDir
    } elseif ($KeepTempBuildDirOnCleanup -and $TempBuildDir -and (Test-Path -LiteralPath $TempBuildDir)) {
        Write-Host ("[AGM][Repatch] RETAINED_TEMP_DIR: 已严格保留恢复暂存目录 {0}" -f $TempBuildDir) -ForegroundColor Yellow
    }
}

if (-not $Succeeded) {
    Write-StructuredStatus -ExitCode $FailExitCode
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
Write-StructuredStatus -ExitCode 0
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
