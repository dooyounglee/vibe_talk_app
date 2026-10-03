<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { RoomInfo } from "../types/chat";
import {
  formatRoomTime,
  roomDisplayName,
  roomLastMessagePreview,
} from "../types/chat";

const props = defineProps<{
  rooms: RoomInfo[];
  unread: Record<number, number>;
  isConnected: boolean;
  myNickname?: string;
}>();

const emit = defineEmits<{
  (e: "open-room", roomId: number): void;
  (e: "request-create"): void;
  (e: "join-room", roomId: number): void;
  (e: "leave-room", roomId: number): void;
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

// ─── 방 개별 컨텍스트 메뉴 (우클릭 / ⋮ 버튼) ───
const MENU_WIDTH = 160;
const MENU_HEIGHT = 96;

const ctxRoomId = ref<number | null>(null);
const ctxPos = ref({ x: 0, y: 0 });

const openRoomMenu = (roomId: number, x: number, y: number) => {
  showMenu.value = false;
  ctxRoomId.value = roomId;
  // 화면 밖으로 나가지 않도록 위치 보정
  ctxPos.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
  };
};

// ⋮ 버튼 클릭 시 버튼 위치 기준으로 열기 (이미 열려 있으면 닫기)
const openRoomMenuFromBtn = (roomId: number, e: MouseEvent) => {
  e.stopPropagation();
  if (ctxRoomId.value === roomId) {
    closeRoomMenu();
    return;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openRoomMenu(roomId, rect.right - MENU_WIDTH, rect.bottom + 4);
};

// 우클릭 시 커서 위치 기준으로 열기
const openRoomMenuFromContext = (roomId: number, e: MouseEvent) => {
  e.stopPropagation();
  openRoomMenu(roomId, e.clientX + 2, e.clientY + 2);
};

const closeRoomMenu = () => {
  ctxRoomId.value = null;
};

const runRoomAction = (
  roomId: number | null,
  type: "open-room" | "leave-room",
) => {
  if (roomId === null) return;
  closeRoomMenu();
  if (type === "open-room") {
    emit("open-room", roomId);
  } else {
    emit("leave-room", roomId);
  }
};

// 메뉴가 열려 있는 동안 스크롤/창 크기 변경/Esc 시 닫는다
const closeAllMenus = () => {
  closeMenu();
  closeRoomMenu();
};

const onDocKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") closeAllMenus();
};

// 컴포넌트 밖(또는 열린 메뉴 밖)을 우클릭하면 열려 있던 메뉴를 닫는다
const rootRef = ref<HTMLElement | null>(null);
const onDocContextmenu = (e: MouseEvent) => {
  if (ctxRoomId.value === null && !showMenu.value) return;
  const target = e.target as Node | null;
  if (!target || !rootRef.value) return;
  const menus = rootRef.value.querySelectorAll(".ctx-menu");
  for (const menu of Array.from(menus)) {
    if (menu.contains(target)) return;
  }
  closeAllMenus();
};

window.addEventListener("scroll", closeAllMenus, true);
window.addEventListener("resize", closeAllMenus);
window.addEventListener("keydown", onDocKeydown);
window.addEventListener("contextmenu", onDocContextmenu, true);
onBeforeUnmount(() => {
  window.removeEventListener("scroll", closeAllMenus, true);
  window.removeEventListener("resize", closeAllMenus);
  window.removeEventListener("keydown", onDocKeydown);
  window.removeEventListener("contextmenu", onDocContextmenu, true);
});
</script>

<template>
  <div ref="rootRef" class="room-screen" @click="closeAllMenus">
    <div class="list-header-row">
      <h2 class="list-title">내 채팅방 ({{ rooms.length }}개)</h2>
      <div class="more-wrap">
        <button class="more-btn" title="더보기" :disabled="!isConnected" @click="toggleMenu">⋮</button>
        <div v-if="showMenu" class="ctx-menu" @click.stop @contextmenu.stop.prevent>
          <button :disabled="!isConnected" @click="$emit('request-create'); closeMenu();">방 만들기</button>
        </div>
      </div>
    </div>

    <p v-if="rooms.length === 0" class="empty">속한 방이 없습니다. 방을 만드세요.</p>
    <ul class="room-list">
      <li
        v-for="room in rooms"
        :key="room.roomId"
        class="room-item"
        @dblclick="$emit('open-room', room.roomId)"
        @contextmenu.prevent="openRoomMenuFromContext(room.roomId, $event)"
      >
        <span class="room-id">#{{ room.roomId }}</span>
        <span class="room-main">
          <span class="room-name">{{ roomDisplayName(room) }}</span>
          <span class="room-meta">방장 {{ room.owner }} · {{ room.memberCount }}명</span>
          <span v-if="roomLastMessagePreview(room, props.myNickname)" class="room-preview">
            {{ roomLastMessagePreview(room, props.myNickname) }}
          </span>
          <span v-else class="room-preview empty-preview">아직 메시지가 없습니다</span>
        </span>
        <span class="room-side">
          <span v-if="formatRoomTime(room.lastMessageAt)" class="room-time">
            {{ formatRoomTime(room.lastMessageAt) }}
          </span>
          <span v-if="(unread[room.roomId] ?? 0) > 0" class="badge">{{ unread[room.roomId] }}</span>
        </span>
        <button
          class="room-more"
          title="옵션"
          @click.stop="openRoomMenuFromBtn(room.roomId, $event)"
        >⋮</button>
      </li>
    </ul>

    <!-- 방 개별 컨텍스트 메뉴: 우클릭 또는 ⋮ 버튼으로 열림 -->
    <div
      v-if="ctxRoomId !== null"
      class="ctx-menu room-ctx"
      :style="{ left: ctxPos.x + 'px', top: ctxPos.y + 'px' }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <button @click="runRoomAction(ctxRoomId, 'open-room')">열기</button>
      <button class="danger" @click="runRoomAction(ctxRoomId, 'leave-room')">나가기</button>
    </div>

    <p class="hint">더블클릭 또는 ⋮ 메뉴(우클릭)로 새 창 채팅방을 엽니다.</p>
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
.ctx-menu button.danger { color: #b3261e; }
/* 방 개별 컨텍스트 메뉴: 뷰포트 기준 고정 위치 */
.ctx-menu.room-ctx { position: fixed; right: auto; min-width: 150px; }
.empty { color: #888; font-size: 14px; margin: 0; }
.room-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.room-item { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; user-select: none; }
.room-item:hover { background: #e9f2ff; }
.room-id { font-weight: bold; color: #007bff; min-width: 44px; }
.room-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.room-name { font-size: 15px; font-weight: 600; word-break: break-all; }
.room-meta { font-size: 12px; color: #666; }
/* 마지막 메시지 미리보기: 한 줄 고정 + 말줄임 */
.room-preview {
  font-size: 12px; color: #444; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.room-preview.empty-preview { color: #aaa; }
/* 우측 열: 마지막 메시지 시간(상단) + 안 읽음 배지(하단) */
.room-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.room-time { font-size: 11px; color: #999; white-space: nowrap; }
.badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #dc3545; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
/* 방 우측 ⋮ 옵션 버튼 */
.room-more {
  border: none; background: transparent; border-radius: 6px;
  width: 26px; height: 26px; cursor: pointer;
  font-size: 16px; line-height: 1; color: #666; opacity: 0.55;
}
.room-more:hover { background: #dcebff; opacity: 1; }
.hint { font-size: 11px; color: #999; margin: 0; }
</style>
