<script setup lang="ts">
import ChatSidebar from "./components/ChatSidebar.vue";
import ConnectionBar from "./components/ConnectionBar.vue";
import MessageInput from "./components/MessageInput.vue";
import MessageList from "./components/MessageList.vue";
import { useChatSocket } from "./composables/useChatSocket";

const {
  nickname,
  inputMessage,
  selectedConversation,
  isConnected,
  connectionStatus,
  globalMessages,
  dmMessages,
  userlist,
  attemptReconnect,
  manualReconnect,
  disconnect,
  send,
} = useChatSocket();

// 메시지 필터링 함수 - 현재 선택된 대화에 해당하는 메시지만 반환
const getFilteredMessages = () => {
  if (selectedConversation.value === null) {
    return globalMessages.value;
  } else {
    return dmMessages.value[selectedConversation.value] || [];
  }
};

// select 이벤트로 selectedConversation 갱신 (null이면 전체 채팅방)
const handleSelectConversation = (user: string | null) => {
  selectedConversation.value = user;
};

const handleNicknameUpdate = (value: string) => {
  nickname.value = value;
};
</script>

<template>
  <ChatSidebar
    :userlist="userlist"
    :selectedConversation="selectedConversation"
    @select="handleSelectConversation"
  />

  <div class="chat-container">
    <ConnectionBar
      :connection-status="connectionStatus"
      :nickname="nickname"
      :is-connected="isConnected"
      @update:nickname="handleNicknameUpdate"
      @connect="attemptReconnect"
      @disconnect="disconnect"
      @reconnect="manualReconnect"
    />

    <!-- 중단: 메시지 리스트 -->
    <MessageList :messages="getFilteredMessages()" :nickname="nickname" />

    <!-- 하단: 메시지 입력 -->
    <MessageInput v-if="isConnected" v-model="inputMessage" @send="send" />
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
  margin-left: 200px;
  font-family: sans-serif;
}
</style>

