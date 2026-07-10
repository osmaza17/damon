# CLAUDE.md — Damon (ADE)

Guide for Claude instances working on this repo.

## What this is

Electron desktop app for Windows: an Agentic Development Environment. Teams → agents (left rail), Chrome-style tabs on top, each tab a **real** terminal (ConPTY) running an AI CLI: Claude Code (subscription), Codex (subscription), or open-source models via OpenRouter through the Claude Code harness. Right-side drawer edits the agent's markdown files.

## Stack

- Electron (plain JS, **no bundler, no framework**): renderer loads xterm UMD builds straight from `node_modules` via relative paths — keep it that way.
- `@lydell/node-pty` — node-pty fork with **prebuilt N-API binaries** (works in Electron without electron-rebuild / VS Build Tools; this was chosen deliberately, do not swap back to `node-pty`).
- `@xterm/xterm` + `@xterm/addon-fit` in the renderer.
- `electron-builder` (NSIS) for packaging.

## Files

- `main.js` — main process: window, all IPC (state, photos, repos, agent files, ptys), OpenRouter key via `safeStorage`. PTYs spawn `powershell.exe -NoLogo -Command <cli>`.
- `preload.js` — contextBridge API (`window.damon`), contextIsolation on.
- `templates.js` — agent markdown templates (Hermes-style: CLAUDE.md/agent.md/user.md/memory.md).
- `renderer/` — `index.html`, `style.css` (dark only, no emojis), `app.js` (all UI logic; `MODELS` catalog at top holds OpenRouter model ids).
- `test/e2e.js` — Playwright `_electron` end-to-end smoke (isolated state via env vars below).

## Commands

- Run: `npm start`
- Smoke: `npx electron . --smoke` (prints `SMOKE_OK`, auto-quits)
- E2E: `node test/e2e.js` (launches real window, walks onboarding → Claude session; needs `claude` CLI installed)
- Installer: `npm run dist` → `dist/ADE Setup <v>.exe`

## Conventions and non-obvious decisions

- **Env overrides for testing**: `DAMON_USER_DATA` (state/photos dir) and `DAMON_ADE_HOME` (agent repos dir). E2E uses them to avoid touching real data.
- Agent repos live under `~/.ade/<slug>`; "new empty repo" = `git init` (the video's git-worktree detail was skipped — worktree of nothing makes no sense for an empty repo).
- File-drawer IPC (`files:*`) is restricted to paths inside `ADE_HOME`.
- OpenRouter runs open-source models by pointing Claude Code at `ANTHROPIC_BASE_URL=https://openrouter.ai/api` with the OpenRouter key as auth token and `ANTHROPIC_MODEL` pinned. **Unverified end to end** (no key with credits available during the build); model ids in `renderer/app.js` may drift.
- Sessions/tabs are in-memory only; closing the app kills all ptys. Persistence across restarts = agent's `memory.md`, not terminal state.
- No delete UI for teams/agents yet (edit `%APPDATA%/damon/state.json` by hand).
- `package.json` `build.files` lists only app sources; electron-builder adds production `node_modules` automatically — verified, don't add `node_modules/**` to the list.
