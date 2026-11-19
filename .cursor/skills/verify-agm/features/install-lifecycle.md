# Install and update lifecycle

The PowerShell scripts install the AGM platform into a client copy, repatch its `app.asar`, lock the built-in updater, and restore the official build. They refuse with exit 3 while any process runs under the target and with exit 4 when `app.asar` or `app.asar.bak` is not on the official SHA256 whitelist, and they never touch user data (`plugins\config.json`, `plugins\state\`, `plugins\packages\`, `UserData\`).

## Sub-features

- `inst-dryrun` prechecks with `-DryRun` and writes nothing.
- `inst-skip-repatch` syncs platform and plugins with `-SkipRepatch`.
- `inst-repatch` repatches with the copy's `mod_kit\repatch.ps1`, creating the official `app.asar.bak`.
- `inst-update-lock` leaves `app-update.yml` and `app.asar` locked against self-update.
- `inst-repatch-repeat` repatches again without overwriting `app.asar.bak`.
- `inst-exit3` refuses while the client runs, without killing it.
- `inst-exit4` refuses a non-official `app.asar.bak`.
- `inst-restore` restores the official build with `restore-official.ps1` (`-VerifyOnly` first).
- `inst-userdata-survives` keeps user config and plugin state across an update.

## How to get to it (user POV)

- `platform\scripts\install-or-update.ps1 -TargetAppDir <dir> [-DryRun] [-SkipRepatch]` from the repo root.
- `<dir>\mod_kit\repatch.ps1 -TargetAppDir <dir>` (also `repatch.bat`).
- `platform\scripts\restore-official.ps1 -TargetAppDir <dir> [-VerifyOnly]`.

## Driving it with agm-lab + agm-cdp

Preconditions:

- `<dir>` is always `C:\AGM_TestLab\VERIFY_<id>\app`. Pass `-TargetAppDir` on every call; without it the scripts fall back to `$env:AGM_ROOT` or `C:\Antigravity_Mod`.
- Capture each script as `powershell -NoProfile -ExecutionPolicy Bypass -File <script> <args> *> C:\AGM_TestLab\VERIFY_<id>\proof\install\<nn>_<name>.txt; "EXIT=$LASTEXITCODE" >> <same file>`.

- **Setup chain.** Run `$L -Action setup -RunId <id>`. `proof\setup\1_install_dryrun.txt` has `EXIT: 0` and `[DryRun] 预检通过，未执行任何文件写入`; `2_install_skiprepatch.txt` has `EXIT: 0`; `3_repatch_testcopy.txt` has `[AGM][Status] EXIT_CODE=0 RECOVERY_STATE=SUCCESS CONSISTENCY_STATE=CONSISTENT_NEW`; `4_update_lock_gate.txt` has `GATE : PASS` and `app.asar.bak` = `5B493943…519F`.
- **Update lock at runtime.** Run `$L -Action launch -RunId <id>`. The newest `proof\electron-*.log` contains `[AGM][UpdateLock] updater locked` and, about 10 s later, `[AGM][UpdateLock] blocked periodic update checks`.
- **Exit 3.** With the client still running from the previous step, run `install-or-update.ps1 -TargetAppDir <dir>` (captured). It exits `3`, prints `ABORTED_PROCESS_RUNNING`, and `$L -Action doctor -RunId <id>` still reports `HEALTHY` (nothing was killed). Then `$L -Action stop -RunId <id>`.
- **Repeat repatch.** Record `(Get-FileHash <dir>\resources\app.asar.bak).Hash`, run `<dir>\mod_kit\repatch.ps1 -TargetAppDir <dir>` (captured), and hash again. Exit `0`, the `.bak` hash and mtime are unchanged, and a new `resources\app.asar.modded_prev_<ts>` exists.
- **User data survives.** With `stop`ped client after a Plugin Center settings save, hash `<dir>\plugins\config.json` and `<dir>\plugins\state\registry.json`, run `install-or-update.ps1 -TargetAppDir <dir> -SkipRepatch` (captured), and hash again. Exit `0` and both hashes are unchanged.
- **Exit 4.** Copy `<dir>\resources\app.asar.bak` to `C:\AGM_TestLab\VERIFY_<id>\tmp\bak.orig`, append one byte to `<dir>\resources\app.asar.bak`, run `repatch.ps1 -TargetAppDir <dir>` (captured). It exits `4` with `[AGM][Repatch] ALARM` and leaves `app.asar` unchanged. Put `tmp\bak.orig` back.
- **Restore.** Run `restore-official.ps1 -TargetAppDir <dir> -VerifyOnly` (captured, exit `0`, nothing written), then without `-VerifyOnly` (exit `0`). `<dir>\resources\app.asar` hash becomes `5B493943…519F`.

## Gotchas

- Proven 2026-11-20 (run `SKILL01`): the setup chain (DryRun, -SkipRepatch, test-copy repatch, gate PASS) and the runtime update-lock log lines. Exit 3, repeat repatch, user-data survival, exit 4 and restore are UNKNOWN until a run records proof.
- Only run the `repatch.ps1` inside `<dir>\mod_kit\`. Never the one under `D:\AI_Studio\Apps\Antigravity\` and never against `C:\Antigravity_Mod`.
- Exit 3 is the scripts working as designed; they never kill. Use `$L -Action stop`, never `taskkill`.
- Exit 4 is an alarm. In a real install it means the base is not official; never "fix" it by adding a hash to the whitelist.
- `repatch.ps1` needs a global `asar`; with only `npx` it writes the shared npm cache. `setup` refuses in that case.
- Large scratch copies (`app.asar.bak` is 5.6 MB) go to `<RunDir>\tmp\`, not `proof\`, so `cleanup` removes them.
