import React, { useState, useEffect, useRef, useCallback } from "react";

export default function FileSearch({ searchPath, onClose, onOpenFile, onOpenFolder }) {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("both"); // "name" | "content" | "both"
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef(null);
  const searchTimerRef = useRef(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 搜索选项变化时自动搜索
  useEffect(() => {
    if (query.trim()) {
      performSearch(query);
    }
  }, [searchType, isRegex, caseSensitive, performSearch, query]);

  // 用 ref 保存最新搜索参数，避免闭包过期
  const searchParamsRef = useRef({ searchPath, searchType, isRegex, caseSensitive });
  searchParamsRef.current = { searchPath, searchType, isRegex, caseSensitive };

  // 执行搜索
  const performSearch = useCallback(async (overrideQuery) => {
    const q = overrideQuery ?? queryRef.current;
    const { searchPath: sp, searchType: st, isRegex: re, caseSensitive: cs } = searchParamsRef.current;

    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams({
        path: sp,
        query: q.trim(),
        type: st,
        regex: re.toString(),
        caseSensitive: cs.toString(),
      });

      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      console.error("搜索失败:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 输入变化时延迟搜索
  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => performSearch(val), 300);
  };

  // 键盘事件
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      performSearch(query);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // 点击结果
  const handleResultClick = (result) => {
    if (result.isDirectory) {
      onOpenFolder(result.path);
    } else {
      onOpenFile(result.path, result.name);
    }
  };

  // 高亮匹配文本
  const highlightMatch = (text, matchQuery) => {
    if (!matchQuery) return text;

    try {
      const regex = isRegex
        ? new RegExp(`(${matchQuery})`, caseSensitive ? "g" : "gi")
        : new RegExp(`(${matchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, caseSensitive ? "g" : "gi");

      const parts = text.split(regex);
      return parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} style={styles.highlight}>{part}</span>
        ) : (
          part
        )
      );
    } catch {
      return text;
    }
  };

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // 获取文件图标
  const getIcon = (name, isDirectory) => {
    if (isDirectory) return "📂";
    const ext = name.split(".").pop()?.toLowerCase();
    const iconMap = {
      js: "📜", jsx: "⚛️", ts: "📘", tsx: "⚛️",
      py: "🐍", json: "📋", md: "📝", html: "🌐", css: "🎨",
    };
    return iconMap[ext] || "📄";
  };

  return (
    <div style={styles.container} onContextMenu={(e) => e.stopPropagation()}>
      {/* 头部 */}
      <div style={styles.header}>
        <span style={styles.title}>🔍 文件搜索</span>
        <span style={styles.path}>{searchPath}</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* 搜索栏 */}
      <div style={styles.searchBar}>
        <input
          ref={inputRef}
          style={styles.searchInput}
          placeholder="搜索文件名或内容..."
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <button style={styles.searchBtn} onClick={() => performSearch(query)}>
          🔍
        </button>
      </div>

      {/* 搜索选项 */}
      <div style={styles.options}>
        <div style={styles.optionGroup}>
          <span style={styles.optionLabel}>搜索范围:</span>
          <button
            style={{
              ...styles.optionBtn,
              ...(searchType === "name" ? styles.optionBtnActive : {})
            }}
            onClick={() => setSearchType("name")}
          >
            文件名
          </button>
          <button
            style={{
              ...styles.optionBtn,
              ...(searchType === "content" ? styles.optionBtnActive : {})
            }}
            onClick={() => setSearchType("content")}
          >
            文件内容
          </button>
          <button
            style={{
              ...styles.optionBtn,
              ...(searchType === "both" ? styles.optionBtnActive : {})
            }}
            onClick={() => setSearchType("both")}
          >
            全部
          </button>
        </div>

        <div style={styles.optionGroup}>
          <button
            style={{
              ...styles.optionBtn,
              ...(isRegex ? styles.optionBtnActive : {})
            }}
            onClick={() => setIsRegex(!isRegex)}
            title="正则表达式"
          >
            .*
          </button>
          <button
            style={{
              ...styles.optionBtn,
              ...(caseSensitive ? styles.optionBtnActive : {})
            }}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="区分大小写"
          >
            Aa
          </button>
        </div>
      </div>

      {/* 搜索结果 */}
      <div style={styles.results}>
        {loading ? (
          <div style={styles.centerMessage}>⏳ 搜索中...</div>
        ) : !searched ? (
          <div style={styles.centerMessage}>
            <span style={styles.searchIcon}>🔍</span>
            <span>输入关键词开始搜索</span>
          </div>
        ) : results.length === 0 ? (
          <div style={styles.centerMessage}>没有找到匹配的结果</div>
        ) : (
          <>
            <div style={styles.resultCount}>
              找到 {results.length} 个结果
              {results.length >= 100 && (
                <span style={styles.truncationWarning}>
                  ⚠️ 结果已达上限（100条），可能未完整展示。请缩小搜索范围。
                </span>
              )}
            </div>
            {results.map((result, index) => (
              <div
                key={index}
                style={styles.resultItem}
                onClick={() => handleResultClick(result)}
              >
                <span style={styles.resultIcon}>
                  {getIcon(result.name, result.isDirectory)}
                </span>
                <div style={styles.resultInfo}>
                  <div style={styles.resultName}>
                    {highlightMatch(result.name, query)}
                  </div>
                  <div style={styles.resultPath}>
                    {result.path}
                  </div>
                  {result.matchType === "content" && result.matchedLines && (
                    <div style={styles.matchedLines}>
                      {result.matchedLines.map((line, i) => (
                        <div key={i} style={styles.matchedLine}>
                          <span style={styles.lineNumber}>行 {line.lineNumber}:</span>
                          <span style={styles.lineContent}>
                            {highlightMatch(line.content, query)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span style={styles.resultSize}>
                  {result.isDirectory ? "文件夹" : formatSize(result.size)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
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
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    flexShrink: 0,
  },
  path: {
    flex: 1,
    fontSize: 12,
    color: "#8b949e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 16,
    flexShrink: 0,
  },
  searchBar: {
    display: "flex",
    padding: "12px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: "6px 0 0 6px",
    padding: "10px 14px",
    color: "#c9d1d9",
    fontSize: 14,
    outline: "none",
  },
  searchBtn: {
    background: "#238636",
    color: "#fff",
    border: "none",
    borderRadius: "0 6px 6px 0",
    padding: "10px 16px",
    cursor: "pointer",
    fontSize: 14,
  },
  options: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  optionGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  optionLabel: {
    fontSize: 12,
    color: "#8b949e",
    marginRight: 4,
  },
  optionBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    color: "#8b949e",
  },
  optionBtnActive: {
    color: "#58a6ff",
    borderColor: "#58a6ff",
    background: "rgba(88,166,255,0.1)",
  },
  results: {
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
    fontSize: 14,
  },
  searchIcon: {
    fontSize: 48,
    opacity: 0.3,
  },
  resultCount: {
    padding: "8px 16px",
    fontSize: 12,
    color: "#8b949e",
    borderBottom: "1px solid #21262d",
    position: "sticky",
    top: 0,
    background: "#0d1117",
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  truncationWarning: {
    color: "#e8a230",
    fontSize: 11,
    fontWeight: 500,
  },
  resultItem: {
    display: "flex",
    alignItems: "flex-start",
    padding: "10px 16px",
    cursor: "pointer",
    borderBottom: "1px solid #21262d",
  },
  resultIcon: {
    fontSize: 18,
    marginRight: 12,
    flexShrink: 0,
    marginTop: 2,
  },
  resultInfo: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 4,
    wordBreak: "break-all",
  },
  resultPath: {
    fontSize: 12,
    color: "#8b949e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  matchedLines: {
    marginTop: 8,
    padding: "6px 10px",
    background: "#161b22",
    borderRadius: 4,
    fontSize: 12,
  },
  matchedLine: {
    display: "flex",
    gap: 8,
    padding: "2px 0",
  },
  lineNumber: {
    color: "#8b949e",
    flexShrink: 0,
    minWidth: 50,
  },
  lineContent: {
    color: "#c9d1d9",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  resultSize: {
    fontSize: 11,
    color: "#8b949e",
    flexShrink: 0,
    marginLeft: 12,
  },
  highlight: {
    background: "#e8a230",
    color: "#0d1117",
    padding: "0 2px",
    borderRadius: 2,
  },
};
