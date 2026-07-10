# Damon (ADE)

**Damon** is an Agentic Development Environment: one Windows desktop app that runs every AI agent CLI you already pay for — Claude Code on your Claude subscription, OpenAI Codex on your ChatGPT subscription, and any open-source model through OpenRouter — from a single window.

No gray-area APIs: Damon drives the **official CLIs** in real terminals with your existing subscriptions. An OpenRouter API key is only used for open-source models.

![layout] Left rail: teams and their agents (with photos). Top: Chrome-style tabs, one real terminal session each. Right: a drawer with the agent's markdown files.

## Install

### Option A - installer

Download `ADE Setup <version>.exe` from the latest [release](../../releases), run it, and launch **ADE** from the Start menu.

### Option B - from source

```
git clone https://github.com/osmaza17/damon.git
cd damon
npm install
npm start
```

Requirements: Windows 10/11, [Node.js](https://nodejs.org) 20+, git, and the CLIs you plan to use:

- **Claude Code** (`npm install -g @anthropic-ai/claude-code`) — log in once with `claude` in any terminal; Damon reuses that authentication.
- **Codex** (`npm install -g @openai/codex`) — optional; log in once with `codex` using your ChatGPT account.
- **OpenRouter** — optional; create an API key at openrouter.ai (Workspaces → API keys) and make sure you have credits. Damon asks for the key the first time you launch an open-source model and stores it encrypted (Windows DPAPI via Electron `safeStorage`).

## First launch (onboarding)

1. The app opens on a blank screen: click **Create your first team** (e.g. "YouTube"), optionally with a photo.
2. Create an **agent** under it (photo optional) and choose its workspace: **new empty repo** (a local folder under `~/.ade`, git-initialized) or **clone a GitHub repo by URL**.
3. The agent immediately opens a **Claude session** in a real terminal (`claude --dangerously-skip-permissions`). Trust the folder when Claude asks.

## Daily use

- **Ctrl+T** — new tab. A model picker appears: Claude, Codex/GPT, Kimi K2, MiniMax, GLM, or a custom OpenRouter model id.
- **Ctrl+I** — rename the current session in place (double-click the tab also works).
- **Ctrl+W** — close the current tab (kills its terminal).
- **Files** (top right) — the agent's file drawer: view and edit `CLAUDE.md`, `agent.md`, `user.md`, `memory.md`.

## Agent files and memory

Every agent repo gets a self-improving markdown structure (modeled on Hermes):

- `agent.md` — who the agent is. It ships as a template: open the agent and tell Claude, e.g. *"You are Ernest, a script writer for my YouTube channel — update your agent.md"*. It improves with use.
- `user.md` — durable facts about you.
- `memory.md` — the agent updates it automatically at the end of each session (instructed by `CLAUDE.md`), so it remembers across closed tabs.
- `CLAUDE.md` — the operating brief that wires the three files together.

## Open-source models (OpenRouter)

Damon launches open-source models through the Claude Code harness pointed at OpenRouter: it sets `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, passes your OpenRouter key as the auth token, and pins `ANTHROPIC_MODEL` to the target (e.g. `moonshotai/kimi-k2`).

Notes:

- Model ids drift. If a launch fails with a model-not-found error, check the current id at [openrouter.ai/models](https://openrouter.ai/models) and update `MODELS` at the top of `renderer/app.js` (or use the **Custom** picker entry).
- This path relies on OpenRouter's Anthropic-compatible `/v1/messages` endpoint. If OpenRouter changes it, adjust `OPENROUTER_BASE_URL` in `main.js`. Verified plumbing, but test with your own key and credits.

## Build the installer

```
npm run dist
```

Produces `dist/ADE Setup <version>.exe` (NSIS, via electron-builder). Unsigned by default; add a `win.certificateFile` to the `build` section of `package.json` if you have a code-signing certificate.

## Data locations

- Teams/agents state and photos: `%APPDATA%/damon/`
- Agent repos: `%USERPROFILE%\.ade\`
- OpenRouter key: encrypted inside the state file (never committed anywhere).

## License

MIT
