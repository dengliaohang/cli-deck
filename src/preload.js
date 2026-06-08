const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cliDeck', {
  getConfig: () => ipcRenderer.invoke('app:getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('app:saveConfig', config),
  selectDirectory: () => ipcRenderer.invoke('app:selectDirectory'),
  openPath: (targetPath) => ipcRenderer.invoke('app:openPath', targetPath),
  readClipboardText: () => ipcRenderer.invoke('app:readClipboardText'),
  writeClipboardText: (text) => ipcRenderer.invoke('app:writeClipboardText', text),
  getProjectMemory: (cwd) => ipcRenderer.invoke('memory:getProject', cwd),
  getProjectMemoryByKey: (projectKey) => ipcRenderer.invoke('memory:getProjectByKey', projectKey),
  listProjectMemories: (limit) => ipcRenderer.invoke('memory:listProjects', limit),
  searchProjectMemories: (options) => ipcRenderer.invoke('memory:searchProjects', options),
  exportProjectMemory: (projectKey, format) => ipcRenderer.invoke('memory:exportProject', { projectKey, format }),
  deleteProjectMemory: (projectKey, deleteSessionFiles) =>
    ipcRenderer.invoke('memory:deleteProject', { projectKey, deleteSessionFiles }),
  cleanupRawLogs: () => ipcRenderer.invoke('memory:cleanupRawLogs'),
  getGoal: (cwd) => ipcRenderer.invoke('goal:get', cwd),
  saveGoal: (cwd, patch) => ipcRenderer.invoke('goal:save', { cwd, patch }),
  addGoalTask: (cwd, title) => ipcRenderer.invoke('goal:addTask', { cwd, title }),
  updateGoalTask: (cwd, taskId, patch) => ipcRenderer.invoke('goal:updateTask', { cwd, taskId, patch }),
  deleteGoalTask: (cwd, taskId) => ipcRenderer.invoke('goal:deleteTask', { cwd, taskId }),
  attachGoalSession: (cwd, sessionId) => ipcRenderer.invoke('goal:attachSession', { cwd, sessionId }),
  addGoalOutput: (cwd, output) => ipcRenderer.invoke('goal:addOutput', { cwd, output }),
  exportGoal: (cwd) => ipcRenderer.invoke('goal:export', cwd),
  createTerminal: (config) => ipcRenderer.invoke('terminal:create', config),
  writeTerminal: (id, data) => ipcRenderer.send('terminal:input', { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  closeTerminal: (id) => ipcRenderer.send('terminal:close', id),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.off('terminal:data', listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.off('terminal:exit', listener);
  },
  onMemoryUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('memory:updated', listener);
    return () => ipcRenderer.off('memory:updated', listener);
  }
});
