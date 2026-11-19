Round 1 | 2026-11-20 03:20
# 任务 AGM-CLEANUP-READONLY-AUDIT-01：历史交付物与临时目录清理前只读审计报告

- **任务编号**：`AGM-CLEANUP-READONLY-AUDIT-01`
- **任务性质**：清理前独立复查（严格只读盘点、哈希核验、依赖分析、提出清理建议）
- **本轮授权**：**禁止删除、移动、覆盖任何原始文件；仅生成本审计报告与视觉预览图。**
- **审计采样时间**：`2026-11-20 03:17:31`（报告生成 `2026-11-20 03:20`）
- **核心结论摘要**：
  1. **审计对象 A（`/workspace/agm/`）**：**`BLOCKED`**（Windows 实机与 WSL 均不存在该 POSIX 路径，已由仓库文档确认为云端 Linux 盒子路径；证据不足，暂时不能清理）。
  2. **审计对象 B（`docs/` A01 & C-6 原始 ZIP）**：**`59 / 59 PASS`**，其中 `docs/` 下两份原始 ZIP（合计 `5,439,056` B / `5.19 MiB`）与 `evidence/` 内已解包 57 个文件及逐字节同版 ZIP 副本完全一致、无代码/测试依赖，标为 **`RECOMMENDED FOR CLEANUP`**（待获批后执行）；`evidence/` 内的两份原版 ZIP 副本属“重复但具历史审计价值”予以保留。
  3. **审计对象 C（`COMPAT_233_01` 安装包）**：`Antigravity-x64.exe`（`182,549,552` B / `174.09 MiB`，Google LLC 有效 Authenticode 签名）为唯一带数字签名的 2.33.0 官方原始安装介质且无其他副本，判定 **`A. 必须保留`**（**`PASS`**）。

---

## 一、检查范围、项目根目录与项目状态保护

### 1.1 允许检查路径与边界确认

本轮严格仅访问任务授权范围，未扫描 `02_Personal/`、其他无关项目或执行全盘无差别递归搜索：

| 检查对象 | 确认路径 | 类型 / 身份 | 核验状态 |
| --- | --- | --- | --- |
| Drive 项目根（非 Git） | `G:\我的云端硬盘\01_Projects\Antigravity_Mod` | 文档/证据/本地化汇总根（`docs/`, `evidence/`, `locales/`） | **PASS** |
| 最新活跃 Git 仓库 | `C:\AGM_TestLab\IPC_SEC_A02\repo` | `https://github.com/wangxu1428/Antigravity_Mod`（`dev/compat-233-stage-b`） | **PASS** |
| A01 历史只读仓库 | `C:\AGM_TestLab\IPC_SEC_A01\repo` | detached HEAD（`84dc8e9`），基线核对 | **PASS** |
| Stage-A 基线仓库 | `C:\AGM_TestLab\COMPAT_233_01\repo` | `main`（`923110e`），基线核对 | **PASS** |
| 对象 A（Linux 临时目录） | `/workspace/agm/`（跨平台探测 Windows 候选路径 + `wsl.exe`） | 仅存在于云端 Linux 盒子（`SECURITY_AUDIT_IPC_SEC_01.md:L5`） | **BLOCKED** |
| 对象 B（`docs/` & `evidence/`） | `docs/AGM_IPC_REALBASE_A01/`, `docs/AGM_IPC_C6_FIX_01/`, `evidence/IPC_*` | A01(27) + C-6(32) + CLOSEOUT(31) | **PASS** |
| 对象 C（2.33.0 安装包目录） | `C:\AGM_TestLab\COMPAT_233_01\base_2330\` | `Antigravity-x64.exe` 及解包产物链（6 个文件） | **PASS** |
| 交付闪存箱 | `G:\我的云端硬盘\00_Flash_Box` | 前置交付 `AGM_EVIDENCE_ARCHIVE_A01_*` 及本轮交付物输出位置 | **PASS** |

### 1.2 Git 状态、PR #10 本地记录与保护声明

| 保护检查项 | 实测值 / 本地记录 | 状态 |
| --- | --- | --- |
| 当前活跃分支（`C:\AGM_TestLab\IPC_SEC_A02\repo`） | `dev/compat-233-stage-b`（跟踪 `origin/dev/compat-233-stage-b`） | **PASS** |
| 当前 `HEAD` | `29600a9a8b1b40051ea988c97e81871f423dbcb6` | **PASS** |
| 工作区是否干净 | `## dev/compat-233-stage-b...origin/dev/compat-233-stage-b`（0 未跟踪/未提交变更，`is_clean=true`） | **PASS** |
| 本地 `main` 当前提交 | `923110e60cdb928b41a28ad2994f71bbed4bf730`（`origin/main` 一致） | **PASS** |
| 本地 Tag 列表 | `platform-v2.1.0`（指向 `d9dad3f03a3abd53a3888cbf0dd52bbb798f082e`） | **PASS** |
| PR #10 本地记录（`evidence/IPC_C6_CLOSEOUT_01/pr10_final_view.json`） | `state=OPEN`、`isDraft=True`、`mergedAt=None`、`headRefOid=29600a9a8b1b40051ea988c97e81871f423dbcb6`（领先 `main` 共 `5` 次提交：`26923e4`、`a22f044`、`5afa3c4`、`84dc8e9`、`29600a9`） | **PASS（本地快照只读核验）** |
| 源码 / 测试 / 配置 / Git / Tag / Release 修改 | 0 次修改操作（`git status` 前后均干净） | **PASS** |
| GitHub 远端与 PR #10 联网修改 | 本轮未调用 `gh` 或执行 `git push`，远端未变更；未执行联网实时复拉校验 | **NOT RUN（外部联网复检未执行；本轮零写操作）** |
| 正式 IDE（`D:\AI_Studio\Apps\Antigravity\`）与插件授权 | 未启动、未关闭、未扫描或修改正式 IDE 及插件授权状态 | **NOT RUN（外部扫描未执行；本轮零操作/零影响）** |

---

## 二、验收指标与审计总览

| 验收指标 | 要求 | 本轮实测结果 | 判定 |
| --- | --- | --- | --- |
| 检查范围准确率 | 100% | 严格限定于项目仓库、`docs/`、`evidence/`、`COMPAT_233_01`、`00_Flash_Box/` 及跨平台路径探针 | **PASS** |
| 已确认文件 SHA256 记录率 | 100% | 对象 B 2+59 项、对象 C 6 项、`docs/` 6 项、`00_Flash_Box/` 全部文件均实测记录 SHA256 | **PASS** |
| 证据文件成员核对率（可访问范围） | 100% | A01 `26/26` + C-6 `31/31` + 原 ZIP 副本 `2/2` 全量逐字节校验一致；`/workspace/agm/` 为不可访问路径 | **PASS（可访问范围 100%）** |
| 对象 A：`/workspace/agm/` 审计 | 逐目录核验 | Windows 实机与 WSL 不存在，为云端 Linux 盒子 POSIX 路径 | **BLOCKED** |
| 对象 B：`docs/` A01 & C-6 原始 ZIP | 成员与元数据核对 | `59/59` 一致且无外部依赖，两份 `docs/*.zip` 冗余；`evidence/*.zip` 具容器审计价值 | **RECOMMENDED FOR CLEANUP（仅 `docs/*.zip`）** |
| 对象 C：`COMPAT_233_01` 安装包 | 版本/签名/唯一性 | 唯一签名 2.33.0 安装包（`182,549,552` B，`Google LLC` Valid），无其他副本 | **PASS（A. 必须保留）** |
| 原始文件删除 / 移动 / 覆盖 | 0 / 0 / 0 | 审计前后 SHA256 核验 `0` 删除、`0` 移动、`0` 覆盖 | **PASS** |
| 源码修改 / Git 变更 | 0 / 0 | `git status --porcelain` 前后均空（0 变更） | **PASS** |
| 人工 UI 回归记录 | USER-CONFIRMED | 4 项用户实测已记录并显式标记，未伪装为自动化日志 | **PASS（USER-CONFIRMED）** |

---

## 三、审计对象 A：`/workspace/agm/`（状态：`BLOCKED`）

### 3.1 跨平台可达性实测记录

| 检查方式 / 候选路径 | 实测结果 | 详细说明 |
| --- | --- | --- |
| Windows/POSIX 映射探测 `C:\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| Windows/POSIX 映射探测 `D:\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| Windows/POSIX 映射探测 `C:\Users\Administrator\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| Windows/POSIX 映射探测 `C:\Program Files\Git\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| Windows/POSIX 映射探测 `C:\msys64\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| Windows/POSIX 映射探测 `C:\cygwin64\workspace\agm` | 不存在 (`exists=False`) | 未发现本地映射目录 |
| WSL 子系统探测 `wsl.exe --list --all` | 退出码 `1`（`wsl_installed=False`） | 本机未安装任何 WSL Linux 发行版（`wsl.exe` 输出安装帮助页） |
| 仓库文档溯源 | 命中记录 | `C:\AGM_TestLab\IPC_SEC_A02\repo\docs\SECURITY_AUDIT_IPC_SEC_01.md:L5 -> - 环境：云端 Linux 盒子（`/workspace/agm/ipcsec`），非 Windows 实机；旭的 Windows PC 本轮离线。` |

### 3.2 子目录 8 项指标与处置结论

- **实测判定**：依据停止条件与证据要求，`/workspace/agm/` 属于独立云端 Linux 盒子（如 `c6close`、`ipcsec`、`A01` 等远端沙箱）内部 POSIX 路径，在当前 Windows 主机（`DESKTOP-7RTP0QJ`）上无法直接访问。
- **8 项审计指标状态（子目录名/路径、文件数、子目录数、逻辑体积、最后修改时间、SHA256、副本排查、引用与唯一证据判断）**：全部标记为 **`BLOCKED`**。
- **严禁动作**：不得因历史任务名称包含 `temp`、`backup`、`old`、`c6close` 而臆测允许删除。
- **处置归类**：**证据不足、暂时不能清理（`BLOCKED`）**。后续若需清理 `/workspace/agm/`，必须在对应 Linux 盒子上另行发起只读盘点与哈希核验后再决策。

---

## 四、审计对象 B：A01 / C-6 原始 ZIP 与 `evidence/` 全量核对

### 4.1 压缩包整体属性、元数据与完整性对比

| 对比维度 | A01（`IPC_REALBASE_A01_evidence.zip`） | C-6（`IPC_C6_FIX_01_evidence.zip`） |
| --- | --- | --- |
| `docs/` 源文件路径 | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` |
| `docs/` 源文件大小 / 修改时间 | `2,713,318` B / `2026-11-20 00:15:04` | `2,725,738` B / `2026-11-20 01:00:37` |
| `docs/` 源文件 SHA256 | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` |
| `evidence/` 同版 ZIP 副本路径 | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\evidence\IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\evidence\IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` |
| `evidence/` 原版 ZIP 逐字节匹配 | `True` (**PASS**) | `True` (**PASS**) |
| `ZipFile.testzip()` 完整性 | `None`（0 损坏条目） | `None`（0 损坏条目） |
| ZIP 全局注释 / 压缩方式 | 空 (`''`) / `DEFLATE (type=8)` | 空 (`''`) / `DEFLATE (type=8)` |
| ZIP 内独立目录条目 (`is_dir`) | `1` 条：`evidence/`（`2026-11-20 00:07:26`，`attr=0x41ff0000`） | `0` 条（直接平铺于压缩包根目录） |
| ZIP 内部文件成员数 / 解包总字节 | `26` 个 / `3,479,193` B | `31` 个 / `3,616,976` B |
| `evidence/` 对应目录实际文件数 / 总字节 | `27` 个（26 解包 + 1 ZIP）/ `6,192,511` B | `32` 个（31 解包 + 1 ZIP）/ `6,342,714` B |
| ZIP 内部额外未归档文件 / 哈希不匹配 | `0` / `0` | `0` / `0` |

### 4.2 A01 成员清单逐项核对（26 个成员 + 1 个 ZIP 副本 = 27 项，`27/27 PASS`）

> 注：ZIP 内部存在 `1` 个目录占位条目 `evidence/`（0 字节，mtime `2026-11-20 00:07:26`）；归档至 `evidence/IPC_REALBASE_A01/` 时已规范化剥离 `evidence/` 前缀，并同步保留完整原版 ZIP 副本以留存目录条目及压缩元信息。

| # | 归档文件名 | ZIP 内原始路径 | 大小 (B) | 压缩后 (B) | CRC32 | ZIP 时间戳 | 成员 SHA256 | `evidence/` SHA256 | 状态 |
| ---: | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | `bases_and_backups_sha256.json` | `evidence/bases_and_backups_sha256.json` | `3,872` | `693` | `CD5770E4` | `2026-11-19 23:49:56` | `79CE4BF90E7E00A202142A6CD5D057BC7F3633B8DE91F26031CD293616520BDF` | `79CE4BF90E7E00A202142A6CD5D057BC7F3633B8DE91F26031CD293616520BDF` | **PASS** |
| 2 | `bases_and_backups_sha256.txt` | `evidence/bases_and_backups_sha256.txt` | `1,324` | `418` | `B558895B` | `2026-11-19 23:49:56` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | **PASS** |
| 3 | `cold_start_2.32.1.json` | `evidence/cold_start_2.32.1.json` | `15,492` | `1,404` | `2B5B68D8` | `2026-11-20 00:07:22` | `C5049626124E41EA4A8B0264163893F5DF28DF735601119E940F4DB288B30926` | `C5049626124E41EA4A8B0264163893F5DF28DF735601119E940F4DB288B30926` | **PASS** |
| 4 | `cold_start_2.33.0.json` | `evidence/cold_start_2.33.0.json` | `15,376` | `1,404` | `64599775` | `2026-11-20 00:07:22` | `7BD9388D3EFACA5D9125E327BF45B9EF92BCCC2B1EEC6A0725892095C4335035` | `7BD9388D3EFACA5D9125E327BF45B9EF92BCCC2B1EEC6A0725892095C4335035` | **PASS** |
| 5 | `formal_ide_snapshot_after.json` | `evidence/formal_ide_snapshot_after.json` | `256,061` | `19,298` | `D4A8EB6A` | `2026-11-20 00:07:26` | `1F2BF7CE0A28F149EBBAFDDC4FB1ADFDBE31DA205D3CE4AAFC4EECAB3DCC869C` | `1F2BF7CE0A28F149EBBAFDDC4FB1ADFDBE31DA205D3CE4AAFC4EECAB3DCC869C` | **PASS** |
| 6 | `formal_ide_snapshot_before.json` | `evidence/formal_ide_snapshot_before.json` | `256,826` | `19,291` | `2197297B` | `2026-11-19 23:49:20` | `DAA5914B6E42B370E328A3096AE04E95D90297A8C089ACA8704E9860B76320E8` | `DAA5914B6E42B370E328A3096AE04E95D90297A8C089ACA8704E9860B76320E8` | **PASS** |
| 7 | `formal_ide_snapshot_diff.txt` | `evidence/formal_ide_snapshot_diff.txt` | `3,949` | `1,460` | `60AF2D92` | `2026-11-20 00:07:26` | `74646062F6453F4A68624F73268A47034EB69DC5118353FDE747081FFD313FD2` | `74646062F6453F4A68624F73268A47034EB69DC5118353FDE747081FFD313FD2` | **PASS** |
| 8 | `git_baseline.txt` | `evidence/git_baseline.txt` | `1,113` | `510` | `CA0A4781` | `2026-11-19 23:49:26` | `573F7F2283F23EA63748456374FC785AB703060A5AB77E05820692B6FFCDD298` | `573F7F2283F23EA63748456374FC785AB703060A5AB77E05820692B6FFCDD298` | **PASS** |
| 9 | `ipc_results_2.32.1.json` | `evidence/ipc_results_2.32.1.json` | `30,899` | `4,155` | `2173AE6C` | `2026-11-20 00:06:42` | `0FEE683295787967EB8D57BFA39ECE526720C90773673FA35BF52C972CCCDDD1` | `0FEE683295787967EB8D57BFA39ECE526720C90773673FA35BF52C972CCCDDD1` | **PASS** |
| 10 | `ipc_results_2.33.0.json` | `evidence/ipc_results_2.33.0.json` | `30,670` | `4,108` | `8EC22196` | `2026-11-20 00:06:56` | `3787734A9DD5C43D5014D825F1B3314F0B4504A8D6AACBE699DDA82D5BED5127` | `3787734A9DD5C43D5014D825F1B3314F0B4504A8D6AACBE699DDA82D5BED5127` | **PASS** |
| 11 | `launch_2.32.1_cold1.log` | `evidence/launch_2.32.1_cold1.log` | `24,059` | `4,708` | `A7E74529` | `2026-11-20 00:07:22` | `7DB21452821B77616A70FC74EDB3B8D9CF1F1EACF59C977C89161F3D5CD482AB` | `7DB21452821B77616A70FC74EDB3B8D9CF1F1EACF59C977C89161F3D5CD482AB` | **PASS** |
| 12 | `launch_2.32.1_cold2.log` | `evidence/launch_2.32.1_cold2.log` | `24,601` | `4,726` | `ADF201FA` | `2026-11-20 00:07:22` | `BB446B534F0F30BAC64A53116C6F13A4131D355ACFED40035C263E512A7EAF8B` | `BB446B534F0F30BAC64A53116C6F13A4131D355ACFED40035C263E512A7EAF8B` | **PASS** |
| 13 | `launch_2.33.0_cold1.log` | `evidence/launch_2.33.0_cold1.log` | `23,852` | `4,657` | `93E2E9D9` | `2026-11-20 00:07:22` | `39DC70F08006E60DC5599CAE59A30B6FBFE80E865450DF955D4981F35AAD82D6` | `39DC70F08006E60DC5599CAE59A30B6FBFE80E865450DF955D4981F35AAD82D6` | **PASS** |
| 14 | `launch_2.33.0_cold2.log` | `evidence/launch_2.33.0_cold2.log` | `24,971` | `4,741` | `866E9E2B` | `2026-11-20 00:07:22` | `C3E90DDFC2319320596777915915A0B937B1C78EE232D374CF28897FB557B519` | `C3E90DDFC2319320596777915915A0B937B1C78EE232D374CF28897FB557B519` | **PASS** |
| 15 | `patch_2.32.1.log` | `evidence/patch_2.32.1.log` | `2,051` | `809` | `3E4D41BE` | `2026-11-19 23:51:20` | `B8DD37283DA99332CFC187951F2BF29510B6DFED5192985208D8B24CD3CA066D` | `B8DD37283DA99332CFC187951F2BF29510B6DFED5192985208D8B24CD3CA066D` | **PASS** |
| 16 | `patch_2.33.0.log` | `evidence/patch_2.33.0.log` | `2,051` | `810` | `3C1F4D4F` | `2026-11-19 23:51:22` | `26F4ED03F95502AEE9DDB60AB9D3D77F6DFB5A954B36FD3F68123CE10C9A420D` | `26F4ED03F95502AEE9DDB60AB9D3D77F6DFB5A954B36FD3F68123CE10C9A420D` | **PASS** |
| 17 | `patch_verify_2.32.1.json` | `evidence/patch_verify_2.32.1.json` | `2,913` | `601` | `C1E16A5C` | `2026-11-19 23:51:22` | `EB6BCCCDD7F6ECC5F81A1772E057C0A82ACA0C14D59E716D96521353AA706F31` | `EB6BCCCDD7F6ECC5F81A1772E057C0A82ACA0C14D59E716D96521353AA706F31` | **PASS** |
| 18 | `patch_verify_2.33.0.json` | `evidence/patch_verify_2.33.0.json` | `2,913` | `601` | `C716632C` | `2026-11-19 23:51:24` | `91E5BDF349A63F78C20976C09813917C8508E0664F29AD47D1AC5DEF68C31D60` | `91E5BDF349A63F78C20976C09813917C8508E0664F29AD47D1AC5DEF68C31D60` | **PASS** |
| 19 | `probe_2.32.1.log` | `evidence/probe_2.32.1.log` | `44,931` | `5,297` | `8D157687` | `2026-11-20 00:06:46` | `8EECD22658CB021BFE7A79C40556DF57BDC61DA5901C6E1E533FEDC1E78BAB7B` | `8EECD22658CB021BFE7A79C40556DF57BDC61DA5901C6E1E533FEDC1E78BAB7B` | **PASS** |
| 20 | `probe_2.33.0.log` | `evidence/probe_2.33.0.log` | `45,115` | `5,403` | `DFD67DF0` | `2026-11-20 00:07:02` | `BE35A9570C2D2BE7A35C4677003A0EF3AE02CD9F7801D1999F635E1712D34732` | `BE35A9570C2D2BE7A35C4677003A0EF3AE02CD9F7801D1999F635E1712D34732` | **PASS** |
| 21 | `restore_and_isolation_check.json` | `evidence/restore_and_isolation_check.json` | `2,083` | `502` | `293ED590` | `2026-11-20 00:07:26` | `CD037AEE1EFCA613E0E6FD212142C6FAA6EA4798BC09C11B3B903552D9B5A507` | `CD037AEE1EFCA613E0E6FD212142C6FAA6EA4798BC09C11B3B903552D9B5A507` | **PASS** |
| 22 | `screenshot_2.32.1_cold1.png` | `evidence/screenshot_2.32.1_cold1.png` | `662,487` | `653,084` | `BCA9CA28` | `2026-11-19 23:52:48` | `C7096B292D6E672E088EB98674FBDF4F3FA9966A816435BBD13E3097D6E51332` | `C7096B292D6E672E088EB98674FBDF4F3FA9966A816435BBD13E3097D6E51332` | **PASS** |
| 23 | `screenshot_2.32.1_cold2.png` | `evidence/screenshot_2.32.1_cold2.png` | `662,108` | `652,641` | `07015583` | `2026-11-19 23:54:00` | `6FE174E0D78D4817F05E55945A4F243622A3ED4F4BF46078964DE74B8C7A7F92` | `6FE174E0D78D4817F05E55945A4F243622A3ED4F4BF46078964DE74B8C7A7F92` | **PASS** |
| 24 | `screenshot_2.33.0_cold1.png` | `evidence/screenshot_2.33.0_cold1.png` | `667,559` | `657,637` | `1F0A3EBF` | `2026-11-19 23:55:10` | `FF98F86B304ADA98DFD3345B81682D2415EB4737B8ABC21CAD922583ECCA640F` | `FF98F86B304ADA98DFD3345B81682D2415EB4737B8ABC21CAD922583ECCA640F` | **PASS** |
| 25 | `screenshot_2.33.0_cold2.png` | `evidence/screenshot_2.33.0_cold2.png` | `667,464` | `657,572` | `7798812B` | `2026-11-19 23:56:20` | `21CA496B20E7D8C9CC50243C8B3CCC16CF78F0C4D11DE0381514DBB48C8FFE69` | `21CA496B20E7D8C9CC50243C8B3CCC16CF78F0C4D11DE0381514DBB48C8FFE69` | **PASS** |
| 26 | `updater_lock_check.json` | `evidence/updater_lock_check.json` | `4,453` | `846` | `E64B7D51` | `2026-11-19 23:51:24` | `E0D0CED0D3C0C5FAA18C2E53E2ED07EF093E7B2AC3F55C391536E35A2883CA0E` | `E0D0CED0D3C0C5FAA18C2E53E2ED07EF093E7B2AC3F55C391536E35A2883CA0E` | **PASS** |
| 27 | `IPC_REALBASE_A01_evidence.zip` | *(容器整包)* | `2,713,318` | — | — | `2026-11-20 00:15:04` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | **PASS** |

### 4.3 C-6 成员清单逐项核对（31 个成员 + 1 个 ZIP 副本 = 32 项，`32/32 PASS`）

| # | 归档文件名 | ZIP 内原始路径 | 大小 (B) | 压缩后 (B) | CRC32 | ZIP 时间戳 | 成员 SHA256 | `evidence/` SHA256 | 状态 |
| ---: | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | `bases_and_backups_sha256.json` | `bases_and_backups_sha256.json` | `3,872` | `689` | `B0905724` | `2026-11-20 00:41:16` | `1575173434594926CB59A85CF6AE8C3A8B51A58211B03BCD1A8CF699D4DA3A1C` | `1575173434594926CB59A85CF6AE8C3A8B51A58211B03BCD1A8CF699D4DA3A1C` | **PASS** |
| 2 | `bases_and_backups_sha256.txt` | `bases_and_backups_sha256.txt` | `1,324` | `417` | `B558895B` | `2026-11-20 00:41:16` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | **PASS** |
| 3 | `ci_run_summary.json` | `ci_run_summary.json` | `6,360` | `758` | `25ACC768` | `2026-11-20 00:52:24` | `03AEFBE3D7E2A1EE88C2E3D35A34DA0E0D44D2A83A6E7849952389411BFE57EF` | `03AEFBE3D7E2A1EE88C2E3D35A34DA0E0D44D2A83A6E7849952389411BFE57EF` | **PASS** |
| 4 | `cold_start_2.32.1.json` | `cold_start_2.32.1.json` | `15,363` | `1,427` | `F0D7A767` | `2026-11-20 00:52:04` | `7B71633573E67CB4181674A5775D866731A33B15DF92130D46972D06DFF61C89` | `7B71633573E67CB4181674A5775D866731A33B15DF92130D46972D06DFF61C89` | **PASS** |
| 5 | `cold_start_2.33.0.json` | `cold_start_2.33.0.json` | `15,370` | `1,450` | `911E8E2C` | `2026-11-20 00:52:04` | `419EC385FBDD7EC5E2317179E85812EE395AAB5D57F766FA533247E71CEC4458` | `419EC385FBDD7EC5E2317179E85812EE395AAB5D57F766FA533247E71CEC4458` | **PASS** |
| 6 | `formal_ide_snapshot_after.json` | `formal_ide_snapshot_after.json` | `260,454` | `20,824` | `562E345F` | `2026-11-20 00:54:34` | `08B0874C13E4DAD2B613BA0C1E2E0F411142985B13EB3157A1E46B087923CAD3` | `08B0874C13E4DAD2B613BA0C1E2E0F411142985B13EB3157A1E46B087923CAD3` | **PASS** |
| 7 | `formal_ide_snapshot_before.json` | `formal_ide_snapshot_before.json` | `260,454` | `20,830` | `2E910C5E` | `2026-11-20 00:38:12` | `F79393CEBCA453156C75A2B0AED8E4BF3FEEBA6AB585F7E5A632942AC213F0B1` | `F79393CEBCA453156C75A2B0AED8E4BF3FEEBA6AB585F7E5A632942AC213F0B1` | **PASS** |
| 8 | `formal_ide_snapshot_diff.txt` | `formal_ide_snapshot_diff.txt` | `4,145` | `1,478` | `A2988D7D` | `2026-11-20 00:54:34` | `52174ECE8BC89E3996302EE414CC226AEB3E0230858EFE61125FFF20EED0C9D3` | `52174ECE8BC89E3996302EE414CC226AEB3E0230858EFE61125FFF20EED0C9D3` | **PASS** |
| 9 | `git_baseline.txt` | `git_baseline.txt` | `372` | `203` | `EC690FDA` | `2026-11-20 00:38:26` | `FC7E94FF8549B37351E57411D136A79A4467A6783C5FED3116FF684AE89D3E81` | `FC7E94FF8549B37351E57411D136A79A4467A6783C5FED3116FF684AE89D3E81` | **PASS** |
| 10 | `ipc_results_2.32.1.json` | `ipc_results_2.32.1.json` | `45,995` | `4,553` | `AE023027` | `2026-11-20 00:52:34` | `1FD86CDBCF705F0077A515E97A2FAB511955B467A64096E601049C9C3BEC998B` | `1FD86CDBCF705F0077A515E97A2FAB511955B467A64096E601049C9C3BEC998B` | **PASS** |
| 11 | `ipc_results_2.33.0.json` | `ipc_results_2.33.0.json` | `45,995` | `4,563` | `D172E316` | `2026-11-20 00:52:48` | `5A48569C2E12A3E92191328001137382CFE44BCD0E40AF79DB477D780030F0FA` | `5A48569C2E12A3E92191328001137382CFE44BCD0E40AF79DB477D780030F0FA` | **PASS** |
| 12 | `launch_2.32.1_cold1.log` | `launch_2.32.1_cold1.log` | `24,019` | `4,747` | `EAC5133C` | `2026-11-20 00:52:04` | `7B2B83177E750D25E042E1EBA0014757FC4FD254EEC6826B878C1E70B954E522` | `7B2B83177E750D25E042E1EBA0014757FC4FD254EEC6826B878C1E70B954E522` | **PASS** |
| 13 | `launch_2.32.1_cold2.log` | `launch_2.32.1_cold2.log` | `25,022` | `4,714` | `D3296D37` | `2026-11-20 00:52:04` | `3EEBDEE08BAC8335E1B30CD987D53418308EC4BD4780B7B61A30855753E271C1` | `3EEBDEE08BAC8335E1B30CD987D53418308EC4BD4780B7B61A30855753E271C1` | **PASS** |
| 14 | `launch_2.33.0_cold1.log` | `launch_2.33.0_cold1.log` | `24,587` | `4,758` | `21D277EB` | `2026-11-20 00:52:04` | `5FBE7119CD982C614BBA2E728C5F5E3AAC1DD466C9D038E01FDEDD8517F5ABD7` | `5FBE7119CD982C614BBA2E728C5F5E3AAC1DD466C9D038E01FDEDD8517F5ABD7` | **PASS** |
| 15 | `launch_2.33.0_cold2.log` | `launch_2.33.0_cold2.log` | `24,969` | `4,768` | `F0EF6180` | `2026-11-20 00:52:04` | `32EDB5B1D826120506A08A7FE8F964AEAC3B5D6B0C430DF8F877653C4AAD4089` | `32EDB5B1D826120506A08A7FE8F964AEAC3B5D6B0C430DF8F877653C4AAD4089` | **PASS** |
| 16 | `local_unit_tests.log` | `local_unit_tests.log` | `18,589` | `6,535` | `17C480F7` | `2026-11-20 00:45:00` | `90DCA01F307E248232B2CEC3BDDBD8062424CAD16C61609A3C52FED3FE4B3BC4` | `90DCA01F307E248232B2CEC3BDDBD8062424CAD16C61609A3C52FED3FE4B3BC4` | **PASS** |
| 17 | `patch_2.32.1.log` | `patch_2.32.1.log` | `2,051` | `812` | `491E8B03` | `2026-11-20 00:45:22` | `A2A6CB23F72971579C3BD607E27E636E3C15A933783585E444EBD2989DEA96C0` | `A2A6CB23F72971579C3BD607E27E636E3C15A933783585E444EBD2989DEA96C0` | **PASS** |
| 18 | `patch_2.33.0.log` | `patch_2.33.0.log` | `2,051` | `812` | `A79CE60D` | `2026-11-20 00:45:24` | `5870A5F8848EA5FD94FDC1D42CBAB6216FD2AF25489630B6C0A8CE05E892B238` | `5870A5F8848EA5FD94FDC1D42CBAB6216FD2AF25489630B6C0A8CE05E892B238` | **PASS** |
| 19 | `patch_verify_2.32.1.json` | `patch_verify_2.32.1.json` | `3,088` | `644` | `E6F1A02D` | `2026-11-20 00:45:24` | `1AC5FCC8EC6263BBE6D887331843ECB2C90981AC351FADF6325639472224A817` | `1AC5FCC8EC6263BBE6D887331843ECB2C90981AC351FADF6325639472224A817` | **PASS** |
| 20 | `patch_verify_2.33.0.json` | `patch_verify_2.33.0.json` | `3,088` | `645` | `CAD3D3DD` | `2026-11-20 00:45:26` | `6F88F8FD3C221CF81E8EA4835BAEA0BDDDE58A2350F610EF250A9FAE16784223` | `6F88F8FD3C221CF81E8EA4835BAEA0BDDDE58A2350F610EF250A9FAE16784223` | **PASS** |
| 21 | `probe_2.32.1.log` | `probe_2.32.1.log` | `81,009` | `6,717` | `F1495C5A` | `2026-11-20 00:52:40` | `0351D49DD1EA8CF1BE416BFABA5AF8270F00B4F5027479049A184C83DE070C0D` | `0351D49DD1EA8CF1BE416BFABA5AF8270F00B4F5027479049A184C83DE070C0D` | **PASS** |
| 22 | `probe_2.33.0.log` | `probe_2.33.0.log` | `80,971` | `6,608` | `3B74AD55` | `2026-11-20 00:52:54` | `E7D5B5B2CEECDF63ACF8E516764E5DECF208AA573E3DE07F0BB3A5CF43E049D9` | `E7D5B5B2CEECDF63ACF8E516764E5DECF208AA573E3DE07F0BB3A5CF43E049D9` | **PASS** |
| 23 | `repo_after_blobs_sha256.txt` | `repo_after_blobs_sha256.txt` | `485` | `294` | `2CCF7091` | `2026-11-20 00:43:20` | `90C78E3F41556A07FAECC1A75448ADE9F9B37EE8A0AE29F704CC44997440C6B5` | `90C78E3F41556A07FAECC1A75448ADE9F9B37EE8A0AE29F704CC44997440C6B5` | **PASS** |
| 24 | `repo_backup_sha256.txt` | `repo_backup_sha256.txt` | `497` | `303` | `2B603BD4` | `2026-11-20 00:38:28` | `0B8365C091C02B7549E75FAA5BCD7F12C2E7D347CDAB9D6300C09CA6ED3C1A97` | `0B8365C091C02B7549E75FAA5BCD7F12C2E7D347CDAB9D6300C09CA6ED3C1A97` | **PASS** |
| 25 | `repo_before_blobs_sha256.txt` | `repo_before_blobs_sha256.txt` | `485` | `297` | `C41CA2B7` | `2026-11-20 00:38:28` | `965AB043C182135F89CC5641745C18253BA36ED4A43D7E2052C03DFC0B95D94C` | `965AB043C182135F89CC5641745C18253BA36ED4A43D7E2052C03DFC0B95D94C` | **PASS** |
| 26 | `restore_and_isolation_check.json` | `restore_and_isolation_check.json` | `2,083` | `502` | `0EF331C0` | `2026-11-20 00:54:34` | `75ADF835F79E811CF860AAA873AB3467E94BDAF0637B16E714FBE26E633A3005` | `75ADF835F79E811CF860AAA873AB3467E94BDAF0637B16E714FBE26E633A3005` | **PASS** |
| 27 | `screenshot_2.32.1_cold1.png` | `screenshot_2.32.1_cold1.png` | `663,294` | `653,678` | `538F7A6E` | `2026-11-20 00:46:58` | `A1AC6895ACEBF6F220F981DA6DC5E4B5C74DF014B24661771FCBD33C0C1FBAC2` | `A1AC6895ACEBF6F220F981DA6DC5E4B5C74DF014B24661771FCBD33C0C1FBAC2` | **PASS** |
| 28 | `screenshot_2.32.1_cold2.png` | `screenshot_2.32.1_cold2.png` | `662,905` | `652,986` | `764CCA04` | `2026-11-20 00:48:10` | `774AF2C9286F4218A81A07A11C1EA7C793BAB3C5213ADF305773D8A5E047EC83` | `774AF2C9286F4218A81A07A11C1EA7C793BAB3C5213ADF305773D8A5E047EC83` | **PASS** |
| 29 | `screenshot_2.33.0_cold1.png` | `screenshot_2.33.0_cold1.png` | `667,095` | `657,397` | `63F2C015` | `2026-11-20 00:49:20` | `DE0F2FE9930AA05E3C90DD9F68D5456FB41576005BDB4769C4AEACD9D1A31EEF` | `DE0F2FE9930AA05E3C90DD9F68D5456FB41576005BDB4769C4AEACD9D1A31EEF` | **PASS** |
| 30 | `screenshot_2.33.0_cold2.png` | `screenshot_2.33.0_cold2.png` | `666,531` | `656,638` | `2D2FD98E` | `2026-11-20 00:50:30` | `9FBC6B929B13458831CB917842FC68E11475598BEB341EC9AEF864C6AC4B17C9` | `9FBC6B929B13458831CB917842FC68E11475598BEB341EC9AEF864C6AC4B17C9` | **PASS** |
| 31 | `updater_lock_check.json` | `updater_lock_check.json` | `4,453` | `843` | `D094403A` | `2026-11-20 00:45:26` | `1FDC612107D44FB12DC3302BD7B0213359093264B627AF1B5CDD2D4C96A595DF` | `1FDC612107D44FB12DC3302BD7B0213359093264B627AF1B5CDD2D4C96A595DF` | **PASS** |
| 32 | `IPC_C6_FIX_01_evidence.zip` | *(容器整包)* | `2,725,738` | — | — | `2026-11-20 01:00:37` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | **PASS** |

### 4.4 同名不同内容、既有目录冲突与元数据不可重建性分析

1. **与既有 `evidence/IPC_C6_CLOSEOUT_01/`（`31` 文件、`233,849` B）重叠检查**：A01 重叠 `0` 个，C-6 重叠 `0` 个（0 冲突）。
2. **A01 与 C-6 跨轮同名内容差异**：两轮共有 `26` 个同名成员文件，其中 **`25` 个 SHA256 不同**（含 `5` 个字节大小完全相同但 SHA256 不同的文件：`bases_and_backups_sha256.json, patch_2.32.1.log, patch_2.33.0.log, restore_and_isolation_check.json, updater_lock_check.json`），仅 **`1` 个逐字节相同**（`bases_and_backups_sha256.txt`）。两轮已分目录存放，无混淆覆盖。
3. **ZIP 容器元数据与目录结构不可重建性评估**：
   - 仅靠解包后的松散文件**无法精确重铸**原 ZIP 的二进制流 SHA256（松散文件丢失了 DOS 文件属性 `external_attr`、ZIP 打包条目 `date_time` 截断精度、DEFLATE 压缩流及 A01 内层 `evidence/` 目录占位条目）。
   - **关键区分**：正因为 `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` 与 `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` 已按原封不动字节归档在 `evidence/` 对应目录中，上述全部目录结构与容器级 SHA256 均可从 `evidence/` 完整保留；因此，**位于 `docs/` 下的两份原 ZIP（`docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` 与 `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip`）不再承担唯一容器保存职责**，可安全标为 `RECOMMENDED FOR CLEANUP`；而 **`evidence/` 内的两份原版 ZIP 副本则建议作为“重复但具历史审计价值”予以保留**。

---

## 五、审计对象 C：`COMPAT_233_01` ~180 MB 安装包审计（结论：`A. 必须保留`）

### 5.1 安装包本体核验明细

| 检查维度 | 实测结果 |
| --- | --- |
| 精确文件名及路径 | `C:\AGM_TestLab\COMPAT_233_01\base_2330\Antigravity-x64.exe` |
| 实际大小 | `182,549,552` 字节（`174.09 MiB` / 约 `174.09 MiB` / `182.55 MB`） |
| 创建 / 修改时间 | `2026-11-19 18:43:28` / `2026-11-19 18:44:14` |
| SHA256 | `44AEA1C00F3B347FD60AB7291D267DBB04A5080F6C3212A8A31CF1426DDF86CB` |
| PE 版本与产品信息 | `ProductName=Antigravity`, `ProductVersion=2.33.0`, `FileVersion=2.33.0`, `CompanyName=Google`, `FileDescription=Antigravity - Agentic Desktop Application` |
| Authenticode 数字签名 | **`Valid`**（`Signature verified.`）<br>签名者：`CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US, SERIALNUMBER=3582691, OID.2.5.4.15=Private Organization, OID.1.3.6.1.4.1.311.60.2.1.2=Delaware, OID.1.3.6.1.4.1.311.60.2.1.3=US`<br>颁发者：`CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, O="DigiCert, Inc.", C=US`<br>指纹：`607A3EDAA64933E94422FC8F0C80388E0590986C`（有效期 `2024-04-08 08:00:00` 至 `2027-04-11 07:59:59`）<br>时间戳：`CN=DigiCert SHA256 RSA4096 Timestamp Responder 2026 1, O="DigiCert, Inc.", C=US` |
| 官方来源双核验记录 | 官方页 `https://antigravity.google/download`，安装包直链 `https://storage.googleapis.com/antigravity-public/antigravity-hub/2.33.0-4731201358004224/windows-x64/Antigravity-x64.exe`（构建号 `2.33.0-4731201358004224`），与微软 `winget-pkgs` 清单预期 SHA256 `44AEA1C00F3B347FD60AB7291D267DBB04A5080F6C3212A8A31CF1426DDF86CB` **100% 匹配（`True`）**（记录于 `COMPAT_233_01\evidence\bases_metadata.json`） |
| 相同副本排查（允许范围全扫描） | 匹配数 = **`1`**（仅 `base_2330\Antigravity-x64.exe` 本身；且本机 `%LOCALAPPDATA%\antigravity-updater` 此前扫描仅含 `2.32.1` `F216EE69...` 与 `2.32.2` `98A3A3BA...`，无任何 `2.33.0` 安装包副本） |
| 是否恢复 2.33.0 测试环境所需唯一安装介质 | **是（唯一带 Google LLC 有效数字签名的原始 NSIS 安装程序）**。其解包产物 `nsis_out\app-64.7z` 与 `app_out\Antigravity.exe` 均无 Authenticode 数字签名（`NotSigned`），且不得假设未来一定能从外网重新下载同一构建版本。 |
| **三选一最终判定** | **`A. 必须保留`**（状态：**`PASS`**） |

### 5.2 `COMPAT_233_01\base_2330\` 同伴产物链清点（共 6 个文件，617,585,106 B）

| # | 相对路径 | 大小 (B) | 修改时间 | SHA256 | 副本与依赖说明 | 建议归类 |
| ---: | --- | ---: | --- | --- | --- | --- |
| 1 | `Antigravity-x64.exe` | `182,549,552` | `2026-11-19 18:44:14` | `44AEA1C00F3B347FD60AB7291D267DBB04A5080F6C3212A8A31CF1426DDF86CB` | 无其他副本；唯一签名来源锚点 | **必须保留（A）** |
| 2 | `app_out/Antigravity.exe` | `246,599,680` | `2026-11-17 08:00:40` | `CFC4F8FDABBF5DA7AB498EC0078FBB5AA123F30BB2DA347A415C1A74F67449EF` | 无其他副本（`NotSigned`）；解包底座主程序 | **证据不足/派生环境组件（暂保留）** |
| 3 | `app_out/resources/app-update.yml` | `144` | `2026-11-17 08:00:40` | `7F5E7ECAE74C2A2483979D085B39F59DF66A908988D46D73DEA8EEFC038DE2BA` | `2.33.0` 原厂更新配置模板（144 B） | **必须保留 / 基线对照** |
| 4 | `app_out/resources/app.asar` | `6,473,373` | `2026-11-17 08:00:40` | `B33C81600E82E65593AA8430EF01B37D6B28D9D98F0FAF45E25957783B71E64B` | 另有 4 份相同哈希副本位于 `IPC_SEC_A0{1,2}/{backups,bases}/2.33.0/app.asar`；`2.33.0` 纯净基准校验基准物 | **重复但具基准对照价值（暂保留）** |
| 5 | `app_out/version` | `6` | `2026-11-17 08:00:40` | `092757B5CE6C0196120820F0661C92F660748495FAEEF3F43049C33EA65FAB4C` | Electron 版本基线文件 `44.9.1`（6 B） | **必须保留 / 基线对照** |
| 6 | `nsis_out/app-64.7z` | `181,962,351` | `2026-11-17 08:00:40` | `DD7411898C4B3F3E01A155E01E0C8EED10C2116DE9E3108ADBD1BA064F7B35E0` | 无其他副本；被 `AGM_IPC_REALBASE_A01_report.md:L30` 与两轮 `bases_and_backups_sha256.json:L4` 显式引为 `Source2330` | **重复/派生但具审计与引用依赖（暂保留）** |

---

## 六、文件数量与体积统计汇总

| 范围 / 分类 | 文件数 | 原始体积 (B) | 换算体积 | 处置状态 |
| --- | ---: | ---: | ---: | --- |
| 对象 A：`/workspace/agm/` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | **BLOCKED**（不可访问） |
| 对象 B：`docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `1` | `2,713,318` | `2.59 MiB` | **RECOMMENDED FOR CLEANUP** |
| 对象 B：`docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `1` | `2,725,738` | `2.60 MiB` | **RECOMMENDED FOR CLEANUP** |
| **本次建议可安全清理小计** | **`2`** | **`5,439,056`** | **`5.19 MiB`** | **仅限批准后删除 `docs/` 2 个 ZIP** |
| `docs/` 保留报告与预览（A01 + C-6 共 4 文件） | `4` | `961,923` | `0.92 MiB` | **PASS（必须保留）** |
| `evidence/` 全部已归档证据（CLOSEOUT 31 + A01 27 + C-6 32） | `90` | `12,769,074` | `12.18 MiB` | **PASS（必须保留，含 2 份审计 ZIP）** |
| 对象 C：`COMPAT_233_01\base_2330\Antigravity-x64.exe` | `1` | `182,549,552` | `174.09 MiB` | **PASS（A. 必须保留）** |
| 对象 C：`COMPAT_233_01` 整目录全量（含 `base_2330/` `617.59 MB` 与其余子目录） | `255` | `634,296,142` | `604.91 MiB` | **暂保留（除 `Antigravity-x64.exe` 外另含派生/证据）** |

---

## 七、唯一文件、重复文件与历史引用 / 依赖关系分析

### 7.1 唯一性与重复性判断

1. **绝对唯一且不可替代文件**：
   - `C:\AGM_TestLab\COMPAT_233_01\base_2330\Antigravity-x64.exe`（`182,549,552` B）：全授权范围内唯一带 Google LLC Authenticode 签名的 2.33.0 安装介质。
   - `C:\AGM_TestLab\COMPAT_233_01\base_2330\nsis_out\app-64.7z`（`181,962,351` B）与 `app_out\Antigravity.exe`（`246,599,680` B）：全授权范围内仅此 1 份，且 `app-64.7z` 为多轮实机底座的记录源路径。
   - `evidence/IPC_REALBASE_A01/*`（除 `bases_and_backups_sha256.txt` 外 25 项）与 `evidence/IPC_C6_FIX_01/*`（30 项）：与本地 `C:\AGM_TestLab\IPC_SEC_A0{1,2}\evidence\` 互为本地/云盘双备份，是两轮 Windows 实机测试的唯一原始证据集合。
2. **存在多份完全一致副本的文件**：
   - `IPC_REALBASE_A01_evidence.zip`（2 份：`docs/` vs `evidence/`，SHA256 `2E4ADC6A...372EAF` 一致）。
   - `IPC_C6_FIX_01_evidence.zip`（2 份：`docs/` vs `evidence/`，SHA256 `CAA7094B...7F8DA85` 一致）。
   - `bases_and_backups_sha256.txt`（A01 与 C-6 之间内容完全一致：`1,324` B，`128AE66D...`）。
   - `2.33.0/app.asar`（`6,473,373` B，`B33C8160...`，在 `COMPAT_233_01/base_2330/app_out/resources/` 与 `IPC_SEC_A0{1,2}/{backups,bases}/` 共 5 处一致）。
3. **版本漂移提示（非同一文件，严禁视作重复）**：
   - `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md`（`18,387` B，`E773032B4D2476A0C61E37EDC9383A3484A81DDAA3FD53A8E370564C7A774D01`）与 `evidence/IPC_C6_CLOSEOUT_01/backup_AGM_IPC_C6_FIX_01_report.md.orig` 一致（CLOSEOUT 前原件）；而本机 `C:\AGM_TestLab\IPC_SEC_A02\deliver\AGM_IPC_C6_FIX_01_report.md` 为 `20,500` B（`561B62E3EC7A7606F3D2D3DBEC8F1A7835CDBED1510CE10D1374E0754CE074C3`，CLOSEOUT 修订版）。

### 7.2 历史引用与依赖关系清单（实测文本检索）

| 被引用对象 | 引用方文件与精确行号 | 依赖性质与影响评估 |
| --- | --- | --- |
| `/workspace/agm/ipcsec` | `C:\AGM_TestLab\IPC_SEC_A02\repo\docs\SECURITY_AUDIT_IPC_SEC_01.md:L5` | 历史文档记录执行环境为云端 Linux 盒子；证明该路径不在本机 |
| `IPC_REALBASE_A01_evidence.zip` | 仅 `00_Flash_Box/AGM_EVIDENCE_ARCHIVE_A01_report.md`（L49, L70, L77, L81–L107, L265, L268） | **无任何产品代码、测试脚本、安装脚本或 A01/C-6 原报告引用 `docs/*.zip`** |
| `IPC_C6_FIX_01_evidence.zip` | 仅 `00_Flash_Box/AGM_EVIDENCE_ARCHIVE_A01_report.md`（L53, L73, L113–L144, L265, L268） | **无任何产品代码、测试脚本、安装脚本或 A01/C-6 原报告引用 `docs/*.zip`** |
| `COMPAT_233_01\base_2330\Antigravity-x64.exe` | `COMPAT_233_01\deliver\AGM_233_COMPAT_STAGE_A_report.md:L89, L342` | 2.33.0 官方安装源与签名溯源证据 |
| `COMPAT_233_01\base_2330\nsis_out\app-64.7z` | `docs/AGM_IPC_REALBASE_A01/AGM_IPC_REALBASE_A01_report.md:L30`；`evidence/IPC_REALBASE_A01/bases_and_backups_sha256.json:L4`；`evidence/IPC_C6_FIX_01/bases_and_backups_sha256.json:L4`；`AGM_233_COMPAT_STAGE_A_report.md:L55, L97` | **强溯源引用**：两轮实机测试报告与基线 JSON 均记录以此 `.7z` 作为 2.33.0 只读解包源 |

---

## 八、四象限独立处置清单（每个候选对象独立理由）

### 8.1 必须永久保留的文件（Status: `PASS`）

| 文件 / 目录 | 数量 / 大小 | 独立保留理由 |
| --- | --- | --- |
| `C:\AGM_TestLab\COMPAT_233_01\base_2330\Antigravity-x64.exe` | `1` / `182,549,552` B | 唯一带 `Google LLC` Valid Authenticode 签名的 2.33.0 安装介质，无第二副本，不可赌后续联网重下 |
| `docs/AGM_IPC_REALBASE_A01/AGM_IPC_REALBASE_A01_report.md` & `_preview.png` | `2` / `492,351` B | A01 阶段官方定稿报告与视觉预览，应长期留在 `docs/` |
| `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md` & `_preview.png` | `2` / `469,572` B | C-6 阶段报告（CLOSEOUT 前原件）与视觉预览，应保留作版本溯源 |
| `evidence/IPC_REALBASE_A01/`（26 个原始解包证据） | `26` / `3,479,193` B | A01 轮完整实测原始日志、JSON 与截图，已脱离压缩包可直接检索审阅 |
| `evidence/IPC_C6_FIX_01/`（31 个原始解包证据） | `31` / `3,616,976` B | C-6 轮完整实测原始日志、CI 汇总、Blob 哈希与截图，可直接检索审阅 |
| `evidence/IPC_C6_CLOSEOUT_01/`（31 个收尾审计证据） | `31` / `233,849` B | PR #10 与 CI 收尾一致性的不可变原始审计集合 |
| `C:\AGM_TestLab\COMPAT_233_01\base_2330\app_out\{resources\app-update.yml, version}` | `2` / `150` B | 2.33.0 原厂更新配置与 Electron `44.9.1` 版本比对基线 |

### 8.2 重复但仍具有历史审计价值的文件（暂保留，Status: `PASS`）

| 文件 | 数量 / 大小 | 独立保留理由 |
| --- | --- | --- |
| `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `1` / `2,713,318` B | 虽内容已解包同目录，但该原包唯一保存了内层 `evidence/` 目录项、ZIP 时间戳、属性与整包 SHA256 (`2E4ADC6A...`)，散装文件无法 bit-for-bit 重建原 ZIP |
| `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `1` / `2,725,738` B | 虽内容已解包同目录，但唯一保存了原始打包时间戳、CRC/属性与整包 SHA256 (`CAA7094B...`)，具原始证据封存审计价值 |
| `C:\AGM_TestLab\COMPAT_233_01\base_2330\nsis_out\app-64.7z` | `1` / `181,962,351` B | 可由 `Antigravity-x64.exe` 解出，但被 A01 报告 L30 与 A01/C-6 `bases_and_backups_sha256.json` 显式引用为 `Source2330`，保留可免重解包并维持溯源链完整 |
| `C:\AGM_TestLab\COMPAT_233_01\base_2330\app_out\resources\app.asar` | `1` / `6,473,373` B | 与 `IPC_SEC_A0{1,2}/{backups,bases}` 重复，但作为 `COMPAT_233_01` Stage-A 报告直接锚定对象建议保留 |

### 8.3 建议清理的文件（Status: `RECOMMENDED FOR CLEANUP` — 本轮不删除）

| 候选清理文件 | 大小 (B) | 独立可清理理由 | 前置条件 |
| --- | ---: | --- | --- |
| `docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `2,713,318` | ① 26/26 成员与 `evidence/IPC_REALBASE_A01/` SHA256 100% 一致；② 原版 ZIP 整包副本已逐字节保存于 `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip`（容器元数据无丢失）；③ 0 个脚本/代码/历史报告依赖 `docs/` 下该 ZIP 路径 | 需通过 GPT 独立验收及用户下一轮批准 |
| `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `2,725,738` | ① 31/31 成员与 `evidence/IPC_C6_FIX_01/` SHA256 100% 一致；② 原版 ZIP 整包副本已逐字节保存于 `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip`（容器元数据无丢失）；③ 0 个脚本/代码/历史报告依赖 `docs/` 下该 ZIP 路径 | 需通过 GPT 独立验收及用户下一轮批准 |

### 8.4 证据不足、暂时不能清理的文件（Status: `BLOCKED` / `NOT RUN`）

| 对象 / 文件 | 当前状态 | 独立暂缓理由 |
| --- | --- | --- |
| `/workspace/agm/` 及其全部潜在子目录（`c6close`, `A01`, `ipcsec`, 备份/临时目录等） | **`BLOCKED`** | 属云端 Linux 盒子路径，当前 Windows 主机不可访问，文件清单/SHA256/依赖关系全部未知，严禁凭名字猜删 |
| `C:\AGM_TestLab\COMPAT_233_01\base_2330\app_out\Antigravity.exe`（`246,599,680` B） | **暂保留（`NOT RUN` 外部引用全检）** | 非本次目标删除项，且未扫描是否被其他Stage脚本直接启动引用，不得擅自判删 |
| `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md` 与 PC 修订版差异 | **暂保留（版本漂移待人工决策）** | Drive 为 `18,387` B 原件，PC 为 `20,500` B CLOSEOUT 修订版；本轮禁止覆盖，需独立轮次决定是否同步 |
| `00_Flash_Box/` 其余非本轮交付物（`TELEMETRY_PLUGIN_01_*`、`grok_nasa_*`、`hakimi_i18n_*`、`插件/`） | **暂保留（未纳本轮清理授权）** | 均未超过 7 天，且属其他或阶段性任务交付物 |

---

## 九、人工 UI 回归记录（`USER-CONFIRMED`）

> **来源声明**：以下 4 项结果为用户本人实机交互测试后提供的人工回归反馈，严格标记为 **`USER-CONFIRMED`**；本审计未执行自动化 GUI 测试脚本，绝不将人工反馈伪装为自动化 GUI 日志。

| # | 人工回归验证场景 | 用户实测结论 | 状态标记 |
| ---: | --- | --- | --- |
| 1 | 关闭应用并完全退出，再启动，插件正常加载 | 正常加载 | **USER-CONFIRMED** |
| 2 | 强制刷新页面，插件正常恢复 | 正常恢复 | **USER-CONFIRMED** |
| 3 | 托盘新建窗口，插件功能正常 | 功能正常 | **USER-CONFIRMED** |
| 4 | 切换不同对话，功能正常 | 功能正常 | **USER-CONFIRMED** |

---

## 十、最终清理建议、风险说明与只读保护验证

### 10.1 分阶段可执行建议（当前阶段未执行任何删除）

1. **立即可批准的安全清理（低风险）**：在 GPT 验收通过且用户明确下达清理批准后，仅删除 `docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` 与 `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip`（释放 **`5,439,056` 字节 / `5.19 MiB`**），同时继续保留 `docs/` 下两份报告/预览及 `evidence/` 内对应解包文件与原版 ZIP 容器副本。
2. **必须永久或长期保留（禁止清理）**：`C:\AGM_TestLab\COMPAT_233_01\base_2330\Antigravity-x64.exe`（`182,549,552` B，判定 **A. 必须保留**）、`evidence/` 全部 90 个文件（含 2 份容器级审计 ZIP）、`docs/` 下 A01 与 C-6 的报告和预览图。
3. **阻塞项前置要求（`/workspace/agm/`）**：如需清理 `/workspace/agm/`，需在云端 Linux 盒子本机另开只读审计轮次，逐一盘点子目录体积、SHA256、与 Drive `evidence/` 差集及是否已沉淀至 `docs/`，未拿到盒子实盘清单前**绝不清理**。

### 10.2 潜在风险说明

- **误删安装包风险**：若删除 `Antigravity-x64.exe`，一旦未来 Google CDN 撤回旧版 `2.33.0-4731201358004224` 下载链，将永久丧失带 `Google LLC` 数字签名的高可信原厂恢复介质。
- **误删 `evidence/` 内 ZIP 风险**：若连 `evidence/` 内的原版 `.zip` 一并删除，将无法再对原始打包容器字节及 A01 目录占位元数据做 SHA256 整包验真；因此当前仅建议删 `docs/` 重复包、留 `evidence/` 原包。
- **版本漂移混淆风险**：`docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md` 仍停留在 CLOSEOUT 前原件（`18,387` B），清理前后应另行决定是否合入 CLOSEOUT 修订版（`20,500` B）。

### 10.3 本轮只读保护执行结果

- **原始文件删除 / 移动 / 覆盖**：`0` / `0` / `0`。
- **源码 / 测试 / 配置 / Git / GitHub / PR #10 / 正式 IDE 变更**：`0`。
- **当前状态**：已完成审计报告与视觉预览图生成并停止，未启动下一轮清理、未上传 GitHub、未交由其他 Bot 接手，等待 GPT 独立验收及用户下一轮明确批准。

DONE
