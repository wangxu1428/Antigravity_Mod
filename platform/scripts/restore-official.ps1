# =============================================================================
# Antigravity Mod (AGM) 官方纯净底座安全还原脚本
# platform/scripts/restore-official.ps1
#
# 核心安全准则：
# 1. 彻底杜绝 $D / $d 等单字母大小写混用变量名（全部采用语义化长变量名）。
# 2. 默认 100% 保留 UserData\ 与 plugins\{config.json,state,packages} 用户数据，绝不删除。
# 3. 严禁无差别杀进程；若检测到目标目录下有进程运行，立即以 exit 3 安全中止。
# 4. 严格校验 app.asar.bak 属于官方原版白名单，绝不拿被污染的 .bak 执行还原。
# 5. 采用同卷暂存 + [System.IO.File]::Replace 原子替换，替换失败或后置校验不一致时
#    先核验目标状态与恢复材料完整性，再原子安全回滚并二次校验；绝不在状态未确认前删除唯一恢复材料。
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [string]$TargetAppDir = $env:AGM_ROOT,

    [Parameter(Mandatory = $false)]
    [switch]$VerifyOnly,

    [Parameter(Mandatory = $false)]
    [string[]]$OfficialAsarHashes = @()
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($TargetAppDir)) {
    $TargetAppDir = 'C:\Antigravity_Mod'
}
$TargetAppDir = [System.IO.Path]::GetFullPath($TargetAppDir).TrimEnd('\')

$ResourcesDir = Join-Path $TargetAppDir 'resources'
$AsarBackupPath = Join-Path $ResourcesDir 'app.asar.bak'
$AsarActivePath = Join-Path $ResourcesDir 'app.asar'

$KnownOfficialAsarHashes = @(
    '5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F' # Antigravity 2.32.1 official clean app.asar (resources/app.asar.bak); 98A4308C is current app.asar with preloaded AGY_ZH_ENGINE, not official
)

$AllowedOfficialHashes = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($knownHash in $KnownOfficialAsarHashes) {
    if (-not [string]::IsNullOrWhiteSpace($knownHash)) {
        [void]$AllowedOfficialHashes.Add($knownHash.Trim().ToUpperInvariant())
    }
}

$ExtraOfficialHashes = @()
if ($OfficialAsarHashes) {
    $ExtraOfficialHashes += $OfficialAsarHashes
}
if (-not [string]::IsNullOrWhiteSpace($env:AGM_OFFICIAL_ASAR_SHA256)) {
    $ExtraOfficialHashes += ($env:AGM_OFFICIAL_ASAR_SHA256 -split '[,;\s]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
foreach ($extraHash in $ExtraOfficialHashes) {
    $normalizedExtra = $extraHash.Trim().ToUpperInvariant()
    if ($normalizedExtra -notmatch '^[0-9A-F]{64}$') {
        Write-Host ("[AGM][Restore] ERROR: 非法的官方 SHA256 白名单哈希格式: {0}" -f $extraHash) -ForegroundColor Red
        Write-Host "[AGM][Status] EXIT_CODE=1 RECOVERY_STATE=CLEAN_NO_CHANGE"
        exit 1
    }
    [void]$AllowedOfficialHashes.Add($normalizedExtra)
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
        return 'LOCKED'
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or !(Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return 'MISSING'
    }
    try {
        return (Get-Sha256Upper -FilePath $FilePath)
    } catch {
        if (Test-LockException $_.Exception) {
            return 'LOCKED'
        }
        return 'UNREADABLE'
    }
}

function Remove-DirSafe {
    param([string]$DirPath)
    if ([string]::IsNullOrWhiteSpace($DirPath) -or !(Test-Path -LiteralPath $DirPath)) {
        return
    }
    try {
        Remove-Item -LiteralPath $DirPath -Recurse -Force -ErrorAction Stop
    } catch {
        $longPrefixed = "\\?\" + [System.IO.Path]::GetFullPath($DirPath)
        $null = & cmd.exe /c ("rd /s /q `"{0}`"" -f $longPrefixed) 2>$null
    }
}

$RecoveryState = 'CLEAN_NO_CHANGE'
$RestoreStageDir = $null
$RestoreReplaceBak = $null
$ArchivedAsarPath = $null
$BackupHash = 'NONE'
$SimulatedTargetLocked = $false

function Write-RestoreStatus {
    param([int]$ExitCode)
    $targetHashOut = Get-SafeFileHashOrTag -FilePath $AsarActivePath -ForceLocked:$SimulatedTargetLocked
    $retainedStageOut = if ($RestoreStageDir -and (Test-Path -LiteralPath $RestoreStageDir -PathType Container)) { $RestoreStageDir } else { 'NONE' }

    $chosenRestoreBakPath = 'NONE'
    $chosenRestoreBakHash = 'NONE'
    if ($RestoreReplaceBak -and (Test-Path -LiteralPath $RestoreReplaceBak -PathType Leaf)) {
        $chosenRestoreBakPath = $RestoreReplaceBak
        $chosenRestoreBakHash = Get-SafeFileHashOrTag -FilePath $RestoreReplaceBak
    } elseif ($ArchivedAsarPath -and (Test-Path -LiteralPath $ArchivedAsarPath -PathType Leaf)) {
        $chosenRestoreBakPath = $ArchivedAsarPath
        $chosenRestoreBakHash = Get-SafeFileHashOrTag -FilePath $ArchivedAsarPath
    } elseif ($AsarBackupPath -and (Test-Path -LiteralPath $AsarBackupPath -PathType Leaf)) {
        $chosenRestoreBakPath = $AsarBackupPath
        $chosenRestoreBakHash = Get-SafeFileHashOrTag -FilePath $AsarBackupPath
    }

    Write-Host ("[AGM][Status] EXIT_CODE={0} RECOVERY_STATE={1}" -f $ExitCode, $RecoveryState)
    Write-Host ("[AGM][Status] TARGET_ASAR_SHA256={0} BACKUP_PATH={1} BACKUP_SHA256={2} OFFICIAL_BAK_SHA256={3}" -f $targetHashOut, $chosenRestoreBakPath, $chosenRestoreBakHash, $BackupHash)
    Write-Host ("[AGM][Status] ARCHIVED_MOD_PATH={0} RETAINED_RECOVERY_DIR={1}" -f ($(if ($ArchivedAsarPath) { $ArchivedAsarPath } else { 'NONE' }), $retainedStageOut))
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod (AGM) 官方原版 app.asar 安全还原工具" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "目标应用目录: $TargetAppDir" -ForegroundColor Gray

if (!(Test-Path -LiteralPath $AsarBackupPath)) {
    Write-Host "[AGM][Restore] ERROR: 未找到官方纯净备份文件: $AsarBackupPath ，无法执行还原！" -ForegroundColor Red
    Write-RestoreStatus -ExitCode 2
    exit 2
}

$BackupHash = Get-Sha256Upper -FilePath $AsarBackupPath
$ActiveExistedBefore = (Test-Path -LiteralPath $AsarActivePath -PathType Leaf)
$ActiveHash = 'MISSING'
if ($ActiveExistedBefore) {
    try {
        $ActiveHash = Get-Sha256Upper -FilePath $AsarActivePath
    } catch {
        if (Test-LockException $_.Exception) {
            $ActiveHash = 'LOCKED'
        } else {
            throw
        }
    }
}

Write-Host "app.asar.bak SHA256 : $BackupHash" -ForegroundColor Gray
Write-Host "app.asar     SHA256 : $ActiveHash" -ForegroundColor Gray

if (-not (Test-OfficialAsarHash $BackupHash)) {
    $AllowedDisplay = (@($AllowedOfficialHashes) | Sort-Object) -join ', '
    Write-Host "[AGM][Restore] ALARM: 检测到 app.asar.bak 已被污染，不是官方原版！" -ForegroundColor Red
    Write-Host ("  - .bak 路径     : {0}" -f $AsarBackupPath) -ForegroundColor Red
    Write-Host ("  - 实际 SHA256   : {0}" -f $BackupHash) -ForegroundColor Red
    Write-Host ("  - 期望官方白名单: {0}" -f $AllowedDisplay) -ForegroundColor Yellow
    Write-Host "  - 拒绝原因      : 严禁拿已被污染或来源不明的 .bak 执行还原，目标 app.asar 未作任何修改。请从官方安装包重新获取纯净 app.asar.bak。" -ForegroundColor Yellow
    Write-RestoreStatus -ExitCode 4
    exit 4
}

if ($VerifyOnly) {
    Write-Host "[VerifyOnly] 备份文件通过官方白名单校验且完整可读，未做任何写入改动。" -ForegroundColor Green
    $RecoveryState = 'SUCCESS'
    Write-RestoreStatus -ExitCode 0
    exit 0
}

# 检查目标目录下是否有正在运行的进程（绝不杀进程）
$NormalizedPrefix = $TargetAppDir + '\'
$RunningProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($NormalizedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
})
if ($RunningProcesses.Count -gt 0) {
    foreach ($proc in $RunningProcesses) {
        Write-Host ("  [运行中进程] PID {0} : {1}" -f $proc.ProcessId, $proc.ExecutablePath) -ForegroundColor Red
    }
    $RecoveryState = 'ABORTED_PROCESS_RUNNING'
    if (Test-Path -LiteralPath $AsarBackupPath -PathType Leaf) {
        Write-Host ("[AGM][Restore] 目标进程正在运行，未替换 app.asar；已保留既有可信官方备份：{0}（SHA256={1}）。请先关闭客户端后再还原（本脚本绝不强制杀进程）。" -f $AsarBackupPath, $BackupHash) -ForegroundColor Red
    } else {
        Write-Host "[AGM][Restore] 目标进程正在运行，未替换 app.asar。请先关闭客户端后再还原（本脚本绝不强制杀进程）。" -ForegroundColor Red
    }
    Write-RestoreStatus -ExitCode 3
    exit 3
}

if ($ActiveHash -eq 'LOCKED') {
    Write-Host "[AGM][Restore] FAILED: 目标 app.asar 正被其他进程独占锁定，无法执行还原。" -ForegroundColor Red
    Write-RestoreStatus -ExitCode 10
    exit 10
}

# 归档当前重铸版 app.asar 并使用同卷暂存 + File.Replace 原子还原官方 app.asar.bak
$TimestampTag = Get-Date -Format 'yyyyMMdd_HHmmss'
$UniqueSuffix = $TimestampTag + '_' + (Get-Date -Format 'fff')
$DisplacedArchiveDir = Join-Path $TargetAppDir ("displaced_mod_" + $TimestampTag)
if (Test-Path -LiteralPath $DisplacedArchiveDir) {
    $DisplacedArchiveDir = Join-Path $TargetAppDir ("displaced_mod_" + $UniqueSuffix)
}
$RestoreStageDir = Join-Path $ResourcesDir (".agm_restore_tmp_" + $UniqueSuffix)
$RestoredStagePath = Join-Path $RestoreStageDir 'app.asar.official_stage'
$RestoreReplaceBak = Join-Path $RestoreStageDir 'app.asar.replace_bak'

$Succeeded = $false
$FailExitCode = 1
$ReplaceAttempted = $false
$KeepRestoreStageDir = $false

try {
    New-Item -ItemType Directory -Force -Path $RestoreStageDir | Out-Null
    Copy-Item -LiteralPath $AsarBackupPath -Destination $RestoredStagePath -Force
    $StagedHash = Get-Sha256Upper -FilePath $RestoredStagePath
    if ($StagedHash -ne $BackupHash) {
        $FailExitCode = 4
        throw ("暂存还原文件 SHA256 校验失败（期望: {0}，实际: {1}）" -f $BackupHash, $StagedHash)
    }

    if ($ActiveExistedBefore) {
        New-Item -ItemType Directory -Force -Path $DisplacedArchiveDir | Out-Null
        $ArchivedAsarPath = Join-Path $DisplacedArchiveDir 'app.asar.mod_patched'
        Copy-Item -LiteralPath $AsarActivePath -Destination $ArchivedAsarPath -Force
        $ArchivedHash = Get-Sha256Upper -FilePath $ArchivedAsarPath
        if ($ArchivedHash -ne $ActiveHash) {
            $FailExitCode = 8
            throw ("归档替换前 app.asar SHA256 校验失败（期望: {0}，实际: {1}）" -f $ActiveHash, $ArchivedHash)
        }
    }

    $ReplaceAttempted = $true
    if ($ActiveExistedBefore) {
        if (Test-FaultInject 'restore_replace_partial_fail') {
            [System.IO.File]::WriteAllText($AsarActivePath, 'CORRUPTED_PARTIAL_WRITE_DURING_RESTORE', (New-Object System.Text.UTF8Encoding($false)))
            throw [System.IO.IOException]::new('Simulated partial failure during restore File.Replace')
        }
        [System.IO.File]::Replace($RestoredStagePath, $AsarActivePath, $RestoreReplaceBak, $true)
    } else {
        [System.IO.File]::Move($RestoredStagePath, $AsarActivePath)
    }

    if (Test-FaultInject 'restore_post_target_locked') {
        $SimulatedTargetLocked = $true
        $FailExitCode = 10
        throw [System.IO.IOException]::new('Simulated target locked immediately after restore File.Replace (being used by another process)')
    }

    if (Test-FaultInject 'restore_post_hash_mismatch') {
        [System.IO.File]::WriteAllText($AsarActivePath, 'CORRUPTED_POST_RESTORE_HASH_MISMATCH', (New-Object System.Text.UTF8Encoding($false)))
    }

    $RestoredHash = Get-Sha256Upper -FilePath $AsarActivePath
    if ($RestoredHash -ne $BackupHash) {
        $FailExitCode = 4
        throw ("还原后 SHA256 校验不一致！（期望: {0}，实际: {1}）" -f $BackupHash, $RestoredHash)
    }

    $RecoveryState = 'SUCCESS'
    $Succeeded = $true
} catch {
    if (($FailExitCode -eq 1) -and (Test-LockException $_.Exception)) {
        $FailExitCode = 10
    }
    Write-Host ("[AGM][Restore] FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red

    if (-not $ActiveExistedBefore) {
        if (!(Test-Path -LiteralPath $AsarActivePath)) {
            $RecoveryState = 'CLEAN_NO_CHANGE'
        } else {
            try {
                Remove-Item -LiteralPath $AsarActivePath -Force -ErrorAction Stop
                $RecoveryState = 'RECOVERED_AUTO'
            } catch {
                $RecoveryState = if (Test-LockException $_.Exception) { 'UNKNOWN/NEEDS_RECOVERY' } else { 'FAILED_NEEDS_MANUAL_RECOVERY' }
                $KeepRestoreStageDir = $true
            }
        }
    } else {
        # 核验可用恢复材料完整性（不删除任何有效恢复材料）
        $stageBakValid = $false
        if ($RestoreReplaceBak -and (Test-Path -LiteralPath $RestoreReplaceBak -PathType Leaf)) {
            if ((Get-SafeFileHashOrTag -FilePath $RestoreReplaceBak) -eq $ActiveHash) {
                $stageBakValid = $true
            }
        }
        $archivedValid = $false
        if ($ArchivedAsarPath -and (Test-Path -LiteralPath $ArchivedAsarPath -PathType Leaf)) {
            if ((Get-SafeFileHashOrTag -FilePath $ArchivedAsarPath) -eq $ActiveHash) {
                $archivedValid = $true
            }
        }

        $targetCheckError = $null
        $targetExistsNow = $false
        $curTargetHash = $null
        try {
            if ($SimulatedTargetLocked) {
                throw [System.IO.IOException]::new('Simulated lock prevents verifying target app.asar hash (being used by another process)')
            }
            $targetExistsNow = Test-Path -LiteralPath $AsarActivePath -PathType Leaf
            if ($targetExistsNow) {
                $curTargetHash = Get-Sha256Upper -FilePath $AsarActivePath
            }
        } catch {
            $targetCheckError = $_.Exception
        }

        if ($null -ne $targetCheckError) {
            $RecoveryState = 'UNKNOWN/NEEDS_RECOVERY'
            $KeepRestoreStageDir = $true
            Write-Host ("[AGM][Restore] CRITICAL: 还原后目标 app.asar 状态无法确认或正被锁定 ({0})；已保留全部恢复材料，状态为 UNKNOWN/NEEDS_RECOVERY。" -f $targetCheckError.Message) -ForegroundColor Red
            Write-Host ("  - 人工恢复官方版: [System.IO.File]::Replace(`"{0}`", `"{1}`", [NullString]::Value, `$true)" -f $AsarBackupPath, $AsarActivePath) -ForegroundColor Yellow
            if ($stageBakValid) {
                Write-Host ("  - 人工回退还原前版本 (stage_bak): {0} (SHA256={1})" -f $RestoreReplaceBak, $ActiveHash) -ForegroundColor Yellow
            }
            if ($archivedValid) {
                Write-Host ("  - 人工回退还原前版本 (archived): {0} (SHA256={1})" -f $ArchivedAsarPath, $ActiveHash) -ForegroundColor Yellow
            }
        } elseif ($targetExistsNow -and ($curTargetHash -eq $ActiveHash)) {
            $RecoveryState = 'CLEAN_NO_CHANGE'
            Write-Host ("[AGM][Restore] 已实测校验目标 app.asar 与还原前 SHA256 一致 ({0})，未破坏原文件。" -f $curTargetHash) -ForegroundColor Yellow
        } else {
            # 目标缺失或哈希异常 -> 从已校验备份原子回滚至还原前状态，并二次校验 SHA256
            $restoredBackOk = $false
            $candidates = @()
            if ($stageBakValid) {
                $candidates += [pscustomobject]@{ Tag = 'stage_bak'; Path = $RestoreReplaceBak }
            }
            if ($archivedValid) {
                $candidates += [pscustomobject]@{ Tag = 'archived'; Path = $ArchivedAsarPath }
            }

            foreach ($cand in $candidates) {
                if ($restoredBackOk) { break }
                $rollbackTmp = Join-Path $RestoreStageDir ("app.asar.rollback_tmp_" + $cand.Tag)
                $rollbackDisplaced = Join-Path $RestoreStageDir ("app.asar.rollback_displaced_" + $cand.Tag)
                try {
                    Copy-Item -LiteralPath $cand.Path -Destination $rollbackTmp -Force
                    $tmpH = Get-Sha256Upper -FilePath $rollbackTmp
                    if ($tmpH -ne $ActiveHash) {
                        throw ("Rollback temp hash mismatch (expected={0}, actual={1})" -f $ActiveHash, $tmpH)
                    }
                    if (Test-FaultInject 'restore_rollback_fail') {
                        throw [System.IO.IOException]::new('Simulated restore rollback atomic replace failure')
                    }
                    if (Test-Path -LiteralPath $AsarActivePath -PathType Leaf) {
                        [System.IO.File]::Replace($rollbackTmp, $AsarActivePath, $rollbackDisplaced, $true)
                    } else {
                        [System.IO.File]::Move($rollbackTmp, $AsarActivePath)
                    }
                    $afterBackHash = Get-Sha256Upper -FilePath $AsarActivePath
                    if ($afterBackHash -ne $ActiveHash) {
                        throw ("Post-rollback SHA256 mismatch (expected={0}, actual={1})" -f $ActiveHash, $afterBackHash)
                    }
                    $RecoveryState = 'RECOVERED_AUTO'
                    $restoredBackOk = $true
                    Write-Host ("[AGM][Restore] 已通过同卷原子替换将 app.asar 安全回滚至还原前状态 ({0})。" -f $ActiveHash) -ForegroundColor Yellow
                } catch {
                    Write-Host ("[AGM][Restore] WARNING: 使用 {0} ({1}) 原子回滚失败: {2}" -f $cand.Tag, $cand.Path, $_.Exception.Message) -ForegroundColor Yellow
                } finally {
                    if (Test-Path -LiteralPath $rollbackTmp) {
                        Remove-Item -LiteralPath $rollbackTmp -Force -ErrorAction SilentlyContinue
                    }
                }
            }

            if (-not $restoredBackOk) {
                $RecoveryState = 'FAILED_NEEDS_MANUAL_RECOVERY'
                $KeepRestoreStageDir = $true
                $FailExitCode = 11
                Write-Host "[AGM][Restore] CRITICAL: 自动安全回滚失败！已严格保留全部可用恢复备份，需要人工介入：" -ForegroundColor Red
                Write-Host ("  - 官方纯净底座 (.bak): {0} (SHA256={1})" -f $AsarBackupPath, $BackupHash) -ForegroundColor Yellow
                if ($stageBakValid) {
                    Write-Host ("  - 替换前同卷备份: {0} (SHA256={1})" -f $RestoreReplaceBak, $ActiveHash) -ForegroundColor Yellow
                }
                if ($archivedValid) {
                    Write-Host ("  - 已归档还原前版本: {0} (SHA256={1})" -f $ArchivedAsarPath, $ActiveHash) -ForegroundColor Yellow
                }
            }
        }
    }

    if ($FailExitCode -eq 0) {
        $FailExitCode = 1
    }
} finally {
    $mustRetain = (-not $Succeeded) -and ($KeepRestoreStageDir -or ($RecoveryState -notin @('CLEAN_NO_CHANGE', 'RECOVERED_AUTO')))
    if ((-not $mustRetain) -and $RestoreStageDir -and (Test-Path -LiteralPath $RestoreStageDir)) {
        Remove-DirSafe -DirPath $RestoreStageDir
    } elseif ($mustRetain -and $RestoreStageDir -and (Test-Path -LiteralPath $RestoreStageDir)) {
        Write-Host ("[AGM][Restore] RETAINED_TEMP_DIR: 已严格保留恢复暂存目录 {0}" -f $RestoreStageDir) -ForegroundColor Yellow
    }
}

if (-not $Succeeded) {
    Write-RestoreStatus -ExitCode $FailExitCode
    exit $FailExitCode
}

if ($ArchivedAsarPath -and (Test-Path -LiteralPath $ArchivedAsarPath)) {
    Write-Host "已将当前改装版 app.asar 归档至: $ArchivedAsarPath" -ForegroundColor Gray
}

Write-Host "已成功还原官方纯净 resources\app.asar (SHA256: $RestoredHash)" -ForegroundColor Green
Write-Host "用户数据区（UserData\、plugins\config.json、plugins\state\、plugins\packages\）已 100% 完好保留。" -ForegroundColor Green
Write-RestoreStatus -ExitCode 0
exit 0
