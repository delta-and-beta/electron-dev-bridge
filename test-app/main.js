const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow
let settingsWindow

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile('index.html')
  mainWindow.on('closed', () => { mainWindow = null })
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.loadFile('settings.html')
  settingsWindow.on('closed', () => { settingsWindow = null })
}

// ── IPC Handlers (testable via electron-dev-bridge) ──

const store = {
  profiles: [
    { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
    { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user' },
  ],
  settings: { theme: 'dark', language: 'en', notifications: true },
  tags: ['vip', 'beta-tester', 'internal'],
}

ipcMain.handle('profiles:query', (event, args) => {
  let results = store.profiles
  if (args?.query) {
    const q = args.query.toLowerCase()
    results = results.filter(p =>
      p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    )
  }
  return results
})

ipcMain.handle('profiles:get', (event, args) => {
  return store.profiles.find(p => p.id === args?.id) || null
})

ipcMain.handle('settings:get', () => {
  return store.settings
})

ipcMain.handle('settings:set', (event, args) => {
  Object.assign(store.settings, args)
  return store.settings
})

ipcMain.handle('tags:getAll', () => {
  return store.tags
})

ipcMain.handle('tags:add', (event, args) => {
  if (args?.tag && !store.tags.includes(args.tag)) {
    store.tags.push(args.tag)
  }
  return store.tags
})

ipcMain.handle('app:openSettings', () => {
  createSettingsWindow()
  return { opened: true }
})

// ── App lifecycle ──

app.whenReady().then(() => {
  createMainWindow()
  console.log('Test app started')
  console.log('IPC handlers registered: 6')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
