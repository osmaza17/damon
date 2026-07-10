const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('damon', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (teams, agents) => ipcRenderer.invoke('state:save', { teams, agents }),
  pickPhoto: () => ipcRenderer.invoke('photo:pick'),
  setOpenRouterKey: (key) => ipcRenderer.invoke('openrouter:set-key', key),
  createRepo: (opts) => ipcRenderer.invoke('repo:create', opts),
  writeAgentFiles: (opts) => ipcRenderer.invoke('agentfiles:write', opts),
  listFiles: (repoPath) => ipcRenderer.invoke('files:list', repoPath),
  readFile: (repoPath, file) => ipcRenderer.invoke('files:read', { repoPath, file }),
  writeFile: (repoPath, file, content) => ipcRenderer.invoke('files:write', { repoPath, file, content }),
  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, m) => cb(m)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, m) => cb(m)),
});
