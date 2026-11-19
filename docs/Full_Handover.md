# 阶段交接文档（Full Handover）

- 文档编号：RELEASE_AUDIT_01 阶段交接
- 审计对象：`main` @ `a8e9c19c5f01a210987e123bc0aa09beab6f6532`（PR #4 合入后，2026-11-19 07:24 北京时间）
- 审计日期：2026-11-19（北京时间）
- 审计方式：只读审计。审计期间未修改 `main`，未打 Tag，未发 Release。本文档是审计后唯一新增的文件。
- 标记 `UNKNOWN` 的内容表示审计时没有拿到证据，不代表没有问题。

---

## 当前状态（2026-11-19 PR #8 R3 更新）

> 以下为 `main` @ `d9dad3f` 之后截至 `AGM-PR8-HARDENING-R3`（分支 `dev/release-hardening-01`）的最新进展摘要；下文第 1–7 节仍**完整原样保留** `RELEASE_AUDIT_01`（`a8e9c19`）的历史审计记录供对照追溯。

- **当前基线与发行状态**：`main` 已合入 PR #5（CI `offline-tests`）、PR #6（本交接文档）与 PR #7（安装/发布文档、脚本去初稿化、基线 `d9dad3f`），标签 **`platform-v2.1.0`** 指向 `d9dad3f`（Pre-release）；尚未发布正式稳定版，也尚未发布独立插件版本。PR #8（`dev/release-hardening-01`，R3 代码/测试提交 `5a24044` 及本轮文档/清单对齐提交，本地尚未推送远端）正在修复 Work 独立审计发现的发行阻断项。
- **PR #8（Round 1–3）核心加固内容**：
  1. **P0 原子替换与异常恢复（[`platform/mod_kit/repatch.ps1`](../platform/mod_kit/repatch.ps1)、[`platform/scripts/restore-official.ps1`](../platform/scripts/restore-official.ps1)）**：移除 `Move-Item`，改用同卷暂存 + `[System.IO.File]::Replace` 并校验替换后 SHA256；替换抛错后**绝不凭异常类型推断原文件未变化**，而是先实测核验目标状态与恢复材料完整性，再决定是否清理快照；目标被锁/不可读时保留全部可信恢复材料并报告 `UNKNOWN/NEEDS_RECOVERY`（`exit 10`）；可安全回滚场景以同卷暂存 + `File.Replace` 原子恢复并二次校验 SHA256（`RECOVERED_AUTO`）；回滚再次失败时进入 `FAILED_NEEDS_MANUAL_RECOVERY`（`exit 11`），绝不清理唯一可用备份。默认官方白名单严格锁定 Antigravity `2.32.1` 纯净底座 `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`（旧版预置汉化包 `98A4308C...` 为旧改装基准，严禁视为官方原版），缺失或污染 `.bak` 一律报警 `exit 4`。
  2. **P0 `app.asar.unpacked` 目录状态机与 `finally` 物理保留（`repatch.ps1`）**：目录互换全程追踪显式状态（`NOT_STARTED -> ORIG_MOVED_TO_BACKUP -> NEW_MOVED_IN -> VERIFIED_NEW`），兼容 `>260` 字符长路径；新目录迁移或后置校验失败优先把 `app.asar.unpacked.orig_bak` 移回原位并联动回滚 `app.asar`；`finally` 物理守卫严禁在恢复未完成时删除仍含唯一恢复材料的 `.agm_repatch_tmp_*` 目录，确保不出现未经报告的不一致状态，失败时输出可执行人工恢复命令。
  3. **P1 `app-update.yml` 事务一致性（`repatch.ps1`、[`platform/mod_kit/agm_locks.js`](../platform/mod_kit/agm_locks.js)、[`platform/scripts/install-or-update.ps1`](../platform/scripts/install-or-update.ps1)）**：操作前记录 YAML 存在性与 SHA256；通过 `--update-yml-out` 与 `-StagedUpdateYmlPath` 保证**在 ASAR 与 `unpacked` 校验替换完成前绝不修改活动 YAML**；已符合锁定配置时执行真 NO-OP（零写盘）；更新时采用外科式行替换保留用户自定义键与注释；兼容首次安装无 YAML 情况；安装或重铸失败时自动还原操作前 YAML 状态且不残留多余 `.bak_*`。
  4. **P1 Manifest 原始 Git Blob 字节一致性与 CI 补全（[`manifest.repo.json`](../manifest.repo.json)、[`.github/workflows/test.yml`](../.github/workflows/test.yml)）**：将 Git 对象库中残留 CRLF 的 `app-update.template.yml`（259 字节）与 `rollback.bat`（174 字节）统一为纯净 LF Blob；按 `git cat-file blob` 与 `git archive` 原始字节全量重算清单，并正式纳入 `tests/test_repatch_unit.js`、`tests/test_fault_injection.js`、`tests/test_manifest_integrity.js` 与 `docs/WINDOWS_TEST_EVIDENCE.md`。全部测试脚本已接入 Windows / Ubuntu 双矩阵 CI。
  5. **R3 补丁：`exit 3` 提示与恢复状态如实化（`repatch.ps1`、`restore-official.ps1`、`install-or-update.ps1`）**：修复脚本可能在创建可信官方 `.bak` 后因目标进程运行而 `exit 3` 却提示“没有变更 / `CLEAN_NO_CHANGE`”的问题；不改变执行顺序，改为如实区分 `ABORTED_PROCESS_RUNNING_BACKUP_CREATED`（`repatch.ps1` 本轮已创建可信官方 `.bak`）与 `ABORTED_PROCESS_RUNNING`（保留既有备份或无备份中止），同步补充 `tests/test_fault_injection.js`（`FI-P1..FI-P3`，总数增至 26/26，全套单测 87/87 PASS）并在隔离官方夹具（`5B493943...`）完成 5 场景实跑验证（见 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md) 第 6.4 节）。
- **最新实测结果（Windows 10 / PS 5.1.19041.3803 / Node v26.13.1 / asar v4.3.2，详见 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md) 第 5–6 节）**：
  - **纯离线单元测试与故障注入**：`test_host_unit.js` **15/15 PASS**、`test_reaper_unit.js` **16/16 PASS**、`test_update_lock.js` **11/11 PASS**、`test_repatch_unit.js` **14/14 PASS**、`test_fault_injection.js` **23/23 PASS**、`test_manifest_integrity.js` **5/5 PASS**（共 **84 项**全绿；Linux 模拟 `test_repatch_unit` 2/2 与 `test_fault_injection` 2/2 均通过并明确跳过 Windows 专用例；远端 Windows/Ubuntu CI **待推送后由编程确认**）。
  - **安装与两轮升级回归**：隔离副本实测 **20/20 PASS**（30 个平台文件逐字节一致、12 个用户文件 SHA256 全程不变、64 项快照两轮零差异严幂等）。
  - **纯净官方底座（`5B493943...`）实机回归与真实故障注入**：`R3-REG-A..E`、`R3-P0-1a/1b` 占用锁、`R3-P0-2` 防污染、`R3-REAL-FI-*` 真实 `@electron/asar` 故障注入共 **14/14 PASS**（首轮重铸产出 `E17875BA...`，`.bak` 恒为 `5B493943...`）。
  - **自动恢复 vs 人工介入边界**：已在 [`docs/INSTALL.md`](INSTALL.md) 第 8 节明确划分。
  - **隔离客户端与热重载**：早期客户端启动（`client_f`）与 AGM Hub 插件中心（`client_g`）为 **PASS**；`F5` 热重载配置生效（`client_h`）继续诚实记为 **UNKNOWN**（不在 PR #8 修复范围）。
  - **D 盘官方目录与进程安全**：`D:\AI_Studio\Apps\Antigravity\` 及 `UserData` 全程只读零修改；实测结束后隔离测试目录无任何残留进程。

---

> 以下为 `RELEASE_AUDIT_01`（基线 `a8e9c19`）历史审计记录原文：

---

## 1. 项目定位

- **只做插件平台。** 本仓库发行 Antigravity 的外置插件平台（插件宿主、补丁注入工具、安装与还原脚本）和插件源码。**不发行任何官方或修改版 Antigravity 可执行文件**，也不发行 `.exe`、`.dll`、`.pak`、`app.asar`、`node_modules`。
- **更新不覆盖用户数据。** `UserData/`、`plugins/config.json`、`plugins/state/`、`plugins/packages/` 属于用户。任何平台或插件更新都不得覆盖或删除这些内容。
- **小更新原地可用，大更新可要求重新下载。** PATCH / MINOR 版本必须让平台原地继续可用；MAJOR 版本可以要求重新下载平台，但仍不得覆盖或删除用户数据（见 [`docs/versioning.md`](versioning.md)）。
- **许可证。** 平台以 MIT 授权（根目录 `LICENSE`，Copyright (c) 2026 wangxu1428）。每个插件自选许可证，记录在插件索引的 `license` 字段。
- **非官方声明。** 本项目为非官方项目，与 Antigravity 的制作者没有关联，未获其认可或背书，且不包含、不分发任何 Antigravity 官方程序文件。

## 2. 目录结构（`main` @ `a8e9c19` 实际内容，共 57 个跟踪文件）

```text
Antigravity_Mod/
├── README.md / LICENSE / CHANGELOG.md / CONTRIBUTING.md / .gitignore
├── manifest.repo.json                  # 平台版本与文件 SHA256 清单（48 条哈希，审计时全部吻合）
├── platform/                           # 平台核心，跟 platform-vX.Y.Z 一起发
│   ├── README.md
│   ├── agm-plugin-host.js              #   插件宿主 v2.1.0
│   ├── config.default.json             #   默认配置模板（不是用户配置）
│   ├── mod_kit/                        #   patch.js、agm_locks.js、agm_sidecar_reaper_core.js、
│   │                                   #   repatch.ps1、repatch.bat、app-update.template.yml
│   └── scripts/                        #   install-or-update.ps1、restore-official.ps1、启动爆改版.bat、
│       └── legacy-rollback/            #   实验室回滚归档（README、rollback.ps1、rollback.bat；禁用于生产）
├── plugins/
│   ├── README.md
│   ├── builtin/                        # 内置插件，随平台发行
│   │   ├── hakimi-i18n/                #   hakimi-i18n.js + 模块源码 hakimi-i18n/（core、adapters、ui、custom、locales/zh-CN 共 7 个词典）
│   │   └── ai-sidedock/                #   ai-sidedock.js
│   └── optional/                       # 非内置插件，经索引分发
│       └── agm-hello-guard/            #   示例插件（manifest.json、index.js）
├── plugin-api/README.md                # 插件 API 规范（状态：待定，尚未编写）
├── index/                              # 插件索引 plugins.json、plugins.schema.json、README.md
├── docs/                               # README、versioning、ARCHITECTURE、WHITEPAPER、PLUGIN_DEV_GUIDE、本文档
└── tests/                              # test_host_unit.js、test_reaper_unit.js、test_update_lock.js、fixtures/agm-fault-probe/
```

用户机器上的运行时布局没有因为仓库重组而改变，安装脚本把仓库文件复制回原来的位置（`<应用目录>/plugins/*.js`、`plugins/hakimi-i18n/`、`plugins/repo/<id>/`、`mod_kit/`），映射见根目录 `README.md`「运行时布局」。

## 3. 版本

- 平台代码版本：2.1.0（宿主 2.1.0，`manifest.repo.json` 记录已验证 Antigravity `2.32.1`、`2.33.0` / Electron 44.9.1）。
- 内置插件：`hakimi-i18n` 1.1.0（词典 1.14.0），`ai-sidedock` 1.1.0。可选示例插件：`agm-hello-guard` 1.0.0。
- **尚未打任何 Tag，尚未建任何 Release，也没有带 SHA256 的发行包。** `CHANGELOG.md` 只有 `[Unreleased]` 段。
- 计划的标签格式：平台 `platform-vX.Y.Z`；插件 `plugin-<id>-vX.Y.Z`。标签只打在已合入 `main` 的提交上。
- 插件索引 `index/plugins.json`：`plugins` 数组为空，`examples` 里只有一条格式示范（`example-plugin`，下载地址为保留域名 `example.invalid`，SHA256 为全零占位）。

## 4. 安全边界

### 4.1 仓库红线

- 不 force push，不直接推送 `main`，不改写已推送的公共历史。
- 不上传密钥、令牌、个人数据、官方 EXE 或 `app.asar`、`UserData/`、缓存、临时文件、备份。
- 不扫描、不触碰任何 `02_Personal/` 目录（`.gitignore` 已排除）。
- 未经旭批准，不合并进 `main`，不打 Tag，不发 Release，不改仓库设置。已合并进 `main` 的旧分支，经核对内容都在 `main` 后可以先删后报（旭已同意的长期规矩）。

### 4.2 `main` 保护现状

- 已开启：必须通过 PR 合入；禁止 force push；禁止删除 `main`。
- 未开启：对管理员生效（enforce_admins 关闭），所以仓库主人账号在技术上仍能直接推 `main`。旭已决定暂不修改保护规则，各方按规矩一律走 PR。

### 4.3 谁能合并、谁能发版

只有旭能批准合并进 `main`、打 Tag、发 Release、修改权限与仓库设置。其他角色只能提 PR 和准备方案。

## 5. 协作分工

| 角色 | 负责范围 |
| --- | --- |
| 仓库管理员 | 远程仓库：分支、PR 审核、版本号、CHANGELOG、Tag 与 Release 的准备、插件索引、远程备份核对 |
| 编程 | 本地开发与测试（含 Windows 实机测试） |
| 清道夫 | 本地文件整理 |
| 旭 | 最终批准：合并 `main`、发版、权限与设置 |

默认使用本地工具（盒子上的 git/gh、opencode、dsh，旭电脑上的 agy），不使用云端代理；确需使用必须先报批。

## 6. 发行审计结论（RELEASE_AUDIT_01）

**结论：CONDITIONAL（有条件通过）。** 仓库内容完整、干净，离线测试全部通过；但安装说明和 Windows 实机测试还不足以让陌生人安全安装，下方「阻断项」处理完之前，不建议把 `main` 标记为首个公开测试版（如 `platform-v2.1.0` 预发布）。

### 6.1 已有证据（引用，未重做）

- 隐私 / 敏感信息扫描：MIGRATION_02 已完成（报告路径：UNKNOWN）。
- exe/dll/asar/UserData 排查与逐字节核对：PR #3 合入后（`11d03ab`）核对 57 个跟踪文件，44 个与 v2.1.0 暂存清单逐字节一致，LICENSE / README / .gitignore 按约定合并；PR #4 合入后（`a8e9c19`）复核 57 个文件，树与审过的分支一致。
- `main` 保护设置：见 4.2，旭决定不改。
- 自动测试：PR #5（`dev/ci-tests`，head `c34c29f`，状态 OPEN、未合并）的 CI `offline-tests` 在 ubuntu-latest 与 windows-latest 上均为 pass。`main` 上目前还没有 CI 工作流。

### 6.2 本次新做的检查

- **完整性：** `11d03ab` 的 57 个文件在 `a8e9c19` 全部能在旧路径或新路径找到，缺失 0、多出 0；其中 39 个内容完全不变（纯移动或原地未动），18 个有改动（路径引用与说明更新）。平台源码、插件宿主、`plugin-api/`、`index/`、`tests/` 均在。
- **内部引用：** `manifest.repo.json` 48 条文件路径全部存在、SHA256 全部吻合；安装脚本引用的源路径（`platform/`、`platform/mod_kit/` 5 个文件与模板、`plugins/builtin/`、`plugins/optional/`、`启动爆改版.bat`）全部存在；测试按 `REPO_ROOT` 引用 `platform/` 下文件，可正常运行；仓库内全部 Markdown 相对链接无断链。
- **PR #4 增量排查：** 18 个改动文件（无新增文件）均为文本，未发现密钥、令牌、邮箱或个人绝对路径；路径一律使用 `%APPDATA%`、`%OFFICIAL_APP_DIR%`、`<TESTLAB_ROOT>` 等占位。全仓库无 exe/dll/asar/pak/压缩包。
- **离线测试重跑（Node v24.22.1）：** host 15/15、reaper 16/16、update_lock 9/9，全部通过。

### 6.3 文档是否足够安全安装

- 数据保护规则写得清楚（README、`platform/README.md`、`plugins/README.md` 一致），安装脚本代码层面也拒绝写入四个用户数据区。
- **不足：** 没有一份写给陌生人的「安装 / 升级 / 回滚」操作说明。具体缺：前置条件（需要一份独立的 Antigravity 程序副本作为应用目录，含 `Antigravity.exe` 与 `resources/`；需要 Node 与 `asar` 或 `npx`）；安装脚本参数（`-TargetAppDir`、`-SkipRepatch`、`-DryRun`）在任何 Markdown 里都没有说明；**脚本不带参数运行时会装到正式目录 `C:\Antigravity_Mod` 并自动运行 repatch 重铸 `app.asar`**，文档没有提示；没有说明「直接把仓库目录当应用目录不能用，必须走安装脚本」（只在 README 里间接提到）；平台回滚只有 `restore-official.ps1` 还原 `app.asar`，没有说明如何回到上一个平台版本。
- Windows 实机测试：编程在 `C:\AGM_TestLab\INSTALL_TEST_01` 用 `-TargetAppDir` 与 `-SkipRepatch` 实测，结果：UNKNOWN（待回报）。repatch 与 `restore-official.ps1` 的真实运行：未测。

## 7. 待办（缺口列表，按优先级）

### 阻断项（打首个公开测试版前必须完成）

1. **拿到并核对 `install-or-update.ps1` 的 Windows 实测结果**（INSTALL_TEST_01：全新安装、覆盖更新、用户数据保留）。当前 UNKNOWN。
2. **补一份安装 / 升级 / 回滚说明**（README 或 `docs/INSTALL.md`）：前置条件、参数、推荐先 `-DryRun`、测试目录用 `-TargetAppDir` + `-SkipRepatch`；**醒目标出「不带参数 = 装到 `C:\Antigravity_Mod` 并自动重铸 `app.asar`」**；说明必须走安装脚本；说明如何用 `restore-official.ps1` 还原、如何回到上一版平台。
3. **repatch 与还原路径**：要么在测试目录实测一次 `repatch.ps1` 与 `restore-official.ps1`，要么在发版说明里明确标为「未实测、实验性」。另需写明：`repatch.ps1` 在找不到 `app.asar.bak` 时会把当前 `app.asar` 当作原厂备份，若当前文件已被打过补丁，备份就不是原版。
4. **准备发版材料**：在 `CHANGELOG.md` 切出 `[2.1.0]` 段并写发版说明（含预发布性质与上述风险）；Tag `platform-v2.1.0` 与 Release 由旭批准后再做。

### 非阻断项

5. 合入 PR #5，让 `main` 有 CI（目前 PR #5 CI 通过但未合并）。
6. 插件索引 `plugins` 为空，示例条目 `platformCompatibility` 为 `>=0.1.0 <1.0.0`，与平台 2.1.0 对不上，容易误导；也还没有任何带 SHA256 的发行包。
7. `plugin-api/README.md` 写着「规范尚未编写」，而 `docs/PLUGIN_DEV_GUIDE.md` 已经描述了 Manifest 与 Worker API，两处口径要统一。
8. `install-or-update.ps1`、`restore-official.ps1` 文件头仍标「初稿」。
9. `docs/ARCHITECTURE.md` 含实验室专用内容（受保护进程 PID `4268` / `15440` / `3580`、D 盘原版、实验室阶段流程），不涉密，但对陌生人有误导，建议标注为实验室记录。
10. `.gitignore` 有几条较宽的规则（任意位置的 `config.json`、`resources/`、`*.bin`、`Preferences`），以后新增同名正常文件会被悄悄忽略，提交时需留意。
11. `main` 保护未对管理员生效（旭已决定维持现状），靠规矩约束不直接推 `main`。
12. MIGRATION_02 报告的存放位置：UNKNOWN，建议补记。


## 8. 最终阶段记录（AGM-GITHUB-HANDOVER-SYNC-01）

- **执行时间**：2026-11-20（dsh，云端 Linux 盒子）。
- **执行范围**：仅在 PR #10 现有分支新增 `evidence/` 证据文件、在 `docs/` 新增 3 份最终报告与 3 张预览、追加本节、追加 PR #10 描述，并执行普通 commit + 普通 push。未修改产品源码、测试代码、授权模块、`manifest.repo.json` 或正式 IDE；未修改 `main`；未新建 PR；未合并；未取消 Draft；未创建 Tag/Release；未 force push、amend、rebase；未删除任何历史文件。
- **只读基线**：`main` = `923110e60cdb928b41a28ad2994f71bbed4bf730`；PR #10 = `OPEN` + `Draft` + 未合并 + `mergeable=MERGEABLE`，head 分支 `dev/compat-233-stage-b` @ `29600a9a8b1b40051ea988c97e81871f423dbcb6`；开放 PR 仅 #10；Tag 仅 `platform-v2.1.0`；Release 仅 `platform-v2.1.0（首个公开测试版）` 预发布；远程分支 head 与本地克隆一致。基线证据见 `evidence/baseline_before.json`。

### 8.1 IPC 安全验证

- **IPC-SEC-01**：13 个 `hakimi:*` 通道由 `secureHandle` 默认拒绝；IPC 安全测试 **25 PASS / 0 FAIL / 0 SKIP**；真实 Electron **9 PASS / 0 FAIL**；CI run `44548574146` @ `84dc8e9` 双 job success（Ubuntu 111 PASS / 0 FAIL / 1 SKIP，Windows 148 PASS / 0 FAIL / 0 SKIP）。
- **REALBASE-A01**：发现 C-6 SSH 窗口越权链路 **0 / 13**（Electron `44.9.1` 下 `additionalArguments` 未定义，原判定在读不到时默认放行）。
- **C6-FIX-01**：在 `2.32.1` / `2.33.0` 双版本上，C-6a/b/c/d 均 **13 / 13 拒绝**、**0 副作用**；合法 IPC **11 / 11** 成功；A01 非法调用回归 **31 / 31** 拒绝；冷启动 **2 / 2**；正式 IDE 关键文件 **8 / 8 无变化**（KeyFileChanges=0）；本地单测 **153 / 0 / 0**。
- **最终 CI**：run `44569636560`（`offline-tests`，`run_number: 19`）@ `29600a9` 结论 success；Ubuntu job `135720835573` = **116 PASS / 0 FAIL / 1 SKIP**；Windows job `135720836179` = **153 PASS / 0 FAIL / 0 SKIP**。
- **CLOSEOUT-01 审计**：交接口径 **8 / 8**。`input` 证据中的 `consistency_audit.txt` 实际列出 **19 条 `[PASS]`** 且全部通过（该文件未单列 8/8 分母），此处按交接口径记录并注明差异。
- 上述数值以 `input/evidence/` 与 `input/reports/` 原文为准；如与交接说明有出入，以报告原文为准。

### 8.2 真实 UI 回归（USER-CONFIRMED）

以下 4 项为用户本人实机交互测试后提供的人工回归反馈，标记为 **USER-CONFIRMED**，不是自动化 GUI 测试结果：

| # | 人工回归场景 | 用户实测结论 | 状态 |
| --- | --- | --- | --- |
| 1 | 关闭应用并完全退出，再启动，插件正常加载 | 正常加载 | **USER-CONFIRMED** |
| 2 | 强制刷新页面，插件正常恢复 | 正常恢复 | **USER-CONFIRMED** |
| 3 | 托盘新建窗口，插件功能正常 | 功能正常 | **USER-CONFIRMED** |
| 4 | 切换不同对话，功能正常 | 功能正常 | **USER-CONFIRMED** |

**UI 回归通过不代表全部安全测试通过。**

### 8.3 证据归档

- **A01**：27 个文件，6,192,511 字节（26 个解包文件 + 1 个原版证据 ZIP）。
- **C6_FIX**：32 个文件，6,342,714 字节（31 个解包文件 + 1 个原版证据 ZIP）。
- **CLOSEOUT**：31 个文件，233,849 字节。
- **合计**：**90 个文件 / 12,769,074 字节**；`input/evidence_SHA256SUMS.txt` 逐文件校验 **90 / 90 OK**；两个 ZIP 容器成员与解包文件交叉核对 **26 / 26、31 / 31 一致**；内部 SHA256 清单交叉比对 **17 MATCH / 33 N/A / 0 MISMATCH**（N/A 为 PC 端文件或 worktree 备份，不在本证据集）。
- **安全扫描**：96 个文件（90 证据 + 3 报告 + 3 预览）完成密钥/令牌/Cookie/Authorization/UserData/安装包/超大二进制/`02_Personal` 路径扫描，结论 **PASS**，**SECURITY-HOLD = 0**；仅发现 GitHub Actions 日志中被 CI 自身脱敏的 `AUTHORIZATION: basic ***` 一处误报，未改原件。详见 `evidence/security_scan.txt`。
- **仓库内目录结构**：

```text
evidence/
├── IPC_REALBASE_A01/   (27 files, 6,192,511 B)
├── IPC_C6_FIX_01/      (32 files, 6,342,714 B)
└── IPC_C6_CLOSEOUT_01/ (31 files, 233,849 B)
docs/
├── AGM_EVIDENCE_ARCHIVE_A01_report.md / _preview.png
├── AGM_CLEANUP_READONLY_AUDIT_01_report.md / _preview.png
└── AGM_CLEANUP_DELETE_A01_C6_01_report.md / _preview.png
```

### 8.4 历史清理

- 据 `AGM_CLEANUP_DELETE_A01_C6_01` 报告：`docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` 与 `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` 两份冗余原始 ZIP 已通过 `SHFileOperationW`（`FOF_ALLOWUNDO`）移入回收站 / Drive 垃圾箱。
- 活跃 `docs/` 目录因此减少 **5,439,056 字节**（约 5.19 MiB，2,713,318 + 2,725,738）。
- `evidence/` 下 **90 个文件全部保留**，删除前后 SHA256 变化 0；2.33.0 安装包 `Antigravity-x64.exe` 与 `app-64.7z` 保留。
- `/workspace/agm/` **未清理**，状态 **BLOCKED**（该路径仅存在于云端 Linux 盒子，Windows 实机/WSL 不可达，证据不足）。

### 8.5 未完成事项

1. **真实 SSH E2E：NOT RUN**（本轮仅验证构造的 SSH 窗口拒绝路径与标记逻辑）。
2. **`updater:*` 统一授权：NOT DONE**。
3. **`/workspace/agm/`：BLOCKED**（未清理，需在对应 Linux 盒子上另行只读盘点后再决策）。
4. **2.33.0 正式发布资格：尚未通过**（PR 保持 Draft，未合并、未打 Tag、未发 Release）。
5. 再次强调：**UI 回归通过不代表全部安全测试通过**；在上述未完成项闭环前，不得把本轮结果表述为 2.33.0 已可正式发布。
