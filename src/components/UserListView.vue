<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  myNickname: string;
  users: string[];
  onlineUsers: string[];
  unreadCounts: Record<string, number>;
  connectionStatus: string;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "open-chat", user: string): void;
  (e: "create-room-with", user: string): void;
  (e: "reconnect"): void;
  (e: "disconnect"): void;
}>();

// 우클릭/더보기 메뉴 상태 (어느 사용자에 대한 메뉴인지)
const menuUser = ref<string | null>(null);
const menuPos = ref<{ x: number; y: number } | null>(null);

const openMenu = (user: string, x: number, y: number) => {
  menuUser.value = user;
  menuPos.value = { x, y };
};

const closeMenu = () => {
  menuUser.value = null;
  menuPos.value = null;
};

const onContextMenu = (e: MouseEvent, user: string) => {
  e.preventDefault();
  openMenu(user, e.clientX, e.clientY);
};

const onMoreClick = (e: MouseEvent, user: string) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(user, rect.left, rect.bottom + 4);
};

const menuStyle = () => {
  if (!menuPos.value) return {};
  const vw = typeof globalThis.window !== "undefined" ? globalThis.window.innerWidth : 1024;
  return {
    left: Math.min(menuPos.value.x, vw - 180) + "px",
    top: menuPos.value.y + "px",
    position: "fixed" as const,
  };
};
</script>

<template>
  <div class="userlist-screen" @click="closeMenu">
    <div class="userlist-header">
      <div>
        <div class="me">내 닉네임: <strong>{{ myNickname }}</strong></div>
        <div class="status">{{ connectionStatus }}</div>
      </div>
      <div class="header-buttons">
        <button
          v-if="connectionStatus.includes('끊김')"
          class="small-btn primary"
          @click="$emit('reconnect')"
        >
          재연결
        </button>
        <button v-if="isConnected" class="small-btn" @click="$emit('disconnect')">
          나가기
        </button>
      </div>
    </div>

    <h2 class="list-title">사용자 목록 ({{ users.length }}명)</h2>
    <p v-if="users.length === 0" class="empty">등록된 다른 사용자가 없습니다.</p>
    <ul class="user-list">
      <li
        v-for="user in users"
        :key="user"
        class="user-item"
        @dblclick="$emit('open-chat', user)"
        @contextmenu="(e) => onContextMenu(e, user)"
        :title="'더블클릭: ' + user + '님과 1:1 채팅 / 우클릭: 메뉴'"
      >
        <span class="avatar">{{ user.slice(0, 1) }}</span>
        <span class="name">{{ user }}</span>
        <span
          class="presence"
          :class="onlineUsers.includes(user) ? 'online' : 'offline'"
          :title="onlineUsers.includes(user) ? '접속중' : '오프라인'"
        ></span>
        <span v-if="(unreadCounts[user] ?? 0) > 0" class="badge">
          {{ unreadCounts[user] }}
        </span>
        <button
          class="more-btn"
          title="더보기"
          @click="(e) => onMoreClick(e, user)"
        >⋮</button>
        <span class="hint">더블클릭 → 1:1 채팅</span>
      </li>
    </ul>

    <!-- 우클릭 / 더보기 컨텍스트 메뉴 -->
    <div
      v-if="menuUser"
      class="ctx-menu"
      :style="menuStyle()"
      @click.stop
    >
      <button @click="$emit('open-chat', menuUser!); closeMenu();">1:1 채팅하기</button>
      <button @click="$emit('create-room-with', menuUser!); closeMenu();">방 만들기</button>
    </div>
  </div>
</template>

<style scoped>
.userlist-screen {
  height: 100vh;
  height: 100dvh;
  padding: 20px;
  font-family: sans-serif;
  background: #f4f6f8;
  box-sizing: border-box;
  overflow-y: auto;
}
.userlist-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.me {
  font-size: 15px;
}
.status {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}
.header-buttons {
  display: flex;
  gap: 8px;
}
.small-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.small-btn.primary {
  background: #007bff;
  color: #fff;
  border-color: #007bff;
}
.list-title {
  font-size: 16px;
  margin: 0 0 12px;
}
.empty {
  color: #888;
  font-size: 14px;
}
.user-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}
.user-item:hover {
  background: #e9f2ff;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #007bff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}
.name {
  flex: 1;
  font-size: 15px;
  word-break: break-all;
}
.badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #dc3545;
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.presence {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.presence.online { background: #28a745; }
.presence.offline { background: #ccc; }
.hint {
  font-size: 11px;
  color: #999;
}
.more-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #555;
}
.more-btn:hover { background: #f0f0f0; }
.ctx-menu {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}
.ctx-menu button {
  padding: 10px 14px;
  font-size: 14px;
  border: none;
  background: #fff;
  cursor: pointer;
  text-align: left;
}
.ctx-menu button:hover { background: #f2f7ff; }
.ctx-menu button + button { border-top: 1px solid #eee; }
</style>
