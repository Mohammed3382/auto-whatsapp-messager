// Electron desktop shell.
// Boots the local engine (server.js) and shows the dashboard in a native window.

const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

// When packaged, node_modules lives inside app.asar (read-only). Point Puppeteer
// at the Chromium we bundle as an unpacked resource, and keep the WhatsApp login
// session in a writable per-user folder.
if (app.isPackaged) {
  process.env.PUPPETEER_CACHE_DIR = path.join(process.resourcesPath, 'puppeteer-cache');
}

let win;

async function boot() {
  const { start } = require('./server');
  const { url } = await start({
    port: 3111, // fixed local port for the shell
    dataPath: path.join(app.getPath('userData'), 'wwebjs-auth'),
  });

  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#0b141a',
    title: 'Auto WhatsApp Messager',
    webPreferences: { contextIsolation: true },
  });

  win.setMenuBarVisibility(false);
  win.loadURL(url);

  // Open any external links (e.g. help) in the real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});
