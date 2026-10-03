<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ChatWindow from "../components/ChatWindow.vue";
import { useChatPeer } from "../composables/useChatPeer";
import { currentChatPeerFromUrl, isTauriRuntime } from "../chatBus";

// 새 윈도우 창으로 열리는 1:1 채팅 전용 페이지 (/chat/:peer)
// WebSocket은 만들지 않는다. 메인 창의 단일 소켓과 이벤트 버스로 주고받는다.
const route = useRoute();
const router = useRouter();

const peer = computed(() => {
  const raw = String(route.params.peer ?? "");
  // vue-router가 ?mainId=... 를 param에 붙이는 경우 분리
  // (#/chat/A?mainId=xxx → peer "A?mainId=xxx" 방지)
  const q = raw.indexOf("?");
  const base = q >= 0 ? raw.slice(0, q) : raw;
  return base || currentChatPeerFromUrl() || "";
});
const {
  messages,
  myNickname,
  connectionStatus,
  isConnected,
  hasSession,
  send,
  announceClose,
} = useChatPeer(peer);

onMounted(() => {
  document.title = peer.value ? `${peer.value}님과의 1:1 채팅` : "1:1 채팅";
});

const handleSend = (text: string) => {
  send(text);
};

const closeTauriWindow = async () => {
  try {
    // 채팅 윈도우에서는 Tauri API로 닫는다. 실패하면 window.close 폴백.
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
      return;
    }
  } catch {
    // 무시하고 아래 폴백으로 진행
  }
  window.close();
};

const handleClose = () => {
  announceClose();
  // Tauri 자식 윈도우는 API로 닫는다 (실패 시 window.close 폴백)
  void closeTauriWindow();
  if (isTauriRuntime()) {
    return;
  }
  // 팝업 차단 등으로 window.close()가 안 먹는 경우 홈으로 복귀
  setTimeout(() => {
    if (!window.closed) {
      void router.replace({ name: "home" });
    }
  }, 100);
};

const goHome = () => {
  void router.replace({ name: "home" });
};
</script>

<template>
  <ChatWindow
    v-if="hasSession"
    :peer="peer"
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
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #f4f6f8;
  font-family: sans-serif;
  text-align: center;
  color: #555;
  font-size: 14px;
}
.btn-row {
  display: flex;
  gap: 8px;
}
.btn-row button {
  padding: 9px 14px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.btn-row button.primary {
  background: #007bff;
  border-color: #007bff;
  color: #fff;
}
</style>
