<script setup lang="ts">
defineProps<{
  myNickname: string;
  users: string[];
  unreadCounts: Record<string, number>;
  connectionStatus: string;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "open-chat", user: string): void;
  (e: "reconnect"): void;
  (e: "disconnect"): void;
}>();
</script>

<template>
  <div class="userlist-screen">
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

    <h2 class="list-title">접속자 목록 ({{ users.length }}명)</h2>
    <p v-if="users.length === 0" class="empty">현재 접속한 다른 사용자가 없습니다.</p>
    <ul class="user-list">
      <li
        v-for="user in users"
        :key="user"
        class="user-item"
        @dblclick="$emit('open-chat', user)"
        :title="'더블클릭하여 ' + user + '님과 1:1 채팅'"
      >
        <span class="avatar">{{ user.slice(0, 1) }}</span>
        <span class="name">{{ user }}</span>
        <span v-if="(unreadCounts[user] ?? 0) > 0" class="badge">
          {{ unreadCounts[user] }}
        </span>
        <span class="hint">더블클릭 → 1:1 채팅</span>
      </li>
    </ul>
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
.hint {
  font-size: 11px;
  color: #999;
}
</style>
