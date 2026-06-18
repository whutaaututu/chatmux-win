import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Editor from "@monaco-editor/react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

// 文件类型映射
const LANGUAGE_MAP = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  dockerfile: "dockerfile",
  makefile: "makefile",
  txt: "plaintext",
  log: "plaintext",
  csv: "plaintext",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  env: "plaintext",
  gitignore: "plaintext",
  dockerignore: "plaintext",
  editorconfig: "ini",
  prettierrc: "json",
  eslintrc: "json",
  babelrc: "json",
};

// 获取文件语言
function getLanguage(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return LANGUAGE_MAP[ext] || "plaintext";
}

// 判断是否是 Markdown 文件
function isMarkdown(fileName) {
  return fileName.toLowerCase().endsWith(".md");
}

// 判断是否是文本文件（可编辑）
function isTextFile(fileName) {
  const textExtensions = new Set(Object.keys(LANGUAGE_MAP));
  const ext = fileName.split(".").pop()?.toLowerCase();
  return textExtensions.has(ext) || !fileName.includes(".");
}

export default function FileEditor({ filePath, fileName, onClose, onSave }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [modified, setModified] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const editorRef = useRef(null);
  const language = getLanguage(fileName);
  const isMd = isMarkdown(fileName);

  // 缓存行数和字节数，避免每次渲染重新计算
  const { lineCount, byteSize } = useMemo(() => ({
    lineCount: content.split("\n").length,
    byteSize: new Blob([content]).size,
  }), [content]);

  // 加载文件内容
  useEffect(() => {
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "加载失败");
        }
        const text = await res.text();
        setContent(text);
        setModified(false);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    loadFile();
  }, [filePath]);

  // 使用 ref 存储最新的 content，避免闭包问题
  const contentRef = useRef(content);
  useEffect(() => { contentRef.current = content; }, [content]);

  // 编辑器内容变化
  const handleChange = useCallback((value) => {
    setContent(value);
    contentRef.current = value;
    setModified(true);
  }, []);

  // 保存文件
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: contentRef.current,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      setModified(false);
      if (onSave) onSave();
    } catch (e) {
      alert("保存失败: " + e.message);
    } finally {
      setSaving(false);
    }
  }, [filePath, onSave]);

  // 用 ref 保持 handleSave 引用最新
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // 编辑器挂载
  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    // 添加保存快捷键
    editor.addAction({
      id: "save",
      label: "保存",
      keybindings: [2048 | 49], // Ctrl+S
      run: () => handleSaveRef.current(),
    });
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // 浏览器关闭/刷新保护
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (modified) {
      window.addEventListener("beforeunload", handler);
    }
    return () => window.removeEventListener("beforeunload", handler);
  }, [modified]);

  // 关闭前检查
  const handleClose = () => {
    if (modified) {
      if (confirm("文件已修改，确定关闭吗？")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.fileName}>{fileName}</span>
          <button style={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>
        <div style={styles.centerMessage}>
          <span>⏳ 加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.fileName}>{fileName}</span>
          <button style={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>
        <div style={styles.centerMessage}>
          <span style={{ color: "#f85149" }}>❌ {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} onContextMenu={(e) => e.stopPropagation()}>
      {/* 头部工具栏 */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.fileIcon}>
            {isMd ? "📝" : "📄"}
          </span>
          <span style={styles.fileName}>
            {fileName}
            {modified && <span style={styles.modifiedDot}>●</span>}
          </span>
          <span style={styles.language}>{language}</span>
        </div>
        <div style={styles.headerRight}>
          {isMd && (
            <button
              style={styles.previewBtn}
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? "✏️ 编辑" : "👁️ 预览"}
            </button>
          )}
          <button
            style={styles.saveBtn}
            onClick={handleSave}
            disabled={!modified || saving}
          >
            {saving ? "💾 保存中..." : "💾 保存"}
          </button>
          <button style={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div style={styles.editorContainer}>
        {/* Markdown 预览 — 用 display 控制，避免 Monaco 卸载丢失状态 */}
        {isMd && (
          <div
            className="preview"
            style={{ ...styles.preview, display: showPreview ? "block" : "none" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(content || "")) }}
          />
        )}
        <div style={{ display: showPreview && isMd ? "none" : "flex", flex: 1 }}>
          <Editor
            height="100%"
            language={language}
            value={content}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              renderWhitespace: "selection",
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>
      </div>

      {/* 底部状态栏 */}
      <div style={styles.footer}>
        <span>{language}</span>
        <span>{lineCount} 行</span>
        <span>{byteSize} 字节</span>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#1e1e1e",
    color: "#d4d4d4",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    background: "#252526",
    borderBottom: "1px solid #3c3c3c",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  fileIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  modifiedDot: {
    color: "#e8a230",
    fontSize: 18,
  },
  language: {
    fontSize: 11,
    color: "#8b8b8b",
    padding: "2px 8px",
    background: "#3c3c3c",
    borderRadius: 4,
    flexShrink: 0,
  },
  previewBtn: {
    background: "#0e639c",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 12,
  },
  saveBtn: {
    background: "#0e639c",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 12,
    opacity: 1,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#8b8b8b",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 16,
  },
  editorContainer: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  preview: {
    flex: 1,
    padding: "20px 40px",
    overflowY: "auto",
    overflowX: "hidden",
    background: "#fff",
    color: "#333",
    fontSize: 15,
    lineHeight: 1.6,
  },
  centerMessage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#8b8b8b",
  },
  footer: {
    display: "flex",
    gap: 16,
    padding: "4px 16px",
    background: "#007acc",
    color: "#fff",
    fontSize: 12,
    flexShrink: 0,
  },
};

// 添加 Markdown 预览样式（防止 HMR 重复注入）
if (!document.getElementById("chatmux-md-preview-style")) {
const mdStyle = document.createElement("style");
mdStyle.id = "chatmux-md-preview-style";
mdStyle.textContent = `
  .preview {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .preview h1, .preview h2, .preview h3, .preview h4, .preview h5, .preview h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
    color: #24292e;
  }
  .preview h1 {
    font-size: 2em;
    border-bottom: 2px solid #eaecef;
    padding-bottom: 12px;
    margin-top: 32px;
  }
  .preview h2 {
    font-size: 1.5em;
    border-bottom: 1px solid #eaecef;
    padding-bottom: 8px;
    margin-top: 28px;
  }
  .preview h3 { font-size: 1.25em; }
  .preview h4 { font-size: 1em; }
  .preview h5 { font-size: 0.875em; }
  .preview h6 { font-size: 0.85em; color: #6a737d; }

  .preview p {
    margin: 12px 0;
    line-height: 1.7;
  }

  .preview a {
    color: #0366d6;
    text-decoration: none;
  }
  .preview a:hover {
    text-decoration: underline;
  }

  .preview strong { font-weight: 600; }
  .preview em { font-style: italic; }
  .preview del { text-decoration: line-through; color: #6a737d; }

  .preview code {
    background: rgba(27,31,35,0.05);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 85%;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }

  .preview pre {
    background: #f6f8fa;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 16px 0;
    line-height: 1.45;
  }
  .preview pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: 85%;
  }

  .preview blockquote {
    border-left: 4px solid #0366d6;
    padding: 8px 16px;
    color: #6a737d;
    margin: 16px 0;
    background: #f6f8fa;
    border-radius: 0 6px 6px 0;
  }
  .preview blockquote p {
    margin: 4px 0;
  }

  .preview ul, .preview ol {
    padding-left: 2em;
    margin: 12px 0;
  }
  .preview li {
    margin: 6px 0;
    line-height: 1.6;
  }
  .preview ul ul, .preview ol ol, .preview ul ol, .preview ol ul {
    margin: 4px 0;
  }

  .preview input[type="checkbox"] {
    margin-right: 6px;
  }

  .preview hr {
    border: none;
    border-top: 2px solid #e1e4e8;
    margin: 24px 0;
  }

  .preview img {
    max-width: 100%;
    border-radius: 6px;
    margin: 8px 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .preview table {
    border-collapse: collapse;
    width: 100%;
    margin: 16px 0;
    display: block;
    overflow-x: auto;
  }
  .preview th, .preview td {
    border: 1px solid #dfe2e5;
    padding: 10px 16px;
    text-align: left;
  }
  .preview th {
    background: #f6f8fa;
    font-weight: 600;
  }
  .preview tr:nth-child(even) {
    background: #f6f8fa;
  }
  .preview tr:hover {
    background: #e8f5e9;
  }

  /* 链接样式 */
  .preview a:visited {
    color: #6f42c1;
  }

  /* 响应式 */
  @media (max-width: 768px) {
    .preview {
      padding: 12px 16px;
    }
    .preview h1 { font-size: 1.75em; }
    .preview h2 { font-size: 1.375em; }
    .preview pre {
      padding: 12px;
      font-size: 13px;
    }
  }
`;
document.head.appendChild(mdStyle);
}
