// Test-only host: exercise the built, sandboxed preload and renderer without the service or dotenv.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 384, height: 720, show: false,
    webPreferences: { preload: path.resolve('dist/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  ipcMain.handle('flicky:initial', () => ({ ok: true, value: { mode: 'synthetic', accountId: 'demo-checking', monitoring: false,
    permission: 'granted', microphoneConsent: false, capabilities: { transcription: false, speech: false } } }));
  ipcMain.handle('flicky:state', () => ({ ok: true }));
  ipcMain.handle('flicky:turn', () => {
    window.webContents.send('flicky:event', { type: 'verification', verification: { state: 'locked', requestId: 'test-request' } });
    return { ok: false, error: { message: 'Verify first.', code: 'verification_required', requestId: 'test-request', status: 403 } };
  });
  await window.loadFile(path.resolve('dist/renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
