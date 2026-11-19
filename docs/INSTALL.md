# Antigravity_Mod (AGM v2.1.0) 安装、升级、还原与回滚指南

本文档面向初次接触本仓库的用户及其 AI 助手，说明如何把 **AGM Plugin Platform v2.1.0** 安全安装到一份**独立的 Antigravity 客户端副本**中、如何保留用户数据原地升级、如何使用 `repatch.ps1` 与 `restore-official.ps1`，以及出现问题时如何回滚。

---

## 0. 写给初次使用者与 AI 助手的核心提示

1. **仓库目录不是应用目录**：通过 `git clone` 检出的仓库（不含 `Antigravity.exe` 和 `resources\app.asar`）只是源码与工具分发树，**不能直接作为客户端运行**，必须通过 `platform/scripts/install-or-update.ps1` 安装到目标应用目录。
2. **准备独立副本，绝不改装日常主力客户端**：请先完整复制一份官方 Antigravity 客户端到独立目录（例如 `C:\Antigravity_Mod`），**绝对不要**把官方日常主力安装目录传给 `-TargetAppDir`。
3. **仅按公开文档路径操作**：`platform/`、`plugins/` 源码由安装脚本复制到运行时路径；**严禁**修改或删除 `UserData\`、`plugins\config.json`、`plugins\state\`、`plugins\packages\`。

> **⚠️ WARNING：无参数运行脚本的默认危险行为**
>
> 若未设置环境变量 `AGM_ROOT`，**不带参数直接运行 `platform/scripts/install-or-update.ps1`** 会：
> 1. 默认把目标应用目录锁定为 **`C:\Antigravity_Mod`**；
> 2. 同步文件后**自动调用 `mod_kit\repatch.ps1` 解包并重铸 `resources\app.asar`**。
>
> 同理，**不带参数运行 `platform/scripts/restore-official.ps1`** 默认也会操作 **`C:\Antigravity_Mod`**。
>
> 建议每次执行前都**显式传入 `-TargetAppDir`**，并先带 **`-DryRun`**（安装脚本）或 **`-VerifyOnly`**（还原脚本）做只读预检。

---

## 1. 前置条件 (Prerequisites)

| 条件 | 说明 |
| --- | --- |
| **独立 Antigravity 副本** | 从官方客户端完整复制出的独立目录（兼容基线 `2.32.x` / Electron `44.9.1`），目录内必须存在 `resources\` 子目录与**官方未修改的纯净 `resources\app.asar`**（便携启动还需要根目录存在 `Antigravity.exe`）。 |
| **Windows PowerShell 5.1+** | 运行 `.ps1` 安装、重铸与还原脚本（推荐 `powershell -NoProfile -ExecutionPolicy Bypass`）。 |
| **Node.js** | 供 `mod_kit\patch.js` 注入补丁并执行 `node --check` 语法校验，也可用于运行离线单元测试。 |
| **`asar` 或 `npx`** | `mod_kit\repatch.ps1` 需要解包和重打包 `app.asar`：优先使用 `PATH` 中的全局 `asar`（可通过 `npm i -g @electron/asar` 安装）；若无全局 `asar`，脚本会自动回退为 `npx asar`。 |
| **关闭目标目录全部进程** | 安装、重铸与还原脚本均会扫描目标目录前缀下的所有运行中进程（含客户端本体与 Sidecar）。一旦检测到进程仍在运行，脚本会列出 PID 并以 `exit 3` 中止，**绝不强制杀进程**。 |

---

## 2. 安装与升级（`platform/scripts/install-or-update.ps1`）

安装脚本位于仓库 [`platform/scripts/install-or-update.ps1`](../platform/scripts/install-or-update.ps1)。

### 2.1 参数说明

| 参数 | 类型 | 默认值 / 优先级 | 作用 |
| --- | --- | --- | --- |
| `-TargetAppDir` | `string` | 若未传入则读取 `$env:AGM_ROOT`；两者均为空时默认 `C:\Antigravity_Mod` | 指定待安装或升级的独立应用根目录（目录内必须有 `resources\`）。 |
| `-DryRun` | `switch` | 关闭 | **只做预检，不写入任何文件、不执行 `repatch.ps1`**。校验 `resources\` 是否存在、检查是否有运行中进程，并打印用户数据保护路径清单。 |
| `-SkipRepatch` | `switch` | 关闭 | 只同步 `mod_kit\`、`plugins\` 平台文件、`resources\app-update.yml` 与 `启动爆改版.bat`，**跳过调用 `mod_kit\repatch.ps1`**。适用于小更新（只更新插件或宿主脚本）后在客户端内按 `Ctrl+R` / `F5` 热重载。 |

### 2.2 标准操作步骤

**第 1 步：先执行 `-DryRun` 预检（强烈推荐）**

在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\install-or-update.ps1 -TargetAppDir "C:\Antigravity_Mod" -DryRun
```

确认输出 `[DryRun] 预检通过，未执行任何文件写入` 且退出码为 `0` 后，再进行写入。

**第 2 步：首次安装或大版本升级（同步文件 + 自动重铸 `app.asar`）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\install-or-update.ps1 -TargetAppDir "C:\Antigravity_Mod"
```

脚本会依次完成：
1. 校验 `<TargetAppDir>\resources\` 存在，并确认 `<TargetAppDir>\` 下没有运行中进程；
2. 同步 `platform/mod_kit/` 核心文件（`patch.js`、`agm_locks.js`、`agm_sidecar_reaper_core.js`、`repatch.ps1`、`repatch.bat`）到 `<TargetAppDir>\mod_kit\`；
3. 若 `<TargetAppDir>\resources\app-update.yml` 尚未指向失效锁地址 `127.0.0.1:9`，先备份为 `app-update.yml.bak_<时间戳>`，再写入 `app-update.template.yml` 锁定自动更新；
4. 同步 `platform/agm-plugin-host.js`、`platform/config.default.json`、内置插件（`hakimi-i18n`、`ai-sidedock`）与可选插件包（`agm-hello-guard`）到运行时 `plugins\` 布局；
5. 若 `<TargetAppDir>\plugins\config.json` 不存在，则从 `config.default.json` 初始化一份；**若已存在则原样保留**；
6. 复制 `platform/scripts/启动爆改版.bat` 到 `<TargetAppDir>\启动爆改版.bat`；
7. 未传 `-SkipRepatch` 时，自动调用 `<TargetAppDir>\mod_kit\repatch.ps1` 重铸 `resources\app.asar`。

**第 3 步：仅同步平台与插件（跳过重铸，热重载小更新）**

当你已经重铸过 `app.asar`、本次只更新宿主 JS、汉化词典、侧边舱或沙箱插件包时，可加 `-SkipRepatch`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\install-or-update.ps1 -TargetAppDir "C:\Antigravity_Mod" -SkipRepatch
```

同步完成后，在运行中的改装版客户端内按 `Ctrl+R` 或 `F5` 即可热重载生效。

### 2.3 运行时路径映射与启动方式

| 仓库源码路径 | 运行时安装目标 |
| --- | --- |
| `platform/agm-plugin-host.js` | `<TargetAppDir>\plugins\agm-plugin-host.js` |
| `platform/config.default.json` | `<TargetAppDir>\plugins\config.default.json`（仅在缺失 `config.json` 时初始化一次） |
| `platform/mod_kit/` | `<TargetAppDir>\mod_kit\` |
| `plugins/builtin/<id>/<id>.js` | `<TargetAppDir>\plugins\<id>.js` |
| `plugins/builtin/hakimi-i18n/hakimi-i18n/` | `<TargetAppDir>\plugins\hakimi-i18n\` |
| `plugins/optional/<id>/` | `<TargetAppDir>\plugins\repo\<id>\` |
| `platform/scripts/启动爆改版.bat` | `<TargetAppDir>\启动爆改版.bat` |

安装完成后，双击或命令行运行 `<TargetAppDir>\启动爆改版.bat`，它会以 `--user-data-dir="%~dp0UserData"` 启动独立的便携实例。默认**不开启** Chromium 远程调试端口；仅在本地排障时通过环境变量 `AGM_DEBUG_PORT` 或参数 `--debug-port <port>` 按需开启，切勿在共享设备上开启。

> **`install-or-update.ps1` 实测状态**：2026-11-19 已在一次性隔离副本中完成端到端实测，结果 **20/20 PASS（`OVERALL: PASS`）**：带 `-TargetAppDir` 与 `-SkipRepatch` 对全新目录先 `-DryRun`（零写盘）再正式安装，平台文件与仓库逐字节 SHA256 一致；对预埋用户数据的旧版目录连续两轮升级，12 个用户/受保护文件 SHA256 全程不变，`app-update.yml` 仅首轮备份，两轮结果幂等。重铸步骤（未带 `-SkipRepatch`）由下文 `repatch.ps1` 实测覆盖。首次在本地运行前仍建议先执行 `-DryRun`。

---

## 3. 升级如何保护用户数据 (User Data Isolation)

`install-or-update.ps1` 内置 `Test-ProtectedDestination` 守卫（见 `install-or-update.ps1:L33-L57`），所有平台文件复制函数 `Copy-PlatformFile` 在写盘前都会校验目标路径。以下路径在安装与升级过程中**绝不覆盖、绝不删除**：

| 受保护路径 | 存放内容 | 升级行为 |
| --- | --- | --- |
| `<TargetAppDir>\UserData\` | 便携版 Chromium/Electron 登录态、Cookie、本地缓存与站点数据 | 绝不写入、绝不删除 |
| `<TargetAppDir>\plugins\config.json` | 运行态内置插件用户配置（`sidedock`、`i18n`、自定义词汇与排除项） | 仅首次缺失时初始化，已有则原样保留 |
| `<TargetAppDir>\plugins\state\` | `registry.json`（启停与宿主设置）、`configs/*.json`（插件私有配置/KV）、`logs/*.log` | 仅确保目录存在，绝不覆盖或删除内容 |
| `<TargetAppDir>\plugins\packages\` | 用户在 AGM Hub 中已安装的沙箱插件包副本 | 仅确保目录存在，绝不覆盖或删除内容 |

此外，同步目录子树采用**“只复制、不删除”**策略：
- `<TargetAppDir>\plugins\repo\` 下用户自行放置的其他插件目录不会被删除；
- `<TargetAppDir>\plugins\hakimi-i18n\` 中多出来的用户自定义文件不会被删除；
- 源码中的 `backups\` 子目录会被自动跳过。

---

## 4. 底座重铸（`mod_kit\repatch.ps1`）与 `.bak` 重要警示

### 4.1 工作原理

`mod_kit\repatch.ps1` 支持默认相对路径运行，也支持可选参数 `-TargetAppDir`（别名 `-AppDir`）显式指定目标应用根目录；另支持 `-OfficialAsarHashes`（或环境变量 `AGM_OFFICIAL_ASAR_SHA256`）扩展官方原版 SHA256 白名单。未传参时把脚本所在目录（`mod_kit\`）的**上一级目录**视作应用根目录 `$RootDir`，定位 `$RootDir\resources\app.asar` 与 `$RootDir\resources\app.asar.bak`。

标准流程为：
1. 核验 `resources\` 目录、`mod_kit\patch.js`、`node` 与 `asar`（或回退 `npx asar`）可用性；若目标 `app.asar` 存在且未创建 `.bak`，先校验其 SHA256 属于已知官方白名单（内置 `98A4308C...`）再原子生成 `app.asar.bak`，**非官方版本绝不写入 `.bak`**（以 `exit 4` 中止）；若 `.bak` 已存在则只读校验其 SHA256 属于官方白名单，绝不覆盖，若发现 `.bak` 已被污染则报警并以 `exit 4` 拒绝解包与还原；
2. 通过 `Get-CimInstance Win32_Process` 检查 `$RootDir\` 下是否有运行中进程，若有则列出 PID 并以 `exit 3` 中止（绝不杀进程）；目标 `app.asar` 若被外部进程独占锁定则以 `exit 10` 安全退出；
3. 若存在 `resources\app.asar.unpacked` 但缺失 `resources\app.asar.bak.unpacked`，先在临时区把 `.bak` 与 `app.asar.unpacked` 配对，再调用 `asar extract` 解包到 `%TEMP%\agm_rp_src_<时间戳>`，并显式校验 `$LASTEXITCODE`（非 `0` 立即中止）；
4. 调用 `node mod_kit\patch.js "<TempSrc>" --update-yml "<RootDir>\resources\app-update.yml"`：先预检 **14 个 AGM 锁锚点**（`AGM_UPDATE_LOCK` + `AGM_SIDECAR_REAPER`）与 **8 个 Hakimi 锚点**，并校验 `app-update.yml` 指向 `127.0.0.1:9`，任一失败则以 `exit 2` 中止且不改写文件；随后对 6 个注入 JS 文件显式执行 `node --check`；
5. 先调用 `asar pack ... --unpack "**/chrome-devtools-mcp/**"` 打包到隔离暂存区 `resources\.agm_repatch_tmp_<时间戳>\app.asar`（绝不直接写入目标 `app.asar`），显式校验 `$LASTEXITCODE`；
6. 对暂存产物执行严格校验：文件存在且大小大于 `0`、`asar list` 可列出且包含全部 6 个关键注入文件（`dist/main.js`、`dist/utils.js`、`dist/preload.js`、`dist/updater.js`、`dist/ipcHandlers.js`、`dist/languageServer.js`）、记录 SHA256；
7. 全部校验通过后，先按目标版本分别备份当前 `resources\app.asar`（官方原版备份为 `resources\app.asar.prev_<时间戳>`，已改装版备份为 `resources\app.asar.modded_prev_<时间戳>`，绝不写成 `.bak`），再使用同卷 `[System.IO.File]::Replace` 原子替换目标 `resources\app.asar`（不再使用先删后移的 `Move-Item -Force`）并再次核对目标 SHA256 等于暂存产物 SHA256；若生成了新的 `app.asar.unpacked` 则同步执行备份与 `[System.IO.Directory]::Move` 安全互换（失败时自动回滚原 `app.asar` 与 `app.asar.unpacked`）；
8. 任意步骤失败（含文件被占用锁导致 `exit 10`）均会在 `finally` 自动清理临时目录（兼容 `>260` 字符长路径）、确保原 `resources\app.asar` 仍在且不被损坏、绝不打印成功，并按 `.bak` 可信状态输出回滚命令参考（若 `.bak` 已被污染则禁止推荐从 `.bak` 还原）。

### 4.2 ⚠️ 重要警示：防 `app.asar.bak` 污染门禁

> **⚠️ CRITICAL GUARD：新版 `repatch.ps1` 与 `restore-official.ps1` 已内置官方原版 SHA256 白名单门禁（内置 Antigravity `2.32.1` 官方哈希 `98A4308C...`，可通过 `-OfficialAsarHashes` 或 `AGM_OFFICIAL_ASAR_SHA256` 扩展）：**
>
> - **缺失 `app.asar.bak` 时**：脚本会先核验当前 `resources\app.asar` 的 SHA256 是否在官方白名单中。若是已改装版或未收录版本，脚本会打印 `[AGM][Repatch] ALARM` 并以 **`exit 4`** 中止，**绝不会把改装版写入 `app.asar.bak`**；
> - **已有 `app.asar.bak` 时**：脚本会校验 `.bak` 的 SHA256。一旦检测到 `.bak` 已被污染（不在官方白名单内），`repatch.ps1` 与 `restore-official.ps1` 均会报警并以 **`exit 4`** 拒绝解包或拿它还原；
> - **重复重铸时**：既有官方 `app.asar.bak` 绝不会被覆盖，本次替换前的已改装 `app.asar` 会单独备份为 `resources\app.asar.modded_prev_<时间戳>`。

**安全操作建议**：
1. 首次重铸前，先确认目标目录内的 `resources\app.asar` 来自官方原版安装包（可先核对哈希或先用 `-SkipRepatch` 安装后检查是否存在 `resources\app.asar.bak`）；
2. 若官方客户端更新覆盖了 `app.asar`（变成新版官方原版），应先确认或更新纯净 `app.asar.bak` 并（若为未收录的新官方版本）通过 `-OfficialAsarHashes` 传入其官方 SHA256 后再执行重铸；
3. 若脚本报 `exit 4` 提示 `app.asar.bak` 缺失或已被污染，请从官方安装包重新提取纯净的 `resources\app.asar`，先保存为 `resources\app.asar.bak`（或放回 `resources\app.asar` 并删除被污染的 `.bak`），然后再运行 `repatch.ps1`。

### 4.3 `repatch.ps1` 实测验证结果

- **实测日期与环境**：2026-11-19，在一次性隔离测试副本目录中基于官方 Antigravity `2.32.1` 纯净 `resources\app.asar`（SHA256 `98A4308C...`）完成加固版 `repatch.ps1` 全套闭环实测（Windows PowerShell `5.1.19041.3803`、Node `v26.13.1`、`@electron/asar` `v4.3.2`），完整索引见 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md)。
- **用例 (a) 首次重铸（无 `.bak`）**：`PASS` — 核验官方白名单后原子创建 `app.asar.bak` 与替换前原版快照 `app.asar.prev_*`，临时区配对 `.unpacked` 解包成功，`patch.js`、`node --check` 与 `asar list` 6 文件校验通过，`File.Replace` 原子替换产出 `6F60316D...`（`exit 0`）。
- **用例 (b) 重复重铸（已有 `.bak`）**：`PASS` — 仍从 `app.asar.bak` 解包重铸，`.bak` 的 SHA256 与修改时间保持不变，改装版备份为 `app.asar.modded_prev_*` 并获得与首轮一致的输出哈希 `6F60316D...`（`exit 0`）。
- **用例 (d) 防备份污染门禁（无 `.bak` 且输入为已改装 `app.asar`）**：`PASS` — 白名单门禁识别出非官方输入，打印 `ALARM` 并以 `exit 4` 拒绝生成 `.bak`，未写入任何文件且原 `app.asar` 不变。
- **用例 (e) 打包失败原子保护（真实解包/补丁后模拟 `asar pack` 返回 `19`）**：`PASS` — 模拟打包失败并写入垃圾字节至暂存区，脚本在校验前中止、清理临时目录、打印回滚命令并以 `exit 19` 退出，目标 `app.asar` SHA256 保持 `98A4308C...` 毫发未伤。
- **返工新增 `P0-1` 占用锁原子保护**：`PASS` — 在 `W\app` 的 `robocopy` 副本上分别以 `FileShare.None` 与 `FileShare.Read`（直达 `File.Replace` 步骤）锁定目标 `app.asar` 后运行 `repatch.ps1`，脚本均以 `exit 10` 失败退出且绝不输出成功，解锁后目标 `app.asar` 完好存在且 SHA256 与加锁前一致；离线单测同步覆盖 `app.asar.unpacked` 占用失败后的双向自动回滚。
- **返工新增 `P0-2` 污染 `.bak` 报警与防覆写**：`PASS` — 连续 3 轮重铸后 `.bak` 仍为官方原版且改装版备份均落盘为 `app.asar.modded_prev_*`；人工污染 `.bak` 后，`repatch.ps1` 与 `restore-official.ps1` 均打印 `ALARM` 并以 `exit 4` 拒绝解包或还原。

---

## 5. 还原官方原版 `app.asar`（`platform/scripts/restore-official.ps1`）

当你希望撤掉 `app.asar` 中的补丁、恢复官方纯净底座时，使用 [`platform/scripts/restore-official.ps1`](../platform/scripts/restore-official.ps1)。

### 5.1 参数与命令

```powershell
# 1. 只读校验：核对 app.asar.bak 与当前 app.asar 的 SHA256（不写盘）
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\restore-official.ps1 -TargetAppDir "C:\Antigravity_Mod" -VerifyOnly

# 2. 正式还原官方纯净 app.asar（保留全部用户数据）
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\restore-official.ps1 -TargetAppDir "C:\Antigravity_Mod"
```

### 5.2 还原行为说明

1. 检查 `<TargetAppDir>\resources\app.asar.bak` 是否存在（缺失则以 `exit 2` 退出），并校验其 SHA256 属于官方白名单（支持 `-OfficialAsarHashes` / `AGM_OFFICIAL_ASAR_SHA256`；若 `.bak` 已被污染则打印 `ALARM` 并以 `exit 4` 拒绝还原）；
2. 检查 `<TargetAppDir>\` 下是否有运行中进程（有则列出 PID 并以 `exit 3` 退出，绝不杀进程）；
3. 将当前改装版 `resources\app.asar` 归档到 `<TargetAppDir>\displaced_mod_<时间戳>\app.asar.mod_patched`；
4. 先复制到同卷暂存文件并校验 SHA256 一致，再以 `[System.IO.File]::Replace` 原子还原至 `resources\app.asar`（若目标被占用则以 `exit 10` 安全退出并保留原文件），还原后重新计算 SHA256 与 `.bak` 校验一致（不一致则以 `exit 4` 报错）；
5. **用户数据 100% 保留**：`UserData\`、`plugins\config.json`、`plugins\state\`、`plugins\packages\` 均不受影响。

> **注意**：`restore-official.ps1` 只还原 `resources\app.asar`。如果你还需要恢复自动更新配置，请手动将 `<TargetAppDir>\resources\app-update.yml.bak_<时间戳>` 恢复为 `resources\app-update.yml`。同时请确保 `app.asar.bak` 本身是纯净原版（见第 4.2 节警示）。

### 5.3 `restore-official.ps1` 实测验证结果

- **实测日期与环境**：2026-11-19，承接上述一次性隔离测试副本（Antigravity `2.32.1` 基线）执行 `restore-official.ps1 -TargetAppDir <副本>`。
- **用例 (c) 正式还原与归档核验**：`PASS` — 返回退出码 `0`；还原后的 `resources\app.asar` SHA256 与官方原版 `2.32.1` 一致，`app.asar.bak` 保持不变，且旧改装版已归档至 `displaced_mod_<时间戳>\app.asar.mod_patched`（SHA256 与改装版一致）。

---

## 6. 回滚到上一平台版本 (Rollback)

如需把平台源码（宿主、内置插件、`mod_kit`）回退到上一个已发布版本：

1. 先完全关闭目标应用目录中的所有客户端与 Sidecar 进程；
2. 在本仓库检出目标历史版本标签或提交（标签命名规则见 [docs/versioning.md](versioning.md)）：
   ```powershell
   git checkout platform-v<旧版本号>
   ```
3. 对目标应用目录重新执行安装脚本（只同步平台文件，不覆盖用户数据）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\install-or-update.ps1 -TargetAppDir "C:\Antigravity_Mod" -DryRun
   powershell -NoProfile -ExecutionPolicy Bypass -File .\platform\scripts\install-or-update.ps1 -TargetAppDir "C:\Antigravity_Mod"
   ```
   - 如果旧版本的 `mod_kit\patch.js` 与当前已打包的 `app.asar` 底座相同、仅需回退外置宿主/插件，可追加 `-SkipRepatch`；
   - 如果需要连同 `app.asar` 一起彻底退回官方纯净底座，请按第 5 节执行 `restore-official.ps1`。

> **⚠️ 禁用提示**：仓库内的 [`platform/scripts/legacy-rollback/`](../platform/scripts/legacy-rollback/README.md) 仅用于历史审计归档（存在 PowerShell `$D`/`$d` 变量覆盖缺陷及实验室硬编码路径），**严禁在任何生产或用户环境中运行**。

---

## 7. 给 AI 助手的操作护栏速查

1. **永远显式传递 `-TargetAppDir`**，不要依赖默认值 `C:\Antigravity_Mod` 或未知的 `$env:AGM_ROOT`。
2. **先 `-DryRun` / `-VerifyOnly`，再正式写入**。
3. **不要修改或清理** `UserData\`、`plugins\config.json`、`plugins\state\`、`plugins\packages\`。
4. **不要在目标目录仍有进程运行时强制杀进程**；提示用户先关闭客户端即可。
5. **遇到 `repatch.ps1` / `restore-official.ps1` 返回 `exit 2`、`exit 4` 或 `exit 10`**（锚点缺失、`.bak` 被污染/非官方、或文件被进程锁定）时立即停止，不要强行覆盖，先解除文件占用、核验官方版本兼容性或补齐纯净 `app.asar.bak`。
