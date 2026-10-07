import { ref } from "vue";
import type { ChatAttachment, ChatMessage, ChatUser, Department, MyStatus, RoomInfo, RoomSearchState } from "../types/chat";
import {
  DEFAULT_MY_STATUS,
  MY_STATUS_EMOJI,
  MY_STATUS_OPTIONS,
  ROOM_TITLE_INPUT_MAX_LENGTH,
  myStatusText,
  normalizeMyStatus,
  attachmentPreviewText,
  toChatAttachment,
} from "../types/chat";
import { loadSavedLogin, saveLogin } from "../loginPrefs";

// ─── 모듈 싱글톤 상태 ───
const isConnected = ref(false);
// 로그인 ID (불변, 영문+숫자 최대20) — 서버 join 키
const loginId = ref("");
// 로그인 비밀번호 — 재연결 시 join에 다시 보내야 하므로 메모리에만 들고 있는다 (화면 노출 안 함)
let loginPassword = "";
// 내 user_no (서버 내부 키) + 표시용 닉네임
const myUserNo = ref<number | null>(null);
const nickname = ref("");
// 내 프로필 이미지 (null = 기본 실루엣). join_ok / my_profile 로 받는다.
const myProfileImage = ref<ChatAttachment | null>(null);

// ─── 내 상태 (접속/오프라인/회의중/바쁨/자리비움) ───
// 메인 화면 상단 드롭다운에서 고른 값.
// 브라우저에 저장하지 않으므로 접속할 때마다 기본값(접속)으로 시작하고,
// status_set으로 서버에 보내 다른 사용자에게 상태를 보여준다.
const myStatus = ref<MyStatus>(DEFAULT_MY_STATUS);

/** 내 상태 변경: 화면 상태를 갱신하고 서버(status_set)로도 전파한다 */
const setMyStatus = (value: MyStatus) => {
  const next = normalizeMyStatus(value);
  myStatus.value = next;
  // 서버 전파 — 다른 사용자의 '사용자' 탭에 내 상태가 보이도록 한다.
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "status_set", status: next }));
    } catch {
      // 전송 실패는 무시한다 — 다음 상태 변경 시 다시 전송된다.
    }
  }
};
// userlist: DB 등록 사용자 전체 (탈퇴 제외) — '사용자' 탭에 표시
const userlist = ref<Array<ChatUser>>([]);
// onlineUsers: 현재 접속중 user_no 집합
const onlineUsers = ref<Array<number>>([]);
// userStatuses: 서버가 userlist에 실어 보내는 사용자별 상태 (user_no → 상태)
const userStatuses = ref<Record<number, MyStatus>>({});

/**
 * userNo의 최종 상태: 본인은 내 드롭다운 값이 우선하고, 나머지는 서버 방송값을 쓴다.
 * 맵에 없거나 접속 중이 아닌 사용자는 자동으로 offline 취급한다 (접속 해제 자동 반영).
 */
const statusOf = (userNo: number): MyStatus => {
  if (userNo === myUserNo.value) return myStatus.value;
  const raw: MyStatus | undefined = userStatuses.value[userNo];
  if (raw === undefined || !onlineUsers.value.includes(userNo)) return "offline";
  return MY_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : "offline";
};
/** userNo 상태 이모티콘 — 예) '🙂' */
const statusEmojiOf = (userNo: number): string => MY_STATUS_EMOJI[statusOf(userNo)];
/** userNo 상태문구 — '접속(🙂)' 형태 */
const statusTextOf = (userNo: number): string => myStatusText(statusOf(userNo));
// usersDetail: admin 전용 전체 사용자(탈퇴 포함) — '사용자'탭 관리용
export interface UserDetail {
  user_no: number;
  loginId: string;
  nickname: string;
  phone?: string | null;
  userName?: string | null;
  isDeleted: boolean;
  deptNo?: number | null;
  profileImage?: ChatAttachment | null;
}
const usersDetail = ref<Array<UserDetail>>([]);
// depts: admin 전용 부서 목록(미사용 포함 + 소속 인원수) — '설정 > 부서관리'용
const depts = ref<Array<Department>>([]);
// dept_upsert 결과 — seq로 매 응답을 구분해 모달이 성공/실패를 감지한다
const deptUpsertResult = ref<{ seq: number; ok: boolean; text: string } | null>(null);
// join 실패 메시지 (미등록/탈퇴 시 LoginView에 표시)
const joinError = ref("");
// user_upsert 결과 메시지 (UserListView 모달에 표시)
const userUpsertResult = ref("");
// user_rename 결과 메시지
const userRenameResult = ref("");
// profile_image_set 결과 — seq로 매 응답을 구분해 모달이 성공/실패를 감지한다
const profileImageResult = ref<{ seq: number; ok: boolean; text: string } | null>(null);
// password_change / password_reset 결과 — seq로 매 응답을 구분한다
// kind: 'change' | 'reset', self: 본인 비밀번호가 바뀌었는지
const passwordResult = ref<{ seq: number; ok: boolean; kind: "change" | "reset"; self: boolean; text: string } | null>(null);
// 비밀번호 변경 요청 중인 새 비밀번호 (성공 응답 시 loginPassword로 반영)
let pendingNewPassword: string | null = null;
const isAdmin = () => myUserNo.value === 1;

// 방제목 수정 실패 사유 (RenameRoomModal에 표시). 성공하면 서버가 새 목록을 주므로 비운다.
const roomRenameError = ref<{ roomId: number; reason: string } | null>(null);

// 번호방 상태 (내가 속한 방만)
const myRooms = ref<Array<RoomInfo>>([]);
const roomMessages = ref<Record<number, Array<ChatMessage>>>({});
const roomUnread = ref<Record<number, number>>({});
const roomMembers = ref<Record<number, Array<ChatUser>>>({});
// 이전 대화 더보기 (msgId 커서 페이징): 방별로 더 불러올 이전 대화가 있는지 / 불러오는 중인지
const roomHasMore = ref<Record<number, boolean>>({});
const roomLoadingOlder = ref<Record<number, boolean>>({});
// 검색 결과로 점프해 최신이 아닌 구간을 보는 중이면, 아래로 이어 불러올 대화가 있는지 / 불러오는 중인지
const roomHasNewer = ref<Record<number, boolean>>({});
const roomLoadingNewer = ref<Record<number, boolean>>({});
// 채팅창 메시지 검색 상태 (ids: 매칭 msgId, 최신 → 과거 순)
const roomSearch = ref<Record<number, RoomSearchState>>({});
// 1:1 대화에 대응하는 방 번호를 찾는다.
// (1:1 방의 displayName은 상대 닉네임이므로 매칭할 수 있다)
// '사용자' 탭에서 상대를 눌러 이미 만들어진 방으로 바로 열기 위한 조회다.
const findOneToOneRoomId = (peer: string): number | null => {
  const hit = myRooms.value.find(
    (r) => r.memberCount === 2 && (r.displayName ?? "").trim() === peer,
  );
  return hit ? hit.roomId : null;
};

// findOneToOneRoomId 의 역방향: 1:1 방 번호 → 상대 닉네임.
// 그룹방(3명 이상)이면 null.
const oneToOnePeerOfRoom = (roomId: number): string | null => {
  const meNo = myUserNo.value;
  const me = nickname.value.trim();
  // 1순위: 방을 열며 받은 실제 멤버 목록이 있으면 이를 따른다 (가장 정확)
  const members = roomMembers.value[roomId] ?? [];
  if (members.length === 2 && meNo != null && members.some((m) => m.user_no === meNo)) {
    return members.find((m) => m.user_no !== meNo)?.nickname ?? null;
  }
  // 폴백: 아직 room_members를 못 받은 경우 내 방 목록의 표시제목(=상대 닉네임)으로 판단
  const info = myRooms.value.find((r) => r.roomId === roomId);
  if (!info || info.memberCount !== 2) return null;
  const display = (info.displayName ?? "").trim();
  return display && display !== me ? display : null;
};

// ─── 안읽은 건수: 서버 DB가 단일 진실 ───
// localStorage는 브라우저(PC)별이라 다른 기기에서 로그인하면 안읽은 건수가 사라진다.
// 그래서 서버 unread 테이블이 진실이고, 클라이언트는 아래 신호로만 배지를 갱신한다.
//   unread_state : 접속 시 전체 안읽은 건수 복원 (다른 PC 로그인 시에도 유지됨)
//   unread_bump  : 실시간 수신 시 +1
//   unread_clear : 채팅창을 열어 읽음 처리 → 서버에 0으로 저장

// 채팅창 열람 시 서버에 최신 내역을 요청하는 플래그/가드 없이
// 서버가 내려준 history_room은 항상 해당 박스를 덮어쓴다.
// (접속 시 일괄 푸시를 제거하고, 창을 열 때마다 DB에서 최신 한 페이지를 조회해 오기 때문)
// 그보다 이전 대화는 history_room_older 로 받아 배열 앞에 붙인다.

// WebSocket 인스턴스 (윈도우당 1개)
let ws: WebSocket | null = null;

// 읽음 처리를 서버에도 알린다 (다른 PC/브라우저에서 로그인해도 배지가 0으로 유지되도록)
const sendUnreadClear = (roomId: number) => {
  if (!Number.isInteger(roomId)) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "unread_clear", scope: "room", target: String(roomId) }));
  } catch {
    // 무시 — 서버에 저장되지 않아도 화면 동작에는 문제없음
  }
};

// 재연결 관련 상태
const connectionStatus = ref("연결되지 않음");
const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const isManuallyDisconnected = ref(false);

// 읽음 처리: 서버에 0으로 저장한다. (서버 DB가 진실이므로 다른 PC 로그인 시에도 유지)
const clearRoomUnread = (roomId: number) => {
  if (roomUnread.value[roomId]) {
    roomUnread.value[roomId] = 0;
  }
  sendUnreadClear(roomId);
};

// ─── 포커스 중인 방 (안읽은 건수를 잡지 않을 대상) ───
// 채팅방 창은 메인 창과 별개 프로세스(윈도우/팝업)이므로, 그 창이 focus되어 있는지
// 메인 창이 알 수 없다. 채팅창이 useWindowFocus로 감지해 bus로 보고하고,
// 메인 창(=소켓 소유자)이 아래 상태를 진실로 들고 있다.
// focus 중에는 unread_bump가 도착해도 건수를 올리지 않고 0으로 되돌린다.
const focusedRooms = ref<Record<number, boolean>>({});

const isRoomFocused = (roomId: number): boolean =>
  Number.isInteger(roomId) && focusedRooms.value[roomId] === true;

/**
 * 채팅창 focus 상태 변경 반영.
 * focus가 된 순간(되거나 이미 focus 중이면) 안읽은 건수를 즉시 0으로 만든다.
 * = "focus하는 순간 채팅목록 안읽은 건수가 사라진다"
 * 1:1도 방 하나이므로 별도 처리 없이 같은 규칙이 적용된다.
 */
const setRoomFocus = (roomId: number, focused: boolean) => {
  if (!Number.isInteger(roomId)) return;
  if (!focused) {
    if (focusedRooms.value[roomId]) delete focusedRooms.value[roomId];
    return;
  }
  focusedRooms.value[roomId] = true;
  clearRoomUnread(roomId);
};

// 창이 닫혔을 때(room-close) 남은 포커스 표시를 정리한다.
const forgetRoomFocus = (roomId: number) => {
  if (!Number.isInteger(roomId)) return;
  if (focusedRooms.value[roomId]) delete focusedRooms.value[roomId];
};

const ensureRoomBox = (roomId: number): Array<ChatMessage> => {
  if (!roomMessages.value[roomId]) {
    roomMessages.value[roomId] = [];
  }
  return roomMessages.value[roomId];
};

interface HistoryEntry {
  user_no?: number;
  nickname?: string;
  text?: string;
  timestamp?: number;
  /** 읽음 표시(카톡식 숫자) 계산용 서버 메시지 id */
  msgId?: number;
  /** 서버가 함께 내려주는 원본 id */
  id?: number;
  /** 이 메시지를 아직 안 읽은 사람 수 (0 이면 표시하지 않음). 발신자만 제외하고 센다 */
  unreadCount?: number;
  /** 첨부파일 메시지면 { id, name, size, mime } */
  file?: unknown;
}

// 서버 히스토리 항목(history_room / history_room_older) → ChatMessage
const toRoomHistory = (roomId: number, messages: unknown): Array<ChatMessage> =>
  (Array.isArray(messages) ? (messages as Array<HistoryEntry>) : []).map((msg) => ({
    type: "room",
    user_no: Number(userNoOf(msg) ?? 0),
    nickname: String(msg?.nickname ?? ""),
    text: String(msg?.text ?? ""),
    timestamp: typeof msg?.timestamp === "number" ? msg.timestamp : undefined,
    roomId,
    // 읽음 숫자 재계산용 id. 서버는 msgId 로 주지만, 구버전 payload 는 id 만 준다.
    // 둘 다 없으면 숫자를 재계산할 수 없으므로 undefined 로 둔다
    // (applyReadAck 가 이 경우 기존 숫자를 보존한다).
    msgId: readMsgId(msg),
    unreadCount:
      typeof msg?.unreadCount === "number" ? msg.unreadCount : 0,
    file: toChatAttachment(msg?.file),
  }));

interface IncomingPayload {
  type?: string;
  user_no?: number;
  userNo?: number;
  loginId?: string;
  login_id?: string;
  nickname?: string;
  from?: string;
  from_no?: number;
  to?: string;
  text?: string;
  users?: Array<ChatUser>;
  onlineUsers?: Array<number>;
  /** 서버가 userlist에 실어 보내는 사용자별 상태 (user_no → 상태) */
  userStatuses?: Record<string, MyStatus>;
  usersDetail?: Array<UserDetail & { user_name?: string | null; user_no?: number }>;
  depts?: Array<Department>;
  isDeleted?: boolean;
  is_deleted?: number;
  ok?: boolean;
  // password_reset_result: 본인 초기화 여부 + 새 비밀번호(본인일 때만)
  self?: boolean;
  password?: string;
  // 채팅창 열람 시 서버가 보내주는 지난 대화 내역 (history_room)
  withUser?: string;
  withUserNo?: number;
  messages?: Array<HistoryEntry>;
  // 번호방
  rooms?: Array<RoomInfo>;
  roomId?: number;
  members?: Array<number>;
  memberProfiles?: Array<ChatUser>;
  reason?: string;
  timestamp?: number;
  // 안읽은 건수 (서버 DB가 단일 진실 — 다른 PC 로그인 시에도 여기서 복원된다)
  unread?: { room: Record<string, number> };
  scope?: string;
  target?: string;
  // 읽음 표시 (카톡식 메시지별 숫자)
  msgId?: number;
  unreadCount?: number;
  // read_ack: 그 대화의 참여자별 마지막 읽음 위치
  cursors?: Record<string, number>;
  // history_room / history_room_older: 더 이전 대화가 있는지
  hasMore?: boolean;
  // history_room_older: 요청했던 커서 (응답이 현재 목록에 이어 붙일 수 있는지 확인용)
  beforeId?: number;
  // history_room_around / history_room_newer: 더 이후 대화가 있는지
  hasNewer?: boolean;
  // history_room_newer: 요청했던 커서
  afterId?: number;
  // room_search_result: 검색어 / 매칭 msgId 목록(최신 → 과거) / 상한 초과 여부
  keyword?: string;
  ids?: Array<number>;
  truncated?: boolean;
}

// user_no 판정용
const toNo = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const userNoOf = (u: unknown): number | null => {
  if (typeof u === "number" || typeof u === "string") return toNo(u);
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    return toNo(o.user_no ?? o.userNo ?? o.no ?? o.id);
  }
  return null;
};
const nickOf = (u: unknown): string => {
  if (typeof u === "string") return u;
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    const v = o.nickname ?? o.name;
    return typeof v === "string" ? v : "";
  }
  return "";
};
// 서버 memberProfiles 항목 → ChatUser (프로필 사진은 채팅창 상대 메시지 옆에 표시)
const memberOf = (u: unknown): ChatUser => ({
  user_no: Number(userNoOf(u) ?? 0),
  nickname: nickOf(u),
  profileImage: u && typeof u === "object"
    ? toChatAttachment((u as Record<string, unknown>).profileImage) ?? null
    : null,
});

const pruneRooms = () => {
  const alive = new Set(myRooms.value.map((r) => r.roomId));
  for (const key of Object.keys(roomMessages.value)) {
    if (!alive.has(Number(key))) delete roomMessages.value[Number(key)];
  }
  for (const key of Object.keys(roomUnread.value)) {
    if (!alive.has(Number(key))) delete roomUnread.value[Number(key)];
  }
};

/** 서버 히스토리 항목에서 읽음 숫자 계산용 메시지 id 를 꺼낸다 (msgId 우선, id 폴백) */
const readMsgId = (msg?: HistoryEntry): number | undefined => {
  if (typeof msg?.msgId === "number" && msg.msgId > 0) return msg.msgId;
  if (typeof msg?.id === "number" && msg.id > 0) return msg.id;
  return undefined;
};

/**
 * '사용자' 탭에서 1:1 창을 열기 위해 보낸 요청의 대기 콜백.
 * 서버가 room_opened 로 방 번호를 돌려주면 여기에 걸린 콜백을 깨운다.
 * (이미 만들어진 방이면 서버가 곧바로 회신하므로 즉시 끝난다)
 */
const pendingOneToOne = new Map<number, (roomId: number) => void>();

const handleIncoming = (raw: string) => {
  const data: IncomingPayload = JSON.parse(raw) as IncomingPayload;
  if (data.type === "room_opened") {
    // '사용자' 탭에서 1:1 창을 열라고 요청한 뒤 서버가 방 번호를 알려준 경우.
    const peerNo = toNo(data.withUserNo ?? data.withUser);
    const roomId = Number(data.roomId);
    if (peerNo == null || !Number.isInteger(roomId)) return;
    const resolve = pendingOneToOne.get(peerNo);
    if (resolve) {
      pendingOneToOne.delete(peerNo);
      resolve(roomId);
    }
  } else if (data.type === "userlist") {
    // users = [{user_no, nickname, profileImage}], onlineUsers = [user_no], userStatuses = {user_no: status}
    const users: Array<ChatUser> = Array.isArray(data.users) ? data.users : [];
    const online: Array<number> = Array.isArray(data.onlineUsers) ? data.onlineUsers : [];
    const clean = users
      .map(memberOf)
      .filter((u) => u.user_no > 0 && u.nickname);
    userlist.value = clean.filter((u) => u.user_no !== myUserNo.value);
    onlineUsers.value = online.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n !== myUserNo.value);
    // 사용자별 상태: 유효한 값만 남긴다 (없는 사용자는 offline으로 취급되도록 비워 둔다)
    const statuses: Record<number, MyStatus> = {};
    const rawStatuses = data.userStatuses;
    if (rawStatuses && typeof rawStatuses === "object") {
      for (const [key, value] of Object.entries(rawStatuses)) {
        const no = Number(key);
        if (!Number.isInteger(no) || no <= 0) continue;
        if (MY_STATUS_OPTIONS.some((o) => o.value === value)) statuses[no] = value;
      }
    }
    userStatuses.value = statuses;
  } else if (data.type === "userlist_detail") {
    // admin 전용: 탈퇴 포함 전체 사용자 상세 (본인 포함 — DB의 모든 계정)
    const detail = Array.isArray(data.usersDetail) ? data.usersDetail : [];
    usersDetail.value = detail
      .map((raw) => {
        const d = raw as unknown as Record<string, unknown>;
        const no = Number(d.user_no ?? d.userNo ?? 0);
        const isDeleted = d.isDeleted === true || d.is_deleted === 1 || d.is_deleted === true;
        const userName = d.userName ?? d.user_name;
        return {
          user_no: no,
          loginId: String(d.loginId ?? d.login_id ?? ""),
          nickname: String(d.nickname ?? ""),
          phone: (d.phone as string | null) ?? null,
          userName: typeof userName === "string" ? userName : null,
          isDeleted: Boolean(isDeleted),
          deptNo: d.deptNo == null ? null : Number(d.deptNo),
          profileImage: toChatAttachment(d.profileImage) ?? null,
        };
      })
      .filter((d) => d.user_no > 0);
  } else if (data.type === "dept_list") {
    depts.value = Array.isArray(data.depts) ? data.depts : [];
  } else if (data.type === "dept_upsert_result") {
    deptUpsertResult.value = {
      seq: (deptUpsertResult.value?.seq ?? 0) + 1,
      ok: data.ok === true,
      text: data.ok ? "" : String(data.text || "부서 저장에 실패했습니다"),
    };
  } else if (data.type === "join_ok" || data.type === "my_profile") {
    const no = toNo(data.user_no ?? data.userNo);
    if (no != null) {
      myUserNo.value = no;
      if (typeof data.nickname === "string" && data.nickname) nickname.value = data.nickname;
      if (typeof (data.loginId ?? data.login_id) === "string" && (data.loginId ?? data.login_id)) {
        loginId.value = String(data.loginId ?? data.login_id);
      }
      if ("profileImage" in data) myProfileImage.value = toChatAttachment(data.profileImage) ?? null;
      joinError.value = "";
    }
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
  } else if (data.type === "user_rename_result") {
    if (data.ok) {
      userRenameResult.value = "";
    } else {
      userRenameResult.value = String(data.text || "닉네임 변경에 실패했습니다");
    }
  } else if (data.type === "password_change_result" || data.type === "password_reset_result") {
    const kind = data.type === "password_change_result" ? "change" : "reset";
    const ok = data.ok === true;
    let self = kind === "change";
    if (ok) {
      let next: string | null = null;
      if (kind === "change") {
        next = pendingNewPassword;
      } else if (data.self === true && typeof data.password === "string") {
        self = true;
        next = data.password;
      }
      if (next != null) applyNewPassword(next);
    }
    if (kind === "change") pendingNewPassword = null;
    passwordResult.value = {
      seq: (passwordResult.value?.seq ?? 0) + 1,
      ok,
      kind,
      self,
      text: ok ? "" : String(data.text || (kind === "change" ? "비밀번호 변경에 실패했습니다" : "비밀번호 초기화에 실패했습니다")),
    };
  } else if (data.type === "profile_image_result") {
    profileImageResult.value = {
      seq: (profileImageResult.value?.seq ?? 0) + 1,
      ok: data.ok === true,
      text: data.ok ? "" : String(data.text || "프로필 이미지 변경에 실패했습니다"),
    };
  } else if (data.type === "system") {
    // 방 스코프 system 알림은 해당 방 박스에, 전역 알림은 무시(표시 위치 없음)
    const roomId = Number(data.roomId);
    if (Number.isInteger(roomId) && roomId > 0) {
      ensureRoomBox(roomId).push({
        type: "system",
        user_no: 0,
        nickname: "",
        text: String(data.text ?? ""),
        timestamp: Date.now(),
        roomId,
      });
    }
  } else if (data.type === "my_rooms" || data.type === "room_created") {
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    myRooms.value = rooms
      .filter((r) => r && typeof r.roomId === "number")
      .map((r) => ({
        roomId: Number(r.roomId),
        name: String(r.name ?? ""),
        owner_no: Number((r as unknown as Record<string, unknown>).owner_no ?? 0),
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
    const history = toRoomHistory(roomId, data.messages);
    // NOTE: 채팅창을 열 때마다 서버가 보내는 DB 최신 한 페이지로 항상 덮어쓴다.
    // (접속 시 일괄 푸시 제거 + 창 열람 시 새로 조회. 앞서 불러온 이전 대화도 이때 비워진다)
    roomMessages.value[roomId] = history;
    roomHasMore.value[roomId] = data.hasMore === true;
    roomLoadingOlder.value[roomId] = false;
    // 최신 페이지이므로 아래로 이어 불러올 대화는 없다 (검색 점프 상태 해제)
    roomHasNewer.value[roomId] = false;
    roomLoadingNewer.value[roomId] = false;
    // 방을 열면 참여자 목록도 함께 온다 → 읽음 숫자 실시간 재계산에 쓴다.
    // (이게 없으면 read_ack 를 받았을 때 숫자가 0으로 잘못 계산되어 한 번에 사라진다)
    if (Array.isArray(data.memberProfiles)) {
      roomMembers.value[roomId] = data.memberProfiles
        .map(memberOf)
        .filter((m) => m.user_no > 0);
    } else if (Array.isArray(data.members)) {
      roomMembers.value[roomId] = data.members
        .map((m) => ({ user_no: Number(userNoOf(m) ?? 0), nickname: "" }))
        .filter((m) => m.user_no > 0);
    }
  } else if (data.type === "history_room_older") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    roomLoadingOlder.value[roomId] = false;
    roomHasMore.value[roomId] = data.hasMore === true;
    const box = ensureRoomBox(roomId);
    // 응답 대기 중 history_room 으로 박스가 새로 덮어써졌다면,
    // 요청 기준(beforeId)과 현재 맨 앞 메시지가 달라 이어 붙이면 순서가 꼬인다 → 버린다.
    const head = box.find((m) => typeof m.msgId === "number");
    if (head && Number(data.beforeId) !== head.msgId) return;
    const known = new Set(box.map((m) => m.msgId).filter((id) => typeof id === "number"));
    const older = toRoomHistory(roomId, data.messages).filter(
      (m) => m.msgId === undefined || !known.has(m.msgId),
    );
    if (older.length > 0) roomMessages.value[roomId] = [...older, ...box];
  } else if (data.type === "history_room_around") {
    // 검색 결과 점프: 대상 메시지를 가운데 둔 한 페이지로 박스를 덮어쓴다.
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    roomMessages.value[roomId] = toRoomHistory(roomId, data.messages);
    roomHasMore.value[roomId] = data.hasMore === true;
    roomLoadingOlder.value[roomId] = false;
    roomHasNewer.value[roomId] = data.hasNewer === true;
    roomLoadingNewer.value[roomId] = false;
  } else if (data.type === "history_room_newer") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    roomLoadingNewer.value[roomId] = false;
    const box = ensureRoomBox(roomId);
    // 응답 대기 중 박스가 덮어써졌다면 (최신 페이지/다른 점프) 이어 붙이면 순서가 꼬인다 → 버린다.
    const tail = [...box].reverse().find((m) => typeof m.msgId === "number");
    if (tail && Number(data.afterId) !== tail.msgId) return;
    roomHasNewer.value[roomId] = data.hasNewer === true;
    const known = new Set(box.map((m) => m.msgId).filter((id) => typeof id === "number"));
    const newer = toRoomHistory(roomId, data.messages).filter(
      (m) => m.msgId === undefined || !known.has(m.msgId),
    );
    if (newer.length > 0) roomMessages.value[roomId] = [...box, ...newer];
  } else if (data.type === "room_search_result") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const current = roomSearch.value[roomId];
    // 응답 대기 중 검색어가 바뀌었거나 검색을 닫았으면 버린다
    if (!current || current.keyword !== String(data.keyword ?? "")) return;
    roomSearch.value[roomId] = {
      keyword: current.keyword,
      ids: (Array.isArray(data.ids) ? data.ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
      loading: false,
      truncated: data.truncated === true,
    };
  } else if (data.type === "room_message") {
    const roomId = Number(data.roomId);
    if (!Number.isInteger(roomId)) return;
    const from = String(data.from ?? data.nickname ?? "");
    // 서버는 실시간 메시지의 발신자 번호를 from_no 로 보낸다 (히스토리는 user_no)
    const fromNo = Number(
      toNo((data as { from_no?: unknown }).from_no) ?? userNoOf(data as unknown) ?? 0,
    );
    const msg: ChatMessage = {
      type: "room",
      user_no: fromNo,
      nickname: from,
      text: String(data.text ?? ""),
      timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      roomId,
      msgId: typeof data.msgId === "number" ? data.msgId : undefined,
      unreadCount:
        typeof data.unreadCount === "number" ? data.unreadCount : 0,
      file: toChatAttachment((data as { file?: unknown }).file),
    };
    // 검색 점프로 과거 구간을 보는 중이면 사이가 비어 있으므로 붙이지 않는다
    // (아래로 스크롤하거나 '맨 아래로'를 누르면 서버에서 다시 받아온다)
    if (roomHasNewer.value[roomId] !== true) ensureRoomBox(roomId).push(msg);
    // 안읽은 건수는 서버 신호(unread_bump)가 진실이므로 여기서 증가시키지 않는다.
    // '내 채팅방' 목록 미리보기/시간 즉시 갱신 (다음 my_rooms 수신 때 DB 값으로 재확정)
    const room = myRooms.value.find((r) => r.roomId === roomId);
    if (room) {
      room.lastMessage = msg.file ? attachmentPreviewText(msg.file) : msg.text;
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
    if (Array.isArray(data.memberProfiles)) {
      roomMembers.value[roomId] = data.memberProfiles
        .map(memberOf)
        .filter((m) => m.user_no > 0);
    } else {
      roomMembers.value[roomId] = Array.isArray(data.members)
        ? data.members
            .map((m) => ({ user_no: Number(userNoOf(m) ?? 0), nickname: "" }))
            .filter((m) => m.user_no > 0)
        : [];
    }
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
  } else if (data.type === "room_rename_failed") {
    // 방제목 수정 실패 사유를 상태로 보관해 모달이 알릴 수 있게 한다.
    const roomId = Number(data.roomId);
    roomRenameError.value = {
      roomId: Number.isInteger(roomId) ? roomId : 0,
      reason: String(data.reason ?? "failed"),
    };
  } else if (data.type === "unread_state") {
    // 접속 시 서버 DB에서 내려온 안읽은 건수 전체를 그대로 적용한다.
    // (로그아웃/다른 PC에서 로그인해도 서버에 남은 값이 복원된다)
    const room: Record<number, number> = {};
    for (const [key, count] of Object.entries(data.unread?.room ?? {})) {
      const id = Number(key);
      const n = Number(count);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(n) && n > 0) {
        room[id] = Math.floor(n);
      }
    }
    // 재접속으로 복원되는 값 중 "지금 보고 있는(포커스된) 방"은 이미 읽은 것으로 본다.
    // 복원 배열에서 먼저 빼고(아래에서 통째로 교체) 서버 DB에도 0으로 되돌린다.
    Object.keys(room).forEach((key) => {
      const roomId = Number(key);
      if (!isRoomFocused(roomId)) return;
      delete room[roomId];
      clearRoomUnread(roomId);
    });
    roomUnread.value = room;
  } else if (data.type === "unread_bump") {
    // 실시간 수신: 서버가 DB에 증가시켜 둔 값을 화면에 +1 반영한다.
    // 단, 해당 방이 focus 중이면 "보고 있는 중"이므로 건수를 올리지 않고 0으로 되돌린다.
    // (서버에 unread_clear를 보내므로 DB도 0이 되어 재접속 시에도 배지가 안 살아난다)
    if (data.scope !== "room") return;
    const roomId = Number(data.target);
    if (!Number.isInteger(roomId) || roomId <= 0) return;
    if (isRoomFocused(roomId)) {
      clearRoomUnread(roomId);
      return;
    }
    roomUnread.value[roomId] = (roomUnread.value[roomId] ?? 0) + 1;
  } else if (data.type === "read_ack") {
    // 카톡식 읽음 숫자의 실시간 갱신.
    // 누군가 대화를 읽으면 서버가 그 대화의 최신 커서 맵 + 참여자 목록을 보내고,
    // 우리는 이미 화면에 있는 메시지 중 "내 메시지"의 숫자만 다시 계산한다.
    applyReadAck(
      data.scope,
      String(data.target ?? ""),
      data.cursors,
      data.members,
    );
  }
};

/** read_ack 이 실어 온 커서 맵을 파싱 ({user_no: lastReadId}) */
const parseCursors = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    const no = toNo(key);
    if (no != null && Number.isFinite(n)) out[String(no)] = Math.max(0, Math.floor(n));
  }
  return out;
};

/**
 * 읽음 커서(각 사용자가 어디까지 읽었는지)로 안 읽은 사람 수를 다시 계산한다.
 * 발신자 자신은 세지 않고, 커서가 메시지 id 보다 작은 사람만 센다.
 * (서버 db.js 의 countUnreadForMessage 와 같은 규칙 — 규칙이 달라지면 숫자가 어긋난다)
 *
 * '지금 보고 있는 나'를 따로 빼지 않는다. 읽음 커서가 그 역할을 대신한다.
 *   - focus 상태: focus 시 unread_clear 를 보내 커서가 이미 앞서 있어 자동으로 빠진다.
 *   - blur 상태 : 커서가 뒤처져 그대로 집계된다. (안 읽었으니 세는 게 맞다)
 *   예) 3명 방에서 A 발신 → B 채팅창 blur, C 미열람 → 양쪽 화면 '2' → B focus → '1'
 *
 * msgId 를 모르면(구버전 서버/필드 누락) 숫자를 셀 수 없다.
 * 이때 0 을 돌려주면 "안 읽은 사람 있음 → 0" 으로 잘못 덮어써져 숫자가 한 번에 사라진다.
 * 따라서 null 을 돌려 "계산 불가"를 알리고, 호출부가 기존 값을 유지하게 한다.
 */
const countUnread = (
  cursors: Record<string, number>,
  participants: Array<ChatUser>,
  senderNo: number,
  msgId?: number,
): number | null => {
  const id = typeof msgId === "number" ? msgId : 0;
  if (!id) return null;
  let n = 0;
  for (const raw of participants) {
    const no = Number(userNoOf(raw) ?? 0);
    if (!no || no === senderNo) continue;
    if ((cursors[String(no)] ?? 0) < id) n += 1;
  }
  return n;
};

/**
 * read_ack 처리: 해당 대화 박스의 메시지 숫자를 갱신한다.
 * 카톡식 읽음 숫자는 내 메시지뿐 아니라 상대 메시지(message-other)에도 붙으므로
 * 박스 안의 모든 메시지를 다시 계산한다.
 *   - 내 메시지   : 상대가 안 읽은 인원
 *   - 상대 메시지 : 아직 안 읽은 인원 (blur 중이면 '나'도 포함 → focus 하면 빠진다)
 * 읽음이 반영되면 숫자는 줄기만 하므로(단조 감소) 그대로 덮어써도 안전하다.
 *
 * 단, 계산에 필요한 값(참여자 목록 / 메시지 id)이 없으면 기존 숫자를 그대로 둔다.
 * (값이 없다는 이유로 0 으로 덮어쓰면 숫자가 한 번에 사라지는 버그가 된다)
 */
const applyReadAck = (
  scope: unknown,
  target: string,
  rawCursors: unknown,
  rawMembers?: unknown,
) => {
  if (scope !== "room" || !target) return;
  const roomId = Number(target);
  if (!Number.isInteger(roomId)) return;
  const box = roomMessages.value[roomId];
  if (!box) return;
  const cursors = parseCursors(rawCursors);
  // read_ack 가 실어 온 참여자 목록을 우선 사용한다(항상 최신).
  const ackMembers = Array.isArray(rawMembers)
    ? rawMembers
        .map((m) => ({ user_no: Number(userNoOf(m) ?? 0), nickname: nickOf(m) }))
        .filter((m) => m.user_no > 0)
    : [];
  const members = ackMembers.length > 0
    ? ackMembers
    : (roomMembers.value[roomId] ?? []);
  // 참여자 목록을 아예 모르면 재계산하지 않고 기존 숫자를 유지한다.
  if (members.length === 0) return;
  box.forEach((m) => {
    // 내 메시지뿐 아니라 상대 메시지(message-other)도 갱신한다.
    // (상대 메시지 옆 숫자가 실시간으로 줄어들어야 한다)
    const next = countUnread(cursors, members, Number(m.user_no ?? 0), m.msgId);
    if (next === null) return; // id 모르면 기존 값 유지
    m.unreadCount = next;
  });
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
    // 응답을 못 받은 "이전 대화 불러오는 중" 표시가 남지 않게 푼다
    roomLoadingOlder.value = {};
    roomLoadingNewer.value = {};
    // 검색 응답도 더는 오지 않으므로 '검색 중' 표시를 푼다 (결과가 이미 온 검색은 유지)
    for (const [rid, s] of Object.entries(roomSearch.value)) {
      if (s.loading) delete roomSearch.value[Number(rid)];
    }
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

/**
 * '사용자' 탭에서 상대를 눌러 1:1 창을 열기 위한 요청.
 * 서버가 "있다면 그대로, 없으면 생성"으로 방을 확보한 뒤 방 번호를 돌려준다.
 * 실패/응답 없음 시 null 을 돌려주고 호출부가 창을 열지 않는다.
 */
const requestOneToOneRoom = (peerNo: number): Promise<number | null> => {
  if (!Number.isInteger(peerNo) || peerNo <= 0) return Promise.resolve(null);
  const socket = ws;
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.resolve(null);
  // 같은 상대를 연속으로 누른 경우 먼저 걸린 요청은 무시한다(창이 2개 뜨지 않도록)
  pendingOneToOne.delete(peerNo);
  return new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingOneToOne.delete(peerNo);
      resolve(null);
    }, 5000);
    pendingOneToOne.set(peerNo, (roomId) => {
      clearTimeout(timer);
      resolve(roomId);
    });
    try {
      socket.send(JSON.stringify({ type: "dm_room_open", withUserNo: peerNo }));
    } catch {
      clearTimeout(timer);
      pendingOneToOne.delete(peerNo);
      resolve(null);
    }
  });
};

// 번호방 액션 (메인 창의 단일 소켓으로 전송)
// 신 규격: memberNos(number[]) — 서버가 스냅샷으로 방제를 만든다.
const createRoomAction = (members: Array<number | ChatUser> = []): boolean => {
  const cleanMembers = Array.isArray(members)
    ? members
        .map((m) => Number(userNoOf(m) ?? 0))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== myUserNo.value)
    : [];
  const uniq = [...new Set(cleanMembers)].slice(0, 50);
  if (uniq.length === 0) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(
    JSON.stringify({
      type: "room_create",
      memberNos: uniq,
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

// 번호방: 사용자별 방제목 수정.
// 서버가 room_members.display_name의 "내 행"만 고치므로 같은 방의 다른 멤버는
// 영향을 받지 않는다. (1:1방/단체방 구분 없이 동일하게 동작한다)
const renameRoom = (roomId: number, title: string): boolean => {
  const trimmed = title.trim().slice(0, ROOM_TITLE_INPUT_MAX_LENGTH);
  if (!Number.isInteger(roomId) || !trimmed) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  roomRenameError.value = null;
  ws.send(JSON.stringify({ type: "room_rename", roomId, title: trimmed }));
  return true;
};

// ─── 번호방: 초대 (메인 창의 단일 소켓으로 전송) ───
// 채팅창/목록에서 고른 대상 user_no를 방에 추가해 달라고 서버에 요청한다.
// 서버는 멤버 추가 + 초대받은 멤버의 제목 기본값(닉네임 나열)을 DB에 저장한다.
const sendRoomInvite = (roomId: number, memberNos: number[]): boolean => {
  const uniq = [...new Set(
    (Array.isArray(memberNos) ? memberNos : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0),
  )].slice(0, 50);
  if (!Number.isInteger(roomId) || roomId <= 0 || uniq.length === 0) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_invite", roomId, memberNos: uniq }));
  return true;
};

const sendRoom = (roomId: number, text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed === "" || !Number.isInteger(roomId)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_message", roomId, text: trimmed }));
  return true;
};

// 첨부파일 메시지: 먼저 HTTP 로 업로드해 받은 fileId 를 방에 붙여 달라고 요청한다
const sendRoomFile = (roomId: number, fileId: string): boolean => {
  if (!Number.isInteger(roomId) || !fileId) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_message", roomId, fileId }));
  return true;
};

// ─── 채팅창 열람: DB 최신 한 페이지 조회 요청 ───
// 채팅창이 열릴 때마다 호출하며, 서버는 history_room으로 최신 한 페이지(30건)를 내려준다
// (수신 시 해당 박스를 덮어쓴다). 1:1도 방이므로 같은 경로를 쓴다.
const requestRoomHistory = (roomId: number): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_history", roomId }));
  return true;
};

// ─── 채팅창 이전 대화 더보기 ───
// 지금 들고 있는 가장 오래된 msgId 를 커서(beforeId)로 보내면
// 서버가 history_room_older 로 그 이전 한 페이지를 내려준다 (수신 시 배열 앞에 붙인다).
// 불러오는 중이거나 더 이전 대화가 없으면 보내지 않는다.
const requestOlderMessages = (roomId: number): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  if (roomLoadingOlder.value[roomId] || roomHasMore.value[roomId] !== true) return false;
  const oldest = (roomMessages.value[roomId] ?? []).find((m) => typeof m.msgId === "number");
  if (!oldest?.msgId) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_history_older", roomId, beforeId: oldest.msgId }));
  roomLoadingOlder.value[roomId] = true;
  return true;
};

// ─── 채팅창 메시지 검색 ───
// 서버가 방 전체(초대 이후)에서 본문 포함 검색을 해 room_search_result 로 매칭 msgId 목록을 내려준다.
// 빈 검색어는 검색 해제.
const SEARCH_KEYWORD_MAX = 50;
const clearRoomSearch = (roomId: number) => {
  if (roomSearch.value[roomId]) delete roomSearch.value[roomId];
};
const requestRoomSearch = (roomId: number, keyword: string): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  const kw = keyword.trim().slice(0, SEARCH_KEYWORD_MAX);
  if (kw === "") {
    clearRoomSearch(roomId);
    return true;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_search", roomId, keyword: kw }));
  roomSearch.value[roomId] = { keyword: kw, ids: [], loading: true, truncated: false };
  return true;
};

// 검색 결과 점프: msgId 를 가운데 둔 한 페이지를 요청한다 (history_room_around 로 박스를 덮어쓴다)
const requestMessagesAround = (roomId: number, msgId: number): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  if (!Number.isInteger(msgId) || msgId <= 0) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_history_around", roomId, msgId }));
  return true;
};

// 점프 후 아래로 스크롤: 지금 들고 있는 가장 최근 msgId 이후 한 페이지 (뒤에 이어 붙인다)
const requestNewerMessages = (roomId: number): boolean => {
  if (!Number.isInteger(roomId) || roomId <= 0) return false;
  if (roomLoadingNewer.value[roomId] || roomHasNewer.value[roomId] !== true) return false;
  const newest = [...(roomMessages.value[roomId] ?? [])]
    .reverse()
    .find((m) => typeof m.msgId === "number");
  if (!newest?.msgId) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "room_history_newer", roomId, afterId: newest.msgId }));
  roomLoadingNewer.value[roomId] = true;
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
    if (loginId.value) {
      socket.send(JSON.stringify({ type: "join", loginId: loginId.value, password: loginPassword }));
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

// 첫 화면(아이디 입력)에서 호출하는 연결 함수
export const LOGIN_ID_RE = /^[A-Za-z0-9]{1,20}$/;
const connect = (loginIdInput: string, password: string): boolean => {
  const trimmed = loginIdInput.trim();
  if (!LOGIN_ID_RE.test(trimmed)) {
    joinError.value = "아이디는 영문+숫자, 최대 20자입니다.";
    return false;
  }
  joinError.value = "";
  const loginChanged = loginId.value !== "" && loginId.value !== trimmed;
  loginId.value = trimmed;
  loginPassword = password;
  nickname.value = "";
  myUserNo.value = null;
  // 서버도 join 시 기본값(online)으로 되돌리므로 화면 상태를 맞춘다
  myStatus.value = DEFAULT_MY_STATUS;
  if (loginChanged) {
    myRooms.value = [];
    roomMessages.value = {};
    roomUnread.value = {};
    roomMembers.value = {};
    roomHasMore.value = {};
    roomLoadingOlder.value = {};
    roomHasNewer.value = {};
    roomLoadingNewer.value = {};
    roomSearch.value = {};
  }
  // 안읽은 건수는 서버 DB가 진실이므로 여기서 복원하지 않는다.
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
    socket.send(JSON.stringify({ type: "join", loginId: loginId.value, password: loginPassword }));
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
// login_id(불변) + nickname + phone + user_name + 탈퇴여부
const upsertUser = (
  targetLoginId: string,
  targetNickname: string,
  isDeleted: boolean,
  phone?: string | null,
  userName?: string | null,
  deptNo?: number | null,
): boolean => {
  if (!isAdmin()) return false;
  const id = targetLoginId.trim();
  const nick = targetNickname.trim().slice(0, 20);
  if (!LOGIN_ID_RE.test(id) || !nick) {
    userUpsertResult.value = "아이디는 영문+숫자(최대20), 닉네임은 최대20자입니다.";
    return false;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  userUpsertResult.value = "";
  ws.send(
    JSON.stringify({
      type: "user_upsert",
      loginId: id,
      nickname: nick,
      isDeleted,
      phone: phone ?? null,
      userName: userName ?? null,
      deptNo: deptNo ?? null,
    })
  );
  return true;
};

// ─── 부서 관리: 추가/수정/미사용 (admin 전용) ───
// deptNo 없으면 신규, 있으면 수정 (deptCode는 신규 시에만 사용)
const upsertDept = (payload: {
  deptNo?: number | null;
  deptCode: string;
  deptName: string;
  sortOrder: number;
  isDeleted: boolean;
}): boolean => {
  if (!isAdmin()) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "dept_upsert", ...payload }));
  return true;
};

// ─── 닉네임 변경 (본인 + admin) ───
const renameUser = (targetNo: number, newNickname: string): boolean => {
  const no = Number(targetNo);
  const nick = newNickname.trim().slice(0, 20);
  if (!Number.isInteger(no) || no <= 0 || !nick) {
    userRenameResult.value = "닉네임을 입력하세요. (최대 20자)";
    return false;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  userRenameResult.value = "";
  ws.send(JSON.stringify({ type: "user_rename", targetUserNo: no, newNickname: nick }));
  return true;
};

// ─── 프로필 이미지 변경/초기화 (본인) ───
// fileId = uploadAttachment 로 올린 이미지 키, null = 기본 이미지로 초기화
const setProfileImage = (fileId: string | null): boolean => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "profile_image_set", fileId }));
  return true;
};

// ─── 비밀번호 변경 (본인) ───
// 새 비밀번호 규칙(8~50자, 영문+숫자)은 서버에서도 검사한다
export const isValidNewPassword = (v: string) => v.length >= 8 && v.length <= 50 && /[A-Za-z]/.test(v) && /\d/.test(v);
const changePassword = (currentPassword: string, newPassword: string): boolean => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  pendingNewPassword = newPassword;
  ws.send(JSON.stringify({ type: "password_change", currentPassword, newPassword }));
  return true;
};

// ─── 비밀번호 초기화 (본인 + admin) ───
// targetNo 생략 시 본인. 아이디 + 전화번호 뒤 4자리로 되돌린다.
const resetPassword = (targetNo?: number): boolean => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(targetNo == null ? { type: "password_reset" } : { type: "password_reset", targetUserNo: targetNo }));
  return true;
};

// 내 비밀번호가 바뀌면 재연결용 값과 "비밀번호 저장" 값을 함께 갱신한다
function applyNewPassword(next: string) {
  loginPassword = next;
  const saved = loadSavedLogin();
  if (saved && saved.loginId === loginId.value) saveLogin({ loginId: saved.loginId, password: next });
}

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
  pendingOneToOne.clear();
  myRooms.value = [];
  roomMessages.value = {};
  roomUnread.value = {};
  roomMembers.value = {};
  roomHasNewer.value = {};
  roomLoadingNewer.value = {};
  roomSearch.value = {};
  // 창들이 모두 닫히므로 "보고 있는 방" 상태도 비운다.
  focusedRooms.value = {};
};

/**
 * 채팅 소켓 싱글톤에 접근한다.
 * 호출할 때마다 같은 윈도우 안에서는 동일한 상태 객체를 반환하므로,
 * 메인 창에서 만든 연결을 같은 탭의 다른 라우트에서도 그대로 공유할 수 있다.
 */
export function useChatSocket() {
  return {
    loginId,
    myUserNo,
    nickname,
    isConnected,
    connectionStatus,
    myStatus,
    setMyStatus,
    userlist,
    onlineUsers,
    userStatuses,
    statusEmojiOf,
    statusTextOf,
    usersDetail,
    depts,
    deptUpsertResult,
    upsertDept,
    joinError,
    userUpsertResult,
    userRenameResult,
    roomRenameError,
    isAdmin,
    myRooms,
    roomMessages,
    roomUnread,
    roomMembers,
    roomHasMore,
    roomLoadingOlder,
    roomHasNewer,
    roomLoadingNewer,
    roomSearch,
    findOneToOneRoomId,
    oneToOnePeerOfRoom,
    // 채팅창 focus 상태 (안읽은 건수를 잡지 않을 대상 판정용)
    focusedRooms,
    isRoomFocused,
    setRoomFocus,
    forgetRoomFocus,
    connect,
    attemptReconnect,
    manualReconnect,
    disconnect,
    clearRoomUnread,
    createRoom: createRoomAction,
    joinRoom,
    leaveRoom,
    deleteRoom,
    refreshRooms,
    renameRoom,
    sendRoomInvite,
    sendRoom,
    sendRoomFile,
    requestOneToOneRoom,
    requestRoomHistory,
    requestOlderMessages,
    requestNewerMessages,
    requestMessagesAround,
    requestRoomSearch,
    clearRoomSearch,
    upsertUser,
    renameUser,
    myProfileImage,
    profileImageResult,
    setProfileImage,
    passwordResult,
    changePassword,
    resetPassword,
  };
}
