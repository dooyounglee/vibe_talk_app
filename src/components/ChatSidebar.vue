<script setup lang="ts">
defineProps<{
  userlist: string[];
  selectedConversation: string | null;
}>();

defineEmits<{
  (e: "select", user: string | null): void;
}>();
</script>

<template>
  <!-- 왼쪽 사이드바 -->
  <div class="sidebar">
    <div class="sidebar-header">전체 채팅방</div>
    <div
      class="user-item"
      :class="{ 'selected': selectedConversation === null }"
      @click="$emit('select', null)"
    >
      전체 채팅방
    </div>

    <div class="sidebar-header" style="margin-top: 20px;">접속자 목록</div>
    <div class="user-list">
      <div
        v-for="(user, index) in userlist"
        :key="index"
        class="user-item"
        :class="{ 'selected': selectedConversation === user }"
        @click="$emit('select', user)"
      >
        {{ user }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 200px;
  height: 100vh;
  background-color: #ccc;
  padding: 20px;
  overflow-y: auto;
  box-sizing: border-box;
  z-index: 1000;
}

.sidebar-header {
  font-weight: bold;
  margin-bottom: 15px;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-item {
  padding: 8px 12px;
  background-color: #f0f0f0;
  border-radius: 6px;
  word-break: break-word;
}

.user-item.selected {
  background-color: #d1e7dd !important;
}
</style>
