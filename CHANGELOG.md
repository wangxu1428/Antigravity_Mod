# 变更记录

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
平台与插件分别按语义化版本编号，规则见 [docs/versioning.md](docs/versioning.md)。

## [Unreleased]

### Added

- 建立公开仓库骨架：`platform/`、`plugins/`、`plugin-api/`、`docs/`、`index/`。
- 增加贡献说明、版本策略、插件索引模板（仅一条示例）和 `.gitignore`。
- 以 MIT 许可证发布插件平台（见根目录 `LICENSE`），并在 README 中加入非官方、未获背书、且不分发 Antigravity 官方程序文件的声明。
- 插件索引增加可选字段 `license`（建议使用 SPDX 标识符）；示例条目为 `MIT`。

### Changed

- 重写 `README.md`，说明项目定位、分发规则、目录和当前状态。
