import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import { cpSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * 构建后自动将 manifest.json、assets/ 和 PDF.js worker 复制到 dist/，
 * 使 dist/ 成为可直接加载到 Chrome 的完整扩展目录。
 * manifest.json 的 version 字段会自动同步为 package.json 中的版本号。
 */
function copyExtensionFiles(): Plugin {
  return {
    name: "copy-extension-files",
    writeBundle() {
      const root = __dirname;
      const dist = resolve(root, "dist");
      // 读取 package.json 版本号，同步写入 manifest.json
      const pkg = require("./package.json");
      const manifestPath = resolve(root, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      manifest.version = pkg.version;
      writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      cpSync(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
      // 复制 PDF.js worker 文件（AI 总结 PDF 时需要）
      copyFileSync(
        resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
        resolve(dist, "src/pdf.worker.min.mjs")
      );
    },
  };
}

export default defineConfig({
  // Chrome 扩展需要相对路径
  base: "",
  plugins: [copyExtensionFiles()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 不对资源做 hash 命名，Chrome 扩展需要固定路径
    assetsDir: "assets",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        "ai-panel": resolve(__dirname, "src/ai-panel/index.html"),
        background: resolve(__dirname, "src/background/index.ts"),
        detector: resolve(__dirname, "src/detector/index.ts"),
      },
      output: {
        // 入口文件保持固定名称
        entryFileNames: "src/[name].js",
        chunkFileNames: "src/chunks/[name].js",
        assetFileNames: (assetInfo) => {
          // CSS 文件保持在 src/ 下
          if (assetInfo.name?.endsWith(".css")) {
            return "src/[name][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
    // 不压缩，方便调试
    minify: false,
    // 生成 sourcemap 方便调试
    sourcemap: process.env.NODE_ENV === "development" ? "inline" : false,
    reportCompressedSize: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // 排除 Chrome API
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
  },
});
