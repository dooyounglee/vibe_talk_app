import { onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../chatBus";

/**
 * 현재 창(윈도우/팝업)이 focus되어 있는지를 관찰한다.
 *
 * 채팅방은 별도 창으로 떠 있으므로 "지금 보고 있는 방"을 메인 창(소켓 소유자)이
 * 알 수 없다. 이 composable이 그 정보를 만들어 소켓 스토어/버스로 전달한다.
 *
 * - 웹 브라우저 팝업: document 기준 focus/blur + visibilitychange
 * - Tauri: OS 윈도우 focus 이벤트(getCurrentWindow().onFocusChanged)도 함께 구독한다.
 *   웹이벤트가 늦거나 누락될 수 있어 이중으로 확인한다.
 *
 * 실제 값이 바뀔 때만 onChange를 호출하므로 여러 소스를 함께 구독해도 중복 보고되지 않는다.
 */
export function useWindowFocus(onChange: (focused: boolean) => void): void {
  // 마지막으로 보고한 값. null = 아직 아무것도 보고하지 않음
  let last: boolean | null = null;
  let unlistenTauri: (() => void) | null = null;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const currentFocus = (): boolean => {
    try {
      // 최소화/숨김 상태는 focus가 아닌 것으로 본다 (카카오톡과 동일 취급)
      if (document.visibilityState === "hidden") return false;
      return document.hasFocus();
    } catch {
      return true;
    }
  };

  const apply = (next: boolean) => {
    if (closed) return;
    if (last === next) return;
    last = next;
    try {
      onChange(next);
    } catch {
      // 무시 (창이 닫히는 중 등)
    }
  };

  const onFocus = () => apply(true);
  const onBlur = () => apply(false);
  const onVisibilityChange = () => apply(currentFocus());

  onMounted(() => {
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // 창이 뜨면서 포커스를 받는 시점이 mount보다 늦을 수 있어 지금 상태부터 보고한다.
    apply(currentFocus());
    // Tauri에서 창 활성화가 늦게 반영되는 경우를 위한 1회 재확인
    recheckTimer = setTimeout(() => {
      recheckTimer = null;
      apply(currentFocus());
    }, 250);

    if (isTauriRuntime()) {
      // 이 모듈은 실제 호출 시점에만 IPC를 쓰므로 브라우저에서도 import는 안전하다.
      void getCurrentWindow()
        .onFocusChanged((event) => apply(Boolean(event.payload)))
        .then((unlisten) => {
          // 언마운트가 먼저 끝났으면 방금 등록한 구독을 즉시 해제한다.
          if (closed) {
            try {
              unlisten();
            } catch {
              // 무시
            }
            return;
          }
          unlistenTauri = unlisten;
        })
        .catch(() => {
          // Tauri 창 focus 이벤트를 쓸 수 없는 환경이면 웹이벤트만으로 동작한다
        });
    }
  });

  onUnmounted(() => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    try {
      unlistenTauri?.();
    } catch {
      // 무시
    }
    unlistenTauri = null;
    // 창이 사라졌으므로 "보고 있는 중" 상태를 반드시 해제해 알린다.
    // (last를 비워야 마지막 보고가 true였더라도 false가 전달된다)
    closed = true;
    last = null;
    try {
      onChange(false);
    } catch {
      // 무시
    }
  });
}