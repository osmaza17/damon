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
- **Ctrl+W** — close the current tab (kills its terminal). **Ctrl+Shift+Y** — reopen the last closed session, with its conversation.
- **Files** (top right) — the agent's file drawer: view and edit `CLAUDE.md`, `agent.md`, `user.md`, `memory.md`.

### Tab status dots

Each tab shows what its session is doing: **green** idle/done · **yellow** Claude is working · **red** waiting for your answer (permission/plan prompt; blinks when the tab is in the background) or usage limit reached · **grey** the CLI exited.

Tabs support pinning and drag-reorder (right-click for pin/rename/close). Titles are set automatically from the terminal title or your first prompt; a manual rename always wins.

### Toolbar

- **Model** — switches the live Claude session with `/model` (Haiku/Sonnet/Opus/Fable) and auto-confirms the prompt.
- **Account** — the account pool. Shows the active account and its live 5h usage %. The menu lists every saved account with usage (colored), lets you switch (hot-swap, no restart — Claude picks up the new credentials on its next message), save the current account, open claude.ai in that account's browser to re-login, exclude an account from auto-switch, or delete its snapshot. Credentials are snapshotted under `~/.claude/cch-accounts/` (never committed).
- **/skill** — inject any skill from `~/.claude/skills` into the session (plus "Open skills folder").
- **📱 (remote control)** — toggles `/remote-control` on the active session (Ctrl+R). Turning it off walks Claude's disconnect menu automatically.
- **A⇄ (auto-switch)** — automatic account rotation. *Threshold* mode switches when the active account passes a fixed 5h-usage %, *rotate* switches every +Δ%. A hard 90% ceiling always applies (with a least-used fallback), and no switch ever lands on an account above 95% weekly usage. "Diagnose" explains the last decision.
- **Tokens** — launches the bundled token-stats dashboard (Python, opens in your browser at `127.0.0.1:8080`).
- **− px +** — terminal font zoom (Ctrl+wheel and Ctrl+±/0 work too).
- **History** — recently closed sessions (max 25) across all agents; click to reopen with full conversation (`--resume`).
- **Reload** — restarts the CLI *keeping the conversation* (same session id). **Restart** — fresh session.
- **⚙ Settings** — extra Claude args, startup commands, font size, bell notifications, usage probe toggle, Python path, per-account **forbidden time windows** (hard-stop: Claude is interrupted and the pool jumps to another account) and per-account login browser.

Open tabs are persisted: closing the app and reopening restores each agent's sessions (lazily, when you visit the agent), resuming their conversations.

Two **floating buttons** at the bottom-right of the terminal save Claude's **last message** or the **whole conversation** as markdown into the agent repo.

### Terminal niceties

Paste an image from the clipboard (Ctrl+V) and it lands as a `@path` mention (temp PNG). Drop a file onto the terminal for the same. Ctrl+C copies when there is a selection (interrupt otherwise); Ctrl+Shift+C / Ctrl+Shift+V force copy / plain-text paste; right-click copies the selection or pastes. Ctrl+Enter/Shift+Enter insert a newline; Ctrl+Z / Ctrl+Shift+Z are undo/redo in the Claude input.

The UI follows an Obsidian look (Border theme dark, JetBrains Mono): tabs are colored by session state (green idle · yellow working · red needs your answer / usage limit, blinking when it is a background tab).

## Account pooling — how it works

Claude Code stores its auth in `~/.claude/.credentials.json` + `~/.claude.json`. Damon snapshots both per account and switches by writing them back atomically; a **live** Claude session re-reads credentials on its next request, so switching never restarts anything. Usage %s come from Anthropic's rate-limit response headers via a minimal 1-token probe per account (every 3 min, toggleable), and OAuth tokens are refreshed just before they expire so parked accounts stay alive.

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

- Teams/agents state, settings and photos: `%APPDATA%/damon/`
- Agent repos: `%USERPROFILE%\.ade\`
- Account snapshots: `%USERPROFILE%\.claude\cch-accounts\` (created by the account pool; contains OAuth tokens — treat like passwords)
- OpenRouter key: encrypted inside the state file (never committed anywhere).

## License

MIT
