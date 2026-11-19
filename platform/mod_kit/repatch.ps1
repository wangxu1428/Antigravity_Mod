# =============================================================================
# Antigravity 2.0 便携补丁重铸工具箱 (Repatch Kit)
# 纯相对路径编写，支持在任意盘符与目录下一键重新解包、打补丁与打包
# 支持可选参数 -TargetAppDir (-AppDir) 显式指定目标应用根目录
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [Alias("AppDir")]
    [string]$TargetAppDir
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

$PrevBackupPath = $null
$OrigTargetHash = $null
$TempAsarHash = $null
$FinalTargetHash = $null
$AsarBakHash = $null

function Write-RollbackHint {
    $ParentDir = Split-Path -Parent $ScriptDir
    $SiblingRestore = Join-Path (Join-Path $ParentDir "scripts") "restore-official.ps1"
    $RestoreScriptRef = if (Test-Path -LiteralPath $SiblingRestore) { $SiblingRestore } else { "<repo>\platform\scripts\restore-official.ps1" }

    Write-Host ""
    Write-Host "[AGM][Rollback] 回滚命令参考:" -ForegroundColor Yellow
    Write-Host ("  1) 还原官方纯净底座: powershell -NoProfile -ExecutionPolicy Bypass -File `"{0}`" -TargetAppDir `"{1}`"" -f $RestoreScriptRef, $RootDir) -ForegroundColor Gray
    if ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath)) {
        Write-Host ("  2) 从本次重铸前快照还原: Copy-Item -LiteralPath `"{0}`" -Destination `"{1}`" -Force" -f $PrevBackupPath, $AsarTarget) -ForegroundColor Gray
    } elseif (Test-Path -LiteralPath $AsarBak) {
        Write-Host ("  2) 直接从 .bak 还原: Copy-Item -LiteralPath `"{0}`" -Destination `"{1}`" -Force" -f $AsarBak, $AsarTarget) -ForegroundColor Gray
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

# 1. 核验 resources 目录、patch.js 与备份
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

if (!(Test-Path -LiteralPath $AsarBak)) {
    if (Test-Path -LiteralPath $AsarTarget) {
        Write-Host "未找到 app.asar.bak，正在创建原厂备份..." -ForegroundColor Yellow
        Copy-Item -LiteralPath $AsarTarget -Destination $AsarBak -Force
    } else {
        Write-Host "[AGM][Repatch] ERROR: 未找到 app.asar 或 app.asar.bak，无法继续重铸！" -ForegroundColor Red
        Write-RollbackHint
        exit 1
    }
}

$AsarBakHash = (Get-FileHash -LiteralPath $AsarBak -Algorithm SHA256).Hash
if (Test-Path -LiteralPath $AsarTarget) {
    $OrigTargetHash = (Get-FileHash -LiteralPath $AsarTarget -Algorithm SHA256).Hash
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

# 3. 准备隔离临时解包目录与临时打包暂存区
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if ((Test-Path -LiteralPath (Join-Path $ResourcesDir (".agm_repatch_tmp_" + $Timestamp))) -or
    (Test-Path -LiteralPath (Join-Path $ResourcesDir ("app.asar.prev_" + $Timestamp)))) {
    $Timestamp = (Get-Date -Format "yyyyMMdd_HHmmss") + "_" + (Get-Date -Format "fff")
}

$TempRootBase = if ([string]::IsNullOrWhiteSpace($env:TEMP)) { [System.IO.Path]::GetTempPath() } else { $env:TEMP }
$TempSrc = Join-Path $TempRootBase ("agm_rp_src_" + $Timestamp)
$TempBuildDir = Join-Path $ResourcesDir (".agm_repatch_tmp_" + $Timestamp)
$TempAsar = Join-Path $TempBuildDir "app.asar"
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

try {
    if (Test-Path -LiteralPath $TempSrc) {
        Remove-Item -LiteralPath $TempSrc -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TempBuildDir -Force | Out-Null

    # 3.1 从纯净备份解包到临时目录（若存在 app.asar.unpacked 且缺失 app.asar.bak.unpacked，则在临时区配对后再解包），显式校验 $LASTEXITCODE
    $AsarBakUnpacked = $AsarBak + ".unpacked"
    $TargetUnpackedDir = Join-Path $ResourcesDir "app.asar.unpacked"
    if (!(Test-Path -LiteralPath $AsarBakUnpacked) -and (Test-Path -LiteralPath $TargetUnpackedDir -PathType Container)) {
        $TempExtractStageDir = Join-Path $TempRootBase ("agm_rp_in_" + $Timestamp)
        New-Item -ItemType Directory -Path $TempExtractStageDir -Force | Out-Null
        $ExtractSourceAsar = Join-Path $TempExtractStageDir "a.asar"
        Copy-Item -LiteralPath $AsarBak -Destination $ExtractSourceAsar -Force
        Copy-Item -LiteralPath $TargetUnpackedDir -Destination (Join-Path $TempExtractStageDir "a.asar.unpacked") -Recurse -Force
    } else {
        $ExtractSourceAsar = $AsarBak
    }

    Write-Host "正在从纯净备份还原并解包代码到临时目录..." -ForegroundColor Yellow
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

    # 5. 先打包到临时暂存目录（绝不直接写目标 app.asar），显式校验 $LASTEXITCODE
    Write-Host ("正在打包到临时暂存区: {0}" -f $TempAsar) -ForegroundColor Yellow
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

    $TempAsarHash = (Get-FileHash -LiteralPath $TempAsar -Algorithm SHA256).Hash
    Write-Host ("[AGM][Repatch] 临时产物校验通过 (Size={0} bytes, SHA256={1})" -f $stagedItem.Length, $TempAsarHash) -ForegroundColor Cyan

    # 6. 校验全部通过后：备份当前 app.asar 为 app.asar.prev_时间戳，再用 Move-Item 原子替换并二次校验 SHA256
    if (Test-Path -LiteralPath $AsarTarget -PathType Leaf) {
        $PrevBackupPath = Join-Path $ResourcesDir ("app.asar.prev_" + $Timestamp)
        Copy-Item -LiteralPath $AsarTarget -Destination $PrevBackupPath -Force
        $prevHash = (Get-FileHash -LiteralPath $PrevBackupPath -Algorithm SHA256).Hash
        if ($OrigTargetHash -and ($prevHash -ne $OrigTargetHash)) {
            $FailExitCode = 8
            throw ("Previous app.asar backup SHA256 mismatch (expected={0}, actual={1})" -f $OrigTargetHash, $prevHash)
        }
        Write-Host ("[AGM][Repatch] 已备份当前 app.asar 至: {0}" -f $PrevBackupPath) -ForegroundColor Gray
    }

    Move-Item -LiteralPath $TempAsar -Destination $AsarTarget -Force

    $TargetUnpacked = Join-Path $ResourcesDir "app.asar.unpacked"
    $TempUnpacked = Join-Path $TempBuildDir "app.asar.unpacked"
    if (!(Test-Path -LiteralPath $TargetUnpacked) -and (Test-Path -LiteralPath $TempUnpacked)) {
        Move-Item -LiteralPath $TempUnpacked -Destination $TargetUnpacked -Force
    }

    $FinalTargetHash = (Get-FileHash -LiteralPath $AsarTarget -Algorithm SHA256).Hash
    if ($FinalTargetHash -ne $TempAsarHash) {
        $FailExitCode = 9
        throw ("Post-replace SHA256 mismatch! expected={0}, actual={1}" -f $TempAsarHash, $FinalTargetHash)
    }

    $Succeeded = $true
} catch {
    Write-Host ("[AGM][Repatch] FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($PrevBackupPath -and (Test-Path -LiteralPath $PrevBackupPath) -and $OrigTargetHash) {
        $needRestore = $false
        if (!(Test-Path -LiteralPath $AsarTarget)) {
            $needRestore = $true
        } else {
            $curHash = (Get-FileHash -LiteralPath $AsarTarget -Algorithm SHA256).Hash
            if ($curHash -ne $OrigTargetHash) {
                $needRestore = $true
            }
        }
        if ($needRestore) {
            try {
                Copy-Item -LiteralPath $PrevBackupPath -Destination $AsarTarget -Force
                Write-Host ("[AGM][Repatch] 已从 {0} 自动恢复原 app.asar。" -f $PrevBackupPath) -ForegroundColor Yellow
            } catch {
                Write-Host ("[AGM][Repatch] WARNING: 自动恢复原 app.asar 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
            }
        }
    }
    if (Test-Path -LiteralPath $AsarTarget) {
        $keptHash = (Get-FileHash -LiteralPath $AsarTarget -Algorithm SHA256).Hash
        Write-Host ("[AGM][Repatch] 当前目标 app.asar SHA256: {0}" -f $keptHash) -ForegroundColor Gray
    }
    Write-RollbackHint
    if ($FailExitCode -eq 0) {
        $FailExitCode = 1
    }
} finally {
    if ($TempExtractStageDir -and (Test-Path -LiteralPath $TempExtractStageDir)) {
        Remove-Item -LiteralPath $TempExtractStageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($TempSrc -and (Test-Path -LiteralPath $TempSrc)) {
        Remove-Item -LiteralPath $TempSrc -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($TempBuildDir -and (Test-Path -LiteralPath $TempBuildDir)) {
        Remove-Item -LiteralPath $TempBuildDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $Succeeded) {
    exit $FailExitCode
}

Write-Host ("重铸完毕！已成功更新: {0}" -f $AsarTarget) -ForegroundColor Green
Write-Host ("  - 目标 SHA256      : {0}" -f $FinalTargetHash) -ForegroundColor Gray
Write-Host ("  - 原厂备份 (.bak)  : {0} ({1})" -f $AsarBak, $AsarBakHash) -ForegroundColor Gray
if ($PrevBackupPath) {
    Write-Host ("  - 替换前快照 (.prev): {0} ({1})" -f $PrevBackupPath, $OrigTargetHash) -ForegroundColor Gray
}
Write-RollbackHint
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
