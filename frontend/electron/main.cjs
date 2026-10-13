const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const client = require('../branding/client.json');
const { createUpdateFlow } = require('./update-flow.cjs');

if (!/^[a-z0-9-]{3,50}$/.test(client.clientId || '')) throw new Error('A stable clientId is required in branding/client.json');
const isDevelopment = !app.isPackaged;
const legacyDataDir = path.join(app.getPath('userData'), 'pos-data');
const stableUserDir = path.join(app.getPath('appData'), 'OfflinePOS', client.clientId);
// Keep the development Chromium cache separate from the installed app. Both
// instances still use the same stable POS database directory below.
const electronUserDir = isDevelopment ? path.join(stableUserDir, 'electron-development') : stableUserDir;
fs.mkdirSync(stableUserDir, { recursive: true });
fs.mkdirSync(electronUserDir, { recursive: true });
app.setPath('userData', electronUserDir);
app.setName(client.appName || client.name || 'Offline POS');

let backendProcess;
let backendPort;
let bluetoothSelection;
let updateState = { status: 'unavailable', version: app.getVersion(), progress: 0, error: '' };
let updater;
let updateFlow;

function clientFeedUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.pathname.includes(client.clientId)) {
    throw new Error(`Client feed must use HTTPS and include ${client.clientId} in its path`);
  }
  return url;
}

function clientFeedHeaders(url) {
  return url.hostname === 'api.github.com'
    ? { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'OfflinePOS' }
    : {};
}

function sendUpdateState(status, details = {}) {
  updateState = { ...updateState, status, ...details };
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('pos:update-state', updateState);
}

function setupUpdater() {
  if (isDevelopment || process.platform !== 'win32' || !client.updateFeedUrl) return;
  const feed = clientFeedUrl(client.updateFeedUrl);
  updater = require('electron-updater').autoUpdater;
  if (feed.hostname === 'api.github.com') updater.requestHeaders = clientFeedHeaders(feed);
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on('checking-for-update', () => sendUpdateState('checking', { error: '' }));
  updater.on('update-available', info => sendUpdateState('available', { availableVersion: info.version }));
  updater.on('update-not-available', () => sendUpdateState('current', { availableVersion: undefined }));
  updater.on('download-progress', progress => sendUpdateState('downloading', { progress: Math.round(progress.percent) }));
  updater.on('update-downloaded', info => sendUpdateState('downloaded', { progress: 100, availableVersion: info.version }));
  updater.on('error', error => sendUpdateState('error', { error: String(error.message || error) }));
  updateFlow = createUpdateFlow({
    readRelease: async () => {
      const feed = clientFeedUrl(client.updateFeedUrl);
      const manifestUrl = new URL('release.json', feed.href.endsWith('/') ? feed.href : feed.href + '/');
      const response = await fetch(manifestUrl, { headers: clientFeedHeaders(manifestUrl), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw new Error(`Release metadata returned ${response.status}`);
      const manifest = await response.json();
      const expectedAppId = `com.localpos.${client.clientId.replaceAll('-', '')}`;
      if (manifest.clientId !== client.clientId || manifest.appId !== expectedAppId || typeof manifest.version !== 'string') {
        throw new Error('Update feed belongs to another client');
      }
      return manifest;
    },
    check: () => updater.checkForUpdates(),
    download: () => updater.downloadUpdate(),
    state: () => updateState,
    error: error => sendUpdateState('error', { error: String(error.message || error) }),
    install: installDownloadedUpdate
  });
  sendUpdateState('idle');
  setTimeout(() => checkForUpdate(false).catch(error => console.error('[POS update]', error)), 15_000);
}

function installDownloadedUpdate() {
  if (!updater || updateState.status !== 'downloaded') throw new Error('No update is ready to install');
  sendUpdateState('installing');
  setImmediate(() => {
    try { updater.quitAndInstall(true, true); }
    catch (error) { sendUpdateState('error', { error: String(error.message || error) }); }
  });
}

function checkForUpdate(installAfterDownload) {
  return updateFlow ? updateFlow.run(installAfterDownload) : Promise.resolve(updateState);
}

async function readNotifications(refresh = false) {
  const bundledPath = path.join(__dirname, '..', 'assets', 'generated', 'notifications.json');
  const cachePath = path.join(stableUserDir, 'notifications-cache.json');
  let payload = fs.existsSync(bundledPath) ? JSON.parse(fs.readFileSync(bundledPath, 'utf8')) : { notifications: [] };
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.clientId === client.clientId && Array.isArray(cached.notifications)) {
        const merged = new Map([...(payload.notifications || []), ...cached.notifications].map(item => [item.id, item]));
        payload = { clientId: client.clientId, notifications: [...merged.values()] };
      }
    } catch (error) { console.error('[POS notification cache]', error); }
  }
  if (refresh && client.notificationFeedUrl) {
    try {
      const url = clientFeedUrl(client.notificationFeedUrl);
      url.searchParams.set('checked', String(Date.now()));
      const response = await fetch(url, { headers: clientFeedHeaders(url), signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw new Error(`Notification feed returned ${response.status}`);
      const raw = await response.text();
      if (raw.length > 1_000_000) throw new Error('Notification feed is too large');
      const remote = JSON.parse(raw);
      if (remote.clientId !== client.clientId || !Array.isArray(remote.notifications)) throw new Error('Notification feed belongs to another client');
      payload = remote;
      try { fs.writeFileSync(cachePath, raw); } catch (error) { console.error('[POS notification cache]', error); }
    } catch (error) { console.error('[POS notifications]', error); throw error; }
  }
  return (payload.notifications || []).filter(item =>
    item && typeof item.id === 'string' && typeof item.heading === 'string' &&
    typeof item.description === 'string' && typeof item.date === 'string' &&
    typeof item.content === 'string' &&
    (!item.updateAvailable || process.platform === 'win32') &&
    (item.targetClient === client.clientId || item.targetClient === 'all-clients')
  );
}

const notificationReadPath = path.join(stableUserDir, 'notification-read.json');
const notificationHiddenPath = path.join(stableUserDir, 'notification-hidden.json');
function notificationReadState() {
  try {
    const state = JSON.parse(fs.readFileSync(notificationReadPath, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch { return {}; }
}
function notificationHiddenState() {
  try {
    const state = JSON.parse(fs.readFileSync(notificationHiddenPath, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch { return {}; }
}
function notificationUserKey(userId) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Invalid notification user');
  return String(userId);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function startBackend() {
  backendPort = await availablePort();
  const backendDir = isDevelopment ? path.resolve(__dirname, '..', '..', 'backend') : path.join(process.resourcesPath, 'backend');
  const serverPath = path.join(backendDir, 'src', 'server.js');
  if (!fs.existsSync(serverPath)) throw new Error(`Backend missing: ${serverPath}`);
  const dataDir = path.join(stableUserDir, 'pos-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const stableDb = path.join(dataDir, 'pos.sqlite');
  const legacyDb = path.join(legacyDataDir, 'pos.sqlite');
  if (!fs.existsSync(stableDb) && fs.existsSync(legacyDb) && legacyDataDir !== dataDir) {
    fs.cpSync(legacyDataDir, dataDir, { recursive: true, force: false, errorOnExist: false });
  }
  const manifest = isDevelopment
    ? require('../scripts/client-provisioning.cjs').manifestFor(client.clientId)
    : path.join(process.resourcesPath, 'provisioning', 'client.json');
  if (!fs.existsSync(manifest)) throw new Error('Client provisioning is missing. Run npm run client:prepare first.');
  await new Promise((resolve, reject) => {
    const setup = spawn(process.execPath, [path.join(backendDir, 'src', 'apply-provisioning.js'), manifest], {
      cwd: backendDir, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POS_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let errorText = '';
    setup.stdout.on('data', chunk => process.stdout.write(`[POS setup] ${chunk}`));
    setup.stderr.on('data', chunk => { errorText += chunk; process.stderr.write(`[POS setup] ${chunk}`); });
    setup.once('error', reject);
    setup.once('exit', code => code === 0 ? resolve() : reject(new Error(errorText || `Client setup failed (${code})`)));
  });
  backendProcess = spawn(process.execPath, [serverPath], {
    cwd: backendDir,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POS_DATA_DIR: dataDir, PORT: String(backendPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  backendProcess.stdout.on('data', chunk => process.stdout.write(`[POS API] ${chunk}`));
  backendProcess.stderr.on('data', chunk => process.stderr.write(`[POS API] ${chunk}`));
  for (let attempt = 0; attempt < 50; attempt++) {
    if (backendProcess.exitCode !== null) throw new Error('Local POS service exited during startup');
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
      if (response.ok) return;
    } catch { /* Wait for service startup. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Local POS service did not start');
}

function createWindow() {
  const icon = path.resolve(__dirname, '..', 'assets', 'generated', 'icon.png');
  const window = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1024, minHeight: 680,
    show: false, backgroundColor: '#f8fafc',
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    bluetoothSelection = callback;
    window.webContents.send('pos:bluetooth-devices', devices.map(device => ({ id: device.deviceId, name: device.deviceName || 'Unnamed Bluetooth device' })));
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDevelopment ? url.startsWith('http://127.0.0.1:3000/') : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
  if (isDevelopment) window.loadURL('http://127.0.0.1:3000');
  else window.loadFile(path.join(__dirname, '..', 'out', 'index.html'));
}

ipcMain.handle('pos:bluetooth-select', (_event, deviceId) => {
  if (!bluetoothSelection || typeof deviceId !== 'string') throw new Error('No Bluetooth scan is active');
  bluetoothSelection(deviceId);
  bluetoothSelection = null;
  return { ok: true };
});
ipcMain.handle('pos:bluetooth-cancel', () => {
  if (bluetoothSelection) bluetoothSelection('');
  bluetoothSelection = null;
  return { ok: true };
});
ipcMain.handle('pos:open-bluetooth-settings', async () => {
  if (process.platform === 'win32') return shell.openExternal('ms-settings:bluetooth');
  if (process.platform === 'darwin') return shell.openExternal('x-apple.systempreferences:com.apple.Bluetooth');
  if (process.platform === 'linux') {
    for (const [file, args] of [['blueman-manager', []], ['gnome-control-center', ['bluetooth']], ['systemsettings6', ['kcm_bluetooth']]]) {
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(file, args, { detached: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        });
        return { ok: true };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw new Error('Open Bluetooth settings from your Linux desktop environment.');
  }
  throw new Error('Bluetooth settings are unavailable on this operating system.');
});
ipcMain.handle('pos:notifications', (_event, refresh) => readNotifications(refresh === true));
ipcMain.handle('pos:notification-read-get', (_event, userId) => {
  const ids = notificationReadState()[notificationUserKey(userId)];
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
});
ipcMain.handle('pos:notification-read-save', (_event, userId, ids) => {
  if (!Array.isArray(ids) || ids.length > 10_000 || ids.some(id => typeof id !== 'string' || id.length > 160)) throw new Error('Invalid notification read state');
  const state = notificationReadState();
  state[notificationUserKey(userId)] = [...new Set(ids)];
  fs.writeFileSync(notificationReadPath, JSON.stringify(state));
  return { ok: true };
});
ipcMain.handle('pos:notification-hidden-get', (_event, userId) => {
  const ids = notificationHiddenState()[notificationUserKey(userId)];
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
});
ipcMain.handle('pos:notification-hidden-save', (_event, userId, ids) => {
  if (!Array.isArray(ids) || ids.length > 10_000 || ids.some(id => typeof id !== 'string' || id.length > 160)) throw new Error('Invalid notification hidden state');
  const state = notificationHiddenState();
  state[notificationUserKey(userId)] = [...new Set(ids)];
  fs.writeFileSync(notificationHiddenPath, JSON.stringify(state));
  return { ok: true };
});
ipcMain.handle('pos:update-state', () => updateState);
ipcMain.handle('pos:update-start', () => checkForUpdate(true));
ipcMain.handle('pos:update-install', () => {
  installDownloadedUpdate();
  return { ok: true };
});

ipcMain.handle('pos:request', async (_event, input) => {
  if (!backendPort) throw new Error('Local POS service is unavailable');
  if (typeof input?.path !== 'string' || !input.path.startsWith('/') || input.path.startsWith('//')) throw new Error('Invalid API path');
  const method = input.method || 'GET';
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('Invalid API method');
  const response = await fetch(`http://127.0.0.1:${backendPort}/api${input.path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}) },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
});

app.whenReady().then(async () => {
  try { await startBackend(); } catch (error) {
    console.error('[POS startup]', error);
    dialog.showErrorBox('Local POS service', String(error.message || error));
    app.exit(1);
    return;
  }
  createWindow();
  try { setupUpdater(); } catch (error) { console.error('[POS update setup]', error); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (backendProcess && backendProcess.exitCode === null) backendProcess.kill(); });
