# Antigravity_Mod

Antigravity 独立插件平台与 AI 辅助安装工具。

Official public distribution repository for the Antigravity plugin platform and its plugins. A modified Antigravity executable is never distributed.

## 项目定位

本仓库是 Antigravity_Mod 的**唯一官方发行仓库**，并且是公开仓库。这里统一管理并分发：

- 插件平台（含 AI 辅助安装工具）
- 插件
- 插件 API / 接口规范
- 相关文档

插件只通过本仓库分发。收录入口是 [`index/plugins.json`](index/plugins.json)：每条记录包含插件 ID、版本、作者、说明、平台兼容范围、发行包下载地址和 SHA256。

## 规则

- 只分发插件平台及其插件。Antigravity 官方程序，以及任何修改版 Antigravity EXE，都不进入本仓库，也不通过本仓库分发。
- 更新不得覆盖或删除用户数据。次版本更新必须让平台原地继续可用；主版本更新可以要求重新下载平台，但仍然不得动用户数据。详见 [docs/versioning.md](docs/versioning.md)。
- 仓库公开。不要提交密钥、令牌、cookie、用户数据或个人信息。

## 目录

| 路径 | 内容 |
| --- | --- |
| [`platform/`](platform/README.md) | 插件平台的说明与后续发行内容（当前无平台代码） |
| [`plugins/`](plugins/README.md) | 各插件目录，`plugins/<id>/` |
| [`plugin-api/`](plugin-api/README.md) | 插件 API / 接口规范（待开发者编写） |
| [`docs/`](docs/README.md) | 文档，含版本策略 |
| [`index/`](index/README.md) | 插件索引与字段说明 |

## 状态

早期搭建。目前只有仓库骨架：没有平台实现，没有已收录插件，插件 API 规范尚未编写。

## 许可证

插件平台以 [MIT 许可证](LICENSE) 授权。每个插件可以自选许可证，并应记录在插件索引的 `license` 字段中（建议使用 SPDX 标识符）。

本项目为非官方项目，与 Antigravity 的制作者没有关联，亦未获其认可或背书，且不包含、不分发任何 Antigravity 官方程序文件。 This project is unofficial, not affiliated with or endorsed by the makers of Antigravity, and does not include or distribute any official Antigravity program files.

## 参与

分支与提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。变更记录见 [CHANGELOG.md](CHANGELOG.md)。
