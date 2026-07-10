const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, clipboard, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const pty = require('@lydell/node-pty');
const tpl = require('./templates');
const C = require('./constants');
const { AccountManager } = require('./accounts');

const ADE_HOME = process.env.DAMON_ADE_HOME || path.join(os.homedir(), '.ade'); // agent repos live here
let stateFile;                                          // userData/state.json
let photosDir;                                          // userData/photos
let win;
let accounts;                                           // AccountManager (created on ready)
let settings;                                           // single live settings object (AccountManager mutates it in place)
const ptys = new Map();                                 // id -> { proc, isClaude }
let nextPtyId = 1;

// OpenRouter exposes an Anthropic-compatible /v1/messages endpoint, so Claude
// Code can drive any open-source model by pointing its base URL here.
// If OpenRouter changes this, update it (see README "Open-source models").
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// window may already be destroyed while ptys drain their last output on quit
const send = (ch, msg) => { if (win && !win.isDestroyed()) win.webContents.send(ch, msg); };

// ---------- state & settings ----------

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { return { teams: [], agents: [], settings: {} }; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// Harness settings (auto-switch, schedules, sessions, fonts…) live under
// state.settings.harness. AccountManager mutates the SAME object getSettings()
// returns and then calls saveSettings() with no args, so `settings` must be a
// single long-lived object, not a fresh merge per call.
function persistSettings() {
  const s = loadState();
  s.settings.harness = settings;
  saveState(s);
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120000, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout) + String(stderr), err: err ? String(err.message) : null }));
  });
}

// Only the file drawer reads/writes through these; keep it inside the agents' home.
function insideAdeHome(p) {
  const resolved = path.resolve(p);
  return resolved === ADE_HOME || resolved.startsWith(ADE_HOME + path.sep);
}

// ---------- ipc: state, photos, settings ----------

ipcMain.handle('state:load', () => {
  const s = loadState();
  return { teams: s.teams, agents: s.agents, hasOpenRouterKey: !!s.settings.orKey };
});

ipcMain.handle('state:save', (_e, { teams, agents }) => {
  const s = loadState();
  s.teams = teams;
  s.agents = agents;
  saveState(s);
});

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(settings, patch);
  persistSettings();
  accounts.invalidateAccountCaches();
});

ipcMain.handle('photo:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a photo',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(photosDir, { recursive: true });
  const src = r.filePaths[0];
  const dest = path.join(photosDir, Date.now() + path.extname(src));
  fs.copyFileSync(src, dest);
  return dest;
});

ipcMain.handle('openrouter:set-key', (_e, key) => {
  const s = loadState();
  s.settings.orKey = safeStorage.isEncryptionAvailable()
    ? { enc: true, v: safeStorage.encryptString(key).toString('base64') }
    : { enc: false, v: key };
  saveState(s);
});

function getOpenRouterKey() {
  const k = loadState().settings.orKey;
  if (!k) return null;
  return k.enc ? safeStorage.decryptString(Buffer.from(k.v, 'base64')) : k.v;
}

// ---------- ipc: repos and agent files ----------

ipcMain.handle('repo:create', async (_e, { mode, url, name }) => {
  fs.mkdirSync(ADE_HOME, { recursive: true });
  let dir = path.join(ADE_HOME, slug(name));
  let n = 2;
  while (fs.existsSync(dir)) dir = path.join(ADE_HOME, slug(name) + '-' + n++);

  if (mode === 'clone') {
    const r = await run('git', ['clone', url, dir]);
    if (!r.ok) return { error: 'git clone failed:\n' + r.out };
  } else {
    fs.mkdirSync(dir, { recursive: true });
    const r = await run('git', ['init'], { cwd: dir });
    if (!r.ok) return { error: 'git init failed:\n' + r.out };
  }
  return { path: dir };
});

ipcMain.handle('agentfiles:write', (_e, { repoPath, agentName }) => {
  if (!insideAdeHome(repoPath)) return { error: 'repo outside .ade' };
  const files = {
    'CLAUDE.md': tpl.CLAUDE_MD(agentName),
    'agent.md': tpl.AGENT_MD(agentName),
    'user.md': tpl.USER_MD,
    'memory.md': tpl.MEMORY_MD,
  };
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(repoPath, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content); // don't clobber cloned repos
  }
});

ipcMain.handle('files:list', (_e, repoPath) => {
  if (!insideAdeHome(repoPath)) return [];
  try {
    return fs.readdirSync(repoPath)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort();
  } catch { return []; }
});

ipcMain.handle('files:read', (_e, { repoPath, file }) => {
  const p = path.join(repoPath, path.basename(file));
  if (!insideAdeHome(p)) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
});

ipcMain.handle('files:write', (_e, { repoPath, file, content }) => {
  const p = path.join(repoPath, path.basename(file));
  if (!insideAdeHome(p)) return { error: 'outside .ade' };
  fs.writeFileSync(p, content);
});

// ---------- ipc: terminals ----------

function commandFor(runtime, modelId) {
  if (runtime === 'claude') {
    return { cmd: 'claude --dangerously-skip-permissions', env: {} };
  }
  if (runtime === 'codex') {
    return { cmd: 'codex', env: {} };
  }
  // Open-source model: Claude Code harness pointed at OpenRouter.
  const key = getOpenRouterKey();
  return {
    cmd: 'claude --dangerously-skip-permissions',
    env: {
      ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: key || '',
      ANTHROPIC_API_KEY: key || '',
      ANTHROPIC_MODEL: modelId,
      ANTHROPIC_SMALL_FAST_MODEL: modelId,
      ANTHROPIC_DEFAULT_OPUS_MODEL: modelId,
      ANTHROPIC_DEFAULT_SONNET_MODEL: modelId,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: modelId,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  };
}

ipcMain.handle('pty:create', (_e, { cwd, runtime, modelId, cols, rows, sessionId, resume, extraArgs }) => {
  let { cmd, env } = commandFor(runtime, modelId);
  if (runtime === 'openrouter' && !env.ANTHROPIC_AUTH_TOKEN) return { error: 'no-openrouter-key' };
  const isClaude = runtime !== 'codex'; // openrouter also runs the claude CLI
  // Deterministic conversation ids so a tab can be reloaded/reopened with its
  // history (--resume). Skipped if the user already passed a session flag.
  if (isClaude && sessionId && !/--(session-id|resume|continue)\b/.test(extraArgs || '')) {
    cmd += resume ? ` --resume ${sessionId}` : ` --session-id ${sessionId}`;
  }
  if (extraArgs) cmd += ' ' + extraArgs;
  const id = nextPtyId++;
  let proc;
  try {
    proc = pty.spawn('powershell.exe', ['-NoLogo', '-Command', cmd], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
      env: { ...process.env, ...env },
    });
  } catch (e) {
    return { error: String(e.message) };
  }
  ptys.set(id, { proc, isClaude });
  proc.onData((data) => {
    send('pty:data', { id, data });
    if (isClaude && accounts) {
      accounts.maybeAutoSwitch(id, data);
      accounts.maybeAutoSaveAccount();
      accounts.maybeProbeOnActivity();
    }
  });
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    accounts?.dropPty(id);
    send('pty:exit', { id, exitCode });
  });
  return { id };
});

ipcMain.on('pty:write', (_e, { id, data }) => ptys.get(id)?.proc.write(data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  try { ptys.get(id)?.proc.resize(cols, rows); } catch {}
});
ipcMain.on('pty:kill', (_e, id) => {
  try { ptys.get(id)?.proc.kill(); } catch {}
  ptys.delete(id);
  accounts?.dropPty(id);
});

// ---------- ipc: accounts ----------

ipcMain.handle('accounts:snapshot', () => accounts.accountsSnapshot());
ipcMain.handle('accounts:switch', (_e, email) => { accounts.switchToAccount(email); });
ipcMain.handle('accounts:save-current', () => { accounts.saveCurrentAccount(); });
ipcMain.handle('accounts:delete', (_e, email) => { accounts.deleteSavedAccount(email); });
ipcMain.handle('accounts:toggle-eligible', (_e, email) => accounts.toggleAccountEligible(email));
ipcMain.handle('accounts:open-login', (_e, email) => { accounts.openLoginForAccount(email); });
ipcMain.handle('accounts:refresh-usage', () => accounts.refreshUsage());
ipcMain.handle('accounts:diagnose', () => accounts.diagnoseAutoSwitch());
ipcMain.handle('accounts:current-email', () => accounts.currentAccountEmail());

// ---------- ipc: skills ----------

// Claude Code skills = subfolders of ~/.claude/skills containing SKILL.md.
ipcMain.handle('skills:list', () => {
  const dir = path.join(os.homedir(), '.claude', 'skills');
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => d.name)
      .sort();
  } catch { return []; }
});

// ---------- ipc: clipboard image (paste screenshot as @path) ----------

const PASTE_DIR = path.join(os.tmpdir(), 'damon-paste');

ipcMain.handle('clipboard:image-path', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  fs.mkdirSync(PASTE_DIR, { recursive: true });
  const p = path.join(PASTE_DIR, 'paste-' + Date.now() + '.png');
  fs.writeFileSync(p, img.toPNG());
  return p;
});

function sweepTempImages() {
  try {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const f of fs.readdirSync(PASTE_DIR)) {
      const p = path.join(PASTE_DIR, f);
      if (fs.statSync(p).mtimeMs < dayAgo) fs.unlinkSync(p);
    }
  } catch {}
}

// ---------- ipc: conversation export ----------
// Claude Code writes each conversation to ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl
// (slug = the cwd with every [:\/ ] turned into "-"). Assistant messages stream as
// repeated snapshots sharing message.id — keep only the last one, in place.

function msgText(entry) {
  const c = entry?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return '';
}

function readConversation(cwd, sessionId) {
  const slugged = cwd.replace(/[:\\/ ]/g, '-');
  const p = path.join(os.homedir(), '.claude', 'projects', slugged, sessionId + '.jsonl');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  const items = [];
  const byId = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isMeta) continue;
    if (e.type === 'user') {
      const t = msgText(e);
      if (!t || t.startsWith('<command-')) continue;
      items.push({ role: 'user', text: t });
    } else if (e.type === 'assistant') {
      const t = msgText(e);
      if (!t) continue;
      const id = e.message?.id;
      if (id && byId.has(id)) byId.get(id).text = t;
      else {
        const item = { role: 'assistant', text: t };
        items.push(item);
        if (id) byId.set(id, item);
      }
    }
  }
  return items;
}

ipcMain.handle('export:conversation', (_e, { cwd, sessionId, repoPath, mode }) => {
  if (!insideAdeHome(repoPath)) return { error: 'outside .ade' };
  const conv = readConversation(cwd, sessionId);
  if (!conv || !conv.length) return { error: 'no conversation found' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  let name, content;
  if (mode === 'last') {
    const last = [...conv].reverse().find((m) => m.role === 'assistant');
    if (!last) return { error: 'no assistant message' };
    name = `export-last-${stamp}.md`;
    content = last.text + '\n';
  } else {
    name = `export-conversation-${stamp}.md`;
    content = conv.map((m) => `## ${m.role === 'user' ? 'User' : 'Claude'}\n\n${m.text}`).join('\n\n---\n\n') + '\n';
  }
  const p = path.join(repoPath, name);
  fs.writeFileSync(p, content);
  return { file: name };
});

// ---------- ipc: token dashboard ----------

const DASH_URL = 'http://127.0.0.1:8080';
let dashProc = null;

function appDir() {
  // token-dashboard ships asarUnpack'ed so python can read real files.
  return __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

function resolvePythonPath() {
  if (settings.pythonPath) return settings.pythonPath;
  const candidates = [];
  const lad = process.env.LOCALAPPDATA;
  if (lad) {
    const base = path.join(lad, 'Programs', 'Python');
    try { for (const d of fs.readdirSync(base)) candidates.push(path.join(base, d, 'python.exe')); } catch {}
  }
  for (const pf of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
    if (!pf) continue;
    try {
      for (const d of fs.readdirSync(pf)) if (/^Python\d/i.test(d)) candidates.push(path.join(pf, d, 'python.exe'));
    } catch {}
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'python'; // PATH fallback
}

ipcMain.handle('dashboard:launch', () => {
  if (dashProc) { shell.openExternal(DASH_URL); return { ok: true }; }
  const py = resolvePythonPath();
  let opened = false;
  const openOnce = () => { if (!opened) { opened = true; shell.openExternal(DASH_URL); } };
  try {
    dashProc = spawn(py, ['-u', 'cli.py', 'dashboard', '--no-open'], {
      cwd: path.join(appDir(), 'token-dashboard'),
      windowsHide: true,
    });
  } catch (e) {
    dashProc = null;
    return { error: String(e.message) };
  }
  dashProc.on('error', (e) => { dashProc = null; send('notify', 'Token dashboard: ' + e.message); });
  dashProc.on('exit', () => { dashProc = null; });
  dashProc.stdout.on('data', (d) => { if (/listening on|running on/i.test(String(d))) openOnce(); });
  // Fallback: poll the port for 90s in case the ready line changes.
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (opened || Date.now() - t0 > 90000) return clearInterval(poll);
    http.get(DASH_URL, () => { openOnce(); clearInterval(poll); }).on('error', () => {});
  }, 3000);
  return { ok: true };
});

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Damon',
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (process.env.DAMON_USER_DATA) app.setPath('userData', process.env.DAMON_USER_DATA);

app.whenReady().then(() => {
  stateFile = path.join(app.getPath('userData'), 'state.json');
  photosDir = path.join(app.getPath('userData'), 'photos');
  settings = { ...C.DEFAULT_SETTINGS, ...(loadState().settings.harness || {}) };
  accounts = new AccountManager({
    getSettings: () => settings,
    saveSettings: persistSettings,
    notify: (msg) => {
      send('notify', msg);
      if (win && !win.isFocused() && Notification.isSupported()) {
        new Notification({ title: 'Damon', body: msg }).show();
      }
    },
    onUpdate: () => send('accounts:update', accounts.accountsSnapshot()),
    interruptBusy: () => send('accounts:interrupt-busy'),
    shellOpenExternal: (url) => shell.openExternal(url),
  });
  sweepTempImages();
  // Usage probe every 3 min (also refreshes near-expiry OAuth tokens); schedule
  // enforcement every 20s (hard rule, independent of the autoSwitch toggle).
  setTimeout(() => accounts.refreshUsage(), 5000);
  setInterval(() => accounts.refreshUsage(), 3 * 60 * 1000);
  setInterval(() => accounts.enforceSchedule(), 20 * 1000);
  createWindow();
  if (process.argv.includes('--smoke')) {
    win.webContents.on('did-finish-load', () => {
      console.log('SMOKE_OK: renderer loaded');
      setTimeout(() => app.quit(), 1500);
    });
    win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message));
  }
});

app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.proc.kill(); } catch {} }
  try { dashProc?.kill(); } catch {}
  app.quit();
});
