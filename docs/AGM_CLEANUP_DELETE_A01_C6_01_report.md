Round 2 | 2026-11-20 03:32
# 任务 AGM_CLEANUP_DELETE_A01_C6_01：Round 2 精准清理执行验收报告

- **任务编号**：`AGM_CLEANUP_DELETE_A01_C6_01`
- **执行轮次**：`Round 2`（精准清理执行）
- **执行时间**：`2026-11-20 03:31:24` 至 `2026-11-20 03:31:26`（报告生成 `2026-11-20 03:32`）
- **删除机制**：针对 2 个精确字面绝对路径分别调用 Win32 `SHFileOperationW`（`FO_DELETE=3`，`FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT = 0x0454`），走正常回收站 / Google Drive 垃圾箱可恢复删除机制；**未执行不可逆永久清除，未清空 Windows 回收站或 Google Drive 垃圾箱**。
- **执行结论**：**PASS（仅删除 `docs/` 下 2 份冗余原始 ZIP，活跃 `docs/` 目录减少 `5,439,056` bytes / 约 `5.19 MiB`；`evidence/` 下 2 份逐字节副本及全部 `90` 个证据文件 SHA256 变化 `0`；未发现任何异常，已停止等待人工验收）。**

---

## 一、实际执行路径与删除前强制检查结果

### 1.1 精确执行路径与对应保留副本

| 目标编号 | 删除目标实际本地绝对路径 | 对应保留副本绝对路径 |
| --- | --- | --- |
| `Target 1 (A01)` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\evidence\IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` |
| `Target 2 (C-6)` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` | `G:\我的云端硬盘\01_Projects\Antigravity_Mod\evidence\IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` |

### 1.2 删除前 6 项强制检查明细

| 检查项 | Target 1 (A01) | Target 2 (C-6) | 判定 |
| --- | --- | --- | --- |
| 1. 云盘路径解析为本地绝对路径 | `G:\...\docs\AGM_IPC_REALBASE_A01\IPC_REALBASE_A01_evidence.zip` | `G:\...\docs\AGM_IPC_C6_FIX_01\IPC_C6_FIX_01_evidence.zip` | **PASS** |
| 2. 目标与保留副本存在且非同一链接 | 均存在，非 symlink，`realpath` 独立 | 均存在，非 symlink，`realpath` 独立 | **PASS** |
| 3. 实测文件大小对照预期 | `2,713,318` B（副本同 `2,713,318` B） | `2,725,738` B（副本同 `2,725,738` B） | **PASS** |
| 4. SHA256 核对预期与保留副本 | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF`（100% 匹配） | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85`（100% 匹配） | **PASS** |
| 5. `ZipFile.testzip()` 解压校验 | 目标与副本均 `bad=None`（`26` 文件 + `1` 目录项） | 目标与副本均 `bad=None`（`31` 文件 + `0` 目录项） | **PASS** |
| 6. 删除前目录清单及哈希快照 | 已落盘快照（3 文件，`3,205,669` B） | 已落盘快照（3 文件，`3,195,310` B） | **PASS** |

---

## 二、两份 ZIP 删除执行结果与验收指标对照

### 2.1 删除调用明细

| 目标 | 删除方式 | `SHFileOperationW` 返回码 | `fAnyOperationsAborted` | 删后存在性 | 活跃目录减少字节 |
| --- | --- | ---: | :---: | :---: | ---: |
| `Target 1 (A01)` | `Win32 SHFileOperationW (FO_DELETE=3, FOF_ALLOWUNDO|FOF_NOCONFIRMATION|FOF_NOERRORUI|FOF_SILENT=0x0454)` | `0` | `False` | `False` (已移出) | `2,713,318` |
| `Target 2 (C-6)` | `Win32 SHFileOperationW (FO_DELETE=3, FOF_ALLOWUNDO|FOF_NOCONFIRMATION|FOF_NOERRORUI|FOF_SILENT=0x0454)` | `0` | `False` | `False` (已移出) | `2,725,738` |

### 2.2 验收指标核对表

| 验收指标 | 预期要求 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 删除文件 | `2` | `2`（仅 Target 1 & Target 2） | **PASS** |
| 活跃 `docs` 目录减少 | `5,439,056` bytes | `5,439,056` bytes（`6,400,979` -> `961,923`） | **PASS** |
| 预计空间减少 | 约 `5.19 MiB` | `约 5.19 MiB`（**注：仅为活跃 `docs/` 目录减少量；未清空回收站与 Google Drive 垃圾箱，不宣称永久云盘配额已释放**） | **PASS** |
| `evidence` 副本保留 | `2` | `2`（2 份原版 ZIP 均在位且 `testzip()=None`） | **PASS** |
| `evidence` SHA256 变化 | `0` | `0`（全部 `90` 个文件前后 SHA256 100% 一致） | **PASS** |
| 其他文件误删 | `0` | `0`（`docs/` 4 份报告/预览及 `COMPAT_233_01` 保护文件均在位） | **PASS** |
| 其他文件修改 | `0` | `0`（所有留存文件大小与 SHA256 前后完全一致） | **PASS** |
| 未授权操作 | `0` | `0`（未使用通配符、未清垃圾箱、未动 `/workspace/agm/`、未改历史报告） | **PASS** |

---

## 三、删除前后 SHA256 全量对照表

| 分类 | 文件路径 | 删除前大小 (B) | 删除前 SHA256 | 删除后状态 / 大小 (B) | 删除后 SHA256 |
| --- | --- | ---: | --- | --- | --- |
| 目标 1 (已删) | `docs/AGM_IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `2,713,318` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | **已删除 (`exists=False`)** | `N/A` (移入回收站/垃圾箱) |
| 目标 2 (已删) | `docs/AGM_IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `2,725,738` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | **已删除 (`exists=False`)** | `N/A` (移入回收站/垃圾箱) |
| `docs/` 保留 | `docs/AGM_IPC_REALBASE_A01/AGM_IPC_REALBASE_A01_preview.png` | `470,999` | `71CE7D37ABCB44A8E6AED59902C864599809FAE141EC68650B9CED0B3F9948A8` | `470,999` (**UNCHANGED**) | `71CE7D37ABCB44A8E6AED59902C864599809FAE141EC68650B9CED0B3F9948A8` |
| `docs/` 保留 | `docs/AGM_IPC_REALBASE_A01/AGM_IPC_REALBASE_A01_report.md` | `21,352` | `FE5587A125E749586AFF212C59B8EF358F68C5735164E4F89BA59E39AC0FF205` | `21,352` (**UNCHANGED**) | `FE5587A125E749586AFF212C59B8EF358F68C5735164E4F89BA59E39AC0FF205` |
| `docs/` 保留 | `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_preview.png` | `451,185` | `03DDCB5F48553CEEA320C2708B51D08661A8F2A44AC4FC0784EDACA375AF1B04` | `451,185` (**UNCHANGED**) | `03DDCB5F48553CEEA320C2708B51D08661A8F2A44AC4FC0784EDACA375AF1B04` |
| `docs/` 保留 | `docs/AGM_IPC_C6_FIX_01/AGM_IPC_C6_FIX_01_report.md` | `18,387` | `E773032B4D2476A0C61E37EDC9383A3484A81DDAA3FD53A8E370564C7A774D01` | `18,387` (**UNCHANGED**) | `E773032B4D2476A0C61E37EDC9383A3484A81DDAA3FD53A8E370564C7A774D01` |
| `evidence/` 副本 1 | `evidence/IPC_REALBASE_A01/IPC_REALBASE_A01_evidence.zip` | `2,713,318` | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` | `2,713,318` (**UNCHANGED**) | `2E4ADC6A2193E9C7CECFEB5E1F40C1DC9B804130076A5C8712553B38DE372EAF` |
| `evidence/` 副本 2 | `evidence/IPC_C6_FIX_01/IPC_C6_FIX_01_evidence.zip` | `2,725,738` | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` | `2,725,738` (**UNCHANGED**) | `CAA7094B4FAC55AD9BC3FD3607C1EFB8EDDB705AE3E5CB30C57D0B8997F8DA85` |
| 保护项 | `C:\AGM_TestLab\COMPAT_233_01\base_2330\Antigravity-x64.exe` | `182,549,552` | `44AEA1C00F3B347FD60AB7291D267DBB04A5080F6C3212A8A31CF1426DDF86CB` | `182,549,552` (**UNCHANGED**) | `44AEA1C00F3B347FD60AB7291D267DBB04A5080F6C3212A8A31CF1426DDF86CB` |
| 保护项 | `C:\AGM_TestLab\COMPAT_233_01\base_2330\nsis_out\app-64.7z` | `181,962,351` | `DD7411898C4B3F3E01A155E01E0C8EED10C2116DE9E3108ADBD1BA064F7B35E0` | `181,962,351` (**UNCHANGED**) | `DD7411898C4B3F3E01A155E01E0C8EED10C2116DE9E3108ADBD1BA064F7B35E0` |

---

## 四、删除前后目录清单差异与 `evidence/` 副本保留验证

### 4.1 `docs/` 目标目录前后清单对比

| 目录 | 删除前文件清单 (数量 / 字节) | 删除后文件清单 (数量 / 字节) | 差异说明 |
| --- | --- | --- | --- |
| `docs/AGM_IPC_REALBASE_A01/` | 3 文件 (`3,205,669` B):<br>- `AGM_IPC_REALBASE_A01_report.md` (`21,352` B)<br>- `AGM_IPC_REALBASE_A01_preview.png` (`470,999` B)<br>- `IPC_REALBASE_A01_evidence.zip` (`2,713,318` B) | 2 文件 (`492,351` B):<br>- `AGM_IPC_REALBASE_A01_report.md` (`21,352` B)<br>- `AGM_IPC_REALBASE_A01_preview.png` (`470,999` B) | 仅减少 `IPC_REALBASE_A01_evidence.zip`（`-2,713,318` B）；报告与预览 SHA256 不变 |
| `docs/AGM_IPC_C6_FIX_01/` | 3 文件 (`3,195,310` B):<br>- `AGM_IPC_C6_FIX_01_report.md` (`18,387` B)<br>- `AGM_IPC_C6_FIX_01_preview.png` (`451,185` B)<br>- `IPC_C6_FIX_01_evidence.zip` (`2,725,738` B) | 2 文件 (`469,572` B):<br>- `AGM_IPC_C6_FIX_01_report.md` (`18,387` B)<br>- `AGM_IPC_C6_FIX_01_preview.png` (`451,185` B) | 仅减少 `IPC_C6_FIX_01_evidence.zip`（`-2,725,738` B）；报告与预览 SHA256 不变 |
| **两目录合计** | **`6` 文件 / `6,400,979` B** | **`4` 文件 / `961,923` B** | **净减少 `5,439,056` B (`5.19 MiB`)** |

### 4.2 `evidence/` 全量留存验证（90/90 完整不变）

- `evidence/IPC_REALBASE_A01/`：保留 **`27`** 个文件（26 解包原始文件 + 1 原版 `IPC_REALBASE_A01_evidence.zip`），删后 `testzip()` 返回 `None`，全部文件 SHA256 变化为 `0`。
- `evidence/IPC_C6_FIX_01/`：保留 **`32`** 个文件（31 解包原始文件 + 1 原版 `IPC_C6_FIX_01_evidence.zip`），删后 `testzip()` 返回 `None`，全部文件 SHA256 变化为 `0`。
- `evidence/IPC_C6_CLOSEOUT_01/`：保留 **`31`** 个文件，全部文件 SHA256 变化为 `0`。
- **`evidence/` 总计**：**`90`** 个文件，**`12,769,074`** bytes，**0 缺失、0 变化**。

---

## 五、实际减少字节、空间配额说明与异常检查

1. **实际减少字节数**：活跃 `docs/` 目录准确减少 **`5,439,056` bytes**（`2,713,318 + 2,725,738`，约 **`5.19 MiB`**）。
2. **云盘永久配额说明**：上述 `5.19 MiB` 仅为**活跃 `docs/` 目录减少量**。由于本轮严格采用回收站 / Google Drive 垃圾箱删除机制且禁止清空 Windows 回收站与 Google Drive 垃圾箱，因此**不宣称 Google Drive 永久云盘配额已经释放**；只有待用户验收并由用户按需清理垃圾箱后，云盘配额才会永久回收。
3. **是否存在异常及异常原因**：**无任何异常（`anomalies = 0`）**。两份目标均通过全部 6 项前置检查、`SHFileOperationW` 均返回 `0`（`fAnyOperationsAborted=False`）、删后目标路径均已不存在、留存与 `evidence/` 全部文件 SHA256 100% 未变。
4. **禁止操作核查与当前状态**：未动 `evidence/` 任何文件、未删 2.33.0 安装包与 `app-64.7z`、未操作 `/workspace/agm/`、未使用通配符、未修改任何历史报告。**已完成 Round 2 清理并停止，未启动下一轮清理，等待人工验收。**

DONE
