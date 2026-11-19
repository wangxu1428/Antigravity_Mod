# 变更记录

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
平台与插件分别按语义化版本编号，规则见 [docs/versioning.md](docs/versioning.md)。

## [Unreleased]

### Fixed

- 修复 `hakimi-i18n` 热重载卸载（`__hakimiI18nTeardown`）未恢复已汉化 DOM 的问题：在 `domAdapter.stop()` 之前调用 `domAdapter.restoreEnglish()` 还原英文原文，并在初始化合并配置、跳过启动与 teardown 时打印 `config.enabled` 状态日志（同步更新源码 [`plugins/builtin/hakimi-i18n/hakimi-i18n/build.js`](plugins/builtin/hakimi-i18n/hakimi-i18n/build.js) 与运行时文件 [`plugins/builtin/hakimi-i18n/hakimi-i18n.js`](plugins/builtin/hakimi-i18n/hakimi-i18n.js)）。

### Changed

- 加固 `platform/mod_kit/repatch.ps1`：`asar extract`/`asar pack`（含 `npx asar` 回退）显式检查 `$LASTEXITCODE`；解包时若缺失 `app.asar.bak.unpacked` 则在临时区配对 `app.asar.unpacked`（修复原未检错解包静默丢失 `chrome-devtools-mcp` 的隐患）；先打包至 `resources\.agm_repatch_tmp_<时间戳>\app.asar` 并校验大小、6 个注入文件 `asar list` 条目、`node --check` 语法与 SHA256；校验通过后先备份为 `resources\app.asar.prev_<时间戳>` 再以 `Move-Item` 原子替换并复验哈希；任意失败自动清理临时目录、保持目标 `app.asar` 不变、以非 `0` 退出且不打印成功；新增可选 `-TargetAppDir`/`-AppDir` 参数并在成功与失败时输出回滚命令；`platform/mod_kit/repatch.bat` 同步透传 `%*`。
- 补充并对齐 Windows 实测与发布文档：更新 [`docs/Full_Handover.md`](docs/Full_Handover.md) 当前状态、[`docs/versioning.md`](docs/versioning.md) 预发布状态、[`docs/INSTALL.md`](docs/INSTALL.md) 与 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 的 `repatch.ps1` 流水线描述，新增 Windows 实测证据索引 [`docs/WINDOWS_TEST_EVIDENCE.md`](docs/WINDOWS_TEST_EVIDENCE.md)。

### Added

- 新增离线单元测试 [`tests/test_i18n_teardown_unit.js`](tests/test_i18n_teardown_unit.js)（IT1–IT6），并将其接入 [`.github/workflows/test.yml`](.github/workflows/test.yml)（`ubuntu-latest` / `windows-latest` 双矩阵）。[`tests/test_repatch_unit.js`](tests/test_repatch_unit.js) 仅补全非 Windows 跳过提示中的 `RP7`；将该测试接入 CI 的工作改到 PR #8 返工，本分支 `test.yml` 不再添加 `test_repatch_unit.js` 步骤。并在 [`docs/WINDOWS_TEST_EVIDENCE.md`](docs/WINDOWS_TEST_EVIDENCE.md) 追加 `AGM-HARDENING-FOLLOWUP-01` 实测记录。
- 新增不需要真实 `asar` 的离线单元测试 [`tests/test_repatch_unit.js`](tests/test_repatch_unit.js)（RP1–RP7），覆盖 `pack`/`extract` 失败、0 字节产物、`asar list` 缺项、`.unpacked` 临时配对以及正常原子替换与回滚提示。

## [2.1.0] - 2026-11-19

> 对应公开预发布标签 `platform-v2.1.0`（`main` 提交 `d9dad3f`，首个公开测试版 Pre-release）。

### Added

- 文档：新增阶段交接与发行审计记录 [`docs/Full_Handover.md`](docs/Full_Handover.md)（PR #6）、安装升级还原指南 [`docs/INSTALL.md`](docs/INSTALL.md) 与 v2.1.0 发布说明 [`docs/RELEASE_NOTES_2.1.0.md`](docs/RELEASE_NOTES_2.1.0.md)（PR #7）。
- CI：新增 `.github/workflows/test.yml`，在 PR 和推送到 `main` 时于 `ubuntu-latest` 与 `windows-latest`（Node 20）运行离线测试（host 15 项、reaper 16 项、update lock 9 项，共 40 项）。
- 导入 v2.1.0 平台与插件（分支 `dev/v2.1.0-import`）：纳入 `mod_kit/`、`plugins/`（宿主 v2.1.0、内置插件与 `plugins/repo/`）、`scripts/`、`tests/`、`manifest.repo.json`，以及 `docs/ARCHITECTURE.md`、`docs/PLUGIN_DEV_GUIDE.md`、`docs/WHITEPAPER.md`。保留既有 `LICENSE`（MIT，Copyright (c) 2026 wangxu1428）。`README.md` 以导入稿为底，并保留平台 MIT、插件自选许可证与非官方 / 未关联声明。`.gitignore` 合并双方规则，并将 `locales/` 收窄为 `/locales/`，以跟踪 `plugins/hakimi-i18n/locales/`。
- 建立公开仓库骨架：`platform/`、`plugins/`、`plugin-api/`、`docs/`、`index/`。
- 增加贡献说明、版本策略、插件索引模板（仅一条示例）和 `.gitignore`。
- 以 MIT 许可证发布插件平台（见根目录 `LICENSE`），并在 README 中加入非官方、未获背书、且不分发 Antigravity 官方程序文件的声明。
- 插件索引增加可选字段 `license`（建议使用 SPDX 标识符）；示例条目为 `MIT`。

### Changed

- 补齐 v2.1.0 安装与发布文档（`docs/INSTALL.md`、`docs/RELEASE_NOTES_2.1.0.md`），完成基于旧版 `repatch.ps1` 与 `restore-official.ps1` 的一次性隔离副本实测验收，收窄 `.gitignore` 过宽规则，清理 `docs/ARCHITECTURE.md` 实验室专有信息，对齐 `plugin-api/README.md` 与 `index/plugins.json`，移除脚本头初稿标记并按仓库 LF 内容同步更新 `manifest.repo.json`（PR #7）。
- 重组仓库目录：平台核心进入 `platform/`（`agm-plugin-host.js`、`config.default.json`、`mod_kit/`、`scripts/`）；内置插件进入 `plugins/builtin/<id>/`（`hakimi-i18n`、`ai-sidedock`）；索引分发插件进入 `plugins/optional/<id>/`（`agm-hello-guard`，原 `plugins/repo/`）。安装脚本仍把这些文件复制到用户机器上的原运行时路径（顶层 `plugins/*.js`、`plugins/hakimi-i18n/`、`plugins/repo/<id>/`、`mod_kit/`），只复制不删除，不覆盖 `UserData/`、运行态 `plugins/config.json`、`plugins/state/` 与已安装的 `plugins/packages/`。
- 重写 `README.md`，说明项目定位、分发规则、目录和当前状态。
