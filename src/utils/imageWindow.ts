import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "../chatBus";
import type { ChatAttachment } from "../types/chat";
import { toChatAttachment } from "../types/chat";

// ─── 이미지 창: 채팅창 이미지 클릭 → 이미지마다 새 창(#/image/:fileId) ───
// 채팅방 창을 여러 개 띄우듯 이미지 창도 여러 개 띄울 수 있다.
// 같은 이미지를 다시 누르면 새로 만들지 않고 이미 열린 창을 앞으로 가져온다.
// 창에는 소켓이 필요 없으므로 파일 정보(이름/크기/MIME)를 URL 에 실어 보낸다.

const IMAGE_WINDOW_WIDTH = 800;
const IMAGE_WINDOW_HEIGHT = 640;

const imageWindowLabel = (file: ChatAttachment) => `image_${file.id}`;

/** 이미지 창 해시 경로 (#/image/:fileId?name=&size=&mime=) */
export function imageWindowHash(file: ChatAttachment): string {
  const q = new URLSearchParams({ name: file.name, size: String(file.size), mime: file.mime });
  return `#/image/${encodeURIComponent(file.id)}?${q.toString()}`;
}

/** 이미지 창 라우트(params/query) → ChatAttachment */
export function attachmentFromRoute(
  fileId: unknown,
  query: Record<string, unknown>,
): ChatAttachment | undefined {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  return toChatAttachment({
    id: first(fileId),
    name: first(query.name),
    size: Number(first(query.size)) || 0,
    mime: first(query.mime),
  });
}

const openBrowserImageWindow = (file: ChatAttachment) => {
  const url = `${window.location.origin}${window.location.pathname}${imageWindowHash(file)}`;
  // 창 이름이 같으면 브라우저가 기존 창을 재사용한다 → 같은 이미지는 창 하나
  const child = window.open(
    url,
    `vibe_talk_image_${file.id}`,
    `width=${IMAGE_WINDOW_WIDTH},height=${IMAGE_WINDOW_HEIGHT},menubar=no,toolbar=no,location=no,status=no,resizable=yes`,
  );
  child?.focus();
  return child !== null;
};

const openTauriImageWindow = async (file: ChatAttachment) => {
  const label = imageWindowLabel(file);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show().catch(() => undefined);
    await existing.setFocus().catch(() => undefined);
    return;
  }
  new WebviewWindow(label, {
    url: imageWindowHash(file),
    title: file.name,
    width: IMAGE_WINDOW_WIDTH,
    height: IMAGE_WINDOW_HEIGHT,
    resizable: true,
    visible: true,
    focus: true,
    center: true,
    dragDropEnabled: false,
  });
};

/** 이미지를 새 창으로 연다. 창을 열지 못하면 false (팝업 차단 등) */
export async function openImageWindow(file: ChatAttachment): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      await openTauriImageWindow(file);
      return true;
    } catch {
      return false;
    }
  }
  return openBrowserImageWindow(file);
}
