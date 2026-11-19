# Windows 实测证据索引（WINDOWS_TEST_EVIDENCE）

本文档汇总 **Antigravity_Mod (AGM Plugin Platform v2.1.0)** 在 Windows 实机隔离环境中的验证记录、基线哈希与对应原始证据索引。所有验证均在独立隔离实验目录内完成，未写入官方安装目录或生产目录，证据包与仓库均不包含 `app.asar`、`.exe`、`UserData` 或任何密钥。

---

## 1. 测试环境与基线信息

| 项目 | 值 |
|---|---|
| **操作系统** | `Microsoft Windows NT 10.0.19045.0`（Windows 10） |
| **PowerShell** | `5.1.19041.3803` |
| **Node.js** | `v26.13.1` |
| **@electron/asar** | `v4.3.2` |
| **官方客户端基线** | Antigravity `2.32.1`（Electron `44.9.1`） |
| **官方原版 `resources\app.asar` SHA256** | `98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46` |
| **旧版未加固 `repatch.ps1` 产出 SHA256** | `0B252405A7EE92A6F0B47D11C00829D28365E44DBD9FFD76FD10359AB1FD2D31`（参考旧证据 `RELEASE_DOCS_01`；因未检出 `asar extract` 失败而丢失 `chrome-devtools-mcp`） |
| **本次加固后 `repatch.ps1` 产出 SHA256** | `6F60316D31FA8A920D12D228666EBC3F977BCD6D338B26E0C61FC0621069EC84`（`asar extract` 成功配对 `.unpacked`，完整保留 `chrome-devtools-mcp`） |

---

## 2. 引用的既有基线证据（历史版本）

| 测试批次 | 日期 | 基线 / 脚本版本 | 结论 | 原始证据路径 | 证据文件 SHA256 |
|---|---|---|---|---|---|
| `INSTALL_TEST_01` | `2026-11-19 09:55:05 +08:00` | `main` @ `a8e9c19`（`install-or-update.ps1 -SkipRepatch`） | **PASS (20/20)** | `C:\AGM_TestLab\INSTALL_TEST_01\report\result.txt` | `811B7A26DA8617CA88755214C2B21DF60F22654DDB36E04EB403FC943172072C` |
| `RELEASE_DOCS_01` | `2026-11-19 10:00:19 +08:00` | 旧版 `repatch.ps1` + `restore-official.ps1`（Case a/b/c/d） | **PASS (4/4)**（见上方哈希说明） | `C:\AGM_TestLab\RELEASE_DOCS_01\report\asar_result.txt` | `2A7E79E34D5ADCCF5ACF7F07173EC0BEFB08ED9DFD30EF6BA421E655A3233689` |

---

## 3. 本次加固实测矩阵（`AGM-RELEASE-HARDENING-01`，`2026-11-19`）

> 以下证据均已归档在本次交付证据包 `AGM_RELEASE_HARDENING_01_windows_evidence.zip`（对应测试工作目录 `C:\AGM_TestLab\RELEASE_HARDENING_01\evidence\`）中。

### 3.1 纯离线 Node.js 单元测试

| 测试 ID | 测试内容 | 日期 | 结果 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|
| `offline_host` | `node tests/test_host_unit.js`（宿主校验/SemVer/Schema/权限网关） | `2026-11-19` | **PASS (15/15, exit=0, 58ms)** | `offline_tests/results.txt` | `30027E119741B18F79304F77316460DC40DA9FC1B50AB3BD90C4D26A6D550C4B` |
| `offline_reaper` | `node tests/test_reaper_unit.js`（Sidecar 快照与单 PID 收割 RU1–RU16） | `2026-11-19` | **PASS (16/16, exit=0, 341ms)** | `offline_tests/results.txt` | `30027E119741B18F79304F77316460DC40DA9FC1B50AB3BD90C4D26A6D550C4B` |
| `offline_update_lock` | `node tests/test_update_lock.js`（自动更新锁注入与拦截 UL1–UL7） | `2026-11-19` | **PASS (9/9, exit=0, 243ms)** | `offline_tests/results.txt` | `30027E119741B18F79304F77316460DC40DA9FC1B50AB3BD90C4D26A6D550C4B` |
| `offline_repatch` | `node tests/test_repatch_unit.js`（模拟 `pack`/`extract` 失败、0 字节、缺文件、`.unpacked` 配对 RP1–RP7） | `2026-11-19` | **PASS (7/7, exit=0, 9062ms)** | `offline_tests/results.txt` | `30027E119741B18F79304F77316460DC40DA9FC1B50AB3BD90C4D26A6D550C4B` |

### 3.2 安装、两轮升级与新版 `repatch.ps1` / `restore-official.ps1` 实测

| 测试 ID | 测试内容 | 日期 | 结果 | 关键实测指标与哈希 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|---|
| `install_upgrade` | `install-or-update.ps1 -SkipRepatch` 重跑（新基线 `d9dad3f` + 加固 `repatch.ps1`）：`-DryRun` 零写盘、首次安装、两轮覆盖升级与 12 个受保护用户文件完整性 | `2026-11-19 10:38:33 +08:00` | **PASS (20/20, 2091ms)** | 30 个平台文件与仓库 SHA256 逐字节一致；12 个用户文件 SHA256 全程未变；两轮升级严格幂等（63 项 diff=0） | `install_upgrade/result.txt`、`install_upgrade/meta.json` | `A67512EEC834E03C4DB48B5D3EE479ABC45E321EE4E3D60C9ADC79BC0A81C6E0` |
| `repatch_a` | Case (a) 首次重铸（无 `.bak`，含 `.unpacked` 临时配对解包） | `2026-11-19 10:38:53 +08:00` | **PASS (exit=0, 3485ms)** | `.bak` = `98A4308C...`；`.prev_1` = `98A4308C...`；`app.asar` = `6F60316D...`；`asar list` 含全部 6 个注入文件；零临时目录残留 | `repatch_a/case_a.txt`、`repatch_a/meta.json` | `F6D3FBC3C054F7CBE1C722CFFF22C43898A36FD9A7E0F7DFD6FD59126F396462` |
| `repatch_b` | Case (b) 重复重铸（已有 `.bak`） | `2026-11-19 10:38:57 +08:00` | **PASS (exit=0, 3443ms)** | `.bak` SHA256 与修改时间不变；`.prev_2` = `6F60316D...`；产出 `app.asar` = `6F60316D...`（与首轮一致） | `repatch_b/case_b.txt`、`repatch_b/meta.json` | `B63C45831091871F2EF7B44EA13BFF45C8F9B578E119D3025C347C41493D13BA` |
| `repatch_c` | Case (c) 官方还原 `restore-official.ps1 -TargetAppDir` | `2026-11-19 10:38:58 +08:00` | **PASS (exit=0, 343ms)** | `app.asar` 还原至 `98A4308C...`；旧改装版归档至 `displaced_mod_*\app.asar.mod_patched`（`6F60316D...`） | `repatch_c/case_c.txt`、`repatch_c/meta.json` | `31473CEBD4245FF664FD1FF6427956DBD4F47E2928497CE460174F117CC92301` |
| `repatch_d` | Case (d) 备份污染陷阱复现（无 `.bak` 且输入已改装 `app.asar`） | `2026-11-19 10:38:59 +08:00` | **PASS (exit=2, 1901ms)** | `.bak` 生成为已改装哈希 `6F60316D...`，`agm_locks.js` 预检以 `exit 2` 拒绝修改目标 `app.asar`，无 `.agm_repatch_tmp_*`/`.prev_*` | `repatch_d/case_d.txt`、`repatch_d/meta.json` | `BA949B30FB5188AF4B5CADFDDA7F3F9F4220F94875EFB75A9E2D16557A8A9E32` |
| `repatch_e` | Case (e) 打包失败原子保护（真实 `extract` + `patch.js` + `node --check` 后模拟 `pack` 失败返回 `19`） | `2026-11-19 10:39:02 +08:00` | **PASS (exit=19, 2695ms)** | 目标 `app.asar` SHA256 保持 `98A4308C...` 不变；临时暂存区清理完毕；未输出成功提示并输出回滚命令 | `repatch_e/case_e.txt`、`repatch_e/meta.json` | `BF7207A52DE025A0D2DDBBE50287950AFFB2CB01E0670B3108C11090E091422B` |

### 3.3 隔离客户端副本实机测试（`--user-data-dir` 独立空白数据目录）

> 说明：测试前已通过 `client_launch/update_lock_gate.txt`（SHA256 `C082E7C2A211A8902FC3715BFB10D9EA69989A254248E47C8C1D2704E6F96F08`）确认副本 `resources\app-update.yml` 死地址锁、`app.asar` 内 `AGM_UPDATE_LOCK` / IPC 拦截及独立 `UserData` 隔离均有效，且全程 `ai-sidedock` 保持折叠状态（未访问外部 AI 网页）。

| 测试 ID | 测试内容 | 日期 | 结果 | 实测现象与诚实备注 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|---|
| `client_f` | 隔离副本全量安装 + `Antigravity.exe --user-data-dir=W\userdata_test` 启动与 >30s 稳定性 | `2026-11-19 10:48:45 +08:00` | **PASS** | PID `5364` 稳定存活 `36.3s+`（总运行 `57s`），主窗口出现（`1416x908`，HWND `594790`），`hakimi-i18n` 与 `ai-sidedock` 均成功注入并触发汉化，经 `CloseMainWindow` 退出，外部运行进程 `11 -> 11` 零影响 | `client_launch/install_w_app.txt`、`client_launch/update_lock_gate.txt`、`client_launch/launch_result.txt`、`client_launch/electron_runtime.log`、`client_launch/main_window.png` | `launch_result.txt`: `67DB3E5D...`；`main_window.png`: `C35CA1C4...` |
| `client_g` | 插件中心（AGM Hub）界面打开与截屏验收 | `2026-11-19 10:48:30 +08:00` | **PASS** | 因测试终端位于非输入桌面（`SetForegroundWindow`/`keybd_event` 无法向窗口投递 `Ctrl+Shift+M`），改经仓库文档记载的左侧边栏「插件中心」入口点击打开并用 `PrintWindow(2)` 截屏，可见 AGM Hub v2.1.0 界面、2 个内置插件、仓库 1 个可选插件与「热重载全部」按钮 | `plugin_center/result.txt`、`plugin_center/preview.png`、`AGM_RELEASE_HARDENING_01_preview.png` | `preview.png`: `853301C8FDDF011FFAB43737A3C61D0CD679030EF1969E6041A7A116E62BED4D` |
| `client_h` | 修改副本 `plugins\config.json` 无害配置并热重载 | `2026-11-19 10:48:36 +08:00` | **UNKNOWN** | **已证实**：`F5` 触发了 `HakimiPluginHost` 热重载、`hakimi-i18n` teardown 与 `ai-sidedock`/`hakimi-i18n` 重新注册（见 `electron_runtime.log` 第 17–27 行及 `plugins/state/logs/`）。**未闭环**：`hakimi-i18n` teardown 仅调用 `domAdapter.stop()` 不恢复已汉化 DOM 且不打印 `enabled`/`customOverrides` 值，故 `after_reload.png` 仍保持中文，尚无法从日志/界面直接证实修改后的 `i18n.enabled=false` 配置本身已生效，诚实标为 `UNKNOWN` | `hot_reload/result.txt`、`hot_reload/before_reload.png`、`hot_reload/after_reload.png` | `result.txt`: `6AAA22F8...`；`before`: `E84F2C17...`；`after`: `2132EBE9...` |

---

## 4. 发行加固后续实测（`AGM-HARDENING-FOLLOWUP-01`，`2026-11-19`）

> 本批次测试均在独立隔离实验目录 `C:\AGM_TestLab\HARDENING_FOLLOWUP_01\` 内完成（分支 `dev/hardening-followup-01`，基线 `090b770`），未写入生产目录 `C:\Antigravity_Mod` 或 `D:\` 任何路径。

- **环境信息**：`Microsoft Windows NT 10.0.19045.0`（Windows 10）、PowerShell `5.1.19041.3803`、Node.js `v26.13.1`、`@electron/asar v4.3.2`。
- **官方基线核查说明**：经只读比对 `D:\AI_Studio\Apps\Antigravity\resources\` 发现，`app.asar.bak`（SHA256 `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`，5,656,861 字节，`version: 2.32.1`，与 `C:\Antigravity_Mod\resources\app.asar.bak` 一致）为无残留的纯净官版底座（`hasLegacyAgyZh=False`），本次 `W\app` 重铸产出 `app.asar` SHA256 为 `E17875BABF622F39D50275C0A28F37B91E9591EF09C80A4449D8C73A5FFD5063`。而 `D:\AI_Studio\Apps\Antigravity\resources\app.asar`（`98A4308C...`，7,521,517 字节）的 `dist/preload.js` 已预置旧版独立汉化引擎 `AGY_ZH_ENGINE_START`（v1.12.0），会无视 `plugins\config.json` 独立执行汉化。

### 4.1 离线单元测试与 CI 覆盖（5 项全绿 + Linux 跳过模拟）

| 测试 ID | 测试内容 | 日期 | 结果 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|
| `offline_host` | `node tests/test_host_unit.js`（宿主校验/SemVer/Schema/权限网关） | `2026-11-19 13:56` | **PASS (15/15, exit=0, 57ms)** | `offline_tests/results.txt` | `71115367C15C14FD4C37DCE262B4F0797A35C3674BEC27265885E5DDCB073C3C` |
| `offline_reaper` | `node tests/test_reaper_unit.js`（Sidecar 快照与单 PID 收割 RU1–RU16） | `2026-11-19 13:56` | **PASS (16/16, exit=0, 327ms)** | `offline_tests/results.txt` | `71115367C15C14FD4C37DCE262B4F0797A35C3674BEC27265885E5DDCB073C3C` |
| `offline_update_lock` | `node tests/test_update_lock.js`（自动更新锁注入与拦截 UL1–UL7） | `2026-11-19 13:56` | **PASS (9/9, exit=0, 256ms)** | `offline_tests/results.txt` | `71115367C15C14FD4C37DCE262B4F0797A35C3674BEC27265885E5DDCB073C3C` |
| `offline_repatch` | `node tests/test_repatch_unit.js`（RP1–RP7，本机实测；接入 CI 改由 PR #8 返工） | `2026-11-19 13:56` | **PASS (7/7, exit=0, 9171ms)** | `offline_tests/results.txt` | `71115367C15C14FD4C37DCE262B4F0797A35C3674BEC27265885E5DDCB073C3C` |
| `repatch_linux_sim` | `process.platform='linux'` 模拟非 Windows 跳过（仅跑 RP6、跳过 RP1–RP5/RP7） | `2026-11-19 13:56` | **PASS (1/1, exit=0, 89ms)** | `offline_tests/repatch_linux_sim.txt` | `CE09858EBB37B5A317051BD5EB7004A1791AD4D55ED459D9CA57B0DC2682E9E0` |
| `offline_i18n_teardown` | `node tests/test_i18n_teardown_unit.js`（IT1–IT6：构造同步、teardown 调用 `restoreEnglish()` 先于 `stop()`、`enabled=false` 阻断启动与日志、异常容错；已接入 CI `ubuntu-latest`/`windows-latest`） | `2026-11-19 13:56` | **PASS (6/6, exit=0, 370ms)** | `offline_tests/results.txt` | `71115367C15C14FD4C37DCE262B4F0797A35C3674BEC27265885E5DDCB073C3C` |

### 4.2 隔离客户端副本实测 `client_h`（`hakimi-i18n` 热重载关闭还原英文）

| 测试 ID | 测试内容 | 日期 | 环境 | 结论 | 实测日志与视觉验证要点 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|---|---|
| `client_h`（Followup 复测） | 隔离副本 `W\app`（纯净底座 `5B493943...` 重铸为 `E17875BA...`）修改 `plugins\config.json` 中 `i18n.enabled=false` 后按 `F5` 热重载 | `2026-11-19 14:04:47 +08:00` | Win10 `10.0.19045.0` / PS `5.1.19041.3803` / Node `v26.13.1` / Antigravity `2.32.1` | **PASS** | 1) **更新锁门禁通过**：`app-update.yml` 死地址锁、`AGM_UPDATE_LOCK`、`IPC lock`、`hasLegacyAgyZh=False`、`hakimi-i18n.js` 哈希一致；2) **日志闭环**：首启日志打印 `[Hakimi i18n] config.enabled=true language=zh-CN`，改配（`config.json` SHA256 `3324CAF5... -> 6A636F90...`）并发送 `F5` 后，日志依次出现 `Hot-reloading plugins:`、`[Hakimi i18n] Tearing down Hakimi i18n instance... config.enabled=true`、`[Hakimi i18n] config.enabled=false language=zh-CN`、`skipping domAdapter.start()`；3) **界面视觉还原**：`before_reload.png` 主界面全量中文（`工作区/视图/窗口`、`新建会话`、`自动化`、`自定义配置`、`项目列表`、`你好，xu。今天想构建什么？`、`未选择项目`、`输入任何问题，输入 @ 提及，/ 触发操作`、`极速`、`设置`），`after_reload.png` 已全部还原为英文原文（`Workspace/View/Window`、`New Conversation`、`Automations`、`Customizations`、`Projects`、`No conversations yet`、`Conversations`、`Hey xu, what should we build today?`、`No Project`、`Ask anything, @ to mention, / for actions`、`Turbo`、`Settings`；`插件中心`/`AI挂件`属宿主与侧边栏自身文本不受影响）；4) **进程零残留**：主进程 PID `24884` 经 `CloseMainWindow` 退出，Sidecar 子进程 PID `24868` 于关闭后约 50s 自然退出，`post_shutdown_check.txt` 确认 `W\app` 残留进程数为 `0`，外部 `D:\` 进程 `11 -> 11` 无影响 | `hot_reload/update_lock_gate.txt`、`hot_reload/install_and_repatch.txt`、`hot_reload/result.txt`、`hot_reload/electron_runtime.log`、`hot_reload/post_shutdown_check.txt`、`hot_reload/before_reload.png`、`hot_reload/after_reload.png` | `update_lock_gate.txt`: `1BC495DB27B321AED29392C88C0A273DB639A119B36FBDB92B0F9C81415C5A7F`；`install_and_repatch.txt`: `DD54C3CEA6E34632FEE900F9E83FC00464A04FDB3F805A2BCCB7620B68E86C7A`；`result.txt`: `D2CDE14806F4075F876879112D3BB7CDB25E1976E604B1A6905F0D01656AF74B`；`electron_runtime.log`: `5401D9B2B4E69D452B04167B7764B409CB2D6DB5431C426085206599A51C57FE`；`post_shutdown_check.txt`: `DD24BD56473D07FC9AB74809EDA0965D20325CA5DE61079A7512E1553034AE9C`；`before_reload.png`: `1A29B946EBA4798C3170B3BFCFF3482CD5FABCD418C6204280E079472E7D7439`；`after_reload.png`: `DBF585D366D723FC0E55AA3811DB2A49FDDB0DE89600E4C7143D808FEC7DD70E` |
