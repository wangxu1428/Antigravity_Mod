# 实验室历史回滚脚本归档说明 (Legacy Lab Rollback Scripts)

> **⚠️ 严正警告（禁止在生产环境直接执行）**
>
> 本目录（`scripts/legacy-rollback/`）收录的 `rollback.ps1` 与 `rollback.bat` 来自 `AGM_PLUGIN_01` 实验室阶段性快照回滚工具，**仅供研发归档与审计参考，严禁作为正式生产还原工具使用！**

## 已知未修复缺陷记录

1. **PowerShell 变量大小写不敏感导致的 `$D` / `$d` 变量互相覆盖缺陷（`rollback.ps1:L23-L30`）**：
   - 在 `rollback.ps1` 第 23 行中，脚本使用 `$D` 保存位移备份根目录：
     ```powershell
     $D = Join-Path $B ("displaced_" + (Get-Date -Format yyyyMMdd_HHmmss))
     ```
   - 但在随后的第 24、26、30 行循环中，脚本使用了小写 `$d` 作为临时目标文件路径或子目录名变量：
     ```powershell
     foreach($x in $extra){ ... $d = Join-Path $D $rel; ... }
     foreach($d in 'plugins','mod_kit'){ ... }
     ```
   - 由于 PowerShell 变量名不区分大小写，`$d` 会直接覆写 `$D`，导致包含 2 个以上新增/差异文件的真实回滚（非 `-VerifyOnly`）在第 2 次循环时将文件路径当作父目录拼接并抛出异常中止。
2. **实验室硬编码路径依赖**：
   - 脚本依赖实验室特定目录结构（`backup\manifest.tsv`、`backup\files\` 及链式回滚路径）。

## 正式生产还原方式

如需在用户环境中安全还原官方原版 `app.asar`，请使用上层目录中的 **`scripts/restore-official.ps1`**（该脚本已彻底杜绝单字母大小写混用变量，并严格保护 `UserData/` 与 `plugins/{config.json,state,packages}` 用户数据）。
