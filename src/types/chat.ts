export interface ChatMessage {
  type: string;
  nickname: string;
  text: string;
  timestamp?: number;
  roomId?: number;
}

export interface RoomInfo {
  roomId: number;
  name: string;
  owner: string;
  memberCount: number;
  /** 사용자별 표시 제목 (1:1=상대 닉네임, 없으면 name으로 폴백) */
  displayName?: string;
  /** 목록 미리보기용 마지막 메시지 내용 (메시지 없으면 null) */
  lastMessage?: string | null;
  /** 마지막 메시지 시각 (epoch ms, 없으면 null) */
  lastMessageAt?: number | null;
  /** 마지막 메시지 발신자 닉네임 (없으면 null) */
  lastMessageSender?: string | null;
}

/** 방 표시 제목: displayName 우선, 없으면 name */
export function roomDisplayName(room: RoomInfo): string {
  const d = room.displayName?.trim();
  return d ? d : room.name;
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

