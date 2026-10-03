<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ChatWindow from "../components/ChatWindow.vue";
import { useChatRoom } from "../composables/useChatRoom";
import { currentRoomIdFromUrl, isTauriRuntime } from "../chatBus";

const route = useRoute();
const router = useRouter();

const roomId = computed(() => {
  const raw = route.params.roomId;
  const first = Array.isArray(raw) ? raw[0] : raw;
  // ?mainId=... 가 param에 붙는 경우 분리
  const base = String(first ?? "").split("?")[0];
  const n = Number(base);
  if (Number.isInteger(n) && n > 0) return n;
  return currentRoomIdFromUrl() ?? 0;
});

const roomTitle = computed(() =>
  roomName.value ? `#${roomId.value} ${roomName.value}` : `채팅방 #${roomId.value}`,
);

const {
  messages, myNickname, roomName, connectionStatus,
  isConnected, hasSession, send, announceClose,
} = useChatRoom(roomId);

onMounted(() => {
  document.title = roomTitle.value;
});

const handleSend = (text: string) => {
  send(text);
};

const closeTauriWindow = async () => {
  try {
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
      return;
    }
  } catch { /* 무시 */ }
  window.close();
};

const handleClose = () => {
  announceClose();
  void closeTauriWindow();
  if (isTauriRuntime()) return;
  setTimeout(() => {
    if (!window.closed) void router.replace({ name: "home" });
  }, 100);
};

const goHome = () => {
  void router.replace({ name: "home" });
};
</script>

<template>
  <ChatWindow
    v-if="hasSession"
    :peer="roomTitle"
    :my-nickname="myNickname"
    :messages="messages"
    :connection-status="connectionStatus"
    :is-connected="isConnected"
    @send="handleSend"
    @close="handleClose"
  />
  <div v-else class="no-session">
    <p>로그인 정보가 없습니다.<br />메인 창에서 먼저 입장해주세요.</p>
    <div class="btn-row">
      <button class="primary" @click="goHome">메인으로 이동</button>
      <button @click="handleClose">창 닫기</button>
    </div>
  </div>
</template>

<style scoped>
.no-session {
  height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; background: #f4f6f8;
  font-family: sans-serif; text-align: center;
  color: #555; font-size: 14px;
}
.btn-row { display: flex; gap: 8px; }
.btn-row button {
  padding: 9px 14px; font-size: 14px;
  border: 1px solid #ddd; border-radius: 8px;
  background: #fff; cursor: pointer;
}
.btn-row button.primary { background: #007bff; border-color: #007bff; color: #fff; }
</style>

