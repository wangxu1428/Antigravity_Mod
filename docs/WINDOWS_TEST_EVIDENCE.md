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
| **官方纯净底座 `resources\app.asar.bak` SHA256** | `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`（大小 5,656,861 字节；与 `docs/WHITEPAPER.md` 记载一致） |
| **当前 D 盘 `resources\app.asar` SHA256（非官方）** | `98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46`（大小 7,521,517 字节，内含预置旧版 `AGY_ZH_ENGINE_START`，不得当作官方原版） |
| **在纯净官方底座上加固后的 `repatch.ps1` 产出 SHA256** | `E17875BABF622F39D50275C0A28F37B91E9591EF09C80A4449D8C73A5FFD5063`（2026-11-19 14:36 +08:00 返工校正后实测） |
| **旧版未加固 `repatch.ps1` 产出 SHA256** | `0B252405A7EE92A6F0B47D11C00829D28365E44DBD9FFD76FD10359AB1FD2D31`（参考旧证据 `RELEASE_DOCS_01`；因未检出 `asar extract` 失败而丢失 `chrome-devtools-mcp`） |
| **误把 `98A4308C...` 当官方底座时的 `repatch.ps1` 产出 SHA256** | `6F60316D31FA8A920D12D228666EBC3F977BCD6D338B26E0C61FC0621069EC84`（第 1–2 轮实测的输入其实是预置旧汉化引擎的 `app.asar`，不是纯净官方版） |

---

## 2. 引用的既有基线证据（历史版本）

| 测试批次 | 日期 | 基线 / 脚本版本 | 结论 | 原始证据路径 | 证据文件 SHA256 |
|---|---|---|---|---|---|
| `INSTALL_TEST_01` | `2026-11-19 09:55:05 +08:00` | `main` @ `a8e9c19`（`install-or-update.ps1 -SkipRepatch`） | **PASS (20/20)** | `C:\AGM_TestLab\INSTALL_TEST_01\report\result.txt` | `811B7A26DA8617CA88755214C2B21DF60F22654DDB36E04EB403FC943172072C` |
| `RELEASE_DOCS_01` | `2026-11-19 10:00:19 +08:00` | 旧版 `repatch.ps1` + `restore-official.ps1`（Case a/b/c/d，基于旧改装基准 `98A4308C...`） | **PASS (4/4)**（历史记录保留，非纯净官方底座） | `C:\AGM_TestLab\RELEASE_DOCS_01\report\asar_result.txt` | `2A7E79E34D5ADCCF5ACF7F07173EC0BEFB08ED9DFD30EF6BA421E655A3233689` |

---

## 3. 历史首轮加固实测矩阵（`AGM-RELEASE-HARDENING-01` Round 1，`2026-11-19`，旧改装基准记录保留）

> 说明：以下第 3–4 节完整保留第 1–2 轮实测历史记录；其中 `repatch_*`、`p0_1*`、`p0_2*` 当时误将 D 盘当前 `app.asar`（`98A4308C...`，预置旧版 `AGY_ZH_ENGINE_START`）视为原版，现统一标记为**旧改装基准（非官方原版）**。官方纯净底座（`5B493943...`）实测见第 5 节与第 6 节。以下证据归档于工作目录 `C:\AGM_TestLab\RELEASE_HARDENING_01\evidence\` 中。

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

## 4. 历史第 2 轮返工加固复测记录（P0-1 / P0-2 / P1，2026-11-19，旧改装基准记录保留）

> 注：本节保留第 2 轮返工实测原始记录（当时白名单误用 `98A4308C...` 旧改装基准，故表内 `.bak` 为 `98A4308C...`，非纯净官方版）。以下证据归档于工作目录 `C:\AGM_TestLab\RELEASE_HARDENING_01\evidence\`（`AGM_RELEASE_HARDENING_01_windows_evidence.zip` 大小 `371737` 字节，53 个条目，SHA256 `FC06B1EF29167E6686434C0E0D0235E5ED746942F82D0230920D107AFFFF66AB`）。

### 4.1 返工离线单元测试与 CI 接入

| 测试 ID | 测试内容 | 日期 | 结果 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|
| `offline_host_r2` | `node tests/test_host_unit.js` | `2026-11-19 14:26:51 +08:00` | **PASS (15/15, exit=0, 58ms)** | `offline_tests_rework/results.txt` | `310201737EC31ADE9E77F6B066E62527DFC908984D7D3CB8CA56C205B45D44E3` |
| `offline_reaper_r2` | `node tests/test_reaper_unit.js` | `2026-11-19 14:26:51 +08:00` | **PASS (16/16, exit=0, 335ms)** | `offline_tests_rework/results.txt` | `310201737EC31ADE9E77F6B066E62527DFC908984D7D3CB8CA56C205B45D44E3` |
| `offline_update_lock_r2` | `node tests/test_update_lock.js` | `2026-11-19 14:26:51 +08:00` | **PASS (9/9, exit=0, 262ms)** | `offline_tests_rework/results.txt` | `310201737EC31ADE9E77F6B066E62527DFC908984D7D3CB8CA56C205B45D44E3` |
| `offline_repatch_r2` | `node tests/test_repatch_unit.js`（RP1–RP13：覆盖 `FileShare.None` / `FileShare.Read` 占用锁、`unpacked` 锁定回滚、`.modded_prev_`、污染 `.bak` 拒绝） | `2026-11-19 14:26:51 +08:00` | **PASS (13/13, exit=0, 22025ms)** | `offline_tests_rework/results.txt`、`offline_tests_rework/meta.json` | `results.txt`: `31020173...`；`meta.json`: `204361E338EA5A24862A90F17F1E41FA7AC03707946753CA6C1A12E4210535C7` |
| `ci_linux_sim_r2` | `.github/workflows/test.yml` 已在 `ubuntu-latest` / `windows-latest` 矩阵加入 `node tests/test_repatch_unit.js`；本机模拟 `process.platform='linux'` 验证静态契约 RP6 并安全跳过 Windows 专用例 | `2026-11-19 14:26:51 +08:00` | **PASS (1/1, exit=0, 73ms)** | `offline_tests_rework/results.txt` | `310201737EC31ADE9E77F6B066E62527DFC908984D7D3CB8CA56C205B45D44E3` |

### 4.2 返工 Windows 实机回归、P0-1 占用锁、P0-2 防污染与残留进程核验

| 测试 ID | 测试内容 | 日期 | 结果 | 关键实测指标与哈希 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|---|
| `repatch_rework_a` | Case (a) 首次重铸（官方白名单创建 `.bak` + `File.Replace` + 长路径清理） | `2026-11-19 14:24:52 +08:00` | **PASS (exit=0, 3710ms)** | `.bak` = `98A4308C...`；`.prev_*` = `98A4308C...`；`app.asar` = `6F60316D...`；`chrome-devtools-mcp\LICENSE` 完整保留；零临时目录残留 | `repatch_rework_a/case_a.txt` | `26596AC02546268AF3585FD1920E3ECABD2EA10C44A9C2FAE07BEBCC436038D5` |
| `repatch_rework_b` | Case (b) 重复重铸（已有 `.bak`，对已改装目标重铸） | `2026-11-19 14:24:56 +08:00` | **PASS (exit=0, 3463ms)** | `.bak` SHA256 与 mtime 未变；改装前快照命名为 `app.asar.modded_prev_*`（`6F60316D...`）；产出 `app.asar` = `6F60316D...`；零临时目录残留 | `repatch_rework_b/case_b.txt` | `D76A8A8580FB636E07AF7BEB199679E4604995C0AB3F2B909A3E0435E2F1B078` |
| `repatch_rework_c` | Case (c) 官方还原 `restore-official.ps1`（含白名单校验 + `File.Replace`） | `2026-11-19 14:24:57 +08:00` | **PASS (exit=0, 392ms)** | `app.asar` 还原至 `98A4308C...`；`.bak` 保持 `98A4308C...`；改装版归档于 `displaced_mod_*\app.asar.mod_patched`（`6F60316D...`） | `repatch_rework_c/case_c.txt` | `7F898E33A35420FF59B951984AC3661F2A2B8234696549E1FD6139F25006A656` |
| `repatch_rework_d` | Case (d) 无 `.bak` 且输入为已改装 `app.asar`（P0-2 修复后行为） | `2026-11-19 14:24:58 +08:00` | **PASS (exit=4, 251ms)** | 输出 `[AGM][Repatch] ALARM`，**未创建 `app.asar.bak`**，目标 `app.asar` 保持 `6F60316D...`，零临时目录残留 | `repatch_rework_d/case_d.txt` | `2BA3AF49BA1C02E3160B2B75BA012D8863A587618B1C7573F878406FE79A00D0` |
| `repatch_rework_e` | Case (e) 真实解包/补丁后模拟 `asar pack` 失败（`exit 19`） | `2026-11-19 14:25:01 +08:00` | **PASS (exit=19, 2745ms)** | 目标 `app.asar` 保持 `98A4308C...` 不变；零临时目录与零 `.prev` 残留 | `repatch_rework_e/case_e.txt` | `CC1BB2A2CE1C927F6327A987FADFDB62194567A7536AFDCB077E26051D69F1FB` |
| `p0_1a_locked` | `P0-1a` 在 `W\app` 的 `robocopy` 独立副本上以 `FileStream(ReadWrite, FileShare.None)` 独占锁住目标 `app.asar` | `2026-11-19 14:25:03 +08:00` | **PASS (exit=10, 270ms)** | `repatch.ps1` 立即失败退出（`exit 10`），解锁后文件仍在且 SHA256 保持 `6F60316D...` 完全一致 | `p0_1_locked_replace/p0_1a_exclusive_lock.txt` | `B4F3C1BC0B9DFB214E094BAD17F4C5E634F0F47227D67D574A1A3EC609622A7B` |
| `p0_1b_locked` | `P0-1b` 在 `W\app` 的 `robocopy` 独立副本上以 `FileStream(Read, FileShare.Read)` 锁住 `app.asar` 直击 `[System.IO.File]::Replace` | `2026-11-19 14:25:06 +08:00` | **PASS (exit=10, 3550ms)** | 解包/补丁/打包与暂存校验全部通过后在 `File.Replace` 处因占用退出（`exit 10`），解锁后文件仍在且 SHA256 保持 `6F60316D...`，临时目录零残留 | `p0_1_locked_replace/p0_1b_read_lock_replace.txt`、`p0_1_locked_replace/meta.json` | `p0_1b`: `A376213EEC511420A22329E4EB999D7876087949B847473C409C705D71E72BA7`；`meta.json`: `907A584E...` |
| `p0_2_pollution` | `P0-2a` 连续 3 轮重铸 `.bak` 恒为 `98A4308C...`；`P0-2b/c` 污染 `.bak` 触发 `repatch.ps1` 与 `restore-official.ps1` 双端 `ALARM` 拒绝（`exit 4`）；`P0-2d` 无 `.bak` + 改装版拒绝写 `.bak`（`exit 4`） | `2026-11-19 14:25:22 +08:00` | **PASS (4/4 子项全绿)** | 重复重铸 `.bak` 哈希与 mtime 不变、改装备份落盘 `.modded_prev_*`；污染 `.bak` 下双脚本均拒绝解包/还原，目标文件无改动 | `p0_2_bak_pollution/p0_2a_*.txt`..`p0_2d_*.txt`、`p0_2_bak_pollution/meta.json` | `meta.json`: `4957B6F476690AC6ED1CE991AB87F3EDD328F85879A51B4663FAFBCEDD22C347` |
| `residual_audit` | `Get-CimInstance Win32_Process` 排查上一轮 `PID 10752` 与 `W\app` 残留进程（始末两次） | `2026-11-19 14:15:46` / `14:27:12` | **PASS (exit=0)** | 上一轮 `PID 10752` 已不存在，`W\app` 进程数 `0`，未触碰 `D:\`（11 进程）与平行任务 | `residual_process_audit/process_audit.txt`、`final_process_check.txt` | `process_audit`: `99B1D87C...`；`final`: `F05773F8...` |


---

## 5. 官方哈希校正与纯净底座复测（Round 3，2026-11-19 14:15–14:37 Asia/Shanghai）

只读核验（未写入 `D:\AI_Studio\Apps\Antigravity\`）：

1. `98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46` 对应 **D 盘当前 `resources\app.asar`**（7,521,517 字节，mtime `2026-11-16 04:01:07`），文件内含 `AGY_ZH_ENGINE_START`，是预置了旧版汉化引擎的改装稿，不是纯净官方版。
2. 同目录 `resources\app.asar.bak` 的 SHA256 为 `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`（5,656,861 字节，mtime `2026-11-14 06:20:30`），不含 `AGY_ZH_ENGINE_START`，才是纯净官方底座。这与 `docs/WHITEPAPER.md` 已记载的官方备份一致。
3. 因此第 2 轮返工把 `98A4308C...` 写入默认官方白名单是错误的。已在本轮把 `repatch.ps1` 与 `restore-official.ps1` 的默认白名单改为 `5B493943...`，并增加单测 `RP6b` 防止把 `98A4308C...` 再写回白名单。第 4 节表格是校正前的实测记录，予以保留但不作为“官方原版”结论。

校正后复测（输入为 D 盘 `app.asar.bak` 的只读夹具副本，解包时配对官方 `app.asar.unpacked`）：

| 测试 ID | 测试内容 | 日期 | 结果 | 关键实测指标与哈希 | 原始证据文件 | 证据 SHA256 |
|---|---|---|---|---|---|---|
| `offline_repatch_r3` | `node tests/test_repatch_unit.js`（RP1–RP13 + RP6b 白名单校正） | `2026-11-19 14:37 +08:00` | **PASS (14/14, exit=0)** | 默认白名单为 `5B493943...`，且不含 `98A4308C...`；Windows 用例与 Linux 跳过逻辑均通过 | `official_hash_correction/offline_tests.txt` | `EC9861AB365C5F79087D1E73886B491ABB664AF5E27031B2AA2F8EC939405E6A` |
| `ci_linux_sim_r3` | 本机模拟 `process.platform='linux'` | `2026-11-19 14:37 +08:00` | **PASS (2/2, exit=0, 74ms)** | RP6 + RP6b 通过，Windows 用例被跳过 | `official_hash_correction/offline_tests.txt` | `EC9861AB365C5F79087D1E73886B491ABB664AF5E27031B2AA2F8EC939405E6A` |
| `repatch_official_a` | Case (a) 在纯净官方底座首次重铸 | `2026-11-19 14:36:57 +08:00` | **PASS (exit=0, 3598ms)** | `.bak` = `5B493943...`；产出 `app.asar` = `E17875BA...` | `repatch_rework_a/case_a.txt` | `0116684E45D7E104398DFDE6FF1B363348FB483ABFCFBC369A0CC0A2EA825E4D` |
| `repatch_official_b` | Case (b) 重复重铸 | `2026-11-19 14:36:57 +08:00` | **PASS (exit=0, 3463ms)** | `.bak` 仍为 `5B493943...`；改装快照为 `.modded_prev_*`；产出仍为 `E17875BA...` | `repatch_rework_b/case_b.txt` | `E2A94AFDDA1BF1C65AB6B56E16E23C0DB153E3ED4FF9BFA8385E0B975E9941D3` |
| `repatch_official_c` | Case (c) 官方还原 | `2026-11-19 14:36:57 +08:00` | **PASS (exit=0, 378ms)** | `app.asar` 还原为 `5B493943...` | `repatch_rework_c/case_c.txt` | `458C1967C0BB6AAAD59A8A6B796C07253B5FF857BB982D78417D39109969D66B` |
| `repatch_official_d` | Case (d) 无 `.bak` + 改装版拒绝写 `.bak` | `2026-11-19 14:36:57 +08:00` | **PASS (exit=4, 248ms)** | 打印 ALARM，未生成官方 `.bak` | `repatch_rework_d/case_d.txt` | `B0925071E67E6F81B430994096FC1E23780B28846505A4E291AFA29F0BE8BA2D` |
| `repatch_official_e` | Case (e) 打包失败目标不变 | `2026-11-19 14:36:57 +08:00` | **PASS (exit=19, 2742ms)** | 目标保持 `5B493943...` | `repatch_rework_e/case_e.txt` | `32E0252AFD54FE595E23FFF9CAC848EBF7399BBB695DD5DCA7CD4A748D823CEE` |
| `p0_1_official` | P0-1 占用锁（纯净官方目录，已预置官方 `.bak`） | `2026-11-19 14:36:57 +08:00` | **PASS** | `FileShare.None` exit 10 / 264ms，`FileShare.Read` exit 10 / 3449ms；解锁后 SHA256 仍为 `5B493943...` | `p0_1_locked_replace/p0_1a_exclusive_lock.txt`、`p0_1b_read_lock_replace.txt` | `79F4BC2E4D29A882...`、`6D9A7727B031912C...` |
| `p0_2_official` | P0-2 以纯净官方 `.bak` 为基准的防污染 | `2026-11-19 14:36:57 +08:00` | **PASS (4/4)** | 连续重铸后 `.bak` 仍为 `5B493943...`；污染 `.bak` 时 `repatch`/`restore` 均 ALARM + exit 4 | `p0_2_bak_pollution/*` | `rework_suite_summary.txt`: `5979422266C8549D1B50DF5414967904BC574C4ECCB46DAC77D9F8987E2EEC41` |
| `official_hash_audit` | D 盘只读 SHA256 与 `AGY_ZH_ENGINE_START` 扫描 | `2026-11-19 14:15 +08:00` | **PASS** | 见上文 1–3 条结论；校正后 D 盘 `app.asar`/`app.asar.bak` 的哈希与 mtime 仍未改变 | `official_hash_audit/audit.txt`、`official_hash_correction/post_correction_process_and_d_readonly.txt` | `BC88E37847BD1A3E71589F1EA65AFF609037D62E46B901DCF4F7507B99660A50`、`DBFDD8A20A1892A118D9958DE60B48FA0E0F907D927CB59E5B44095CF6B11562` |

热重载 `h` 仍为 **UNKNOWN**（本轮未改插件，未为此启动客户端）。`RELEASE_HARDENING_01` 目录下无残留本任务进程。

### 5.1 Google 官方 2.32.1 安装包来源、构建号与只读哈希核验过程

在不修改 `D:\AI_Studio\Apps\Antigravity\` 的前提下，对本地留存的只读官方目录与纯洁 `app.asar.bak` 夹具执行元数据与哈希核验：

| 核验项 | 实测观测结果 |
|---|---|
| **官方产品名称与网站** | `package.json`（`fixtures/official_clean/app.asar` 内部）：`name = "antigravity"`、`productName = "Antigravity"`、`version = "2.32.1"`、`homepage = "https://antigravity.google"`、`author = "Google <antigravity-support@google.com>"` |
| **官方更新通道源** | `D:\AI_Studio\Apps\Antigravity\resources\app-update.yml.bak_20261118_233907`（mtime `2026-11-14 06:20:30`）：`provider: generic`、`url: https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/`、`updaterCacheDirName: antigravity-updater` |
| **主程序 PE 版本与构建号** | `D:\AI_Studio\Apps\Antigravity\Antigravity.exe`（246,599,680 字节，mtime `2026-11-14 06:20:30`，SHA256 `AEAF47C28AC1B7406F27AE610DDED0E4C8E2F972F553D8840CDEE7DB767BF1E8`）：`ProductName = Antigravity`、`ProductVersion = 2.32.1.0`、`FileVersion = 2.32.1`（`2.32.1.0`）、`CompanyName = Google`、`IsPatched = False`；`Uninstall Antigravity.exe` 同为 `2.32.1`（`Google`）；`version` 文件记载 Electron `44.9.1`。PE 数字签名状态为 `NotSigned`；**原始 `.exe` 安装器二进制文件本地未留存，其安装包文件哈希为 `UNKNOWN`**。 |
| **官方纯净底座 `app.asar.bak` 核验** | `D:\AI_Studio\Apps\Antigravity\resources\app.asar.bak`（5,656,861 字节，mtime `2026-11-14 06:20:30`，SHA256 `5B493943E67E500638555315594D5B1ACBC7A02E6DAC3C786651921C1EE8519F`）：解包扫描 `AGY_ZH_ENGINE_START` 命中 `0` 次，且与历史文档 `docs/WHITEPAPER.md` 第 141 行记载（`5,656,861` 字节、`5b493943...`）一致，确认为官方纯净底座。 |
| **旧改装基准 `98A4308C...` 鉴别** | `D:\AI_Studio\Apps\Antigravity\resources\app.asar`（7,521,517 字节，mtime `2026-11-16 04:01:07`，SHA256 `98A4308C8820A4A73F157B036FCCAA37F642B4C6F916BFA855F44A34A14F5C46`）：显式检出 `AGY_ZH_ENGINE_START`，确认为预置旧版汉化引擎的旧改装基准，严禁视为官方原版。 |

---

## 6. PR #8 第三轮阻断项加固与故障注入实测（`AGM-PR8-HARDENING-R3`，`2026-11-19`）

> 本轮围绕原子替换与异常恢复、`app.asar.unpacked` 状态机回滚、`app-update.yml` 事务一致性以及 `manifest.repo.json` 原始 Git Blob 字节一致性完成代码加固，所有实测证据均保存在隔离目录 `C:\AGM_TestLab\RELEASE_HARDENING_01\evidence\r3\`（并打包为 `AGM_PR8_HARDENING_R3_evidence.zip`）。

### 6.1 离线单元测试与新增故障注入套件

| 测试 ID | 测试内容 | 结果 | 关键指标 / 证据路径 |
|---|---|---|---|
| `offline_host_r3` | `node tests/test_host_unit.js` | **PASS (15/15, exit=0, 74ms)** | `evidence/r3/offline_tests/results.txt` |
| `offline_reaper_r3` | `node tests/test_reaper_unit.js` | **PASS (16/16, exit=0, 367ms)** | `evidence/r3/offline_tests/results.txt` |
| `offline_update_lock_r3` | `node tests/test_update_lock.js`（UL1–UL9，含无修改 NO-OP、保留自定义键、`--update-yml-out`） | **PASS (11/11, exit=0, 275ms)** | `evidence/r3/offline_tests/results.txt` |
| `offline_repatch_r3` | `node tests/test_repatch_unit.js`（RP1–RP13 + RP6b，基于 `5B493943...` 白名单） | **PASS (14/14, exit=0, 21665ms)** | `evidence/r3/offline_tests/results.txt` |
| `offline_fault_injection_r3` | `node tests/test_fault_injection.js`（FI-S1/S2、FI-R1..R8b 替换与还原故障、FI-U1..U5b 目录互换与占用故障、FI-Y1..Y6 YAML 事务故障） | **PASS (23/23, exit=0, 46990ms)** | `evidence/r3/fault_injection_unit/fault_injection_matrix.json` 及 `FI-*.txt` |
| `offline_manifest_r3` | `node tests/test_manifest_integrity.js`（MF1–MF5：全部原有 52 条 + 新增文件 Git Blob 原始字节与 `git archive` 逐条校验） | **PASS (5/5, exit=0)**（提交后于 `post_commit_all_tests.txt` 复核） | `evidence/r3/manifest/manifest_raw_and_archive_audit.txt` |
| `ci_linux_sim_r3` | Linux 平台模拟执行 `test_repatch_unit.js`（2/2）与 `test_fault_injection.js`（2/2，明确输出非 Windows 跳过原因） | **PASS (4/4, exit=0)** | `evidence/r3/offline_tests/results.txt` |
| `ci_remote_r3` | GitHub Actions `.github/workflows/test.yml`（已新增 `test_fault_injection.js` 与 `test_manifest_integrity.js` 至 Windows/Ubuntu 双矩阵） | **待推送后由编程确认** | 本轮严格不 `git push`，远端 Runner 待推送触发 |

### 6.2 纯净官方夹具实机回归、安装器 20/20 与真实故障注入（`5B493943...` + `@electron/asar v4.3.2`）

| 用例 ID | 测试内容 | 退出码 | 恢复状态 (`RECOVERY_STATE`) | 目标 / 备份关键 SHA256 与结论 | 原始证据路径 |
|---|---|---|---|---|---|
| `install_upgrade_r3` | `install-or-update.ps1 -SkipRepatch` 隔离回归（`-DryRun` + 首次安装 + 两轮升级幂等） | `exit 0` | — | **20/20 PASS**；64 项快照 diff=0，12 个用户文件不变 | `evidence/r3/install_upgrade/result.txt` |
| `R3-REG-A` | 官方 `5B493943...` + 非默认自定义 `app-update.yml` 首次重铸 | `exit 0` | `SUCCESS` (`CONSISTENT_NEW`) | `.bak`=`5B493943...`，产出=`E17875BA...`，YAML 更新并保留 `customUserFlag` | `evidence/r3/real_official_regression/R3-REG-A.txt` |
| `R3-REG-B` | 重复重铸（已符合配置 YAML + 已有 `.bak`） | `exit 0` | `SUCCESS` (`CONSISTENT_NEW`) | `.bak` mtime/哈希不变，`.modded_prev_*` 落盘，YAML NO-OP 零写盘 | `evidence/r3/real_official_regression/R3-REG-B.txt` |
| `R3-REG-C` | `restore-official.ps1` 还原官方原版 | `exit 0` | `SUCCESS` | 目标还原回 `5B493943...`，旧改装版归档于 `displaced_mod_*` | `evidence/r3/real_official_regression/R3-REG-C.txt` |
| `R3-REG-D` | 无 `.bak` + 已改装 `app.asar` 拒绝写 `.bak` | `exit 4` | `CLEAN_NO_CHANGE` | 打印 `ALARM`，未生成 `.bak`，目标维持 `E17875BA...` | `evidence/r3/real_official_regression/R3-REG-D.txt` |
| `R3-P0-2-POLLUTED` | 污染 `.bak` 触发双脚本拒绝 | `exit 4` | `CLEAN_NO_CHANGE` | `repatch.ps1` 与 `restore-official.ps1` 均 `ALARM` + `exit 4` | `evidence/r3/real_official_regression/R3-P0-2-POLLUTED.txt` |
| `R3-REG-E` | 真实解包后模拟 `asar pack` 失败（`exit 19`）+ 非默认 YAML | `exit 19` | `CLEAN_NO_CHANGE` | 目标保持 `5B493943...`，YAML 未变动，临时目录清理 | `evidence/r3/real_official_regression/R3-REG-E.txt` |
| `R3-P0-1a/1b` | 真实 `FileStream` 锁（`FileShare.None` / `FileShare.Read`） | `exit 10` | `CLEAN_NO_CHANGE` | 两类锁均安全中止，目标保持 `5B493943...`，YAML 不变 | `evidence/r3/real_official_regression/R3-P0-1a-LOCK-NONE.txt`、`R3-P0-1b-LOCK-READ.txt` |
| `R3-REAL-FI-POST-EXC` | 真实 `asar` 替换成功后抛出异常 (`post_replace_exception`) | `exit 9` | `RECOVERED_AUTO` | 自动原子回滚至 `5B493943...`，无残留临时目录 | `evidence/r3/real_official_regression/R3-REAL-FI-POST-EXC.txt` |
| `R3-REAL-FI-LOCKED` | 真实 `asar` 替换后目标被锁 (`post_replace_target_locked`) | `exit 10` | `UNKNOWN/NEEDS_RECOVERY` | 保留 `.agm_repatch_tmp_*` 与完整 `5B493943...` 备份材料 | `evidence/r3/real_official_regression/R3-REAL-FI-LOCKED.txt` |
| `R3-REAL-FI-UNPACKED-FAIL` | 真实 `unpacked` 互换与恢复失败 | `exit 11` | `FAILED_NEEDS_MANUAL_RECOVERY` | `INCONSISTENT_ASAR_UNPACKED`，`finally` 物理保留 `app.asar.unpacked.orig_bak` | `evidence/r3/real_official_regression/R3-REAL-FI-UNPACKED-FAIL.txt` |
| `R3-REAL-FI-YAML-PARTIAL` | 真实 `asar` 后 YAML 写入部分损坏 (`yaml_write_partial_fail`) | `exit 12` | `RECOVERED_AUTO` | YAML、ASAR、`unpacked` 三者同步自动回滚至原态 | `evidence/r3/real_official_regression/R3-REAL-FI-YAML-PARTIAL.txt` |
| `R3-REAL-FI-RESTORE-MISMATCH` | 真实 `restore-official.ps1` 还原后哈希不一致 | `exit 4` | `RECOVERED_AUTO` | 安全原子回滚至还原前改装版 `E17875BA...`，`.bak` 不变 | `evidence/r3/real_official_regression/R3-REAL-FI-RESTORE-MISMATCH.txt` |
| `R3-REAL-FI-INSTALLER-FAIL` | 安装器调用 `repatch.ps1` 失败（含自定义上游 YAML） | `exit 19` | `CLEAN_NO_CHANGE` | 活动 YAML SHA256 原封不动，无多余 `.bak_*` | `evidence/r3/real_official_regression/R3-REAL-FI-INSTALLER-FAIL.txt` |

### 6.3 Manifest 原始字节一致性与纳入清单评估

- **Blob 统一与原始字节复核**：修正前检查发现 Git 对象库中 `platform/mod_kit/app-update.template.yml`（263 字节）与 `platform/scripts/legacy-rollback/rollback.bat`（178 字节）存在 CRLF Blob，导致与按 LF 计算的 `manifest.repo.json`（259 / 174 字节）不一致。本轮已将该 2 个文件以纯 LF Blob 规范入库，全量清单实现 **100% 原始 Git Blob 零归一化逐字节一致**。同时实测核验了 `.gitattributes`（仓库无此文件）与归档行为差异：在 `core.autocrlf=true` 的 Windows 主机上直接执行 `git archive` 会将文本 Blob 转回 CRLF（例如 `.gitignore` 2376 -> 2521 字节），而使用 Linux 发行环境或 `git -c core.autocrlf=false archive` 生成发行归档时，全部 52+4 条记录原始字节与 `manifest.repo.json` **100% 吻合**。
- **是否将 `tests/test_repatch_unit.js`（及 R3 新增发行测试）纳入 Manifest 的评估结论**：**应当纳入**。理由：`tests/test_repatch_unit.js`、`tests/test_fault_injection.js`、`tests/test_manifest_integrity.js` 与 `docs/WINDOWS_TEST_EVIDENCE.md` 均通过 `git archive` 随发行仓库分发并直接参与 CI 与本地发行门禁校验（已有 `test_host_unit.js`、`test_reaper_unit.js`、`test_update_lock.js` 也均在 `manifest.repo.json` 内），纳入清单可保证测试门禁代码本身的完整性与可溯源性；而 `manifest.repo.json` 自身不可自引用（SHA256 无法包含自身）。
- **自动恢复 vs 人工介入边界**：详见 [`docs/INSTALL.md`](INSTALL.md) 第 8 节对照表。
- **热重载状态**：`client_h` 维持 **UNKNOWN**（不在本 PR 修复范围，未修改插件）。
