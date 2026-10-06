import { afterEach, beforeEach, vi } from "vitest";

// 테스트마다 브라우저 상태를 초기화한다.
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  // isTauriRuntime() 분기를 켜려고 넣은 전역 표시를 지운다.
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});
