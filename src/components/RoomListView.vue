<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { RoomInfo } from "../types/chat";
import {
  formatRoomTime,
  isOneToOneRoom,
  roomDisplayName,
  roomImageOf,
  roomLastMessagePreview,
  roomRawName,
} from "../types/chat";
import ProfileAvatar from "./ProfileAvatar.vue";

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
  (e: "rename-room", roomId: number): void;
  (e: "invite-room", roomId: number): void;
  (e: "refresh"): void;
}>();

// '내 채팅방 (n개)' 우측 더보기 메뉴 상태
const showMenu = ref(false);

// 목록 정렬: 마지막 대화(마지막 메시지 시각)가 가장 최근인 방을 맨 위로.
// 메시지가 한 번도 없던 방(null)은 아래로 내려가고, 시각이 같으면 방 번호 내림차순으로
// 최신 방이 위로 온다. (원본 배열은 건드리지 않아 정렬이 불필요할 때 재계산을 피한다)
const sortedRooms = computed<RoomInfo[]>(() =>
  [...props.rooms].sort((a, b) => {
    const at = typeof a.lastMessageAt === "number" ? a.lastMessageAt : 0;
    const bt = typeof b.lastMessageAt === "number" ? b.lastMessageAt : 0;
    if (at !== bt) return bt - at;
    return b.roomId - a.roomId;
  }),
);

// ─── 채팅방 검색 ───
// 방 제목(축약 전 원본: 1:1=상대 닉네임, 그룹=참여자 이름 연결)을
// 대소문자 무시 부분일치로 찾는다. 정렬은 sortedRooms 순서를 그대로 유지한다.
const keyword = ref("");
const filteredRooms = computed<RoomInfo[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return sortedRooms.value;
  return sortedRooms.value.filter((room) => roomRawName(room).toLowerCase().includes(q));
});

// Esc: 검색어만 지운다 (메뉴 닫기는 전역 keydown 핸들러가 처리)
const clearKeyword = () => {
  keyword.value = "";
};

const toggleMenu = (e: MouseEvent) => {
  e.stopPropagation();
  showMenu.value = !showMenu.value;
};

const closeMenu = () => {
  showMenu.value = false;
};

// ─── 방 개별 컨텍스트 메뉴 (우클릭 / ⋮ 버튼) ───
const MENU_WIDTH = 160;
const MENU_HEIGHT = 170; // 행 4개(열기/방제목 변경/초대/나가기) 기준 높이 여유분

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
  type: "open-room" | "leave-room" | "rename-room" | "invite-room",
) => {
  if (roomId === null) return;
  closeRoomMenu();
  if (type === "open-room") {
    emit("open-room", roomId);
  } else if (type === "rename-room") {
    emit("rename-room", roomId);
  } else if (type === "invite-room") {
    emit("invite-room", roomId);
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

// 열린 메뉴 바깥을 클릭/우클릭하면 메뉴를 닫는다 (컴포넌트 밖 빈 공간 포함).
// 메뉴 자체와 ⋮ 토글 버튼은 각자 처리하므로 제외한다.
const rootRef = ref<HTMLElement | null>(null);
const isInsideMenuOrToggle = (target: Node) => {
  if (!rootRef.value) return false;
  const els = rootRef.value.querySelectorAll(".ctx-menu, .more-btn, .room-more");
  return Array.from(els).some((el) => el.contains(target));
};

const onDocOutside = (e: Event) => {
  if (ctxRoomId.value === null && !showMenu.value) return;
  const target = e.target as Node | null;
  if (!target || isInsideMenuOrToggle(target)) return;
  closeAllMenus();
};

window.addEventListener("scroll", closeAllMenus, true);
window.addEventListener("resize", closeAllMenus);
window.addEventListener("keydown", onDocKeydown);
window.addEventListener("pointerdown", onDocOutside, true);
window.addEventListener("contextmenu", onDocOutside, true);
onBeforeUnmount(() => {
  window.removeEventListener("scroll", closeAllMenus, true);
  window.removeEventListener("resize", closeAllMenus);
  window.removeEventListener("keydown", onDocKeydown);
  window.removeEventListener("pointerdown", onDocOutside, true);
  window.removeEventListener("contextmenu", onDocOutside, true);
});
</script>

<template>
  <div ref="rootRef" class="room-screen">
    <div class="list-header-row">
      <h2 class="list-title">내 채팅방 ({{ rooms.length }}개)</h2>
      <div class="more-wrap">
        <button class="more-btn" title="더보기" :disabled="!isConnected" @click="toggleMenu">⋮</button>
        <div v-if="showMenu" class="ctx-menu" @click.stop @contextmenu.stop.prevent>
          <button :disabled="!isConnected" @click="$emit('request-create'); closeMenu();">방 만들기</button>
        </div>
      </div>
    </div>

    <div v-if="rooms.length > 0" class="search-row">
      <span class="search-icon">🔍</span>
      <input
        v-model="keyword"
        class="search-input"
        type="text"
        placeholder="채팅방 이름, 참여자 검색"
        @keyup.esc="clearKeyword"
      />
      <button v-if="keyword" class="search-clear" title="검색어 지우기" @click.stop="clearKeyword">×</button>
    </div>

    <p v-if="rooms.length === 0" class="empty">속한 방이 없습니다. 방을 만드세요.</p>
    <p v-else-if="filteredRooms.length === 0" class="empty">'{{ keyword.trim() }}' 검색 결과가 없습니다.</p>
    <ul class="room-list">
      <li
        v-for="room in filteredRooms"
        :key="room.roomId"
        class="room-item"
        :class="{ unread: (unread[room.roomId] ?? 0) > 0 }"
        @dblclick="$emit('open-room', room.roomId)"
        @contextmenu.prevent="openRoomMenuFromContext(room.roomId, $event)"
      >
        <ProfileAvatar
          :image="roomImageOf(room)"
          :group="!isOneToOneRoom(room)"
          :size="42"
          :title="`#${room.roomId}`"
        />
        <span class="room-main">
          <span class="room-name">{{ roomDisplayName(room) }}</span>
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
      <button @click="runRoomAction(ctxRoomId, 'rename-room')">방제목 변경</button>
      <button @click="runRoomAction(ctxRoomId, 'invite-room')">초대</button>
      <button class="danger" @click="runRoomAction(ctxRoomId, 'leave-room')">나가기</button>
    </div>

    <p class="hint">
      최신 대화 순으로 정렬됩니다. 더블클릭 또는 ⋮ 메뉴(우클릭)로 새 창 채팅방을 엽니다.
    </p>
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
/* 채팅방 검색창 (UserSearchInput과 동일한 모양) */
.search-row { display: flex; align-items: center; gap: 6px; }
.search-icon { font-size: 13px; flex-shrink: 0; }
.search-input {
  flex: 1; min-width: 0; padding: 8px 10px; font-size: 14px;
  border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box;
}
.search-input:focus { outline: none; border-color: #007bff; }
.search-clear {
  border: none; background: none; color: #999; font-size: 16px;
  line-height: 1; padding: 0 4px; cursor: pointer; flex-shrink: 0;
}
.search-clear:hover { color: #d33; }
.empty { color: #888; font-size: 14px; margin: 0; }
.room-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.room-item { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; user-select: none; }
.room-item:hover { background: #e9f2ff; }
/* 안읽은 메시지가 있는 방: 살짝 진한 배경으로 목록에서 눈에 띈다 */
.room-item.unread { background: #fff8f8; }
.room-item.unread:hover { background: #ffecec; }
.room-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.room-name { font-size: 15px; font-weight: 600; word-break: break-all; }
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
