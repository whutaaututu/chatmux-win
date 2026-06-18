import React, { useState } from "react";

const PRESETS = [
  { name: "bash", label: "🐚 Bash", desc: "Shell 终端" },
  { name: "folder", label: "📁 文件夹", desc: "浏览文件夹内容" },
  { name: "desktop", label: "🖥️ 远程桌面", desc: "图形桌面环境 (VNC)" },
];

export default function AddFriend({ onAdd, onClose }) {
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [dirs, setDirs] = useState([]);
  const [showBrowse, setShowBrowse] = useState(false);
  const [browsePath, setBrowsePath] = useState("~");

  const handleSubmit = (e) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;

    // 文件夹模式
    if (cmd === "__folder__") {
      if (cwd.trim()) {
        onAdd("__folder__", [], cwd.trim());
      } else {
        // 如果没有选择目录，打开文件浏览器
        browseDir("~");
      }
      return;
    }

    const argList = args.trim() ? args.trim().split(/\s+/) : [];
    onAdd(cmd, argList, cwd.trim() || null);
  };

  const handlePreset = (name) => {
    if (name === "desktop") {
      // 桌面模式：直接创建
      onAdd("__desktop__");
      return;
    }
    if (name === "folder") {
      // 文件夹模式：需要选择目录
      setCommand("__folder__");
      if (!cwd.trim()) {
        browseDir("~");
      }
    } else {
      // 其他预设：填充命令，让用户可以修改工作目录后再提交
      const cmd = (name === "git" || name === "docker") ? "bash" : name;
      setCommand(cmd);
    }
  };

  // 浏览目录
  const browseDir = async (path) => {
    try {
      const res = await fetch(`/api/ls?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setBrowsePath(data.path);
      setDirs(data.entries || []);
      setShowBrowse(true);
    } catch (e) {
      console.error(e);
    }
  };

  const selectDir = (dir) => {
    setCwd(dir);
    setShowBrowse(false);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>添加会话</h3>

        <div style={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              style={styles.presetBtn}
              onClick={() => handlePreset(p.name)}
            >
              <span style={styles.presetLabel}>{p.label}</span>
              <span style={styles.presetDesc}>{p.desc}</span>
            </button>
          ))}
        </div>

        <div style={styles.divider}>或自定义</div>

        <form onSubmit={handleSubmit}>
          <input
            style={styles.input}
            placeholder="命令，如: bash, node, python3, nvim..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            autoFocus
          />
          <input
            style={styles.input}
            placeholder="参数（可选，空格分隔）"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <div style={styles.cwdRow}>
            <input
              style={{ ...styles.input, marginBottom: 0, flex: 1 }}
              placeholder="工作目录（可选，默认 ~）"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
            <button
              type="button"
              style={styles.browseBtn}
              onClick={() => browseDir(cwd || "~")}
              title="浏览目录"
            >
              📁
            </button>
          </div>

          {showBrowse && (
            <div style={styles.browsePanel}>
              <div style={styles.browseHeader}>
                <span style={styles.browsePath}>{browsePath}</span>
                <button
                  type="button"
                  style={styles.useBtn}
                  onClick={() => selectDir(browsePath)}
                >
                  使用此目录
                </button>
              </div>
              <div style={styles.browseList}>
                {/* 返回上级目录 */}
                <div
                  style={styles.browseItem}
                  onClick={() => {
                    const parentPath = browsePath.split("/").slice(0, -1).join("/") || "/";
                    browseDir(parentPath);
                  }}
                >
                  📁 ..  <span style={{color: "#8b949e", fontSize: 11}}>上级目录</span>
                </div>
                {dirs.map((d) => (
                  <div
                    key={d.name}
                    style={styles.browseItem}
                    onClick={() => d.isDirectory ? browseDir(browsePath + "/" + d.name) : null}
                  >
                    {d.isDirectory ? "📂" : "📄"} {d.name}
                  </div>
                ))}
                {dirs.length === 0 && (
                  <div style={styles.browseEmpty}>空目录</div>
                )}
              </div>
            </div>
          )}

          <button type="submit" style={styles.submitBtn} disabled={!command.trim()}>
            添加
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#161b22",
    borderRadius: 12,
    padding: 24,
    width: 400,
    border: "1px solid #30363d",
  },
  title: {
    color: "#c9d1d9",
    marginBottom: 16,
    fontSize: 18,
  },
  presets: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 16,
  },
  presetBtn: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 12,
    color: "#c9d1d9",
    textAlign: "left",
  },
  presetLabel: {
    fontWeight: 500,
    fontSize: 14,
    minWidth: 90,
  },
  presetDesc: {
    fontSize: 12,
    color: "#8b949e",
  },
  divider: {
    textAlign: "center",
    color: "#484f58",
    fontSize: 12,
    margin: "12px 0",
    position: "relative",
  },
  input: {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#c9d1d9",
    fontSize: 14,
    marginBottom: 8,
    outline: "none",
  },
  submitBtn: {
    width: "100%",
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    marginTop: 12,
  },
  cwdRow: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
  },
  browseBtn: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 16,
    flexShrink: 0,
  },
  browsePanel: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    marginBottom: 8,
    maxHeight: 200,
    display: "flex",
    flexDirection: "column",
  },
  browseHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid #30363d",
  },
  browsePath: {
    fontSize: 12,
    color: "#8b949e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  useBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
    flexShrink: 0,
    marginLeft: 8,
  },
  browseList: {
    overflowY: "auto",
    padding: "4px 0",
  },
  browseItem: {
    padding: "6px 12px",
    fontSize: 13,
    color: "#c9d1d9",
    cursor: "pointer",
  },
  browseEmpty: {
    padding: "12px",
    textAlign: "center",
    color: "#484f58",
    fontSize: 12,
  },
};
