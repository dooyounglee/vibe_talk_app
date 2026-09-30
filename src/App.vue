<script setup lang="ts">
import { ref, watch } from "vue";
import ChatWindow from "./components/ChatWindow.vue";
import NicknameView from "./components/NicknameView.vue";
import UserListView from "./components/UserListView.vue";
import { useChatSocket } from "./composables/useChatSocket";

const {
  nickname,
  isConnected,
  connectionStatus,
  dmMessages,
  unreadCounts,
  userlist,
  connect,
  manualReconnect,
  disconnect,
  sendDm,
  clearUnread,
} = useChatSocket();

// 화면 상태: false = 1번 화면(닉네임 입력), true = 2번 화면(사용자 목록)
const entered = ref(false);
// 열려 있는 1:1 채팅창 목록 (3번 화면)
const openChats = ref<Array<string>>([]);

const handleNicknameSubmit = (value: string) => {
  const ok = connect(value);
  if (ok) {
    entered.value = true;
  }
};

const handleOpenChat = (user: string) => {
  if (!openChats.value.includes(user)) {
    openChats.value.push(user);
  }
  clearUnread(user);
};

const handleCloseChat = (user: string) => {
  openChats.value = openChats.value.filter((peer) => peer !== user);
};

const handleSendChat = (peer: string, text: string) => {
  sendDm(peer, text);
};

const handleLeave = () => {
  disconnect();
  entered.value = false;
  openChats.value = [];
};

// 새 DM이 오면 자동으로 1:1 창을 띄우고, 이미 열려 있으면 읽음 처리
watch(
  unreadCounts,
  (counts) => {
    for (const peer of Object.keys(counts)) {
      const count = counts[peer] ?? 0;
      if (count > 0 && !openChats.value.includes(peer)) {
        openChats.value.push(peer);
      }
    }
  },
  { deep: true },
);

watch(
  openChats,
  (peers) => {
    for (const peer of peers) {
      clearUnread(peer);
    }
  },
  { deep: true },
);
</script>

<template>
  <!-- 1번 화면: 닉네임 입력 -->
  <NicknameView
    v-if="!entered"
    :connection-status="connectionStatus"
    :is-connected="isConnected"
    @submit="handleNicknameSubmit"
  />

  <!-- 2번 화면: 사용자 목록 -->
  <template v-else>
    <UserListView
      :my-nickname="nickname"
      :users="userlist"
      :unread-counts="unreadCounts"
      :connection-status="connectionStatus"
      :is-connected="isConnected"
      @open-chat="handleOpenChat"
      @reconnect="manualReconnect"
      @disconnect="handleLeave"
    />

    <!-- 3번 화면: 1:1 채팅창 팝업 -->
    <ChatWindow
      v-for="(peer, index) in openChats"
      :key="peer"
      :peer="peer"
      :my-nickname="nickname"
      :messages="dmMessages[peer] ?? []"
      :offset="index"
      @send="(text) => handleSendChat(peer, text)"
      @close="handleCloseChat(peer)"
    />
  </template>
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}
</style>


