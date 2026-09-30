import { ref, onUnmounted } from "vue";
import type { ChatMessage } from "../types/chat";

export function useChatSocket() {
  // WebSocket 연결 상태 추적
  const isConnected = ref(false);
  const nickname = ref("");
  const globalMessages = ref<Array<ChatMessage>>([]);
  const dmMessages = ref<Record<string, Array<ChatMessage>>>({});
  const inputMessage = ref("");
  const userlist = ref<Array<string>>([]);
  const selectedConversation = ref<string | null>(null);

  // WebSocket 인스턴스
  let ws: WebSocket | null = null;

  // 재연결 관련 상태
  const connectionStatus = ref("연결되지 않음");
  const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const isManuallyDisconnected = ref(false);

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
      ws.close();
    }

    // 새 연결 생성
    ws = new WebSocket("ws://localhost:8080");

    // 연결 성공 시 처리
    ws.onopen = () => {
      if (nickname.value) {
        ws!.send(JSON.stringify({ type: "join", nickname: nickname.value }));
      }
      isConnected.value = true;
      connectionStatus.value = "연결됨";

      // 재연결 성공 후 타이머 정리
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
        reconnectTimer.value = null;
      }
    };

    // 메시지 수신 처리
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "message") {
          // 전체 채팅 메시지 저장
          globalMessages.value.push(data);
        } else if (data.type === "dm") {
          // DM 메시지 처리
          let conversationPartner = "";

          // 메시지의 발신자가 나 자신인 경우 to를 기준으로 저장
          if (data.from === nickname.value) {
            conversationPartner = data.to;
          } else {
            // 메시지의 발신자가 다른 사용자인 경우 from을 기준으로 저장
            conversationPartner = data.from;
          }

          // 메시지를 우리가 사용하는 구조로 변환 후 저장
          const formattedMessage: ChatMessage = {
            type: "dm",
            nickname: data.from,
            text: data.text,
          };

          console.log("Formatted message:", formattedMessage);
          console.log("Current nickname:", nickname.value);

          // DM 메시지를 해당 사용자에 맞게 저장
          if (!dmMessages.value[conversationPartner]) {
            dmMessages.value[conversationPartner] = [];
          }
          dmMessages.value[conversationPartner].push(formattedMessage);
        } else if (data.type === "userlist") {
          userlist.value = data.users.filter((user: string) => user !== nickname.value);
        }
      } catch (e) {
        console.error("Invalid message format:", e);
      }
    };

    // 연결 종료 처리
    ws.onclose = () => {
      isConnected.value = false;
      console.log("Connection closed");

      // 수동으로 연결 해제한 경우 재연결하지 않음
      if (isManuallyDisconnected.value) {
        connectionStatus.value = "연결 끊김";
        return;
      }

      // 자동 재연결 로직
      connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
      reconnectTimer.value = setTimeout(attemptReconnect, 3000);
    };

    // 오류 처리
    ws.onerror = (error) => {
      console.error("WebSocket Error:", error);
      // 오류 발생 시에도 재연결 시도
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
      }
      connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
      reconnectTimer.value = setTimeout(attemptReconnect, 3000);
    };
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
    if (ws) {
      ws.close();
    }
    isManuallyDisconnected.value = true;
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
    userlist,
    attemptReconnect,
    manualReconnect,
    disconnect,
    send,
  };
}
