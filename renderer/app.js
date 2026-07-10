/* global Terminal, FitAddon */
const $ = (id) => document.getElementById(id);

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

let teams = [];
let agents = [];
let hasOpenRouterKey = false;
let activeAgentId = null;
const sessions = new Map();   // agentId -> { tabs: [], activeTabId }
const byPty = new Map();      // ptyId -> tab
let nextTabId = 1;
let pendingModel = null;      // model waiting for OpenRouter key

const uid = () => Math.random().toString(36).slice(2, 10);
const fileUrl = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/'));

function persist() { window.damon.saveState(teams, agents); }

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

/* ---------------- sidebar ---------------- */

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

/* ---------------- tabs & terminals ---------------- */

function session(agentId) {
  if (!sessions.has(agentId)) sessions.set(agentId, { tabs: [], activeTabId: null });
  return sessions.get(agentId);
}
const activeSession = () => (activeAgentId ? session(activeAgentId) : null);
const activeTab = () => {
  const s = activeSession();
  return s ? s.tabs.find((t) => t.id === s.activeTabId) : null;
};

function addTab() {
  const s = activeSession();
  if (!s) return;
  const tab = { id: nextTabId++, title: 'New session', ptyId: null, term: null, host: null, dead: false };
  s.tabs.push(tab);
  s.activeTabId = tab.id;
  updateView();
}

function closeTab(tab) {
  const s = activeSession();
  if (!s) return;
  if (tab.ptyId != null) { window.damon.ptyKill(tab.ptyId); byPty.delete(tab.ptyId); }
  if (tab.term) tab.term.dispose();
  if (tab.host) tab.host.remove();
  s.tabs = s.tabs.filter((t) => t.id !== tab.id);
  if (s.activeTabId === tab.id) s.activeTabId = s.tabs.length ? s.tabs[s.tabs.length - 1].id : null;
  if (!s.tabs.length) addTab(); else updateView();
}

function renameTab(tab) {
  const el = document.querySelector(`.tab[data-id="${tab.id}"] .title`);
  if (!el) return;
  const input = document.createElement('input');
  input.value = tab.title;
  el.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => { tab.title = input.value.trim() || tab.title; updateView(); };
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.onblur = null; updateView(); }
    e.stopPropagation();
  };
}

async function launchModel(model) {
  let m = model;
  if (m.key === 'custom') {
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
  const tab = activeTab();
  const agent = agents.find((a) => a.id === activeAgentId);
  if (!tab || tab.ptyId != null || !agent) return;

  const host = document.createElement('div');
  host.className = 'term-host';
  $('terminals').appendChild(host);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    theme: { background: '#101014', foreground: '#e6e6eb', cursor: '#d97757' },
    cursorBlink: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  // Let app-level shortcuts (Ctrl+T/I/W) bubble past xterm.
  term.attachCustomKeyEventHandler((e) =>
    !(e.ctrlKey && ['t', 'i', 'w'].includes(e.key.toLowerCase())));

  const r = await window.damon.ptyCreate({
    cwd: agent.repoPath, runtime: m.runtime, modelId: m.modelId,
    cols: term.cols, rows: term.rows,
  });
  if (r.error) {
    term.write('\x1b[31mFailed to start session: ' + r.error + '\x1b[0m\r\n');
    tab.dead = true;
  } else {
    tab.ptyId = r.id;
    byPty.set(r.id, tab);
    term.onData((d) => window.damon.ptyWrite(r.id, d));
    term.onResize(({ cols, rows }) => window.damon.ptyResize(r.id, cols, rows));
  }
  tab.term = term;
  tab.fit = fit;
  tab.host = host;
  if (tab.title === 'New session') tab.title = m.label;
  updateView();
  term.focus();
}

window.damon.onPtyData(({ id, data }) => byPty.get(id)?.term.write(data));
window.damon.onPtyExit(({ id, exitCode }) => {
  const tab = byPty.get(id);
  if (!tab) return;
  tab.dead = true;
  tab.term.write(`\r\n\x1b[90m[session ended, exit code ${exitCode}]\x1b[0m\r\n`);
  updateView();
});

/* ---------------- master view switch ---------------- */

function updateView() {
  renderSidebar();
  const tabsEl = $('tabs');
  tabsEl.innerHTML = '';
  const s = activeSession();

  // hide every terminal, show only the active one below
  document.querySelectorAll('.term-host').forEach((el) => (el.style.display = 'none'));
  $('picker').classList.add('hidden');
  $('empty').classList.add('hidden');

  if (!teams.length) return showEmpty('Welcome to Damon', 'Create a team to group your agents - for example "YouTube".', 'Create your first team', openTeamDialog);
  if (!agents.length) return showEmpty('Add your first agent', 'Agents live inside teams. Each agent gets its own repo and memory.', 'Create an agent', () => openAgentDialog(teams[0].id));
  if (!activeAgentId) return showEmpty('Pick an agent', 'Select an agent on the left to start a session.', 'New agent', () => openAgentDialog(teams[0].id));

  for (const tab of s.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === s.activeTabId ? ' active' : '') + (tab.dead ? ' dead' : '');
    el.dataset.id = tab.id;
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.appendChild(dot);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    el.appendChild(title);
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
    el.appendChild(close);
    el.onclick = () => { s.activeTabId = tab.id; updateView(); };
    el.ondblclick = () => renameTab(tab);
    tabsEl.appendChild(el);
  }

  const tab = activeTab();
  if (!tab) { addTab(); return; }
  if (tab.host) {
    tab.host.style.display = '';
    requestAnimationFrame(() => { tab.fit.fit(); tab.term.focus(); });
  } else {
    showPicker();
  }
  refreshDrawer();
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

/* ---------------- agents ---------------- */

function selectAgent(id) {
  activeAgentId = id;
  const s = session(id);
  if (!s.tabs.length) addTab(); else updateView();
}

/* ---------------- dialogs ---------------- */

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

/* ---------------- file drawer ---------------- */

let drawerFile = null;

$('toggle-drawer').onclick = () => {
  $('drawer').classList.toggle('hidden');
  refreshDrawer();
  const t = activeTab();
  if (t && t.fit) requestAnimationFrame(() => t.fit.fit());
};

async function refreshDrawer() {
  if ($('drawer').classList.contains('hidden')) return;
  const agent = agents.find((a) => a.id === activeAgentId);
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
  const agent = agents.find((a) => a.id === activeAgentId);
  if (!agent || !drawerFile) return;
  await window.damon.writeFile(agent.repoPath, drawerFile, $('file-content').value);
};

/* ---------------- shortcuts & boot ---------------- */

$('add-team').onclick = openTeamDialog;
$('new-tab').onclick = addTab;

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 't') { e.preventDefault(); addTab(); }
  if (k === 'i') { e.preventDefault(); const t = activeTab(); if (t) renameTab(t); }
  if (k === 'w') { e.preventDefault(); const t = activeTab(); if (t) closeTab(t); }
});

window.addEventListener('resize', () => {
  const t = activeTab();
  if (t && t.fit) t.fit.fit();
});

(async () => {
  const s = await window.damon.loadState();
  teams = s.teams || [];
  agents = s.agents || [];
  hasOpenRouterKey = s.hasOpenRouterKey;
  updateView();
})();
