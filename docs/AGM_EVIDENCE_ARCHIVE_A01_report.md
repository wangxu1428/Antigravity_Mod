Round 1 | 2026-11-20 02:13
# 任务 AGM-EVIDENCE-ARCHIVE-A01：Antigravity_Mod IPC A01 与 C-6 历史证据保守归档报告

- **任务编号**：`AGM-EVIDENCE-ARCHIVE-A01`
- **任务性质**：历史证据保守归档（先只读盘点，再复制校验，绝不删除源文件）
- **项目目录**：`G:\我的云端硬盘\01_Projects\Antigravity_Mod`
- **执行时间**：`2026-11-20 02:10:51` 至 `2026-11-20 02:10:52`（报告生成 `2026-11-20 02:13`）
- **执行结论**：**归档复制与全量 SHA256 校验已完成（59/59 文件校验一致，0 覆盖、0 删除、0 源文件改动）；本轮未执行后续清理，已停止等待用户与 GPT 验收。**

---

## 一、任务概要与验收指标总表

| 验收指标 | 目标要求 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 已确认来源的文件纳入清单 | 100% 纳入 | `59 / 59`（A01 `26` 原始 + `1` ZIP；C-6 `31` 原始 + `1` ZIP，均与源端双端核验） | **PASS** |
| 成功复制文件 SHA256 一致性 | 100% 一致 | `59 / 59` 逐一写后回读校验一致；`57 / 57` 解包文件与 PC 源目录一致；不一致 `0` | **PASS** |
| 源文件变化 | 0 | `docs/AGM_IPC_REALBASE_A01`（3/3）、`docs/AGM_IPC_C6_FIX_01`（3/3）、PC `IPC_SEC_A01/A02`（57/57）前后 SHA256 全一致（变化 `0`） | **PASS** |
| 原文件删除 | 0 | 源目录文件总数与清单前后完全一致（删除 `0`） | **PASS** |
| 已有目标文件覆盖 | 0 | `evidence/IPC_C6_CLOSEOUT_01/`（31/31）前后 SHA256 全一致；目标全部以独占模式 `'xb'` 创建（覆盖 `0`） | **PASS** |
| 产品源码变化 | 0 | 未扫描或修改任何源码仓库/测试代码（仅在 Drive `evidence/` 与 `00_Flash_Box/` 执行本任务归档与交付）；未执行外部独立代码库快照扫描 | **NOT RUN（外部独立校验未执行；本任务零操作/零写入）** |
| GitHub 变更（含 PR #10） | 0 | 本任务未调用 `git`/`gh`、未访问远端或改动 PR #10；未执行外部远端仓库独立快照比对 | **NOT RUN（外部独立校验未执行；本任务零操作/零写入）** |
| 正式 IDE 影响 | 0 | 本任务未扫描、未读取、未写入 `D:\AI_Studio\Apps\Antigravity\` 正式 IDE 目录或进程；未执行外部 IDE 独立快照比对 | **NOT RUN（外部独立校验未执行；本任务零操作/零写入）** |

> 注：依据“禁止将未验证项目标记 PASS”原则，本轮未对产品源码仓、GitHub 远端及正式 IDE 执行外部独立快照校验（因任务禁止对其扫描或操作），故上述三项诚实标为 `NOT RUN` 并声明本任务自身严格执行零触碰、零写盘。

---

## 二、复制前后目录结构、文件数量与字节总量对比

### 2.1 阶段数量与字节汇总

| 统计维度 | 目录路径 / 范围 | 目录数 | 文件数 | 原始证据文件数 (字节) | 原版 ZIP 包数 (字节) | 总字节数 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **复制前基线** | `evidence/`（仅含 `IPC_C6_CLOSEOUT_01/`） | `1` | `31` | `31` (`233,849`) | `0` (`0`) | `233,849` |
| **新增阶段 1** | `evidence/IPC_REALBASE_A01/` | `1` | `27` | `26` (`3,479,193`) | `1` (`2,713,318`) | `6,192,511` |
| **新增阶段 2** | `evidence/IPC_C6_FIX_01/` | `1` | `32` | `31` (`3,616,976`) | `1` (`2,725,738`) | `6,342,714` |
| **本轮净新增合计** | `IPC_REALBASE_A01/` + `IPC_C6_FIX_01/` | `2` | `59` | `57` (`7,096,169`) | `2` (`5,439,056`) | `12,535,225` |
| **复制后 `evidence/` 总计** | `evidence/`（3 个阶段目录） | `3` | `90` | `88` (`7,330,018`) | `2` (`5,439,056`) | `12,769,074` |

### 2.2 归档后目录布局

```text
G:\我的云端硬盘\01_Projects\Antigravity_Mod\
├── docs\                                        # 原样只读保留，0 修改、0 删除
│   ├── AGM_IPC_REALBASE_A01\ (3 files, 3,205,669 B)
│   │   ├── AGM_IPC_REALBASE_A01_report.md       (21,352 B, 保留报告)
│   │   ├── AGM_IPC_REALBASE_A01_preview.png     (470,999 B, 保留预览)
│   │   └── IPC_REALBASE_A01_evidence.zip        (2,713,318 B, 源压缩包保留)
│   └── AGM_IPC_C6_FIX_01\ (3 files, 3,195,310 B)
│       ├── AGM_IPC_C6_FIX_01_report.md          (18,387 B, 保留报告/CLOSEOUT前原件)
│       ├── AGM_IPC_C6_FIX_01_preview.png        (451,185 B, 保留预览)
│       └── IPC_C6_FIX_01_evidence.zip           (2,725,738 B, 源压缩包保留)
└── evidence\ (3 dirs, 90 files, 12,769,074 B)
    ├── IPC_C6_CLOSEOUT_01\ (31 files, 233,849 B, 既有目录 UNCHANGED)
    ├── IPC_REALBASE_A01\   (27 files, 6,192,511 B = 26 解包原始 + 1 原版 ZIP)
    └── IPC_C6_FIX_01\      (32 files, 6,342,714 B = 31 解包原始 + 1 原版 ZIP)
```

---

## 三、完整来源与目标路径映射及 SHA256 校验总表

### 3.1 `docs/` 保留报告、预览图与源压缩包清单（原地保留，未移动/未修改）

| 阶段目录 | 文件名 | 类型说明 | 大小 (B) | 修改时间 | SHA256 | 与 PC `deliver/` 对照 |
| --- | --- | --- | ---: | --- | --- | --- |
| `docs/AGM_IPC_REALBASE_A01/` | `AGM_IPC_REALBASE_A01_preview.png` | 预览图 | `470,999` | `2026-11-20 00:15:09` | `71CE7D37ABCB44A8E6AED59902C864599809FAE141EC68650B9CED0B3F9948A8` | 100% 一致 |
| `docs/AGM_IPC_REALBASE_A01/` | `AGM_IPC_REALBASE_A01_report.md` | 交付报告 | `21,352` | `2026-11-20 00:15:07` | `FE5587A125E749586AFF212C59B8EF358F68C5735164E4F89BA59E39AC0FF205` | 100% 一致 |
| `docs/AGM_IPC_REALBASE_A01/` | `IPC_REALBASE_A01_evidence.zip` | 原始证据 ZIP | `2,713,318` | `2026-11-20 00:15:04` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | 已复制归档至 `evidence/IPC_REALBASE_A01/` |
| `docs/AGM_IPC_C6_FIX_01/` | `AGM_IPC_C6_FIX_01_preview.png` | 预览图 | `451,185` | `2026-11-20 01:00:36` | `03DDCB5F48553CEEA320C2708B51D08661A8F2A44AC4FC0784EDACA375AF1B04` | 100% 一致 |
| `docs/AGM_IPC_C6_FIX_01/` | `AGM_IPC_C6_FIX_01_report.md` | 交付报告 | `18,387` | `2026-11-20 01:00:36` | `E773032B4D2476A0C61E37EDC9383A3484A81DDAA3FD53A8E370564C7A774D01` | **版本漂移（未覆盖）**：Drive 为 CLOSEOUT 前原件（与 `evidence/IPC_C6_CLOSEOUT_01/backup_AGM_IPC_C6_FIX_01_report.md.orig` 一致）；PC `C:\AGM_TestLab\IPC_SEC_A02\deliver\AGM_IPC_C6_FIX_01_report.md` 为 CLOSEOUT 修订版（`20,500` B, `561B62E3EC7A7606F3D2D3DBEC8F1A7835CDBED1510CE10D1374E0754CE074C3`） |
| `docs/AGM_IPC_C6_FIX_01/` | `IPC_C6_FIX_01_evidence.zip` | 原始证据 ZIP | `2,725,738` | `2026-11-20 01:00:37` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | 已复制归档至 `evidence/IPC_C6_FIX_01/` |

### 3.2 `IPC_REALBASE_A01` 归档映射与 SHA256 校验明细（共 27 个文件，6,192,511 字节）

> 来源 ZIP 内部路径前缀已规范化剥离 `evidence/`，使其目录结构与现有 `evidence/IPC_C6_CLOSEOUT_01/` 一致，并同步留存原版 `IPC_REALBASE_A01_evidence.zip` 副本。

| # | 文件名 | Drive 源路径（ZIP 条目 / 原包） | 本地 PC 交叉溯源 | 目标路径 | 大小 (B) | SHA256 | 校验 |
| ---: | --- | --- | --- | --- | ---: | --- | --- |
| 1 | `bases_and_backups_sha256.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/bases_and_backups_sha256.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\bases_and_backups_sha256.json` (MATCH) | `evidence/IPC_REALBASE_A01/bases_and_backups_sha256.json` | `3,872` | `79CE4BF90E7E00A202142A6CD5D057BC7F3633B8DE91F26031CD293616520BDF` | **MATCH** |
| 2 | `bases_and_backups_sha256.txt` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/bases_and_backups_sha256.txt` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\bases_and_backups_sha256.txt` (MATCH) | `evidence/IPC_REALBASE_A01/bases_and_backups_sha256.txt` | `1,324` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | **MATCH** |
| 3 | `cold_start_2.32.1.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/cold_start_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\cold_start_2.32.1.json` (MATCH) | `evidence/IPC_REALBASE_A01/cold_start_2.32.1.json` | `15,492` | `C5049626124E41EA4A8B0264163893F5DF28DF735601119E940F4DB288B30926` | **MATCH** |
| 4 | `cold_start_2.33.0.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/cold_start_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\cold_start_2.33.0.json` (MATCH) | `evidence/IPC_REALBASE_A01/cold_start_2.33.0.json` | `15,376` | `7BD9388D3EFACA5D9125E327BF45B9EF92BCCC2B1EEC6A0725892095C4335035` | **MATCH** |
| 5 | `formal_ide_snapshot_after.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/formal_ide_snapshot_after.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\formal_ide_snapshot_after.json` (MATCH) | `evidence/IPC_REALBASE_A01/formal_ide_snapshot_after.json` | `256,061` | `1F2BF7CE0A28F149EBBAFDDC4FB1ADFDBE31DA205D3CE4AAFC4EECAB3DCC869C` | **MATCH** |
| 6 | `formal_ide_snapshot_before.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/formal_ide_snapshot_before.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\formal_ide_snapshot_before.json` (MATCH) | `evidence/IPC_REALBASE_A01/formal_ide_snapshot_before.json` | `256,826` | `DAA5914B6E42B370E328A3096AE04E95D90297A8C089ACA8704E9860B76320E8` | **MATCH** |
| 7 | `formal_ide_snapshot_diff.txt` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/formal_ide_snapshot_diff.txt` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\formal_ide_snapshot_diff.txt` (MATCH) | `evidence/IPC_REALBASE_A01/formal_ide_snapshot_diff.txt` | `3,949` | `74646062F6453F4A68624F73268A47034EB69DC5118353FDE747081FFD313FD2` | **MATCH** |
| 8 | `git_baseline.txt` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/git_baseline.txt` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\git_baseline.txt` (MATCH) | `evidence/IPC_REALBASE_A01/git_baseline.txt` | `1,113` | `573F7F2283F23EA63748456374FC785AB703060A5AB77E05820692B6FFCDD298` | **MATCH** |
| 9 | `ipc_results_2.32.1.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/ipc_results_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\ipc_results_2.32.1.json` (MATCH) | `evidence/IPC_REALBASE_A01/ipc_results_2.32.1.json` | `30,899` | `0FEE683295787967EB8D57BFA39ECE526720C90773673FA35BF52C972CCCDDD1` | **MATCH** |
| 10 | `ipc_results_2.33.0.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/ipc_results_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\ipc_results_2.33.0.json` (MATCH) | `evidence/IPC_REALBASE_A01/ipc_results_2.33.0.json` | `30,670` | `3787734A9DD5C43D5014D825F1B3314F0B4504A8D6AACBE699DDA82D5BED5127` | **MATCH** |
| 11 | `launch_2.32.1_cold1.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/launch_2.32.1_cold1.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\launch_2.32.1_cold1.log` (MATCH) | `evidence/IPC_REALBASE_A01/launch_2.32.1_cold1.log` | `24,059` | `7DB21452821B77616A70FC74EDB3B8D9CF1F1EACF59C977C89161F3D5CD482AB` | **MATCH** |
| 12 | `launch_2.32.1_cold2.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/launch_2.32.1_cold2.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\launch_2.32.1_cold2.log` (MATCH) | `evidence/IPC_REALBASE_A01/launch_2.32.1_cold2.log` | `24,601` | `BB446B534F0F30BAC64A53116C6F13A4131D355ACFED40035C263E512A7EAF8B` | **MATCH** |
| 13 | `launch_2.33.0_cold1.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/launch_2.33.0_cold1.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\launch_2.33.0_cold1.log` (MATCH) | `evidence/IPC_REALBASE_A01/launch_2.33.0_cold1.log` | `23,852` | `39DC70F08006E60DC5599CAE59A30B6FBFE80E865450DF955D4981F35AAD82D6` | **MATCH** |
| 14 | `launch_2.33.0_cold2.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/launch_2.33.0_cold2.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\launch_2.33.0_cold2.log` (MATCH) | `evidence/IPC_REALBASE_A01/launch_2.33.0_cold2.log` | `24,971` | `C3E90DDFC2319320596777915915A0B937B1C78EE232D374CF28897FB557B519` | **MATCH** |
| 15 | `patch_2.32.1.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/patch_2.32.1.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\patch_2.32.1.log` (MATCH) | `evidence/IPC_REALBASE_A01/patch_2.32.1.log` | `2,051` | `B8DD37283DA99332CFC187951F2BF29510B6DFED5192985208D8B24CD3CA066D` | **MATCH** |
| 16 | `patch_2.33.0.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/patch_2.33.0.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\patch_2.33.0.log` (MATCH) | `evidence/IPC_REALBASE_A01/patch_2.33.0.log` | `2,051` | `26F4ED03F95502AEE9DDB60AB9D3D77F6DFB5A954B36FD3F68123CE10C9A420D` | **MATCH** |
| 17 | `patch_verify_2.32.1.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/patch_verify_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\patch_verify_2.32.1.json` (MATCH) | `evidence/IPC_REALBASE_A01/patch_verify_2.32.1.json` | `2,913` | `EB6BCCCDD7F6ECC5F81A1772E057C0A82ACA0C14D59E716D96521353AA706F31` | **MATCH** |
| 18 | `patch_verify_2.33.0.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/patch_verify_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\patch_verify_2.33.0.json` (MATCH) | `evidence/IPC_REALBASE_A01/patch_verify_2.33.0.json` | `2,913` | `91E5BDF349A63F78C20976C09813917C8508E0664F29AD47D1AC5DEF68C31D60` | **MATCH** |
| 19 | `probe_2.32.1.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/probe_2.32.1.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\probe_2.32.1.log` (MATCH) | `evidence/IPC_REALBASE_A01/probe_2.32.1.log` | `44,931` | `8EECD22658CB021BFE7A79C40556DF57BDC61DA5901C6E1E533FEDC1E78BAB7B` | **MATCH** |
| 20 | `probe_2.33.0.log` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/probe_2.33.0.log` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\probe_2.33.0.log` (MATCH) | `evidence/IPC_REALBASE_A01/probe_2.33.0.log` | `45,115` | `BE35A9570C2D2BE7A35C4677003A0EF3AE02CD9F7801D1999F635E1712D34732` | **MATCH** |
| 21 | `restore_and_isolation_check.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/restore_and_isolation_check.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\restore_and_isolation_check.json` (MATCH) | `evidence/IPC_REALBASE_A01/restore_and_isolation_check.json` | `2,083` | `CD037AEE1EFCA613E0E6FD212142C6FAA6EA4798BC09C11B3B903552D9B5A507` | **MATCH** |
| 22 | `screenshot_2.32.1_cold1.png` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/screenshot_2.32.1_cold1.png` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\screenshot_2.32.1_cold1.png` (MATCH) | `evidence/IPC_REALBASE_A01/screenshot_2.32.1_cold1.png` | `662,487` | `C7096B292D6E672E088EB98674FBDF4F3FA9966A816435BBD13E3097D6E51332` | **MATCH** |
| 23 | `screenshot_2.32.1_cold2.png` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/screenshot_2.32.1_cold2.png` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\screenshot_2.32.1_cold2.png` (MATCH) | `evidence/IPC_REALBASE_A01/screenshot_2.32.1_cold2.png` | `662,108` | `6FE174E0D78D4817F05E55945A4F243622A3ED4F4BF46078964DE74B8C7A7F92` | **MATCH** |
| 24 | `screenshot_2.33.0_cold1.png` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/screenshot_2.33.0_cold1.png` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\screenshot_2.33.0_cold1.png` (MATCH) | `evidence/IPC_REALBASE_A01/screenshot_2.33.0_cold1.png` | `667,559` | `FF98F86B304ADA98DFD3345B81682D2415EB4737B8ABC21CAD922583ECCA640F` | **MATCH** |
| 25 | `screenshot_2.33.0_cold2.png` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/screenshot_2.33.0_cold2.png` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\screenshot_2.33.0_cold2.png` (MATCH) | `evidence/IPC_REALBASE_A01/screenshot_2.33.0_cold2.png` | `667,464` | `21CA496B20E7D8C9CC50243C8B3CCC16CF78F0C4D11DE0381514DBB48C8FFE69` | **MATCH** |
| 26 | `updater_lock_check.json` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip!evidence/updater_lock_check.json` | `C:\AGM_TestLab\IPC_SEC_A01\evidence\updater_lock_check.json` (MATCH) | `evidence/IPC_REALBASE_A01/updater_lock_check.json` | `4,453` | `E0D0CED0D3C0C5FAA18C2E53E2ED07EF093E7B2AC3F55C391536E35A2883CA0E` | **MATCH** |
| 27 | `IPC_REALBASE_A01_evidence.zip` | `docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` | N/A (Drive 归档包) | `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `2,713,318` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | **MATCH** |

### 3.3 `IPC_C6_FIX_01` 归档映射与 SHA256 校验明细（共 32 个文件，6,342,714 字节）

| # | 文件名 | Drive 源路径（ZIP 条目 / 原包） | 本地 PC 交叉溯源 | 目标路径 | 大小 (B) | SHA256 | 校验 |
| ---: | --- | --- | --- | --- | ---: | --- | --- |
| 1 | `bases_and_backups_sha256.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!bases_and_backups_sha256.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\bases_and_backups_sha256.json` (MATCH) | `evidence/IPC_C6_FIX_01/bases_and_backups_sha256.json` | `3,872` | `1575173434594926CB59A85CF6AE8C3A8B51A58211B03BCD1A8CF699D4DA3A1C` | **MATCH** |
| 2 | `bases_and_backups_sha256.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!bases_and_backups_sha256.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\bases_and_backups_sha256.txt` (MATCH) | `evidence/IPC_C6_FIX_01/bases_and_backups_sha256.txt` | `1,324` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | **MATCH** |
| 3 | `ci_run_summary.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!ci_run_summary.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\ci_run_summary.json` (MATCH) | `evidence/IPC_C6_FIX_01/ci_run_summary.json` | `6,360` | `03AEFBE3D7E2A1EE88C2E3D35A34DA0E0D44D2A83A6E7849952389411BFE57EF` | **MATCH** |
| 4 | `cold_start_2.32.1.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!cold_start_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\cold_start_2.32.1.json` (MATCH) | `evidence/IPC_C6_FIX_01/cold_start_2.32.1.json` | `15,363` | `7B71633573E67CB4181674A5775D866731A33B15DF92130D46972D06DFF61C89` | **MATCH** |
| 5 | `cold_start_2.33.0.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!cold_start_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\cold_start_2.33.0.json` (MATCH) | `evidence/IPC_C6_FIX_01/cold_start_2.33.0.json` | `15,370` | `419EC385FBDD7EC5E2317179E85812EE395AAB5D57F766FA533247E71CEC4458` | **MATCH** |
| 6 | `formal_ide_snapshot_after.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!formal_ide_snapshot_after.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\formal_ide_snapshot_after.json` (MATCH) | `evidence/IPC_C6_FIX_01/formal_ide_snapshot_after.json` | `260,454` | `08B0874C13E4DAD2B613BA0C1E2E0F411142985B13EB3157A1E46B087923CAD3` | **MATCH** |
| 7 | `formal_ide_snapshot_before.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!formal_ide_snapshot_before.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\formal_ide_snapshot_before.json` (MATCH) | `evidence/IPC_C6_FIX_01/formal_ide_snapshot_before.json` | `260,454` | `F79393CEBCA453156C75A2B0AED8E4BF3FEEBA6AB585F7E5A632942AC213F0B1` | **MATCH** |
| 8 | `formal_ide_snapshot_diff.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!formal_ide_snapshot_diff.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\formal_ide_snapshot_diff.txt` (MATCH) | `evidence/IPC_C6_FIX_01/formal_ide_snapshot_diff.txt` | `4,145` | `52174ECE8BC89E3996302EE414CC226AEB3E0230858EFE61125FFF20EED0C9D3` | **MATCH** |
| 9 | `git_baseline.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!git_baseline.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\git_baseline.txt` (MATCH) | `evidence/IPC_C6_FIX_01/git_baseline.txt` | `372` | `FC7E94FF8549B37351E57411D136A79A4467A6783C5FED3116FF684AE89D3E81` | **MATCH** |
| 10 | `ipc_results_2.32.1.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!ipc_results_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\ipc_results_2.32.1.json` (MATCH) | `evidence/IPC_C6_FIX_01/ipc_results_2.32.1.json` | `45,995` | `1FD86CDBCF705F0077A515E97A2FAB511955B467A64096E601049C9C3BEC998B` | **MATCH** |
| 11 | `ipc_results_2.33.0.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!ipc_results_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\ipc_results_2.33.0.json` (MATCH) | `evidence/IPC_C6_FIX_01/ipc_results_2.33.0.json` | `45,995` | `5A48569C2E12A3E92191328001137382CFE44BCD0E40AF79DB477D780030F0FA` | **MATCH** |
| 12 | `launch_2.32.1_cold1.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!launch_2.32.1_cold1.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\launch_2.32.1_cold1.log` (MATCH) | `evidence/IPC_C6_FIX_01/launch_2.32.1_cold1.log` | `24,019` | `7B2B83177E750D25E042E1EBA0014757FC4FD254EEC6826B878C1E70B954E522` | **MATCH** |
| 13 | `launch_2.32.1_cold2.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!launch_2.32.1_cold2.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\launch_2.32.1_cold2.log` (MATCH) | `evidence/IPC_C6_FIX_01/launch_2.32.1_cold2.log` | `25,022` | `3EEBDEE08BAC8335E1B30CD987D53418308EC4BD4780B7B61A30855753E271C1` | **MATCH** |
| 14 | `launch_2.33.0_cold1.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!launch_2.33.0_cold1.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\launch_2.33.0_cold1.log` (MATCH) | `evidence/IPC_C6_FIX_01/launch_2.33.0_cold1.log` | `24,587` | `5FBE7119CD982C614BBA2E728C5F5E3AAC1DD466C9D038E01FDEDD8517F5ABD7` | **MATCH** |
| 15 | `launch_2.33.0_cold2.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!launch_2.33.0_cold2.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\launch_2.33.0_cold2.log` (MATCH) | `evidence/IPC_C6_FIX_01/launch_2.33.0_cold2.log` | `24,969` | `32EDB5B1D826120506A08A7FE8F964AEAC3B5D6B0C430DF8F877653C4AAD4089` | **MATCH** |
| 16 | `local_unit_tests.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!local_unit_tests.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\local_unit_tests.log` (MATCH) | `evidence/IPC_C6_FIX_01/local_unit_tests.log` | `18,589` | `90DCA01F307E248232B2CEC3BDDBD8062424CAD16C61609A3C52FED3FE4B3BC4` | **MATCH** |
| 17 | `patch_2.32.1.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!patch_2.32.1.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\patch_2.32.1.log` (MATCH) | `evidence/IPC_C6_FIX_01/patch_2.32.1.log` | `2,051` | `A2A6CB23F72971579C3BD607E27E636E3C15A933783585E444EBD2989DEA96C0` | **MATCH** |
| 18 | `patch_2.33.0.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!patch_2.33.0.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\patch_2.33.0.log` (MATCH) | `evidence/IPC_C6_FIX_01/patch_2.33.0.log` | `2,051` | `5870A5F8848EA5FD94FDC1D42CBAB6216FD2AF25489630B6C0A8CE05E892B238` | **MATCH** |
| 19 | `patch_verify_2.32.1.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!patch_verify_2.32.1.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\patch_verify_2.32.1.json` (MATCH) | `evidence/IPC_C6_FIX_01/patch_verify_2.32.1.json` | `3,088` | `1AC5FCC8EC6263BBE6D887331843ECB2C90981AC351FADF6325639472224A817` | **MATCH** |
| 20 | `patch_verify_2.33.0.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!patch_verify_2.33.0.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\patch_verify_2.33.0.json` (MATCH) | `evidence/IPC_C6_FIX_01/patch_verify_2.33.0.json` | `3,088` | `6F88F8FD3C221CF81E8EA4835BAEA0BDDDE58A2350F610EF250A9FAE16784223` | **MATCH** |
| 21 | `probe_2.32.1.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!probe_2.32.1.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\probe_2.32.1.log` (MATCH) | `evidence/IPC_C6_FIX_01/probe_2.32.1.log` | `81,009` | `0351D49DD1EA8CF1BE416BFABA5AF8270F00B4F5027479049A184C83DE070C0D` | **MATCH** |
| 22 | `probe_2.33.0.log` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!probe_2.33.0.log` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\probe_2.33.0.log` (MATCH) | `evidence/IPC_C6_FIX_01/probe_2.33.0.log` | `80,971` | `E7D5B5B2CEECDF63ACF8E516764E5DECF208AA573E3DE07F0BB3A5CF43E049D9` | **MATCH** |
| 23 | `repo_after_blobs_sha256.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!repo_after_blobs_sha256.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\repo_after_blobs_sha256.txt` (MATCH) | `evidence/IPC_C6_FIX_01/repo_after_blobs_sha256.txt` | `485` | `90C78E3F41556A07FAECC1A75448ADE9F9B37EE8A0AE29F704CC44997440C6B5` | **MATCH** |
| 24 | `repo_backup_sha256.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!repo_backup_sha256.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\repo_backup_sha256.txt` (MATCH) | `evidence/IPC_C6_FIX_01/repo_backup_sha256.txt` | `497` | `0B8365C091C02B7549E75FAA5BCD7F12C2E7D347CDAB9D6300C09CA6ED3C1A97` | **MATCH** |
| 25 | `repo_before_blobs_sha256.txt` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!repo_before_blobs_sha256.txt` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\repo_before_blobs_sha256.txt` (MATCH) | `evidence/IPC_C6_FIX_01/repo_before_blobs_sha256.txt` | `485` | `965AB043C182135F89CC5641745C18253BA36ED4A43D7E2052C03DFC0B95D94C` | **MATCH** |
| 26 | `restore_and_isolation_check.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!restore_and_isolation_check.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\restore_and_isolation_check.json` (MATCH) | `evidence/IPC_C6_FIX_01/restore_and_isolation_check.json` | `2,083` | `75ADF835F79E811CF860AAA873AB3467E94BDAF0637B16E714FBE26E633A3005` | **MATCH** |
| 27 | `screenshot_2.32.1_cold1.png` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!screenshot_2.32.1_cold1.png` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\screenshot_2.32.1_cold1.png` (MATCH) | `evidence/IPC_C6_FIX_01/screenshot_2.32.1_cold1.png` | `663,294` | `A1AC6895ACEBF6F220F981DA6DC5E4B5C74DF014B24661771FCBD33C0C1FBAC2` | **MATCH** |
| 28 | `screenshot_2.32.1_cold2.png` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!screenshot_2.32.1_cold2.png` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\screenshot_2.32.1_cold2.png` (MATCH) | `evidence/IPC_C6_FIX_01/screenshot_2.32.1_cold2.png` | `662,905` | `774AF2C9286F4218A81A07A11C1EA7C793BAB3C5213ADF305773D8A5E047EC83` | **MATCH** |
| 29 | `screenshot_2.33.0_cold1.png` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!screenshot_2.33.0_cold1.png` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\screenshot_2.33.0_cold1.png` (MATCH) | `evidence/IPC_C6_FIX_01/screenshot_2.33.0_cold1.png` | `667,095` | `DE0F2FE9930AA05E3C90DD9F68D5456FB41576005BDB4769C4AEACD9D1A31EEF` | **MATCH** |
| 30 | `screenshot_2.33.0_cold2.png` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!screenshot_2.33.0_cold2.png` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\screenshot_2.33.0_cold2.png` (MATCH) | `evidence/IPC_C6_FIX_01/screenshot_2.33.0_cold2.png` | `666,531` | `9FBC6B929B13458831CB917842FC68E11475598BEB341EC9AEF864C6AC4B17C9` | **MATCH** |
| 31 | `updater_lock_check.json` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip!updater_lock_check.json` | `C:\AGM_TestLab\IPC_SEC_A02\evidence\updater_lock_check.json` (MATCH) | `evidence/IPC_C6_FIX_01/updater_lock_check.json` | `4,453` | `1FDC612107D44FB12DC3302BD7B0213359093264B627AF1B5CDD2D4C96A595DF` | **MATCH** |
| 32 | `IPC_C6_FIX_01_evidence.zip` | `docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` | N/A (Drive 归档包) | `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `2,725,738` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | **MATCH** |

---

## 四、同名文件与内容差异检查

1. **与现有 `evidence/IPC_C6_CLOSEOUT_01/`（31 个文件）的重名检查**：
   - `IPC_REALBASE_A01` 与 `IPC_C6_CLOSEOUT_01` 重名文件数：`0`。
   - `IPC_C6_FIX_01` 与 `IPC_C6_CLOSEOUT_01` 重名文件数：`0`。
2. **A01 与 C-6 两轮之间同名文件（共 26 个）逐项 SHA256 对比**：
   - 总重名文件数：`26` 个；其中 **不同内容（SHA256 不同）`25` 个**，**内容逐字节相同 ` 1` 个**。
   - 特别提示：**存在 `5` 个“同名且字节大小完全相同、但 SHA256 内容不同”的文件**（`bases_and_backups_sha256.json` 实测第 2 行 `GeneratedAtLocal` 时间戳不同；另有 `patch_2.32.1.log`、`patch_2.33.0.log`、`restore_and_isolation_check.json`、`updater_lock_check.json`），若仅凭文件名与文件大小极易误判为同文件。本轮均已按阶段严格隔离存放至 `evidence/IPC_REALBASE_A01/` 与 `evidence/IPC_C6_FIX_01/`。

| # | 重名文件 | A01 Size (B) | A01 SHA256 | C-6 Size (B) | C-6 SHA256 | 大小相同 | 内容结论 |
| ---: | --- | ---: | --- | ---: | --- | :---: | --- |
| 1 | `bases_and_backups_sha256.json` | `3,872` | `79CE4BF90E7E00A202142A6CD5D057BC7F3633B8DE91F26031CD293616520BDF` | `3,872` | `1575173434594926CB59A85CF6AE8C3A8B51A58211B03BCD1A8CF699D4DA3A1C` | YES | **DIFF_CONTENT (同大小陷阱)** |
| 2 | `bases_and_backups_sha256.txt` | `1,324` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | `1,324` | `128AE66D24AA63BCB9050B1A3A592EC7CA57314FF59D3EDA1B59342070B0B85F` | YES | **SAME_CONTENT** |
| 3 | `cold_start_2.32.1.json` | `15,492` | `C5049626124E41EA4A8B0264163893F5DF28DF735601119E940F4DB288B30926` | `15,363` | `7B71633573E67CB4181674A5775D866731A33B15DF92130D46972D06DFF61C89` | NO | DIFF_CONTENT |
| 4 | `cold_start_2.33.0.json` | `15,376` | `7BD9388D3EFACA5D9125E327BF45B9EF92BCCC2B1EEC6A0725892095C4335035` | `15,370` | `419EC385FBDD7EC5E2317179E85812EE395AAB5D57F766FA533247E71CEC4458` | NO | DIFF_CONTENT |
| 5 | `formal_ide_snapshot_after.json` | `256,061` | `1F2BF7CE0A28F149EBBAFDDC4FB1ADFDBE31DA205D3CE4AAFC4EECAB3DCC869C` | `260,454` | `08B0874C13E4DAD2B613BA0C1E2E0F411142985B13EB3157A1E46B087923CAD3` | NO | DIFF_CONTENT |
| 6 | `formal_ide_snapshot_before.json` | `256,826` | `DAA5914B6E42B370E328A3096AE04E95D90297A8C089ACA8704E9860B76320E8` | `260,454` | `F79393CEBCA453156C75A2B0AED8E4BF3FEEBA6AB585F7E5A632942AC213F0B1` | NO | DIFF_CONTENT |
| 7 | `formal_ide_snapshot_diff.txt` | `3,949` | `74646062F6453F4A68624F73268A47034EB69DC5118353FDE747081FFD313FD2` | `4,145` | `52174ECE8BC89E3996302EE414CC226AEB3E0230858EFE61125FFF20EED0C9D3` | NO | DIFF_CONTENT |
| 8 | `git_baseline.txt` | `1,113` | `573F7F2283F23EA63748456374FC785AB703060A5AB77E05820692B6FFCDD298` | `372` | `FC7E94FF8549B37351E57411D136A79A4467A6783C5FED3116FF684AE89D3E81` | NO | DIFF_CONTENT |
| 9 | `ipc_results_2.32.1.json` | `30,899` | `0FEE683295787967EB8D57BFA39ECE526720C90773673FA35BF52C972CCCDDD1` | `45,995` | `1FD86CDBCF705F0077A515E97A2FAB511955B467A64096E601049C9C3BEC998B` | NO | DIFF_CONTENT |
| 10 | `ipc_results_2.33.0.json` | `30,670` | `3787734A9DD5C43D5014D825F1B3314F0B4504A8D6AACBE699DDA82D5BED5127` | `45,995` | `5A48569C2E12A3E92191328001137382CFE44BCD0E40AF79DB477D780030F0FA` | NO | DIFF_CONTENT |
| 11 | `launch_2.32.1_cold1.log` | `24,059` | `7DB21452821B77616A70FC74EDB3B8D9CF1F1EACF59C977C89161F3D5CD482AB` | `24,019` | `7B2B83177E750D25E042E1EBA0014757FC4FD254EEC6826B878C1E70B954E522` | NO | DIFF_CONTENT |
| 12 | `launch_2.32.1_cold2.log` | `24,601` | `BB446B534F0F30BAC64A53116C6F13A4131D355ACFED40035C263E512A7EAF8B` | `25,022` | `3EEBDEE08BAC8335E1B30CD987D53418308EC4BD4780B7B61A30855753E271C1` | NO | DIFF_CONTENT |
| 13 | `launch_2.33.0_cold1.log` | `23,852` | `39DC70F08006E60DC5599CAE59A30B6FBFE80E865450DF955D4981F35AAD82D6` | `24,587` | `5FBE7119CD982C614BBA2E728C5F5E3AAC1DD466C9D038E01FDEDD8517F5ABD7` | NO | DIFF_CONTENT |
| 14 | `launch_2.33.0_cold2.log` | `24,971` | `C3E90DDFC2319320596777915915A0B937B1C78EE232D374CF28897FB557B519` | `24,969` | `32EDB5B1D826120506A08A7FE8F964AEAC3B5D6B0C430DF8F877653C4AAD4089` | NO | DIFF_CONTENT |
| 15 | `patch_2.32.1.log` | `2,051` | `B8DD37283DA99332CFC187951F2BF29510B6DFED5192985208D8B24CD3CA066D` | `2,051` | `A2A6CB23F72971579C3BD607E27E636E3C15A933783585E444EBD2989DEA96C0` | YES | **DIFF_CONTENT (同大小陷阱)** |
| 16 | `patch_2.33.0.log` | `2,051` | `26F4ED03F95502AEE9DDB60AB9D3D77F6DFB5A954B36FD3F68123CE10C9A420D` | `2,051` | `5870A5F8848EA5FD94FDC1D42CBAB6216FD2AF25489630B6C0A8CE05E892B238` | YES | **DIFF_CONTENT (同大小陷阱)** |
| 17 | `patch_verify_2.32.1.json` | `2,913` | `EB6BCCCDD7F6ECC5F81A1772E057C0A82ACA0C14D59E716D96521353AA706F31` | `3,088` | `1AC5FCC8EC6263BBE6D887331843ECB2C90981AC351FADF6325639472224A817` | NO | DIFF_CONTENT |
| 18 | `patch_verify_2.33.0.json` | `2,913` | `91E5BDF349A63F78C20976C09813917C8508E0664F29AD47D1AC5DEF68C31D60` | `3,088` | `6F88F8FD3C221CF81E8EA4835BAEA0BDDDE58A2350F610EF250A9FAE16784223` | NO | DIFF_CONTENT |
| 19 | `probe_2.32.1.log` | `44,931` | `8EECD22658CB021BFE7A79C40556DF57BDC61DA5901C6E1E533FEDC1E78BAB7B` | `81,009` | `0351D49DD1EA8CF1BE416BFABA5AF8270F00B4F5027479049A184C83DE070C0D` | NO | DIFF_CONTENT |
| 20 | `probe_2.33.0.log` | `45,115` | `BE35A9570C2D2BE7A35C4677003A0EF3AE02CD9F7801D1999F635E1712D34732` | `80,971` | `E7D5B5B2CEECDF63ACF8E516764E5DECF208AA573E3DE07F0BB3A5CF43E049D9` | NO | DIFF_CONTENT |
| 21 | `restore_and_isolation_check.json` | `2,083` | `CD037AEE1EFCA613E0E6FD212142C6FAA6EA4798BC09C11B3B903552D9B5A507` | `2,083` | `75ADF835F79E811CF860AAA873AB3467E94BDAF0637B16E714FBE26E633A3005` | YES | **DIFF_CONTENT (同大小陷阱)** |
| 22 | `screenshot_2.32.1_cold1.png` | `662,487` | `C7096B292D6E672E088EB98674FBDF4F3FA9966A816435BBD13E3097D6E51332` | `663,294` | `A1AC6895ACEBF6F220F981DA6DC5E4B5C74DF014B24661771FCBD33C0C1FBAC2` | NO | DIFF_CONTENT |
| 23 | `screenshot_2.32.1_cold2.png` | `662,108` | `6FE174E0D78D4817F05E55945A4F243622A3ED4F4BF46078964DE74B8C7A7F92` | `662,905` | `774AF2C9286F4218A81A07A11C1EA7C793BAB3C5213ADF305773D8A5E047EC83` | NO | DIFF_CONTENT |
| 24 | `screenshot_2.33.0_cold1.png` | `667,559` | `FF98F86B304ADA98DFD3345B81682D2415EB4737B8ABC21CAD922583ECCA640F` | `667,095` | `DE0F2FE9930AA05E3C90DD9F68D5456FB41576005BDB4769C4AEACD9D1A31EEF` | NO | DIFF_CONTENT |
| 25 | `screenshot_2.33.0_cold2.png` | `667,464` | `21CA496B20E7D8C9CC50243C8B3CCC16CF78F0C4D11DE0381514DBB48C8FFE69` | `666,531` | `9FBC6B929B13458831CB917842FC68E11475598BEB341EC9AEF864C6AC4B17C9` | NO | DIFF_CONTENT |
| 26 | `updater_lock_check.json` | `4,453` | `E0D0CED0D3C0C5FAA18C2E53E2ED07EF093E7B2AC3F55C391536E35A2883CA0E` | `4,453` | `1FDC612107D44FB12DC3302BD7B0213359093264B627AF1B5CDD2D4C96A595DF` | YES | **DIFF_CONTENT (同大小陷阱)** |

> 注：`C-6` 独有而 `A01` 不包含的 `5` 个文件为：`ci_run_summary.json`、`local_unit_tests.log`、`repo_after_blobs_sha256.txt`、`repo_backup_sha256.txt`、`repo_before_blobs_sha256.txt`。

---

## 五、冲突、缺失、损坏与未完成项清单

### 5.1 完整性异常统计

| 检查项 | 数量 | 明细说明 |
| --- | ---: | --- |
| 缺失文件（对照两轮报告第七节清单） | `0` | A01 `26/26` 齐全，C-6 `31/31` 齐全 |
| 损坏 / 零字节文件（ZIP `testzip()` + JSON 解析 + PNG `verify()`） | `0` | 两份 ZIP、所有 JSON 与 PNG 均通过校验 |
| 目标覆盖冲突（已有同名文件冲突） | `0` | 两个目标目录为全新阶段子目录，与 `IPC_C6_CLOSEOUT_01/` 零交集 |
| 无法确认来源的文件 | `0` | 全部 59 个文件均由 Drive `docs/` ZIP 实测解出，且 57 个原始文件与 PC `C:\AGM_TestLab\IPC_SEC_A0{1,2}\evidence\` 100% 匹配 |

### 5.2 显式标记为 `NOT RUN` 的未执行项

| 项目 | 状态标记 | 原因说明 |
| --- | --- | --- |
| 更新现有历史报告中的旧路径引用 | **NOT RUN** | 本轮要求“不修改现有报告中的历史引用”，仅登记待更新清单 |
| 删除 `docs/` 下冗余 `.zip` 或本地 PC 源文件 | **NOT RUN** | 本轮要求“不执行下一轮清理，不删除源文件”，等待用户与 GPT 验收 |
| 同步 `AGM_IPC_C6_FIX_01_report.md` CLOSEOUT 修订版至 `docs/` | **NOT RUN** | Drive `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md` 为原件（`18,387` B），本轮禁止覆盖原文件，仅登记版本差异 |
| 整理 `docs/` 下非本轮范围的历史目录（如 `AGM_233_IPC_SEC_01/` 等） | **NOT RUN** | 超出本轮范围（本轮仅处理 IPC A01 与 C-6 证据） |
| 产品源码、GitHub/PR #10、正式 IDE 外部独立前后快照比对 | **NOT RUN** | 按只读隔离与禁止操作红线未对其执行外部扫描或操作；本任务自身写盘严格限定于 `evidence/` 新建目录与 `00_Flash_Box/` 本次交付物 |

---

## 六、源文件与既有目标完整性核查

1. **Drive `docs/` 源目录（复制前后 SHA256 全量比对）**：
   - `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_REALBASE_A01\`：3/3 文件 SHA256 前后 **100% UNCHANGED**。
   - `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_C6_FIX_01\`：3/3 文件 SHA256 前后 **100% UNCHANGED**。
2. **本地 PC `C:\AGM_TestLab\` 交叉源目录（复制前后 SHA256 全量比对）**：
   - `C:\AGM_TestLab\IPC_SEC_A01\evidence\`：26/26 文件 SHA256 前后 **100% UNCHANGED**。
   - `C:\AGM_TestLab\IPC_SEC_A02\evidence\`：31/31 文件 SHA256 前后 **100% UNCHANGED**。
3. **既有 `evidence/` 目录（复制前后 SHA256 全量比对）**：
   - `G:\我的云端硬盘\01_Projects\Antigravity_Mod\evidence\IPC_C6_CLOSEOUT_01\`：31/31 文件（`233,849` B）SHA256 前后 **100% UNCHANGED**。
4. **禁止触碰范围操作记录**：
   - 本轮未扫描或操作其他项目；未修改 `C:\Antigravity_Mod` 或任何产品源码/测试代码；未访问或修改正式 IDE；未执行任何 `git`/`gh` 命令或改动 GitHub 仓库及 PR #10；未清理 `/workspace/agm/`；未删除 `COMPAT_233_01` 安装包。

---

## 七、历史报告引用路径待更新清单（本轮未修改）

> 以下引用存在于现行 `docs/` 历史报告中，**本轮严格保持原文件零改动**，仅登记其未来若需标准化归档链接时的建议映射。

### 7.1 `docs/AGM_IPC_REALBASE_A01/AGM_IPC_REALBASE_A01_report.md`（已保留原状）

| 行号 | 现存引用文本 | 引用类型 | 建议未来迁移引用（若更新） | 备注 |
| ---: | --- | --- | --- | --- |
| L5, L25, L148–L150 | `C:\AGM_TestLab\IPC_SEC_A01\` / `deliver/` / `evidence/` | PC 实验绝对路径 | `../../evidence/IPC_REALBASE_A01/` | 报告在 `docs/` 时需回退至项目根 |
| L21 | `evidence/git_baseline.txt` | 相对原工作区路径 | `../../evidence/IPC_REALBASE_A01/git_baseline.txt` | 现已归档至新路径 |
| L28, L30, L32, L40, L42–L44, L73, L104, L124–L125, L130 | `W\bases\...`、`W\backups\...`、`W\repo\...`、`W\tools\...`、`W\run\...`、`W\tmp\`、`W\evidence\`、`W\deliver\` | PC 测试沙箱缩写路径 (`W = C:\AGM_TestLab\IPC_SEC_A01`) | 属当轮测试沙箱现场记录（部分临时目录运行后已还原/清理）；仅 `W\evidence\` 对应 `../../evidence/IPC_REALBASE_A01/` | 建议保留沙箱历史语义，不强改 `W\` |
| L123 | `evidence/restore_and_isolation_check.json` | 相对原工作区路径 | `../../evidence/IPC_REALBASE_A01/restore_and_isolation_check.json` | 现已归档至新路径 |
| L126 | `evidence/formal_ide_snapshot_before.json`（及 `_after.json` / `_diff.txt`） | 相对原工作区路径 | `../../evidence/IPC_REALBASE_A01/formal_ide_snapshot_{before,after}.json`、`formal_ide_snapshot_diff.txt` | 现已归档至新路径 |
| L151–L154 | 26 个证据文件清单（承接 L150 `C:\AGM_TestLab\IPC_SEC_A01\evidence\`） | 证据索引列表 | `../../evidence/IPC_REALBASE_A01/<文件名>` | 26/26 全部在位 |

### 7.2 `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md`（已保留原状）

| 行号 | 现存引用文本 | 引用类型 | 建议未来迁移引用（若更新） | 备注 |
| ---: | --- | --- | --- | --- |
| L5, L139, L157–L159 | `C:\AGM_TestLab\IPC_SEC_A02\` / `deliver/` / `evidence/`（及 L139 提及 `C:\AGM_TestLab\IPC_SEC_A01\`） | PC 实验绝对路径 | `../../evidence/IPC_C6_FIX_01/`（A01 对应 `../../evidence/IPC_REALBASE_A01/`） | 现已归档至新路径 |
| L15 | `evidence/git_baseline.txt` | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/git_baseline.txt` | 现已归档至新路径 |
| L22 | `evidence/repo_backup_sha256.txt`（及 `W\backups\repo\...`） | 相对路径 / PC 沙箱路径 | `../../evidence/IPC_C6_FIX_01/repo_backup_sha256.txt` | 现已归档至新路径 |
| L48 | `evidence/repo_before_blobs_sha256.txt`、`evidence/repo_after_blobs_sha256.txt` | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/repo_{before,after}_blobs_sha256.txt` | 现已归档至新路径 |
| L61 | `evidence/local_unit_tests.log` | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/local_unit_tests.log` | 现已归档至新路径 |
| L77 | `evidence/ci_run_summary.json` | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/ci_run_summary.json` | 现已归档至新路径（注：PC CLOSEOUT 修订版已将该处改记为 `W/input/ci_run_summary.json` 并修正 Job ID） |
| L91–L92, L138–L140 | `W\repo\...`、`W\tools\...`、`W\backups\SHA256SUMS.txt`、`W\bases\`、`W\tmp\`、`W\evidence\`、`W\deliver\` | PC 测试沙箱缩写路径 (`W = C:\AGM_TestLab\IPC_SEC_A02`) | `W\evidence\` 对应 `../../evidence/IPC_C6_FIX_01/`；其余属沙箱现场记录 | 建议保留沙箱历史语义 |
| L133 | `evidence/formal_ide_snapshot_before.json`（及 `_after.json` / `formal_ide_snapshot_diff.txt`） | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/formal_ide_snapshot_{before,after}.json`、`formal_ide_snapshot_diff.txt` | 现已归档至新路径 |
| L137 | `evidence/restore_and_isolation_check.json` | 相对原工作区路径 | `../../evidence/IPC_C6_FIX_01/restore_and_isolation_check.json` | 现已归档至新路径 |
| L160–L165 | 31 个证据文件清单（承接 L159 `C:\AGM_TestLab\IPC_SEC_A02\evidence\`） | 证据索引列表 | `../../evidence/IPC_C6_FIX_01/<文件名>` | 31/31 全部在位 |

---

## 八、冗余副本与 `00_Flash_Box/` 清理建议（仅登记，本轮不删除）

### 8.1 是否建议以后删除冗余副本

1. **`docs/` 下的重复证据压缩包（建议经验收后在独立清理轮次删除）**：
   - `docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip`（`2,713,318` B）与 `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip`（`2,725,738` B）已在 `evidence/IPC_REALBASE_A01/` 和 `evidence/IPC_C6_FIX_01/` 分别保留完整解包原始文件与逐字节一致的原版 `.zip` 副本。
   - **建议**：待用户与 GPT 验收本轮归档后，可另立清理任务删除 `docs/` 下的上述 2 个 `.zip`（合计释放 `5,439,056` B），而 `docs/` 下的两份 `_report.md` 与 `_preview.png` 仍继续保留在 `docs/` 目录。
2. **`evidence/` 内部原版 `.zip` 与解包文件共存（建议短期双保留）**：
   - 现阶段保留 `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` 与 `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip`，既能直接浏览 57 个解包原始证据，又能对原压缩包整体 SHA256 做单文件审计；后续若确认长期无需原打包体，再统一清理。
3. **`AGM_IPC_C6_FIX_01_report.md` 双版本差异处理建议**：
   - 建议后续单独确认是否将 `C:\AGM_TestLab\IPC_SEC_A02\deliver\AGM_IPC_C6_FIX_01_report.md`（CLOSEOUT 修订版，`20,500` B）更新回 `docs/AGM_IPC_C6_FIX_01/`（因 `evidence/IPC_C6_CLOSEOUT_01/backup_AGM_IPC_C6_FIX_01_report.md.orig` 已留存原件备份）。
4. **其余 `docs/` 历史证据目录（如 `docs/AGM_233_IPC_SEC_01/` 等）**：
   - 不在本轮范围，建议后续按同标准单独立项归档至 `evidence/`。

### 8.2 `00_Flash_Box/` 旧预览归档与超 7 天过期交付物核查

- **本任务旧预览归入 `_Archive/`**：核查 `00_Flash_Box/` 现有全部内容，不存在旧版 `AGM_EVIDENCE_ARCHIVE_A01_preview.png`，故归入数量为 **0**；其余任务的现役文件保持原位未触碰。
- **超过 7 天且结论已沉淀到 `docs/` 的过期临时交付物**：以 `2026-11-20` 为基准实测 `00_Flash_Box/` 全部条目，最久远文件修改时间为 `2026-11-18 09:33:53`（距今 `1.69` 天），最久远目录修改时间为 `2026-11-17 12:49:36`（距今 `2.56` 天），**超过 7 天项 = 0**，无需登记清理。

| 位置 | 条目名称 | 类型 | 大小 (B) | 修改时间 | 距今天数 | 超 7 天 | 备注 |
| --- | --- | --- | ---: | --- | ---: | :---: | --- |
| `00_Flash_Box/` | `TELEMETRY_PLUGIN_01_preview.png` | FILE | `92,078` | `2026-11-19 23:23:27` | `0.12d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `TELEMETRY_PLUGIN_01_report.md` | FILE | `27,392` | `2026-11-19 23:25:04` | `0.12d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `_Archive` | DIR | `0` | `2026-11-19 23:12:34` | `0.12d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `grok_nasa_visual_roundC_preview.png` | FILE | `710,665` | `2026-11-18 10:16:01` | `1.66d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `grok_nasa_visual_roundC_report.md` | FILE | `7,380` | `2026-11-18 10:16:00` | `1.66d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `hakimi_i18n_round4_dict_export_report.md` | FILE | `5,683` | `2026-11-18 10:00:02` | `1.67d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `hakimi_i18n_v1_1_report.md` | FILE | `9,245` | `2026-11-18 09:33:53` | `1.69d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/` | `插件` | DIR | `0` | `2026-11-17 12:49:36` | `2.56d` | NO | 非本任务项，未触碰 |
| `00_Flash_Box/_Archive/` | `TELEMETRY_PROBE_01_report.md` | FILE | `7,985` | `2026-11-19 22:38:04` | `0.15d` | NO | 既有归档文件 |
| `00_Flash_Box/_Archive/` | `V4_0_Stage2_拆层表情_preview.png` | FILE | `1,575,764` | `2026-11-19 04:00:01` | `0.92d` | NO | 既有归档文件 |
| `00_Flash_Box/_Archive/` | `V4_0_Stage2_拆层表情_report.md` | FILE | `5,005` | `2026-11-19 04:00:01` | `0.92d` | NO | 既有归档文件 |
| `00_Flash_Box/_Archive/` | `V4_0_战神母图_preview.png` | FILE | `994,097` | `2026-11-19 04:00:01` | `0.92d` | NO | 既有归档文件 |
| `00_Flash_Box/_Archive/` | `V4_0_战神母图_report.md` | FILE | `4,439` | `2026-11-19 04:00:01` | `0.92d` | NO | 既有归档文件 |

DONE
