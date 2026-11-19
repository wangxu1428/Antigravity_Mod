# =============================================================================
# Antigravity Mod (AGM) 官方纯净底座安全还原脚本
# platform/scripts/restore-official.ps1
#
# 核心安全准则：
# 1. 彻底杜绝 $D / $d 等单字母大小写混用变量名（全部采用语义化长变量名）。
# 2. 默认 100% 保留 UserData\ 与 plugins\{config.json,state,packages} 用户数据，绝不删除。
# 3. 严禁无差别杀进程；若检测到目标目录下有进程运行，立即以 exit 3 安全中止。
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [string]$TargetAppDir = $env:AGM_ROOT,

    [Parameter(Mandatory = $false)]
    [switch]$VerifyOnly
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

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod (AGM) 官方原版 app.asar 安全还原工具" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "目标应用目录: $TargetAppDir" -ForegroundColor Gray

if (!(Test-Path -LiteralPath $AsarBackupPath)) {
    Write-Error "未找到官方纯净备份文件: $AsarBackupPath ，无法执行还原！"
    exit 2
}

$BackupHash = (Get-FileHash -LiteralPath $AsarBackupPath -Algorithm SHA256).Hash
$ActiveHash = if (Test-Path -LiteralPath $AsarActivePath) { (Get-FileHash -LiteralPath $AsarActivePath -Algorithm SHA256).Hash } else { 'MISSING' }

Write-Host "app.asar.bak SHA256 : $BackupHash" -ForegroundColor Gray
Write-Host "app.asar     SHA256 : $ActiveHash" -ForegroundColor Gray

if ($VerifyOnly) {
    Write-Host "[VerifyOnly] 备份文件完整可读，未做任何写入改动。" -ForegroundColor Green
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

# 归档当前重铸版 app.asar 并还原官方 app.asar.bak（使用语义化长变量名，杜绝 $D/$d 冲突）
$TimestampTag = Get-Date -Format 'yyyyMMdd_HHmmss'
$DisplacedArchiveDir = Join-Path $TargetAppDir ("displaced_mod_" + $TimestampTag)
New-Item -ItemType Directory -Force -Path $DisplacedArchiveDir | Out-Null

if (Test-Path -LiteralPath $AsarActivePath) {
    $ArchivedAsarPath = Join-Path $DisplacedArchiveDir 'app.asar.mod_patched'
    Copy-Item -LiteralPath $AsarActivePath -Destination $ArchivedAsarPath -Force
    Write-Host "已将当前改装版 app.asar 归档至: $ArchivedAsarPath" -ForegroundColor Gray
}

Copy-Item -LiteralPath $AsarBackupPath -Destination $AsarActivePath -Force
$RestoredHash = (Get-FileHash -LiteralPath $AsarActivePath -Algorithm SHA256).Hash

if ($RestoredHash -ne $BackupHash) {
    Write-Error "还原后 SHA256 校验不一致！（期望: $BackupHash，实际: $RestoredHash）"
    exit 4
}

Write-Host "已成功还原官方纯净 resources\app.asar (SHA256: $RestoredHash)" -ForegroundColor Green
Write-Host "用户数据区（UserData\、plugins\config.json、plugins\state\、plugins\packages\）已 100% 完好保留。" -ForegroundColor Green
exit 0
