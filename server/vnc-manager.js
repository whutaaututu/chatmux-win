import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import net from "net";
import fs from "fs";

const execFileAsync = promisify(execFile);

// 端口分配：VNC 端口从 5900 开始，display 从 :99 开始避免冲突
let nextDisplay = 99;
const MAX_DISPLAY = 299;

const desktops = new Map(); // sessionId -> { display, vncPort, xvfb, x11vnc, windowManager, width, height }

/**
 * 检查端口是否可用
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

/**
 * 查找可用的 display 号
 */
async function findFreeDisplay() {
  for (let d = nextDisplay; d <= MAX_DISPLAY; d++) {
    const port = 5900 + d;
    if (await isPortFree(port)) {
      nextDisplay = d + 1;
      return d;
    }
  }
  throw new Error("没有可用的 display 号");
}

/**
 * 检查依赖是否安装
 */
export async function checkDependencies() {
  const deps = { xvfb: false, x11vnc: false, wm: false, wmName: null };

  try {
    await execFileAsync("which", ["Xvfb"]);
    deps.xvfb = true;
  } catch {}

  try {
    await execFileAsync("which", ["x11vnc"]);
    deps.x11vnc = true;
  } catch {}

  // 尝试找一个窗口管理器
  for (const wm of ["openbox", "fluxbox", "xfwm4", "icewm", "twm", "mutter"]) {
    try {
      await execFileAsync("which", [wm]);
      deps.wm = true;
      deps.wmName = wm;
      break;
    } catch {}
  }

  return deps;
}

/**
 * 启动一个桌面会话
 * @param {string} sessionId - 会话 ID
 * @param {object} options - { width, height, depth }
 * @returns {object} { display, vncPort, password }
 */
export async function startDesktop(sessionId, options = {}) {
  if (desktops.has(sessionId)) {
    const existing = desktops.get(sessionId);
    return { display: existing.display, vncPort: existing.vncPort, password: existing.password };
  }

  const deps = await checkDependencies();
  if (!deps.xvfb) {
    throw new Error("未安装 Xvfb，请运行: apt install xvfb 或 pacman -S xorg-server-xvfb");
  }
  if (!deps.x11vnc) {
    throw new Error("未安装 x11vnc，请运行: apt install x11vnc 或 pacman -S x11vnc");
  }

  const width = options.width || 1280;
  const height = options.height || 800;
  const depth = options.depth || 24;
  const display = await findFreeDisplay();
  const vncPort = 5900 + display;
  const password = randomUUID().slice(0, 8);

  console.log(`[VNC] 启动桌面会话 ${sessionId}: display :${display}, port ${vncPort}`);

  // 1. 启动 Xvfb
  const xvfb = spawn("Xvfb", [
    `:${display}`,
    "-screen", "0", `${width}x${height}x${depth}`,
    "-ac",       // 关闭访问控制
    "-nolisten", "tcp",
    "+extension", "GLX",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  xvfb.on("error", (err) => {
    console.error(`[VNC] Xvfb 启动失败:`, err.message);
    cleanup(sessionId);
  });

  xvfb.on("exit", (code) => {
    console.log(`[VNC] Xvfb 退出: display :${display}, code ${code}`);
    cleanup(sessionId);
  });

  // 等待 Xvfb 就绪（检查 X11 Unix socket 文件）
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Xvfb 启动超时")), 5000);
    const check = setInterval(() => {
      if (fs.existsSync(`/tmp/.X11-unix/X${display}`)) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 200);
  });

  // 2. 启动窗口管理器（可选）
  let wm = null;
  if (deps.wm) {
    try {
      wm = spawn(deps.wmName, [], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DISPLAY: `:${display}` },
        detached: false,
      });
      wm.on("error", () => {});
      wm.on("exit", () => {});
      console.log(`[VNC] 窗口管理器 ${deps.wmName} 已启动 (display :${display})`);
    } catch (e) {
      console.warn(`[VNC] 窗口管理器启动失败: ${e.message}`);
    }
  }

  // 3. 启动 x11vnc
  const vncArgs = [
    "-display", `:${display}`,
    "-rfbport", String(vncPort),
    "-nopw",            // 不使用密码（通过 WebSocket 代理本身做安全控制）
    "-xkb", "-noxrecord", "-noxfixes",
    "-noxdamage",
    "-shared",
    "-forever",         // 客户端断开后不退出
    "-bg",              // 后台运行
    "-o", `/tmp/x11vnc-${sessionId}.log`,
  ];

  // 去掉 Wayland 环境变量，避免 x11vnc 检测到 Wayland 后拒绝运行
  const { WAYLAND_DISPLAY, ...envWithoutWayland } = process.env;
  const x11vnc = spawn("x11vnc", vncArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...envWithoutWayland, DISPLAY: `:${display}` },
    detached: false,
  });

  // x11vnc -bg 模式会立即退出父进程，所以检查它是否快速退出
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(), 2000); // 2秒后假设已启动
    x11vnc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        // bg 模式正常退出，VNC 在后台运行
        resolve();
      } else {
        reject(new Error(`x11vnc 退出，code: ${code}`));
      }
    });
    x11vnc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // 验证 VNC 端口是否在监听
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("VNC 端口监听超时")), 5000);
    const check = setInterval(async () => {
      if (await isPortFree(vncPort) === false) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 300);
  });

  const desktop = {
    sessionId,
    display,
    vncPort,
    password,
    xvfb,
    x11vnc,
    windowManager: wm,
    width,
    height,
    createdAt: Date.now(),
  };

  desktops.set(sessionId, desktop);
  console.log(`[VNC] 桌面会话就绪: :${display} -> port ${vncPort}`);

  return { display, vncPort, password };
}

/**
 * 停止桌面会话
 */
export function stopDesktop(sessionId) {
  cleanup(sessionId);
}

function cleanup(sessionId) {
  const desktop = desktops.get(sessionId);
  if (!desktop) return;

  console.log(`[VNC] 清理桌面会话 ${sessionId} (display :${desktop.display})`);

  try { desktop.xvfb?.kill(); } catch {}
  try { desktop.windowManager?.kill(); } catch {}

  // x11vnc -bg 模式需要单独 kill
  try {
    execFile("killall", ["-q", "-s", "SIGTERM", "--", `x11vnc`], () => {});
  } catch {}

  desktops.delete(sessionId);
}

/**
 * 获取桌面会话信息
 */
export function getDesktop(sessionId) {
  return desktops.get(sessionId) || null;
}

/**
 * 检查桌面是否存活
 */
export function isDesktopAlive(sessionId) {
  const d = desktops.get(sessionId);
  return d ? true : false;
}

/**
 * 获取所有桌面会话
 */
export function getAllDesktops() {
  return [...desktops.values()].map(d => ({
    sessionId: d.sessionId,
    display: d.display,
    vncPort: d.vncPort,
    width: d.width,
    height: d.height,
    createdAt: d.createdAt,
  }));
}

// 进程退出时清理所有桌面
process.on("SIGINT", () => {
  for (const id of desktops.keys()) cleanup(id);
});
process.on("SIGTERM", () => {
  for (const id of desktops.keys()) cleanup(id);
});
