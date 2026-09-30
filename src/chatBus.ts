import { emit, listen } from "@tauri-apps/api/event";
import type { ChatMessage } from "./types/chat";

/**
 * 메인 창 ↔ 1:1 채팅창 간 이벤트 버스.
 *
 * - WebSocket은 메인 창(HomeView)에만 존재한다.
 * - 채팅창(ChatRoomView)은 소켓을 만들지 않고, 이 버스로
 *   상태 스냅샷을 받아서 표시하고 전송 요청을 메인 창에 전달한다.
 * - 웹 브라우저: 같은 origin 팝업(window.open)끼리 BroadcastChannel로 통신.
 * - Tauri: webview 윈도우(WebviewWindow + tauri event)로 통신.
 */

export const CHAT_BUS_NAME = "vibe-talk-bus";

export interface ChatStatePayload {
  peer: string;
  myNickname: string;
  messages: ChatMessage[];
  connectionStatus: string;
  isConnected: boolean;
}

export type ChatBusMessage =
  // 채팅창 → 메인
  | { kind: "chat-open"; peer: string }
  | { kind: "chat-close"; peer: string }
  | { kind: "chat-read"; peer: string }
  | { kind: "chat-send"; peer: string; text: string; id: string }
  // 메인 → 채팅창
  | ({ kind: "chat-state" } & ChatStatePayload)
  | { kind: "main-ready" }
  | { kind: "main-closing" };

export type ChatBusHandler = (msg: ChatBusMessage) => void;

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export interface ChatBus {
  post: (msg: ChatBusMessage) => void;
  close: () => void;
}

/**
 * 여러 버스를 하나로 묶는 허브.
 * BroadcastChannel + tauri event를 동시에 붙이고 post는 전부에게,
 * 수신은 먼저 들어온 한 번만 handler에 전달한다.
 * (Tauri dev 등에서 두 채널이 모두 살아있는 경우 중복 처리 방지)
 */
export function createChatBusHub(): ChatBus & { add: (bus: ChatBus | null) => void } {
  const buses = new Set<ChatBus>();
  return {
    post(msg: ChatBusMessage) {
      buses.forEach((bus) => {
        try {
          bus.post(msg);
        } catch {
          // 무시
        }
      });
    },
    close() {
      buses.forEach((bus) => {
        try {
          bus.close();
        } catch {
          // 무시
        }
      });
      buses.clear();
    },
    add(bus: ChatBus | null) {
      if (bus) buses.add(bus);
    },
  };
}

export function dedupeKeyFor(msg: ChatBusMessage): string | null {
  if (msg.kind === "chat-send") return `send:${msg.id}`;
  return null;
}

/**
 * 브라우저용 버스 (BroadcastChannel).
 * Tauri 환경에서는 WebviewWindow끼리 origin 공유가 보장되지 않으므로
 * 별도의 Tauri 이벤트 버스를 사용한다.
 */
export function createChatBus(handler: ChatBusHandler): ChatBus {
  const channel = new BroadcastChannel(CHAT_BUS_NAME);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as ChatBusMessage | null | undefined;
    if (!data || typeof data !== "object" || !("kind" in data)) return;
    handler(data);
  };
  return {
    post(msg: ChatBusMessage) {
      try {
        channel.postMessage(msg);
      } catch {
        // 무시 (창이 닫히는 중 등)
      }
    },
    close() {
      try {
        channel.close();
      } catch {
        // 무시
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseChatBusMessage(value: unknown): ChatBusMessage | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  return value as unknown as ChatBusMessage;
}

/**
 * Tauri용 버스 (tauri @tauri-apps/api event).
 * 모든 Tauri API는 호출 시점에만 IPC를 쓰므로 브라우저에서도 import는 안전하다.
 */
export function createTauriChatBus(
  handler: ChatBusHandler,
): Promise<ChatBus> {
  const openBus = async (): Promise<ChatBus> => {
    const unlisten = await listen<unknown>(CHAT_BUS_NAME, (event) => {
      const msg = parseChatBusMessage(event.payload);
      if (msg) handler(msg);
    });
    let closed = false;
    return {
      post(msg: ChatBusMessage) {
        if (closed) return;
        void emit(CHAT_BUS_NAME, msg).catch(() => {
          // 무시 (창이 닫히는 중 등)
        });
      },
      close() {
        closed = true;
        try {
          unlisten();
        } catch {
          // 무시
        }
      },
    };
  };
  return openBus();
}

/** 현재 라우트가 1:1 채팅방(#/chat/...)인지 */
export function currentChatPeerFromUrl(): string | null {
  try {
    const hash = window.location.hash;
    const match = hash.match(/^#\/chat\/([^?#]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
}

