# AGM verification map

This directory is the maintained source for verifying the user-facing behavior of the Antigravity_Mod (AGM) plugin platform. Read this index before driving the client, then use the matching feature file as the recipe.

## Baseline preconditions

- The lab PC is the owner's Windows machine; every path is under `C:\AGM_TestLab\`. Red lines in [`../SKILL.md`](../SKILL.md) apply to every step.
- `$L` means `powershell -NoProfile -ExecutionPolicy Bypass -File .cursor\skills\verify-agm\scripts\agm-lab.ps1` and `$C` means `node .cursor\skills\verify-agm\scripts\agm-cdp.mjs`, both run from the repo root.
- Build the client with `$L -Action setup -RunId <id>` and require `GATE : PASS` in `proof\setup\4_update_lock_gate.txt`.
- Start it with `$L -Action launch -RunId <id>` and require the `READY` line. A fresh run can stay on the first-run onboarding page; see `First-run onboarding` in `../SKILL.md` and report blocked journeys as UNKNOWN.
- Run `$L -Action doctor -RunId <id>` and require `VERDICT: HEALTHY` before each batch of steps.
- Runtime files of the test client: `<RunDir>\app\plugins\config.json` (plugin config), `<RunDir>\app\plugins\state\registry.json` (host settings and installed packages), `<RunDir>\app\plugins\state\logs\*.log`. Renderer console: newest `<RunDir>\proof\electron-*.log`.
- Never drive an instance this run did not start. `agm-cdp.mjs` refuses ports it does not own.

## Driving conventions

- Start every recipe from a healthy launch unless its preconditions say otherwise.
- Prefer `id` and `data-testid` handles. Never click by coordinates.
- Treat every command as literal. Keep quoted selectors and flags unchanged.
- Use `click`, `type` and `key` for user actions. Use `eval` only to read state, never to call plugin internals or set values.
- Persistence is proven with `$L -Action stop -RunId <id>` followed by `$L -Action launch -RunId <id>` (user data is kept), then reading the value back through the UI.
- Do not edit `config.json` or `registry.json` by hand to reach a state. If a precondition is missing, report the journey as FAIL or UNKNOWN with the reason.

## Proof and skip reporting

- Save artifacts with `--out <feature>/<nn>_<what>.<ext>`; they land in `<RunDir>\proof\<feature>\`.
- UI proof is a `text` capture of the relevant container plus a `shot` screenshot.
- Mutation proof includes the file the feature wrote (copy it into the feature's proof folder) and a read-back after restart.
- CLI proof includes the command, stdout, stderr and exit code (`agm-lab.ps1 setup` already writes these for the install chain).
- Report each journey as PASS (artifact paths), FAIL (reason) or UNKNOWN (not run). Never report a journey verified through a different entry point than the one named.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with agm-lab + agm-cdp` (starts with `Preconditions:`, then labeled bullets pairing each user action with an exact command and observable result), and `Gotchas`.

## Features

- [Plugin Center](./plugin-center.md) covers the sidebar entry, Ctrl+Shift+M, the installed list, host settings save and persistence. Proven 2026-11-20 (run `SKILL01`).
- [Hakimi i18n](./i18n.md) covers default zh-CN localization, the config center, enable/disable and hot reload. Not yet proven.
- [AI Side-Dock](./sidedock.md) covers the floating trigger, expand/collapse and its persistence, and the vendor tabs. Not yet proven.
- [Install and update lifecycle](./install-lifecycle.md) covers DryRun, install, repatch, the update lock, exit 3/4 refusals, restore and user-data survival. Setup chain proven 2026-11-20; the rest not yet.
