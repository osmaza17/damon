# CLAUDE.md — Damon (ADE)

Guide for Claude instances working on this repo.

## What this is

Electron desktop app for Windows: an Agentic Development Environment. Teams → agents (left rail), Chrome-style tabs on top, each tab a **real** terminal (ConPTY) running an AI CLI: Claude Code (subscription), Codex (subscription), or open-source models via OpenRouter through the Claude Code harness. Right-side drawer edits the agent's markdown files. Since v0.2 it also embeds the full feature set of the user's Obsidian `claude-code-harness` plugin: account pooling with hot-swap + auto-switch, live usage probes, per-account schedules, session heartbeat/auto-title/persistence/history, model/skill toolbar, token dashboard, conversation export.

## Stack

- Electron (plain JS, **no bundler, no framework**): renderer loads xterm UMD builds straight from `node_modules` via relative paths — keep it that way.
- `@lydell/node-pty` — node-pty fork with **prebuilt N-API binaries** (works in Electron without electron-rebuild / VS Build Tools; chosen deliberately, do not swap back to `node-pty`).
- `@xterm/xterm` + addon-fit, addon-unicode11, addon-webgl in the renderer.
- `electron-builder` (NSIS) for packaging. `token-dashboard/` is `asarUnpack`ed (Python must read real files).

## Files

- `main.js` — main process: window, all IPC (state, settings, photos, repos, agent files, ptys, accounts, skills, clipboard-image, export, dashboard). PTYs spawn `powershell.exe -NoLogo -Command <cli>`; claude ptys get `--session-id <uuid>` / `--resume <uuid>` injected. Every claude pty data chunk feeds `accounts.maybeAutoSwitch/maybeAutoSaveAccount/maybeProbeOnActivity`. Timers: `refreshUsage` 3 min, `enforceSchedule` 20 s.
- `accounts.js` — `AccountManager`, a faithful port of the plugin's `accounts.ts` (1.3k lines: snapshot/switch/save/delete accounts, OAuth refresh, usage probe via rate-limit headers, auto-switch engine with 90% hard ceiling + 95% weekly destination cap, schedules with hard-stop, browser-per-account launch). Constructor takes `{ getSettings, saveSettings, notify, onUpdate, interruptBusy, shellOpenExternal }`. **`saveSettings()` is called with no args** — it persists the same live object `getSettings()` returns; `main.js` therefore keeps ONE settings object in memory.
- `constants.js` — all tuning knobs/regexes/catalogues (usage regex, LIMIT_STOP_RE, prompt-detection regexes, OAuth endpoints, browser catalog, ANSI palettes). The prompt/limit regexes are **duplicated in `renderer/app.js`** (the renderer scans the xterm buffer directly) — keep both copies in sync.
- `preload.js` — contextBridge API (`window.damon`), contextIsolation on. Includes `getPathForFile` (webUtils) for drag&drop.
- `renderer/style.css` — **exact Obsidian aesthetic**: the Border theme's `.theme-dark` variables resolved with the user's accent `#5879fd` (h=228) hardcoded as plain hex/rgba in `:root` (don't replace with the theme's calc() cascade — xterm can't parse hsl+calc), plus the plugin's component styles ported rule-by-rule. UI font = JetBrains Mono. The terminal theme is built at runtime by `termTheme()` in app.js reading those variables (plugin architecture); ANSI palette duplicated there.
- `templates.js` — agent markdown templates (Hermes-style: CLAUDE.md/agent.md/user.md/memory.md).
- `renderer/` — `index.html`, `style.css` (Notion/Obsidian dark aesthetic), `app.js` (all UI: tabs with heartbeat states, auto-title, pin/drag, session persistence + closed-session history, toolbar, account popup, auto-switch menu, settings dialog; `MODELS` catalog at top holds OpenRouter ids, `CLAUDE_MODELS` the /model ids).
- `token-dashboard/` — bundled Python token-stats app (stdlib HTTP server, port 8080), copied verbatim from the plugin; launched via `dashboard:launch`.
- `test/e2e.js` — Playwright `_electron` end-to-end (isolated state via env vars below): onboarding → Claude boot → toolbar menus → history → settings → zoom.

## Commands

- Run: `npm start` (or `Launch Damon.bat`)
- Smoke: `npx electron . --smoke` (prints `SMOKE_OK`, auto-quits)
- E2E: `node test/e2e.js` (real window, walks the whole UI; needs `claude` CLI installed; prints `E2E OK`)
- Installer: `npm run dist` → `dist/ADE Setup <v>.exe`

## Conventions and non-obvious decisions

- **Env overrides for testing**: `DAMON_USER_DATA` (state/settings/photos) and `DAMON_ADE_HOME` (agent repos). E2E uses them — but **accounts always read the real `~/.claude`** (that's the point of the pool); e2e only does read-only account ops.
- Harness settings live in `state.json` under `settings.harness`, merged over `DEFAULT_SETTINGS` at boot.
- Session heartbeat (renderer): busy = pty output with a 1200 ms quiet-gap timer, ignoring echo <600 ms after a keystroke; after quiet, the **visible xterm buffer** is scanned with `looksLikePrompt()` → red "awaiting input"; `LIMIT_STOP_RE` latches red until the user types. Same tuning as the plugin — don't "simplify" the guards, each exists for a false-positive.
- Auto-title precedence: manual(3) > OSC(2) > first-prompt(1) > model name(0).
- Open tabs persist in `settings.openSessions` (debounced 1.5 s); restored **lazily per agent on first visit**, and each restored tab only spawns its CLI when shown (restoring into a hidden terminal garbles the TUI). Closed sessions stack: `settings.closedSessions`, max 25, Ctrl+Shift+Y / History button reopen with `--resume`.
- Startup command injection waits a fixed 1800 ms (the CLI eats earlier input), 350 ms before each Enter — plugin-verified timings.
- Model switch = `\x15/model <id>\r` + auto-confirm watcher (6 s window, answers the "Switch model?" prompt).
- Account snapshots under `~/.claude/cch-accounts/` hold OAuth tokens — **never commit, never log**. `switchToAccount` reads/validates everything before writing, writes atomically, and never snapshots empty tokens. Never refresh the ACTIVE account's token (claude rotates it itself).
- Agent repos live under `~/.ade/<slug>`; file-drawer IPC (`files:*`) and export are restricted to paths inside `ADE_HOME`.
- OpenRouter runs open-source models by pointing Claude Code at `ANTHROPIC_BASE_URL=https://openrouter.ai/api`. **Unverified end to end** (no funded key); model ids in `renderer/app.js` may drift.
- Codex tabs get no session-id/resume/auto-switch plumbing (different CLI); still unverified (CLI not installed here).
- Export = the **floating bottom-right fab** (last message / whole conversation → `.md` in the agent repo), not a toolbar menu — plugin layout.
- Remote control: per-tab toggle (📱 / Ctrl+R). Ctrl+R is intercepted in the xterm key handler but **handled at the document level** (returning false in the handler still lets the event propagate — calling it in both places would double-toggle, same pattern as Ctrl+T/W).
- `Menu.setApplicationMenu(null)` in main is load-bearing: the default menu's hidden accelerators make Ctrl+R reload the renderer over live sessions and Ctrl+W close the window.
- Skipped from the plugin (Obsidian-specific, documented): send-active-note/@-wikilinks, `[[` picker, clickable note links, export-to-vault (export goes to the agent repo instead), per-button visibility settings, light theme.
- `package.json` `build.files` lists app sources; electron-builder adds production `node_modules` automatically — don't add `node_modules/**`.
