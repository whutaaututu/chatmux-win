import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:9910",
      "/ws": {
        target: "ws://localhost:9910",
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["@monaco-editor/react"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-search", "@xterm/addon-web-links"],
          pdf: ["pdfjs-dist"],
          office: ["mammoth", "xlsx", "pptxviewjs"],
        },
      },
    },
  },
});
