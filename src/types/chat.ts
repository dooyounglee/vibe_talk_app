export interface ChatMessage {
  type: string;
  user_no: number;
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
  /** 첨부파일 메시지면 파일 정보 (text 에는 파일명이 들어 있다) */
  file?: ChatAttachment;
}

/** 첨부파일 (서버 POST /upload 로 올리고 GET /files/:id 로 받는다) */
export interface ChatAttachment {
  /** 서버 파일 키 (다운로드 URL 에 쓰인다) */
  id: string;
  name: string;
  /** 바이트 */
  size: number;
  mime: string;
}

/** 이미지 첨부면 채팅창에 바로 보여준다 */
export function isImageAttachment(file?: ChatAttachment | null): boolean {
  return !!file && file.mime.startsWith("image/");
}

/** 파일 크기 표기: 512 B / 1.2 KB / 3.4 MB */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 목록 미리보기 문구 (서버 previewTextOf 와 같은 규칙): 이미지='사진', 그 외='파일: 이름' */
export function attachmentPreviewText(file: ChatAttachment): string {
  return isImageAttachment(file) ? "사진" : `파일: ${file.name}`;
}

/** 서버가 내려준 file 값 → ChatAttachment (형식이 맞지 않으면 undefined) */
export function toChatAttachment(raw: unknown): ChatAttachment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== "string" || f.id === "") return undefined;
  return {
    id: f.id,
    name: typeof f.name === "string" && f.name ? f.name : "file",
    size: typeof f.size === "number" ? f.size : 0,
    mime: typeof f.mime === "string" && f.mime ? f.mime : "application/octet-stream",
  };
}

export interface ChatUser {
  user_no: number;
  nickname: string;
  /** 프로필 이미지 (사용자 목록·방 참여자 목록에서 내려온다, null/없음 = 기본 이미지) */
  profileImage?: ChatAttachment | null;
}

/** 채팅창 메시지 검색 상태 (서버 room_search_result) */
export interface RoomSearchState {
  keyword: string;
  /** 매칭 메시지 msgId 목록 (최신 → 과거 순) */
  ids: number[];
  /** 서버 응답을 기다리는 중 */
  loading: boolean;
  /** 결과가 상한(300건)을 넘어 잘렸는지 */
  truncated: boolean;
}

/** 부서 (admin 설정 > 부서관리). isDeleted = 미사용 */
export interface Department {
  deptNo: number;
  deptCode: string;
  deptName: string;
  sortOrder: number;
  isDeleted: boolean;
  /** 활성 사용자 기준 소속 인원 수 */
  memberCount: number;
}

export interface RoomInfo {
  roomId: number;
  name: string;
  owner_no: number;
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
// status_set으로 서버에 전파되어 다른 사용자에게도 보이고, 이 브라우저에도 저장된다.
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

/**
 * 상태 → 이모티콘 (임시값 — 나중에 수정 가능, 지금은 자리만 확보)
 * 이모지 자체는 다색이라 회색/빨강 등 색상 구분은 각 화면의 CSS
 * (`filter: grayscale` 등)로 보정한다.
 */
export const MY_STATUS_EMOJI: Record<MyStatus, string> = {
  online: "🙂",
  offline: "👻",
  meeting: "📝",
  busy: "🥵",
  away: "🕟",
};

/** 화면 표기: 상태명(이모티콘) — 예) '접속(🙂)' */
export function myStatusText(value: unknown): string {
  const label = myStatusLabel(value);
  return `${label}(${MY_STATUS_EMOJI[normalizeMyStatus(value)]})`;
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

