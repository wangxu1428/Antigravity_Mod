# 变更记录

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
平台与插件分别按语义化版本编号，规则见 [docs/versioning.md](docs/versioning.md)。

## [Unreleased]

### Changed

- 补齐 v2.1.0 安装与发布文档（`docs/INSTALL.md`、`docs/RELEASE_NOTES_2.1.0.md`），完成 `repatch.ps1` 与 `restore-official.ps1` 一次性隔离副本实测验收，收窄 `.gitignore` 过宽规则，清理 `docs/ARCHITECTURE.md` 实验室专有信息，对齐 `plugin-api/README.md` 与 `index/plugins.json`，移除脚本头初稿标记并同步更新 `manifest.repo.json`。

## [2.1.0] - 2026-11-19

### Added

- 导入 v2.1.0 平台与插件（分支 `dev/v2.1.0-import`）：纳入 `mod_kit/`、`plugins/`（宿主 v2.1.0、内置插件与 `plugins/repo/`）、`scripts/`、`tests/`、`manifest.repo.json`，以及 `docs/ARCHITECTURE.md`、`docs/PLUGIN_DEV_GUIDE.md`、`docs/WHITEPAPER.md`。保留既有 `LICENSE`（MIT，Copyright (c) 2026 wangxu1428）。`README.md` 以导入稿为底，并保留平台 MIT、插件自选许可证与非官方 / 未关联声明。`.gitignore` 合并双方规则，并将 `locales/` 收窄为 `/locales/`，以跟踪 `plugins/hakimi-i18n/locales/`。
- 建立公开仓库骨架：`platform/`、`plugins/`、`plugin-api/`、`docs/`、`index/`。
- 增加贡献说明、版本策略、插件索引模板（仅一条示例）和 `.gitignore`。
- 以 MIT 许可证发布插件平台（见根目录 `LICENSE`），并在 README 中加入非官方、未获背书、且不分发 Antigravity 官方程序文件的声明。
- 插件索引增加可选字段 `license`（建议使用 SPDX 标识符）；示例条目为 `MIT`。

### Changed

- 重组仓库目录：平台核心进入 `platform/`（`agm-plugin-host.js`、`config.default.json`、`mod_kit/`、`scripts/`）；内置插件进入 `plugins/builtin/<id>/`（`hakimi-i18n`、`ai-sidedock`）；索引分发插件进入 `plugins/optional/<id>/`（`agm-hello-guard`，原 `plugins/repo/`）。安装脚本仍把这些文件复制到用户机器上的原运行时路径（顶层 `plugins/*.js`、`plugins/hakimi-i18n/`、`plugins/repo/<id>/`、`mod_kit/`），只复制不删除，不覆盖 `UserData/`、运行态 `plugins/config.json`、`plugins/state/` 与已安装的 `plugins/packages/`。
- 重写 `README.md`，说明项目定位、分发规则、目录和当前状态。
