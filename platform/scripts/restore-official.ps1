# =============================================================================
# Antigravity Mod (AGM) 官方纯净底座安全还原脚本
# platform/scripts/restore-official.ps1
#
# 核心安全准则：
# 1. 彻底杜绝 $D / $d 等单字母大小写混用变量名（全部采用语义化长变量名）。
# 2. 默认 100% 保留 UserData\ 与 plugins\{config.json,state,packages} 用户数据，绝不删除。
# 3. 严禁无差别杀进程；若检测到目标目录下有进程运行，立即以 exit 3 安全中止。
# 4. 严格校验 app.asar.bak 属于官方原版白名单，绝不拿被污染的 .bak 执行还原。
# 5. 采用同卷暂存 + [System.IO.File]::Replace 原子替换，绝不损坏目标文件。
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

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod (AGM) 官方原版 app.asar 安全还原工具" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "目标应用目录: $TargetAppDir" -ForegroundColor Gray

if (!(Test-Path -LiteralPath $AsarBackupPath)) {
    Write-Host "[AGM][Restore] ERROR: 未找到官方纯净备份文件: $AsarBackupPath ，无法执行还原！" -ForegroundColor Red
    exit 2
}

$BackupHash = Get-Sha256Upper -FilePath $AsarBackupPath
$ActiveHash = 'MISSING'
if (Test-Path -LiteralPath $AsarActivePath) {
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
    exit 4
}

if ($VerifyOnly) {
    Write-Host "[VerifyOnly] 备份文件通过官方白名单校验且完整可读，未做任何写入改动。" -ForegroundColor Green
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
    Write-Host "[AGM] 目标目录下仍有进程运行，请先关闭客户端后再还原（本脚本绝不强制杀进程）。" -ForegroundColor Red
    exit 3
}

if ($ActiveHash -eq 'LOCKED') {
    Write-Host "[AGM][Restore] FAILED: 目标 app.asar 正被其他进程独占锁定，无法执行还原。" -ForegroundColor Red
    exit 10
}

# 归档当前重铸版 app.asar 并使用同卷暂存 + File.Replace 原子还原官方 app.asar.bak
$TimestampTag = Get-Date -Format 'yyyyMMdd_HHmmss'
$DisplacedArchiveDir = Join-Path $TargetAppDir ("displaced_mod_" + $TimestampTag)
$RestoredStagePath = Join-Path $ResourcesDir (".app.asar.restore_tmp_" + $TimestampTag + "_" + (Get-Date -Format 'fff'))
$ArchivedAsarPath = $null

try {
    Copy-Item -LiteralPath $AsarBackupPath -Destination $RestoredStagePath -Force
    $StagedHash = Get-Sha256Upper -FilePath $RestoredStagePath
    if ($StagedHash -ne $BackupHash) {
        Write-Host ("[AGM][Restore] ERROR: 暂存还原文件 SHA256 校验失败（期望: {0}，实际: {1}）" -f $BackupHash, $StagedHash) -ForegroundColor Red
        exit 4
    }

    if (Test-Path -LiteralPath $AsarActivePath) {
        New-Item -ItemType Directory -Force -Path $DisplacedArchiveDir | Out-Null
        $ArchivedAsarPath = Join-Path $DisplacedArchiveDir 'app.asar.mod_patched'
        Copy-Item -LiteralPath $AsarActivePath -Destination $ArchivedAsarPath -Force
    }

    if (Test-Path -LiteralPath $AsarActivePath) {
        [System.IO.File]::Replace($RestoredStagePath, $AsarActivePath, [NullString]::Value, $true)
    } else {
        [System.IO.File]::Move($RestoredStagePath, $AsarActivePath)
    }
} catch {
    if (Test-Path -LiteralPath $RestoredStagePath) {
        Remove-Item -LiteralPath $RestoredStagePath -Force -ErrorAction SilentlyContinue
    }
    if (Test-LockException $_.Exception) {
        Write-Host ("[AGM][Restore] FAILED: 目标 app.asar 正被其他进程占用，原子还原失败（原文件保持完整）: {0}" -f $_.Exception.Message) -ForegroundColor Red
        exit 10
    }
    Write-Host ("[AGM][Restore] FAILED: 原子还原失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if (Test-Path -LiteralPath $RestoredStagePath) {
        Remove-Item -LiteralPath $RestoredStagePath -Force -ErrorAction SilentlyContinue
    }
}

if ($ArchivedAsarPath -and (Test-Path -LiteralPath $ArchivedAsarPath)) {
    Write-Host "已将当前改装版 app.asar 归档至: $ArchivedAsarPath" -ForegroundColor Gray
}

$RestoredHash = Get-Sha256Upper -FilePath $AsarActivePath

if ($RestoredHash -ne $BackupHash) {
    Write-Host ("[AGM][Restore] ERROR: 还原后 SHA256 校验不一致！（期望: {0}，实际: {1}）" -f $BackupHash, $RestoredHash) -ForegroundColor Red
    exit 4
}

Write-Host "已成功还原官方纯净 resources\app.asar (SHA256: $RestoredHash)" -ForegroundColor Green
Write-Host "用户数据区（UserData\、plugins\config.json、plugins\state\、plugins\packages\）已 100% 完好保留。" -ForegroundColor Green
exit 0
