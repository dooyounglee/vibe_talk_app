import { emit, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, primaryMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "../chatBus";

// ─── 알림 카드 창: 새 메시지가 오면 화면 우측하단에서 올라왔다 내려가는 카드 ───
// 투명·테두리 없는·항상 위 창 하나(toast)를 만들어 두고 재사용한다.
// 창 위치는 고정하고, 카드가 창 안에서 위아래로 미끄러지며 작업표시줄에서 올라오는 것처럼 보인다.
// 웹 브라우저에서는 아무것도 하지 않는다.

const TOAST_LABEL = "toast";
const TOAST_WIDTH = 340;
const TOAST_HEIGHT = 100;
const TOAST_MARGIN = 12;

/** 메인 창 → 알림 카드 창: 카드 내용 */
export const TOAST_SHOW_EVENT = "toast-show";
/** 알림 카드 창 → 메인 창: 카드를 눌러 방 열기 */
export const TOAST_OPEN_ROOM_EVENT = "toast-open-room";
/** 알림 카드 창 → 메인 창: toast-show 리스너 등록이 끝나 알림을 받을 수 있음 */
export const TOAST_READY_EVENT = "toast-ready";
/** 메인 창 → 알림 카드 창: 준비됐는지 묻기 (이미 떠 있던 창은 toast-ready로 다시 답한다) */
export const TOAST_PING_EVENT = "toast-ping";
/** 알림 카드 창이 준비되기를 기다리는 최대 시간. 넘으면 그냥 보낸다 (알림 때문에 다른 동작이 막히지 않게) */
const TOAST_READY_TIMEOUT_MS = 3000;

export interface MessageToastPayload {
  roomId: number;
  roomName: string;
  sender: string;
  text: string;
}

let creating: Promise<WebviewWindow> | null = null;
let toastReady: Promise<void> | null = null;

// 창이 만들어진 것(tauri://created)과 창 안 페이지가 toast-show를 들을 준비가 된 것은 다르다.
// 준비 전에 보낸 알림은 사라지므로(로그인 직후 첫 알림 유실), 페이지의 toast-ready를 받은 뒤 보낸다.
function waitToastReady(): Promise<void> {
  if (!toastReady) {
    toastReady = new Promise<void>((resolve) => {
      let unlisten: (() => void) | null = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        unlisten?.();
        resolve();
      };
      void listen(TOAST_READY_EVENT, finish)
        .then((fn) => {
          unlisten = fn;
          // 이미 준비를 마친 창(메인 창만 새로고침된 경우 등)은 ping에 다시 답한다
          void emit(TOAST_PING_EVENT).catch(() => undefined);
        })
        .catch(finish);
    });
  }
  return Promise.race([toastReady, new Promise<void>((r) => setTimeout(r, TOAST_READY_TIMEOUT_MS))]);
}

/** 알림 카드 창을 (없으면 숨긴 상태로) 만들어 둔다. 첫 알림이 늦게 뜨지 않도록 로그인 직후 부른다. */
export async function ensureToastWindow(): Promise<WebviewWindow | null> {
  if (!isTauriRuntime()) return null;
  const existing = await WebviewWindow.getByLabel(TOAST_LABEL);
  if (existing) return existing;
  if (creating) return creating;
  // 새 창이면 준비 여부도 새로 확인한다
  toastReady = null;
  creating = new Promise<WebviewWindow>((resolve, reject) => {
    const win = new WebviewWindow(TOAST_LABEL, {
      url: "#/toast",
      title: "알림",
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      // 알림이 떠도 사용자가 작업 중인 창의 포커스를 뺏지 않는다
      focus: false,
      focusable: false,
      visible: false,
    });
    void win.once("tauri://created", () => resolve(win));
    void win.once("tauri://error", (e) => reject(e));
  }).finally(() => {
    creating = null;
  });
  return creating;
}

/** 주 모니터 작업 영역(작업표시줄 제외)의 우측하단으로 창을 옮긴다 */
async function moveToBottomRight(win: WebviewWindow) {
  const monitor = await primaryMonitor();
  if (!monitor) return;
  const { position, size } = monitor.workArea;
  const scale = monitor.scaleFactor;
  const x = position.x + size.width - Math.round((TOAST_WIDTH + TOAST_MARGIN) * scale);
  const y = position.y + size.height - Math.round((TOAST_HEIGHT + TOAST_MARGIN) * scale);
  await win.setPosition(new PhysicalPosition(x, y));
}

/** 새 메시지 알림 카드를 띄운다. 실패해도 조용히 넘어간다. */
export async function showMessageToast(payload: MessageToastPayload): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const win = await ensureToastWindow();
    if (!win) return;
    await waitToastReady();
    await moveToBottomRight(win).catch(() => undefined);
    await win.show();
    await emit(TOAST_SHOW_EVENT, payload);
  } catch {
    // 무시 — 알림 카드가 안 떠도 채팅은 정상 동작
  }
}
