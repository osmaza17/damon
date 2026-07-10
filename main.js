const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const pty = require('@lydell/node-pty');
const tpl = require('./templates');

const ADE_HOME = process.env.DAMON_ADE_HOME || path.join(os.homedir(), '.ade'); // agent repos live here
let stateFile;                                          // userData/state.json
let photosDir;                                          // userData/photos
let win;
const ptys = new Map();                                 // id -> pty process
let nextPtyId = 1;

// OpenRouter exposes an Anthropic-compatible /v1/messages endpoint, so Claude
// Code can drive any open-source model by pointing its base URL here.
// If OpenRouter changes this, update it (see README "Open-source models").
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// ---------- state ----------

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { return { teams: [], agents: [], settings: {} }; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
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

ipcMain.handle('pty:create', (_e, { cwd, runtime, modelId, cols, rows }) => {
  const { cmd, env } = commandFor(runtime, modelId);
  if (runtime === 'openrouter' && !env.ANTHROPIC_AUTH_TOKEN) return { error: 'no-openrouter-key' };
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
  ptys.set(id, proc);
  proc.onData((data) => win && win.webContents.send('pty:data', { id, data }));
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    win && win.webContents.send('pty:exit', { id, exitCode });
  });
  return { id };
});

ipcMain.on('pty:write', (_e, { id, data }) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  try { ptys.get(id)?.resize(cols, rows); } catch {}
});
ipcMain.on('pty:kill', (_e, id) => {
  try { ptys.get(id)?.kill(); } catch {}
  ptys.delete(id);
});

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Damon',
    backgroundColor: '#101014',
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
  for (const p of ptys.values()) { try { p.kill(); } catch {} }
  app.quit();
});
