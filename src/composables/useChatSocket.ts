import { ref } from "vue";
import type { ChatMessage, RoomInfo } from "../types/chat";
import {
  DM_HISTORY_STORAGE_KEY,
  MAX_DM_HISTORY_PER_PEER,
  MAX_ROOM_HISTORY_PER_ROOM,
  ROOM_HISTORY_STORAGE_KEY,
} from "../constants";

// ─── 모듈 싱글톤 상태 ───
// 같은 윈도우(JS 컨텍스트) 안에서는 하나의 WebSocket만 유지한다.
// 실제 소켓 연결은 메인 창(HomeView)에서만 만들고,
// 새 창으로 열리는 채팅방(ChatRoomView/RoomView)은 이벤트 버스로 주고받는다.
const isConnected = ref(false);
const nickname = ref("");
const dmMessages = ref<Record<string, Array<ChatMessage>>>({});
const unreadCounts = ref<Record<string, number>>({});
const userlist = ref<Array<string>>([]);

// 번호방 상태 (내가 속한 방만)
const myRooms = ref<Array<RoomInfo>>([]);
const roomMessages = ref<Record<number, Array<ChatMessage>>>({});
const roomUnread = ref<Record<number, number>>({});
const roomMembers = ref<Record<number, Array<string>>>({});

// 접속 직후 서버가 한 번만 보내주는 지난 대화 내역(history_dm / history_room)의
// 중복 적용 방지 플래그. 새 접속(connect)마다 초기화되며, 같은 내역이 두 번
// 수신되더라도 목록에 두 번 붙지 않도록 1회만 반영한다.
const dmHistoryApplied = new Set<string>();
const roomHistoryApplied = new Set<number>();

const resetHistoryGuards = () => {
  dmHistoryApplied.clear();
  roomHistoryApplied.clear();
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

const clearRoomUnread = (roomId: number) => {
  if (roomUnread.value[roomId]) {
    roomUnread.value[roomId] = 0;
  }
};

const ensureRoomBox = (roomId: number): Array<ChatMessage> => {
  if (!roomMessages.value[roomId]) {
    roomMessages.value[roomId] = [];
  }
  return roomMessages.value[roomId];
};

const persistRoomHistory = () => {
  try {
    const boxes: Record<number, Array<ChatMessage>> = {};
    for (const [roomId, list] of Object.entries(roomMessages.value)) {
      boxes[Number(roomId)] = list.slice(-MAX_ROOM_HISTORY_PER_ROOM);
    }
    localStorage.setItem(
      ROOM_HISTORY_STORAGE_KEY,
      JSON.stringify({ nickname: nickname.value, boxes }),
    );
  } catch {
    // 무시 (용량 초과 등)
  }
};

interface HistoryEntry {
  nickname?: string;
  text?: string;
  timestamp?: number;
}

interface IncomingPayload {
  type?: string;
  nickname?: string;
  from?: string;
  to?: string;
  text?: string;
  users?: string[];
  // 접속 직후 서버가 보내주는 지난 대화 내역 (history_dm / history_room)
  withUser?: string;
  messages?: Array<HistoryEntry>;
  // 번호방
  rooms?: Array<RoomInfo>;
  roomId?: number;
  members?: Array<string>;
  reason?: string;
  timestamp?: number;
}

const pruneRooms = () => {
  const alive = new Set(myRooms.value.map((r) => r.roomId));
  for (const key of Object.keys(roomMessages.value)) {
    if (!alive.has(Number(key))) delete roomMessages.value[Number(key)];
  }
  for (const key of Object.keys(roomUnread.value)) {
    if (!alive.has(Number(key))) delete roomUnread.value[Number(key)];
  }
};

const handleIncoming = (raw: string) => {
  const data: IncomingPayload = JSON.parse(raw) as IncomingPayload;
  if (data.type === "dm") {
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
  } else if (data.type === "system") {
    // 방 스코프 system 알림은 해당 방 박스에, 전역 알림은 무시(표시 위치 없음)
    const roomId = Number(data.roomId);
    if (Number.isInteger(roomId) && roomId > 0) {
      ensureRoomBox(roomId).push({
        type: "system",
        nickname: "",
        text: String(data.text ?? ""),
        timestamp: Date.now(),
        roomId,
      });
      persistRoomHistory();
    }
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
      timestamp: typeof msg?.timestamp === "number" ? msg.timestamp : undefined,
    }));
    // 해당 상대의 대화 박스를 만들고(없으면 생성) 맨 앞에 삽입
    ensureDmBox(withUser).unshift(...history);
    // 새로고침 복원용 로컬 저장소에도 반영
    persistDmHistory();
  } else if (data.type === "my_rooms" || data.type === "room_created") {
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    myRooms.value = rooms
      .filter((r) => r && typeof r.roomId === "number")
      .map((r) => ({
        roomId: Number(r.roomId),
        name: String(r.name ?? ""),
        owner: String(r.owner ?? ""),
        memberCount: Number(r.memberCount ?? 0),
      }));
    pruneRooms();
    persistRoomHistory();
  } else if (data.type === "history_room") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    if (roomHistoryApplied.has(roomId)) return;
    roomHistoryApplied.add(roomId);
    const history: Array<ChatMessage> = (
      Array.isArray(data.messages) ? data.messages : []
    ).map((msg) => ({
      type: "room",
      nickname: String(msg?.nickname ?? ""),
      text: String(msg?.text ?? ""),
      timestamp: typeof msg?.timestamp === "number" ? msg.timestamp : undefined,
      roomId,
    }));
    ensureRoomBox(roomId).unshift(...history);
    persistRoomHistory();
  } else if (data.type === "room_message") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const from = String(data.from ?? data.nickname ?? "");
    const isSelf = from === nickname.value;
    const msg: ChatMessage = {
      type: "room",
      nickname: from,
      text: String(data.text ?? ""),
      timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      roomId,
    };
    ensureRoomBox(roomId).push(msg);
    persistRoomHistory();
    if (!isSelf) {
      roomUnread.value[roomId] = (roomUnread.value[roomId] ?? 0) + 1;
    }
  } else if (data.type === "room_members") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    roomMembers.value[roomId] = Array.isArray(data.members)
      ? data.members.map((m) => String(m))
      : [];
  } else if (data.type === "room_closed") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    myRooms.value = myRooms.value.filter((r) => r.roomId !== roomId);
    delete roomMessages.value[roomId];
    delete roomUnread.value[roomId];
    delete roomMembers.value[roomId];
    persistRoomHistory();
  } else if (data.type === "room_join_failed") {
    // 실패 사유는 화면에서 system 메시지로 노출한다 (HomeView에서 처리)
    const roomId = Number(data.roomId);
    void roomId;
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

// 번호방 액션 (메인 창의 단일 소켓으로 전송)
const createRoomAction = (name: string): boolean => {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_create", name: trimmed.slice(0, 30) }));
  return true;
};

const joinRoom = (roomId: number): boolean => {
  if (!Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  roomHistoryApplied.delete(roomId);
  ws.send(JSON.stringify({ type: "room_join", roomId }));
  return true;
};

const leaveRoom = (roomId: number): boolean => {
  if (!Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_leave", roomId }));
  return true;
};

const deleteRoom = (roomId: number): boolean => {
  if (!Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_delete", roomId }));
  return true;
};

const refreshRooms = (): boolean => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_list" }));
  return true;
};

const sendRoom = (roomId: number, text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed === "" || !Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_message", roomId, text: trimmed }));
  return true;
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
    dmMessages.value = {};
    unreadCounts.value = {};
    myRooms.value = [];
    roomMessages.value = {};
    roomUnread.value = {};
    roomMembers.value = {};
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
    localStorage.removeItem(ROOM_HISTORY_STORAGE_KEY);
  } catch {
    // 무시
  }
  dmMessages.value = {};
  unreadCounts.value = {};
  myRooms.value = [];
  roomMessages.value = {};
  roomUnread.value = {};
  roomMembers.value = {};
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
    isConnected,
    connectionStatus,
    dmMessages,
    unreadCounts,
    userlist,
    myRooms,
    roomMessages,
    roomUnread,
    roomMembers,
    connect,
    attemptReconnect,
    manualReconnect,
    disconnect,
    sendDm,
    clearUnread,
    clearRoomUnread,
    createRoom: createRoomAction,
    joinRoom,
    leaveRoom,
    deleteRoom,
    refreshRooms,
    sendRoom,
  };
}
