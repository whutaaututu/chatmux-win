import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import AddFriend from "./components/AddFriend";
import CommandPalette from "./components/CommandPalette";
import AIChat from "./components/AIChat";

const WS_BASE = () => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function pickFallbackSessionId(sessions, deletedId) {
  const deletedIndex = sessions.findIndex((s) => s.id === deletedId);
  const nextSessions = sessions.filter((s) => s.id !== deletedId);
  const fallback = nextSessions[deletedIndex] || nextSessions[deletedIndex - 1] || nextSessions[0];
  return fallback?.id || null;
}

export default function App() {
  const isMobile = useIsMobile();
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [terminalSelection, setTerminalSelection] = useState(null);
  const [aiSelectionKey, setAiSelectionKey] = useState(0);
  const [openFolders, setOpenFolders] = useState(new Map()); // 存储打开的文件夹
  const [groups, setGroups] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("chatmux-groups") || "{}");
    } catch {
      return {};
    }
  });
  const [sessionOrder, setSessionOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("chatmux-order") || "[]");
    } catch {
      return [];
    }
  });

  const wsMapRef = useRef(new Map());
  const writerMapRef = useRef(new Map());
  const attachSessionRef = useRef(null);

  // 用 ref 缓存频繁变化的状态，避免 useCallback 闭包依赖导致重建
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    localStorage.setItem("chatmux-groups", JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    localStorage.setItem("chatmux-order", JSON.stringify(sessionOrder));
  }, [sessionOrder]);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((list) => {
        const restored = list.map((s) => {
          // 文件夹类型
          if (s.type === "folder" || s.command === "__folder__") {
            return {
              id: s.id,
              command: "__folder__",
              label: s.label || s.cwd?.split("/").pop() || "文件夹",
              args: [],
              cwd: s.cwd,
              type: "folder",
              group: groups[s.id] || "",
              alive: true,
              ws: null,
            };
          }
          // 桌面类型
          if (s.type === "desktop" || s.command === "__desktop__") {
            return {
              id: s.id,
              command: "__desktop__",
              label: s.label || "远程桌面",
              args: [],
              cwd: s.cwd,
              type: "desktop",
              group: groups[s.id] || "",
              alive: s.alive || false,
              ws: null,
            };
          }
          // 终端类型
          return {
            id: s.id,
            command: s.command,
            label: s.label || s.command,
            args: s.args || [],
            cwd: s.cwd,
            type: "terminal",
            group: groups[s.id] || "",
            alive: s.alive,
            ws: null,
          };
        });
        setSessions(restored);
        if (restored.length > 0) {
          const firstId = restored[0].id;
          setActiveId(firstId);
          activeIdRef.current = firstId;
          // 文件夹类型不需要 attach
          const firstSession = restored[0];
          if (firstSession.type !== "folder" && firstSession.command !== "__folder__") {
            // 延迟 attach 确保 attachSessionRef 已设置（与 useEffect 赋值存在时序依赖）
            setTimeout(() => attachSessionRef.current?.(firstId), 0);
          }
        }
      })
      .catch(() => {});
  }, []);

  function findSessionIdByWs(ws) {
    for (const [id, w] of wsMapRef.current) {
      if (w === ws) return id;
    }
    return null;
  }

  const attachSession = useCallback((sessionId) => {
    if (wsMapRef.current.has(sessionId)) return;
    const ws = new WebSocket(`${WS_BASE()}?action=attach&sessionId=${sessionId}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "attached":
            wsMapRef.current.set(msg.sessionId, ws);
            setSessions((prev) => prev.map((s) => s.id === msg.sessionId ? { ...s, alive: true, ws } : s));
            break;
          case "output": {
            const sid = findSessionIdByWs(ws);
            if (sid) writerMapRef.current.get(sid)?.(msg.data);
            break;
          }
          case "exit": {
            const sid = findSessionIdByWs(ws);
            if (sid) setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, alive: false } : s));
            break;
          }
        }
      } catch {}
    };
    ws.onclose = () => {
      const sid = findSessionIdByWs(ws);
      if (sid) {
        wsMapRef.current.delete(sid);
        setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, ws: null } : s));
      }
    };
  }, []);

  useEffect(() => { attachSessionRef.current = attachSession; }, [attachSession]);

  const handleSelect = useCallback((id) => {
    setActiveId(id);
    activeIdRef.current = id;
    setSidebarOpen(false);
    const s = sessionsRef.current.find((x) => x.id === id);
    // 文件夹和桌面类型不需要 attach
    if (s && s.type !== "folder" && s.type !== "desktop" && s.command !== "__folder__") {
      // 如果没有 WebSocket 连接，或者连接已关闭，重新连接
      const ws = wsMapRef.current.get(id);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // 清理旧的连接
        if (ws) {
          wsMapRef.current.delete(id);
        }
        attachSession(id);
      }
    }
  }, [attachSession]);

  useEffect(() => {
    if (sessions.length === 0) {
      if (activeId !== null) { setActiveId(null); activeIdRef.current = null; }
      return;
    }
    if (!activeId || !sessions.some((s) => s.id === activeId)) {
      const newId = sessions[0].id;
      setActiveId(newId);
      activeIdRef.current = newId;
    }
  }, [activeId, sessions]);

  useEffect(() => {
    if (!activeId) return;
    const s = sessionsRef.current.find((x) => x.id === activeId);
    if (!s || s.type === "folder" || s.command === "__folder__") return;
    const ws = wsMapRef.current.get(activeId);
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      if (ws) wsMapRef.current.delete(activeId);
      attachSession(activeId);
    }
  }, [activeId, attachSession]);

  const handleAdd = useCallback((command, args = [], cwd = null) => {
    // 处理桌面类型
    if (command === "__desktop__") {
      const params = new URLSearchParams({
        action: "create",
        sessionType: "desktop",
        command: "__desktop__",
        width: "1280",
        height: "800",
      });
      const ws = new WebSocket(`${WS_BASE()}?${params}`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "created") {
            setSessions((prev) => [...prev, {
              id: msg.sessionId,
              command: "__desktop__",
              label: "远程桌面",
              args: [],
              cwd: "~",
              type: "desktop",
              group: "",
              alive: true,
              ws: null,
            }]);
            setActiveId(msg.sessionId);
            activeIdRef.current = msg.sessionId;
            setShowAdd(false);
            setShowPalette(false);
            setSidebarOpen(false);
            ws.close();
          }
        } catch {}
      };
      ws.onclose = () => {};
      return;
    }

    // 处理文件夹类型 - 通过服务器 API 创建以实现多端同步
    if (command === "__folder__") {
      const folderPath = cwd || "~";

      // 通过 WebSocket 创建文件夹会话
      const params = new URLSearchParams({
        action: "create",
        command: "__folder__",
        args: "",
        cols: "80",
        rows: "24",
        cwd: folderPath,
      });
      const ws = new WebSocket(`${WS_BASE()}?${params}`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "created") {
            const folderName = folderPath.split("/").pop() || "文件夹";
            setSessions((prev) => [...prev, {
              id: msg.sessionId,
              command: "__folder__",
              label: folderName,
              args: [],
              cwd: folderPath,
              group: "",
              alive: true,
              ws: null,
            }]);
            setActiveId(msg.sessionId);
            activeIdRef.current = msg.sessionId;
            setShowAdd(false);
            setShowPalette(false);
            setSidebarOpen(false);
            ws.close();
          }
        } catch {}
      };
      ws.onclose = () => {};
      return;
    }

    const params = new URLSearchParams({ action: "create", command, args: args.join(","), cols: "80", rows: "24", ...(cwd && { cwd }) });
    const ws = new WebSocket(`${WS_BASE()}?${params}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "created":
            setSessions((prev) => [...prev, { id: msg.sessionId, command: msg.command, label: msg.command, args, cwd, group: "", alive: true, ws }]);
            setActiveId(msg.sessionId);
            activeIdRef.current = msg.sessionId;
            wsMapRef.current.set(msg.sessionId, ws);
            setShowAdd(false);
            setShowPalette(false);
            setSidebarOpen(false);
            break;
          case "output": {
            const sid = findSessionIdByWs(ws);
            if (sid) writerMapRef.current.get(sid)?.(msg.data);
            break;
          }
          case "exit": {
            const sid = findSessionIdByWs(ws);
            if (sid) setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, alive: false } : s));
            break;
          }
        }
      } catch {}
    };
    ws.onclose = () => {
      const sid = findSessionIdByWs(ws);
      if (sid) {
        wsMapRef.current.delete(sid);
        setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, ws: null } : s));
      }
    };
  }, []);

  const handleDelete = useCallback((id) => {
    const fallbackId = pickFallbackSessionId(sessionsRef.current, id);

    const ws = wsMapRef.current.get(id);
    if (ws) { ws.close(); wsMapRef.current.delete(id); }
    writerMapRef.current.delete(id);

    // 桌面会话需要停止 VNC
    const session = sessionsRef.current.find(s => s.id === id);
    if (session?.type === "desktop") {
      fetch("/api/desktop/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      }).catch(() => {});
    }

    fetch(`/api/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((current) => {
      if (current === id) { activeIdRef.current = fallbackId; return fallbackId; }
      return current;
    });
  }, []);

  const handleRename = useCallback((id, label) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, label } : s));
    fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).catch(() => {});
  }, []);

  const handleGroupChange = useCallback((id, group) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, group } : s));
    setGroups((prev) => ({ ...prev, [id]: group }));
  }, []);

  const handleReorder = useCallback((newOrder) => {
    setSessionOrder(newOrder);
  }, []);

  const handleReconnect = useCallback((id) => { attachSession(id); }, [attachSession]);

  const sendInput = useCallback((data) => {
    const aid = activeIdRef.current;
    if (!aid) return;
    const ws = wsMapRef.current.get(aid);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
  }, []);

  const sendResize = useCallback((cols, rows) => {
    const aid = activeIdRef.current;
    if (!aid) return;
    const ws = wsMapRef.current.get(aid);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }, []);

  const registerWriter = useCallback((sessionId, writer) => {
    writerMapRef.current.set(sessionId, writer);
    return () => writerMapRef.current.delete(sessionId);
  }, []);

  // 应用自定义排序
  const orderedSessions = useMemo(() => {
    if (sessionOrder.length === 0) return sessions;
    const orderMap = new Map(sessionOrder.map((id, i) => [id, i]));
    return [...sessions].sort((a, b) => {
      const ia = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
      const ib = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
      return ia - ib;
    });
  }, [sessions, sessionOrder]);

  // 同步排序：新会话加入排序列表
  useEffect(() => {
    if (sessions.length === 0) return;
    const ids = sessions.map(s => s.id);
    const known = new Set(sessionOrder);
    const newIds = ids.filter(id => !known.has(id));
    if (newIds.length > 0) {
      setSessionOrder(prev => [...prev, ...newIds]);
    }
    // 清理已删除的会话
    const currentSet = new Set(ids);
    if (sessionOrder.some(id => !currentSet.has(id))) {
      setSessionOrder(prev => prev.filter(id => currentSet.has(id)));
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeId);

  // 移动端布局
  if (isMobile) {
    return (
      <div style={mStyles.app}>
        {/* 顶栏 */}
        <div style={mStyles.topBar}>
          <button style={mStyles.menuBtn} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <span style={mStyles.topTitle}>
            {activeSession ? (activeSession.label || activeSession.command) : "ChatMux"}
          </span>
          <button style={mStyles.menuBtn} onClick={() => setShowAdd(true)}>＋</button>
        </div>

        {/* 侧边栏遮罩 + 抽屉 */}
        {sidebarOpen && <div style={mStyles.overlay} onClick={() => setSidebarOpen(false)} />}
        <div style={{ ...mStyles.drawer, ...(sidebarOpen ? mStyles.drawerOpen : {}) }}>
          <Sidebar
            sessions={orderedSessions}
            activeId={activeId}
            onSelect={handleSelect}
            onAdd={() => { setShowAdd(true); setSidebarOpen(false); }}
            onDelete={handleDelete}
            onRename={handleRename}
            onGroupChange={handleGroupChange}
            onReorder={handleReorder}
          />
        </div>

        {/* 终端区域 */}
        <div style={mStyles.terminal}>
          <ChatWindow
            sessions={sessions}
            activeId={activeId}
            sendInput={sendInput}
            sendResize={sendResize}
            registerWriter={registerWriter}
            onReconnect={handleReconnect}
            onAddSession={handleAdd}
            onDeleteSession={handleDelete}
            mobile={true}
          />
        </div>

        {showAdd && <AddFriend onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
        {showPalette && <CommandPalette sessions={sessions} onAdd={handleAdd} onSelect={handleSelect} onClose={() => setShowPalette(false)} />}
      </div>
    );
  }

  // 桌面布局
  return (
    <div style={styles.app}>
      <Sidebar
        sessions={orderedSessions}
        activeId={activeId}
        onSelect={handleSelect}
        onAdd={() => setShowAdd(true)}
        onDelete={handleDelete}
        onRename={handleRename}
        onGroupChange={handleGroupChange}
        onReorder={handleReorder}
      />
      <ChatWindow
        sessions={sessions}
        activeId={activeId}
        sendInput={sendInput}
        sendResize={sendResize}
        registerWriter={registerWriter}
        onReconnect={handleReconnect}
        onAddSession={handleAdd}
        onDeleteSession={handleDelete}
        showAI={showAI}
        onToggleAI={() => setShowAI(!showAI)}
        onAskAI={(text) => { setTerminalSelection(text); setAiSelectionKey(k => k + 1); setShowAI(true); }}
      />
      {showAI && (
        <AIChat
          key={aiSelectionKey}
          onClose={() => setShowAI(false)}
          terminalSelection={terminalSelection}
          sendInput={sendInput}
          activeId={activeId}
        />
      )}
      {showAdd && <AddFriend onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
      {showPalette && <CommandPalette sessions={sessions} onAdd={handleAdd} onSelect={handleSelect} onClose={() => setShowPalette(false)} />}
    </div>
  );
}

const styles = {
  app: { display: "flex", height: "100vh", background: "#0d1117" },
};

const mStyles = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    background: "#0d1117",
    position: "relative",
    overflow: "hidden",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
    // 安全区域（刘海屏）
    paddingTop: "max(8px, env(safe-area-inset-top))",
  },
  topTitle: {
    color: "#c9d1d9",
    fontSize: 15,
    fontWeight: 600,
    flex: 1,
    textAlign: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menuBtn: {
    background: "none",
    color: "#c9d1d9",
    border: "none",
    fontSize: 22,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: 8,
    flexShrink: 0,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 70,
  },
  drawer: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "80vw",
    maxWidth: 300,
    zIndex: 80,
    transform: "translateX(-100%)",
    transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
  },
  drawerOpen: {
    transform: "translateX(0)",
  },
  terminal: {
    flex: 1,
    overflow: "hidden",
  },
};
