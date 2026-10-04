import { ref } from "vue";
import type { ChatMessage, RoomInfo } from "../types/chat";

// ─── 모듈 싱글톤 상태 ───
// 같은 윈도우(JS 컨텍스트) 안에서는 하나의 WebSocket만 유지한다.
// 실제 소켓 연결은 메인 창(HomeView)에서만 만들고,
// 새 창으로 열리는 채팅방(ChatRoomView/RoomView)은 이벤트 버스로 주고받는다.
const isConnected = ref(false);
const nickname = ref("");
const dmMessages = ref<Record<string, Array<ChatMessage>>>({});
const unreadCounts = ref<Record<string, number>>({});
// userlist: DB 등록 사용자 전체 (탈퇴 제외, 본인 제외) — '사용자' 탭에 표시
const userlist = ref<Array<string>>([]);
// onlineUsers: 현재 접속중 닉네임 집합 (초록점/오프라인 구분용)
const onlineUsers = ref<Array<string>>([]);
// usersDetail: admin 전용 전체 사용자(탈퇴 포함) — '사용자'탭 관리용
export interface UserDetail {
  nickname: string;
  isDeleted: boolean;
}
const usersDetail = ref<Array<UserDetail>>([]);
// join 실패 메시지 (미등록/탈퇴 시 NicknameView에 표시)
const joinError = ref("");
// user_upsert 결과 메시지 (UserListView 모달에 표시)
const userUpsertResult = ref("");
const isAdmin = () => nickname.value === "admin";

// 번호방 상태 (내가 속한 방만)
const myRooms = ref<Array<RoomInfo>>([]);
const roomMessages = ref<Record<number, Array<ChatMessage>>>({});
const roomUnread = ref<Record<number, number>>({});
const roomMembers = ref<Record<number, Array<string>>>({});
// DM 대화에 대응하는 1:1 방 번호를 찾는다.
// (1:1 방의 displayName은 상대 닉네임이므로 매칭할 수 있다)
// DM과 1:1 방은 같은 대화를 보여주므로, 읽음 처리 시 양쪽 배지를 함께 정리한다.
const findOneToOneRoomId = (peer: string): number | null => {
  const hit = myRooms.value.find(
    (r) => r.memberCount === 2 && (r.displayName ?? "").trim() === peer,
  );
  return hit ? hit.roomId : null;
};

// ─── 안읽은 건수: 서버 DB가 단일 진실 ───
// localStorage는 브라우저(PC)별이라 다른 기기에서 로그인하면 안읽은 건수가 사라진다.
// 그래서 서버 unread 테이블이 진실이고, 클라이언트는 아래 신호로만 배지를 갱신한다.
//   unread_state : 접속 시 전체 안읽은 건수 복원 (다른 PC 로그인 시에도 유지됨)
//   unread_bump  : 실시간 수신 시 +1
//   unread_clear : 채팅창을 열어 읽음 처리 → 서버에 0으로 저장

// 채팅창 열람 시 서버에 최신 내역을 요청하는 플래그/가드 없이
// 서버가 내려준 history_dm / history_room은 항상 해당 박스를 덮어쓴다.
// (접속 시 일괄 푸시를 제거하고, 창을 열 때마다 DB에서 최근 10건을 조회해 오기 때문)

// WebSocket 인스턴스 (윈도우당 1개)
let ws: WebSocket | null = null;

// 읽음 처리를 서버에도 알린다 (다른 PC/브라우저에서 로그인해도 배지가 0으로 유지되도록)
const sendUnreadClear = (scope: "dm" | "room", target: string | number) => {
  const t = String(target);
  if (!t) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "unread_clear", scope, target: t }));
  } catch {
    // 무시 — 서버에 저장되지 않아도 화면 동작에는 문제없음
  }
};

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

const pushDm = (peer: string, msg: ChatMessage) => {
  ensureDmBox(peer).push(msg);
  // 안읽은 건수는 서버(unread_bump/unread_state 신호)가 진실이므로 여기서 건드리지 않는다.
  // (서버가 들어온 메시지를 이미 카운트해 두었다)
};

// 읽음 처리: 서버에 0으로 저장한다. (서버 DB가 진실이므로 다른 PC 로그인 시에도 유지)
// DM은 '내 채팅방' 탭의 1:1 방으로 표시되므로, '사용자' 탭에서 열어도
// 해당 1:1 방 배지를 함께 지워 어긋남을 막는다.
const clearUnread = (peer: string) => {
  if (unreadCounts.value[peer]) {
    unreadCounts.value[peer] = 0;
  }
  const roomId = findOneToOneRoomId(peer);
  if (roomId !== null && roomUnread.value[roomId]) {
    roomUnread.value[roomId] = 0;
  }
  sendUnreadClear("dm", peer);
};

const clearRoomUnread = (roomId: number) => {
  if (roomUnread.value[roomId]) {
    roomUnread.value[roomId] = 0;
  }
  // 1:1 방을 열면 DM 쪽 안읽은 건수도 함께 정리 (서버가 양쪽을 함께 지운다)
  sendUnreadClear("room", roomId);
};

const ensureRoomBox = (roomId: number): Array<ChatMessage> => {
  if (!roomMessages.value[roomId]) {
    roomMessages.value[roomId] = [];
  }
  return roomMessages.value[roomId];
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
  onlineUsers?: string[];
  usersDetail?: Array<{ nickname?: string; isDeleted?: boolean; is_deleted?: number }>;
  isDeleted?: boolean;
  is_deleted?: number;
  ok?: boolean;
  // 채팅창 열람 시 서버가 보내주는 지난 대화 내역 (history_dm / history_room)
  withUser?: string;
  messages?: Array<HistoryEntry>;
  // 번호방
  rooms?: Array<RoomInfo>;
  roomId?: number;
  members?: Array<string>;
  reason?: string;
  timestamp?: number;
  // 안읽은 건수 (서버 DB가 단일 진실 — 다른 PC 로그인 시에도 여기서 복원된다)
  unread?: { dm: Record<string, number>; room: Record<string, number> };
  scope?: string;
  target?: string;
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
      timestamp:
        typeof data.timestamp === "number" ? data.timestamp : Date.now(),
    };
    pushDm(peer, formattedMessage);
  } else if (data.type === "userlist") {
    // users = DB 등록 사용자 전체 (탈퇴 제외), onlineUsers = 현재 접속중
    // 구버전 서버 호환: onlineUsers가 없으면 users를 그대로 접속중으로 간주
    const users: Array<string> = Array.isArray(data.users) ? data.users : [];
    const online: Array<string> = Array.isArray(data.onlineUsers)
      ? data.onlineUsers
      : users;
    userlist.value = users.filter((user) => user !== nickname.value);
    onlineUsers.value = online.filter((user) => user !== nickname.value);
  } else if (data.type === "userlist_detail") {
    // admin 전용: 탈퇴 포함 전체 사용자 상세 (본인 제외)
    const detail = Array.isArray(data.usersDetail) ? data.usersDetail : [];
    usersDetail.value = detail
      .filter((d) => !!d && typeof d.nickname === "string")
      .map((d) => ({
        nickname: String(d.nickname),
        isDeleted: d.isDeleted === true || d.is_deleted === 1,
      }))
      .filter((d) => d.nickname !== nickname.value);
  } else if (data.type === "join_failed") {
    // 미등록/탈퇴 사용자 입장 거부 — 닉네임 화면에 사유 표시
    joinError.value = String(data.text || "입장할 수 없습니다");
    connectionStatus.value = "입장 거부됨";
    try {
      ws?.close();
    } catch {
      // 무시
    }
    ws = null;
    isConnected.value = false;
  } else if (data.type === "user_upsert_result") {
    if (data.ok) {
      userUpsertResult.value = "";
    } else {
      userUpsertResult.value = String(data.text || "사용자 저장에 실패했습니다");
    }
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
    }
  } else if (data.type === "history_dm") {
    const withUser = String(data.withUser ?? "");
    if (!withUser) return;
    const history: Array<ChatMessage> = (
      Array.isArray(data.messages) ? data.messages : []
    ).map((msg) => ({
      type: "message",
      nickname: String(msg?.nickname ?? withUser),
      text: String(msg?.text ?? ""),
      timestamp: typeof msg?.timestamp === "number" ? msg.timestamp : undefined,
    }));
    // 채팅창을 열 때마다 서버가 보내는 DB 최신 내역(10건)으로 박스를 덮어쓴다.
    dmMessages.value[withUser] = history;
  } else if (data.type === "my_rooms" || data.type === "room_created") {
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    myRooms.value = rooms
      .filter((r) => r && typeof r.roomId === "number")
      .map((r) => ({
        roomId: Number(r.roomId),
        name: String(r.name ?? ""),
        owner: String(r.owner ?? ""),
        memberCount: Number(r.memberCount ?? 0),
        // 서버가 내려준 사용자별 표시제목 (1:1=상대닉네임), 없으면 name으로 폴백
        displayName: String(
          typeof r.displayName === "string" && r.displayName.trim() !== ""
            ? r.displayName
            : (r.name ?? ""),
        ),
        // 목록 미리보기용 마지막 메시지 요약 (구버전 서버엔 필드가 없어 undefined → 미표시)
        lastMessage:
          typeof r.lastMessage === "string" ? r.lastMessage : null,
        lastMessageAt:
          typeof r.lastMessageAt === "number" ? r.lastMessageAt : null,
        lastMessageSender:
          typeof r.lastMessageSender === "string" ? r.lastMessageSender : null,
      }));
    pruneRooms();
  } else if (data.type === "history_room") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const history: Array<ChatMessage> = (
      Array.isArray(data.messages) ? data.messages : []
    ).map((msg) => ({
      type: "room",
      nickname: String(msg?.nickname ?? ""),
      text: String(msg?.text ?? ""),
      timestamp: typeof msg?.timestamp === "number" ? msg.timestamp : undefined,
      roomId,
    }));
    // NOTE: 채팅창을 열 때마다 서버가 보내는 DB 최신 내역(10건)으로 항상 덮어쓴다.
    // (접속 시 일괄 푸시 제거 + 창 열람 시 새로 조회)
    roomMessages.value[roomId] = history;
  } else if (data.type === "room_message") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const from = String(data.from ?? data.nickname ?? "");
    const msg: ChatMessage = {
      type: "room",
      nickname: from,
      text: String(data.text ?? ""),
      timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      roomId,
    };
    ensureRoomBox(roomId).push(msg);
    // 안읽은 건수는 서버 신호(unread_bump)가 진실이므로 여기서 증가시키지 않는다.
    // '내 채팅방' 목록 미리보기/시간 즉시 갱신 (다음 my_rooms 수신 때 DB 값으로 재확정)
    const room = myRooms.value.find((r) => r.roomId === roomId);
    if (room) {
      room.lastMessage = msg.text;
      room.lastMessageAt = msg.timestamp ?? null;
      room.lastMessageSender = from;
    }
  } else if (data.type === "room_last_message") {
    // 방에 메시지가 저장될 때마다 서버가 멤버에게 보내는 목록 갱신 신호
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const room = myRooms.value.find((r) => r.roomId === roomId);
    if (!room) return;
    room.lastMessage = String(data.text ?? "");
    room.lastMessageAt =
      typeof data.timestamp === "number" ? data.timestamp : Date.now();
    room.lastMessageSender = String(data.from ?? data.nickname ?? "");
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
  } else if (data.type === "room_join_failed") {
    // 실패 사유는 화면에서 system 메시지로 노출한다 (HomeView에서 처리)
    const roomId = Number(data.roomId);
    void roomId;
  } else if (data.type === "unread_state") {
    // 접속 시 서버 DB에서 내려온 안읽은 건수 전체를 그대로 적용한다.
    // (로그아웃/다른 PC에서 로그인해도 서버에 남은 값이 복원된다)
    const dm: Record<string, number> = {};
    const room: Record<number, number> = {};
    for (const [peer, count] of Object.entries(data.unread?.dm ?? {})) {
      const n = Number(count);
      if (peer && Number.isFinite(n) && n > 0) dm[peer] = Math.floor(n);
    }
    for (const [key, count] of Object.entries(data.unread?.room ?? {})) {
      const id = Number(key);
      const n = Number(count);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(n) && n > 0) {
        room[id] = Math.floor(n);
      }
    }
    unreadCounts.value = dm;
    roomUnread.value = room;
  } else if (data.type === "unread_bump") {
    // 실시간 수신: 서버가 DB에 증가시켜 둔 값을 화면에 +1 반영한다.
    if (data.scope === "room") {
      const roomId = Number(data.target);
      if (Number.isInteger(roomId) && roomId > 0) {
        roomUnread.value[roomId] = (roomUnread.value[roomId] ?? 0) + 1;
      }
    } else {
      const peer = String(data.target ?? "");
      if (peer) {
        unreadCounts.value[peer] = (unreadCounts.value[peer] ?? 0) + 1;
      }
    }
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
const createRoomAction = (name: string, members: string[] = []): boolean => {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const cleanMembers = Array.isArray(members)
    ? members
        .map((m) => String(m ?? "").trim())
        .filter((m) => m && m !== nickname.value)
        .slice(0, 50)
    : [];
  ws.send(
    JSON.stringify({
      type: "room_create",
      name: trimmed.slice(0, 30),
      members: cleanMembers,
    }),
  );
  return true;
};

const joinRoom = (roomId: number): boolean => {
  if (!Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
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

// ─── 채팅창 열람: DB 최근 10건 조회 요청 ───
// 채팅창(1:1/단체)이 열릴 때마다 호출하며, 서버는 history_dm / history_room으로
// 최근 10건을 내려준다 (수신 시 해당 박스를 덮어쓴다).
const requestDmHistory = (peer: string): boolean => {
  const target = peer.trim();
  if (!target) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "dm_history", withUser: target }));
  return true;
};

const requestRoomHistory = (roomId: number): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_history", roomId }));
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
  joinError.value = "";
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
  // 안읽은 건수는 서버 DB가 진실이므로 여기서 복원하지 않는다.
  // join 응답의 unread_state로 서버 값이 도착하면 그때 적용된다.
  // (닉네임이 바뀌면 이전 사용자의 배지를 먼저 비워야 새 계정과 섞이지 않는다)
  unreadCounts.value = {};
  roomUnread.value = {};
  // 새 접속에서는 채팅창을 열 때마다 다시 조회한다.
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

// ─── 사용자 관리: 추가/수정 (admin 전용) ───
// 닉네임 + 탈퇴여부를 서버로 전송 (서버에서 upsert + 목록 재브로드캐스트)
const upsertUser = (targetNickname: string, isDeleted: boolean): boolean => {
  if (nickname.value !== "admin") return false;
  const trimmed = targetNickname.trim().slice(0, 20);
  if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return false;
  userUpsertResult.value = "";
  ws.send(
    JSON.stringify({ type: "user_upsert", nickname: trimmed, isDeleted })
  );
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
  // 로그아웃. 안읽은 건수는 서버 DB에 이미 저장돼 있으므로(읽음은 unread_clear로 보고됨)
  // 여기서는 화면 상태만 비운다. 다시 로그인하면 join 응답의 unread_state로 복원된다.
  dmMessages.value = {};
  unreadCounts.value = {};
  myRooms.value = [];
  roomMessages.value = {};
  roomUnread.value = {};
  roomMembers.value = {};
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
    onlineUsers,
    usersDetail,
    joinError,
    userUpsertResult,
    isAdmin,
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
    requestDmHistory,
    requestRoomHistory,
    upsertUser,
  };
}
