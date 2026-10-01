import { ref } from "vue";
import type { ChatMessage } from "../types/chat";
import {
  DM_HISTORY_STORAGE_KEY,
  MAX_DM_HISTORY_PER_PEER,
} from "../constants";

// ─── 모듈 싱글톤 상태 ───
// 같은 윈도우(JS 컨텍스트) 안에서는 하나의 WebSocket만 유지한다.
// 실제 소켓 연결은 메인 창(HomeView)에서만 만들고,
// 새 창으로 열리는 1:1 채팅방(ChatRoomView)은 BroadcastChannel 이벤트 버스로 주고받는다.
const isConnected = ref(false);
const nickname = ref("");
const globalMessages = ref<Array<ChatMessage>>([]);
const dmMessages = ref<Record<string, Array<ChatMessage>>>({});
const unreadCounts = ref<Record<string, number>>({});
const inputMessage = ref("");
const userlist = ref<Array<string>>([]);
const selectedConversation = ref<string | null>(null);

// 접속 직후 서버가 한 번만 보내주는 지난 대화 내역(history_group / history_dm)의
// 중복 적용 방지 플래그. 새 접속(connect)마다 초기화되며, 같은 내역이 두 번
// 수신되더라도 목록에 두 번 붙지 않도록 1회만 반영한다.
let groupHistoryApplied = false;
const dmHistoryApplied = new Set<string>();

const resetHistoryGuards = () => {
  groupHistoryApplied = false;
  dmHistoryApplied.clear();
};

// WebSocket 인스턴스 (윈도우당 1개)
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
  // 메인 창 새로고침 후에도 대화가 유지되도록 localStorage에 보관
  persistDmHistory();
  if (!fromSelf) {
    unreadCounts.value[peer] = (unreadCounts.value[peer] ?? 0) + 1;
  }
};

// localStorage에서 대화 내역을 읽어온다 (같은 닉네임 세션인 경우에만 복원)
const restoreDmHistory = () => {
  try {
    const raw = localStorage.getItem(DM_HISTORY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      nickname?: string;
      boxes?: Record<string, Array<ChatMessage>>;
    };
    if (parsed.nickname !== nickname.value) return;
    if (!parsed.boxes || typeof parsed.boxes !== "object") return;
    const boxes: Record<string, Array<ChatMessage>> = {};
    for (const [peer, list] of Object.entries(parsed.boxes)) {
      if (Array.isArray(list)) {
        boxes[peer] = list
          .filter(
            (m): m is ChatMessage =>
              !!m && typeof m === "object" && typeof m.text === "string",
          )
          .slice(-MAX_DM_HISTORY_PER_PEER)
          .map((m) => ({
            type: String(m.type ?? "dm"),
            nickname: String(m.nickname ?? peer),
            text: String(m.text ?? ""),
          }));
      }
    }
    dmMessages.value = boxes;
  } catch {
    // 무시 (깨진 저장값 등)
  }
};

const persistDmHistory = () => {
  try {
    const boxes: Record<string, Array<ChatMessage>> = {};
    for (const [peer, list] of Object.entries(dmMessages.value)) {
      boxes[peer] = list.slice(-MAX_DM_HISTORY_PER_PEER);
    }
    localStorage.setItem(
      DM_HISTORY_STORAGE_KEY,
      JSON.stringify({ nickname: nickname.value, boxes }),
    );
  } catch {
    // 무시 (용량 초과 등)
  }
};

const clearUnread = (peer: string) => {
  if (unreadCounts.value[peer]) {
    unreadCounts.value[peer] = 0;
  }
};

interface HistoryEntry {
  nickname?: string;
  text?: string;
}

interface IncomingPayload {
  type?: string;
  nickname?: string;
  from?: string;
  to?: string;
  text?: string;
  users?: string[];
  // 접속 직후 서버가 보내주는 지난 대화 내역 (history_group / history_dm)
  withUser?: string;
  messages?: Array<HistoryEntry>;
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
  } else if (data.type === "history_group") {
    // 접속 직후 서버가 보내주는 전체 채팅 내역 (한 번만 수신)
    // 같은 내역이 두 번 와도 앞에 두 번 붙지 않도록 1회만 처리한다.
    if (groupHistoryApplied) return;
    groupHistoryApplied = true;
    const history: Array<ChatMessage> = (
      Array.isArray(data.messages) ? data.messages : []
    ).map((msg) => ({
      type: "message",
      nickname: String(msg?.nickname ?? ""),
      text: String(msg?.text ?? ""),
    }));
    // 기존 내용 앞에 삽입 (과거 → 최신 순서 유지)
    globalMessages.value.unshift(...history);
    // 참고: 화면에 표시되는 목록(displayedMessages)은 globalMessages에서 그대로
    // 파생되므로, 선택된 대화가 전체 채팅방(null)일 때의 표시도 함께 갱신된다.
  } else if (data.type === "history_dm") {
    const withUser = String(data.withUser ?? "");
    if (!withUser) return;
    // 같은 상대에 대한 history_dm은 한 번만 반영한다.
    if (dmHistoryApplied.has(withUser)) return;
    dmHistoryApplied.add(withUser);
    const history: Array<ChatMessage> = (
      Array.isArray(data.messages) ? data.messages : []
    ).map((msg) => ({
      type: "message",
      nickname: String(msg?.nickname ?? withUser),
      text: String(msg?.text ?? ""),
    }));
    // 해당 상대의 대화 박스를 만들고(없으면 생성) 맨 앞에 삽입
    ensureDmBox(withUser).unshift(...history);
    // 새로고침 복원용 로컬 저장소에도 반영
    persistDmHistory();
    // 참고: 선택된 대화가 withUser이면 표시 목록도 dmMessages에서 파생되므로 함께 갱신된다.
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

// 1:1 메시지 전송 (메인 창의 단일 소켓으로 전송; 내 발신분은 서버 에코로 수신된다)
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
  const nicknameChanged = nickname.value !== "" && nickname.value !== trimmed;
  nickname.value = trimmed;
  if (nicknameChanged) {
    // 다른 닉네임으로 입장하면 이전 세션의 대화/뱃지를 섞지 않는다
    dmMessages.value = {};
    unreadCounts.value = {};
    globalMessages.value = [];
  }
  // 새 접속에서는 접속 직후 오는 히스토리를 다시 받는다.
  resetHistoryGuards();
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
    // 새로고침 전 대화 내역을 복원 (서버에 저장되지 않는 로컬 히스토리)
    restoreDmHistory();
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

// 연결 해제 함수 (명시적 "나가기"에서만 호출)
// NOTE: 소켓 수명은 윈도우 수명과 함께 간다. 컴포넌트 언마운트(라우트 이동) 시에는
// 자동으로 닫지 않는다 — 동일 탭에서 홈 ↔ 채팅방 이동 시 연결을 유지하기 위함.
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
  ws = null;
  isConnected.value = false;
  connectionStatus.value = "연결 끊김";
  // 명시적 나가기이므로 로컬 히스토리도 함께 정리
  try {
    localStorage.removeItem(DM_HISTORY_STORAGE_KEY);
  } catch {
    // 무시
  }
  dmMessages.value = {};
  globalMessages.value = [];
  unreadCounts.value = {};
  resetHistoryGuards();
};

/**
 * 채팅 소켓 싱글톤에 접근한다.
 * 호출할 때마다 같은 윈도우 안에서는 동일한 상태 객체를 반환하므로,
 * 메인 창에서 만든 연결을 같은 탭의 다른 라우트에서도 그대로 공유할 수 있다.
 */
export function useChatSocket() {
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
