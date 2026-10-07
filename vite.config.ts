import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import istanbul from "vite-plugin-istanbul";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
// E2E 커버리지 실행(npm run test:e2e:coverage)일 때만 소스를 계측한다 → window.__coverage__
const e2eCoverage = process.env.E2E_COVERAGE === "1";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    vue(),
    e2eCoverage &&
      istanbul({
        include: "src/**/*",
        exclude: ["node_modules", "src/**/__tests__/**"],
        extension: [".ts", ".vue"],
        forceBuildInstrument: true,
      }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
