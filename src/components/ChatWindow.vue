<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { ChatMessage } from "../types/chat";

const props = defineProps<{
  peer: string;
  myNickname: string;
  messages: ChatMessage[];
  connectionStatus: string;
  isConnected: boolean;
}>();

const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "close"): void;
}>();

const draft = ref("");
const bodyRef = ref<HTMLDivElement | null>(null);

const scrollToBottom = async () => {
  await nextTick();
  const el = bodyRef.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
};

const send = () => {
  const text = draft.value.trim();
  if (text === "") return;
  emit("send", text);
  draft.value = "";
  void scrollToBottom();
};

onMounted(() => {
  void scrollToBottom();
});

watch(
  () => props.messages.length,
  () => {
    void scrollToBottom();
  },
);
</script>

<template>
  <div class="chat-screen">
    <div class="chat-window">
      <div class="chat-header">
        <span class="peer">{{ peer }}님과의 1:1 채팅</span>
        <span class="header-actions">
          <!-- 채팅방 상단 연필 등, 창마다 다른 액션 슬롯 -->
          <slot name="header-actions" />
          <button class="close-btn" @click="$emit('close')">✕</button>
        </span>
      </div>
      <div v-if="!isConnected" class="conn-banner">{{ connectionStatus }}</div>
      <div ref="bodyRef" class="chat-body">
        <p v-if="messages.length === 0" class="empty">
          아직 대화가 없습니다. 첫 메시지를 보내보세요.
        </p>
        <div
          v-for="(msg, index) in messages"
          :key="index"
          :class="{
            'message-self': msg.nickname === myNickname,
            'message-other': msg.nickname !== myNickname,
          }"
        >
          <div class="message-content">
            <span class="nickname" v-if="msg.nickname !== myNickname">
              [{{ msg.nickname }}]
            </span>
            {{ msg.text }}
          </div>
        </div>
      </div>
      <div class="chat-footer">
        <input
          v-model="draft"
          placeholder="메시지를 입력하세요"
          @keyup.enter="send"
        />
        <button :disabled="!draft.trim() || !isConnected" @click="send">전송</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-screen {
  height: 100vh;
  height: 100dvh;
  display: flex;
  background: #f4f6f8;
}
.chat-window {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
  font-family: sans-serif;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: #007bff;
  color: #fff;
  font-weight: bold;
}
.close-btn {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
/* 헤더 우측 액션 영역 (슬롯 + 닫기 버튼) */
.header-actions { display: flex; align-items: center; gap: 8px; }
.conn-banner {
  padding: 6px 12px;
  font-size: 12px;
  color: #856404;
  background: #fff3cd;
  border-bottom: 1px solid #ffeeba;
}
.chat-body {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f4f6f8;
}
.empty {
  color: #888;
  font-size: 13px;
  text-align: center;
}
.message-self {
  align-self: flex-end;
  background: #d1e7dd;
  padding: 8px 12px;
  border-radius: 14px;
  max-width: 75%;
}
.message-other {
  align-self: flex-start;
  background: #fff;
  padding: 8px 12px;
  border-radius: 14px;
  max-width: 75%;
  border: 1px solid #eee;
}
.message-content {
  word-break: break-word;
  font-size: 14px;
}
.nickname {
  font-weight: bold;
  margin-right: 4px;
}
.chat-footer {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #eee;
}
.chat-footer input {
  flex: 1;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.chat-footer button {
  padding: 9px 14px;
  font-size: 14px;
  border: none;
  border-radius: 8px;
  background: #007bff;
  color: #fff;
  cursor: pointer;
}
.chat-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

