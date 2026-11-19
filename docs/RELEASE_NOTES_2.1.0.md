# Antigravity_Mod (AGM Plugin Platform) v2.1.0 发布说明

- **版本号**：`2.1.0`
- **发布日期**：`2026-11-19`
- **兼容目标**：Antigravity IDE `2.32.x`（基于 `2.32.1` / Electron `44.9.1` 基线验证）
- **许可证与声明**：插件平台以 [MIT 许可证](../LICENSE) 开源；本项目为非官方项目，与 Antigravity 制作者无关联，且**绝不分发**任何官方 `.exe`、`.dll`、`.pak`、`app.asar` 或个人用户数据。

---

## 1. 核心亮点 (Highlights)

1. **外部插件宿主与管理中心（AGM Plugin Host v2.1.0 + AGM Hub）**
   - 随 `platform/agm-plugin-host.js` 发布：提供 Web Worker 沙箱线程执行、默认 `2500ms` 超时熔断（`worker.terminate()`）、`PERMISSIONS_CATALOG` RPC 权限网关（未授权返回 `E_PERMISSION_DENIED`）、`manifest.json` v1 校验、SemVer 兼容性检查与 `configSchema` 动态表单渲染。
   - 支持 `Ctrl+Shift+M` 呼出插件中心（已安装 / 本地插件仓库 / 设置 / 详情页），并与 `hakimi-i18n` 共享 `--hakimi-dock-offset` 自适应防遮挡。
2. **内置与示例插件体系**
   - **内置主世界插件**：`hakimi-i18n` v1.1.0（六级瀑布流汉化引擎 + 模块化源码与 `zh-CN` 词典，支持 `Ctrl+Shift+L` 配置面板）与 `ai-sidedock` v1.1.0（Gemini / ChatGPT / Grok 分屏侧边舱）。
   - **可选沙箱示例插件**：`agm-hello-guard` v1.0.0（完整覆盖 4 类 `configSchema` 字段、私有 KV 计数与越权拦截示范）。
3. **补丁重铸工具箱与安全锁（`platform/mod_kit/`）**
   - **强锚点预检**：`patch.js` + `agm_locks.js` 在写盘前校验 14 个 AGM 锚点与 8 个 Hakimi 锚点，并执行 `node --check`；任一缺失或已补丁输入即以 `exit 2` 安全中止。
   - **AGM_UPDATE_LOCK & AGM_SIDECAR_REAPER**：阻断后台自动更新与安装器路径（锁定 `app-update.yml` 至 `127.0.0.1:9` 与独立缓存目录 `antigravity-mod-updater`），并在会话结束时以单 PID 精确收割遗留 Sidecar，绝不无差别杀进程。
4. **默认安全的便携启动与仓库布局**
   - `platform/scripts/启动爆改版.bat` 默认关闭 `--remote-debugging-port`，仅在显式设置 `AGM_DEBUG_PORT` 或 `--debug-port` 时开启。
   - 重组仓库为 `platform/`、`plugins/builtin/`、`plugins/optional/`，安装脚本将文件只复制不删除地同步回历史运行时路径，严格隔离 `UserData\`、`plugins\config.json`、`plugins\state\` 与 `plugins\packages\`。

---

## 2. 安装与升级说明 (Install & Upgrade Notes)

完整步骤、参数表与给 AI 助手的操作护栏请参阅 **[`docs/INSTALL.md`](INSTALL.md)**。

要点提示：
- **准备独立应用副本**：务必从官方安装目录另行复制一份独立客户端目录再执行安装，切勿对日常主力原版目录改装；仓库目录本身不是应用目录。
- **⚠️ 无参数默认行为警告**：未设置 `AGM_ROOT` 时直接运行 `platform/scripts/install-or-update.ps1`，会默认写入 `C:\Antigravity_Mod` 并**自动执行 `repatch.ps1` 重铸 `resources\app.asar`**。请始终显式传入 `-TargetAppDir`，并先用 `-DryRun` 预检。
- **小更新可跳过重铸**：若只需同步宿主 JS 或插件源码（无需改动 `app.asar`），可传入 `-SkipRepatch`，然后在客户端内按 `Ctrl+R` / `F5` 热重载。
- **用户数据隔离**：`UserData\`、`plugins\config.json`（仅首次缺失时初始化）、`plugins\state\`、`plugins\packages\` 受硬保护，升级绝不覆盖或删除。

---

## 3. 实测验证状态 (Verification Status)

以下结果均来自 `2026-11-19` 在本仓库提交前的真实运行记录：

### 3.1 `repatch.ps1` 与 `restore-official.ps1` 一次性隔离副本实测

在一次性隔离测试副本（基于官方 Antigravity `2.32.1` 纯净 `resources\app.asar`，运行环境为 Windows PowerShell `5.1.19041.3803`、Node `v26.13.1`、`@electron/asar` `v4.3.2`）上完成 4 项闭环实测，结果 **4/4 PASS（`OVERALL: PASS`）**：

| 用例 | 测试内容 | 实测结果 |
| --- | --- | --- |
| **Case (a)** | 无 `.bak` 首次运行 `repatch.ps1` | `PASS`（自动备份生成与原版哈希一致的 `app.asar.bak`，`patch.js` 与 `node --check` 通过，产出新 `app.asar`，`exit 0`） |
| **Case (b)** | 已有 `.bak` 再次运行 `repatch.ps1` | `PASS`（仍从 `app.asar.bak` 解包构建，`.bak` 的 SHA256 与修改时间完全未变，构建产物哈希与首轮一致，`exit 0`） |
| **Case (c)** | 运行 `restore-official.ps1 -TargetAppDir <副本>` | `PASS`（`resources\app.asar` SHA256 恢复至与官方 `2.32.1` 原版完全一致，旧改装版归档至 `displaced_mod_*\app.asar.mod_patched`，`exit 0`） |
| **Case (d)** | 缺失 `.bak` 且输入已改装 `app.asar` 复现警示场景 | `PASS`（`repatch.ps1` 按预期将已改装 `app.asar` 复制为 `.bak`，随即被 `agm_locks.js` 预检识别为已补丁输入并以 `exit 2` 安全中止） |

### 3.2 纯离线 Node.js 单元测试

| 测试套件 | 命令 | 实测结果 |
| --- | --- | --- |
| 宿主与规则校验单测 | `node tests/test_host_unit.js` | `PASS`（`15 passed, 0 failed`，`exit 0`） |
| Sidecar 进程收割器单测 | `node tests/test_reaper_unit.js` | `PASS`（`16 passed, 0 failed`，RU1–RU16，`exit 0`） |
| 自动更新锁离线注入单测 | `node tests/test_update_lock.js` | `PASS`（`9 passed, 0 failed`，UL1–UL7，`exit 0`） |

### 3.3 `install-or-update.ps1` 测试状态

- **状态**：**20/20 PASS（`OVERALL: PASS`）**。2026-11-19 在一次性隔离副本中带 `-TargetAppDir` 与 `-SkipRepatch` 实测：全新目录 `-DryRun` 零写盘、正式安装后平台文件与仓库 SHA256 一致；预埋用户数据的旧版目录连续两轮升级，12 个用户/受保护文件 SHA256 不变，`app-update.yml` 仅首轮备份，结果幂等。

---

## 4. 已知问题与注意事项 (Known Issues & Caveats)

1. **`app.asar.bak` 缺失时的备份污染陷阱**：如第 3.1 节用例 (d) 所验证，当目标目录缺少 `resources\app.asar.bak` 时，`repatch.ps1` 会将当前的 `resources\app.asar` 直接复制为 `.bak`。若当前 `app.asar` 已被打过补丁，生成的 `.bak` 将不再是官方原厂文件且无法再次通过 `agm_locks.js` 预检（触发 `exit 2`）。首次重铸前务必确认放入的是官方纯净 `app.asar`。
2. **`install-or-update.ps1` 待加固项（不影响本次实测结论）**：未传 `-TargetAppDir` 且无 `AGM_ROOT` 时会静默回退到 `C:\Antigravity_Mod` 并默认重铸；目标目录只校验 `resources` 而未校验 `Antigravity.exe`；非提权运行时可能漏检提权客户端进程；受保护路径校验未解析符号链接/联接点；文件为逐个非原子覆写。
3. **`restore-official.ps1` 不自动还原 `app-update.yml`**：还原官方 `app.asar` 后，`resources\app-update.yml` 仍保持禁用更新锁配置；如需恢复官方更新源，需手动将 `resources\app-update.yml.bak_<时间戳>` 改回 `resources\app-update.yml`。
4. **官方版本升级锚点依赖**：若未来官方 Antigravity 客户端代码结构变化导致 `agm_locks.js`（14 处）或 `patch.js`（8 处）锚点失效，重铸会以 `exit 2` 中止且不会写坏 `app.asar`，需等待平台适配更新。
5. **插件索引当前状态**：`index/plugins.json` 中正式收录数组 `plugins` 目前为空，仅包含一条 `example: true` 示范条目（兼容范围示例已更新为 `>=2.1.0 <3.0.0`）。
6. **历史回滚脚本禁用**：`platform/scripts/legacy-rollback/` 含已知 `$D`/`$d` 变量覆盖缺陷及实验室路径，仅供审计参考，严禁用于生产环境。

---

## 5. 回滚指南 (Rollback)

1. **回退平台源码与脚本**：关闭客户端后，在仓库执行 `git checkout <上一版本标签或提交>`，再运行 `platform/scripts/install-or-update.ps1 -TargetAppDir "<应用目录>"`（先 `-DryRun`）。用户数据区与已安装插件不会被覆盖或删除。
2. **还原官方纯净 `app.asar`**：运行 `platform/scripts/restore-official.ps1 -TargetAppDir "<应用目录>"`（建议先 `-VerifyOnly` 核对哈希），详见 [`docs/INSTALL.md`](INSTALL.md)。
