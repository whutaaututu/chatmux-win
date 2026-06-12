import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { basename, dirname, join, relative, resolve } from "path";
import { readdir, stat, unlink, rename, copyFile, readFile, writeFile, mkdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { execSync, exec, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import os from "os";
import multer from "multer";
import {
  createSession,
  getSession,
  getSessionBuffer,
  getAllSessions,
  writeToSession,
  resizeSession,
  removeSession,
  renameSession,
  updateSessionState,
  restoreSessions,
  restartSession,
} from "./pty-manager.js";
import { transferManager, fileClipboard, deleteFiles } from "./file-ops.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const defaultShell = isWindows ? "powershell.exe" : "bash";

function expandHome(p) {
  if (p === "~" || p.startsWith("~/")) {
    return join(os.homedir(), p.slice(1));
  }
  return p;
}

async function createTarGzArchive(sourceFiles, output) {
  const baseDir = dirname(sourceFiles[0]);
  const skipPath = resolve(output);
  const entries = sourceFiles
    .filter((sourceFile) => resolve(sourceFile) !== skipPath)
    .map((sourceFile) => relative(baseDir, sourceFile) || basename(sourceFile));

  if (entries.length === 0) {
    throw new Error("没有可压缩的文件");
  }

  await execFileAsync("tar", ["-czf", output, "-C", baseDir, "--", ...entries]);
}

function bindPty(ws, session) {
  if (!session.pty) return;

  // 存储监听器引用，以便后续移除
  const listeners = {
    onData: null,
    onExit: null,
  };

  listeners.onData = session.pty.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  listeners.onExit = session.pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
    }
  });

  // WebSocket 关闭时移除监听器
  ws.on("close", () => {
    if (listeners.onData) {
      listeners.onData.dispose();
      listeners.onData = null;
    }
    if (listeners.onExit) {
      listeners.onExit.dispose();
      listeners.onExit = null;
    }
  });
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.static(join(__dirname, "../client/dist")));
app.use(express.json());

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = req.query.path || os.homedir();
    cb(null, expandHome(targetDir));
  },
  filename: (req, file, cb) => {
    // 处理中文文件名
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, originalName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB 限制
});

// REST: 下载项目包
app.get("/api/download", (req, res) => {
  const projectDir = join(__dirname, "..");
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", "attachment; filename=chatmux.tar.gz");
  try {
    const archive = execSync(
      `tar czf - -C "${projectDir}" --exclude=node_modules --exclude=dist --exclude=sessions.json .`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    res.send(archive);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 列出所有会话
app.get("/api/sessions", (req, res) => {
  res.json(getAllSessions());
});

// REST: 获取单个会话
app.get("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "会话不存在" });
  }
  const { pty, buffer, ...rest } = session;
  res.json({
    ...rest,
    type: rest.type || (rest.command === "__folder__" ? "folder" : "terminal"),
  });
});

// REST: 重命名会话
app.patch("/api/sessions/:id", (req, res) => {
  const { label } = req.body;
  if (label) renameSession(req.params.id, label);
  res.json({ ok: true });
});

// REST: 删除会话
app.delete("/api/sessions/:id", (req, res) => {
  removeSession(req.params.id);
  res.json({ ok: true });
});

// REST: 更新会话状态（用于文件浏览器状态同步）
app.patch("/api/sessions/:id/state", (req, res) => {
  const { explorerState } = req.body;
  if (explorerState) {
    updateSessionState(req.params.id, explorerState);
  }
  res.json({ ok: true });
});

// REST: 浏览目录
app.get("/api/ls", async (req, res) => {
  try {
    const rawPath = req.query.path || "~";
    const dirPath = resolve(expandHome(rawPath));
    const entries = await readdir(dirPath);
    const items = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      try {
        const s = await stat(join(dirPath, entry));
        items.push({
          name: entry,
          isDirectory: s.isDirectory(),
          size: s.size,
          mtime: s.mtime,
        });
      } catch {}
    }
    // 按类型排序：文件夹在前，文件在后，然后按名称排序
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: dirPath, entries: items });
  } catch (e) {
    res.json({ path: req.query.path, entries: [], error: e.message });
  }
});

// REST: 文件上传
app.post("/api/upload", upload.array("files"), (req, res) => {
  try {
    const files = req.files.map(f => ({
      name: f.filename,
      size: f.size,
      path: f.path,
    }));
    res.json({ success: true, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 文件下载
app.get("/api/download-file", async (req, res) => {
  try {
    const filePath = expandHome(req.query.path);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "文件不存在" });
    }

    const fileStat = await stat(filePath);

    // 检查是否是文件（不是目录）
    if (!fileStat.isFile()) {
      return res.status(400).json({ error: "不能下载文件夹" });
    }

    const fileName = filePath.split("/").pop();

    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", fileStat.size);

    const readStream = createReadStream(filePath);

    // 处理流错误
    readStream.on("error", (err) => {
      console.error("文件读取错误:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    readStream.pipe(res);
  } catch (e) {
    console.error("下载错误:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// REST: 删除文件
app.delete("/api/files", async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: "files 必须是数组" });
    }
    const results = await deleteFiles(files);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 复制文件到剪贴板
app.post("/api/clipboard/copy", (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: "files 必须是数组" });
    }
    fileClipboard.copy(files);
    res.json({ success: true, count: files.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 剪切文件到剪贴板
app.post("/api/clipboard/cut", (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: "files 必须是数组" });
    }
    fileClipboard.cut(files);
    res.json({ success: true, count: files.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 粘贴文件
app.post("/api/clipboard/paste", async (req, res) => {
  try {
    const { targetDir } = req.body;
    const results = await fileClipboard.paste(expandHome(targetDir));
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 获取剪贴板状态
app.get("/api/clipboard", (req, res) => {
  res.json(fileClipboard.getClipboard());
});

// REST: 获取传输任务列表
app.get("/api/transfers", (req, res) => {
  res.json(transferManager.getAllTasks());
});

// REST: 重命名文件
app.post("/api/files/rename", async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    const dir = dirname(oldPath);
    const newPath = join(dir, newName);
    await rename(oldPath, newPath);
    res.json({ success: true, newPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 创建文件夹
app.post("/api/files/mkdir", async (req, res) => {
  try {
    const { path, name } = req.body;
    const dirPath = join(expandHome(path), name);
    await mkdir(dirPath, { recursive: true });
    res.json({ success: true, path: dirPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 压缩文件（仅支持 tar.gz）
app.post("/api/files/compress", async (req, res) => {
  try {
    const { files, outputPath } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "请选择要压缩的文件" });
    }

    const sourceFiles = files.map(f => expandHome(f));
    const output = expandHome(outputPath);

    // 确保输出目录存在
    const outputDir = dirname(output);
    await mkdir(outputDir, { recursive: true });

    await createTarGzArchive(sourceFiles, output);

    res.json({ success: true, outputPath: output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 解压文件
app.post("/api/files/extract", async (req, res) => {
  try {
    const { filePath, outputPath } = req.body;
    const source = expandHome(filePath);
    const output = expandHome(outputPath || source.substring(0, source.lastIndexOf("/")));

    // 确保输出目录存在
    await mkdir(output, { recursive: true });

    let command;
    if (source.endsWith(".zip")) {
      command = `unzip -o "${source}" -d "${output}"`;
    } else if (source.endsWith(".tar.gz") || source.endsWith(".tgz")) {
      command = `tar -xzf "${source}" -C "${output}"`;
    } else if (source.endsWith(".tar")) {
      command = `tar -xf "${source}" -C "${output}"`;
    } else if (source.endsWith(".gz")) {
      command = `gunzip -k "${source}"`;
    } else {
      return res.status(400).json({ error: "不支持的压缩格式" });
    }

    await execAsync(command);
    res.json({ success: true, outputPath: output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 文件搜索
app.get("/api/search", async (req, res) => {
  try {
    const { path, query, type = "name", regex = false, caseSensitive = false } = req.query;
    const searchPath = expandHome(path || "~");

    if (!query) {
      return res.json({ results: [] });
    }

    const results = [];
    const maxResults = 100;

    async function searchDir(dirPath, depth = 0) {
      if (depth > 5 || results.length >= maxResults) return; // 限制深度和结果数

      try {
        const entries = await readdir(dirPath);
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.startsWith(".")) continue; // 跳过隐藏文件

          const fullPath = join(dirPath, entry);
          try {
            const fileStat = await stat(fullPath);

            if (type === "name" || type === "both") {
              // 搜索文件名
              const nameMatch = regex
                ? new RegExp(query, caseSensitive ? "" : "i").test(entry)
                : caseSensitive
                  ? entry.includes(query)
                  : entry.toLowerCase().includes(query.toLowerCase());

              if (nameMatch) {
                results.push({
                  path: fullPath,
                  name: entry,
                  isDirectory: fileStat.isDirectory(),
                  size: fileStat.size,
                  matchType: "name",
                });
              }
            }

            if ((type === "content" || type === "both") && fileStat.isFile()) {
              // 搜索文件内容（只搜索文本文件，限制文件大小）
              if (fileStat.size < 1024 * 1024) { // 小于 1MB
                try {
                  const content = await readFile(fullPath, "utf-8");
                  const contentMatch = regex
                    ? new RegExp(query, caseSensitive ? "" : "i").test(content)
                    : caseSensitive
                      ? content.includes(query)
                      : content.toLowerCase().includes(query.toLowerCase());

                  if (contentMatch) {
                    // 找到匹配的行
                    const lines = content.split("\n");
                    const matchedLines = [];
                    for (let i = 0; i < lines.length; i++) {
                      const lineMatch = regex
                        ? new RegExp(query, caseSensitive ? "" : "i").test(lines[i])
                        : caseSensitive
                          ? lines[i].includes(query)
                          : lines[i].toLowerCase().includes(query.toLowerCase());

                      if (lineMatch) {
                        matchedLines.push({
                          lineNumber: i + 1,
                          content: lines[i].trim().substring(0, 200),
                        });
                        if (matchedLines.length >= 3) break; // 最多显示3个匹配行
                      }
                    }

                    results.push({
                      path: fullPath,
                      name: entry,
                      isDirectory: false,
                      size: fileStat.size,
                      matchType: "content",
                      matchedLines,
                    });
                  }
                } catch {}
              }
            }

            // 递归搜索子目录
            if (fileStat.isDirectory()) {
              await searchDir(fullPath, depth + 1);
            }
          } catch {}
        }
      } catch {}
    }

    await searchDir(searchPath);
    res.json({ results, total: results.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 读取文件内容
app.get("/api/file-content", async (req, res) => {
  try {
    const filePath = expandHome(req.query.path);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "文件不存在" });
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return res.status(400).json({ error: "不是文件" });
    }

    // 限制文件大小（10MB）
    if (fileStat.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "文件太大，无法编辑（最大 10MB）" });
    }

    const content = await readFile(filePath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REST: 保存文件内容
app.put("/api/file-content", async (req, res) => {
  try {
    const filePath = expandHome(req.query.path);

    // 收集请求体数据
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        await writeFile(filePath, body, "utf-8");
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WebSocket
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get("action");
  const sessionId = url.searchParams.get("sessionId");

  if (action === "create") {
    const command = url.searchParams.get("command") || defaultShell;
    const args = (url.searchParams.get("args") || "").split(",").filter(Boolean);
    const cols = parseInt(url.searchParams.get("cols")) || 80;
    const rows = parseInt(url.searchParams.get("rows")) || 24;
    const cwd = url.searchParams.get("cwd")
      ? resolve(expandHome(url.searchParams.get("cwd")))
      : undefined;

    const session = createSession(command, args, { cols, rows, cwd });

    ws.send(JSON.stringify({ type: "created", sessionId: session.id, command }));

    bindPty(ws, session);

    ws.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "input") {
          writeToSession(session.id, parsed.data);
        } else if (parsed.type === "resize") {
          resizeSession(session.id, parsed.cols, parsed.rows);
        }
      } catch {
        writeToSession(session.id, msg.toString());
      }
    });

    ws.on("close", () => {
      // 不销毁，PTY 继续跑
    });
  } else if (action === "attach" && sessionId) {
    let session = getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
      ws.close();
      return;
    }

    // 如果会话已退出，重新启动 PTY
    if (!session.alive) {
      session = restartSession(sessionId);
    }

    ws.send(JSON.stringify({ type: "attached", sessionId: session.id, command: session.command }));

    // 发送历史缓冲
    const history = getSessionBuffer(sessionId);
    if (history) {
      ws.send(JSON.stringify({ type: "output", data: history }));
    }

    // 触发 PTY 重绘
    if (session.alive && session.pty) {
      const { cols, rows } = session.pty;
      session.pty.resize(cols + 1, rows);
      session.pty.resize(cols, rows);
    }

    bindPty(ws, session);

    ws.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "input") {
          writeToSession(sessionId, parsed.data);
        } else if (parsed.type === "resize") {
          resizeSession(sessionId, parsed.cols, parsed.rows);
        }
      } catch {
        writeToSession(sessionId, msg.toString());
      }
    });

    ws.on("close", () => {
      // 不销毁
    });
  }
});

// 启动时恢复会话
console.log("ChatMux 正在恢复会话...");
restoreSessions();

const PORT = process.env.PORT || 9910;
server.listen(PORT, () => {
  console.log(`ChatMux server running on http://localhost:${PORT}`);
});
