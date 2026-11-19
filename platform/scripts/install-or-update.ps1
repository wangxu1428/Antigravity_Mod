# =============================================================================
# Antigravity Mod (AGM) 非破坏式平台安装与升级脚本
# platform/scripts/install-or-update.ps1
#
# 仓库源码在 platform/ 与 plugins/builtin|optional/。本脚本只复制到历史运行时路径
# （plugins\*.js、plugins\hakimi-i18n\、plugins\repo\<id>\、mod_kit\），不删除、不覆盖
# UserData\、plugins\config.json、plugins\state\、plugins\packages\。
#
# 核心安全准则：
# 1. 严禁使用 $D / $d 等单字母大小写混用变量名。
# 2. 严格保护用户数据区（UserData\、plugins\config.json、plugins\state\、plugins\packages\），
#    在任何安装或平台升级过程中绝不覆盖、绝不删除用户数据。
# 3. 严禁无差别杀进程；若检测到目标目录下有进程正在运行，立即以 exit 3 安全中止。
# =============================================================================
param(
    [Parameter(Mandatory = $false)]
    [string]$TargetAppDir = $env:AGM_ROOT,

    [Parameter(Mandatory = $false)]
    [switch]$SkipRepatch,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptsDir = $PSScriptRoot
$PlatformDir = Split-Path -Parent $ScriptsDir
$RepoRootDir = Split-Path -Parent $PlatformDir

function Test-ProtectedDestination {
    param(
        [string]$AppRoot,
        [string]$DestinationPath
    )
    $fullDestination = [System.IO.Path]::GetFullPath($DestinationPath)
    $root = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
    $pluginsRoot = Join-Path $root 'plugins'
    $protectedPaths = @(
        (Join-Path $root 'UserData'),
        (Join-Path $pluginsRoot 'config.json'),
        (Join-Path $pluginsRoot 'state'),
        (Join-Path $pluginsRoot 'packages')
    )
    foreach ($protectedPath in $protectedPaths) {
        $fullProtected = [System.IO.Path]::GetFullPath($protectedPath).TrimEnd('\')
        if ($fullDestination.Equals($fullProtected, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
        if ($fullDestination.StartsWith($fullProtected + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Copy-SourceTree {
    param(
        [string]$AppRoot,
        [string]$SourceDir,
        [string]$DestDir
    )
    $sourceItems = Get-ChildItem -LiteralPath $SourceDir -Recurse -File
    foreach ($item in $sourceItems) {
        $relPath = $item.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
        if ($relPath.StartsWith('backups\', [System.StringComparison]::OrdinalIgnoreCase) -or $relPath.StartsWith('backups/', [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        $targetItemPath = $DestDir
        foreach ($part in ($relPath -split '[\\/]')) {
            if (-not [string]::IsNullOrWhiteSpace($part)) {
                $targetItemPath = Join-Path $targetItemPath $part
            }
        }
        Copy-PlatformFile -AppRoot $AppRoot -SourcePath $item.FullName -DestinationPath $targetItemPath
    }
}

function Copy-PlatformFile {
    param(
        [string]$AppRoot,
        [string]$SourcePath,
        [string]$DestinationPath
    )
    if (Test-ProtectedDestination -AppRoot $AppRoot -DestinationPath $DestinationPath) {
        Write-Error "拒绝写入用户保护区: $DestinationPath"
        exit 1
    }
    $destinationParent = Split-Path -Parent $DestinationPath
    if (-not [string]::IsNullOrWhiteSpace($destinationParent)) {
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    }
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

if ([string]::IsNullOrWhiteSpace($TargetAppDir)) {
    $TargetAppDir = 'C:\Antigravity_Mod'
}
$TargetAppDir = [System.IO.Path]::GetFullPath($TargetAppDir).TrimEnd('\')

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod (AGM) 平台安装与升级工具 (v2.1.0)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "源仓库目录: $RepoRootDir" -ForegroundColor Gray
Write-Host "目标应用目录: $TargetAppDir" -ForegroundColor Gray

# 1. 校验目标目录结构
$TargetExePath = Join-Path $TargetAppDir 'Antigravity.exe'
$TargetResourcesDir = Join-Path $TargetAppDir 'resources'
if (!(Test-Path -LiteralPath $TargetResourcesDir)) {
    Write-Error "目标目录缺少 resources 子目录，请确认路径是否为有效的 Antigravity 客户端目录: $TargetAppDir"
    exit 1
}

# 2. 检查目标目录下是否有正在运行的进程（绝不强制杀进程）
$normalizedPrefix = $TargetAppDir + '\'
$RunningProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($normalizedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
})
if ($RunningProcesses.Count -gt 0) {
    foreach ($proc in $RunningProcesses) {
        Write-Host ("  [运行中进程] PID {0} : {1}" -f $proc.ProcessId, $proc.ExecutablePath) -ForegroundColor Red
    }
    Write-Host "[AGM] 目标目录下仍有客户端或 Sidecar 进程运行。请先关闭客户端后再执行安装/升级（本脚本绝不强制杀进程）。" -ForegroundColor Red
    exit 3
}

# 3. 显式校验并保护用户数据隔离区 (User Data Zone)
$ProtectedUserDataDir = Join-Path $TargetAppDir 'UserData'
$TargetPluginsDir = Join-Path $TargetAppDir 'plugins'
$ProtectedRuntimeConfigPath = Join-Path $TargetPluginsDir 'config.json'
$ProtectedStateDir = Join-Path $TargetPluginsDir 'state'
$ProtectedPackagesDir = Join-Path $TargetPluginsDir 'packages'

Write-Host "[保护区核验] 以下用户数据路径受生命周期隔离保护，升级过程绝不覆盖：" -ForegroundColor Yellow
Write-Host "  - UserData       : $ProtectedUserDataDir"
Write-Host "  - Runtime Config : $ProtectedRuntimeConfigPath"
Write-Host "  - Plugin State   : $ProtectedStateDir"
Write-Host "  - Packages       : $ProtectedPackagesDir"

if ($DryRun) {
    Write-Host "[DryRun] 预检通过，未执行任何文件写入。运行时加载路径保持不变。" -ForegroundColor Green
    exit 0
}

# 4. 同步 mod_kit\ 核心重铸脚本（安装到应用根下的 mod_kit，供 repatch 按相对路径找到 resources\）
$SourceModKitDir = Join-Path $PlatformDir 'mod_kit'
$SourceBuiltinDir = Join-Path (Join-Path $RepoRootDir 'plugins') 'builtin'
$SourceOptionalDir = Join-Path (Join-Path $RepoRootDir 'plugins') 'optional'
$TargetModKitDir = Join-Path $TargetAppDir 'mod_kit'
New-Item -ItemType Directory -Force -Path $TargetModKitDir | Out-Null

$ModKitFiles = @('patch.js', 'agm_locks.js', 'agm_sidecar_reaper_core.js', 'repatch.ps1', 'repatch.bat')
foreach ($fileName in $ModKitFiles) {
    $srcFile = Join-Path $SourceModKitDir $fileName
    $dstFile = Join-Path $TargetModKitDir $fileName
    Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath $srcFile -DestinationPath $dstFile
    Write-Host "已同步 mod_kit\$fileName" -ForegroundColor Gray
}

# 同步 app-update.yml 更新锁配置模板（先备份原始文件）
$SourceUpdateYmlTemplate = Join-Path $SourceModKitDir 'app-update.template.yml'
$TargetUpdateYmlPath = Join-Path $TargetResourcesDir 'app-update.yml'
if (Test-Path -LiteralPath $SourceUpdateYmlTemplate) {
    if (Test-Path -LiteralPath $TargetUpdateYmlPath) {
        $existingYml = Get-Content -LiteralPath $TargetUpdateYmlPath -Raw -Encoding UTF8
        if ($existingYml -notmatch '127\.0\.0\.1:9') {
            $backupYmlName = 'app-update.yml.bak_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
            Copy-Item -LiteralPath $TargetUpdateYmlPath -Destination (Join-Path $TargetResourcesDir $backupYmlName) -Force
        }
    }
    Copy-Item -LiteralPath $SourceUpdateYmlTemplate -Destination $TargetUpdateYmlPath -Force
    Write-Host "已锁定 resources\app-update.yml" -ForegroundColor Gray
}

# 5. 同步 plugins\ 平台核心文件（跳过 config.json、state\、packages\、backups\）
New-Item -ItemType Directory -Force -Path $TargetPluginsDir | Out-Null
if (!(Test-Path -LiteralPath $ProtectedStateDir)) {
    New-Item -ItemType Directory -Force -Path $ProtectedStateDir | Out-Null
}
if (!(Test-Path -LiteralPath $ProtectedPackagesDir)) {
    New-Item -ItemType Directory -Force -Path $ProtectedPackagesDir | Out-Null
}

Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath (Join-Path $PlatformDir 'agm-plugin-host.js') -DestinationPath (Join-Path $TargetPluginsDir 'agm-plugin-host.js')
Write-Host "已同步 plugins\agm-plugin-host.js" -ForegroundColor Gray
Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath (Join-Path $PlatformDir 'config.default.json') -DestinationPath (Join-Path $TargetPluginsDir 'config.default.json')
Write-Host "已同步 plugins\config.default.json" -ForegroundColor Gray

foreach ($pluginId in @('hakimi-i18n', 'ai-sidedock')) {
    $entryName = $pluginId + '.js'
    $srcFile = Join-Path (Join-Path $SourceBuiltinDir $pluginId) $entryName
    $dstFile = Join-Path $TargetPluginsDir $entryName
    Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath $srcFile -DestinationPath $dstFile
    Write-Host "已同步 plugins\$entryName" -ForegroundColor Gray
}

# 同步 hakimi-i18n 模块化源码树。目标仍是运行时 plugins\hakimi-i18n\，不删除其中多出来的用户文件。
$HakimiModuleDir = Join-Path (Join-Path $SourceBuiltinDir 'hakimi-i18n') 'hakimi-i18n'
Copy-SourceTree -AppRoot $TargetAppDir -SourceDir $HakimiModuleDir -DestDir (Join-Path $TargetPluginsDir 'hakimi-i18n')
Write-Host "已同步 plugins\hakimi-i18n\ 子树（不删除已有文件）" -ForegroundColor Gray

# 可选插件复制到历史本地源 plugins\repo\<id>\。不删除 repo 里的其他 id，也不触碰 packages\。
foreach ($optionalDir in @(Get-ChildItem -LiteralPath $SourceOptionalDir -Directory)) {
    $repoDest = Join-Path (Join-Path $TargetPluginsDir 'repo') $optionalDir.Name
    Copy-SourceTree -AppRoot $TargetAppDir -SourceDir $optionalDir.FullName -DestDir $repoDest
    Write-Host "已同步 plugins\repo\$($optionalDir.Name)\ 子树（不删除已有文件）" -ForegroundColor Gray
}

# 6. 初始化运行态 plugins\config.json（仅当不存在时从 config.default.json 初始化，绝不覆盖已有配置）
$DefaultTemplatePath = Join-Path $TargetPluginsDir 'config.default.json'
if (!(Test-Path -LiteralPath $ProtectedRuntimeConfigPath)) {
    Copy-Item -LiteralPath $DefaultTemplatePath -Destination $ProtectedRuntimeConfigPath -Force
    Write-Host "首次安装：已从 config.default.json 初始化运行态 plugins\config.json" -ForegroundColor Green
} else {
    Write-Host "检测到已有 plugins\config.json，已原样保留用户配置。" -ForegroundColor Green
}

# 7. 同步便携启动脚本
$SourceLauncherBat = Join-Path $ScriptsDir '启动爆改版.bat'
if (Test-Path -LiteralPath $SourceLauncherBat) {
    Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath $SourceLauncherBat -DestinationPath (Join-Path $TargetAppDir '启动爆改版.bat')
}

# 8. 可选执行 repatch.ps1 重铸 resources\app.asar
if (-not $SkipRepatch) {
    $TargetRepatchScript = Join-Path $TargetModKitDir 'repatch.ps1'
    Write-Host "正在调用 mod_kit\repatch.ps1 重铸 resources\app.asar ..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TargetRepatchScript
    if ($LASTEXITCODE -ne 0) {
        Write-Error "repatch.ps1 执行失败，退出码: $LASTEXITCODE"
        exit $LASTEXITCODE
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod 平台同步完成（用户数据区 100% 保留）" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
