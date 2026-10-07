import { emit } from "@tauri-apps/api/event";
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

export interface MessageToastPayload {
  roomId: number;
  roomName: string;
  sender: string;
  text: string;
}

let creating: Promise<WebviewWindow> | null = null;

/** 알림 카드 창을 (없으면 숨긴 상태로) 만들어 둔다. 첫 알림이 늦게 뜨지 않도록 로그인 직후 부른다. */
export async function ensureToastWindow(): Promise<WebviewWindow | null> {
  if (!isTauriRuntime()) return null;
  const existing = await WebviewWindow.getByLabel(TOAST_LABEL);
  if (existing) return existing;
  if (creating) return creating;
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
    await moveToBottomRight(win).catch(() => undefined);
    await win.show();
    await emit(TOAST_SHOW_EVENT, payload);
  } catch {
    // 무시 — 알림 카드가 안 떠도 채팅은 정상 동작
  }
}
