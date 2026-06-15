import React, { useState, useMemo } from "react";
import "./Sidebar.css";

export default function Sidebar({ sessions, activeId, onSelect, onAdd, onDelete, onRename, onGroupChange, onReorder }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupInput, setGroupInput] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: "before" | "after" }

  const startRename = (id, currentName) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const confirmRename = (id) => {
    if (editName.trim()) onRename(id, editName.trim());
    setEditingId(null);
  };

  const startGroupEdit = (id, currentGroup) => {
    setEditingGroup(id);
    setGroupInput(currentGroup || "");
  };

  const confirmGroup = (id) => {
    onGroupChange(id, groupInput.trim());
    setEditingGroup(null);
  };

  // 拖拽排序
  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "before" : "after";
    setDropTarget({ id, position });
  };

  const handleDragLeave = (e) => {
    // 只在离开元素时清除，避免子元素触发
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropTarget(null);
    }
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain");
    if (fromId && fromId !== targetId && onReorder) {
      const ids = sessions.map(s => s.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return;

      // 移除拖拽项
      ids.splice(fromIdx, 1);
      // 计算插入位置
      let insertIdx = ids.indexOf(targetId);
      if (dropTarget?.position === "after") insertIdx += 1;
      ids.splice(insertIdx, 0, fromId);
      onReorder(ids);
    }
    setDragId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  // 按分组归类
  const grouped = useMemo(() => {
    const map = new Map();
    for (const s of sessions) {
      const g = s.group || "";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [sessions]);

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <h2 style={styles.title}>💬 ChatMux</h2>
        <button style={styles.addBtn} onClick={onAdd} title="添加 CLI">＋</button>
      </div>
      <div style={styles.list}>
        {grouped.map(([groupName, items]) => (
          <div key={groupName || "__ungrouped"}>
            {groupName && <div style={styles.groupLabel}>{groupName}</div>}
            {items.map((s) => (
              <div
                key={s.id}
                className={`sidebar-item ${s.id === activeId ? "active" : ""} ${s.id === dragId ? "dragging" : ""}`}
                draggable
                onClick={() => onSelect(s.id)}
                onDragStart={(e) => handleDragStart(e, s.id)}
                onDragOver={(e) => handleDragOver(e, s.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, s.id)}
                onDragEnd={handleDragEnd}
                style={dropTarget?.id === s.id ? {
                  borderTop: dropTarget.position === "before" ? "2px solid #58a6ff" : undefined,
                  borderBottom: dropTarget.position === "after" ? "2px solid #58a6ff" : undefined,
                } : undefined}
              >
                <span style={s.type === "desktop" ? styles.desktopDot : s.command === "__folder__" ? styles.folderDot : styles.dot(s.alive)} />
                <div style={styles.itemInfo}>
                  {editingId === s.id ? (
                    <input
                      style={styles.renameInput}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => confirmRename(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRename(s.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : editingGroup === s.id ? (
                    <input
                      style={styles.renameInput}
                      placeholder="分组名称（留空取消分组）"
                      value={groupInput}
                      onChange={(e) => setGroupInput(e.target.value)}
                      onBlur={() => confirmGroup(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmGroup(s.id);
                        if (e.key === "Escape") setEditingGroup(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div style={styles.itemName}>{s.label || s.command}</div>
                  )}
                  <div style={styles.itemMeta}>
                    {s.type === "desktop" ? "🖥️ 桌面" :
                     s.type === "folder" || s.command === "__folder__" ? "📁 文件夹" :
                     (s.alive ? "🟢 运行中" : "⚪ 已退出")}
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="action-btn"
                    title="设置分组"
                    onClick={(e) => { e.stopPropagation(); startGroupEdit(s.id, s.group); }}
                  >
                    🏷️
                  </button>
                  <button
                    className="action-btn"
                    title="重命名"
                    onClick={(e) => { e.stopPropagation(); startRename(s.id, s.label || s.command); }}
                  >
                    ✏️
                  </button>
                  <button
                    className="action-btn"
                    title="关闭"
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div style={styles.empty}>Ctrl+K 命令面板 | ＋ 添加 CLI</div>
        )}
      </div>
      <div style={styles.footer}>
        <button
          style={styles.footerBtn}
          onClick={() => window.open("/api/download", "_blank")}
          title="下载项目包，部署到其他机器"
        >
          ⬇ 下载部署包
        </button>
      </div>
    </div>
  );
}

const styles = {
  sidebar: {
    width: 240,
    height: "100%",
    background: "#1a1a2e",
    color: "#eee",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #333",
  },
  header: {
    padding: "12px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #333",
  },
  title: { fontSize: 17, fontWeight: 600 },
  addBtn: {
    background: "#0f3460", color: "#fff", border: "none",
    borderRadius: "50%", width: 30, height: 30, fontSize: 17,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  list: { flex: 1, overflowY: "auto" },
  groupLabel: {
    padding: "8px 14px 4px",
    fontSize: 11,
    fontWeight: 600,
    color: "#58a6ff",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  dot: (alive) => ({
    width: 7, height: 7, borderRadius: "50%",
    background: alive ? "#4ade80" : "#666", flexShrink: 0,
  }),
  folderDot: {
    width: 7, height: 7, borderRadius: "50%",
    background: "#f0883e", flexShrink: 0,
  },
  desktopDot: {
    width: 7, height: 7, borderRadius: "50%",
    background: "#a371f7", flexShrink: 0,
  },
  itemInfo: { flex: 1, overflow: "hidden" },
  itemName: {
    fontWeight: 500, fontSize: 13, whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  },
  itemMeta: { fontSize: 11, color: "#888", marginTop: 1 },
  renameInput: {
    background: "#0d1117", border: "1px solid #58a6ff", borderRadius: 4,
    padding: "2px 6px", color: "#c9d1d9", fontSize: 12, width: "100%", outline: "none",
  },
  empty: {
    padding: 20, textAlign: "center", color: "#555", fontSize: 12,
  },
  footer: {
    padding: "10px 14px",
    borderTop: "1px solid #333",
  },
  footerBtn: {
    width: "100%",
    background: "#0d1117",
    color: "#8b949e",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "center",
  },
};
