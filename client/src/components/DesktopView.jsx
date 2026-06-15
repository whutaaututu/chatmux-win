import React, { useEffect, useRef, useState, useCallback } from "react";

// noVNC RFB 动态加载（兼容 Vite ESM）
let RFBClass = null;
let rfbLoadPromise = null;

async function loadRFB() {
  if (RFBClass) return RFBClass;
  if (rfbLoadPromise) return rfbLoadPromise;

  rfbLoadPromise = (async () => {
    try {
      const mod = await import("@novnc/novnc");
      RFBClass = mod.default || mod.RFB || mod;
      return RFBClass;
    } catch (e) {
      console.error("加载 noVNC 失败:", e);
      throw e;
    }
  })();

  return rfbLoadPromise;
}

export default function DesktopView({ sessionId, alive, onStatusChange }) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const rfbRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | starting | connecting | connected | error | stopped
  const [errorMsg, setErrorMsg] = useState("");
  const [vncPort, setVncPort] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scaleMode, setScaleMode] = useState("fit"); // fit | width | 50 | 75 | 100 | 150

  const updateStatus = useCallback((s, msg) => {
    setStatus(s);
    onStatusChange?.(s, msg);
  }, [onStatusChange]);

  // 启动 VNC 服务
  const startVnc = useCallback(async () => {
    updateStatus("starting", "正在启动桌面环境...");
    setErrorMsg("");

    try {
      const res = await fetch("/api/desktop/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "启动失败");
      }

      setVncPort(data.vncPort);
      updateStatus("connecting", "正在连接桌面...");
    } catch (e) {
      setErrorMsg(e.message);
      updateStatus("error", e.message);
    }
  }, [sessionId, updateStatus]);

  // 停止 VNC
  const stopVnc = useCallback(async () => {
    try {
      await fetch("/api/desktop/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {}

    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch {}
      rfbRef.current = null;
    }
    setVncPort(null);
    updateStatus("stopped", "桌面已停止");
  }, [sessionId, updateStatus]);

  // 当有 vncPort 时连接 noVNC
  useEffect(() => {
    if (!vncPort || !containerRef.current) return;

    let disposed = false;

    (async () => {
      try {
        const RFB = await loadRFB();
        if (disposed || !containerRef.current) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/vnc?sessionId=${sessionId}`;

        // 清理旧连接
        if (rfbRef.current) {
          try { rfbRef.current.disconnect(); } catch {}
        }

        // 清空容器
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
        }

        const rfb = new RFB(containerRef.current, wsUrl, {
          credentials: {},
        });

        rfb.viewOnly = false;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;

        rfb.addEventListener("connect", () => {
          if (!disposed) updateStatus("connected", "已连接");
        });

        rfb.addEventListener("disconnect", (e) => {
          if (!disposed) {
            const detail = e.detail?.reason || "连接断开";
            updateStatus("stopped", detail);
          }
        });

        rfb.addEventListener("credentialsrequired", () => {
          // 无密码模式，不需要处理
        });

        rfbRef.current = rfb;
      } catch (e) {
        if (!disposed) {
          setErrorMsg(e.message);
          updateStatus("error", `连接失败: ${e.message}`);
        }
      }
    })();

    return () => {
      disposed = true;
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch {}
        rfbRef.current = null;
      }
    };
  }, [vncPort, sessionId, updateStatus]);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // 监听全屏状态变化
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Esc 退出全屏由浏览器原生支持，无需额外处理

  // 应用缩放模式到 RFB
  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;

    if (scaleMode === "fit") {
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
    } else if (scaleMode === "width") {
      // 适应宽度：让画布宽度撑满容器
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
    } else {
      // 固定比例：关闭自动缩放，用 CSS transform 缩放
      rfb.scaleViewport = false;
      rfb.resizeSession = false;
    }
  }, [scaleMode]);

  // 固定比例缩放时，通过 CSS transform 控制画布
  const getCanvasStyle = useCallback(() => {
    const base = { ...styles.canvas };
    if (status !== "connected" && status !== "connecting") {
      return { ...base, display: "none" };
    }
    if (scaleMode === "fit" || scaleMode === "width") {
      return { ...base, overflow: "auto" };
    }
    // 固定比例：用 transform 缩放，画布原尺寸渲染
    const scale = parseInt(scaleMode, 10) / 100;
    return {
      ...base,
      overflow: "auto",
      display: "flex",
      justifyContent: "center",
    };
  }, [status, scaleMode]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch {}
        rfbRef.current = null;
      }
    };
  }, []);

  const scaleOptions = [
    { value: "fit", label: "适应" },
    { value: "width", label: "适应宽度" },
    { value: "50", label: "50%" },
    { value: "75", label: "75%" },
    { value: "100", label: "100%" },
    { value: "150", label: "150%" },
  ];

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <span style={styles.title}>🖥️ 远程桌面</span>
        <span style={styles[`status_${status}`]}>
          {status === "idle" && "未启动"}
          {status === "starting" && "⏳ 启动中..."}
          {status === "connecting" && "⏳ 连接中..."}
          {status === "connected" && "🟢 已连接"}
          {status === "error" && "❌ 错误"}
          {status === "stopped" && "⚪ 已停止"}
        </span>
        <div style={styles.actions}>
          {/* 缩放控制 — 仅在已连接/连接中显示 */}
          {(status === "connected" || status === "connecting") && (
            <select
              style={styles.scaleSelect}
              value={scaleMode}
              onChange={(e) => setScaleMode(e.target.value)}
              title="缩放比例"
            >
              {scaleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {/* 全屏按钮 — 仅在已连接时显示 */}
          {status === "connected" && (
            <button
              style={styles.iconBtn}
              onClick={toggleFullscreen}
              title={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? "⊞" : "⛶"}
            </button>
          )}

          {status === "idle" || status === "stopped" || status === "error" ? (
            <button style={styles.startBtn} onClick={startVnc}>
              ▶ 启动桌面
            </button>
          ) : status === "connected" || status === "connecting" || status === "starting" ? (
            <button style={styles.stopBtn} onClick={stopVnc}>
              ⏹ 停止
            </button>
          ) : null}
        </div>
      </div>

      {/* 错误信息 */}
      {errorMsg && (
        <div style={styles.errorBanner}>
          <span>{errorMsg}</span>
          <button style={styles.dismissBtn} onClick={() => setErrorMsg("")}>✕</button>
        </div>
      )}

      {/* VNC 画布容器 */}
      <div
        ref={containerRef}
        style={getCanvasStyle()}
      />

      {/* 空闲状态 */}
      {status === "idle" && (
        <div style={styles.placeholder}>
          <div style={styles.placeholderIcon}>🖥️</div>
          <div style={styles.placeholderText}>点击「启动桌面」开始远程桌面会话</div>
          <div style={styles.placeholderHint}>
            需要服务器安装 Xvfb 和 x11vnc
          </div>
          <button style={styles.startBtnLarge} onClick={startVnc}>
            ▶ 启动桌面
          </button>
        </div>
      )}

      {/* 启动中 */}
      {(status === "starting" || status === "connecting") && (
        <div style={styles.placeholder}>
          <div style={styles.spinner} />
          <div style={styles.placeholderText}>
            {status === "starting" ? "正在启动桌面环境..." : "正在连接 VNC..."}
          </div>
          <div style={styles.placeholderHint}>首次启动可能需要几秒钟</div>
        </div>
      )}

      {/* 已停止 */}
      {status === "stopped" && (
        <div style={styles.placeholder}>
          <div style={styles.placeholderIcon}>💤</div>
          <div style={styles.placeholderText}>桌面已停止</div>
          <button style={styles.startBtnLarge} onClick={startVnc}>
            ▶ 重新启动
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#0d1117",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  title: {
    color: "#c9d1d9",
    fontSize: 14,
    fontWeight: 600,
  },
  status_idle: { color: "#8b949e", fontSize: 12, flex: 1 },
  status_starting: { color: "#d29922", fontSize: 12, flex: 1 },
  status_connecting: { color: "#d29922", fontSize: 12, flex: 1 },
  status_connected: { color: "#3fb950", fontSize: 12, flex: 1 },
  status_error: { color: "#f85149", fontSize: 12, flex: 1 },
  status_stopped: { color: "#8b949e", fontSize: 12, flex: 1 },
  actions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  scaleSelect: {
    background: "#21262d",
    color: "#c9d1d9",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
  },
  iconBtn: {
    background: "#21262d",
    color: "#c9d1d9",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 16,
    cursor: "pointer",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  startBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },
  stopBtn: {
    background: "#da3633",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },
  canvas: {
    flex: 1,
    overflow: "hidden",
    background: "#000",
  },
  placeholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: 8,
  },
  placeholderText: {
    color: "#c9d1d9",
    fontSize: 16,
    fontWeight: 500,
  },
  placeholderHint: {
    color: "#8b949e",
    fontSize: 13,
  },
  startBtnLarge: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 500,
    marginTop: 8,
  },
  errorBanner: {
    background: "#490202",
    color: "#f85149",
    padding: "8px 16px",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #f8514933",
  },
  dismissBtn: {
    background: "none",
    border: "none",
    color: "#f85149",
    cursor: "pointer",
    fontSize: 14,
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #30363d",
    borderTopColor: "#58a6ff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
};
