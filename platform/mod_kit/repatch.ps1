# =============================================================================
# Antigravity 2.0 便携补丁重铸工具箱 (Repatch Kit)
# 纯相对路径编写，支持在任意盘符与目录下一键重新解包、打补丁与打包
# =============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
$RootDir = Split-Path -Parent $ScriptDir
$ResourcesDir = Join-Path $RootDir "resources"
$AsarBak = Join-Path $ResourcesDir "app.asar.bak"
$AsarTarget = Join-Path $ResourcesDir "app.asar"
$TempSrc = Join-Path $env:TEMP "antigravity_repatch_src"
$PatcherJs = Join-Path $ScriptDir "patch.js"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity 2.0 便携插件底座重铸工具箱 (Hakimi Mod Kit)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "工作根目录: $RootDir" -ForegroundColor Gray

# 1. 核验 resources 目录与备份
if (!(Test-Path $ResourcesDir)) {
    Write-Error "未找到 resources 目录: $ResourcesDir"
}

if (!(Test-Path $AsarBak)) {
    if (Test-Path $AsarTarget) {
        Write-Host "未找到 app.asar.bak，正在创建原厂备份..." -ForegroundColor Yellow
        Copy-Item -Path $AsarTarget -Destination $AsarBak -Force
    } else {
        Write-Error "未找到 app.asar 或 app.asar.bak，无法继续重铸！"
    }
}

# 2. 定位 asar 工具
$AsarCmd = "asar"
if (!(Get-Command asar -ErrorAction SilentlyContinue)) {
    if (Get-Command npx -ErrorAction SilentlyContinue) {
        $AsarCmd = "npx asar"
    } else {
        Write-Error "系统未找到 asar 或 npx，请先安装 @electron/asar (npm i -g @electron/asar)"
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
    exit 3
}
Start-Sleep -Milliseconds 300

# 3. 清理临时解包目录并还原纯净基准
if (Test-Path $TempSrc) {
    Remove-Item -Path $TempSrc -Recurse -Force
}

Write-Host "正在从纯净备份还原并解包代码到临时目录..." -ForegroundColor Yellow
# AGM: app.asar is NOT overwritten before patch.js succeeds; extract straight from the pristine backup instead.

if ($AsarCmd -eq "asar") {
    asar extract "$AsarBak" "$TempSrc"
} else {
    npx asar extract "$AsarBak" "$TempSrc"
}

# 4. 调用精准 JS Patcher 注入
Write-Host "正在执行安全补丁注入与语法校验..." -ForegroundColor Yellow
node "$PatcherJs" "$TempSrc" --update-yml (Join-Path $ResourcesDir "app-update.yml")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[AGM] patch.js failed (exit $LASTEXITCODE): update lock / sidecar reaper not injected. app.asar was not touched; build stopped." -ForegroundColor Red
    exit 2
}

# 5. 重新打包 app.asar
Write-Host "正在重新打包 app.asar 并保持 unpacked 隔离规则..." -ForegroundColor Yellow
if ($AsarCmd -eq "asar") {
    asar pack "$TempSrc" "$AsarTarget" --unpack "**/chrome-devtools-mcp/**"
} else {
    npx asar pack "$TempSrc" "$AsarTarget" --unpack "**/chrome-devtools-mcp/**"
}

# 6. 清理临时解包目录
if (Test-Path $TempSrc) {
    Remove-Item -Path $TempSrc -Recurse -Force
}

Write-Host "重铸完毕！已成功更新: $AsarTarget" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
