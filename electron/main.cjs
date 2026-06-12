const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 9910;

let serverProcess = null;
let mainWindow = null;

function startServer() {
  return new Promise((resolve) => {
    const serverDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server')
      : path.join(__dirname, '..', 'server');

    const serverEntry = path.join(serverDir, 'index.js');

    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('running')) resolve();
    });

    serverProcess.stderr.on('data', (d) => {
      console.error('[ChatMux]', d.toString().trim());
    });

    // Poll until server responds
    let attempts = 0;
    const check = setInterval(() => {
      http.get(`http://localhost:${PORT}/api/sessions`, () => {
        clearInterval(check);
        resolve();
      }).on('error', () => {
        if (++attempts > 40) {
          clearInterval(check);
          resolve();
        }
      });
    }, 250);

    serverProcess.on('error', (err) => {
      console.error('[ChatMux] Failed to start server:', err.message);
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ChatMux',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.CHATMUX_DEVTOOLS) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
