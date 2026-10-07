import { invoke } from "@tauri-apps/api/core";
import { UserAttentionType, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "../chatBus";

// ─── 작업표시줄 깜빡임 (Tauri 전용, Windows: 주황색 깜빡임) ───
// 새 메시지가 오면 그 방 채팅창이 떠 있으면 그 창을, 없으면 메인 창을 깜빡인다.
// Informational = Windows FLASHW_TRAY (4번):
//   작업표시줄 버튼이 주황색으로 깜빡이다가 주황색으로 남는다.
//   창을 확인(focus)하는 순간 stopTaskbarFlash로 바로 끈다 (App.vue / HomeView.vue).
// 웹 브라우저에서는 아무것도 하지 않는다.

const MAIN_LABEL = "main";
const roomLabel = (roomId: number) => `room_${roomId}`;

async function flashWindow(win: WebviewWindow): Promise<boolean> {
  // 숨겨진 창(트레이로 내린 메인 창)은 작업표시줄 버튼이 없으므로 깜빡일 수 없다
  if (!(await win.isVisible().catch(() => false))) return false;
  // 이미 보고 있는 창은 깜빡일 필요가 없다.
  // 단, Windows에서는 최소화된 창이 focus 상태로 남아 있을 수 있으므로 최소화면 무조건 깜빡인다.
  const minimized = await win.isMinimized().catch(() => false);
  if (!minimized && (await win.isFocused().catch(() => false))) return true;
  await win.requestUserAttention(UserAttentionType.Informational);
  return true;
}

/** 새 메시지가 온 방의 창(없으면 메인 창)을 작업표시줄에서 깜빡인다 */
export async function flashTaskbarForRoom(roomId: number): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const roomWin = await WebviewWindow.getByLabel(roomLabel(roomId));
    if (roomWin && (await flashWindow(roomWin))) return;
    const mainWin = await WebviewWindow.getByLabel(MAIN_LABEL);
    if (mainWin) await flashWindow(mainWin);
  } catch {
    // 무시 — 깜빡임 실패가 수신 처리를 막지 않게 한다
  }
}

/** 작업표시줄 깜빡임을 바로 끈다. label을 안 주면 지금 창 */
export async function stopTaskbarFlash(label?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("stop_taskbar_flash", { label: label ?? getCurrentWindow().label });
  } catch {
    // 무시
  }
}
