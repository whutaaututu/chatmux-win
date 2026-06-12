import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PPTXViewer } from "pptxviewjs";

// 设置 PDF.js worker - 使用本地 worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// 判断文件类型
function getFileType(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "word";
  if (["xls", "xlsx"].includes(ext)) return "excel";
  if (["ppt", "pptx"].includes(ext)) return "powerpoint";

  return "unknown";
}

export default function OfficeViewer({ filePath, fileName, onClose }) {
  const [fileType, setFileType] = useState("unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pptxViewerRef = useRef(null);

  useEffect(() => {
    const type = getFileType(fileName);
    setFileType(type);
    loadFile(type);
  }, [filePath, fileName]);

  // 加载文件
  const loadFile = async (type) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/download-file?path=${encodeURIComponent(filePath)}`);
      if (!response.ok) {
        throw new Error("文件加载失败");
      }

      const arrayBuffer = await response.arrayBuffer();

      switch (type) {
        case "pdf":
          await loadPDF(arrayBuffer);
          break;
        case "word":
          await loadWord(arrayBuffer);
          break;
        case "excel":
          await loadExcel(arrayBuffer);
          break;
        case "powerpoint":
          await loadPowerPoint(arrayBuffer);
          break;
        default:
          throw new Error("不支持的文件格式");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 加载 PDF
  const loadPDF = async (arrayBuffer) => {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setTotalPages(pdf.numPages);
    setContent({ type: "pdf", pdf });
    renderPage(pdf, 1);
  };

  // 渲染 PDF 页面
  const renderPage = async (pdf, pageNum) => {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;
  };

  // 加载 Word (sanitized: strip script/iframe/object/embed/on* handlers)
  const loadWord = async (arrayBuffer) => {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const sanitized = result.value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
      .replace(/<embed\b[^>]*\/?>/gi, "")
      .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
      .replace(/javascript\s*:/gi, "");
    setContent({
      type: "word",
      html: sanitized,
      messages: result.messages,
    });
  };

  // 加载 Excel
  const loadExcel = async (arrayBuffer) => {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheets = {};

    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      sheets[name] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    });

    setContent({
      type: "excel",
      sheets,
      sheetNames: workbook.SheetNames,
    });
  };

  // 加载 PowerPoint
  const loadPowerPoint = async (arrayBuffer) => {
    try {
      const viewer = new PPTXViewer();
      await viewer.loadFile(arrayBuffer);

      pptxViewerRef.current = viewer;
      setContent({ type: "powerpoint" });
      setTotalPages(viewer.getSlideCount());
      setCurrentPage(1);
    } catch (e) {
      setError("PPT 加载失败: " + e.message);
    }
  };

  // 渲染 PPT 页面
  const renderPptxSlide = async (slideIndex) => {
    const viewer = pptxViewerRef.current;
    const canvas = canvasRef.current;
    if (!viewer || !canvas) return;

    try {
      await viewer.goToSlide(slideIndex, canvas);
    } catch (e) {
      console.error("渲染幻灯片失败:", e);
    }
  };

  // 切换页面
  const goToPage = (pageNum) => {
    if (content?.type === "pdf" && content.pdf && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  // 缩放
  const handleZoom = (delta) => {
    setScale((prev) => Math.max(0.5, Math.min(3, prev + delta)));
  };

  // 当页面或缩放变化时重新渲染 PDF
  useEffect(() => {
    if (content?.type === "pdf" && content.pdf) {
      renderPage(content.pdf, currentPage);
    }
  }, [currentPage, scale, content]);

  // PPT 页面切换
  const goToPPTPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  // 渲染 PPT 幻灯片
  useEffect(() => {
    if (content?.type === "powerpoint" && pptxViewerRef.current) {
      renderPptxSlide(currentPage - 1);
    }
  }, [currentPage, content]);

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
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.title}>
            {fileType === "pdf" && "📄"}
            {fileType === "word" && "📝"}
            {fileType === "excel" && "📊"}
            {fileType === "powerpoint" && "📽️"}
            {" 文档查看器"}
          </span>
          <span style={styles.fileName}>{fileName}</span>
        </div>
        <div style={styles.headerRight}>
          {/* PDF 控制 */}
          {fileType === "pdf" && content?.type === "pdf" && (
            <>
              <button
                style={styles.controlBtn}
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                ◀
              </button>
              <span style={styles.pageInfo}>
                {currentPage} / {totalPages}
              </span>
              <button
                style={styles.controlBtn}
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                ▶
              </button>
              <button style={styles.controlBtn} onClick={() => handleZoom(-0.25)}>
                -
              </button>
              <span style={styles.zoomInfo}>{Math.round(scale * 100)}%</span>
              <button style={styles.controlBtn} onClick={() => handleZoom(0.25)}>
                +
              </button>
            </>
          )}

          {/* PPT 控制 */}
          {fileType === "powerpoint" && content?.type === "powerpoint" && (
            <>
              <button
                style={styles.controlBtn}
                onClick={() => goToPPTPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                ◀
              </button>
              <span style={styles.pageInfo}>
                {currentPage} / {totalPages}
              </span>
              <button
                style={styles.controlBtn}
                onClick={() => goToPPTPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                ▶
              </button>
            </>
          )}
          <a
            href={`/api/download-file?path=${encodeURIComponent(filePath)}`}
            download={fileName}
            style={styles.downloadBtn}
          >
            📥 下载
          </a>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* 内容 */}
      <div ref={containerRef} style={styles.content}>
        {/* PDF */}
        {content?.type === "pdf" && (
          <div style={styles.pdfContainer}>
            <canvas ref={canvasRef} style={styles.pdfCanvas} />
          </div>
        )}

        {/* Word */}
        {content?.type === "word" && (
          <div
            style={styles.wordContainer}
            dangerouslySetInnerHTML={{ __html: content.html }}
          />
        )}

        {/* Excel */}
        {content?.type === "excel" && (
          <ExcelViewer sheets={content.sheets} sheetNames={content.sheetNames} />
        )}

        {/* PowerPoint */}
        {content?.type === "powerpoint" && (
          <div style={styles.pptContainer}>
            <div style={styles.slideWrapper}>
              <canvas ref={canvasRef} style={styles.pptCanvas} />
            </div>
            <div style={styles.slideNav}>
              {Array.from({ length: totalPages }, (_, idx) => (
                <button
                  key={idx}
                  style={{
                    ...styles.slideThumb,
                    ...(currentPage === idx + 1 ? styles.slideThumbActive : {}),
                  }}
                  onClick={() => goToPPTPage(idx + 1)}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Excel 查看器组件
function ExcelViewer({ sheets, sheetNames }) {
  const [activeSheet, setActiveSheet] = useState(sheetNames[0]);

  const data = sheets[activeSheet] || [];

  return (
    <div style={styles.excelContainer}>
      {/* 工作表标签 */}
      {sheetNames.length > 1 && (
        <div style={styles.sheetTabs}>
          {sheetNames.map((name) => (
            <button
              key={name}
              style={{
                ...styles.sheetTab,
                ...(activeSheet === name ? styles.sheetTabActive : {}),
              }}
              onClick={() => setActiveSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* 表格 */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td
                    key={colIndex}
                    style={{
                      ...styles.cell,
                      ...(rowIndex === 0 ? styles.cellHeader : {}),
                    }}
                  >
                    {cell !== undefined && cell !== null ? String(cell) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
  },
  fileName: {
    fontSize: 12,
    color: "#8b949e",
    padding: "2px 8px",
    background: "#21262d",
    borderRadius: 4,
  },
  controlBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    color: "#c9d1d9",
  },
  pageInfo: {
    fontSize: 12,
    color: "#8b949e",
    minWidth: 50,
    textAlign: "center",
  },
  zoomInfo: {
    fontSize: 12,
    color: "#8b949e",
    minWidth: 40,
    textAlign: "center",
  },
  downloadBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
    color: "#c9d1d9",
    textDecoration: "none",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 16,
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
  pdfContainer: {
    display: "flex",
    justifyContent: "center",
    padding: 20,
  },
  pdfCanvas: {
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    maxWidth: "100%",
  },
  wordContainer: {
    padding: 20,
    maxWidth: 800,
    margin: "0 auto",
    lineHeight: 1.6,
    fontSize: 14,
    color: "#c9d1d9",
  },
  pptContainer: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  slideWrapper: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    overflow: "auto",
  },
  pptCanvas: {
    maxWidth: "100%",
    maxHeight: "100%",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  },
  slideNav: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    padding: "10px 16px",
    background: "#161b22",
    borderTop: "1px solid #30363d",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  slideThumb: {
    width: 32,
    height: 32,
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    color: "#8b949e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  slideThumbActive: {
    background: "#0d1117",
    borderColor: "#58a6ff",
    color: "#58a6ff",
  },
  excelContainer: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  sheetTabs: {
    display: "flex",
    gap: 4,
    padding: "8px 16px",
    background: "#161b22",
    borderBottom: "1px solid #30363d",
    flexShrink: 0,
  },
  sheetTab: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: "4px 4px 0 0",
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 12,
    color: "#8b949e",
  },
  sheetTabActive: {
    color: "#58a6ff",
    borderColor: "#58a6ff",
    background: "#0d1117",
    borderBottomColor: "#0d1117",
  },
  tableContainer: {
    flex: 1,
    overflow: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: 13,
  },
  cell: {
    border: "1px solid #30363d",
    padding: "6px 10px",
    whiteSpace: "nowrap",
  },
  cellHeader: {
    background: "#161b22",
    fontWeight: 600,
    position: "sticky",
    top: 0,
  },
};
