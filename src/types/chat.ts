export interface ChatMessage {
  type: string;
  nickname: string;
  text: string;
  timestamp?: number;
  roomId?: number;
  /** 서버 messages.id — 읽음 표시(카톡식 '1'/'4') 계산 기준 */
  msgId?: number;
  /**
   * 이 메시지를 아직 안 읽은 사람 수 (카톡의 메시지별 숫자). 0이면 표시하지 않는다.
   * 발신자만 제외하고 센다. 즉 blur 상태면 '나'도 포함되고,
   * focus 해서 읽음 처리(unread_clear)되면 커서가 앞서므로 자동으로 빠진다.
   * 예) 3명 방에서 A 발신 → B 채팅창 blur, C 미열람: A/B 화면 모두 '2' → B focus 후 '1'
   * 내 메시지(message-self)와 상대 메시지(message-other) 모두에 붙는다.
   */
  unreadCount?: number;
}

export interface RoomInfo {
  roomId: number;
  name: string;
  owner: string;
  memberCount: number;
  /** 사용자별 표시 제목 (1:1=상대 닉네임, 3명 이상=전체 참여자 이름 연결, 없으면 name으로 폴백) */
  displayName?: string;
  /** 목록 미리보기용 마지막 메시지 내용 (메시지 없으면 null) */
  lastMessage?: string | null;
  /** 마지막 메시지 시각 (epoch ms, 없으면 null) */
  lastMessageAt?: number | null;
  /** 마지막 메시지 발신자 닉네임 (없으면 null) */
  lastMessageSender?: string | null;
}

// ─── 내 상태 (접속/오프라인/회의중/바쁨/자리비움) ───
// 메인 화면 상단 드롭다운에서 고른다.
// 서버로 보내지 않으므로 다른 사람에게는 보이지 않고, 이 기기에만 저장된다.
export type MyStatus = "online" | "offline" | "meeting" | "busy" | "away";

export const DEFAULT_MY_STATUS: MyStatus = "online";

/** 드롭다운에 노출할 상태 목록 (표시 순서 그대로) */
export const MY_STATUS_OPTIONS: ReadonlyArray<{ value: MyStatus; label: string }> = [
  { value: "online", label: "접속" },
  { value: "offline", label: "오프라인" },
  { value: "meeting", label: "회의중" },
  { value: "busy", label: "바쁨" },
  { value: "away", label: "자리비움" },
];

/**
 * 저장된 값을 유효한 상태로 정규화한다.
 * localStorage에는 문자열이 들어오므로(또는 예전 값/손상 값일 수 있으므로)
 * 목록에 없는 값이면 기본값으로 되돌린다. 덕분에 select에 없는 값이 선택되는 일이 없다.
 */
export function normalizeMyStatus(value: unknown): MyStatus {
  const hit = MY_STATUS_OPTIONS.find((o) => o.value === value);
  return hit ? hit.value : DEFAULT_MY_STATUS;
}

/** 상태 값 → 화면에 보여줄 라벨 (드롭다운 기본값 표기 등) */
export function myStatusLabel(value: unknown): string {
  const v = normalizeMyStatus(value);
  return MY_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? DEFAULT_MY_STATUS;
}

/** 화면 표기: 방 제목 최대 글자 수 (초과분은 "..."로 생략) */
export const ROOM_TITLE_MAX_LENGTH = 20;

/** 방제목 수정 시 입력받을 수 있는 최대 글자 수 (서버 저장 제한과 동일) */
export const ROOM_TITLE_INPUT_MAX_LENGTH = 30;

/**
 * 방 제목 화면 표기용 축약: 20자까지만 보여주고 초과하면 끝에 "..."를 붙인다.
 * (DB/전송 값은 전체 이름을 그대로 쓰고, 이 함수는 표시할 때만 쓴다)
 */
export function truncateRoomTitle(
  title?: string | null,
  maxLength: number = ROOM_TITLE_MAX_LENGTH,
): string {
  const text = (title ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/** 방 표시 제목: displayName 우선, 없으면 name (화면 표시는 20자까지) */
export function roomDisplayName(room: RoomInfo): string {
  const d = room.displayName?.trim();
  return truncateRoomTitle(d ? d : room.name);
}

/**
 * 방제목 원본(미축약 전체값): 수정 모달의 초기값으로 쓴다.
 * 표시용 roomDisplayName은 20자로 잘라서 돌려주므로 편집용으로는 쓸 수 없다.
 */
export function roomRawName(room: RoomInfo): string {
  const d = room.displayName?.trim();
  return (d ? d : room.name ?? "").trim();
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 날짜가 같은지 (연/월/일 기준) */
const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * 채팅방 목록의 마지막 메시지 시각 표기.
 * 오늘: "14:05" / 어제: "어제 14:05" / 올해: "3.14 14:05" / 그 이전: "2024.3.14 14:05"
 * 값이 없으면 빈 문자열.
 */
export function formatRoomTime(timestamp?: number | null): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameDay(date, now)) return time;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `어제 ${time}`;
  if (date.getFullYear() === now.getFullYear())
    return `${date.getMonth() + 1}.${date.getDate()} ${time}`;
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${time}`;
}

/**
 * 채팅방 목록의 마지막 메시지 한 줄 미리보기.
 * "닉네임: 내용" 형태이며, 메시지가 없으면 빈 문자열.
 */
export function roomLastMessagePreview(
  room: RoomInfo,
  myNickname?: string,
): string {
  const text = (room.lastMessage ?? "").trim();
  if (!text) return "";
  const sender = (room.lastMessageSender ?? "").trim();
  if (!sender || sender === myNickname) return text;
  return `${sender}: ${text}`;
}

