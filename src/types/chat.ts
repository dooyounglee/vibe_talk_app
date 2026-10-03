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
}

/** 방 표시 제목: displayName 우선, 없으면 name */
export function roomDisplayName(room: RoomInfo): string {
  const d = room.displayName?.trim();
  return d ? d : room.name;
}

