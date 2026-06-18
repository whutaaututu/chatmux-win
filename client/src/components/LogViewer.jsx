import React, { useState, useEffect, useRef, useCallback } from "react";

// ANSI 颜色映射
const ANSI_COLORS = {
  // 标准颜色
  30: "#000", 31: "#c91b00", 32: "#00c200", 33: "#c7c400",
  34: "#0225c7", 35: "#c930c7", 36: "#00c5c7", 37: "#c7c7c7",
  // 亮色
  90: "#676767", 91: "#ff6d67", 92: "#5ff967", 93: "#fefb67",
  94: "#6871ff", 95: "#ff76ff", 96: "#5ffdff", 97: "#fefefe",
};

// 清除 ANSI 转义码
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[K/g, "");
}

// 将 ANSI 转换为 HTML
function ansiToHtml(text) {
  if (!text) return "";

  let result = "";
  let currentColor = null;
  let currentBg = null;
  let lastIndex = 0;

  // 匹配所有 ANSI 转义码
  const regex = /\x1b\[([0-9;]*)m|\x1b\[K/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 添加转义码之前的文本
    if (match.index > lastIndex) {
      const segment = text.substring(lastIndex, match.index);
      if (currentColor || currentBg) {
        const style = [];
        if (currentColor) style.push(`color:${currentColor}`);
        if (currentBg) style.push(`background-color:${currentBg}`);
        result += `<span style="${style.join(";")}">${escapeHtml(segment)}</span>`;
      } else {
        result += escapeHtml(segment);
      }
    }

    // 处理转义码
    const code = match[1];
    if (code) {
      const parts = code.split(";").map(Number);

      if (parts.includes(0)) {
        // 重置
        currentColor = null;
        currentBg = null;
      }

      // 检查前景色
      for (const part of parts) {
        if ((part >= 30 && part <= 37) || (part >= 90 && part <= 97)) {
          currentColor = ANSI_COLORS[part];
        }
        if (part >= 40 && part <= 47) {
          currentBg = ANSI_COLORS[part - 10];
        }
      }

      // 24-bit 真彩色
      if (parts.length >= 5 && parts[0] === 38 && parts[1] === 2) {
        currentColor = `rgb(${parts[2]},${parts[3]},${parts[4]})`;
      }
      if (parts.length >= 5 && parts[0] === 48 && parts[1] === 2) {
        currentBg = `rgb(${parts[2]},${parts[3]},${parts[4]})`;
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    const segment = text.substring(lastIndex);
    if (currentColor || currentBg) {
      const style = [];
      if (currentColor) style.push(`color:${currentColor}`);
      if (currentBg) style.push(`background-color:${currentBg}`);
      result += `<span style="${style.join(";")}">${escapeHtml(segment)}</span>`;
    } else {
      result += escapeHtml(segment);
    }
  }

  return result;
}

// HTML 转义
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 默认日志级别配置
const DEFAULT_LEVELS = [
  { id: "error", label: "ERROR", color: "#f85149", bgColor: "rgba(248,81,73,0.1)", pattern: /\b(error|err|fatal|panic|critical)\b/i },
  { id: "warn", label: "WARN", color: "#e8a230", bgColor: "rgba(232,162,48,0.1)", pattern: /\b(warn|warning)\b/i },
  { id: "info", label: "INFO", color: "#58a6ff", bgColor: "rgba(88,166,255,0.1)", pattern: /\b(info|notice)\b/i },
  { id: "debug", label: "DEBUG", color: "#8b949e", bgColor: "rgba(139,148,158,0.1)", pattern: /\b(debug|trace)\b/i },
  { id: "success", label: "SUCCESS", color: "#3fb950", bgColor: "rgba(63,185,80,0.1)", pattern: /\b(success|ok|done|complete)\b/i },
];

// 时间格式识别
const TIME_PATTERNS = [
  { name: "ISO 8601", pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ },
  { name: "Common Log", pattern: /\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}/ },
  { name: "Syslog", pattern: /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/ },
  { name: "Simple", pattern: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/ },
  { name: "Timestamp", pattern: /\d{10,13}/ },
];

export default function LogViewer({ filePath, fileName, onClose }) {
  const [lines, setLines] = useState([]);
  const [filteredLines, setFilteredLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [enabledLevels, setEnabledLevels] = useState(new Set(DEFAULT_LEVELS.map(l => l.id)));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(1000);
  const [showSettings, setShowSettings] = useState(false);
  const [newLevel, setNewLevel] = useState({ id: "", label: "", color: "#58a6ff", pattern: "" });
  const [stats, setStats] = useState({});
  const [selectedLine, setSelectedLine] = useState(null);
  const [ansiMode, setAnsiMode] = useState("render"); // "render" | "strip" | "raw"
  const [customFilters, setCustomFilters] = useState([]); // [{id, label, pattern, enabled, color}]
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [newFilter, setNewFilter] = useState({ label: "", pattern: "", color: "#58a6ff" });

  const containerRef = useRef(null);
  const refreshTimerRef = useRef(null);

  // 加载日志文件
  const loadLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "加载失败");
      }
      const text = await res.text();
      const logLines = text.split("\n").map((line, index) => ({
        id: index,
        raw: line,
        level: detectLevel(line, levels),
        time: extractTime(line),
      }));
      setLines(logLines);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filePath, levels]);

  // 检测日志级别
  function detectLevel(line, levels) {
    // 先清除 ANSI 代码再匹配
    const cleanLine = stripAnsi(line);
    for (const level of levels) {
      if (level.pattern.test(cleanLine)) {
        return level.id;
      }
    }
    return "unknown";
  }

  // 提取时间
  function extractTime(line) {
    for (const tp of TIME_PATTERNS) {
      const match = line.match(tp.pattern);
      if (match) {
        try {
          let dateStr = match[0];

          // 处理 Unix 时间戳（10位秒级）
          if (/^\d{10}$/.test(dateStr)) {
            dateStr = parseInt(dateStr) * 1000;
          }

          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return date;
          }
        } catch {}
      }
    }
    return null;
  }

  // 初始化
  useEffect(() => {
    loadLog();
  }, [loadLog]);

  // 自动刷新
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(loadLog, refreshInterval);
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [autoRefresh, refreshInterval, loadLog]);

  // 过滤和统计
  useEffect(() => {
    let filtered = lines;

    // 按级别过滤
    filtered = filtered.filter(line => {
      if (line.level === "unknown") return true;
      return enabledLevels.has(line.level);
    });

    // 按搜索词过滤
    if (searchQuery) {
      const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
      filtered = filtered.filter(line => {
        // 搜索清除 ANSI 代码后的内容
        const text = searchCaseSensitive ? stripAnsi(line.raw) : stripAnsi(line.raw).toLowerCase();
        return text.includes(query);
      });
    }

    // 按自定义标签过滤
    const activeFilters = customFilters.filter(f => f.enabled);
    if (activeFilters.length > 0) {
      // 先标记哪些行需要显示
      const showLineIndices = new Set();

      activeFilters.forEach(filter => {
        const pattern = filter.isRegex ? new RegExp(filter.pattern, "i") : null;

        lines.forEach((line, index) => {
          const text = stripAnsi(line.raw);
          const matches = pattern ? pattern.test(text) : text.toLowerCase().includes(filter.pattern.toLowerCase());

          if (matches) {
            // 显示匹配的行
            showLineIndices.add(index);

            // 显示后续的缩进行（多行日志关联）
            for (let i = index + 1; i < lines.length; i++) {
              const nextLine = stripAnsi(lines[i].raw);
              // 如果下一行以空格或制表符开头，认为是同一日志的续行
              if (nextLine.startsWith(" ") || nextLine.startsWith("\t") || nextLine === "") {
                showLineIndices.add(i);
              } else {
                break;
              }
            }
          }
        });
      });

      filtered = filtered.filter(line => showLineIndices.has(line.id));
    }

    setFilteredLines(filtered);

    // 统计
    const newStats = {};
    lines.forEach(line => {
      newStats[line.level] = (newStats[line.level] || 0) + 1;
    });
    setStats(newStats);
  }, [lines, enabledLevels, searchQuery, searchCaseSensitive, customFilters]);

  // 切换级别
  const toggleLevel = (levelId) => {
    setEnabledLevels(prev => {
      const next = new Set(prev);
      if (next.has(levelId)) {
        next.delete(levelId);
      } else {
        next.add(levelId);
      }
      return next;
    });
  };

  // 全选/取消全选
  const toggleAllLevels = () => {
    if (enabledLevels.size === levels.length) {
      setEnabledLevels(new Set());
    } else {
      setEnabledLevels(new Set(levels.map(l => l.id)));
    }
  };

  // 添加自定义过滤器
  const addCustomFilter = () => {
    if (!newFilter.label || !newFilter.pattern) return;
    const filter = {
      id: Date.now().toString(),
      ...newFilter,
      enabled: true,
      isRegex: false,
    };
    setCustomFilters(prev => [...prev, filter]);
    setNewFilter({ label: "", pattern: "", color: "#58a6ff" });
  };

  // 切换自定义过滤器
  const toggleCustomFilter = (filterId) => {
    setCustomFilters(prev => prev.map(f =>
      f.id === filterId ? { ...f, enabled: !f.enabled } : f
    ));
  };

  // 删除自定义过滤器
  const removeCustomFilter = (filterId) => {
    setCustomFilters(prev => prev.filter(f => f.id !== filterId));
  };

  // 切换正则模式
  const toggleRegexMode = (filterId) => {
    setCustomFilters(prev => prev.map(f =>
      f.id === filterId ? { ...f, isRegex: !f.isRegex } : f
    ));
  };

  // 添加自定义级别
  const addLevel = () => {
    if (!newLevel.id || !newLevel.label || !newLevel.pattern) return;
    try {
      const pattern = new RegExp(newLevel.pattern, "i");
      const level = { ...newLevel, pattern };
      setLevels(prev => [...prev, level]);
      setEnabledLevels(prev => new Set([...prev, level.id]));
      setNewLevel({ id: "", label: "", color: "#58a6ff", pattern: "" });
    } catch (e) {
      alert("正则表达式无效: " + e.message);
    }
  };

  // 删除自定义级别
  const removeLevel = (levelId) => {
    setLevels(prev => prev.filter(l => l.id !== levelId));
    setEnabledLevels(prev => {
      const next = new Set(prev);
      next.delete(levelId);
      return next;
    });
  };

  // 获取级别样式
  const getLevelStyle = (levelId) => {
    const level = levels.find(l => l.id === levelId);
    if (level) {
      return { color: level.color, backgroundColor: level.bgColor };
    }
    return {};
  };

  // 获取级别标签
  const getLevelLabel = (levelId) => {
    const level = levels.find(l => l.id === levelId);
    return level ? level.label : levelId.toUpperCase();
  };

  // 滚动到底部
  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  // 导出过滤后的日志
  const exportFiltered = () => {
    const content = filteredLines.map(l => l.raw).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `filtered_${fileName}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 高亮搜索词（返回 JSX）
  const highlightText = (text) => {
    if (!searchQuery) return text;
    const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
    const textLower = searchCaseSensitive ? text : text.toLowerCase();

    // 找到所有匹配位置
    const parts = [];
    let lastIndex = 0;
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const index = textLower.indexOf(query, searchFrom);
      if (index === -1) break;

      // 添加匹配前的文本
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }
      // 添加高亮的匹配文本
      parts.push(
        <span key={index} style={styles.highlight}>
          {text.substring(index, index + searchQuery.length)}
        </span>
      );
      lastIndex = index + searchQuery.length;
      searchFrom = lastIndex;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  // 高亮搜索词（返回 HTML 字符串，用于 dangerouslySetInnerHTML）
  const highlightTextHtml = (text) => {
    if (!searchQuery) return escapeHtml(text);
    const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
    const textLower = searchCaseSensitive ? text : text.toLowerCase();

    let result = "";
    let lastIndex = 0;
    let searchFrom = 0;

    while (searchFrom < textLower.length) {
      const index = textLower.indexOf(query, searchFrom);
      if (index === -1) break;

      // 添加匹配前的文本
      if (index > lastIndex) {
        result += escapeHtml(text.substring(lastIndex, index));
      }
      // 添加高亮的匹配文本
      result += `<span style="background:#e8a230;color:#0d1117;padding:0 2px;border-radius:2px">${escapeHtml(text.substring(index, index + searchQuery.length))}</span>`;
      lastIndex = index + searchQuery.length;
      searchFrom = lastIndex;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
      result += escapeHtml(text.substring(lastIndex));
    }

    return result || escapeHtml(text);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.centerMessage}>⏳ 加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.centerMessage}>
          <span style={{ color: "#f85149" }}>❌ {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} onContextMenu={(e) => e.stopPropagation()}>
      {/* 头部工具栏 */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <span style={styles.fileName}>📋 {fileName}</span>
          <span style={styles.lineCount}>{filteredLines.length} / {lines.length} 行</span>
        </div>
        <div style={styles.toolbarRight}>
          <button
            style={styles.toolBtn}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? "停止刷新" : "自动刷新"}
          >
            {autoRefresh ? "⏸️" : "▶️"} {autoRefresh ? "停止" : "刷新"}
          </button>
          <button style={styles.toolBtn} onClick={loadLog} title="手动刷新">
            🔄
          </button>
          <button style={styles.toolBtn} onClick={scrollToBottom} title="滚动到底部">
            ⬇️
          </button>
          <button style={styles.toolBtn} onClick={exportFiltered} title="导出过滤后的日志">
            📥
          </button>
          <button
            style={{
              ...styles.toolBtn,
              ...(ansiMode === "render" ? styles.toolBtnActive : {})
            }}
            onClick={() => setAnsiMode(prev => {
              if (prev === "render") return "strip";
              if (prev === "strip") return "raw";
              return "render";
            })}
            title={`ANSI 模式: ${ansiMode === "render" ? "渲染颜色" : ansiMode === "strip" ? "清除代码" : "原始文本"}`}
          >
            {ansiMode === "render" ? "🎨" : ansiMode === "strip" ? "📝" : "📄"} ANSI
          </button>
          <button style={styles.toolBtn} onClick={() => setShowSettings(!showSettings)} title="设置">
            ⚙️
          </button>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* 级别过滤器 */}
      <div style={styles.levelBar}>
        <button
          style={{
            ...styles.levelBtn,
            ...(enabledLevels.size === levels.length ? styles.levelBtnAll : styles.levelBtnDisabled)
          }}
          onClick={toggleAllLevels}
        >
          全部
        </button>
        {levels.map(level => (
          <button
            key={level.id}
            style={{
              ...styles.levelBtn,
              color: enabledLevels.has(level.id) ? level.color : "#484f58",
              borderColor: enabledLevels.has(level.id) ? level.color : "#30363d",
              backgroundColor: enabledLevels.has(level.id) ? level.bgColor : "transparent",
            }}
            onClick={() => toggleLevel(level.id)}
          >
            {level.label}
            <span style={styles.levelCount}>{stats[level.id] || 0}</span>
          </button>
        ))}
      </div>

      {/* 搜索栏 */}
      <div style={styles.searchBar}>
        <input
          style={styles.searchInput}
          placeholder="🔍 搜索日志..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          style={{
            ...styles.searchOption,
            ...(searchCaseSensitive ? styles.searchOptionActive : {})
          }}
          onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
          title="区分大小写"
        >
          Aa
        </button>
        {searchQuery && (
          <span style={styles.searchCount}>
            {filteredLines.length} 个匹配
          </span>
        )}
        <button
          style={{
            ...styles.toolBtn,
            ...(customFilters.length > 0 ? styles.toolBtnActive : {})
          }}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          title="自定义标签过滤"
        >
          🏷️ 标签 {customFilters.length > 0 && `(${customFilters.filter(f => f.enabled).length})`}
        </button>
      </div>

      {/* 自定义过滤器面板 */}
      {showFilterPanel && (
        <div style={styles.filterPanel}>
          <div style={styles.filterHeader}>
            <span style={styles.filterTitle}>🏷️ 自定义标签过滤</span>
            <span style={styles.filterHint}>匹配的行及其续行（缩进行）都会显示</span>
          </div>
          <div style={styles.filterList}>
            {customFilters.map(filter => (
              <div
                key={filter.id}
                style={{
                  ...styles.filterItem,
                  opacity: filter.enabled ? 1 : 0.5,
                }}
              >
                <button
                  style={{
                    ...styles.filterToggle,
                    background: filter.enabled ? filter.color : "#21262d",
                    borderColor: filter.enabled ? filter.color : "#30363d",
                  }}
                  onClick={() => toggleCustomFilter(filter.id)}
                >
                  {filter.enabled ? "✓" : ""}
                </button>
                <span style={{ ...styles.filterLabel, color: filter.color }}>
                  {filter.label}
                </span>
                <code style={styles.filterPattern}>{filter.pattern}</code>
                <button
                  style={{
                    ...styles.filterModeBtn,
                    ...(filter.isRegex ? styles.filterModeBtnActive : {})
                  }}
                  onClick={() => toggleRegexMode(filter.id)}
                  title={filter.isRegex ? "正则模式" : "文本模式"}
                >
                  .*
                </button>
                <button
                  style={styles.removeBtn}
                  onClick={() => removeCustomFilter(filter.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={styles.addFilterForm}>
            <input
              style={styles.addFilterInput}
              placeholder="标签名 (如: Info)"
              value={newFilter.label}
              onChange={(e) => setNewFilter(prev => ({ ...prev, label: e.target.value }))}
            />
            <input
              style={styles.addFilterInput}
              placeholder="匹配内容 (如: info)"
              value={newFilter.pattern}
              onChange={(e) => setNewFilter(prev => ({ ...prev, pattern: e.target.value }))}
            />
            <input
              type="color"
              style={styles.colorInput}
              value={newFilter.color}
              onChange={(e) => setNewFilter(prev => ({ ...prev, color: e.target.value }))}
            />
            <button style={styles.addBtn} onClick={addCustomFilter}>
              添加
            </button>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div style={styles.settingsPanel}>
          <h4 style={styles.settingsTitle}>自定义日志级别</h4>
          <div style={styles.levelList}>
            {levels.map(level => (
              <div key={level.id} style={styles.levelItem}>
                <span style={{ color: level.color, fontWeight: 600 }}>{level.label}</span>
                <code style={styles.levelPattern}>{level.pattern.toString()}</code>
                {!DEFAULT_LEVELS.find(l => l.id === level.id) && (
                  <button style={styles.removeBtn} onClick={() => removeLevel(level.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div style={styles.addLevelForm}>
            <input
              style={styles.addInput}
              placeholder="ID (如: critical)"
              value={newLevel.id}
              onChange={(e) => setNewLevel(prev => ({ ...prev, id: e.target.value }))}
            />
            <input
              style={styles.addInput}
              placeholder="标签 (如: CRITICAL)"
              value={newLevel.label}
              onChange={(e) => setNewLevel(prev => ({ ...prev, label: e.target.value }))}
            />
            <input
              style={styles.addInput}
              placeholder="正则 (如: \bcritical\b)"
              value={newLevel.pattern}
              onChange={(e) => setNewLevel(prev => ({ ...prev, pattern: e.target.value }))}
            />
            <input
              type="color"
              style={styles.colorInput}
              value={newLevel.color}
              onChange={(e) => setNewLevel(prev => ({ ...prev, color: e.target.value }))}
            />
            <button style={styles.addBtn} onClick={addLevel}>添加</button>
          </div>
        </div>
      )}

      {/* 日志内容 */}
      <div ref={containerRef} style={styles.logContent}>
        {filteredLines.length === 0 ? (
          <div style={styles.emptyMessage}>没有匹配的日志</div>
        ) : (
          filteredLines.map((line) => (
            <div
              key={line.id}
              style={{
                ...styles.logLine,
                ...(line.level !== "unknown" ? getLevelStyle(line.level) : {}),
                ...(selectedLine === line.id ? styles.logLineSelected : {}),
              }}
              onClick={() => setSelectedLine(line.id === selectedLine ? null : line.id)}
            >
              <span style={styles.lineNumber}>{line.id + 1}</span>
              {line.level !== "unknown" && (
                <span style={{
                  ...styles.levelBadge,
                  color: levels.find(l => l.id === line.level)?.color || "#8b949e",
                }}>
                  {getLevelLabel(line.level)}
                </span>
              )}
              <span style={styles.logText}>
                {ansiMode === "render" ? (
                  <span dangerouslySetInnerHTML={{ __html: highlightTextHtml(ansiToHtml(line.raw)) }} />
                ) : ansiMode === "strip" ? (
                  highlightText(stripAnsi(line.raw))
                ) : (
                  highlightText(line.raw)
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 详情面板 */}
      {selectedLine !== null && (
        <div style={styles.detailPanel}>
          <div style={styles.detailHeader}>
            <span>行 {selectedLine + 1}</span>
            <button style={styles.detailClose} onClick={() => setSelectedLine(null)}>✕</button>
          </div>
          <pre style={styles.detailContent}>
            {lines[selectedLine]?.raw}
          </pre>
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
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 600,
  },
  lineCount: {
    fontSize: 12,
    color: "#8b949e",
    padding: "2px 8px",
    background: "#21262d",
    borderRadius: 4,
  },
  toolBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 12,
    color: "#c9d1d9",
  },
  toolBtnActive: {
    background: "#0e639c",
    borderColor: "#58a6ff",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 16,
  },
  levelBar: {
    display: "flex",
    gap: 6,
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  levelBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid #30363d",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    background: "transparent",
  },
  levelBtnAll: {
    color: "#58a6ff",
    borderColor: "#58a6ff",
  },
  levelBtnDisabled: {
    color: "#484f58",
    borderColor: "#30363d",
  },
  levelCount: {
    fontSize: 10,
    opacity: 0.7,
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: "8px 12px",
    color: "#c9d1d9",
    fontSize: 13,
    outline: "none",
  },
  searchOption: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    color: "#8b949e",
  },
  searchOptionActive: {
    color: "#58a6ff",
    borderColor: "#58a6ff",
  },
  searchCount: {
    fontSize: 12,
    color: "#8b949e",
  },
  settingsPanel: {
    padding: "16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  settingsTitle: {
    margin: "0 0 12px 0",
    fontSize: 14,
    color: "#c9d1d9",
  },
  levelList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
  },
  levelItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "6px 10px",
    background: "#0d1117",
    borderRadius: 4,
  },
  levelPattern: {
    flex: 1,
    fontSize: 12,
    color: "#8b949e",
    background: "#21262d",
    padding: "2px 6px",
    borderRadius: 3,
  },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#f85149",
    cursor: "pointer",
    padding: "2px 6px",
    fontSize: 12,
  },
  addLevelForm: {
    display: "flex",
    gap: 8,
  },
  addInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "6px 10px",
    color: "#c9d1d9",
    fontSize: 12,
    outline: "none",
  },
  colorInput: {
    width: 40,
    height: 32,
    padding: 0,
    border: "1px solid #30363d",
    borderRadius: 4,
    cursor: "pointer",
  },
  addBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 12,
  },
  filterPanel: {
    padding: "12px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  filterHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  filterTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#c9d1d9",
  },
  filterHint: {
    fontSize: 11,
    color: "#8b949e",
  },
  filterList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 10,
  },
  filterItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: "#0d1117",
    borderRadius: 4,
  },
  filterToggle: {
    width: 24,
    height: 24,
    border: "2px solid #30363d",
    borderRadius: 4,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: 600,
    minWidth: 60,
  },
  filterPattern: {
    flex: 1,
    fontSize: 12,
    color: "#8b949e",
    background: "#21262d",
    padding: "2px 6px",
    borderRadius: 3,
    fontFamily: "monospace",
  },
  filterModeBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 3,
    padding: "3px 6px",
    cursor: "pointer",
    fontSize: 11,
    color: "#8b949e",
    fontFamily: "monospace",
    flexShrink: 0,
  },
  filterModeBtnActive: {
    color: "#58a6ff",
    borderColor: "#58a6ff",
    background: "rgba(88,166,255,0.1)",
  },
  addFilterForm: {
    display: "flex",
    gap: 8,
  },
  addFilterInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "6px 10px",
    color: "#c9d1d9",
    fontSize: 12,
    outline: "none",
  },
  logContent: {
    flex: 1,
    overflow: "auto",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.5,
  },
  emptyMessage: {
    padding: 40,
    textAlign: "center",
    color: "#8b949e",
  },
  logLine: {
    display: "flex",
    alignItems: "flex-start",
    padding: "2px 16px",
    cursor: "pointer",
    borderBottom: "1px solid transparent",
    minHeight: 24,
  },
  logLineSelected: {
    background: "rgba(88,166,255,0.15)",
    borderColor: "#30363d",
  },
  lineNumber: {
    width: 50,
    color: "#484f58",
    textAlign: "right",
    paddingRight: 12,
    flexShrink: 0,
    userSelect: "none",
    fontSize: 11,
  },
  levelBadge: {
    width: 60,
    fontSize: 10,
    fontWeight: 600,
    textAlign: "center",
    flexShrink: 0,
    marginRight: 8,
  },
  logText: {
    flex: 1,
    wordBreak: "break-all",
    whiteSpace: "pre-wrap",
  },
  highlight: {
    background: "#e8a230",
    color: "#0d1117",
    padding: "0 2px",
    borderRadius: 2,
  },
  detailPanel: {
    background: "#161b22",
    borderTop: "1px solid #30363d",
    maxHeight: 200,
    flexShrink: 0,
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid #30363d",
    fontSize: 12,
    color: "#8b949e",
  },
  detailClose: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    padding: "2px 6px",
    fontSize: 14,
  },
  detailContent: {
    padding: "12px 16px",
    margin: 0,
    fontSize: 12,
    overflow: "auto",
    maxHeight: 150,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  centerMessage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#8b949e",
  },
};
