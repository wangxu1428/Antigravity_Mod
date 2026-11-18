# 插件平台

本目录是 Antigravity 插件平台的核心源码。Antigravity 官方程序和任何修改版可执行文件都不放在这里，也不通过本仓库分发。

安装与升级由 [`scripts/install-or-update.ps1`](scripts/install-or-update.ps1) 完成。脚本只把本目录和 `plugins/builtin/`、`plugins/optional/` 里的平台文件**复制**到用户机器上既有的运行时路径，不删除、不覆盖用户数据。

| 仓库路径 | 作用 | 安装到（运行时，保持历史布局） |
| --- | --- | --- |
| `agm-plugin-host.js` | 插件宿主。由 `hakimi:list-plugins` 作为 `plugins` 根目录下的顶层脚本加载，且必须排在其他顶层 `.js` 之前 | `<应用目录>/plugins/agm-plugin-host.js` |
| `config.default.json` | 默认配置模板，不是用户配置 | `<应用目录>/plugins/config.default.json`。仅当运行态 `plugins/config.json` 不存在时，用它初始化一份；已有文件原样保留 |
| `mod_kit/` | 补丁注入、自动更新锁、Sidecar 收割与重铸脚本。`repatch.ps1` 把上一级目录当作应用根目录来找 `resources/` | `<应用目录>/mod_kit/` |
| `scripts/` | 安装、官方还原、实验室回滚归档，以及便携启动器 | 在仓库内执行安装/还原脚本。`启动爆改版.bat` 复制到应用目录根，并用该目录下的 `UserData` 作为 `--user-data-dir` |

内置插件的仓库源码在 [`plugins/builtin/`](../plugins/builtin/)，可选插件在 [`plugins/optional/`](../plugins/optional/)。宿主在用户机器上仍然从下面这些路径加载，因此升级不需要迁移已经装好的插件：

- 内置主世界脚本：`<应用目录>/plugins/hakimi-i18n.js`、`<应用目录>/plugins/ai-sidedock.js`（以及 `plugins/hakimi-i18n/` 模块目录）
- 可选插件源：`<应用目录>/plugins/repo/<id>/`（由插件中心安装到 `plugins/packages/<id>/`）

以下路径属于用户，升级时绝不写入、绝不删除：`UserData/`、`plugins/config.json`、`plugins/state/`、`plugins/packages/`。
