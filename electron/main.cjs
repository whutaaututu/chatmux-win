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

    // 打包后用系统 Node.js（避免 node-pty ABI 问题），开发用 Electron 内建
    const nodeExe = app.isPackaged ? 'node' : process.execPath;

    serverProcess = spawn(nodeExe, [serverEntry], {
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

const LOADING_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:100vh; background:#0d1117; color:#c9d1d9; font-family:-apple-system,sans-serif; }
  .logo { font-size:48px; margin-bottom:16px; }
  h1 { font-size:24px; font-weight:600; margin-bottom:8px; }
  p { color:#8b949e; font-size:14px; margin-bottom:24px; }
  .bar { width:200px; height:4px; background:#21262d; border-radius:2px; overflow:hidden; }
  .fill { height:100%; width:30%; background:#58a6ff; border-radius:2px;
    animation:slide 1.5s ease-in-out infinite; }
  @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(430%)} }
</style></head><body>
  <div class="logo">🖥️</div>
  <h1>ChatMux</h1>
  <p>正在启动服务...</p>
  <div class="bar"><div class="fill"></div></div>
</body></html>`;

app.whenReady().then(async () => {
  // 先创建窗口显示启动画面，再启动服务
  createWindow();
  await startServer();
  if (mainWindow) {
    mainWindow.loadURL(`http://localhost:${PORT}`);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ChatMux',
    backgroundColor: '#0d1117',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

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
