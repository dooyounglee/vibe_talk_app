import { ref, onUnmounted } from "vue";
import type { ChatMessage } from "../types/chat";

export function useChatSocket() {
  // WebSocket 연결 상태 추적
  const isConnected = ref(false);
  const nickname = ref("");
  const globalMessages = ref<Array<ChatMessage>>([]);
  const dmMessages = ref<Record<string, Array<ChatMessage>>>({});
  const unreadCounts = ref<Record<string, number>>({});
  const inputMessage = ref("");
  const userlist = ref<Array<string>>([]);
  const selectedConversation = ref<string | null>(null);

  // WebSocket 인스턴스
  let ws: WebSocket | null = null;

  // 재연결 관련 상태
  const connectionStatus = ref("연결되지 않음");
  const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const isManuallyDisconnected = ref(false);

  const ensureDmBox = (peer: string): Array<ChatMessage> => {
    if (!dmMessages.value[peer]) {
      dmMessages.value[peer] = [];
    }
    return dmMessages.value[peer];
  };

  const pushDm = (peer: string, msg: ChatMessage, fromSelf: boolean) => {
    ensureDmBox(peer).push(msg);
    if (!fromSelf) {
      unreadCounts.value[peer] = (unreadCounts.value[peer] ?? 0) + 1;
    }
  };

  const clearUnread = (peer: string) => {
    if (unreadCounts.value[peer]) {
      unreadCounts.value[peer] = 0;
    }
  };

  interface IncomingPayload {
    type?: string;
    nickname?: string;
    from?: string;
    to?: string;
    text?: string;
    users?: string[];
  }

  const handleIncoming = (raw: string) => {
    const data: IncomingPayload = JSON.parse(raw) as IncomingPayload;
    if (data.type === "message") {
      const formatted: ChatMessage = {
        type: "message",
        nickname: String(data.nickname ?? ""),
        text: String(data.text ?? ""),
      };
      globalMessages.value.push(formatted);
    } else if (data.type === "dm") {
      const from = String(data.from ?? data.nickname ?? "");
      const to = String(data.to ?? "");
      const fromSelf = from === nickname.value;
      const peer = fromSelf ? to : from;
      if (!peer) return;
      const formattedMessage: ChatMessage = {
        type: "dm",
        nickname: from,
        text: String(data.text ?? ""),
      };
      pushDm(peer, formattedMessage, fromSelf);
    } else if (data.type === "userlist") {
      const users: Array<string> = Array.isArray(data.users) ? data.users : [];
      userlist.value = users.filter((user) => user !== nickname.value);
    }
  };

  const attachHandlers = (socket: WebSocket) => {
    socket.onmessage = (event: MessageEvent) => {
      try {
        handleIncoming(event.data as string);
      } catch (e) {
        console.error("Invalid message format:", e);
      }
    };
    socket.onclose = () => {
      isConnected.value = false;
      if (isManuallyDisconnected.value) {
        connectionStatus.value = "연결 끊김";
        return;
      }
      connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
      reconnectTimer.value = setTimeout(attemptReconnect, 3000);
    };
    socket.onerror = (error) => {
      console.error("WebSocket Error:", error);
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
      }
      connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
      reconnectTimer.value = setTimeout(attemptReconnect, 3000);
    };
  };

  // 1:1 메시지 전송 (팝업 채팅창용)
  const sendDm = (to: string, text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed === "" || !to) return false;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      JSON.stringify({ type: "dm", to, nickname: nickname.value, text: trimmed }),
    );
    return true;
  };

  // 메시지 전송 함수
  const send = () => {
    if (inputMessage.value.trim() === "") return;

    const message =
      selectedConversation.value === null
        ? {
            type: "message",
            nickname: nickname.value,
            text: inputMessage.value,
          }
        : {
            type: "dm",
            to: selectedConversation.value,
            nickname: nickname.value,
            text: inputMessage.value,
          };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      inputMessage.value = "";
    }
  };

  // 재연결 시도 함수
  const attemptReconnect = () => {
    if (isManuallyDisconnected.value) return;

    connectionStatus.value = "연결 중...";

    // 기존 연결 종료
    if (ws) {
      try {
        ws.close();
      } catch {
        // 무시
      }
    }

    // 새 연결 생성
    const socket = new WebSocket("ws://localhost:8080");
    ws = socket;

    // 연결 성공 시 처리
    socket.onopen = () => {
      if (nickname.value) {
        socket.send(JSON.stringify({ type: "join", nickname: nickname.value }));
      }
      isConnected.value = true;
      connectionStatus.value = "연결됨";

      // 재연결 성공 후 타이머 정리
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
        reconnectTimer.value = null;
      }
    };

    attachHandlers(socket);
  };

  // 첫 화면(닉네임 입력)에서 호출하는 연결 함수
  const connect = (nicknameInput: string): boolean => {
    const trimmed = nicknameInput.trim();
    if (trimmed === "") return false;
    nickname.value = trimmed;
    isManuallyDisconnected.value = false;
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
      reconnectTimer.value = null;
    }
    connectionStatus.value = "연결 중...";
    if (ws) {
      try {
        ws.close();
      } catch {
        // 무시
      }
    }
    const socket = new WebSocket("ws://localhost:8080");
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", nickname: nickname.value }));
      isConnected.value = true;
      connectionStatus.value = "연결됨";
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
        reconnectTimer.value = null;
      }
    };
    attachHandlers(socket);
    return true;
  };

  // 수동 재연결 함수
  const manualReconnect = () => {
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
      reconnectTimer.value = null;
    }
    isManuallyDisconnected.value = false;
    attemptReconnect();
  };

  // 연결 해제 함수
  const disconnect = () => {
    isManuallyDisconnected.value = true;
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
      reconnectTimer.value = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // 무시
      }
    }
    isConnected.value = false;
    connectionStatus.value = "연결 끊김";
  };

  // 컴포넌트 언마운트 시 WebSocket 종료
  onUnmounted(() => {
    if (ws) {
      ws.close();
    }
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
    }
  });

  return {
    nickname,
    inputMessage,
    selectedConversation,
    isConnected,
    connectionStatus,
    globalMessages,
    dmMessages,
    unreadCounts,
    userlist,
    connect,
    attemptReconnect,
    manualReconnect,
    disconnect,
    send,
    sendDm,
    clearUnread,
  };
}
