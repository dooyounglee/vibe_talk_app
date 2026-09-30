<script setup lang="ts">
import type { ChatMessage } from "../types/chat";

defineProps<{
  messages: ChatMessage[];
  nickname: string;
}>();
</script>

<template>
  <div class="messages">
    <div
      v-for="(msg, index) in messages"
      :key="index"
      :class="{
        'message-self': msg.nickname == nickname,
        'message-other': msg.nickname !== nickname
      }"
    >
      <div class="message-content">
        <span class="nickname" v-if="msg.nickname !== nickname">[{{ msg.nickname }}]</span>
        {{ msg.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.message-self {
  align-self: flex-end;
  background-color: #d1e7dd;
  padding: 10px 15px;
  border-radius: 15px;
  max-width: 70%;
  color: #000;
}

.message-other {
  align-self: flex-start;
  background-color: #f8d7da;
  padding: 10px 15px;
  border-radius: 15px;
  max-width: 70%;
  color: #000;
}

.message-content {
  word-break: break-word;
}

.nickname {
  font-weight: bold;
  margin-right: 5px;
}
</style>
