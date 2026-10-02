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
}

