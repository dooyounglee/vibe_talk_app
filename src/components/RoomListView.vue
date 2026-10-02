<script setup lang="ts">
import { ref } from "vue";
import type { RoomInfo } from "../types/chat";

defineProps<{
  myNickname: string;
  rooms: RoomInfo[];
  unread: Record<number, number>;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "open-room", roomId: number): void;
  (e: "create-room", name: string): void;
  (e: "join-room", roomId: number): void;
  (e: "leave-room", roomId: number): void;
  (e: "delete-room", roomId: number): void;
  (e: "refresh"): void;
}>();

const newRoomName = ref("");
const joinRoomIdText = ref("");
const error = ref("");

const submitCreate = (emit: (e: "create-room", name: string) => void) => {
  const name = newRoomName.value.trim();
  if (!name) {
    error.value = "방 이름을 입력하세요.";
    return;
  }
  error.value = "";
  emit("create-room", name);
  newRoomName.value = "";
};

const submitJoin = (emit: (e: "join-room", roomId: number) => void) => {
  const id = Number(joinRoomIdText.value.trim());
  if (!Number.isInteger(id) || id <= 0) {
    error.value = "방 번호를 숫자로 입력하세요. (예: 3)";
    return;
  }
  error.value = "";
  emit("join-room", id);
  joinRoomIdText.value = "";
};
</script>

<template>
  <div class="room-screen">
    <div class="room-actions">
      <div class="action-row">
        <input v-model="newRoomName" placeholder="새 방 이름 (예: 가족모임)" maxlength="30" @keyup.enter="submitCreate($emit)" />
        <button class="primary" :disabled="!isConnected || !newRoomName.trim()" @click="submitCreate($emit)">방 만들기</button>
      </div>
      <div class="action-row">
        <input v-model="joinRoomIdText" placeholder="방 번호로 입장 (예: 3)" inputmode="numeric" @keyup.enter="submitJoin($emit)" />
        <button :disabled="!isConnected || !joinRoomIdText.trim()" @click="submitJoin($emit)">입장</button>
        <button class="ghost" :disabled="!isConnected" @click="$emit('refresh')">새로고침</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <h2 class="list-title">내 채팅방 ({{ rooms.length }}개)</h2>
    <p v-if="rooms.length === 0" class="empty">속한 방이 없습니다. 방을 만들거나 번호로 입장하세요.</p>
    <ul class="room-list">
      <li v-for="room in rooms" :key="room.roomId" class="room-item" @dblclick="$emit('open-room', room.roomId)">
        <span class="room-id">#{{ room.roomId }}</span>
        <span class="room-main">
          <span class="room-name">{{ room.name }}</span>
          <span class="room-meta">방장 {{ room.owner }} · {{ room.memberCount }}명</span>
        </span>
        <span v-if="(unread[room.roomId] ?? 0) > 0" class="badge">{{ unread[room.roomId] }}</span>
        <span class="btns">
          <button class="small-btn" @click.stop="$emit('open-room', room.roomId)">열기</button>
          <button class="small-btn" @click.stop="$emit('leave-room', room.roomId)">나가기</button>
          <button v-if="room.owner === myNickname" class="small-btn danger" @click.stop="$emit('delete-room', room.roomId)">삭제</button>
        </span>
      </li>
    </ul>
    <p class="hint">더블클릭 또는 열기 버튼으로 새 창 채팅방을 엽니다.</p>
  </div>
</template>

<style scoped>
.room-screen { display: flex; flex-direction: column; gap: 12px; }
.room-actions { background: #fff; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.action-row { display: flex; gap: 8px; }
.action-row input { flex: 1; padding: 8px 10px; font-size: 14px; border: 1px solid #ddd; border-radius: 8px; }
.action-row button { padding: 8px 12px; font-size: 13px; border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; }
.action-row button.primary { background: #007bff; border-color: #007bff; color: #fff; }
.action-row button.ghost { color: #555; }
.action-row button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: #d33; font-size: 13px; margin: 0; }
.list-title { font-size: 16px; margin: 4px 0 0; }
.empty { color: #888; font-size: 14px; margin: 0; }
.room-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.room-item { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; user-select: none; }
.room-item:hover { background: #e9f2ff; }
.room-id { font-weight: bold; color: #007bff; min-width: 44px; }
.room-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.room-name { font-size: 15px; font-weight: 600; word-break: break-all; }
.room-meta { font-size: 12px; color: #666; }
.badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #dc3545; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.btns { display: flex; gap: 6px; }
.small-btn { padding: 6px 10px; font-size: 12px; border: 1px solid #ddd; border-radius: 6px; background: #fff; cursor: pointer; }
.small-btn.danger { color: #b3261e; border-color: #f5c6cb; }
.hint { font-size: 11px; color: #999; margin: 0; }
</style>
