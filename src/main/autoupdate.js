// Silent auto-update via electron-updater (GitHub provider).
// Only works in a packaged, code-signed build — Squirrel.Mac validates the
// signature before applying. In dev (npm start) it's a no-op.
const { app, ipcMain } = require('electron');

function initAutoUpdate(send) {
  if (!app.isPackaged) return; // updater is meaningless/unavailable in dev

  // Lazy require so dev runs don't need the dependency resolved early.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }));
  autoUpdater.on('download-progress', (p) => send('update:progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send('update:ready', { version: info.version }));
  autoUpdater.on('error', (e) => console.warn('autoUpdater error:', e && e.message));

  ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall(); });

  autoUpdater.checkForUpdates().catch(() => { /* offline / no release yet */ });
}

module.exports = { initAutoUpdate };
