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

TODO：许可证尚未由仓库所有者决定，因此仓库中**没有** `LICENSE` 文件。在正式许可证加入之前，保留所有权利。请勿假定可以自由使用、修改或再分发。

## 参与

分支与提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。变更记录见 [CHANGELOG.md](CHANGELOG.md)。
