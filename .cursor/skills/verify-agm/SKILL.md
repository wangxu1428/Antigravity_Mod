---
name: verify-agm
description: Drive a real, isolated Antigravity_Mod (AGM plugin platform) client on Windows and prove behavior with evidence. Use when you need to verify the Plugin Center, Hakimi i18n, AI Side-Dock, or the install/repatch/update-lock scripts end to end, or before reporting any AGM test result as PASS. Runs only inside C:\AGM_TestLab.
---

# Verify AGM (Antigravity_Mod)

AGM patches a copy of the Antigravity IDE (Electron) and injects a plugin host plus built-in plugins into its renderer. The user-facing surfaces are the patched client's UI (Plugin Center, i18n, Side-Dock) and the PowerShell install/update/restore scripts. This skill builds a throwaway patched client under `C:\AGM_TestLab\VERIFY_<RunId>\`, drives it over the Chrome DevTools Protocol (CDP), and keeps the evidence.

Feature recipes live in [`features/`](features/README.md). Read the index before driving.

## Red lines (squad rules v1, never cross)

- Work only under `C:\AGM_TestLab\`. Never write to `D:\AI_Studio\Apps\Antigravity\` (the production IDE), `%USERPROFILE%\.gemini\`, shared caches (npm cache, etc.) or global config. Never read or scan any `02_Personal\` directory.
- Never end D-drive processes. Never kill by process name, never use `taskkill /T` or any unscoped kill. Stop only the PID this run started and processes whose executable is under this run's `app\`. `agm-lab.ps1 -Action stop` does exactly that.
- Never run the production `repatch.ps1`, never run an updater or installer against anything but `<RunDir>\app`, never restore a quarantined installer. The only `repatch.ps1` you run is `<RunDir>\app\mod_kit\repatch.ps1 -TargetAppDir <RunDir>\app`.
- The production IDE listens on CDP port 9223. Never attach to it. `agm-cdp.mjs` refuses any port whose listener is not this run's PID.
- No proof, no PASS. A journey you did not run with evidence is `UNKNOWN`, never `PASS`. A journey that ran and missed its end state is `FAIL`, with the reason.
- Never commit proof, `app.asar`, EXE, `UserData`, logs or tokens to git. Proof stays on the PC under `<RunDir>\proof\`.

## Requirements

- Windows PowerShell 5.1, Node.js >= 22 (global `fetch` and `WebSocket`; the lab PC has v26), and a global `asar` on `PATH` (setup refuses the `npx asar` fallback because it writes the shared npm cache).
- A repo checkout under `C:\AGM_TestLab\` (the lab PC has no git: copy or unzip the tree, e.g. to `<RunDir>\repo`). Commands below run from the repo root.
- An official clean client base under `C:\AGM_TestLab\` whose `resources\app.asar` SHA256 is in the whitelist (2.32.1 = `5B493943…519F`). Default `-BaseDir`: `C:\AGM_TestLab\IPC_SEC_A02\bases\2.32.1` (about 600 MB, verified official). If it is gone, stop and report; do not copy from D:.

## Helpers

Both live in `.cursor\skills\verify-agm\scripts\` and are run from the repo root. The feature map writes them as `$L` and `$C`; expand them literally:

- `$L` = `powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1`
- `$C` = `node .cursor\skills\verify-agm\scripts\agm-cdp.mjs`

| `agm-lab.ps1 -Action` | What it does |
| --- | --- |
| `setup` | Copies `-BaseDir` to `<RunDir>\app` (no `UserData`, runtime state removed), runs `install-or-update.ps1 -DryRun`, then `-SkipRepatch`, then the copy's `repatch.ps1`, then the update-lock gate. Transcripts go to `proof\setup\`. Exit 2 when the gate fails. |
| `launch` | Starts `<RunDir>\app\Antigravity.exe` with `--user-data-dir=<RunDir>\userdata`, `--remote-debugging-port=<Port>` (default 9341), `--enable-logging=file --log-file=proof\electron-<ts>.log`, and `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `HOME`, `TEMP`, `TMP` redirected into `<RunDir>\env\`. Refuses if the gate is not PASS, the port is busy or 9223, or this run already has processes. Returns when ready. |
| `doctor` | Read-only. Prints gate, asar hash vs setup, PID and exe path, port owner, CDP browser version, DOM probe, env redirect, production-IDE guard, then `VERDICT: HEALTHY` (exit 0) or `NOT HEALTHY` (exit 1). |
| `stop` | `CloseMainWindow` on our PID (then `Stop-Process -Id` after 10 s), then stops leftover processes under `<RunDir>\app\` by PID, copies `userdata\logs\*` into `proof\userdata-logs-<ts>\`. Keeps user data, so a later `launch` tests persistence. |
| `cleanup` | `stop`, then deletes `app`, `userdata`, `env`, `tmp`. Keeps `proof\` and writes `proof\MANIFEST.txt` (SHA256 of every artifact). |

| `agm-cdp.mjs` command | What it does |
| --- | --- |
| `eval --expr <js>` | Evaluates in the workbench page (`https://127.0.0.1:<dynamic>/`), prints the value. Read-only probes only; never call app internals to change state. |
| `wait --selector <css> [--gone] [--timeout ms]` | Waits until the element is visible (or gone). Exit 1 on timeout. |
| `click --selector <css>` | Real mouse press/release at the element's center (`Input.dispatchMouseEvent`). |
| `type --selector <css> --text <t>` | Clicks the field, Ctrl+A, inserts text like a keyboard. |
| `key --key <F5\|Escape\|Enter\|A-Z> [--mods ctrl,shift,alt]` | Real key press. |
| `text --selector <css> [--out <rel>]` | `innerText` of the element; with `--out`, saved under `proof\`. |
| `shot --out <rel.png>` | Page screenshot saved under `proof\`. |
| `targets` | Lists CDP targets. |

## Launch

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1 -Action setup  -RunId <id>   # ~10 s; gate PASS required
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1 -Action launch -RunId <id>   # prints READY when usable
```

Ready means usable: CDP answers and the Plugin Center sidebar entry `#agm-nav-hub` is visible in the workbench page. If launch prints NOT READY it also prints the workbench page URL; run `doctor` next.

### First-run onboarding (UNKNOWN, read before launching a fresh run)

Observed on 2026-11-20 with a fresh `userdata`: the client opens `https://127.0.0.1:<port>/onboarding` ("让我们为你定制体验。哪一项最符合你的工作？" with role buttons and `跳过`), never shows `#agm-nav-hub`, and twice quit on its own (clean shutdown, exit code 0) about 2-3 minutes after launch. In one run (`SKILL01`) the next `launch` on the same user data went straight to the workbench and was READY in about 13 s; in another (`SKILL02`) the relaunch stayed on onboarding for 240 s.

There is no proven way past onboarding yet. Choosing `跳过` is probably the user path, but the onboarding answers may be stored on the signed-in account (see below), so do not click it without the owner's OK. Until a run proves a recipe, a fresh run that stays on onboarding is reported as `UNKNOWN (blocked by first-run onboarding)`, not FAIL of the feature under test.

Teardown is `stop` (keep data) or `cleanup` (remove everything but proof).

## Doctor

Run `$L -Action doctor -RunId <id>` first whenever anything looks off and before trusting any result. Drive only on `VERDICT: HEALTHY`. If `pid` says NOT RUNNING, the client quit; read the newest `proof\electron-*.log`, run `stop` to collect leftovers and logs, then `launch` again.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow its `Driving it with agm-lab + agm-cdp` section literally. Use stable handles: `id`s (`#agm-nav-hub`, `#hakimi-sidedock-trigger`) and `data-testid`s (`[data-testid=tab-settings]`). Never use coordinates. Example (Plugin Center, proven 2026-11-20 in run `SKILL01`):

```powershell
node .cursor\skills\verify-agm\scripts\agm-cdp.mjs click --run <id> --selector '#agm-nav-hub'
node .cursor\skills\verify-agm\scripts\agm-cdp.mjs wait  --run <id> --selector '#agm-hub [data-testid=tab-installed]'
node .cursor\skills\verify-agm\scripts\agm-cdp.mjs text  --run <id> --selector '#agm-hub' --out plugin-center/01_installed.txt
```

## Evidence

- Everything goes to `C:\AGM_TestLab\VERIFY_<id>\proof\`: `setup\` transcripts and gate, `launch-*.txt` (exact command and PID), `electron-*.log` (renderer console incl. `[HakimiPluginHost]` and `[Hakimi i18n]` lines), `stop-*.txt` (what was stopped plus the production-IDE guard), `userdata-logs-*\` (main.log, language_server.log), one folder per feature, and `MANIFEST.txt` after cleanup.
- Exercise the real user path: clicks and keys through `agm-cdp.mjs`, not `eval` calls into plugin internals and not hand-edits of `config.json`. Capture the action and the resulting state (text and screenshot), not just the last screen.
- Verify side effects alongside the UI: the file the feature writes (`app\plugins\state\registry.json`, `app\plugins\config.json`), log lines, and persistence across `stop` + `launch`.
- Every `stop` records `guard: prod PIDs before/now missing=[...]` and `prod file metadata unchanged=True`. A missing production PID or changed metadata invalidates the run; report it.
- Report each journey as PASS (with artifact paths), FAIL (with the reason) or UNKNOWN (not run).

## Cleanup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1 -Action cleanup -RunId <id>
Get-Content C:\AGM_TestLab\VERIFY_<id>\proof\MANIFEST.txt   # proof must still be listed
```

Run cleanup after every failed attempt too. If you unzipped a repo copy under the run dir, delete it yourself when done; keep `proof\`.

## Isolation and known limits

- Runs can coexist: each has its own run dir, user-data dir, env dir and CDP port (`-Port`). Never point two runs at the same `-RunId`.
- `USERPROFILE` redirection keeps the client's `.gemini\antigravity` under `<RunDir>\env\UserProfile\`, and a language-server sidecar (`Antigravity.exe --import=…sidecar_sdk…`) runs from `<RunDir>\app`; `stop` reaps it by PID because the client's own reaper may not.
- The test client came up signed in (`auth_startup_result outcome=signed_in`) although its profile is redirected. Auth is therefore stored somewhere outside the redirected dirs (likely Windows Credential Manager, shared with the production IDE). Do not sign in or out, and do not drive account or model features from a test client.
- The test client greets the real account by name on the onboarding page, which confirms it is signed in with the owner's account. Treat anything it does that talks to the account as outside the test sandbox.
- Observed 2026-11-20: clients quit on their own (clean shutdown in `main.log`, exit 0) one to three minutes after launch in three of five launches, including one warm relaunch. Only the onboarding case above is partly explained. Run `doctor` before every batch of drive steps, and relaunch if needed.

## Proof status (2026-11-20)

| Step | Status | Evidence on the lab PC |
| --- | --- | --- |
| `setup` (DryRun, -SkipRepatch, test-copy repatch, gate) | PASS twice (`SKILL01`, `SKILL02`) | `C:\AGM_TestLab\VERIFY_SKILL0{1,2}\proof\setup\` |
| `launch` to READY | PASS on a warm relaunch (`SKILL01`); not reached in `SKILL02` (onboarding) | `proof\launch-*.txt`, `proof\electron-*.log` |
| `doctor` | PASS (`VERDICT: HEALTHY`, `SKILL01`) | console only |
| Drive Plugin Center | PASS (`SKILL01`) | `VERIFY_SKILL01\proof\plugin-center\` |
| `stop` / `cleanup`, proof kept after cleanup | PASS (both runs; production PIDs 13 -> 13, metadata unchanged) | `proof\stop-*.txt`, `proof\MANIFEST.txt` |
| NOT READY page-URL / onboarding hint in `launch` | UNKNOWN (added after the last run) | none |
| First-run onboarding recipe | UNKNOWN | none |
| i18n, Side-Dock, install exit 3/4, repeat repatch, restore, user-data survival | UNKNOWN | none |
