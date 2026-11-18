# 插件

插件按是否随平台一起发行分成两类。`<id>` 与 [`index/plugins.json`](../index/plugins.json) 里的 `id` 使用同一套规则（小写字母、数字、连字符或点，创建后不改）。

| 目录 | 含义 |
| --- | --- |
| [`builtin/<id>/`](builtin/) | 随平台发行的内置插件。当前为 `hakimi-i18n`（`hakimi-i18n.js` 与模块化源码目录 `hakimi-i18n/`）和 `ai-sidedock`（`ai-sidedock.js`）。 |
| [`optional/<id>/`](optional/) | 不内置、通过插件索引分发的插件。当前为示例包 `agm-hello-guard`（自原 `plugins/repo/agm-hello-guard/` 移入）。 |

发行包通过索引里的 `downloadUrl` 分发，并用 `sha256` 校验。不要把 Antigravity 官方程序或修改版可执行文件打进发行包。

索引的 `plugins` 数组目前没有已收录的可安装发行包。`examples` 里的条目只是格式示范，不是可安装插件。

## 仓库路径和运行时路径

用户机器上的加载位置没有改。`platform/scripts/install-or-update.ps1` 只复制、不删除：

| 仓库源码 | 运行时（宿主实际读取的位置） |
| --- | --- |
| `plugins/builtin/<id>/<id>.js` | `<应用目录>/plugins/<id>.js`（顶层脚本，供 `hakimi:list-plugins` 注入） |
| `plugins/builtin/hakimi-i18n/hakimi-i18n/` | `<应用目录>/plugins/hakimi-i18n/`（模块与词典，不是顶层脚本，不会被直接注入） |
| `plugins/optional/<id>/` | `<应用目录>/plugins/repo/<id>/`（本地源）。用户从插件中心安装后的副本在 `plugins/packages/<id>/` |

`plugins/packages/` 里已经安装的插件、`plugins/config.json` 和 `UserData/` 都不在这次复制范围内。升级不会因为仓库目录改名而清掉它们。
