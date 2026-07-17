// Electron desktop shell.
// Boots the local engine (server.js) and shows the dashboard in a native window.

const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

// Only ONE instance may run. If the app is launched again while already open,
// the new launch quits and just focuses the existing window. Two instances would
// share the same WhatsApp session folder, fight over the link, and loop the QR.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // When packaged, node_modules lives inside app.asar (read-only). Point Puppeteer
  // at the Chromium we bundle as an unpacked resource, and keep the WhatsApp login
  // session in a writable per-user folder.
  if (app.isPackaged) {
    process.env.PUPPETEER_CACHE_DIR = path.join(process.resourcesPath, 'puppeteer-cache');
  }

  let win = null;

  async function boot() {
    const { start } = require('./server');
    const { url } = await start({
      port: 3111, // fixed local port for the shell
      dataPath: path.join(app.getPath('userData'), 'wwebjs-auth'),
    });

    win = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 540,
      minHeight: 520,
      backgroundColor: '#020617',
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

  // A second launch lands here in the primary instance: bring our window forward.
  app.on('second-instance', () => {
    const w = win || BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}
