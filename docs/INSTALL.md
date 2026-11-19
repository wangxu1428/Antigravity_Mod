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
| **关闭目标目录全部进程** | 安装、重铸与还原脚本均会扫描目标目录前缀下的所有运行中进程（含客户端本体与 Sidecar）。一旦检测到进程仍在运行，脚本会列出 PID 并以 `exit 3` 中止，如实汇报未替换 `app.asar` 及备份状态（若 `repatch.ps1` 在检测进程前已原子创建可信官方 `.bak`，则输出 `ABORTED_PROCESS_RUNNING_BACKUP_CREATED`；其余场景输出 `ABORTED_PROCESS_RUNNING`），**绝不强制杀进程**。 |

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
1. 校验 `<TargetAppDir>\resources\` 存在，并确认 `<TargetAppDir>\` 下没有运行中进程；记录当前 `resources\app-update.yml` 的存在性与 SHA256，并在同卷暂存区保留原配置备份；
2. 同步 `platform/mod_kit/` 核心文件（`patch.js`、`agm_locks.js`、`agm_sidecar_reaper_core.js`、`repatch.ps1`、`repatch.bat`、`app-update.template.yml`）到 `<TargetAppDir>\mod_kit\`；
3. 同步 `platform/agm-plugin-host.js`、`platform/config.default.json`、内置插件（`hakimi-i18n`、`ai-sidedock`）与可选插件包（`agm-hello-guard`）到运行时 `plugins\` 布局；
4. 若 `<TargetAppDir>\plugins\config.json` 不存在，则从 `config.default.json` 初始化一份；**若已存在则原样保留**；
5. 复制 `platform/scripts/启动爆改版.bat` 到 `<TargetAppDir>\启动爆改版.bat`；
6. 事务化提交 `resources\app-update.yml` 与重铸 `resources\app.asar`：
   - 若 `<TargetAppDir>\resources\app-update.yml` **已符合锁定配置**（`url` 指向 `127.0.0.1:9` 且 `updaterCacheDirName: antigravity-mod-updater`），执行**零写入 NO-OP**（保留文件 SHA256、mtime 与所有用户自定义键/注释）；
   - 若含用户自定义键或注释且需更新锁定字段，采用**外科式增量更新**写入同卷暂存文件，绝不覆盖用户自定义字段；
   - 未传 `-SkipRepatch` 时，**在 ASAR 与 `app.asar.unpacked` 全部校验并替换成功前不修改活动 `app-update.yml`**；仅当 `repatch.ps1` 全部成功后才原子提交 YAML 并按需保留 `app-update.yml.bak_<时间戳>`；若 `repatch.ps1` 失败，确保活动 YAML 恢复至操作前原始状态且不留下多余 `.bak_*`。

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

`mod_kit\repatch.ps1` 支持默认相对路径运行，也支持可选参数 `-TargetAppDir`（别名 `-AppDir`）显式指定目标应用根目录；另支持 `-OfficialAsarHashes`（或环境变量 `AGM_OFFICIAL_ASAR_SHA256`）扩展官方原版 SHA256 白名单，以及 `-StagedUpdateYmlPath` 接收安装器暂存的期望 `app-update.yml`。未传参时把脚本所在目录（`mod_kit\`）的**上一级目录**视作应用根目录 `$RootDir`，定位 `$RootDir\resources\app.asar` 与 `$RootDir\resources\app.asar.bak`。

标准流程为：
1. 记录操作前 `resources\app-update.yml` 的存在性与 SHA256；核验 `resources\` 目录、`mod_kit\patch.js`、`node` 与 `asar`（或回退 `npx asar`）可用性；若目标 `app.asar` 存在且未创建 `.bak`，先校验其 SHA256 属于已知官方白名单（内置 `5B493943...`）再原子生成 `app.asar.bak`，**非官方版本绝不写入 `.bak`**（以 `exit 4` 中止）；若 `.bak` 已存在则只读校验其 SHA256 属于官方白名单，绝不覆盖，若发现 `.bak` 已被污染则报警并以 `exit 4` 拒绝解包与还原；
2. 通过 `Get-CimInstance Win32_Process` 检查 `$RootDir\` 下是否有运行中进程，若有则列出 PID 并以 `exit 3` 中止（绝不杀进程），如实提示未替换 `app.asar` 及 `.bak` 状态（若第 1 步刚创建可信官方 `.bak` 则输出 `ABORTED_PROCESS_RUNNING_BACKUP_CREATED` 与备份路径/SHA256，若原本已有 `.bak` 则输出 `ABORTED_PROCESS_RUNNING` 与“已保留”，不再称“没有变更”或 `CLEAN_NO_CHANGE`）；目标 `app.asar` 若被外部进程独占锁定则以 `exit 10` 安全退出；
3. 在同卷暂存目录 `resources\.agm_repatch_tmp_<时间戳>` 备份原 `app-update.yml`（若存在）并准备暂存输入（兼容首次安装 `app-update.yml` 不存在的情况，回退使用 `app-update.template.yml` 或内置默认模板）；若存在 `resources\app.asar.unpacked` 但缺失 `resources\app.asar.bak.unpacked`，先在临时区把 `.bak` 与 `app.asar.unpacked` 配对，再调用 `asar extract` 解包到 `%TEMP%\agm_rp_src_<时间戳>`，并显式校验 `$LASTEXITCODE`（非 `0` 立即中止）；
4. 调用 `node mod_kit\patch.js "<TempSrc>" --update-yml "<stagedInput>" --update-yml-out "<stagedOut>"`：先预检 **14 个 AGM 锁锚点**（`AGM_UPDATE_LOCK` + `AGM_SIDECAR_REAPER`）与 **8 个 Hakimi 锚点**，并校验 `app-update.yml` 指向 `127.0.0.1:9`，任一失败则以 `exit 2` 中止且不改写任何 JS 或活动 YAML；随后对 6 个注入 JS 文件显式执行 `node --check`；
5. 先调用 `asar pack ... --unpack "**/chrome-devtools-mcp/**"` 打包到隔离暂存区 `resources\.agm_repatch_tmp_<时间戳>\app.asar`（绝不直接写入目标 `app.asar`），显式校验 `$LASTEXITCODE`；
6. 对暂存产物执行严格校验：文件存在且大小大于 `0`、`asar list` 可列出且包含全部 6 个关键注入文件（`dist/main.js`、`dist/utils.js`、`dist/preload.js`、`dist/updater.js`、`dist/ipcHandlers.js`、`dist/languageServer.js`）、记录 SHA256；
7. 全部校验通过后，先按目标版本分别备份当前 `resources\app.asar`（官方原版备份为 `resources\app.asar.prev_<时间戳>`，已改装版备份为 `resources\app.asar.modded_prev_<时间戳>`，绝不写成 `.bak`），再使用同卷 `[System.IO.File]::Replace` 原子替换目标 `resources\app.asar` 并二次核对目标 SHA256 等于暂存产物 SHA256；
8. 若生成了新的 `app.asar.unpacked`，采用显式状态机（`NOT_STARTED -> ORIG_MOVED_TO_BACKUP -> NEW_MOVED_IN -> VERIFIED_NEW`）执行目录备份、换入与后置非空目录校验；任何环节失败均优先把 `app.asar.unpacked.orig_bak` 原子移回原位并回滚 `app.asar`；
9. 仅在 `app.asar` 与 `app.asar.unpacked` 均完成替换与校验后，才原子提交 `app-update.yml`（若原文件已符合目标配置则跳过写入 NO-OP）；提交失败时自动原子恢复原 YAML、原 `app.asar` 与原 `app.asar.unpacked`；
10. **异常状态核验与恢复材料物理保留守卫**：替换抛错后绝不凭异常类型推断原文件未变化，而是先实测核验目标存在性与 SHA256 并核验备份完整性，再决定是否清理未用快照；若目标被锁定/不可读则保留全部可信恢复材料并报告 `UNKNOWN/NEEDS_RECOVERY`；若自动回滚再次失败则进入 `FAILED_NEEDS_MANUAL_RECOVERY`（`exit 11`），`finally` 物理守卫禁止删除仍包含唯一恢复材料的 `.agm_repatch_tmp_*` 目录，同时输出 `[AGM][Status]` 结构化状态与可执行的人工恢复命令。

### 4.2 ⚠️ 重要警示：防 `app.asar.bak` 污染门禁

> **⚠️ CRITICAL GUARD：新版 `repatch.ps1` 与 `restore-official.ps1` 已内置官方原版 SHA256 白名单门禁（内置 Antigravity `2.32.1` 官方纯净哈希 `5B493943...`（即官方安装目录中的 `resources\app.asar.bak`；同目录当前 `app.asar` 的 `98A4308C...` 预置了旧版汉化引擎，不得当作官方原版），可通过 `-OfficialAsarHashes` 或 `AGM_OFFICIAL_ASAR_SHA256` 扩展）：**
>
> - **缺失 `app.asar.bak` 时**：脚本会先核验当前 `resources\app.asar` 的 SHA256 是否在官方白名单中。若是已改装版或未收录版本，脚本会打印 `[AGM][Repatch] ALARM` 并以 **`exit 4`** 中止，**绝不会把改装版写入 `app.asar.bak`**；
> - **已有 `app.asar.bak` 时**：脚本会校验 `.bak` 的 SHA256。一旦检测到 `.bak` 已被污染（不在官方白名单内），`repatch.ps1` 与 `restore-official.ps1` 均会报警并以 **`exit 4`** 拒绝解包或拿它还原；
> - **重复重铸时**：既有官方 `app.asar.bak` 绝不会被覆盖，本次替换前的已改装 `app.asar` 会单独备份为 `resources\app.asar.modded_prev_<时间戳>`。

**安全操作建议**：
1. 首次重铸前，先确认目标目录内的 `resources\app.asar` 来自官方原版安装包（可先核对哈希或先用 `-SkipRepatch` 安装后检查是否存在 `resources\app.asar.bak`）；
2. 若官方客户端更新覆盖了 `app.asar`（变成新版官方原版），应先确认或更新纯净 `app.asar.bak` 并（若为未收录的新官方版本）通过 `-OfficialAsarHashes` 传入其官方 SHA256 后再执行重铸；
3. 若脚本报 `exit 4` 提示 `app.asar.bak` 缺失或已被污染，请从官方安装包重新提取纯净的 `resources\app.asar`，先保存为 `resources\app.asar.bak`（或放回 `resources\app.asar` 并删除被污染的 `.bak`），然后再运行 `repatch.ps1`。

### 4.3 `repatch.ps1` 实测验证结果

- **早期实测记录（旧改装基准，保留历史对照）**：2026-11-19 上午在一次性隔离测试副本中，基于带旧版 `AGY_ZH_ENGINE_START` 的**旧改装基准 `app.asar`（SHA256 `98A4308C...`，非官方原版）** 完成首轮与第 2 轮实测（Windows PowerShell `5.1.19041.3803`、Node `v26.13.1`、`@electron/asar` `v4.3.2`），完整索引见 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md) 第 3–4 节。
- **纯净官方底座校正与 R3 全量实测（`2026-11-19`）**：基于 Antigravity `2.32.1` **官方纯净原版 `resources\app.asar.bak`（SHA256 `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`）** 完成全量回归与 R3 故障注入实测，全部 PASS：
  - **用例 (a) 首次重铸（无 `.bak` + 非默认 `app-update.yml`）**：`PASS` — 核验官方白名单后原子创建 `app.asar.bak`（`5B493943...`）与原版快照 `app.asar.prev_*`，临时区配对 `.unpacked` 解包成功，`patch.js`、`node --check` 与 `asar list` 6 文件校验通过，`File.Replace` 原子替换产出 `E17875BA...`，并在 ASAR 校验替换成功后才原子更新 `updaterCacheDirName` 且完整保留用户自定义键（`exit 0`）。
  - **用例 (b) 重复重铸（已有 `.bak` + 已符合配置 YAML）**：`PASS` — 仍从 `app.asar.bak` 解包重铸，`.bak` SHA256 与 mtime 保持不变，改装版备份为 `app.asar.modded_prev_*`，`app-update.yml` 执行零写入 NO-OP（SHA256 与 mtime 不变），产出 `E17875BA...`（`exit 0`）。
  - **用例 (d) 防备份污染门禁（无 `.bak` 且输入为已改装 `app.asar`）**：`PASS` — 白名单门禁识别出非官方输入，打印 `ALARM` 并以 `exit 4` 拒绝生成 `.bak`，未写入任何文件且原 `app.asar` 不变。
  - **用例 (e) 打包失败原子保护（真实解包/补丁后模拟 `asar pack` 返回 `19`）**：`PASS` — 模拟打包失败并写入垃圾字节至暂存区，脚本在校验前中止、清理临时目录、保持目标 `app.asar`（`5B493943...`）与非默认 `app-update.yml` SHA256 毫发未伤（`exit 19`）。
  - **R3 新增全场景故障注入（`23/23` 离线单测 + 真实官方夹具故障实测）**：`PASS` — 覆盖 `FileShare.None`/`FileShare.Read` 占用锁（`exit 10`）、替换后异常自动原子回滚（`exit 9` / `RECOVERED_AUTO`）、替换期间部分失败检测并安全回滚、替换后目标被锁定保留恢复材料（`exit 10` / `UNKNOWN/NEEDS_RECOVERY`）、`app.asar.unpacked` 首次/二次移动失败及后置校验失败自动回滚（`CONSISTENT_ORIG`）、回滚再次失败时 `finally` 物理保留唯一旧目录备份与人工恢复指引（`exit 11` / `FAILED_NEEDS_MANUAL_RECOVERY`）、以及 `install-or-update.ps1` / `repatch.ps1` 下 `app-update.yml` 写入/恢复故障事务一致性。

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
2. 检查 `<TargetAppDir>\` 下是否有运行中进程（有则列出 PID 并以 `exit 3` 退出，如实提示未替换 `app.asar` 且已保留既有可信官方 `.bak`，恢复状态 `ABORTED_PROCESS_RUNNING`，绝不杀进程）；
3. 先复制到同卷暂存文件 `.agm_restore_tmp_<时间戳>\app.asar.official_stage` 并校验 SHA256 一致；若当前存在 `resources\app.asar`，则归档至 `<TargetAppDir>\displaced_mod_<时间戳>\app.asar.mod_patched` 并校验归档文件 SHA256 与还原前目标一致；
4. 使用同卷 `[System.IO.File]::Replace`（保留替换前同卷备份 `app.asar.replace_bak`）原子还原至 `resources\app.asar`，并在 `try` 块内执行还原后 SHA256 复核；
5. 若替换抛错或还原后 SHA256 不一致，绝不直接以非原子覆盖破坏目标或先删除恢复材料：先检查目标存在性与哈希，若目标被锁定/不可读则保留全部可信材料并报告 `UNKNOWN/NEEDS_RECOVERY`（`exit 10`）；若检测到目标缺失或哈希不一致，则从已校验的 `app.asar.replace_bak` 或 `app.asar.mod_patched` 通过同卷暂存 + `File.Replace` 原子安全回滚至还原前状态并二次校验（`RECOVERED_AUTO`）；若回滚再次失败，物理保留 `.agm_restore_tmp_*`、归档目录与 `.bak` 并报告 `FAILED_NEEDS_MANUAL_RECOVERY`（`exit 11`）；
6. **用户数据 100% 保留**：`UserData\`、`plugins\config.json`、`plugins\state\`、`plugins\packages\` 均不受影响。

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
5. **遇到以下退出码与恢复状态立即停止**：
   - `exit 2 / 3 / 4 / 10`（锚点失效、进程运行、`.bak` 被污染或非官方、文件占用锁或 `UNKNOWN/NEEDS_RECOVERY`）
   - `exit 11`（`FAILED_NEEDS_MANUAL_RECOVERY`，必须按屏幕输出的人工恢复指引与保留的 `.agm_*_tmp_*` 目录恢复，严禁删除暂存备份）。

---

## 8. 自动恢复 vs 必须人工介入场景边界

| 失败场景 | 退出码 | 恢复状态 (`RECOVERY_STATE`) | 一致性状态 (`CONSISTENCY_STATE`) | 能否自动恢复 | 处理策略与人工操作指引 |
|---|---|---|---|---|---|
| 注入锚点缺失 / `app-update.yml` 非失效 URL / `node --check` / `asar extract` / `asar pack` / `asar list` 校验失败 | `2 / 5 / 7 / 13 / 17 / 19` | `CLEAN_NO_CHANGE` | `CONSISTENT_ORIG` | **自动清洁中止** | 未触碰目标 `app.asar`、`unpacked` 与活动 `app-update.yml`；自动清理临时区即可 |
| 替换前即检测到目标被占用 (`FileShare.None`) 或替换时触发 `FileShare.Read` 读共享锁（已实测目标哈希未变） | `10` | `CLEAN_NO_CHANGE` | `CONSISTENT_ORIG` | **自动清洁中止** | 目标 `app.asar` 与 YAML 100% 未改，关闭占用进程后重试 |
| `File.Replace` 成功后异常 / 替换期间部分写入失败 / `unpacked` 首次或二次移动失败 / `unpacked` 后置校验失败 / YAML 写入或部分失败 | `9 / 10 / 12`（`restore` 为 `4 / 10`） | `RECOVERED_AUTO` | `CONSISTENT_ORIG` | **完全自动安全恢复** | 通过同卷暂存 + `File.Replace` + `[Directory]::Move` 原子回滚至操作前原状态并二次校验 SHA256，三者一致回退 |
| `File.Replace` 抛出错误或替换完成后目标被外部锁定、SHA256 无法读取 | `10` | `UNKNOWN/NEEDS_RECOVERY` | `UNKNOWN_STATE` | **必须人工介入** | 物理保留 `app.asar.replace_bak`、`app.asar.prev_*`/`modded_prev_*` 或 `displaced_mod_*`；关闭占用进程后核对 SHA256 并用保留备份执行 `[System.IO.File]::Replace` |
| 自动回滚再次失败（`app.asar` 回滚失败、`unpacked` 回滚失败/被锁、或 YAML 恢复失败） | `11` | `FAILED_NEEDS_MANUAL_RECOVERY` | `INCONSISTENT_*` | **必须人工介入** | `finally` 物理禁止删除 `.agm_repatch_tmp_*` / `.agm_restore_tmp_*`，完整保留唯一旧 `app.asar.unpacked.orig_bak`、`app-update.yml.orig_bak` 与 `app.asar.replace_bak`；解除占用后按输出命令手工恢复 |
| 检测到运行中客户端/Sidecar 进程 | `3` | `ABORTED_PROCESS_RUNNING_BACKUP_CREATED`（`repatch.ps1` 先创建了可信 `.bak` 时）或 `ABORTED_PROCESS_RUNNING` | `CONSISTENT_ORIG` | **需用户关闭进程** | 未替换 `app.asar`、绝不强杀进程；如实提示已创建或已保留可信官方 `.bak`（无备份时不提备份），请用户正常退出客户端后重试 |
| 现有 `app.asar.bak` 被污染或缺失 `.bak` 时目标不是白名单官方原版 | `4` | `CLEAN_NO_CHANGE` | `CONSISTENT_ORIG` | **必须人工补齐官方原版** | 从官方 2.32.1 安装目录提取纯净 `app.asar`（`5B493943...`）替换 `app.asar.bak` 或移除污染 `.bak` 后重试 |
