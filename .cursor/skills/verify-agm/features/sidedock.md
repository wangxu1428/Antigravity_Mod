# AI Side-Dock

AI Side-Dock (AI挂件) adds a floating `🐾 AI挂件` trigger at the right edge. Choosing it expands a side panel that splits the window and hosts Gemini, ChatGPT and Grok in tabs (each a `<webview>` of the vendor site). Collapsed state, active tab and width are saved in `plugins\config.json` under `sidedock`.

## Sub-features

- `dock-trigger` shows the trigger while the panel is collapsed.
- `dock-expand` expands the panel from the trigger.
- `dock-collapse` collapses it again from the panel header.
- `dock-persist` keeps collapsed state, active tab and width across restart.
- `dock-tabs` switches between `gemini`, `gpt` and `grok`.
- `dock-resize` changes the panel width by dragging `#hakimi-sidedock-resizer`.
- `dock-plugin-toggle` disables or enables the plugin from its Plugin Center card.

## How to get to it (user POV)

- Choose `🐾 AI挂件` at the right edge of the client.
- In the Plugin Center, use the switch on the `AI Side-Dock Three-Titan` card to disable or enable the plugin.

## Driving it with agm-lab + agm-cdp

Preconditions:

- `$L -Action doctor -RunId <id>` reports `VERDICT: HEALTHY` and its DOM probe shows `"dock":true`.
- `<RunDir>\app\plugins\config.json` has `sidedock.collapsed=true` (the default; observed root class `collapsed`).

- **Trigger visible.** Read the trigger. Run `$C text --run <id> --selector '#hakimi-sidedock-trigger'`. It prints `🐾` and `AI挂件` (observed 32x84 at the right edge).
- **Expand.** Choose the trigger. Run `$C click --run <id> --selector '#hakimi-sidedock-trigger'` and `$C wait --run <id> --selector '#hakimi-sidedock-panel'`. `$C eval --run <id> --expr "document.getElementById('hakimi-sidedock-root').className"` no longer contains `collapsed`, and `config.json` has `sidedock.collapsed=false`.
- **Header inventory.** The header controls are not mapped yet. Run `$C eval --run <id> --expr "document.getElementById('hakimi-sidedock-header').outerHTML" ` and add the tab and collapse selectors you find to this file before driving them.
- **Collapse.** Choose the collapse control from the header inventory. The root regains `collapsed` and `config.json` has `sidedock.collapsed=true`.
- **Persistence.** Expand, then restart with `$L -Action stop -RunId <id>` and `$L -Action launch -RunId <id>`. The root comes back without `collapsed`.
- **Proof.** Run `$C shot --run <id> --out sidedock/01_expanded.png`, `$C text --run <id> --selector '#hakimi-sidedock-header' --out sidedock/01_header.txt` and `Copy-Item C:\AGM_TestLab\VERIFY_<id>\app\plugins\config.json C:\AGM_TestLab\VERIFY_<id>\proof\sidedock\01_config.json`.

## Gotchas

- Everything here except the trigger's presence and the default `collapsed` class (observed 2026-11-20) is UNKNOWN until a run records proof.
- The tabs load third-party sites in webviews. They need network and the vendor's own login, which a test client must not perform. Prove tab switching by the active tab state and `sidedock.activeTab`, not by vendor page content.
- The webviews keep their own sessions under the test user-data dir; `cleanup` deletes them.
- Expanding the dock squeezes the main panel; screenshots of other features taken while it is open look different. Collapse it before driving another recipe.
- The Plugin Center switch `[data-testid=btn-toggle-ai-sidedock]` disables the whole plugin (trigger disappears); it is not the collapse control.
