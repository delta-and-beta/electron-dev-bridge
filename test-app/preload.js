const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  profiles: {
    query: (args) => ipcRenderer.invoke('profiles:query', args),
    get: (args) => ipcRenderer.invoke('profiles:get', args),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (args) => ipcRenderer.invoke('settings:set', args),
  },
  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    add: (args) => ipcRenderer.invoke('tags:add', args),
  },
  app: {
    openSettings: () => ipcRenderer.invoke('app:openSettings'),
  },
})
