import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as { version?: string };
const appVersion = typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
/** 建置當下日期（Asia/Taipei），供頁尾「最後更新」顯示 */
const appBuildDate = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);

export default defineConfig({
  server: {
    proxy: {
      "/api/yahoo-chart": {
        target: "https://query1.finance.yahoo.com/v8/finance/chart",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo-chart\/?/, ""),
        headers: {
          "User-Agent": "massage-reserve-tsmc-pricing/1",
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@firebase") || id.includes("node_modules/firebase")) {
            return "firebase";
          }
          if (id.includes("node_modules/three")) {
            return "three";
          }
        },
      },
    },
  },
});
