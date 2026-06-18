import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import SearchBar from "./SearchBar";
import MobileKeys from "./MobileKeys";
import FileExplorer from "./FileExplorer";
import DesktopView from "./DesktopView";

export default function ChatWindow({
  sessions,
  activeId,
  sendInput,
  sendResize,
  registerWriter,
  onReconnect,
  onAddSession,
  onDeleteSession,
  mobile = false,
  showAI = false,
  onToggleAI,
  onAskAI,
}) {
  const termsRef = useRef(new Map());
  const [showSearch, setShowSearch] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeId);

  // Ctrl+F / Ctrl+Shift+C / Ctrl+Shift+V
  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === "Escape" && showSearch) setShowSearch(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showSearch]);

  const createTerminal = useCallback((session, container) => {
    const existing = termsRef.current.get(session.id);
    if (existing) {
      if (existing.container === container && container.hasChildNodes()) return;

      try {
        existing.term.dispose();
      } catch (e) {
        console.error("重建终端失败:", e);
      }
      termsRef.current.delete(session.id);
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    const term = new Terminal({
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(container);
    requestAnimationFrame(() => fitAddon.fit());

    // 剪贴板：Ctrl+C 复制选中文本（无选区时发 SIGINT），Ctrl+V 粘贴
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+C：有选区时复制，无选区时发 SIGINT
      if (mod && e.key === "c") {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        return true;
      }

      // Ctrl+V：读取剪贴板并发送给 PTY
      if (mod && e.key === "v") {
        navigator.clipboard.readText().then((text) => {
          if (text && session.id === activeIdRef.current) {
            sendInputRef.current(text);
          }
        }).catch((err) => console.warn("剪贴板读取失败:", err));
        return false;
      }

      return true;
    });

    term.onData((data) => {
      if (session.id === activeIdRef.current) {
        sendInputRef.current(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (session.id === activeIdRef.current) {
        sendResizeRef.current(cols, rows);
      }
    });

    termsRef.current.set(session.id, { term, fitAddon, searchAddon, container });
    // 存到 DOM 上方便触摸滚动和右键菜单访问
    container._chatmux_term = term;
    registerWriter(session.id, (data) => term.write(data));

    const handleResize = () => {
      if (session.id === activeIdRef.current) fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const activeIdRef = useRef(activeId);
  const sendInputRef = useRef(sendInput);
  const sendResizeRef = useRef(sendResize);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { sendInputRef.current = sendInput; }, [sendInput]);
  useEffect(() => { sendResizeRef.current = sendResize; }, [sendResize]);

  // 切换显示
  useEffect(() => {
    termsRef.current.forEach(({ container, fitAddon }, id) => {
      const isActive = id === activeId;
      container.style.display = isActive ? "block" : "none";
      if (isActive) requestAnimationFrame(() => fitAddon.fit());
    });
  }, [activeId]);

  // 清理已删除的终端（只在会话真正被删除时清理）
  useEffect(() => {
    const currentSessionIds = new Set(sessions.map((s) => s.id));
    const terminalIds = [...termsRef.current.keys()];

    terminalIds.forEach((id) => {
      // 只清理确实不在 sessions 列表中的终端
      if (!currentSessionIds.has(id)) {
        const entry = termsRef.current.get(id);
        if (entry) {
          try {
            entry.term.dispose();
            // 清空容器内容，但不移除容器本身
            while (entry.container.firstChild) {
              entry.container.removeChild(entry.container.firstChild);
            }
          } catch (e) {
            console.error("清理终端失败:", e);
          }
          termsRef.current.delete(id);
        }
      }
    });
  }, [sessions]);

  // 搜索
  const doSearch = useCallback((q) => {
    const e = termsRef.current.get(activeId);
    if (e && q) e.searchAddon.findNext(q);
  }, [activeId]);
  const doSearchNext = doSearch;
  const doSearchPrev = useCallback((q) => {
    const e = termsRef.current.get(activeId);
    if (e && q) e.searchAddon.findPrevious(q);
  }, [activeId]);

  // 移动端按键：直接发给 PTY
  const handleMobileKey = useCallback((data) => {
    // 所有特殊按键直接发给 PTY（控制字符、转义序列、符号）
    sendInputRef.current(data);
  }, []);

  // 处理文件夹中打开终端
  const handleOpenTerminalFromFolder = useCallback((path) => {
    if (onAddSession) {
      onAddSession("bash", [], path);
    }
  }, [onAddSession]);

  // 处理关闭文件夹
  const handleCloseFolder = useCallback((id) => {
    if (onDeleteSession) {
      onDeleteSession(id);
    }
  }, [onDeleteSession]);

  if (!activeSession) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>💬</div>
        <div style={styles.emptyTitle}>欢迎使用 ChatMux</div>
        <div style={styles.emptyText}>选择一个会话类型开始：</div>
        <div style={styles.emptyActions}>
          <button
            style={styles.emptyBtn}
            onClick={() => onAddSession?.("bash", [], null)}
          >
            🖥️ 打开终端
          </button>
          <button
            style={styles.emptyFolderBtn}
            onClick={() => onAddSession?.("__folder__", [], "~")}
          >
            📁 打开文件夹
          </button>
        </div>
        <div style={styles.emptyHint}>Ctrl+K 打开命令面板 | 左上角 ＋ 也可以添加</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {showSearch && (
        <SearchBar
          onSearch={doSearch}
          onNext={doSearchNext}
          onPrev={doSearchPrev}
          onClose={() => setShowSearch(false)}
        />
      )}

      {!mobile && (
        <div style={styles.header}>
          <span style={
            activeSession.type === "desktop" ? styles.desktopDot :
            activeSession.type === "folder" || activeSession.command === "__folder__" ? styles.folderDot :
            styles.dot(activeSession.alive)
          } />
          <span style={styles.name}>{activeSession.label || activeSession.command}</span>
          <span style={styles.status}>
            {activeSession.type === "desktop" ? "桌面" :
             activeSession.type === "folder" || activeSession.command === "__folder__" ? "文件夹" :
             (activeSession.alive ? "运行中" : "已退出")}
          </span>
          {!activeSession.alive && activeSession.type !== "folder" && activeSession.type !== "desktop" && activeSession.command !== "__folder__" && (
            <button style={styles.reconnectBtn} onClick={() => onReconnect?.(activeSession.id)}>
              🔄 重连
            </button>
          )}
          <div style={{ flex: 1 }} />
          {onToggleAI && activeSession.type !== "desktop" && (
            <button
              style={{ ...styles.reconnectBtn, ...(showAI ? { background: "#1f6feb33", color: "#58a6ff" } : {}) }}
              onClick={onToggleAI}
              title="AI 助手"
            >
              🤖
            </button>
          )}
        </div>
      )}

      {mobile && !activeSession.alive && (
        <div style={styles.mobileReconnect}>
          <button style={styles.reconnectBtn} onClick={() => onReconnect?.(activeSession.id)}>
            🔄 重连
          </button>
        </div>
      )}

      <div style={styles.terminalsWrapper}>
        {sessions.map((s) => (
          s.type === "desktop" ? (
            <div
              key={s.id}
              style={{
                flex: 1,
                display: s.id === activeId ? "flex" : "none",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <DesktopView
                sessionId={s.id}
                alive={s.alive}
                onStatusChange={(status) => {
                  // 状态变化可以在这里处理
                }}
              />
            </div>
          ) : s.command === "__folder__" ? (
            <div
              key={s.id}
              style={{
                flex: 1,
                display: s.id === activeId ? "flex" : "none",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <FileExplorer
                sessionId={s.id}
                initialPath={s.cwd}
                onOpenTerminal={handleOpenTerminalFromFolder}
                onClose={() => handleCloseFolder(s.id)}
              />
            </div>
          ) : (
            <TerminalPanel
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              onCreate={createTerminal}
              onAskAI={onAskAI}
            />
          )
        ))}
      </div>

      {mobile && activeSession?.alive && (
        <MobileKeys onKey={handleMobileKey} />
      )}
    </div>
  );
}

function TerminalPanel({ session, isActive, onCreate, onAskAI }) {
  const containerRef = useRef(null);
  const touchRef = useRef({ startY: 0, lastY: 0, scrolling: false });
  const initialized = useRef(false);
  const cleanupRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [toast, setToast] = useState(null);

  // 延迟挂载：首次激活时才创建终端，之后保持存活
  useEffect(() => {
    if (!isActive || initialized.current) return;

    if (containerRef.current) {
      initialized.current = true;
      cleanupRef.current = onCreate(session, containerRef.current) || null;
    }
  }, [isActive, session.id, onCreate]);

  // 终端重建：容器被清空时重新初始化
  useEffect(() => {
    if (!isActive || !initialized.current) return;
    if (containerRef.current && !containerRef.current.hasChildNodes()) {
      initialized.current = false;
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
      requestAnimationFrame(() => {
        if (containerRef.current) {
          initialized.current = true;
          cleanupRef.current = onCreate(session, containerRef.current) || null;
        }
      });
    }
  }, [isActive, session.id, onCreate]);

  // 组件卸载时清理终端
  useEffect(() => {
    return () => {
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
      initialized.current = false;
    };
  }, [session.id]);

  const focusTerminal = () => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (textarea) textarea.focus();
  };

  // 触摸滚动处理
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchRef.current.startY = e.touches[0].clientY;
      touchRef.current.lastY = e.touches[0].clientY;
      touchRef.current.scrolling = false;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - touchRef.current.lastY;
    const totalDy = e.touches[0].clientY - touchRef.current.startY;

    // 移动超过 10px 判定为滚动
    if (!touchRef.current.scrolling && Math.abs(totalDy) > 10) {
      touchRef.current.scrolling = true;
    }

    if (touchRef.current.scrolling) {
      e.preventDefault();
      const term = containerRef.current?._chatmux_term;
      if (term) {
        term.scrollLines(-dy);
      }
    }
    touchRef.current.lastY = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!touchRef.current.scrolling) {
      focusTerminal();
    }
    touchRef.current.scrolling = false;
  };

  // 右键菜单
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onContextMenu = (e) => {
      e.preventDefault();
      const term = container._chatmux_term;
      const sel = term?.hasSelection() ? term.getSelection() : "";
      setCtxMenu({ x: e.clientX, y: e.clientY, selection: sel });
    };
    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [ctxMenu]);

  const handleCopy = () => {
    const sel = ctxMenu?.selection;
    if (sel) {
      navigator.clipboard.writeText(sel).catch(() => {});
    }
    setCtxMenu(null);
  };

  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  };
  // 组件卸载时清理 toast 定时器
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const handlePaste = async () => {
    setCtxMenu(null);
    try {
      let text = "";
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
      if (text) {
        const term = containerRef.current?._chatmux_term;
        if (term) {
          term.paste(text);
          showToast("已粘贴 " + text.length + " 字符");
        }
      } else {
        showToast("剪贴板为空");
      }
    } catch (err) {
      console.error("粘贴失败:", err);
      showToast("粘贴失败: " + err.message);
    }
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={focusTerminal}
      style={{
        flex: 1,
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        overflow: "hidden",
        touchAction: "none",
        minHeight: 0,
        position: "relative",
      }}
    >
      {ctxMenu && (
        <div
          style={{
            position: "fixed",
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: "#2d333b",
            border: "1px solid #444c56",
            borderRadius: 6,
            padding: "4px 0",
            minWidth: 140,
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <CtxMenuItem label="复制" disabled={!ctxMenu.selection} onClick={handleCopy} />
          <CtxMenuItem label="粘贴" onClick={handlePaste} />
          {onAskAI && ctxMenu.selection && (
            <>
              <div style={{ height: 1, background: "#444c56", margin: "4px 0" }} />
              <CtxMenuItem label="🤖 问 AI" onClick={() => { onAskAI(ctxMenu.selection); setCtxMenu(null); }} />
            </>
          )}
        </div>
      )}
      {toast && (
        <div style={{
          position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
          background: "#2d333b", color: "#c9d1d9", padding: "8px 16px",
          borderRadius: 6, fontSize: 13, zIndex: 10000,
          boxShadow: "0 4px 12px rgba(0,0,0,.4)",
          pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function CtxMenuItem({ label, disabled, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        padding: "6px 16px",
        color: disabled ? "#484f58" : hover ? "#fff" : "#c9d1d9",
        background: hover && !disabled ? "#316dca" : "transparent",
        fontSize: 13,
        cursor: disabled ? "default" : "pointer",
        userSelect: "none",
        transition: "background .1s",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onClick}
    >
      {label}
    </div>
  );
}

const styles = {
  container: {
    flex: 1, display: "flex", flexDirection: "column", background: "#0d1117",
    overflow: "hidden",
  },
  terminalsWrapper: {
    flex: 1, display: "flex", flexDirection: "column",
    overflow: "hidden", minHeight: 0,
  },
  header: {
    padding: "8px 12px", background: "#161b22", borderBottom: "1px solid #30363d",
    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
  },
  dot: (alive) => ({
    width: 7, height: 7, borderRadius: "50%", background: alive ? "#4ade80" : "#666",
  }),
  folderDot: {
    width: 7, height: 7, borderRadius: "50%", background: "#f0883e",
  },
  desktopDot: {
    width: 7, height: 7, borderRadius: "50%", background: "#a371f7",
  },
  name: { fontWeight: 600, color: "#c9d1d9", fontSize: 13 },
  status: { fontSize: 11, color: "#8b949e", marginLeft: "auto" },
  reconnectBtn: {
    background: "#238636", color: "#fff", border: "none",
    borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer",
  },
  mobileReconnect: {
    padding: "10px 12px", background: "#161b22",
    borderBottom: "1px solid #30363d", textAlign: "center",
  },
  empty: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "#0d1117", color: "#8b949e",
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: 600, color: "#c9d1d9", marginBottom: 8 },
  emptyText: { fontSize: 14, marginBottom: 20 },
  emptyActions: { display: "flex", gap: 12, marginBottom: 24 },
  emptyBtn: {
    background: "#238636", color: "#fff", border: "none",
    borderRadius: 8, padding: "10px 20px", fontSize: 14,
    fontWeight: 500, cursor: "pointer",
  },
  emptyFolderBtn: {
    background: "#1f6feb", color: "#fff", border: "none",
    borderRadius: 8, padding: "10px 20px", fontSize: 14,
    fontWeight: 500, cursor: "pointer",
  },
  emptyHint: { fontSize: 12, color: "#484f58" },
};
