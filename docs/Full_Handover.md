# 阶段交接文档（Full Handover）

- 文档编号：RELEASE_AUDIT_01 阶段交接
- 审计对象：`main` @ `a8e9c19c5f01a210987e123bc0aa09beab6f6532`（PR #4 合入后，2026-11-19 07:24 北京时间）
- 审计日期：2026-11-19（北京时间）
- 审计方式：只读审计。审计期间未修改 `main`，未打 Tag，未发 Release。本文档是审计后唯一新增的文件。
- 标记 `UNKNOWN` 的内容表示审计时没有拿到证据，不代表没有问题。

---

## 当前状态（2026-11-19 更新）

> 以下为 `main` @ `d9dad3f` 之后的最新进展摘要；下文第 1–7 节仍**完整原样保留** `RELEASE_AUDIT_01`（`a8e9c19`）的历史审计记录供对照追溯。

- **当前基线与发行状态**：`main` 已合入 PR #5（CI `offline-tests`）、PR #6（本交接文档）与 PR #7（安装/发布文档、脚本去初稿化、`manifest.repo.json` 按 LF 重算），当前基线提交为 `d9dad3f`。标签 **`platform-v2.1.0`** 已指向 `d9dad3f` 并作为首个公开测试版（Pre-release）发布；尚未发布正式稳定版，也尚未发布独立插件版本。
- **本次发行加固（`AGM-RELEASE-HARDENING-01`，分支 `dev/release-hardening-01`）**：
  1. **加固 [`platform/mod_kit/repatch.ps1`](../platform/mod_kit/repatch.ps1)**：对 `asar extract`、`asar pack`（含 `npx asar` 回退）、`asar list` 显式校验 `$LASTEXITCODE`；修复原脚本在缺失 `app.asar.bak.unpacked` 时静默忽视 `asar extract` 报错导致丢失 `chrome-devtools-mcp` 的隐患（临时区自动配对 `app.asar.unpacked` 后解包）；先打包至 `resources\.agm_repatch_tmp_<时间戳>\app.asar` 并完成存在性/非零大小、`asar list` 6 个关键注入文件、`node --check` 与 SHA256 校验；校验全部通过后再备份 `resources\app.asar.prev_<时间戳>` 并以 `Move-Item` 原子替换且二次比对 SHA256；任意步骤失败自动清理临时目录、保持原 `app.asar` 不变、非 0 退出且不打印成功；新增可选 `-TargetAppDir`/`-AppDir` 参数，并在成功与失败时输出回滚命令；[`platform/mod_kit/repatch.bat`](../platform/mod_kit/repatch.bat) 同步透传 `%*`。
  2. **新增离线单元测试 [`tests/test_repatch_unit.js`](../tests/test_repatch_unit.js)**（RP1–RP7，7/7 PASS）：无需真实 `asar`，覆盖 `pack`/`extract` 失败、0 字节产物、`asar list` 缺项、`.unpacked` 临时配对以及正常原子替换与回滚提示。
  3. **文档对齐与分工边界**：更新 `CHANGELOG.md`（按 `platform-v2.1.0` @ `d9dad3f` 重新划分 `[2.1.0]` 与 `[Unreleased]`）、`docs/versioning.md`、`docs/INSTALL.md`、`docs/ARCHITECTURE.md`、`docs/README.md`，新增 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md)。本次未改动 `manifest.repo.json`（由仓库管理员按 LF 统一重算）、未改动 `plugins/` 代码、未推远端或改 `main`。
- **最新实测结果（Windows 10 / PS 5.1 / Node v26.13.1 / asar v4.3.2，详见 [`docs/WINDOWS_TEST_EVIDENCE.md`](WINDOWS_TEST_EVIDENCE.md)）**：
  - **纯离线单元测试**：`test_host_unit.js` 15/15 PASS、`test_reaper_unit.js` 16/16 PASS、`test_update_lock.js` 9/9 PASS、`test_repatch_unit.js` 7/7 PASS（共 47/47 PASS）。
  - **安装与两轮升级**：重跑隔离副本实测 `20/20 PASS`（30 个平台文件一致、12 个用户文件 SHA256 全程不变、严格幂等）。
  - **新版 `repatch.ps1` + `restore-official.ps1`**：Case (a) 首次重铸（`exit 0`，产出 `6F60316D...`）、Case (b) 重复重铸（`exit 0`，`.bak` 哈希与修改时间不变）、Case (c) 官方还原（`exit 0`，还原回 `98A4308C...`）、Case (d) 备份污染复现（`exit 2`）、Case (e) 打包失败保护（`exit 19`，原 `app.asar` 哈希不变）全部 **5/5 PASS**。
  - **隔离客户端实机验证**：更新锁前置门禁 PASS；客户端以 `--user-data-dir` 独立空目录启动并稳定存活 36s+ 出现主窗口（**PASS**）；通过侧边栏「插件中心」入口打开并截屏验证 AGM Hub v2.1.0 界面（**PASS**）；`F5` 热重载已由运行日志与插件日志证实触发重新初始化，但因 `hakimi-i18n` teardown 不还原已汉化 DOM 且不打印 `enabled`/`customOverrides` 新值，无法闭环确认修改配置生效，诚实标为 **UNKNOWN**。
- **待跟进遗留项**：由仓库管理员合入前按 LF 重算 `manifest.repo.json` 哈希；补充插件中心无障碍/热重载配置生效日志以便非交互式桌面环境可自动化闭环校验；完善 `index/plugins.json` 正式插件与 CI 覆盖 `test_repatch_unit.js`。

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

- 平台代码版本：2.1.0（宿主 2.1.0，`manifest.repo.json` 记录兼容 Antigravity 2.32.x / Electron 44.9.1）。
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
