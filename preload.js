const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, msg) => cb(msg));

contextBridge.exposeInMainWorld('damon', {
  // state & settings
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (teams, agents) => ipcRenderer.invoke('state:save', { teams, agents }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickPhoto: () => ipcRenderer.invoke('photo:pick'),
  setOpenRouterKey: (key) => ipcRenderer.invoke('openrouter:set-key', key),
  // repos & agent files
  createRepo: (opts) => ipcRenderer.invoke('repo:create', opts),
  writeAgentFiles: (opts) => ipcRenderer.invoke('agentfiles:write', opts),
  listFiles: (repoPath) => ipcRenderer.invoke('files:list', repoPath),
  readFile: (repoPath, file) => ipcRenderer.invoke('files:read', { repoPath, file }),
  writeFile: (repoPath, file, content) => ipcRenderer.invoke('files:write', { repoPath, file, content }),
  // terminals
  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: on('pty:data'),
  onPtyExit: on('pty:exit'),
  // accounts
  accountsSnapshot: () => ipcRenderer.invoke('accounts:snapshot'),
  switchAccount: (email) => ipcRenderer.invoke('accounts:switch', email),
  saveCurrentAccount: () => ipcRenderer.invoke('accounts:save-current'),
  deleteAccount: (email) => ipcRenderer.invoke('accounts:delete', email),
  toggleAccountEligible: (email) => ipcRenderer.invoke('accounts:toggle-eligible', email),
  openLogin: (email) => ipcRenderer.invoke('accounts:open-login', email),
  refreshUsage: () => ipcRenderer.invoke('accounts:refresh-usage'),
  diagnoseAutoSwitch: () => ipcRenderer.invoke('accounts:diagnose'),
  currentAccountEmail: () => ipcRenderer.invoke('accounts:current-email'),
  onAccountsUpdate: on('accounts:update'),
  onNotify: on('notify'),
  onInterruptBusy: on('accounts:interrupt-busy'),
  // extras
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  clipboardImagePath: () => ipcRenderer.invoke('clipboard:image-path'),
  exportConversation: (opts) => ipcRenderer.invoke('export:conversation', opts),
  launchDashboard: () => ipcRenderer.invoke('dashboard:launch'),
});
