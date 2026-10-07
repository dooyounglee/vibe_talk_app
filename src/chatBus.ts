import { emit, listen } from "@tauri-apps/api/event";
import type { ChatMessage, ChatUser } from "./types/chat";

/**
 * 메인 창 ↔ 채팅방 창 간 이벤트 버스.
 *
 * - WebSocket은 메인 창(HomeView)에만 존재한다.
 * - 채팅방 창(RoomView)은 소켓을 만들지 않고, 이 버스로
 *   상태 스냅샷을 받아서 표시하고 전송 요청을 메인 창에 전달한다.
 * - 웹 브라우저: 같은 origin 팝업(window.open)끼리 BroadcastChannel로 통신.
 * - Tauri: webview 윈도우(WebviewWindow + tauri event)로 통신.
 *
 * NOTE: 1:1 대화도 방 창 하나이므로 peer 기준 신호는 더 이상 없다.
 */

export const CHAT_BUS_NAME = "vibe-talk-bus";

export interface RoomStatePayload {
  roomId: number;
  roomName: string;
  myUserNo: number | null;
  myNickname: string;
  messages: ChatMessage[];
  members: ChatUser[];
  /** 채팅창이 '초대하기' 모달에 렌더할 사용자 목록 (메인 창이 스냅샷으로 내려줌) */
  users: ChatUser[];
  connectionStatus: string;
  isConnected: boolean;
  /** 더 불러올 이전 대화가 있는지 (위로 스크롤 무한로딩). 없으면 false 로 본다 */
  hasMore?: boolean;
  /** 이전 대화를 불러오는 중인지. 없으면 false 로 본다 */
  loadingOlder?: boolean;
}

export type ChatBusMessage =
  // 번호방 채팅창 → 메인 (1:1도 이 경로를 쓴다)
  | { kind: "room-open"; roomId: number; mainId?: string }
  | { kind: "room-close"; roomId: number; mainId?: string }
  | { kind: "room-focus"; roomId: number; focused: boolean; mainId?: string }
  // NOTE: 'room-read' 는 focus 기반 읽음 처리로 대체되어 더 이상 쓰지 않는다.
  | { kind: "room-send"; roomId: number; text: string; id: string; mainId?: string }
  // 번호방 채팅창 → 메인: 방제목 수정 요청 (소켓은 메인 창에만 있으므로 경유)
  | { kind: "room-rename"; roomId: number; title: string; mainId?: string }
  // 번호방 채팅창 → 메인: 초대 요청 (소켓은 메인 창에만 있으므로 경유)
  | { kind: "room-invite"; roomId: number; memberNos: number[]; mainId?: string }
  // 번호방 채팅창 → 메인: 이전 대화 더보기 요청 (위로 스크롤 끝에 닿았을 때)
  | { kind: "room-load-older"; roomId: number; mainId?: string }
  // 메인 → 채팅창
  | ({ kind: "room-state" } & RoomStatePayload & { mainId?: string })
  | { kind: "main-ready"; mainId?: string }
  | { kind: "main-closing"; mainId?: string };

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
  if (msg.kind === "room-send") return `room-send:${msg.id}`;
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

// 방 번호로 여는 단체 채팅방. 새 창으로 열리면 소켓 없이 버스로만 동작한다.
function currentHash(): string {
  try {
    return window.location.hash;
  } catch {
    return "";
  }
}

/** 팝업 URL에 심어둔 메인 창 ID (?mainId=...). 같은 origin 탭끼리 버스 섞임 방지용 */
export function currentMainIdFromUrl(): string | null {
  try {
    const hash = currentHash();
    const qIndex = hash.indexOf("?");
    if (qIndex < 0) return null;
    const query = hash.slice(qIndex + 1);
    const params = new URLSearchParams(query);
    const v = params.get("mainId") ?? params.get("mainid");
    if (!v || v.trim() === "") return null;
    return v;
  } catch {
    return null;
  }
}

function currentChatRoomIdFromUrl(): number | null {
  try {
    const hash = currentHash();
    const match = hash.match(/^#\/room\/(\d+)/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** 현재 라우트가 번호방(#/room/3)인지. Tauri 채팅 윈도우 판별용 */
export function currentRoomIdFromUrl(): number | null {
  return currentChatRoomIdFromUrl();
}

