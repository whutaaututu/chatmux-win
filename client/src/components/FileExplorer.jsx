import React, { useState, useEffect, useCallback, useRef } from "react";
import FileEditor from "./FileEditor";
import LogViewer from "./LogViewer";
import FileSearch from "./FileSearch";
import FileDiff from "./FileDiff";
import FilePreview from "./FilePreview";
import OfficeViewer from "./OfficeViewer";

// 判断是否是文本文件（可编辑）
function isTextFile(fileName) {
  const textExtensions = new Set([
    "js", "jsx", "mjs", "ts", "tsx", "py", "rb", "go", "rs", "java",
    "c", "cpp", "h", "hpp", "cs", "php", "swift", "kt", "scala",
    "html", "htm", "css", "scss", "less", "json", "xml", "yaml", "yml",
    "toml", "md", "sql", "sh", "bash", "zsh", "fish", "ps1",
    "dockerfile", "makefile", "txt", "log", "csv", "ini", "conf", "cfg",
    "env", "gitignore", "dockerignore", "editorconfig", "prettierrc",
    "eslintrc", "babelrc",
  ]);
  const ext = fileName.split(".").pop()?.toLowerCase();
  return textExtensions.has(ext) || !fileName.includes(".");
}

// 判断是否是日志文件
function isLogFile(fileName) {
  const logExtensions = new Set(["log", "out", "err", "output"]);
  const ext = fileName.split(".").pop()?.toLowerCase();
  return logExtensions.has(ext) || fileName.includes("log");
}

// 判断是否是可预览文件
function isPreviewable(fileName) {
  const previewExts = new Set([
    "jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico",
    "mp4", "webm", "mov", "avi", "mkv",
    "mp3", "wav", "ogg", "aac", "flac", "m4a",
  ]);
  const ext = fileName.split(".").pop()?.toLowerCase();
  return previewExts.has(ext);
}

// 判断是否是压缩文件
function isArchive(fileName) {
  const archiveExts = new Set(["zip", "tar", "gz", "tgz", "tar.gz", "rar", "7z"]);
  const ext = fileName.split(".").pop()?.toLowerCase();
  return archiveExts.has(ext) || fileName.endsWith(".tar.gz");
}

// 判断是否是 Office 文档
function isOfficeFile(fileName) {
  const officeExts = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
  const ext = fileName.split(".").pop()?.toLowerCase();
  return officeExts.has(ext);
}

export default function FileExplorer({ sessionId, initialPath, onOpenTerminal, onClose }) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([initialPath || "~"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [clipboard, setClipboard] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingFile, setRenamingFile] = useState(null);
  const [newName, setNewName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFile, setEditingFile] = useState(null); // { path, name }
  const [viewingLog, setViewingLog] = useState(null); // { path, name }
  const [showSearch, setShowSearch] = useState(false);
  const [diffFiles, setDiffFiles] = useState(null); // { file1: {path, name}, file2: {path, name} }
  const [compareMode, setCompareMode] = useState(false); // 对比模式
  const [compareFirst, setCompareFirst] = useState(null); // 第一个选中的文件
  const [previewingFile, setPreviewingFile] = useState(null); // { path, name }
  const [viewingOffice, setViewingOffice] = useState(null); // { path, name }
  const [draggingFile, setDraggingFile] = useState(null);

  const fileInputRef = useRef(null);
  const containerRef = useRef(null);

  // 保存状态到服务器
  const saveState = useCallback(async (path, hist, idx) => {
    try {
      await fetch(`/api/sessions/${sessionId}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          explorerState: {
            currentPath: path,
            history: hist,
            historyIndex: idx,
          }
        }),
      });
    } catch (e) {
      console.error("保存状态失败:", e);
    }
  }, [sessionId]);

  // 加载目录内容
  const loadDir = useCallback(async (dirPath, addToHistory = true) => {
    setLoading(true);
    setError(null);
    setSelectedFiles(new Set());
    try {
      const res = await fetch(`/api/ls?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setEntries([]);
      } else {
        setCurrentPath(data.path);
        setEntries(data.entries || []);

        if (addToHistory) {
          const newHistory = [...history.slice(0, historyIndex + 1), data.path];
          const newIndex = newHistory.length - 1;
          setHistory(newHistory);
          setHistoryIndex(newIndex);
          saveState(data.path, newHistory, newIndex);
        }
      }
    } catch (e) {
      setError("加载失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [history, historyIndex, saveState]);

  // 初始化
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        if (data.explorerState) {
          const { currentPath: savedPath, history: savedHistory, historyIndex: savedIndex } = data.explorerState;
          setCurrentPath(savedPath);
          setHistory(savedHistory || [savedPath]);
          setHistoryIndex(savedIndex || 0);
          loadDir(savedPath, false);
        } else {
          loadDir(currentPath, false);
        }
      } catch {
        loadDir(currentPath, false);
      }
    };
    loadSavedState();
    loadClipboard();
    loadTransfers();

    // 点击其他地方隐藏右键菜单
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [sessionId]);

  // 加载剪贴板状态
  const loadClipboard = async () => {
    try {
      const res = await fetch("/api/clipboard");
      const data = await res.json();
      setClipboard(data);
    } catch {}
  };

  // 加载传输任务
  const loadTransfers = async () => {
    try {
      const res = await fetch("/api/transfers");
      const data = await res.json();
      setTransfers(data.filter(t => t.status !== "completed"));
    } catch {}
  };

  // 定期刷新传输进度
  useEffect(() => {
    const interval = setInterval(loadTransfers, 1000);
    return () => clearInterval(interval);
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 路径拼接（处理 Windows 反斜杠）
  const joinPath = (base, name) => {
    const sep = base.includes("\\") ? "\\" : "/";
    if (base.endsWith("/") || base.endsWith("\\")) {
      return base + name;
    }
    return base + sep + name;
  };

  // 进入子目录
  const enterDir = (dirName) => {
    const newPath = joinPath(currentPath, dirName);
    loadDir(newPath);
  };

  // 返回上级目录
  const goUp = () => {
    const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
    loadDir(parentPath);
  };

  // 打开文件编辑器
  const openFile = (fileName) => {
    const filePath = joinPath(currentPath, fileName);
    setEditingFile({ path: filePath, name: fileName });
  };

  // 打开日志查看器
  const openLogViewer = (fileName) => {
    const filePath = joinPath(currentPath, fileName);
    setViewingLog({ path: filePath, name: fileName });
  };

  // 打开文件预览
  const openPreview = (fileName) => {
    const filePath = joinPath(currentPath, fileName);
    setPreviewingFile({ path: filePath, name: fileName });
  };

  // 打开 Office 文档
  const openOffice = (fileName) => {
    const filePath = joinPath(currentPath, fileName);
    setViewingOffice({ path: filePath, name: fileName });
  };

  // 文件对比
  const handleCompare = (fileName) => {
    const filePath = joinPath(currentPath, fileName);

    if (!compareFirst) {
      // 第一个文件
      setCompareFirst({ path: filePath, name: fileName });
    } else {
      // 第二个文件，打开对比
      setDiffFiles({
        file1: compareFirst,
        file2: { path: filePath, name: fileName },
      });
      setCompareFirst(null);
      setCompareMode(false);
    }
  };

  // 切换对比模式
  const toggleCompareMode = () => {
    setCompareMode(!compareMode);
    setCompareFirst(null);
  };

  // 压缩文件
  const compressFiles = async (format = "tar.gz") => {
    if (selectedFiles.size === 0) {
      alert("请先选择要压缩的文件");
      return;
    }

    const files = [...selectedFiles].map(name =>
      currentPath.endsWith("/") ? currentPath + name : currentPath + "/" + name
    );

    const firstFile = [...selectedFiles][0];
    const defaultName = firstFile.replace(/\.[^/.]+$/, "") + ".tar.gz";
    const outputPath = joinPath(currentPath, defaultName);

    try {
      const res = await fetch("/api/files/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, format, outputPath }),
      });

      const data = await res.json();
      if (data.success) {
        refresh();
        alert("压缩完成！");
      } else {
        alert("压缩失败: " + data.error);
      }
    } catch (e) {
      alert("压缩失败: " + e.message);
    }
  };

  // 解压文件
  const extractFile = async (fileName) => {
    const filePath = joinPath(currentPath, fileName);

    try {
      const res = await fetch("/api/files/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, outputPath: currentPath }),
      });

      const data = await res.json();
      if (data.success) {
        refresh();
        alert("解压完成！");
      } else {
        alert("解压失败: " + data.error);
      }
    } catch (e) {
      alert("解压失败: " + e.message);
    }
  };

  // 后退
  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newPath = history[newIndex];
      setHistoryIndex(newIndex);
      setCurrentPath(newPath);
      loadDir(newPath, false);
      saveState(newPath, history, newIndex);
    }
  };

  // 前进
  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const newPath = history[newIndex];
      setHistoryIndex(newIndex);
      setCurrentPath(newPath);
      loadDir(newPath, false);
      saveState(newPath, history, newIndex);
    }
  };

  // 刷新
  const refresh = () => {
    loadDir(currentPath, false);
    loadClipboard();
    loadTransfers();
  };

  // 在终端中打开
  const openInTerminal = () => {
    if (onOpenTerminal) {
      onOpenTerminal(currentPath);
    }
  };

  // 选择文件
  const toggleSelect = (fileName, e) => {
    e.stopPropagation();
    setContextMenu(null); // 隐藏右键菜单
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(fileName)) {
          next.delete(fileName);
        } else {
          next.add(fileName);
        }
      } else {
        next.clear();
        next.add(fileName);
      }
      return next;
    });
  };

  // 全选
  const selectAll = () => {
    setSelectedFiles(new Set(entries.map(e => e.name)));
  };

  // 取消选择
  const deselectAll = () => {
    setSelectedFiles(new Set());
  };

  // 复制文件
  const copyFiles = async () => {
    const files = [...selectedFiles].map(name => ({
      path: currentPath + "/" + name,
      name,
    }));
    try {
      await fetch("/api/clipboard/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      loadClipboard();
      deselectAll();
    } catch (e) {
      alert("复制失败: " + e.message);
    }
  };

  // 剪切文件
  const cutFiles = async () => {
    const files = [...selectedFiles].map(name => ({
      path: currentPath + "/" + name,
      name,
    }));
    try {
      await fetch("/api/clipboard/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      loadClipboard();
      deselectAll();
    } catch (e) {
      alert("剪切失败: " + e.message);
    }
  };

  // 粘贴文件
  const pasteFiles = async () => {
    try {
      const res = await fetch("/api/clipboard/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDir: currentPath }),
      });
      const results = await res.json();
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        alert("部分文件粘贴失败:\n" + failed.map(f => f.from + ": " + f.error).join("\n"));
      }
      refresh();
    } catch (e) {
      alert("粘贴失败: " + e.message);
    }
  };

  // 删除文件
  const deleteSelected = async () => {
    if (selectedFiles.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedFiles.size} 个项目吗？`)) return;

    const files = [...selectedFiles].map(name => currentPath + "/" + name);
    try {
      await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      refresh();
    } catch (e) {
      alert("删除失败: " + e.message);
    }
  };

  // 重命名
  const startRename = (fileName) => {
    setRenamingFile(fileName);
    setNewName(fileName);
    setContextMenu(null);
  };

  const confirmRename = async () => {
    if (!newName.trim() || newName === renamingFile) {
      setRenamingFile(null);
      return;
    }
    try {
      await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPath: currentPath + "/" + renamingFile,
          newName: newName.trim(),
        }),
      });
      setRenamingFile(null);
      refresh();
    } catch (e) {
      alert("重命名失败: " + e.message);
    }
  };

  // 创建新文件夹
  const createNewFolder = async () => {
    if (!newFolderName.trim()) {
      setShowNewFolder(false);
      return;
    }
    try {
      await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: currentPath,
          name: newFolderName.trim(),
        }),
      });
      setShowNewFolder(false);
      setNewFolderName("");
      refresh();
    } catch (e) {
      alert("创建文件夹失败: " + e.message);
    }
  };

  // 上传文件
  const handleUpload = async (files) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }
    try {
      const res = await fetch(`/api/upload?path=${encodeURIComponent(currentPath)}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        refresh();
      }
    } catch (e) {
      alert("上传失败: " + e.message);
    }
  };

  // 下载文件
  const downloadFile = (fileName) => {
    const filePath = currentPath + "/" + fileName;
    window.open(`/api/download-file?path=${encodeURIComponent(filePath)}`, "_blank");
  };

  // 拖拽上传处理
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === containerRef.current) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUpload(files);
    }
  };

  // 点击空白区域取消选择
  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget) {
      deselectAll();
    }
    setContextMenu(null);
  };

  // 右键菜单
  const handleContextMenu = (e, fileName = null) => {
    e.preventDefault();
    e.stopPropagation();

    if (fileName && !selectedFiles.has(fileName)) {
      setSelectedFiles(new Set([fileName]));
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      fileName,
    });
  };

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // 获取文件图标
  const getIcon = (name, isDirectory) => {
    if (isDirectory) return "📂";
    const ext = name.split(".").pop()?.toLowerCase();
    const iconMap = {
      js: "📜", jsx: "⚛️", ts: "📘", tsx: "⚛️",
      py: "🐍", rb: "💎", go: "🔵", rs: "🦀",
      html: "🌐", css: "🎨", json: "📋", md: "📝",
      txt: "📄", log: "📊", yml: "⚙️", yaml: "⚙️",
      sh: "🐚", bash: "🐚",
      jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", svg: "🖼️",
      mp3: "🎵", wav: "🎵", mp4: "🎬", avi: "🎬",
      zip: "📦", tar: "📦", gz: "📦", rar: "📦",
    };
    return iconMap[ext] || "📄";
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const hasClipboard = clipboard.length > 0;

  return (
    <div
      ref={containerRef}
      style={{
        ...styles.container,
        ...(isDragging ? styles.dragging : {}),
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleBackgroundClick}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* 拖拽遮罩 */}
      {isDragging && (
        <div style={styles.dropOverlay}>
          <div style={styles.dropIcon}>📥</div>
          <div style={styles.dropText}>拖放文件到此处上传</div>
        </div>
      )}

      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <button
            style={{ ...styles.navBtn, opacity: canGoBack ? 1 : 0.4 }}
            onClick={goBack}
            disabled={!canGoBack}
            title="后退"
          >
            ⬅️
          </button>
          <button
            style={{ ...styles.navBtn, opacity: canGoForward ? 1 : 0.4 }}
            onClick={goForward}
            disabled={!canGoForward}
            title="前进"
          >
            ➡️
          </button>
          <button style={styles.navBtn} onClick={goUp} title="上级目录">
            ⬆️
          </button>
          <button style={styles.navBtn} onClick={refresh} title="刷新">
            🔄
          </button>
        </div>

        <div style={styles.pathBar}>
          <span style={styles.pathIcon}>📍</span>
          <span style={styles.pathText}>{currentPath}</span>
        </div>

        <div style={styles.toolbarRight}>
          <button style={styles.actionBtn} onClick={() => setShowSearch(true)} title="搜索文件">
            🔍
          </button>
          <button
            style={{
              ...styles.actionBtn,
              ...(compareMode ? styles.actionBtnActive : {})
            }}
            onClick={toggleCompareMode}
            title={compareMode ? "取消对比" : "文件对比"}
          >
            📊
          </button>
          <button style={styles.actionBtn} onClick={() => setShowNewFolder(true)} title="新建文件夹">
            📁+
          </button>
          <button style={styles.actionBtn} onClick={() => fileInputRef.current?.click()} title="上传文件">
            📤
          </button>
          <button style={styles.terminalBtn} onClick={openInTerminal} title="在终端中打开">
            💻
          </button>
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleUpload(e.target.files)}
      />

      {/* 内容区域 */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.centerMessage}>
            <div style={styles.spinner}>⏳</div>
            <span>加载中...</span>
          </div>
        ) : error ? (
          <div style={styles.centerMessage}>
            <span style={{ color: "#f85149" }}>❌ {error}</span>
            <button style={styles.retryBtn} onClick={refresh}>重试</button>
          </div>
        ) : entries.length === 0 ? (
          <div style={styles.centerMessage}>
            <span style={styles.emptyIcon}>📂</span>
            <span>空文件夹</span>
            <button style={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
              上传文件
            </button>
          </div>
        ) : (
          <div style={styles.fileList}>
            {/* 对比模式提示 */}
            {compareMode && (
              <div style={styles.compareHint}>
                📊 对比模式：{compareFirst
                  ? `已选择 "${compareFirst.name}"，请点击第二个文件`
                  : "请点击第一个文件"
                }
              </div>
            )}
            {/* 表头 */}
            <div style={styles.tableHeader}>
              <span style={styles.colCheckbox}>
                <input
                  type="checkbox"
                  checked={selectedFiles.size === entries.length && entries.length > 0}
                  onChange={(e) => e.target.checked ? selectAll() : deselectAll()}
                />
              </span>
              <span style={styles.colName}>名称</span>
              <span style={styles.colSize}>大小</span>
            </div>

            {/* 新建文件夹输入框 */}
            {showNewFolder && (
              <div style={styles.fileRow}>
                <span style={styles.colCheckbox}></span>
                <span style={styles.fileIcon}>📁</span>
                <input
                  style={styles.newFolderInput}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createNewFolder();
                    if (e.key === "Escape") setShowNewFolder(false);
                  }}
                  onBlur={createNewFolder}
                  placeholder="新建文件夹名称"
                  autoFocus
                />
              </div>
            )}

            {/* 返回上级目录 */}
            <div style={styles.fileRow} onClick={goUp}>
              <span style={styles.colCheckbox}></span>
              <span style={styles.fileIcon}>📁</span>
              <span style={styles.fileName}>..</span>
              <span style={styles.fileSize}>-</span>
            </div>

            {/* 文件和文件夹列表 */}
            {entries.map((entry) => (
              <div
                key={entry.name}
                style={{
                  ...styles.fileRow,
                  ...(selectedFiles.has(entry.name) ? styles.fileRowSelected : {}),
                }}
                onClick={(e) => {
                  if (compareMode && !entry.isDirectory) {
                    // 对比模式：选择文件进行对比
                    handleCompare(entry.name);
                  } else if (e.detail === 2) {
                    if (entry.isDirectory) {
                      enterDir(entry.name);
                    } else if (isLogFile(entry.name)) {
                      openLogViewer(entry.name);
                    } else if (isOfficeFile(entry.name)) {
                      openOffice(entry.name);
                    } else if (isPreviewable(entry.name)) {
                      openPreview(entry.name);
                    } else if (isTextFile(entry.name)) {
                      openFile(entry.name);
                    }
                  } else {
                    toggleSelect(entry.name, e);
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, entry.name)}
              >
                <span style={styles.colCheckbox}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(entry.name)}
                    onChange={() => {}}
                  />
                </span>
                <span style={styles.fileIcon}>
                  {getIcon(entry.name, entry.isDirectory)}
                </span>
                {renamingFile === entry.name ? (
                  <input
                    style={styles.renameInput}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename();
                      if (e.key === "Escape") setRenamingFile(null);
                    }}
                    onBlur={confirmRename}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span style={styles.fileName}>{entry.name}</span>
                )}
                <span style={styles.fileSize}>
                  {entry.isDirectory ? "-" : formatSize(entry.size)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div style={styles.footer}>
        <span style={styles.footerText}>
          {loading ? "加载中..." : (
            <>
              {entries.filter(e => e.isDirectory).length} 个文件夹，{entries.filter(e => !e.isDirectory).length} 个文件
              {selectedFiles.size > 0 && ` | 已选择 ${selectedFiles.size} 项`}
              {hasClipboard && ` | 剪贴板 ${clipboard.length} 项`}
            </>
          )}
        </span>
      </div>

      {/* 传输进度 */}
      {transfers.length > 0 && (
        <div style={styles.transferBar}>
          {transfers.map(task => (
            <div key={task.id} style={styles.transferItem}>
              <span style={styles.transferIcon}>
                {task.type === "upload" ? "📤" : "📥"}
              </span>
              <span style={styles.transferName}>{task.fileName}</span>
              <div style={styles.progressBar}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${(task.transferred / task.totalSize) * 100}%`,
                  }}
                />
              </div>
              <span style={styles.transferSize}>
                {formatSize(task.transferred)} / {formatSize(task.totalSize)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 文件编辑器 */}
      {editingFile && (
        <div style={styles.editorOverlay}>
          <FileEditor
            filePath={editingFile.path}
            fileName={editingFile.name}
            onClose={() => setEditingFile(null)}
            onSave={() => refresh()}
          />
        </div>
      )}

      {/* 日志查看器 */}
      {viewingLog && (
        <div style={styles.editorOverlay}>
          <LogViewer
            filePath={viewingLog.path}
            fileName={viewingLog.name}
            onClose={() => setViewingLog(null)}
          />
        </div>
      )}

      {/* 文件搜索 */}
      {showSearch && (
        <div style={styles.editorOverlay}>
          <FileSearch
            searchPath={currentPath}
            onClose={() => setShowSearch(false)}
            onOpenFile={(path, name) => {
              setShowSearch(false);
              if (isLogFile(name)) {
                setViewingLog({ path, name });
              } else if (isTextFile(name)) {
                setEditingFile({ path, name });
              }
            }}
            onOpenFolder={(path) => {
              setShowSearch(false);
              loadDir(path);
            }}
          />
        </div>
      )}

      {/* 文件对比 */}
      {diffFiles && (
        <div style={styles.editorOverlay}>
          <FileDiff
            file1Path={diffFiles.file1.path}
            file1Name={diffFiles.file1.name}
            file2Path={diffFiles.file2.path}
            file2Name={diffFiles.file2.name}
            onClose={() => setDiffFiles(null)}
          />
        </div>
      )}

      {/* 文件预览 */}
      {previewingFile && (
        <div style={styles.editorOverlay}>
          <FilePreview
            filePath={previewingFile.path}
            fileName={previewingFile.name}
            onClose={() => setPreviewingFile(null)}
          />
        </div>
      )}

      {/* Office 文档查看 */}
      {viewingOffice && (
        <div style={styles.editorOverlay}>
          <OfficeViewer
            filePath={viewingOffice.path}
            fileName={viewingOffice.name}
            onClose={() => setViewingOffice(null)}
          />
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.fileName ? (
            <>
              <button style={styles.menuItem} onClick={() => {
                copyFiles();
                setContextMenu(null);
              }}>
                📋 复制
              </button>
              <button style={styles.menuItem} onClick={() => {
                cutFiles();
                setContextMenu(null);
              }}>
                ✂️ 剪切
              </button>
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory && (
                <button style={styles.menuItem} onClick={() => {
                  downloadFile(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  📥 下载
                </button>
              )}
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory &&
               isTextFile(contextMenu.fileName) && (
                <button style={styles.menuItem} onClick={() => {
                  openFile(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  ✏️ 编辑
                </button>
              )}
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory &&
               isLogFile(contextMenu.fileName) && (
                <button style={styles.menuItem} onClick={() => {
                  openLogViewer(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  📊 查看日志
                </button>
              )}
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory &&
               isPreviewable(contextMenu.fileName) && (
                <button style={styles.menuItem} onClick={() => {
                  openPreview(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  👁️ 预览
                </button>
              )}
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory &&
               isOfficeFile(contextMenu.fileName) && (
                <button style={styles.menuItem} onClick={() => {
                  openOffice(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  📄 查看文档
                </button>
              )}
              {!entries.find(e => e.name === contextMenu.fileName)?.isDirectory &&
               isArchive(contextMenu.fileName) && (
                <button style={styles.menuItem} onClick={() => {
                  extractFile(contextMenu.fileName);
                  setContextMenu(null);
                }}>
                  📦 解压
                </button>
              )}
              <div style={styles.menuDivider} />
              {selectedFiles.size > 0 && (
                <button style={styles.menuItem} onClick={() => {
                  compressFiles("tar.gz");
                  setContextMenu(null);
                }}>
                  📦 压缩为 TAR.GZ
                </button>
              )}
              <div style={styles.menuDivider} />
              <button style={styles.menuItem} onClick={() => {
                startRename(contextMenu.fileName);
                setContextMenu(null);
              }}>
                ✏️ 重命名
              </button>
              <button style={{ ...styles.menuItem, color: "#f85149" }} onClick={() => {
                deleteSelected();
                setContextMenu(null);
              }}>
                🗑️ 删除
              </button>
            </>
          ) : (
            <>
              {hasClipboard && (
                <button style={styles.menuItem} onClick={() => {
                  pasteFiles();
                  setContextMenu(null);
                }}>
                  📋 粘贴
                </button>
              )}
              <button style={styles.menuItem} onClick={() => {
                setShowNewFolder(true);
                setContextMenu(null);
              }}>
                📁 新建文件夹
              </button>
              <button style={styles.menuItem} onClick={() => {
                fileInputRef.current?.click();
                setContextMenu(null);
              }}>
                📤 上传文件
              </button>
              <div style={styles.menuDivider} />
              <button style={styles.menuItem} onClick={() => {
                selectAll();
                setContextMenu(null);
              }}>
                ✅ 全选
              </button>
              <button style={styles.menuItem} onClick={() => {
                refresh();
                setContextMenu(null);
              }}>
                🔄 刷新
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#0d1117",
    color: "#c9d1d9",
    position: "relative",
  },
  dragging: {
    outline: "2px dashed #58a6ff",
    outlineOffset: -2,
  },
  dropOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(88, 166, 255, 0.1)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    pointerEvents: "none",
  },
  dropIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  dropText: {
    fontSize: 18,
    color: "#58a6ff",
    fontWeight: 600,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    padding: "8px 12px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    gap: 8,
    flexShrink: 0,
  },
  toolbarLeft: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
  },
  toolbarRight: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  navBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 14,
    flexShrink: 0,
  },
  actionBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 13,
    flexShrink: 0,
  },
  actionBtnActive: {
    background: "#0e639c",
    borderColor: "#58a6ff",
  },
  compareHint: {
    padding: "8px 16px",
    background: "rgba(88,166,255,0.1)",
    borderBottom: "1px solid #30363d",
    fontSize: 13,
    color: "#58a6ff",
    textAlign: "center",
  },
  pathBar: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#0d1117",
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #30363d",
    overflow: "hidden",
  },
  pathIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  pathText: {
    fontSize: 13,
    color: "#58a6ff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  terminalBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflow: "auto",
  },
  centerMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 12,
    color: "#8b949e",
  },
  spinner: {
    fontSize: 32,
    animation: "spin 1s linear infinite",
  },
  emptyIcon: {
    fontSize: 48,
  },
  retryBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    color: "#c9d1d9",
    fontSize: 13,
  },
  uploadBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 8,
  },
  fileList: {
    padding: "4px 0",
  },
  tableHeader: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #21262d",
    fontSize: 12,
    color: "#8b949e",
    fontWeight: 500,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  colCheckbox: {
    width: 32,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  colName: {
    flex: 1,
    minWidth: 0,
  },
  colSize: {
    width: 80,
    flexShrink: 0,
    textAlign: "right",
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  fileRowSelected: {
    background: "rgba(88, 166, 255, 0.15)",
  },
  fileIcon: {
    width: 24,
    fontSize: 16,
    flexShrink: 0,
    textAlign: "center",
    marginRight: 8,
  },
  fileName: {
    flex: 1,
    fontSize: 14,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  fileSize: {
    width: 80,
    fontSize: 12,
    color: "#8b949e",
    textAlign: "right",
    flexShrink: 0,
  },
  renameInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #58a6ff",
    borderRadius: 4,
    padding: "4px 8px",
    color: "#c9d1d9",
    fontSize: 14,
    outline: "none",
  },
  newFolderInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #58a6ff",
    borderRadius: 4,
    padding: "4px 8px",
    color: "#c9d1d9",
    fontSize: 14,
    outline: "none",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 16px",
    background: "#161b22",
    borderTop: "1px solid #30363d",
    fontSize: 12,
    color: "#8b949e",
    flexShrink: 0,
  },
  footerText: {},
  transferBar: {
    padding: "8px 16px",
    background: "#161b22",
    borderTop: "1px solid #30363d",
    maxHeight: 120,
    overflowY: "auto",
    flexShrink: 0,
  },
  transferItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
    fontSize: 12,
  },
  transferIcon: {
    fontSize: 14,
    flexShrink: 0,
  },
  transferName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  progressBar: {
    width: 100,
    height: 4,
    background: "#21262d",
    borderRadius: 2,
    overflow: "hidden",
    flexShrink: 0,
  },
  progressFill: {
    height: "100%",
    background: "#58a6ff",
    transition: "width 0.3s",
  },
  transferSize: {
    fontSize: 11,
    color: "#8b949e",
    flexShrink: 0,
    width: 100,
    textAlign: "right",
  },
  contextMenu: {
    position: "fixed",
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "4px 0",
    zIndex: 1000,
    minWidth: 160,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "8px 16px",
    background: "none",
    border: "none",
    color: "#c9d1d9",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
  },
  menuDivider: {
    height: 1,
    background: "#30363d",
    margin: "4px 0",
  },
  editorOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 500,
    background: "#1e1e1e",
  },
};

// CSS
const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .file-row:hover {
    background: rgba(88, 166, 255, 0.1) !important;
  }
  input[type="checkbox"] {
    accent-color: #58a6ff;
  }
`;
document.head.appendChild(style);
