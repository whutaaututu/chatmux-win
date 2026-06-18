import React, { useState, useEffect, useRef, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

const STORAGE_KEY = "chatmux-ai-config";
const HISTORY_KEY = "chatmux-ai-history";

// 默认配置
const defaultConfig = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  autoExecute: false,
};

function loadConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...defaultConfig };
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

// Markdown 渲染
function renderMarkdown(text) {
  const html = marked.parse(text, { breaks: true, gfm: true });
  return DOMPurify.sanitize(html);
}

export default function AIChat({ onClose, terminalSelection, sendInput, activeId }) {
  const [config, setConfig] = useState(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;

  // 命令确认机制
  const confirmMapRef = useRef(new Map()); // id → { resolve, reject }
  const confirmIdRef = useRef(0);

  // 等待用户确认命令执行
  const waitForConfirm = (cmd) => {
    const id = ++confirmIdRef.current;
    return new Promise((resolve) => {
      confirmMapRef.current.set(id, { resolve });
      setMessages((prev) => [
        ...prev,
        {
          role: "tool_confirm",
          confirmId: id,
          content: cmd,
          status: "pending",
        },
      ]);
    });
  };

  // 用户点击执行
  const handleConfirmExec = (id) => {
    const entry = confirmMapRef.current.get(id);
    if (entry) {
      entry.resolve("execute");
      confirmMapRef.current.delete(id);
    }
    setMessages((prev) =>
      prev.map((m) => (m.confirmId === id ? { ...m, status: "confirmed" } : m))
    );
  };

  // 用户点击跳过
  const handleConfirmSkip = (id) => {
    const entry = confirmMapRef.current.get(id);
    if (entry) {
      entry.resolve("skip");
      confirmMapRef.current.delete(id);
    }
    setMessages((prev) =>
      prev.map((m) => (m.confirmId === id ? { ...m, status: "skipped" } : m))
    );
  };

  // 保存配置
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // 保存历史（最多 100 条）
  useEffect(() => {
    const trimmed = messages.slice(-100);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  }, [messages]);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  // 为代码块注入复制按钮
  useEffect(() => {
    if (!listRef.current) return;
    // 延迟确保 DOM 已更新
    const timer = setTimeout(() => {
      const pres = listRef.current.querySelectorAll(".ai-msg-content pre");
      pres.forEach((pre) => {
        if (pre.querySelector(".cmx-copy-btn")) return;
        const btn = document.createElement("button");
        btn.className = "cmx-copy-btn";
        btn.textContent = "复制";
        btn.onclick = (e) => {
          e.stopPropagation();
          const code = pre.querySelector("code");
          const text = code ? code.textContent : pre.textContent;
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = "已复制";
            btn.classList.add("copied");
            setTimeout(() => {
              btn.textContent = "复制";
              btn.classList.remove("copied");
            }, 2000);
          });
        };
        pre.appendChild(btn);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, streamContent]);

  // 接收终端选中文本
  useEffect(() => {
    if (terminalSelection && !streaming) {
      setInput((prev) => (prev ? prev + "\n" : "") + terminalSelection);
      inputRef.current?.focus();
    }
  }, [terminalSelection]);

  // 是否已配置
  const isConfigured = config.apiKey && config.endpoint && config.model;

  // 调用 AI API（非流式，支持 tool calls）
  const callAI = async (msgs) => {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: configRef.current.endpoint,
        apiKey: configRef.current.apiKey,
        model: configRef.current.model,
        messages: msgs,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `请求失败: ${res.status}`);
    }
    return res.json();
  };

  // 执行命令（通过 exec 端点，结果在 AI 面板显示）
  const execCommand = async (command) => {
    const res = await fetch("/api/ai/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) throw new Error("命令执行失败");
    return res.json();
  };

  // 发送消息
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !isConfigured) return;

    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setStreamContent("思考中...");

    try {
      // 维护完整消息列表（过滤掉 UI 专用的 tool_exec 消息）
      let conversationMessages = newMessages
        .filter((m) => m.role !== "tool_exec")
        .map(({ role, content, tool_calls, tool_call_id }) => {
          const msg = { role, content };
          if (tool_calls) msg.tool_calls = tool_calls;
          if (tool_call_id) msg.tool_call_id = tool_call_id;
          return msg;
        });

      let round = 0;
      const MAX_ROUNDS = 5;

      while (round < MAX_ROUNDS) {
        round++;
        const data = await callAI(conversationMessages);
        const choice = data.choices?.[0];
        if (!choice) throw new Error("AI 未返回有效响应");

        const assistantMsg = choice.message;
        conversationMessages.push(assistantMsg);

        // API 不支持 tools，直接返回文本
        if (data._noTools) {
          const content = assistantMsg.content || "";
          if (content) {
            setMessages((prev) => [...prev, { role: "assistant", content }]);
          }
          break;
        }

        // 没有 tool calls → 文本回复，结束循环
        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
          const content = assistantMsg.content || "";
          if (content) {
            setMessages((prev) => [...prev, { role: "assistant", content }]);
          }
          break;
        }

        // 有 tool calls → 逐个执行
        for (const toolCall of assistantMsg.tool_calls) {
          const fn = toolCall.function;
          const toolId = toolCall.id;

          if (fn.name === "run_command") {
            let args;
            try {
              args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
            } catch {
              args = { command: fn.arguments };
            }

            const cmd = args.command || "";
            const autoExec = configRef.current.autoExecute;

            if (!autoExec) {
              // 需要用户确认
              const decision = await waitForConfirm(cmd);
              if (decision === "skip") {
                conversationMessages.push({
                  role: "tool",
                  tool_call_id: toolId,
                  content: "用户拒绝执行此命令。",
                });
                continue;
              }
              // 用户确认执行，更新状态
              setMessages((prev) =>
                prev.map((m) =>
                  m.role === "tool_confirm" && m.content === cmd && m.status === "confirmed"
                    ? { ...m, role: "tool_exec", status: "running" }
                    : m
                )
              );
            } else {
              // 自动执行，直接显示
              setMessages((prev) => [
                ...prev,
                { role: "tool_exec", content: cmd, status: "running" },
              ]);
            }

            setStreamContent(`执行中: ${cmd}`);

            // 执行命令
            const result = await execCommand(cmd);

            // 更新命令状态为完成
            setMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === "tool_exec" && updated[i].content === cmd && updated[i].status === "running") {
                  updated[i] = {
                    ...updated[i],
                    status: "done",
                    exitCode: result.exitCode,
                    output: result.stdout + (result.stderr ? "\n" + result.stderr : ""),
                  };
                  break;
                }
              }
              return updated;
            });

            // 把命令结果加入对话
            const output = result.stdout + (result.stderr ? "\n[stderr] " + result.stderr : "");
            const truncated = output.length > 8000 ? output.slice(0, 8000) + "\n...(输出过长已截断)" : output;

            conversationMessages.push({
              role: "tool",
              tool_call_id: toolId,
              content: truncated || "(无输出)",
            });
          }
        }

        // 继续循环，让 AI 处理 tool 结果
        setStreamContent("分析命令输出...");
      }

      if (round >= MAX_ROUNDS) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "⚠️ 已达到最大工具调用轮数限制" },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `❌ ${e.message}` },
      ]);
    } finally {
      setStreaming(false);
      setStreamContent("");
    }
  }, [input, messages, streaming, isConfigured]);

  // 中断生成
  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    if (streamContent) {
      setMessages((prev) => [...prev, { role: "assistant", content: streamContent }]);
      setStreamContent("");
    }
  };

  // 清空历史
  const handleClear = () => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
  };

  // 快捷键
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>🤖 AI 助手</span>
        <div style={styles.headerActions}>
          {messages.length > 0 && (
            <button style={styles.iconBtn} onClick={handleClear} title="清空历史">🗑️</button>
          )}
          <button
            style={{ ...styles.iconBtn, ...(showSettings ? styles.iconBtnActive : {}) }}
            onClick={() => setShowSettings(!showSettings)}
            title="设置"
          >
            ⚙️
          </button>
          <button style={styles.iconBtn} onClick={onClose} title="关闭">✕</button>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div style={styles.settings}>
          <div style={styles.settingRow}>
            <label style={styles.settingLabel}>API Endpoint</label>
            <input
              style={styles.settingInput}
              value={config.endpoint}
              onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div style={styles.settingRow}>
            <label style={styles.settingLabel}>API Key</label>
            <input
              style={styles.settingInput}
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div style={styles.settingRow}>
            <label style={styles.settingLabel}>Model</label>
            <input
              style={styles.settingInput}
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>
          <div style={styles.settingHint}>
            支持所有 OpenAI 兼容接口（OpenAI / DeepSeek / Claude / Ollama 等）
          </div>
          <div style={{ ...styles.settingRow, display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              id="autoExec"
              checked={config.autoExecute}
              onChange={(e) => setConfig({ ...config, autoExecute: e.target.checked })}
            />
            <label htmlFor="autoExec" style={{ fontSize: 12, color: "#c9d1d9", cursor: "pointer" }}>
              自动执行命令（跳过确认）
            </label>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div style={styles.messageList} ref={listRef}>
        {!isConfigured && messages.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🤖</div>
            <div style={styles.emptyTitle}>AI 终端助手</div>
            <div style={styles.emptyDesc}>
              点击 ⚙️ 配置 API 接口
            </div>
            <div style={styles.emptyFeatures}>
              <div>💬 对话式 AI 助手</div>
              <div>🔧 选中终端输出 → 右键"问 AI"</div>
              <div>📝 自然语言生成命令</div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              if (msg.role === "tool_confirm") {
                return (
                  <div key={i} style={styles.toolMsg}>
                    <div style={styles.toolHeader}>
                      <span>🔧</span>
                      <code style={styles.toolCmd}>{msg.content}</code>
                    </div>
                    {msg.status === "pending" && (
                      <div style={styles.confirmActions}>
                        <button style={styles.confirmBtn} onClick={() => handleConfirmExec(msg.confirmId)}>
                          ▶ 执行
                        </button>
                        <button style={styles.skipBtn} onClick={() => handleConfirmSkip(msg.confirmId)}>
                          ✕ 跳过
                        </button>
                      </div>
                    )}
                    {msg.status === "confirmed" && (
                      <div style={styles.toolRunning}>✓ 已确认，执行中...</div>
                    )}
                    {msg.status === "skipped" && (
                      <div style={styles.toolSkipped}>⊘ 已跳过</div>
                    )}
                  </div>
                );
              }
              if (msg.role === "tool_exec") {
                return (
                  <div key={i} style={styles.toolMsg}>
                    <div style={styles.toolHeader}>
                      <span>{msg.status === "running" ? "⏳" : msg.exitCode === 0 ? "✅" : "⚠️"}</span>
                      <code style={styles.toolCmd}>{msg.content}</code>
                    </div>
                    {msg.status === "done" && msg.output && (
                      <pre style={styles.toolOutput}>{msg.output}</pre>
                    )}
                    {msg.status === "running" && (
                      <div style={styles.toolRunning}>执行中...</div>
                    )}
                  </div>
                );
              }
              return (
                <div key={i} style={msg.role === "user" ? styles.userMsg : styles.aiMsg}>
                  <div style={styles.msgAvatar}>
                    {msg.role === "user" ? "👤" : "🤖"}
                  </div>
                  <div
                    className="ai-msg-content"
                    style={styles.msgContent}
                    dangerouslySetInnerHTML={{
                      __html: msg.role === "assistant"
                        ? renderMarkdown(msg.content)
                        : escapeHtml(msg.content || "").replace(/\n/g, "<br/>"),
                    }}
                  />
                </div>
              );
            })}
            {streaming && streamContent && (
              <div style={styles.aiMsg}>
                <div style={styles.msgAvatar}>🤖</div>
                <div
                  className="ai-msg-content"
                  style={styles.msgContent}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(streamContent) }}
                />
              </div>
            )}
            {streaming && !streamContent && (
              <div style={styles.aiMsg}>
                <div style={styles.msgAvatar}>🤖</div>
                <div style={styles.msgContent}>
                  <span style={styles.typing}>思考中...</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区域 */}
      <div style={styles.inputArea}>
        <textarea
          ref={inputRef}
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConfigured ? "输入消息... (Enter 发送，Shift+Enter 换行)" : "请先配置 API ⚙️"}
          disabled={!isConfigured}
          rows={2}
        />
        <div style={styles.inputActions}>
          {streaming ? (
            <button style={styles.stopBtn} onClick={handleStop}>⏹ 停止</button>
          ) : (
            <button
              style={{ ...styles.sendBtn, ...(input.trim() && isConfigured ? {} : styles.sendBtnDisabled) }}
              onClick={handleSend}
              disabled={!input.trim() || !isConfigured}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const styles = {
  container: {
    width: 380,
    height: "100%",
    background: "#0d1117",
    borderLeft: "1px solid #30363d",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid #30363d",
    background: "#161b22",
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "#c9d1d9",
  },
  headerActions: {
    display: "flex",
    gap: 4,
  },
  iconBtn: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    fontSize: 13,
    padding: "4px 6px",
    borderRadius: 4,
  },
  iconBtnActive: {
    background: "#1f6feb33",
    color: "#58a6ff",
  },
  settings: {
    padding: "10px 12px",
    borderBottom: "1px solid #30363d",
    background: "#161b22",
  },
  settingRow: {
    marginBottom: 8,
  },
  settingLabel: {
    display: "block",
    fontSize: 11,
    color: "#8b949e",
    marginBottom: 4,
  },
  settingInput: {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "6px 8px",
    color: "#c9d1d9",
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
  },
  settingHint: {
    fontSize: 10,
    color: "#484f58",
    marginTop: 4,
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#484f58",
    textAlign: "center",
    padding: 20,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "#8b949e",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 13,
    marginBottom: 16,
  },
  emptyFeatures: {
    fontSize: 12,
    lineHeight: 1.8,
    textAlign: "left",
  },
  userMsg: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
    flexDirection: "row-reverse",
  },
  aiMsg: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#21262d",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    flexShrink: 0,
  },
  msgContent: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#c9d1d9",
    background: "#161b22",
    borderRadius: 8,
    padding: "8px 12px",
    overflowX: "auto",
    minWidth: 0,
    wordBreak: "break-word",
  },
  typing: {
    color: "#58a6ff",
    animation: "pulse 1.5s infinite",
  },
  inputArea: {
    padding: "8px 12px",
    borderTop: "1px solid #30363d",
    background: "#161b22",
    flexShrink: 0,
  },
  input: {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#c9d1d9",
    fontSize: 13,
    outline: "none",
    resize: "none",
    fontFamily: "inherit",
    lineHeight: 1.5,
    boxSizing: "border-box",
  },
  inputActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 6,
    gap: 8,
  },
  sendBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 16px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },
  sendBtnDisabled: {
    background: "#21262d",
    color: "#484f58",
    cursor: "not-allowed",
  },
  stopBtn: {
    background: "#da3633",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 16px",
    fontSize: 12,
    cursor: "pointer",
  },
  toolMsg: {
    marginBottom: 12,
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 8,
    overflow: "hidden",
  },
  toolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "#1c2128",
    borderBottom: "1px solid #30363d",
    fontSize: 12,
  },
  toolCmd: {
    color: "#58a6ff",
    fontSize: 12,
    fontFamily: "monospace",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolOutput: {
    margin: 0,
    padding: "8px 12px",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#8b949e",
    background: "#0d1117",
    maxHeight: 200,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    fontFamily: "monospace",
  },
  toolRunning: {
    padding: "6px 12px",
    fontSize: 12,
    color: "#58a6ff",
  },
  toolSkipped: {
    padding: "6px 12px",
    fontSize: 12,
    color: "#484f58",
    fontStyle: "italic",
  },
  confirmActions: {
    display: "flex",
    gap: 8,
    padding: "8px 12px",
  },
  confirmBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },
  skipBtn: {
    background: "#21262d",
    color: "#8b949e",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 12,
    cursor: "pointer",
  },
};

// Markdown 样式注入
const styleTag = document.createElement("style");
styleTag.textContent = `
  .ai-msg-content pre {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 12px;
    margin: 6px 0;
    position: relative;
  }
  .ai-msg-content code {
    background: #161b22;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
  }
  .ai-msg-content pre code {
    background: none;
    padding: 0;
  }
  .ai-msg-content p {
    margin: 4px 0;
  }
  .ai-msg-content ul, .ai-msg-content ol {
    padding-left: 18px;
    margin: 4px 0;
  }
  .ai-msg-content table {
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 12px;
  }
  .ai-msg-content th, .ai-msg-content td {
    border: 1px solid #30363d;
    padding: 4px 8px;
  }
  .ai-msg-content th {
    background: #161b22;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .cmx-copy-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #8b949e;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 1;
  }
  .ai-msg-content pre:hover .cmx-copy-btn {
    opacity: 1;
  }
  .cmx-copy-btn:hover {
    background: #30363d;
    color: #c9d1d9;
  }
  .cmx-copy-btn.copied {
    color: #3fb950;
    border-color: #3fb950;
  }
`;
if (!document.getElementById("ai-chat-styles")) {
  styleTag.id = "ai-chat-styles";
  document.head.appendChild(styleTag);
}
