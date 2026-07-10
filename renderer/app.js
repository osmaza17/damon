/* global Terminal, FitAddon, Unicode11Addon, WebglAddon */
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- catalogs */

// OpenRouter model ids drift over time - if a launch fails with a model-not-found
// error, check https://openrouter.ai/models and update the id here (see README).
const MODELS = [
  { key: 'claude', label: 'Claude', sub: 'Claude subscription', runtime: 'claude', badge: 'C', color: '#d97757' },
  { key: 'codex', label: 'Codex / GPT', sub: 'ChatGPT subscription', runtime: 'codex', badge: 'GPT', color: '#10a37f' },
  { key: 'kimi', label: 'Kimi K2', sub: 'OpenRouter', runtime: 'openrouter', modelId: 'moonshotai/kimi-k2', badge: 'K2', color: '#5b8def' },
  { key: 'minimax', label: 'MiniMax', sub: 'OpenRouter', runtime: 'openrouter', modelId: 'minimax/minimax-m2', badge: 'MM', color: '#f23f5d' },
  { key: 'glm', label: 'GLM', sub: 'OpenRouter', runtime: 'openrouter', modelId: 'z-ai/glm-4.6', badge: 'GLM', color: '#3859ff' },
  { key: 'custom', label: 'Custom', sub: 'Any OpenRouter id', runtime: 'openrouter', modelId: null, badge: '+', color: '#44444f' },
];

// Claude models offered by the /model switcher in the toolbar.
const CLAUDE_MODELS = [
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.8' },
  { id: 'fable', label: 'Fable 5' },
];

// Browsers selectable for per-account logins (keys must match main's constants.js).
const BROWSER_LABELS = {
  chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge', brave: 'Brave', opera: 'Opera',
  operagx: 'Opera GX', zen: 'Zen', helium: 'Helium', vivaldi: 'Vivaldi',
  waterfox: 'Waterfox', floorp: 'Floorp', mullvad: 'Mullvad Browser',
};

// Heartbeat regexes — duplicated from constants.js (main process) because the
// renderer scans the xterm buffer directly; keep the two copies in sync.
const LIMIT_STOP_RE =
  /(usage|5-?hour|weekly|rate)[- ]?limit (reached|exceeded)|limit reached\b|you'?ve (reached|hit) your[^.]{0,30}\blimit|reached your[^.]{0,20}\blimit|out of (credits|usage)|claude usage limit/i;
const PROMPT_SENTENCE_RE =
  /No,?\s+and tell Claude what to do|Do you want to (proceed|make|create|run|allow|apply|continue|edit)\b|Would you like to proceed/i;
const PROMPT_NAV_HINT_RE =
  /\bkeys? to navigate\b|\b(arrow|tab)\b[^\n]{0,24}\bnavigate\b|[↑↓←→][^\n]{0,24}\b(navigate|naviguer)\b|\b(fl[èe]ches?|tab)\b[^\n]{0,24}\bnaviguer\b|\bpour naviguer\b/i;
const PROMPT_ACT_HINT_RE =
  /\benter to (select|submit|confirm)\b|\besc to cancel\b|\bentr[ée]e pour (s[ée]lectionner|valider|confirmer|soumettre)\b|\b[ée]chap\w* pour annuler\b/i;
function looksLikePrompt(text) {
  if (PROMPT_SENTENCE_RE.test(text)) return true;
  return PROMPT_NAV_HINT_RE.test(text) && PROMPT_ACT_HINT_RE.test(text);
}
const MODEL_CONFIRM_RE = /Switch model\?|Yes, switch to/i;

const MIN_FONT = 8, MAX_FONT = 40;

// 16 ANSI colours (plugin's dark palette) + surfaces read from the Obsidian
// CSS variables in style.css — same architecture as the plugin's termTheme().
const ANSI_DARK = {
  black: '#241B2C', red: '#FF6B6B', green: '#6BCF7F', yellow: '#FFD93D',
  blue: '#4ECDC4', magenta: '#B197FC', cyan: '#4ECDC4', white: '#F3ECF7',
  brightBlack: '#857693', brightRed: '#FFB4B4', brightGreen: '#B4E5BD',
  brightYellow: '#FFEC99', brightBlue: '#A8E6E0', brightMagenta: '#D6C5FF',
  brightCyan: '#A8E6E0', brightWhite: '#FFFDF5',
};
function termTheme() {
  const s = getComputedStyle(document.body);
  const v = (name, fb) => s.getPropertyValue(name).trim() || fb;
  const bg = v('--background-primary', '#262a39');
  const fg = v('--text-normal', '#d3d5de');
  return {
    ...ANSI_DARK,
    background: bg,
    foreground: fg,
    cursor: v('--text-accent', '#89a7ff'),
    cursorAccent: bg,
    selectionBackground: v('--text-selection', 'rgba(88,121,253,0.4)'),
    selectionForeground: fg,
  };
}

/* ------------------------------------------------------------------- state */

let teams = [];
let agents = [];
let settings = null;          // live copy of main's harness settings
let hasOpenRouterKey = false;
let activeAgentId = null;
const sessions = new Map();   // agentId -> { tabs: [], activeTabId }
const byPty = new Map();      // ptyId -> tab
let nextTabId = 1;
let pendingModel = null;      // model waiting for OpenRouter key
let pendingOpen = null;       // settings.openSessions, consumed per agent on first visit
let accountsCache = [];       // latest accounts snapshot (for the toolbar button)
let skillsCache = null;

const uid = () => Math.random().toString(36).slice(2, 10);
const fileUrl = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/'));
const agentById = (id) => agents.find((a) => a.id === id);

function persist() { window.damon.saveState(teams, agents); }
function saveSettings(patch) { Object.assign(settings, patch); return window.damon.setSettings(patch); }

/* ------------------------------------------------------------------ toasts */

function toast(msg, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, ms);
}
window.damon.onNotify(toast);

/* ------------------------------------------------------------ popup menus */
// One anchored popup at a time; closes on outside click or Escape.

function closeMenu() {
  $('popup-layer').innerHTML = '';
  $('popup-layer').style.display = 'none';
}
function openMenu(anchor, build) {
  closeMenu();
  const layer = $('popup-layer');
  layer.style.display = 'block';
  const menu = document.createElement('div');
  menu.className = 'popup';
  build(menu);
  layer.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px';
  const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12);
  menu.style.left = Math.max(8, left) + 'px';
  layer.onmousedown = (e) => { if (e.target === layer) closeMenu(); };
  return menu;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function menuItem(menu, label, fn, cls = '') {
  const it = document.createElement('div');
  it.className = 'popup-item ' + cls;
  if (typeof label === 'string') it.textContent = label; else it.appendChild(label);
  it.onclick = () => { closeMenu(); fn(); };
  menu.appendChild(it);
  return it;
}

/* ---------------------------------------------------------------- sidebar */

function avatarEl(entity, large) {
  const div = document.createElement('div');
  div.className = 'avatar' + (large ? ' large' : '');
  if (entity.photo) {
    const img = document.createElement('img');
    img.src = fileUrl(entity.photo);
    div.appendChild(img);
  } else {
    div.textContent = (entity.name || '?')[0].toUpperCase();
  }
  return div;
}

function renderSidebar() {
  const root = $('teams');
  root.innerHTML = '';
  for (const team of teams) {
    const teamEl = document.createElement('div');
    teamEl.className = 'team';

    const row = document.createElement('div');
    row.className = 'team-row';
    row.appendChild(avatarEl(team));
    const name = document.createElement('span');
    name.textContent = team.name;
    row.appendChild(name);
    const add = document.createElement('button');
    add.className = 'add-agent';
    add.textContent = '+';
    add.title = 'Add agent';
    add.onclick = () => openAgentDialog(team.id);
    row.appendChild(add);
    teamEl.appendChild(row);

    for (const agent of agents.filter((a) => a.teamId === team.id)) {
      const arow = document.createElement('div');
      arow.className = 'agent-row' + (agent.id === activeAgentId ? ' active' : '');
      arow.appendChild(avatarEl(agent));
      const aname = document.createElement('span');
      aname.textContent = agent.name;
      arow.appendChild(aname);
      arow.onclick = () => selectAgent(agent.id);
      teamEl.appendChild(arow);
    }
    root.appendChild(teamEl);
  }
}

/* ------------------------------------------------------- session plumbing */

function session(agentId) {
  if (!sessions.has(agentId)) sessions.set(agentId, { tabs: [], activeTabId: null });
  return sessions.get(agentId);
}
const activeSession = () => (activeAgentId ? session(activeAgentId) : null);
const activeTab = () => {
  const s = activeSession();
  return s ? s.tabs.find((t) => t.id === s.activeTabId) : null;
};
const allTabs = () => [...sessions.values()].flatMap((s) => s.tabs);

function newTabObj(agentId, extra = {}) {
  return {
    id: nextTabId++,
    agentId,
    sessionId: crypto.randomUUID(),   // deterministic claude conversation id
    title: 'New session',
    titleSource: 0,                   // 0 default < 1 first-prompt < 2 OSC < 3 manual
    model: null, skill: '',
    ptyId: null, term: null, fit: null, host: null,
    pinned: false,
    state: 'idle',                    // idle | busy | await | limit | exited
    limitLatched: false,
    lastKeyAt: 0,
    quietTimer: null,
    scanBuf: '',
    promptBuf: '', firstPromptDone: false,
    hadActivity: false,               // true once the conversation has content (drives --resume)
    remoteOn: false,
    modelConfirmUntil: 0,
    restorable: false,                // stub restored from openSessions, pty not started yet
    resumeNext: false,
    ...extra,
  };
}

function addTab() {
  const s = activeSession();
  if (!s) return;
  const tab = newTabObj(activeAgentId);
  s.tabs.push(tab);
  s.activeTabId = tab.id;
  updateView();
  persistSessions();
}

function closeTab(tab, remember = true) {
  const s = session(tab.agentId);
  if (remember && tab.hadActivity && tab.model && tab.model.runtime !== 'codex') rememberClosed(tab);
  if (tab.ptyId != null) { window.damon.ptyKill(tab.ptyId); byPty.delete(tab.ptyId); }
  clearTimeout(tab.quietTimer);
  if (tab.term) tab.term.dispose();
  if (tab.host) tab.host.remove();
  s.tabs = s.tabs.filter((t) => t.id !== tab.id);
  if (s.activeTabId === tab.id) s.activeTabId = s.tabs.length ? s.tabs[s.tabs.length - 1].id : null;
  if (tab.agentId === activeAgentId && !s.tabs.length) addTab();
  else updateView();
  persistSessions();
}

function setTabTitle(tab, title, source) {
  if (!title || source < tab.titleSource) return;
  tab.title = title;
  tab.titleSource = source;
  refreshTabTitles();
  persistSessions();
}

function renameTab(tab) {
  const el = document.querySelector(`.tab[data-id="${tab.id}"] .title`);
  if (!el) return;
  const input = document.createElement('input');
  input.value = tab.title;
  el.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => { if (input.value.trim()) setTabTitle(tab, input.value.trim(), 3); updateView(); };
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.onblur = null; updateView(); }
    e.stopPropagation();
  };
}

/* ---------------------------------------------------- heartbeat & titles */

function setTabState(tab, state) {
  if (tab.state === state) return;
  tab.state = state;
  refreshTabStatus();
}

// Output arrived from the pty: yellow while streaming, then after a 1200ms
// quiet gap scan the visible screen — a permission/plan prompt paints the tab
// red ("needs your answer"), otherwise green ("done"). Output that echoes a
// keystroke (<600ms after typing) does not count as "Claude is working".
function onPtyChunk(tab, data) {
  if (tab.state === 'exited') return;
  tab.scanBuf = (tab.scanBuf + data).slice(-3000);
  if (tab.modelConfirmUntil) {
    if (Date.now() > tab.modelConfirmUntil) tab.modelConfirmUntil = 0;
    else if (MODEL_CONFIRM_RE.test(tab.scanBuf)) {
      tab.modelConfirmUntil = 0;
      setTimeout(() => tab.ptyId != null && window.damon.ptyWrite(tab.ptyId, '\r'), 150);
    }
  }
  if (!tab.limitLatched && LIMIT_STOP_RE.test(tab.scanBuf)) {
    tab.limitLatched = true;
    setTabState(tab, 'limit');
  }
  if (tab.limitLatched) return;
  if (Date.now() - tab.lastKeyAt > 600) setTabState(tab, 'busy');
  clearTimeout(tab.quietTimer);
  tab.quietTimer = setTimeout(() => {
    if (tab.state === 'exited' || tab.limitLatched) return;
    setTabState(tab, looksLikePrompt(visibleText(tab.term)) ? 'await' : 'idle');
  }, 1200);
}

function visibleText(term) {
  if (!term) return '';
  const b = term.buffer.active;
  const out = [];
  for (let i = 0; i < term.rows; i++) {
    const line = b.getLine(b.baseY + i);
    if (line) out.push(line.translateToString(true));
  }
  return out.join('\n');
}

// User typed: clears the limit latch and the awaiting-input state, and feeds
// the first-prompt title capture (first thing typed becomes the tab title).
function onUserInput(tab, data) {
  tab.lastKeyAt = Date.now();
  if (tab.limitLatched) { tab.limitLatched = false; tab.scanBuf = ''; setTabState(tab, 'idle'); }
  else if (tab.state === 'await') setTabState(tab, 'idle');
  if (!tab.firstPromptDone) {
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const t = tab.promptBuf.trim();
        if (t) {
          tab.firstPromptDone = true;
          tab.hadActivity = true;
          setTabTitle(tab, t.length > 40 ? t.slice(0, 40) + '…' : t, 1);
        }
        tab.promptBuf = '';
      } else if (ch === '\x7f') tab.promptBuf = tab.promptBuf.slice(0, -1);
      else if (ch >= ' ') tab.promptBuf += ch;
    }
    if (tab.promptBuf.length > 200) tab.promptBuf = tab.promptBuf.slice(-200);
  }
}

// OSC titles: strip leading glyphs, ignore shell/paths — Claude sets a topic
// title once it knows what the conversation is about.
function onOscTitle(tab, t) {
  t = String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (!t || /^(powershell|cmd|conhost|windows terminal|claude)$/i.test(t) || /^[A-Za-z]:[\\/]/.test(t)) return;
  setTabTitle(tab, t, 2);
}

/* ------------------------------------------------------------ terminals */

function makeTerminal(tab) {
  const host = document.createElement('div');
  host.className = 'term-host';
  $('terminals').appendChild(host);
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    fontSize: settings.fontSize || 14,
    theme: termTheme(),
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    minimumContrastRatio: 4.5,
    allowProposedApi: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = '11'; } catch {}
  term.open(host);
  try { term.loadAddon(new WebglAddon.WebglAddon()); } catch {}
  fit.fit();

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    // App-level shortcuts bubble past xterm.
    if (e.ctrlKey && !e.shiftKey && ['t', 'i', 'w'].includes(k)) return false;
    if (e.ctrlKey && e.shiftKey && k === 'y') return false;
    // Zoom (Ctrl+0 resets to the default size, like the plugin).
    if (e.ctrlKey && (k === '+' || k === '=' )) { zoomBy(1); return false; }
    if (e.ctrlKey && k === '-') { zoomBy(-1); return false; }
    if (e.ctrlKey && k === '0') { zoomBy(14 - (settings.fontSize || 14)); return false; }
    // Remote control toggle: bubble to the document handler (like Ctrl+T/W).
    if (e.ctrlKey && !e.shiftKey && k === 'r') return false;
    // Copy: Ctrl+C only when there is a selection (otherwise it's SIGINT for
    // the pty); Ctrl+Shift+C always copies.
    if (e.ctrlKey && k === 'c' && (e.shiftKey || tab.term.hasSelection())) {
      if (tab.term.hasSelection()) {
        navigator.clipboard.writeText(tab.term.getSelection());
        tab.term.clearSelection();
      }
      return false;
    }
    // Smart paste (image in clipboard -> temp PNG path as @mention);
    // Ctrl+Shift+V forces plain text.
    if (e.ctrlKey && !e.shiftKey && k === 'v') { pasteSmart(tab); return false; }
    if (e.ctrlKey && e.shiftKey && k === 'v') {
      navigator.clipboard.readText().then((t) => t && tab.term.paste(t));
      return false;
    }
    // Multiline input: Ctrl/Shift+Enter inserts a literal newline.
    if ((e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
      if (tab.ptyId != null) window.damon.ptyWrite(tab.ptyId, '\n');
      return false;
    }
    // Claude Code line editing: Ctrl+Z undo, Ctrl+Shift+Z redo.
    if (e.ctrlKey && k === 'z') {
      if (tab.ptyId != null) window.damon.ptyWrite(tab.ptyId, e.shiftKey ? '\x19' : '\x15');
      return false;
    }
    return true;
  });

  // Right click: copy when there is a selection, paste otherwise (plugin).
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (tab.term.hasSelection()) {
      navigator.clipboard.writeText(tab.term.getSelection());
      tab.term.clearSelection();
    } else pasteSmart(tab);
  });

  host.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // Drop a file onto the terminal -> @-mention its path.
  host.addEventListener('dragover', (e) => e.preventDefault());
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      const p = window.damon.getPathForFile ? window.damon.getPathForFile(f) : f.path;
      if (p && tab.ptyId != null) window.damon.ptyWrite(tab.ptyId, '@' + p + ' ');
    }
  });

  term.onTitleChange((t) => onOscTitle(tab, t));
  term.onBell(() => {
    if (settings.notifyOnBell && document.hidden && window.Notification) {
      new Notification('Damon — ' + tab.title, { body: 'Session needs attention' });
    }
  });

  tab.term = term;
  tab.fit = fit;
  tab.host = host;
  return term;
}

async function pasteSmart(tab) {
  if (tab.ptyId == null) return;
  const imgPath = await window.damon.clipboardImagePath();
  if (imgPath) { window.damon.ptyWrite(tab.ptyId, '@' + imgPath + ' '); return; }
  try {
    const text = await navigator.clipboard.readText();
    if (text) tab.term.paste(text); // bracketed-paste aware
  } catch {}
}

/* ------------------------------------------------------------ launching */

async function launchModel(model, opts = {}) {
  let m = model;
  if (m.key === 'custom' && !m.modelId) {
    const id = prompt('OpenRouter model id (e.g. moonshotai/kimi-k2):');
    if (!id) return;
    m = { ...m, modelId: id.trim(), label: id.trim().split('/').pop() };
  }
  if (m.runtime === 'openrouter' && !hasOpenRouterKey) {
    pendingModel = m;
    $('or-key-form').classList.remove('hidden');
    $('or-key-input').focus();
    return;
  }
  const tab = opts.tab || activeTab();
  const agent = agentById(tab?.agentId);
  if (!tab || tab.ptyId != null || !agent) return;

  const term = tab.term || makeTerminal(tab);
  const resume = !!(opts.resume && tab.sessionId);
  const r = await window.damon.ptyCreate({
    cwd: agent.repoPath, runtime: m.runtime, modelId: m.modelId,
    cols: term.cols, rows: term.rows,
    sessionId: tab.sessionId, resume,
    extraArgs: m.runtime !== 'codex' ? (settings.args || '') : '',
  });
  if (r.error) {
    term.write('\x1b[31mFailed to start session: ' + r.error + '\x1b[0m\r\n');
    setTabState(tab, 'exited');
  } else {
    tab.ptyId = r.id;
    tab.restorable = false;
    byPty.set(r.id, tab);
    term.onData((d) => { onUserInput(tab, d); window.damon.ptyWrite(r.id, d); });
    term.onResize(({ cols, rows }) => window.damon.ptyResize(r.id, cols, rows));
    if (!resume && m.runtime !== 'codex') maybeSendInitial(tab, r.id);
  }
  tab.model = m;
  if (tab.title === 'New session') { tab.title = m.label; tab.titleSource = 0; }
  if (resume) tab.hadActivity = true;
  updateView();
  persistSessions();
  term.focus();
}

// Startup commands typed into every fresh Claude session, after a fixed 1800ms
// boot delay (the CLI eats input typed earlier). Each line: text, 350ms, Enter.
function maybeSendInitial(tab, ptyId) {
  const lines = (settings.startupCommands || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let delay = 1800;
  for (const line of lines) {
    setTimeout(() => {
      if (tab.ptyId !== ptyId) return; // reloaded/killed meanwhile
      window.damon.ptyWrite(ptyId, line);
      setTimeout(() => tab.ptyId === ptyId && window.damon.ptyWrite(ptyId, '\r'), 350);
    }, delay);
    delay += 1800;
  }
}

window.damon.onPtyData(({ id, data }) => {
  const tab = byPty.get(id);
  if (!tab) return;
  tab.term.write(data);
  onPtyChunk(tab, data);
});
window.damon.onPtyExit(({ id, exitCode }) => {
  const tab = byPty.get(id);
  if (!tab) return;
  byPty.delete(id);
  tab.ptyId = null;
  tab.remoteOn = false;
  setTabState(tab, 'exited');
  tab.term.write(`\r\n\x1b[90m[session ended, exit code ${exitCode}]\x1b[0m\r\n`);
});

// Schedule hard-stop: main asks us to interrupt any in-flight generation.
window.damon.onInterruptBusy(() => {
  for (const tab of allTabs()) {
    if (tab.state === 'busy' && tab.ptyId != null) window.damon.ptyWrite(tab.ptyId, '\x1b');
  }
});

/* ----------------------------------------------------- reload / restart */

// Reload: same tab, SAME conversation — kill the CLI and resume the session id.
function reloadTab(tab) {
  if (!tab || !tab.model || tab.model.runtime === 'codex') return;
  const resume = tab.hadActivity;
  if (tab.ptyId != null) { window.damon.ptyKill(tab.ptyId); byPty.delete(tab.ptyId); tab.ptyId = null; }
  tab.limitLatched = false;
  tab.scanBuf = '';
  tab.state = 'idle';
  tab.remoteOn = false;
  tab.term.reset();
  launchModel(tab.model, { tab, resume });
}

// Restart: close this tab (remembered in history) and start a fresh one.
function restartTab(tab) {
  if (!tab) return;
  const model = tab.model;
  closeTab(tab);
  if (model) launchModel(model);
}

/* ------------------------------------------------ history & persistence */

function rememberClosed(tab) {
  const cs = settings.closedSessions || [];
  cs.unshift({
    agentId: tab.agentId, sessionId: tab.sessionId, title: tab.title,
    model: tab.model?.key || 'claude', modelId: tab.model?.modelId || null,
    closedAt: Date.now(), pinned: !!tab.pinned,
  });
  if (cs.length > 25) cs.length = 25;
  saveSettings({ closedSessions: cs });
}

function reopenClosed(info) {
  const cs = settings.closedSessions.filter((c) => c.sessionId !== info.sessionId);
  saveSettings({ closedSessions: cs });
  if (!agentById(info.agentId)) { toast('That agent no longer exists.'); return; }
  activeAgentId = info.agentId;      // not selectAgent(): that would add a blank tab first
  restoreAgentSessions(info.agentId);
  const s = session(info.agentId);
  const tab = newTabObj(info.agentId, {
    sessionId: info.sessionId, title: info.title, titleSource: 3,
    pinned: !!info.pinned, hadActivity: true,
  });
  s.tabs.push(tab);
  s.activeTabId = tab.id;
  updateView();
  const model = MODELS.find((m) => m.key === info.model) || MODELS[0];
  launchModel(info.modelId ? { ...model, modelId: info.modelId } : model, { tab, resume: true });
}

// Open-tab snapshot -> settings.openSessions, debounced; restored per agent on
// first visit after a restart (stub tabs, pty started when the tab is shown —
// restoring into a hidden terminal garbles the TUI).
let flushTimer = null;
function persistSessions() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushSessions, 1500);
}
function flushSessions() {
  const open = {};
  if (pendingOpen) {
    for (const [agentId, v] of Object.entries(pendingOpen)) {
      if (!sessions.has(agentId)) open[agentId] = v; // not visited yet: keep as saved
    }
  }
  for (const [agentId, s] of sessions) {
    const tabs = s.tabs
      .filter((t) => t.hadActivity && t.model && t.model.runtime !== 'codex')
      .map((t) => ({
        sessionId: t.sessionId, title: t.title, titleSource: t.titleSource,
        model: t.model.key, modelId: t.model.modelId || null, pinned: !!t.pinned,
      }));
    if (tabs.length) {
      const ai = s.tabs.findIndex((t) => t.id === s.activeTabId);
      open[agentId] = { tabs, activeIndex: Math.max(0, ai) };
    }
  }
  saveSettings({ openSessions: open });
}

function restoreAgentSessions(agentId) {
  const saved = pendingOpen?.[agentId];
  if (!saved || !saved.tabs?.length) return false;
  delete pendingOpen[agentId];
  const s = session(agentId);
  for (const info of saved.tabs) {
    const model = MODELS.find((m) => m.key === info.model) || MODELS[0];
    s.tabs.push(newTabObj(agentId, {
      sessionId: info.sessionId, title: info.title, titleSource: info.titleSource || 3,
      pinned: !!info.pinned, hadActivity: true, restorable: true,
      model: info.modelId ? { ...model, modelId: info.modelId } : model,
    }));
  }
  const at = s.tabs[Math.min(saved.activeIndex || 0, s.tabs.length - 1)];
  s.activeTabId = at.id;
  return true;
}

function historyRelTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.round(d / 60000) + ' min ago';
  if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
  return Math.round(d / 86400000) + ' d ago';
}

// ChatGPT-style drawer (plugin): a sidebar slides in from the left OVER the
// conversation; the dimmed backdrop closes it on click (and Escape).
function toggleHistoryDrawer() {
  const el = $('history-drawer');
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '';
  el.onmousedown = (e) => { if (e.target === el) el.classList.add('hidden'); };
  const side = document.createElement('div');
  side.className = 'hist-sidebar';
  el.appendChild(side);
  const bar = document.createElement('div');
  bar.className = 'hist-bar';
  const barTitle = document.createElement('div');
  barTitle.className = 'hist-title';
  barTitle.textContent = 'Session history';
  const closeBtn = document.createElement('div');
  closeBtn.className = 'hist-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => el.classList.add('hidden');
  bar.appendChild(barTitle);
  bar.appendChild(closeBtn);
  side.appendChild(bar);
  const list = settings.closedSessions || [];
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'hist-empty';
    p.textContent = 'Nothing here yet — closed sessions land in this list.';
    side.appendChild(p);
    return;
  }
  const listEl = document.createElement('div');
  listEl.className = 'hist-list';
  side.appendChild(listEl);
  for (const info of list) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = info.title;
    const sub = document.createElement('div');
    sub.className = 'muted history-sub';
    const agent = agentById(info.agentId);
    sub.textContent = `${historyRelTime(info.closedAt)} · ${agent ? agent.name : 'deleted agent'} · ${info.model}`;
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '×';
    del.title = 'Forget this session';
    del.onclick = (e) => {
      e.stopPropagation();
      saveSettings({ closedSessions: settings.closedSessions.filter((c) => c.sessionId !== info.sessionId) });
      toggleHistoryDrawer(); toggleHistoryDrawer(); // rebuild
    };
    const txt = document.createElement('div');
    txt.className = 'history-txt';
    txt.appendChild(title);
    txt.appendChild(sub);
    row.appendChild(txt);
    row.appendChild(del);
    row.onclick = () => { el.classList.add('hidden'); reopenClosed(info); };
    listEl.appendChild(row);
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('history-drawer').classList.add('hidden');
});

/* --------------------------------------------------------------- toolbar */

function currentAccountLabel() {
  const cur = accountsCache.find((a) => a.current);
  if (!cur) return 'account';
  const name = cur.email.split('@')[0];
  const pct = cur.usage?.pct5h;
  return pct == null ? name : `${name} · ${Math.round(pct)}%`;
}

function usageColor(pct) {
  if (pct == null) return '';
  if (pct >= 90) return '#e5484d';
  if (pct >= 70) return '#e5934d';
  if (pct >= 40) return '#d9b13d';
  return '#46a758';
}

function refreshToolbar() {
  $('btn-model').textContent = (CLAUDE_MODELS.find((m) => m.id === settings.model) || CLAUDE_MODELS[2]).label;
  $('btn-account').textContent = currentAccountLabel();
  const cur = accountsCache.find((a) => a.current);
  $('btn-account').style.color = usageColor(cur?.usage?.pct5h) || '';
  $('btn-autoswitch').classList.toggle('on', !!settings.autoSwitch);
  $('btn-remote').classList.toggle('on', !!activeTab()?.remoteOn);
  $('btn-autoswitch').title = settings.autoSwitch
    ? `Auto-switch ON (${settings.autoSwitchMode} ${settings.autoSwitchMode === 'rotate' ? '+' + settings.autoSwitchDelta : settings.autoSwitchThreshold}%)`
    : 'Auto-switch accounts (off)';
  $('zoom-label').textContent = (settings.fontSize || 14) + 'px';
}

window.damon.onAccountsUpdate((snap) => {
  accountsCache = snap;
  refreshToolbar();
  if (document.querySelector('.popup.accounts')) openAccountsMenu(); // live-refresh open popup
});

$('btn-model').onclick = () => openMenu($('btn-model'), (menu) => {
  for (const m of CLAUDE_MODELS) {
    menuItem(menu, (settings.model === m.id ? '● ' : '') + m.label, () => {
      saveSettings({ model: m.id });
      refreshToolbar();
      const tab = activeTab();
      if (tab && tab.ptyId != null && tab.model?.runtime !== 'codex') {
        window.damon.ptyWrite(tab.ptyId, '\x15/model ' + m.id + '\r');
        tab.modelConfirmUntil = Date.now() + 6000; // auto-answer the confirm prompt
        tab.scanBuf = '';
      }
    });
  }
});

$('btn-skill').onclick = async () => {
  if (!skillsCache) skillsCache = await window.damon.listSkills();
  openMenu($('btn-skill'), (menu) => {
    for (const sk of skillsCache) {
      menuItem(menu, '/' + sk, () => {
        const tab = activeTab();
        if (tab && tab.ptyId != null) {
          window.damon.ptyWrite(tab.ptyId, '\x15/' + sk);
          setTimeout(() => tab.ptyId != null && window.damon.ptyWrite(tab.ptyId, '\r'), 350);
        }
      });
    }
    if (!skillsCache.length) menuItem(menu, 'No skills in ~/.claude/skills', () => {});
    const sep = document.createElement('div');
    sep.className = 'popup-sep';
    menu.appendChild(sep);
    menuItem(menu, 'Open skills folder', () => window.damon.openSkillsFolder());
  });
};

async function openAccountsMenu() {
  accountsCache = await window.damon.accountsSnapshot();
  refreshToolbar();
  openMenu($('btn-account'), (menu) => {
    menu.classList.add('accounts');
    for (const a of accountsCache) {
      const row = document.createElement('div');
      // blocked = manually excluded (inert, strikethrough); capped = ineligible
      // as an auto-switch DESTINATION (red highlight, still clickable) — plugin.
      row.className = 'popup-item account-row' + (a.current ? ' current' : '')
        + (!a.eligible ? ' blocked' : (!a.current && (a.capped || a.timeBlocked) ? ' capped' : ''));
      const main = document.createElement('div');
      main.className = 'account-main';
      const email = document.createElement('div');
      if (a.current) {
        const check = document.createElement('span');
        check.className = 'acct-check';
        check.textContent = '✓ ';
        email.appendChild(check);
      }
      email.appendChild(document.createTextNode(a.email));
      const sub = document.createElement('div');
      sub.className = 'muted account-sub';
      sub.textContent = [a.usageLabel, a.scheduleLabel && ('blocked ' + a.scheduleLabel)].filter(Boolean).join(' · ');
      if (a.usage?.pct5h != null) sub.style.color = usageColor(a.usage.pct5h);
      main.appendChild(email);
      if (sub.textContent) main.appendChild(sub);
      row.appendChild(main);

      const acts = document.createElement('div');
      acts.className = 'account-actions';
      const mk = (txt, title, fn) => {
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.textContent = txt;
        b.title = title;
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        acts.appendChild(b);
      };
      mk('🌐', 'Log in on claude.ai (' + (a.browserLabel || 'browser') + ')', () => window.damon.openLogin(a.email));
      mk(a.eligible ? '⛔' : '✓', a.eligible ? 'Exclude from auto-switch' : 'Allow for auto-switch',
        async () => { await window.damon.toggleAccountEligible(a.email); openAccountsMenu(); });
      mk('×', 'Delete saved credentials', async () => {
        if (!confirm('Delete saved credentials for ' + a.email + '?')) return;
        await window.damon.deleteAccount(a.email);
        openAccountsMenu();
      });
      row.appendChild(acts);
      row.onclick = () => {
        if (!a.eligible) { toast('Account disabled — re-enable it (✓) to switch.'); return; }
        closeMenu();
        if (!a.current) window.damon.switchAccount(a.email);
      };
      menu.appendChild(row);
    }
    const sep = document.createElement('div');
    sep.className = 'popup-sep';
    menu.appendChild(sep);
    menuItem(menu, 'Save current account', async () => { await window.damon.saveCurrentAccount(); });
    menuItem(menu, 'Refresh usage now', async () => { await window.damon.refreshUsage(); });
  });
}
$('btn-account').onclick = openAccountsMenu;

$('btn-autoswitch').onclick = () => openMenu($('btn-autoswitch'), (menu) => {
  menuItem(menu, (settings.autoSwitch ? '☑' : '☐') + ' Auto-switch enabled', () => {
    saveSettings({ autoSwitch: !settings.autoSwitch });
    refreshToolbar();
  });
  const sep = document.createElement('div');
  sep.className = 'popup-sep';
  menu.appendChild(sep);
  for (const mode of ['threshold', 'rotate']) {
    menuItem(menu, (settings.autoSwitchMode === mode ? '● ' : '○ ') +
      (mode === 'threshold' ? 'Threshold: switch at a fixed %' : 'Rotate: switch every +Δ% used'), () => {
      saveSettings({ autoSwitchMode: mode });
      refreshToolbar();
    });
  }
  const sep2 = document.createElement('div');
  sep2.className = 'popup-sep';
  menu.appendChild(sep2);
  if (settings.autoSwitchMode === 'rotate') {
    for (const d of [5, 10, 15, 20, 25]) {
      menuItem(menu, (settings.autoSwitchDelta === d ? '● ' : '') + `Δ +${d}%`, () => {
        saveSettings({ autoSwitchDelta: d });
        refreshToolbar();
      });
    }
  } else {
    for (const t of [70, 80, 85, 90, 95]) {
      menuItem(menu, (settings.autoSwitchThreshold === t ? '● ' : '') + `at ${t}%`, () => {
        saveSettings({ autoSwitchThreshold: t });
        refreshToolbar();
      });
    }
  }
  const sep3 = document.createElement('div');
  sep3.className = 'popup-sep';
  menu.appendChild(sep3);
  menuItem(menu, 'Diagnose auto-switch', async () => {
    const d = await window.damon.diagnoseAutoSwitch();
    toast(d ? (d.reason || JSON.stringify(d)) : 'No auto-switch evaluation yet (needs terminal output).', 9000);
  });
});

$('btn-dashboard').onclick = async () => {
  const r = await window.damon.launchDashboard();
  if (r?.error) toast('Token dashboard failed: ' + r.error);
};

// Floating export buttons (bottom-right, plugin's .cch-export-fab): save the
// last Claude message / whole conversation as .md into the agent repo.
async function doExport(mode) {
  const tab = activeTab();
  const agent = agentById(tab?.agentId);
  if (!tab || !agent || !tab.hadActivity) { toast('Nothing to export yet.'); return; }
  const r = await window.damon.exportConversation({
    cwd: agent.repoPath, sessionId: tab.sessionId, repoPath: agent.repoPath, mode,
  });
  toast(r.error ? 'Export failed: ' + r.error : 'Exported ' + r.file + ' into the agent repo.');
  refreshDrawer();
}
$('fab-export-last').onclick = () => doExport('last');
$('fab-export-full').onclick = () => doExport('full');

// Remote control: two-state toggle, plugin behavior. ON only connects (the URL
// shows in Claude's own status bar); OFF re-runs the command and walks its menu
// (Up ×2 + Enter) using the DECCKM-correct arrow sequence.
function toggleRemoteControl() {
  const tab = activeTab();
  if (!tab || tab.ptyId == null || tab.model?.runtime === 'codex') return;
  const w = (d) => tab.ptyId != null && window.damon.ptyWrite(tab.ptyId, d);
  if (!tab.remoteOn) {
    tab.remoteOn = true;
    w('\x15/remote-control\r');
  } else {
    tab.remoteOn = false;
    w('\x15/remote-control\r');
    const up = tab.term?.modes?.applicationCursorKeysMode ? '\x1bOA' : '\x1b[A';
    setTimeout(() => w(up), 700);
    setTimeout(() => w(up), 850);
    setTimeout(() => w('\r'), 1000);
  }
  refreshToolbar();
}
$('btn-remote').onclick = toggleRemoteControl;

function zoomBy(d) {
  const size = Math.min(MAX_FONT, Math.max(MIN_FONT, (settings.fontSize || 14) + d));
  if (size === settings.fontSize) return;
  saveSettings({ fontSize: size });
  for (const tab of allTabs()) {
    if (tab.term) {
      tab.term.options.fontSize = size;
      if (tab.host && tab.host.style.display !== 'none') tab.fit.fit();
    }
  }
  refreshToolbar();
}
$('btn-zoom-in').onclick = () => zoomBy(1);
$('btn-zoom-out').onclick = () => zoomBy(-1);

$('btn-history').onclick = toggleHistoryDrawer;
$('btn-reload').onclick = () => reloadTab(activeTab());
$('btn-restart').onclick = () => restartTab(activeTab());

/* ------------------------------------------------------- settings dialog */

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // Sun..Sat

// "22:00-08:00 LMXJV, 14:00-16:00 S" -> ranges[]. Days omitted = every day.
function parseScheduleText(text) {
  const ranges = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*([DLMXJVS]*)$/i.exec(part);
    if (!m) continue;
    const days = m[3]
      ? [...m[3].toUpperCase()].map((c) => DAY_LETTERS.indexOf(c)).filter((d) => d >= 0)
      : [0, 1, 2, 3, 4, 5, 6];
    ranges.push({ start: m[1], end: m[2], days });
  }
  return ranges;
}
function scheduleText(ranges) {
  return (ranges || []).map((r) => {
    const days = (r.days || []).slice().sort((a, b) => a - b).map((d) => DAY_LETTERS[d]).join('');
    return `${r.start}-${r.end}${days.length === 7 ? '' : ' ' + days}`;
  }).join(', ');
}

async function openSettingsDialog() {
  $('set-args').value = settings.args || '';
  $('set-startup').value = settings.startupCommands || '';
  $('set-fontsize').value = settings.fontSize || 14;
  $('set-bell').checked = !!settings.notifyOnBell;
  $('set-probe').checked = !!settings.usageProbe;
  $('set-python').value = settings.pythonPath || '';
  $('set-usagere').value = settings.autoSwitchUsageRegex || '';
  const bsel = $('set-browser');
  bsel.innerHTML = '';
  for (const [key, label] of Object.entries(BROWSER_LABELS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = label;
    if (key === settings.defaultBrowser) o.selected = true;
    bsel.appendChild(o);
  }

  // Per-account: forbidden time windows + login browser.
  const box = $('settings-accounts');
  box.innerHTML = '';
  const snap = await window.damon.accountsSnapshot();
  if (snap.length) {
    const h = document.createElement('h3');
    h.textContent = 'Accounts';
    box.appendChild(h);
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = 'Forbidden windows: "22:00-08:00 LMXJV" (days D L M X J V S = Sun..Sat; empty days = daily). Blocked hours hard-stop the account.';
    box.appendChild(hint);
  }
  for (const a of snap) {
    const row = document.createElement('div');
    row.className = 'settings-account-row';
    row.dataset.email = a.email;
    const em = document.createElement('div');
    em.className = 'settings-account-email';
    em.textContent = a.email;
    const sched = document.createElement('input');
    sched.className = 'sched-input';
    sched.placeholder = 'no forbidden hours';
    const entry = (settings.accountSchedules || []).find((s) => s.email === a.email.toLowerCase());
    sched.value = scheduleText(entry?.ranges);
    const brow = document.createElement('select');
    brow.className = 'browser-select';
    const cur = (settings.browserMap || []).find((b) => b.email === a.email.toLowerCase());
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'default browser';
    brow.appendChild(def);
    for (const [key, label] of Object.entries(BROWSER_LABELS)) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = label;
      if (cur && cur.browser === key) o.selected = true;
      brow.appendChild(o);
    }
    row.appendChild(em);
    row.appendChild(sched);
    row.appendChild(brow);
    box.appendChild(row);
  }
  $('settings-dialog').showModal();
}
$('btn-settings').onclick = openSettingsDialog;

$('settings-dialog').addEventListener('close', () => {
  if ($('settings-dialog').returnValue !== 'ok') return;
  const accountSchedules = [];
  const browserMap = [];
  for (const row of document.querySelectorAll('.settings-account-row')) {
    const email = row.dataset.email.toLowerCase();
    const ranges = parseScheduleText(row.querySelector('.sched-input').value);
    if (ranges.length) accountSchedules.push({ email, ranges });
    const browser = row.querySelector('.browser-select').value;
    if (browser) browserMap.push({ email, browser, path: '' });
  }
  saveSettings({
    args: $('set-args').value.trim(),
    startupCommands: $('set-startup').value,
    fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, +$('set-fontsize').value || 14)),
    notifyOnBell: $('set-bell').checked,
    usageProbe: $('set-probe').checked,
    pythonPath: $('set-python').value.trim(),
    autoSwitchUsageRegex: $('set-usagere').value.trim(),
    defaultBrowser: $('set-browser').value,
    accountSchedules,
    browserMap,
  });
  refreshToolbar();
  for (const tab of allTabs()) {
    if (!tab.term) continue;
    tab.term.options.fontSize = settings.fontSize;
    if (tab.host && tab.host.style.display !== 'none') tab.fit.fit();
  }
});

/* --------------------------------------------------- master view switch */

// Tab border mirrors the dot; awaiting-input blinks only when the tab is NOT
// active (pure CSS: .tab.await.active turns the animation off).
const TAB_STATES = ['idle', 'busy', 'await', 'limit', 'exited'];

function refreshTabStatus() {
  const s = activeSession();
  if (!s) return;
  for (const tab of s.tabs) {
    const el = document.querySelector(`.tab[data-id="${tab.id}"]`);
    if (!el) continue;
    el.classList.remove(...TAB_STATES);
    el.classList.add(tab.state);
    const dot = el.querySelector('.dot');
    if (dot) dot.className = 'dot ' + tab.state;
  }
}
function refreshTabTitles() {
  const s = activeSession();
  if (!s) return;
  for (const tab of s.tabs) {
    const el = document.querySelector(`.tab[data-id="${tab.id}"] .title`);
    if (el && el.textContent !== tab.title) el.textContent = tab.title;
  }
}

function updateView() {
  renderSidebar();
  refreshToolbar();
  const tabsEl = $('tabs');
  tabsEl.innerHTML = '';
  const s = activeSession();

  document.querySelectorAll('.term-host').forEach((el) => (el.style.display = 'none'));
  $('picker').classList.add('hidden');
  $('empty').classList.add('hidden');
  $('history-drawer').classList.add('hidden');

  if (!teams.length) return showEmpty('Welcome to Damon', 'Create a team to group your agents - for example "YouTube".', 'Create your first team', openTeamDialog);
  if (!agents.length) return showEmpty('Add your first agent', 'Agents live inside teams. Each agent gets its own repo and memory.', 'Create an agent', () => openAgentDialog(teams[0].id));
  if (!activeAgentId) return showEmpty('Pick an agent', 'Select an agent on the left to start a session.', 'New agent', () => openAgentDialog(teams[0].id));

  for (const tab of s.tabs) {
    const el = document.createElement('div');
    el.className = 'tab ' + tab.state + (tab.id === s.activeTabId ? ' active' : '') + (tab.pinned ? ' pinned' : '');
    el.dataset.id = tab.id;
    el.title = (tab.pinned ? '📌 ' : '') + tab.title;
    const dot = document.createElement('span');
    dot.className = 'dot ' + tab.state;
    el.appendChild(dot);
    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'pin';
      pin.textContent = '📌';
      el.appendChild(pin);
    }
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    el.appendChild(title);
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
    el.appendChild(close);
    el.onclick = () => { s.activeTabId = tab.id; updateView(); persistSessions(); };
    el.ondblclick = () => renameTab(tab);
    el.oncontextmenu = (e) => {
      e.preventDefault();
      openMenu(el, (menu) => {
        menuItem(menu, tab.pinned ? 'Unpin tab' : 'Pin tab', () => {
          tab.pinned = !tab.pinned;
          const rest = s.tabs.filter((t) => t !== tab);
          s.tabs = tab.pinned
            ? [...rest.filter((t) => t.pinned), tab, ...rest.filter((t) => !t.pinned)]
            : [...rest.filter((t) => t.pinned), ...rest.filter((t) => !t.pinned), tab];
          updateView();
          persistSessions();
        });
        menuItem(menu, 'Rename (Ctrl+I)', () => renameTab(tab));
        menuItem(menu, 'Close (Ctrl+W)', () => closeTab(tab));
      });
    };
    el.onpointerdown = (e) => beginTabDrag(e, el, tab);
    tabsEl.appendChild(el);
  }

  const tab = activeTab();
  if (!tab) { addTab(); return; }
  if (tab.restorable && tab.ptyId == null) {
    // Stub restored from a previous run: start the CLI now that it is visible.
    launchModel(tab.model, { tab, resume: true });
  } else if (tab.host) {
    tab.host.style.display = '';
    requestAnimationFrame(() => { tab.fit.fit(); tab.term.focus(); });
  } else {
    showPicker();
  }
  refreshDrawer();
}

// Pointer-based tab reorder (4px threshold; pinned tabs stay in the pin region).
function beginTabDrag(e, el, tab) {
  if (e.button !== 0 || e.target.closest('.close')) return;
  const startX = e.clientX;
  let dragging = false;
  const s = activeSession();
  const move = (ev) => {
    if (!dragging && Math.abs(ev.clientX - startX) < 4) return;
    dragging = true;
    el.classList.add('dragging');
    const siblings = [...el.parentElement.children].filter((c) => c !== el);
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      const sibTab = s.tabs.find((t) => t.id === +sib.dataset.id);
      if (!sibTab || sibTab.pinned !== tab.pinned) continue; // pin-region clamp
      if (ev.clientX > r.left + r.width * 0.25 && ev.clientX < r.left + r.width * 0.75) {
        if (r.left < el.getBoundingClientRect().left) el.parentElement.insertBefore(el, sib);
        else el.parentElement.insertBefore(el, sib.nextSibling);
      }
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!dragging) return;
    el.classList.remove('dragging');
    const order = [...el.parentElement.children].map((c) => +c.dataset.id);
    s.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    persistSessions();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function showEmpty(title, sub, action, fn) {
  $('empty').classList.remove('hidden');
  $('empty-title').textContent = title;
  $('empty-sub').textContent = sub;
  $('empty-action').textContent = action;
  $('empty-action').onclick = fn;
}

function showPicker() {
  $('picker').classList.remove('hidden');
  const list = $('model-list');
  list.innerHTML = '';
  for (const m of MODELS) {
    const btn = document.createElement('button');
    btn.className = 'model-btn';
    const badge = document.createElement('div');
    badge.className = 'model-badge';
    badge.style.background = m.color;
    badge.textContent = m.badge;
    btn.appendChild(badge);
    const label = document.createElement('div');
    label.textContent = m.label;
    btn.appendChild(label);
    const sub = document.createElement('div');
    sub.className = 'model-sub';
    sub.textContent = m.sub;
    btn.appendChild(sub);
    btn.onclick = () => launchModel(m);
    list.appendChild(btn);
  }
}

$('or-key-form').onsubmit = async (e) => {
  e.preventDefault();
  const key = $('or-key-input').value.trim();
  if (!key) return;
  await window.damon.setOpenRouterKey(key);
  hasOpenRouterKey = true;
  $('or-key-form').classList.add('hidden');
  $('or-key-input').value = '';
  if (pendingModel) { const m = pendingModel; pendingModel = null; launchModel(m); }
};

/* ---------------------------------------------------------------- agents */

function selectAgent(id) {
  activeAgentId = id;
  const s = session(id);
  if (!s.tabs.length && restoreAgentSessions(id)) { updateView(); return; }
  if (!s.tabs.length) addTab(); else updateView();
}

/* --------------------------------------------------------------- dialogs */

let dialogPhoto = null;

function openTeamDialog() {
  dialogPhoto = null;
  $('team-name').value = '';
  $('team-photo-preview').innerHTML = '';
  $('team-photo-preview').textContent = '?';
  $('team-dialog').showModal();
}

$('team-photo-btn').onclick = async () => {
  const p = await window.damon.pickPhoto();
  if (!p) return;
  dialogPhoto = p;
  $('team-photo-preview').innerHTML = `<img src="${fileUrl(p)}">`;
};

$('team-dialog').addEventListener('close', () => {
  if ($('team-dialog').returnValue !== 'ok') return;
  const name = $('team-name').value.trim();
  if (!name) return;
  teams.push({ id: uid(), name, photo: dialogPhoto });
  persist();
  updateView();
});

let agentDialogTeamId = null;

function openAgentDialog(teamId) {
  agentDialogTeamId = teamId;
  dialogPhoto = null;
  $('agent-name').value = '';
  $('agent-repo-url').value = '';
  $('agent-repo-url').classList.add('hidden');
  document.querySelector('input[name="repo-mode"][value="new"]').checked = true;
  $('agent-photo-preview').innerHTML = '';
  $('agent-photo-preview').textContent = '?';
  $('agent-dialog').showModal();
}

$('agent-photo-btn').onclick = async () => {
  const p = await window.damon.pickPhoto();
  if (!p) return;
  dialogPhoto = p;
  $('agent-photo-preview').innerHTML = `<img src="${fileUrl(p)}">`;
};

document.querySelectorAll('input[name="repo-mode"]').forEach((r) => {
  r.onchange = () => $('agent-repo-url').classList.toggle('hidden', r.value !== 'clone' || !r.checked);
});

$('agent-dialog').addEventListener('close', async () => {
  if ($('agent-dialog').returnValue !== 'ok') return;
  const name = $('agent-name').value.trim();
  if (!name) return;
  const mode = document.querySelector('input[name="repo-mode"]:checked').value;
  const url = $('agent-repo-url').value.trim();
  if (mode === 'clone' && !url) { alert('Enter a repo URL to clone.'); return; }

  const r = await window.damon.createRepo({ mode, url, name });
  if (r.error) { alert(r.error); return; }
  await window.damon.writeAgentFiles({ repoPath: r.path, agentName: name });

  const agent = { id: uid(), teamId: agentDialogTeamId, name, photo: dialogPhoto, repoPath: r.path };
  agents.push(agent);
  persist();
  selectAgent(agent.id);                       // opens a new tab
  launchModel(MODELS[0]);                      // and starts Claude right away
});

/* ------------------------------------------------------------ file drawer */

let drawerFile = null;

$('toggle-drawer').onclick = () => {
  $('drawer').classList.toggle('hidden');
  refreshDrawer();
  const t = activeTab();
  if (t && t.fit) requestAnimationFrame(() => t.fit.fit());
};

async function refreshDrawer() {
  if ($('drawer').classList.contains('hidden')) return;
  const agent = agentById(activeAgentId);
  const listEl = $('file-list');
  listEl.innerHTML = '';
  $('file-view').classList.add('hidden');
  if (!agent) return;
  const files = await window.damon.listFiles(agent.repoPath);
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = f;
    li.onclick = async () => {
      listEl.querySelectorAll('li').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      drawerFile = f;
      $('file-name').textContent = f;
      $('file-content').value = (await window.damon.readFile(agent.repoPath, f)) ?? '';
      $('file-view').classList.remove('hidden');
    };
    listEl.appendChild(li);
  }
}

$('file-save').onclick = async () => {
  const agent = agentById(activeAgentId);
  if (!agent || !drawerFile) return;
  await window.damon.writeFile(agent.repoPath, drawerFile, $('file-content').value);
};

/* --------------------------------------------------------- shortcuts & boot */

$('add-team').onclick = openTeamDialog;
$('new-tab').onclick = addTab;

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === 'y') {
    e.preventDefault();
    const info = (settings.closedSessions || [])[0];
    if (info) reopenClosed(info); else toast('No closed sessions to reopen.');
    return;
  }
  if (e.shiftKey) return;
  if (k === 't') { e.preventDefault(); addTab(); }
  if (k === 'i') { e.preventDefault(); const t = activeTab(); if (t) renameTab(t); }
  if (k === 'w') { e.preventDefault(); const t = activeTab(); if (t) closeTab(t); }
  if (k === 'r') { e.preventDefault(); toggleRemoteControl(); }
});

window.addEventListener('resize', () => {
  const t = activeTab();
  if (t && t.fit) t.fit.fit();
});

window.addEventListener('beforeunload', () => { clearTimeout(flushTimer); flushSessions(); });

(async () => {
  const [s, cfg, snap] = await Promise.all([
    window.damon.loadState(),
    window.damon.getSettings(),
    window.damon.accountsSnapshot(),
  ]);
  teams = s.teams || [];
  agents = s.agents || [];
  hasOpenRouterKey = s.hasOpenRouterKey;
  settings = cfg;
  accountsCache = snap;
  pendingOpen = { ...(settings.openSessions || {}) };
  updateView();
})();
