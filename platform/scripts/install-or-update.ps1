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
# 4. app-update.yml 遵循事务一致性：先记录存在性与 SHA256，不在 ASAR 校验前破坏活动 YAML，
#    已符合锁定配置时不作无意义写入，保留用户自定义键/注释，失败时恢复原 YAML 状态。
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

function Get-Sha256Upper {
    param([Parameter(Mandatory = $true)][string]$FilePath)
    # Use .NET SHA256 so this works when Microsoft.PowerShell.Utility
    # is not auto-loaded (observed on GitHub windows-latest with -NoProfile).
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $bytes = $hasher.ComputeHash($stream)
            return ([BitConverter]::ToString($bytes)).Replace('-', '')
        } finally {
            $stream.Dispose()
        }
    } finally {
        $hasher.Dispose()
    }
}

function Get-SafeYamlHash {
    param([string]$FilePath)
    if ([string]::IsNullOrWhiteSpace($FilePath) -or !(Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return 'MISSING'
    }
    try {
        return (Get-Sha256Upper -FilePath $FilePath)
    } catch {
        return 'UNREADABLE'
    }
}

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
        Write-Host "[AGM][Installer] ERROR: 拒绝写入用户保护区: $DestinationPath" -ForegroundColor Red
        exit 1
    }
    $destinationParent = Split-Path -Parent $DestinationPath
    if (-not [string]::IsNullOrWhiteSpace($destinationParent)) {
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    }
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

function Build-DesiredUpdateYmlPlan {
    param(
        [string]$TargetYmlPath,
        [string]$TemplatePath,
        [string]$DesiredOutPath
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $existed = Test-Path -LiteralPath $TargetYmlPath -PathType Leaf
    if (-not $existed) {
        if (Test-Path -LiteralPath $TemplatePath -PathType Leaf) {
            Copy-Item -LiteralPath $TemplatePath -Destination $DesiredOutPath -Force
        } else {
            $fallbackText = @(
                '# AGM: auto-update disabled 2026-11-18 by user decision. Original url: https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/',
                'provider: generic',
                'url: http://127.0.0.1:9/agm-update-disabled/',
                'updaterCacheDirName: antigravity-mod-updater'
            ) -join "`n"
            [System.IO.File]::WriteAllText($DesiredOutPath, $fallbackText + "`n", $utf8NoBom)
        }
        return [pscustomobject]@{
            NeedsChange      = $true
            NeedsOfficialBak = $false
            HasCustomKeys    = $false
            Reason           = 'CREATE_NEW'
        }
    }

    $rawText = [System.IO.File]::ReadAllText($TargetYmlPath, [System.Text.Encoding]::UTF8)
    $hasDeadUrl = $rawText -match '(?m)^url:[ \t]*http://127\.0\.0\.1:9/'
    $hasModCache = $rawText -match '(?m)^updaterCacheDirName:[ \t]*antigravity-mod-updater[ \t]*(?:#[^\r\n]*)?\r?$'

    if ($hasDeadUrl -and $hasModCache) {
        Copy-Item -LiteralPath $TargetYmlPath -Destination $DesiredOutPath -Force
        return [pscustomobject]@{
            NeedsChange      = $false
            NeedsOfficialBak = $false
            HasCustomKeys    = $false
            Reason           = 'ALREADY_CONFORMANT'
        }
    }

    # 检查是否存在超出标准三键的用户自定义字段或自定义注释
    $hasCustomLines = $false
    foreach ($line in ($rawText -split '\r?\n')) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        if ($trimmed -eq '# AGM: auto-update disabled 2026-11-18 by user decision. Original url: https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/') {
            continue
        }
        if ($trimmed -match '^(provider|url|updaterCacheDirName)\s*:') { continue }
        $hasCustomLines = $true
        break
    }

    if ((-not $hasDeadUrl) -and (-not $hasCustomLines) -and (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
        # 纯标准配置（如官方原版 app-update.yml）升级为标准锁定模板
        Copy-Item -LiteralPath $TemplatePath -Destination $DesiredOutPath -Force
        return [pscustomobject]@{
            NeedsChange      = $true
            NeedsOfficialBak = $true
            HasCustomKeys    = $false
            Reason           = 'REPLACE_STANDARD_UPSTREAM'
        }
    }

    # 外科式增量更新：保留全部用户自定义字段、注释、换行风格与已有 127.0.0.1:9 死地址
    $eol = if ($rawText.Contains("`r`n")) { "`r`n" } else { "`n" }
    $updated = $rawText
    $needsBak = $false

    if (-not $hasDeadUrl) {
        $needsBak = $true
        if ($updated -match '(?m)^url:') {
            $updated = [regex]::Replace($updated, '(?m)^(url:[ \t]*)([^\r\n#]*?)([ \t]*(?:#[^\r\n]*)?)(\r?)$', '${1}http://127.0.0.1:9/agm-update-disabled/${3}${4}')
        } else {
            if ($updated.Length -gt 0 -and (-not $updated.EndsWith("`n"))) { $updated += $eol }
            $updated += ('url: http://127.0.0.1:9/agm-update-disabled/' + $eol)
        }
    }

    if (-not $hasModCache) {
        if ($updated -match '(?m)^updaterCacheDirName:') {
            $updated = [regex]::Replace($updated, '(?m)^(updaterCacheDirName:[ \t]*)([^\r\n#]*?)([ \t]*(?:#[^\r\n]*)?)(\r?)$', '${1}antigravity-mod-updater${3}${4}')
        } else {
            if ($updated.Length -gt 0 -and (-not $updated.EndsWith("`n"))) { $updated += $eol }
            $updated += ('updaterCacheDirName: antigravity-mod-updater' + $eol)
        }
    }

    [System.IO.File]::WriteAllText($DesiredOutPath, $updated, $utf8NoBom)
    return [pscustomobject]@{
        NeedsChange      = ($updated -ne $rawText)
        NeedsOfficialBak = $needsBak
        HasCustomKeys    = $hasCustomLines
        Reason           = 'SURGICAL_UPDATE'
    }
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
    Write-Host "[AGM][Installer] ERROR: 目标目录缺少 resources 子目录，请确认路径是否为有效的 Antigravity 客户端目录: $TargetAppDir" -ForegroundColor Red
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
    $existingBakPath = Join-Path $TargetResourcesDir 'app.asar.bak'
    if (Test-Path -LiteralPath $existingBakPath -PathType Leaf) {
        Write-Host ("[AGM][Installer] 目标进程正在运行（含客户端或 Sidecar 进程），未同步平台文件、未替换 app.asar；已保留既有备份：{0}。请先关闭客户端后再执行安装/升级（本脚本绝不强制杀进程）。" -f $existingBakPath) -ForegroundColor Red
    } else {
        Write-Host "[AGM][Installer] 目标进程正在运行（含客户端或 Sidecar 进程），未同步平台文件、未替换 app.asar。请先关闭客户端后再执行安装/升级（本脚本绝不强制杀进程）。" -ForegroundColor Red
    }
    Write-Host "[AGM][Installer][Status] EXIT_CODE=3 RECOVERY_STATE=ABORTED_PROCESS_RUNNING"
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

# 3.5 记录操作前 app-update.yml 状态并暂存计划（绝不在 ASAR 校验前修改活动 YAML）
$SourceModKitDir = Join-Path $PlatformDir 'mod_kit'
$SourceUpdateYmlTemplate = Join-Path $SourceModKitDir 'app-update.template.yml'
$TargetUpdateYmlPath = Join-Path $TargetResourcesDir 'app-update.yml'

$InstallTimestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$InstallUniqueSuffix = $InstallTimestamp + '_' + (Get-Date -Format 'fff')
$InstallStageDir = Join-Path $TargetResourcesDir (".agm_install_tmp_" + $InstallUniqueSuffix)
New-Item -ItemType Directory -Force -Path $InstallStageDir | Out-Null

$YamlPreExists = Test-Path -LiteralPath $TargetUpdateYmlPath -PathType Leaf
$YamlPreHash = Get-SafeYamlHash -FilePath $TargetUpdateYmlPath
$YamlOrigBackupPath = Join-Path $InstallStageDir 'app-update.yml.orig_bak'
$YamlDesiredPath = Join-Path $InstallStageDir 'app-update.yml.desired'
$YamlReplaceBakPath = Join-Path $InstallStageDir 'app-update.yml.replace_bak'
$KeepInstallStageDir = $false

Write-Host ("[AGM][Installer][Yaml] Pre-state: exists={0}, sha256={1} ({2})" -f $YamlPreExists, $YamlPreHash, $TargetUpdateYmlPath) -ForegroundColor Gray
if ($YamlPreExists) {
    Copy-Item -LiteralPath $TargetUpdateYmlPath -Destination $YamlOrigBackupPath -Force
    $bakHashCheck = Get-Sha256Upper -FilePath $YamlOrigBackupPath
    if ($bakHashCheck -ne $YamlPreHash) {
        Write-Host "[AGM][Installer][Yaml] ERROR: app-update.yml 前置备份校验失败，已中止。" -ForegroundColor Red
        exit 8
    }
}

$YamlPlan = Build-DesiredUpdateYmlPlan -TargetYmlPath $TargetUpdateYmlPath -TemplatePath $SourceUpdateYmlTemplate -DesiredOutPath $YamlDesiredPath
$YamlDesiredHash = Get-Sha256Upper -FilePath $YamlDesiredPath

try {
    # 4. 同步 mod_kit\ 核心重铸脚本（安装到应用根下的 mod_kit，供 repatch 按相对路径找到 resources\）
    $SourceBuiltinDir = Join-Path (Join-Path $RepoRootDir 'plugins') 'builtin'
    $SourceOptionalDir = Join-Path (Join-Path $RepoRootDir 'plugins') 'optional'
    $TargetModKitDir = Join-Path $TargetAppDir 'mod_kit'
    New-Item -ItemType Directory -Force -Path $TargetModKitDir | Out-Null

    $ModKitFiles = @('patch.js', 'agm_ipc_auth.js', 'agm_updater_auth.js', 'agm_locks.js', 'agm_sidecar_reaper_core.js', 'repatch.ps1', 'repatch.bat', 'app-update.template.yml')
    foreach ($fileName in $ModKitFiles) {
        $srcFile = Join-Path $SourceModKitDir $fileName
        if (Test-Path -LiteralPath $srcFile -PathType Leaf) {
            $dstFile = Join-Path $TargetModKitDir $fileName
            Copy-PlatformFile -AppRoot $TargetAppDir -SourcePath $srcFile -DestinationPath $dstFile
            Write-Host "已同步 mod_kit\$fileName" -ForegroundColor Gray
        }
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

    # 8. 事务化提交 app-update.yml 与（未传 -SkipRepatch 时）重铸 resources\app.asar
    if (-not $SkipRepatch) {
        $TargetRepatchScript = Join-Path $TargetModKitDir 'repatch.ps1'
        $TargetAsarBakPath = Join-Path $TargetResourcesDir 'app.asar.bak'
        $BakExistedBeforeRepatch = Test-Path -LiteralPath $TargetAsarBakPath -PathType Leaf
        Write-Host "正在调用 mod_kit\repatch.ps1 重铸 resources\app.asar（活动 app-update.yml 将在 ASAR 校验及替换完成后原子提交）..." -ForegroundColor Yellow

        $repatchArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $TargetRepatchScript, '-TargetAppDir', $TargetAppDir)
        if ($YamlPlan.NeedsChange) {
            $repatchArgs += @('-StagedUpdateYmlPath', $YamlDesiredPath)
        }
        & powershell.exe @repatchArgs
        $repatchExit = $LASTEXITCODE
        if ($null -eq $repatchExit) { $repatchExit = 0 }

        if ($repatchExit -ne 0) {
            if ($repatchExit -eq 3) {
                $bakExistsNow = Test-Path -LiteralPath $TargetAsarBakPath -PathType Leaf
                if ((-not $BakExistedBeforeRepatch) -and $bakExistsNow) {
                    $installerRecState = 'ABORTED_PROCESS_RUNNING_BACKUP_CREATED'
                    Write-Host ("[AGM][Installer] 目标进程正在运行，repatch.ps1 已中止（exit 3），未替换 app.asar；平台文件已同步，已创建可信官方备份：{0}。请先关闭客户端后再重试（本脚本绝不强制杀进程）。" -f $TargetAsarBakPath) -ForegroundColor Red
                } elseif ($bakExistsNow) {
                    $installerRecState = 'ABORTED_PROCESS_RUNNING'
                    Write-Host ("[AGM][Installer] 目标进程正在运行，repatch.ps1 已中止（exit 3），未替换 app.asar；平台文件已同步，已保留既有可信官方备份：{0}。请先关闭客户端后再重试（本脚本绝不强制杀进程）。" -f $TargetAsarBakPath) -ForegroundColor Red
                } else {
                    $installerRecState = 'ABORTED_PROCESS_RUNNING'
                    Write-Host "[AGM][Installer] 目标进程正在运行，repatch.ps1 已中止（exit 3），未替换 app.asar；平台文件已同步。请先关闭客户端后再重试（本脚本绝不强制杀进程）。" -ForegroundColor Red
                }
            } else {
                Write-Host ("[AGM][Installer] ERROR: repatch.ps1 执行失败，退出码: {0}" -f $repatchExit) -ForegroundColor Red
            }
            # 防御性核验并恢复原 YAML 状态，确保不留下漂移或多余备份
            $yamlRecoveryOk = $true
            $yamlRecState = if ($repatchExit -eq 3) { 'NOT_MODIFIED' } else { 'CLEAN_NO_CHANGE' }
            if ($YamlPreExists) {
                $curYamlHash = Get-SafeYamlHash -FilePath $TargetUpdateYmlPath
                if ($curYamlHash -ne $YamlPreHash) {
                    $yamlRecoveryOk = $false
                    $yamlRestoreTmp = Join-Path $InstallStageDir 'app-update.yml.installer_restore_tmp'
                    $yamlRestoreDisp = Join-Path $InstallStageDir 'app-update.yml.installer_restore_disp'
                    try {
                        Copy-Item -LiteralPath $YamlOrigBackupPath -Destination $yamlRestoreTmp -Force
                        if (Test-Path -LiteralPath $TargetUpdateYmlPath -PathType Leaf) {
                            [System.IO.File]::Replace($yamlRestoreTmp, $TargetUpdateYmlPath, $yamlRestoreDisp, $true)
                        } else {
                            [System.IO.File]::Move($yamlRestoreTmp, $TargetUpdateYmlPath)
                        }
                        if ((Get-SafeYamlHash -FilePath $TargetUpdateYmlPath) -eq $YamlPreHash) {
                            $yamlRecoveryOk = $true
                            $yamlRecState = 'RECOVERED_AUTO'
                            Write-Host ("[AGM][Installer][Yaml] 已从原备份自动恢复 app-update.yml ({0})" -f $YamlPreHash) -ForegroundColor Yellow
                        }
                    } catch {
                        $yamlRecoveryOk = $false
                        $yamlRecState = 'FAILED_NEEDS_MANUAL_RECOVERY'
                        Write-Host ("[AGM][Installer][Yaml] CRITICAL: 自动恢复 app-update.yml 失败，备份保留于 {0}: {1}" -f $YamlOrigBackupPath, $_.Exception.Message) -ForegroundColor Red
                    }
                } else {
                    Write-Host ("[AGM][Installer][Yaml] 确认 app-update.yml 保持操作前原状态未变动 (SHA256={0})" -f $YamlPreHash) -ForegroundColor Gray
                }
            } else {
                if (Test-Path -LiteralPath $TargetUpdateYmlPath -PathType Leaf) {
                    try {
                        Remove-Item -LiteralPath $TargetUpdateYmlPath -Force -ErrorAction Stop
                        if (Test-Path -LiteralPath $TargetUpdateYmlPath) {
                            throw 'app-update.yml still exists after removal'
                        }
                        $yamlRecState = 'RECOVERED_AUTO'
                        Write-Host "[AGM][Installer][Yaml] 已清理失败调用产生的 app-update.yml，恢复初始缺失状态。" -ForegroundColor Yellow
                    } catch {
                        $yamlRecoveryOk = $false
                        $yamlRecState = 'FAILED_NEEDS_MANUAL_RECOVERY'
                        Write-Host ("[AGM][Installer][Yaml] CRITICAL: 清理新增 app-update.yml 失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
                    }
                } else {
                    Write-Host "[AGM][Installer][Yaml] 确认 app-update.yml 维持初始缺失状态。" -ForegroundColor Gray
                }
            }

            if (-not $yamlRecoveryOk) {
                $KeepInstallStageDir = $true
            }
            $yamlPostNow = Get-SafeYamlHash -FilePath $TargetUpdateYmlPath
            if ($repatchExit -eq 3) {
                Write-Host ("[AGM][Installer][Status] EXIT_CODE=3 RECOVERY_STATE={0} YAML_PRE_EXISTS={1} YAML_PRE_SHA256={2} YAML_POST_SHA256={3} YAML_RECOVERY_STATE={4}" -f $installerRecState, $YamlPreExists, $YamlPreHash, $yamlPostNow, $yamlRecState)
            } else {
                Write-Host ("[AGM][Installer][Status] EXIT_CODE={0} YAML_PRE_EXISTS={1} YAML_PRE_SHA256={2} YAML_POST_SHA256={3} YAML_RECOVERY_STATE={4}" -f $repatchExit, $YamlPreExists, $YamlPreHash, $yamlPostNow, $yamlRecState)
            }
            exit $repatchExit
        }

        if ($YamlPlan.NeedsOfficialBak -and $YamlPreExists -and (Test-Path -LiteralPath $YamlOrigBackupPath -PathType Leaf)) {
            $backupYmlName = 'app-update.yml.bak_' + $InstallTimestamp
            Copy-Item -LiteralPath $YamlOrigBackupPath -Destination (Join-Path $TargetResourcesDir $backupYmlName) -Force
            Write-Host "已保留更新前原版 $backupYmlName" -ForegroundColor Gray
        }
    } else {
        # -SkipRepatch 模式下同样仅在所有平台文件同步完成后，按需原子提交 app-update.yml
        if (-not $YamlPlan.NeedsChange) {
            Write-Host ("[AGM][Installer][Yaml] resources\app-update.yml 已符合锁定配置，跳过无意义修改 (SHA256={0})" -f $YamlPreHash) -ForegroundColor Gray
        } else {
            if ($YamlPlan.NeedsOfficialBak -and $YamlPreExists) {
                $backupYmlName = 'app-update.yml.bak_' + $InstallTimestamp
                Copy-Item -LiteralPath $YamlOrigBackupPath -Destination (Join-Path $TargetResourcesDir $backupYmlName) -Force
            }
            $commitTmp = Join-Path $InstallStageDir 'app-update.yml.commit_tmp'
            Copy-Item -LiteralPath $YamlDesiredPath -Destination $commitTmp -Force
            if (Test-Path -LiteralPath $TargetUpdateYmlPath -PathType Leaf) {
                [System.IO.File]::Replace($commitTmp, $TargetUpdateYmlPath, $YamlReplaceBakPath, $true)
            } else {
                [System.IO.File]::Move($commitTmp, $TargetUpdateYmlPath)
            }
            $yamlPostHash = Get-Sha256Upper -FilePath $TargetUpdateYmlPath
            if ($yamlPostHash -ne $YamlDesiredHash) {
                $KeepInstallStageDir = $true
                Write-Host ("[AGM][Installer][Yaml] ERROR: 提交后 app-update.yml 校验失败 (expected={0}, actual={1})" -f $YamlDesiredHash, $yamlPostHash) -ForegroundColor Red
                exit 12
            }
            Write-Host ("已事务化锁定 resources\app-update.yml (SHA256={0})" -f $yamlPostHash) -ForegroundColor Gray
        }
    }
} finally {
    if ((-not $KeepInstallStageDir) -and $InstallStageDir -and (Test-Path -LiteralPath $InstallStageDir)) {
        Remove-Item -LiteralPath $InstallStageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$FinalYamlHash = Get-SafeYamlHash -FilePath $TargetUpdateYmlPath
Write-Host ("[AGM][Installer][Status] EXIT_CODE=0 YAML_PRE_EXISTS={0} YAML_PRE_SHA256={1} YAML_POST_SHA256={2} YAML_REASON={3}" -f $YamlPreExists, $YamlPreHash, $FinalYamlHash, $YamlPlan.Reason) -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Mod 平台同步完成（用户数据区 100% 保留）" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
exit 0
