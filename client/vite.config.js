import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@novnc/novnc"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:9910",
      "/ws": {
        target: "ws://localhost:9910",
        ws: true,
      },
      "/vnc": {
        target: "ws://localhost:9910",
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["@monaco-editor/react"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-search", "@xterm/addon-web-links"],
          pdf: ["pdfjs-dist"],
          chart: ["chart.js"],
          office: ["mammoth", "xlsx", "pptxviewjs"],
        },
      },
    },
  },
});