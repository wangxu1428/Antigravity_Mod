# Antigravity_Mod (AGM Plugin Platform v2.1.0)

**Antigravity 独立插件平台、深度中文化引擎与非破坏式重铸工具箱**  
*A non-invasive external plugin host, Web Worker sandbox gateway, deep localization engine, and portable repatch toolkit for Antigravity IDE.*

---

## 核心设计底线与数据安全声明 (Core Design Baselines)

1. **只发行插件平台源码，绝不发行官方二进制**：本仓库分发 `platform/`（宿主 v2.1.0、默认配置模板、`mod_kit/` 轻量级补丁注入器 / 自动更新锁 / Sidecar 进程收割器，以及安装与启动脚本）和 `plugins/`（`builtin/` 内置插件、`optional/` 可选插件），以及 `tests/` 与 `docs/`，**不含任何官方 `.exe`、`.dll`、`.pak`、`app.asar` 或 `node_modules`**。
2. **平台与插件走统一仓库索引分发**：通过根目录 `manifest.repo.json` 统一记录平台/宿主版本、关键文件 SHA256 校验值以及 `plugins/optional/` 插件包列表。
3. **用户数据与平台升级生命周期严格隔离**：**用户数据存放在平台目录之外（或平台树内被 gitignore 的运行态位置），平台升级不得丢失用户配置、插件数据和个人状态**。
   - 仓库仅提供纯净脱敏模板 `platform/config.default.json`；
   - 运行态 `UserData/`、`plugins/config.json`、`plugins/state/`（含 `registry.json`、`configs/*.json`、`logs/*.log`）以及 `plugins/packages/`（用户已安装插件）均已被 `.gitignore` 严格排除并由安装/升级脚本设为只读保护区。
   - 仓库目录重组不改变用户机器上的加载位置。安装脚本把新源码路径复制回原来的运行时路径（见下方「运行时布局」），只复制，不删除。
4. **小更新热重载，大更新一键重铸**：
   - 日常更新宿主、汉化词典（`hakimi-i18n`）、侧边舱（`ai-sidedock`）或沙箱插件包时，无需重新打包 `app.asar`，在客户端内按 **`Ctrl+R` / `F5`** 即可秒级热重载生效。
   - 当官方客户端升级覆盖 `app.asar` 时，运行已安装的 `mod_kit/repatch.ps1`（或仓库里的 `platform/scripts/install-or-update.ps1`）即可从备份解包并重新注入底座插槽，全程保留用户配置与登录态。

---

## 仓库目录结构 (Repository Layout)

```text
Antigravity_Mod/
├── README.md                                  # 项目说明与数据隔离规范
├── LICENSE                                    # MIT 开源许可证（平台，Copyright (c) 2026 wangxu1428；插件自选许可证）
├── CHANGELOG.md                               # 变更记录
├── CONTRIBUTING.md                            # 贡献说明
├── .gitignore                                 # 排除官方二进制与用户运行态数据保护区
├── manifest.repo.json                         # 平台与插件源 SHA256 分发清单
├── platform/                                  # 平台核心
│   ├── README.md                              #   平台目录说明与源码→运行时映射
│   ├── agm-plugin-host.js                     #   AGM Plugin Host v2.1.0 + AGM Hub
│   ├── config.default.json                    #   纯净默认配置模板（不是运行态 config.json）
│   ├── mod_kit/                               #   补丁重铸工具箱
│   │   ├── patch.js                           #     8 锚点预检 + 13 个受限 hakimi:* IPC 注入器
│   │   ├── agm_locks.js                       #     AGM_UPDATE_LOCK (10 锚点) + AGM_SIDECAR_REAPER (4 锚点)
│   │   ├── agm_sidecar_reaper_core.js         #     会话级 Sidecar 进程树快照与单 PID 收割核心
│   │   ├── repatch.ps1                        #     非破坏式解包、注入、node --check 与重打包流水线
│   │   ├── repatch.bat                        #     Windows 双击重铸批处理入口
│   │   └── app-update.template.yml            #     自动更新封锁配置模板 (127.0.0.1:9 + 独立缓存目录)
│   └── scripts/                               #   安装、升级、还原与便携启动脚本
│       ├── 启动爆改版.bat                     #     便携式启动入口 (--user-data-dir="%~dp0UserData"；远程调试端口默认关闭)
│       ├── install-or-update.ps1              #     非破坏式安装/升级（把仓库源码复制到历史运行时路径）
│       ├── restore-official.ps1               #     从 app.asar.bak 安全还原官方原版
│       └── legacy-rollback/                   #     实验室历史快照回滚脚本归档（含未修复 $D/$d 缺陷警告，禁用于生产）
├── plugins/
│   ├── README.md
│   ├── builtin/                               # 随平台发行的内置插件
│   │   ├── hakimi-i18n/
│   │   │   ├── hakimi-i18n.js                 #   深度本地化引擎单文件构建产物 (v1.1.0)
│   │   │   └── hakimi-i18n/                   #   模块化源码、build.js 与 zh-CN 词典
│   │   └── ai-sidedock/
│   │       └── ai-sidedock.js                 #   AI Side-Dock 三巨头分屏侧边舱
│   └── optional/                              # 经索引分发、不内置的插件
│       └── agm-hello-guard/                   #   Web Worker 沙箱标准示例插件 (v1.0.0)
├── tests/                                     # 纯离线 Node.js 单元测试套件
│   ├── test_host_unit.js                      #   宿主 SemVer / Manifest / Schema / 权限网关单测
│   ├── test_update_lock.js                    #   自动更新锁离线注入与拦截单测 (UL1-UL7)
│   ├── test_reaper_unit.js                    #   Sidecar 进程收割器离线单测 (RU1-RU16)
│   └── fixtures/agm-fault-probe/              #   异常抛错与死循环超时隔离测试探针
├── docs/                                      # 安装手册、发布说明、架构文档与开发指南
│   ├── INSTALL.md                             #   安装、升级、官方还原与版本回滚指南（含 AI 助手护栏）
│   ├── RELEASE_NOTES_2.1.0.md                 #   v2.1.0 发布说明、实测验证状态与已知问题
│   ├── ARCHITECTURE.md                        #   AGM 插件插座与管理中心详细架构设计说明
│   ├── WHITEPAPER.md                          #   技术架构与算法公式白皮书
│   ├── PLUGIN_DEV_GUIDE.md                    #   Manifest v1、权限目录、configSchema 与 Worker API 开发指南
│   └── versioning.md                          #   平台与插件版本策略及 Git 标签规则
├── index/                                     # 插件索引（plugins 数组当前为空，examples 仅格式示范）
└── plugin-api/                                # 插件 API 规范说明（当前 v2.1.0 规范见 docs/PLUGIN_DEV_GUIDE.md）
```

### 运行时布局（用户机器，未改）

`hakimi:list-plugins` 只枚举 `<应用目录>/plugins/*.js`，`hakimi:list-packages` 只扫描 `plugins/repo/` 与 `plugins/packages/`。因此安装脚本把仓库里的新路径复制回这些历史位置，而不是让宿主改去读 `plugins/builtin` 或 `plugins/optional`：

| 仓库源码 | 运行时 |
| --- | --- |
| `platform/agm-plugin-host.js` | `<应用目录>/plugins/agm-plugin-host.js` |
| `platform/config.default.json` | `<应用目录>/plugins/config.default.json`（已有 `config.json` 不覆盖） |
| `platform/mod_kit/` | `<应用目录>/mod_kit/` |
| `plugins/builtin/<id>/<id>.js` | `<应用目录>/plugins/<id>.js` |
| `plugins/builtin/hakimi-i18n/hakimi-i18n/` | `<应用目录>/plugins/hakimi-i18n/` |
| `plugins/optional/<id>/` | `<应用目录>/plugins/repo/<id>/` |

已安装插件留在 `plugins/packages/<id>/`。升级不会删除该目录，也不会删除 `plugins/repo/` 里仓库未分发的其他插件。

---

## 快速使用与离线测试 (Quick Start & Offline Tests)

> 首次安装、升级、还原官方原版或回滚版本，请先阅读 **[安装指南 `docs/INSTALL.md`](docs/INSTALL.md)** 与 **[v2.1.0 发布说明 `docs/RELEASE_NOTES_2.1.0.md`](docs/RELEASE_NOTES_2.1.0.md)**（务必先以 `-DryRun` 预检并仅操作独立客户端副本，切勿改装日常主力安装）。

### 1. 运行纯离线单元测试（无需客户端，零生产写盘）
```bash
node tests/test_host_unit.js
node tests/test_reaper_unit.js
node tests/test_update_lock.js
```

### 2. 重新打包汉化引擎单文件（可选）
修改 `plugins/builtin/hakimi-i18n/hakimi-i18n/` 下的源码或词典后，可执行：
```bash
node plugins/builtin/hakimi-i18n/hakimi-i18n/build.js
```
构建脚本按源码目录的上一级写出 `hakimi-i18n.js`，产物路径是 `plugins/builtin/hakimi-i18n/hakimi-i18n.js`。

### 3. 客户端内快捷键
- **`Ctrl+Shift+M`**（或点击左侧边栏 **「插件中心」** 导航项）：打开/关闭 AGM Hub 插件管理中心。
- **`Ctrl+Shift+L`**：直接打开插件中心内嵌的「本地化配置」面板。
- **`Ctrl+R` / `F5`**：零重启热重载全部外置插件与配置。
- **`Ctrl+Shift+R`**：执行整页刷新。

### 4. 远程调试端口（默认关闭 / Remote debugging port, off by default）

公开发行的 `platform/scripts/启动爆改版.bat` **默认不会**打开 Chromium 远程调试端口。安装后它位于应用目录根。如需调试，可用以下任一方式按需开启（命令行参数优先于环境变量）：

```bat
set AGM_DEBUG_PORT=9224
启动爆改版.bat
```

或：

```bat
启动爆改版.bat --debug-port 9224
```

**风险：** 开启后，本机任意进程都可以连接到该调试端口，完全控制该应用，并读取会话、令牌等敏感数据。仅在需要调试时开启，切勿在共享或公用电脑上启用。

**Risk:** When enabled, any local process can attach to the debugging port, take full control of the app, and read sessions/tokens. Enable only for debugging; never on shared machines.

---

## English Summary

**Antigravity_Mod (AGM)** is an external plugin platform and localization suite for Antigravity IDE (compatible with v2.32.x / Electron 44.9.1).
- **No Proprietary Binaries**: Only the platform core (`platform/`, including `mod_kit/` and the host `platform/agm-plugin-host.js` v2.1.0), built-in plugins (`plugins/builtin/`), optional plugin packages (`plugins/optional/`), tests, and documentation are distributed.
- **Strict User Data Isolation**: **User data is stored outside the platform distribution directory (or in `.gitignore`-protected runtime paths within the installation tree); platform upgrades never overwrite or delete user configurations (`plugins/config.json`), plugin state (`plugins/state/`), installed packages (`plugins/packages/`), or browser profile data (`UserData/`).** The repository layout change does not move those runtime directories. The installer copies sources back onto the previous load paths and never deletes user files.

## 许可证

插件平台以 [MIT 许可证](LICENSE) 授权。每个插件可以自选许可证，并应记录在插件索引的 `license` 字段中（建议使用 SPDX 标识符）。

本项目为非官方项目，与 Antigravity 的制作者没有关联，亦未获其认可或背书，且不包含、不分发任何 Antigravity 官方程序文件。 This project is unofficial, not affiliated with or endorsed by the makers of Antigravity, and does not include or distribute any official Antigravity program files.
