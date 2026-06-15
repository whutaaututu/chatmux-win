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
    target: "es2020",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-monaco": ["@monaco-editor/react"],
          "vendor-pdf": ["pdfjs-dist"],
          "vendor-xlsx": ["xlsx"],
          "vendor-chart": ["chart.js"],
        },
      },
    },
  },
});
