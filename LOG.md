# LOG

Newest first.

## 2026-07-10 — Fix: el botón Cancel de los diálogos no cerraba

En los diálogos New team / New agent / Settings, Cancel no hacía nada si había un campo `required` vacío ("Completa este campo"). Causa raíz: en un `<form method="dialog">` cualquier `<button>` es submit y dispara la validación HTML antes de cerrar. Fix: `formnovalidate` en los tres botones de cancelar. Verificado con Playwright (abre el diálogo con el nombre vacío, Cancel lo cierra).

## 2026-07-10 — v0.3.0: exact Obsidian (Border theme) aesthetic + feature-parity pass with the plugin

**Aesthetic rebuilt to match the user's real Obsidian**: the previous approximated "Notion/Obsidian" palette was replaced by the **Border theme's `.theme-dark` variables resolved with the user's accent `#5879fd`** (h=228; values precomputed into `renderer/style.css` because xterm/CSS don't need the theme's calc() cascade) + **JetBrains Mono** as UI font (the user's `interfaceFontFamily`). All component styles (tab chips with rounded tops and state-colored borders, blink keyframes, toolbar buttons, account rows, history sidebar, day-schedule rows) are ported rule-by-rule from the plugin's `styles.css`. The terminal theme is now built like the plugin's `termTheme()`: surfaces read from the CSS variables at runtime + the plugin's ANSI palette.

**Structural changes for parity:**
- Header is now **two rows like the plugin**: tab strip on top (tabs sit flush, equal-width, compress together, pinned = 30px dot-only), toolbar below.
- **Floating export fab (bottom-right)** replaces the toolbar Export menu: two buttons = save Claude's **last message** / the **whole conversation** as `.md` into the agent repo (the plugin's missing "copiar último mensaje / conversación" buttons; in Obsidian they create a vault note, here the destination is the agent repo).
- **History drawer** is now the plugin's ChatGPT-style **left slide-in overlay** (dimmed backdrop, Escape/backdrop closes).
- **Tab heartbeat** now colors the whole tab border + background tint (not just the dot); await blinks only when the tab is NOT active (pure CSS, same specificity trick as the plugin).
- **Account popup**: ✓ green check on the active account, **blocked** accounts (excluded from auto-switch) get the red left-accent + strikethrough and are **inert** (click shows a toast), **capped** destinations (5h ≥90% / 7d ≥95% / schedule-blocked / expired) get the red highlight but stay clickable — mirrors `cch-acct-blocked`/`cch-acct-capped`.

**Features added in the parity audit** (previously missing vs the plugin):
- **Remote control toggle** (📱 button + **Ctrl+R**): ON sends `/remote-control` (URL shows in Claude's own panel); OFF re-runs it and walks the menu (Up×2+Enter, DECCKM-aware `\x1bOA`). Per-tab state, reset on exit/reload/restart.
- **Copy/paste parity**: Ctrl+C copies when there is a selection (SIGINT otherwise), Ctrl+Shift+C copies, Ctrl+Shift+V pastes plain text, **right-click** copies selection / pastes; **Ctrl+0** resets zoom.
- **"Open skills folder"** item in the skills menu (new `skills:open-folder` IPC).
- **Enabling auto-switch fires an immediate `refreshUsage({refreshTokens:true})`** (plugin behavior: warm all accounts instead of waiting for the 3-min tick).
- **Application menu removed** (`Menu.setApplicationMenu(null)`): the hidden default accelerators hijacked Ctrl+R (window reload over live sessions!) and Ctrl+W.

**Fix: crash "Object has been destroyed" al cerrar la app (segunda variante).** El guard de v0.2.0 cubría `send()`, pero el callback `notify` del AccountManager llamaba `win.isFocused()` directamente; un chunk de pty en vuelo tras destruir la ventana (vía `maybeAutoSwitch` → `notify`) crasheaba el main process. Fix: guard `!win.isDestroyed()` también ahí (main.js). Verificado con el e2e (cierra con Claude vivo).

**Not ported (Obsidian-specific, no equivalent in a standalone app):** send-active-note/@ button, `[[` wikilink picker, clickable note links in the terminal, export-to-vault-root (goes to the agent repo), Obsidian command-palette entries (toolbar/hotkeys instead), per-button visibility toggles in settings, light theme (Damon is dark-only), Node.js path setting (no pty-host fork).

Verified: `--smoke` OK, full Playwright e2e OK (+2 asserts: export fab, remote button), 4 screenshots reviewed (session, account popup with live accounts/colored usage/capped rows, history drawer, settings).

## 2026-07-10 — v0.2.0: full port of the claude-code-harness Obsidian plugin + Notion/Obsidian restyle

Ported **all** features of the user's Obsidian plugin (`claude-code-harness`) into Damon, per request ("exactamente igual"), and restyled the whole UI to a Notion/Obsidian dark aesthetic.

**New in this version (all verified by the extended Playwright e2e + live screenshots):**
- **Account pooling** (`accounts.js`, faithful 1.3k-line port of the plugin's `accounts.ts`, done by an Opus subagent and smoke-tested read-only against the real `~/.claude`): snapshot/switch/save/delete accounts with atomic writes and hot-swap (no restart), OAuth keep-alive refresh (never the active account), live 5h/7d usage probe via Anthropic rate-limit headers, auto-switch engine (threshold/rotate modes, 90% hard ceiling, 95% weekly destination cap, cooldowns, swap verification, auth-fail recovery), per-account forbidden time windows with hard-stop interrupt, browser-per-account login launch.
- **Session core** (renderer): deterministic `--session-id`/`--resume`, heartbeat tab dots (idle/busy/awaiting-input/limit/exited with the plugin's exact false-positive guards), auto-titles (OSC > first prompt, manual wins), pin + drag-reorder + context menu, open-session persistence with lazy per-agent restore, closed-session history (25, Ctrl+Shift+Y + History drawer), reload-with-conversation vs restart-fresh.
- **Toolbar**: /model switcher with auto-confirm, skills menu (~/.claude/skills), account popup with colored usage, auto-switch menu with presets + diagnose, token-dashboard launcher (bundled Python app verified listening on :8080), conversation export (last reply / full .jsonl parse) into the agent repo, zoom, settings dialog (args, startup commands, probe toggle, python path, per-account schedule + browser).
- **Terminal niceties**: clipboard-image paste as `@path` (temp PNG, swept after 24h), drag&drop @-mention (webUtils), Ctrl/Shift+Enter newline, Ctrl+Z/Ctrl+Shift+Z, Ctrl+wheel zoom, unicode11 + WebGL addons.
- **Aesthetic**: Notion/Obsidian dark (#1e1e1e surfaces, soft borders, 6px radii, Obsidian-purple accent, quiet hovers) + matching xterm ANSI palette.

**Architecture:** account/usage/schedule/dashboard/export logic lives in the **main process** (fs/https/child_process), exposed over IPC; the renderer builds all popups from `accountsSnapshot()` and receives push updates. Claude pty output feeds the auto-switch scanner in main; the heartbeat scans the xterm buffer in the renderer (regexes deliberately duplicated, documented in CLAUDE.md). Key subtlety: `AccountManager.saveSettings()` persists in place, so main keeps a single live settings object.

**Skipped (Obsidian-specific, documented in CLAUDE.md):** send-active-note/wikilinks, export-to-vault (goes to the agent repo instead), remote-control toggle.

## 2026-07-10 — Fix: crash "Object has been destroyed" al cerrar la app

Al cerrar la ventana con sesiones abiertas saltaba un diálogo de error del main process. Causa raíz: los PTY siguen emitiendo datos un instante después de destruirse la BrowserWindow, y los callbacks `onData`/`onExit` llamaban a `win.webContents.send()` sobre la ventana destruida. Fix: helper `send()` compartido que comprueba `!win.isDestroyed()` antes de enviar (main.js). Verificado con el e2e (cierra la app con un Claude vivo, que es justo la ruta del crash).

## 2026-07-10 — v0.1.0: full build in one session

Recreated the "Damon" ADE from the YouTube walkthrough, adapted to Windows, built from scratch (decision: not cloning Superset — uncertain which repo it is, and a fresh Electron app avoids auditing a macOS-oriented codebase).

**Built and verified end to end (Playwright `_electron` + screenshots):**
- Onboarding: blank screen → create team (photo optional) → create agent → Claude Code boots in a real embedded terminal asking to trust the agent's folder.
- Teams/agents left rail with avatars; Chrome-style tabs; Ctrl+T (new tab), Ctrl+I (rename in place), Ctrl+W (close).
- Agent workspaces under `~/.ade`: new empty repo (`git init`) or clone by URL. Hermes-style agent files written on creation (CLAUDE.md, agent.md, user.md, memory.md) — memory updates are instruction-driven via the agent's CLAUDE.md.
- Model picker (6 entries) and file drawer with in-place editing.
- NSIS installer via electron-builder (`dist/ADE Setup 0.1.0.exe`, 97 MB); packaged app smoke-tested OK (asar includes xterm; conpty binaries auto-unpacked).

**Plumbing ready but NOT tested end to end (no credentials available):**
- Codex tab (spawns `codex`; CLI not installed on this machine).
- OpenRouter open-source models (Kimi K2, MiniMax, GLM, custom id) via Claude Code harness + `ANTHROPIC_BASE_URL`; needs an OpenRouter key with credits. Model ids may drift.

**Key technical decisions:**
- `@lydell/node-pty` instead of `node-pty`: prebuilt **N-API** binaries → no Visual Studio Build Tools, no electron-rebuild, works in packaged app. Verified by inspecting the binary (`napi_register_module`) and by live sessions.
- No bundler/framework: renderer uses xterm UMD builds from `node_modules` directly.
- OpenRouter key stored encrypted with Electron `safeStorage` (DPAPI).
- Env overrides `DAMON_USER_DATA` / `DAMON_ADE_HOME` added for isolated e2e testing.

**Fixed during build:**
- electron-builder first run failed (exit 127): the background command inherited the scratchpad cwd, so npm found no package.json. Root cause: shell cwd persistence between calls; fix: run from the project dir.

**Pending / ideas:**
- Delete/edit UI for teams and agents.
- Persist tab layout across restarts.
- App icon (default Electron icon used).
- Verify OpenRouter path with a funded key; confirm current model ids.
- Code signing for the installer.
