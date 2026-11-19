# Plugin Center

The Plugin Center (插件中心) is the AGM host's management page. It opens in place of the main panel from a sidebar entry or Ctrl+Shift+M, lists built-in and sandboxed plugins, shows the local plugin repository, and saves host settings to `plugins\state\registry.json`.

## Sub-features

- `pc-open-sidebar` opens the hub from the sidebar entry `插件中心`.
- `pc-open-hotkey` toggles the hub with Ctrl+Shift+M and remembers the last tab.
- `pc-close-esc` closes the hub with Escape from a list-level tab.
- `pc-installed-list` lists installed plugins with state toggles.
- `pc-repository` lists packages from the local `plugins\repo\` source.
- `pc-settings-save` saves host settings with a confirmation message.
- `pc-settings-persist` keeps saved settings across a client restart.
- `pc-plugin-detail` opens one plugin's detail view (overview, permissions, logs).

## How to get to it (user POV)

- Choose `插件中心` in the left sidebar.
- Press Ctrl+Shift+M anywhere in the client.
- Choose the floating `🧩 插件中心` pill (only when the setting `显示右下角悬浮入口` is on; off by default).

## Driving it with agm-lab + agm-cdp

Preconditions:

- `$L -Action doctor -RunId <id>` reports `VERDICT: HEALTHY`.
- The hub is closed: `$C eval --run <id> --expr "document.documentElement.getAttribute('data-agm-hub')"` prints `null`.

- **Sidebar entry.** Choose `插件中心`. Run `$C click --run <id> --selector '#agm-nav-hub'` and `$C wait --run <id> --selector '#agm-hub [data-testid=tab-installed]'`. `<html>` gets `data-agm-hub="open"` and the header reads `插件中心` and `HakimiPluginHost v2.1.0`.
- **Installed list.** Read the list. Run `$C text --run <id> --selector '#agm-hub' --out plugin-center/01_installed.txt` and `$C shot --run <id> --out plugin-center/01_installed.png`. The text lists `AI Side-Dock Three-Titan` and `Hakimi i18n Deep Localization Engine` under `内置插件`; cards `[data-testid=plugin-card-ai-sidedock]` and `[data-testid=plugin-card-hakimi-i18n]` exist, each with a `btn-toggle-<id>` switch.
- **Repository tab.** Choose `插件仓库`. Run `$C click --run <id> --selector '[data-testid=tab-repository]'`. The banner `[data-testid=remote-repo-banner]` says the remote repository is not connected, and `#agm-repo-card-list` lists `agm-hello-guard`.
- **Settings save.** Choose `设置`, set `日志显示行数` to 321, and choose `保存设置`. Run `$C click --run <id> --selector '[data-testid=tab-settings]'`, `$C type --run <id> --selector '[data-testid=setting-log-retention]' --text 321`, `$C click --run <id> --selector '[data-testid=btn-save-settings]'`, then `$C text --run <id> --selector '[data-testid=settings-feedback]' --out plugin-center/02_settings_feedback.txt` and `$C shot --run <id> --out plugin-center/02_settings_saved.png`. The feedback reads `宿主设置已保存至 plugins\state\registry.json`.
- **Side effect.** Copy the written file. Run `Copy-Item C:\AGM_TestLab\VERIFY_<id>\app\plugins\state\registry.json C:\AGM_TestLab\VERIFY_<id>\proof\plugin-center\03_registry_after_save.json`. Its `settings.logRetentionLines` is `321`.
- **Escape closes.** Press Escape. Run `$C key --run <id> --key Escape`. `data-agm-hub` is gone (`null`).
- **Hotkey toggles.** Press Ctrl+Shift+M twice. Run `$C key --run <id> --key M --mods ctrl,shift` and read `data-agm-hub` (`open`, selected tab still `设置`), then the same key again (`null`).
- **Persistence.** Restart and read the value back. Run `$L -Action stop -RunId <id>`, `$L -Action launch -RunId <id>`, `$C click --run <id> --selector '#agm-nav-hub'`, `$C click --run <id> --selector '[data-testid=tab-settings]'`, `$C eval --run <id> --expr "document.querySelector('[data-testid=setting-log-retention]').value"` and `$C shot --run <id> --out plugin-center/04_after_restart.png`. The value is `321`.

## Gotchas

- Proven on 2026-11-20 (run `SKILL01`, Antigravity 2.32.1 base, on a warm relaunch after the first launch had quit): sidebar entry, installed list, settings save with `registry.json` side effect, Escape, Ctrl+Shift+M toggle, and persistence across restart. Repository tab, plugin detail view, plugin toggles and the floating pill are UNKNOWN until a run records proof. A second fresh run (`SKILL02`) never got past onboarding, so a repeat of this proof from a clean data dir is also UNKNOWN.
- On a fresh data dir `agm-hello-guard` already shows as installed and disabled (`registry.json` `plugins.agm-hello-guard.enabled=false`). Do not assume an empty installed list.
- Escape from a list-level tab (including `设置`) closes the whole hub; from a detail view it goes back one level.
- `type` replaces the field with Ctrl+A then text; the value is not saved until `保存设置` is clicked.
- Toggling a plugin or `热重载全部` re-injects plugins and resets renderer state; re-run `doctor` and reopen the hub afterwards.
- The pill `#agm-plugin-center-trigger` exists in the DOM but is hidden (`display:none`) unless `showTriggerPill` is on; `click` fails on it by design.
