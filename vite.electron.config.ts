import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, copyFileSync, existsSync } from "fs";
import electronSimple from "vite-plugin-electron/simple";
import type { Plugin } from "vite";

/**
 * 构建后复制 assets 和 PDF.js worker 到 dist/
 */
function copyAssets(): Plugin {
  return {
    name: "copy-electron-assets",
    writeBundle() {
      const root = __dirname;
      const dist = resolve(root, "dist");
      cpSync(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
      const pdfWorker = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
      if (existsSync(pdfWorker)) {
        copyFileSync(pdfWorker, resolve(dist, "src", "pdf.worker.min.mjs"));
      }
    },
  };
}

export default defineConfig({
  base: "",
  plugins: [
    electronSimple({
      main: {
        entry: "electron/main.ts",
        vite: {
          logLevel: "warn",
          build: {
            outDir: "dist-electron",
            reportCompressedSize: false,
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          logLevel: "warn",
          build: {
            outDir: "dist-electron",
            reportCompressedSize: false,
          },
        },
      },
      renderer: {},
    }),
    copyAssets(),
  ],
  build: {
    outDir: "dist",
    // 完整 build 先跑 build:extension 再跑本配置；若为 true 会清空 dist 导致扩展缺失 manifest/background/detector
    emptyOutDir: false,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        "ai-panel": resolve(__dirname, "src/ai-panel/index.html"),
      },
      output: {
        entryFileNames: "src/[name].js",
        // 与 extension 构建区分，避免覆盖 dist/src/chunks/*（background.js 依赖扩展构建的 format.js 等）
        chunkFileNames: "src/chunks-app/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "src/[name][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
    minify: false,
    sourcemap: process.env.NODE_ENV === "development" ? "inline" : false,
    reportCompressedSize: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
  },
});
