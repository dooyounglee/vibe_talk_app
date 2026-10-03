<script setup lang="ts">
import { ref } from "vue";
import type { RoomInfo } from "../types/chat";
import { roomDisplayName } from "../types/chat";

defineProps<{
  myNickname: string;
  rooms: RoomInfo[];
  unread: Record<number, number>;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "open-room", roomId: number): void;
  (e: "request-create"): void;
  (e: "join-room", roomId: number): void;
  (e: "leave-room", roomId: number): void;
  (e: "delete-room", roomId: number): void;
  (e: "refresh"): void;
}>();

// '내 채팅방 (n개)' 우측 더보기 메뉴 상태
const showMenu = ref(false);

const toggleMenu = (e: MouseEvent) => {
  e.stopPropagation();
  showMenu.value = !showMenu.value;
};

const closeMenu = () => {
  showMenu.value = false;
};
</script>

<template>
  <div class="room-screen" @click="closeMenu">
    <div class="list-header-row">
      <h2 class="list-title">내 채팅방 ({{ rooms.length }}개)</h2>
      <div class="more-wrap">
        <button class="more-btn" title="더보기" :disabled="!isConnected" @click="toggleMenu">⋮</button>
        <div v-if="showMenu" class="ctx-menu" @click.stop>
          <button :disabled="!isConnected" @click="$emit('request-create'); closeMenu();">방 만들기</button>
        </div>
      </div>
    </div>

    <p v-if="rooms.length === 0" class="empty">속한 방이 없습니다. 방을 만드세요.</p>
    <ul class="room-list">
      <li v-for="room in rooms" :key="room.roomId" class="room-item" @dblclick="$emit('open-room', room.roomId)">
        <span class="room-id">#{{ room.roomId }}</span>
        <span class="room-main">
          <span class="room-name">{{ roomDisplayName(room) }}</span>
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
.list-header-row { display: flex; align-items: center; justify-content: space-between; }
.list-title { font-size: 16px; margin: 4px 0 0; }
.more-wrap { position: relative; }
.more-btn {
  border: 1px solid #ddd; background: #fff; border-radius: 6px;
  width: 28px; height: 28px; cursor: pointer; font-size: 16px; line-height: 1; color: #555;
}
.more-btn:hover { background: #f0f0f0; }
.more-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ctx-menu {
  position: absolute; right: 0; top: 32px;
  display: flex; flex-direction: column; min-width: 140px;
  background: #fff; border: 1px solid #ddd; border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); z-index: 1000; overflow: hidden;
}
.ctx-menu button {
  padding: 10px 14px; font-size: 14px; border: none;
  background: #fff; cursor: pointer; text-align: left;
}
.ctx-menu button:hover { background: #f2f7ff; }
.ctx-menu button:disabled { opacity: 0.5; cursor: not-allowed; }
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
