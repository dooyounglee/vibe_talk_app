import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// 테스트 전용 설정. vite.config.ts는 Tauri dev 서버 설정이라 그대로 둔다.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,vue}"],
      exclude: ["src/test/**", "src/**/__tests__/**", "src/main.ts", "src/vite-env.d.ts"],
    },
  },
});
