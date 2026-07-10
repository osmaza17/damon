# LOG

Newest first.

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
