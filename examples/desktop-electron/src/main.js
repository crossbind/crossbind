const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const initNative = require('../dist/crossbind-example-desktop-electron.native.cjs');

// The addon runs in the main process, the one with Node.js; the window asks it over IPC.
ipcMain.handle('native:sample', async () => {
    const { Native } = await initNative();
    return Native.sample();
});

function createWindow() {
    const window = new BrowserWindow({
        width: 640,
        height: 360,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
