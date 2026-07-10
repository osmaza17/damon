# LOG

Newest first.

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
