<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ChatWindow from "../components/ChatWindow.vue";
import RenameRoomModal from "../components/RenameRoomModal.vue";
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
  messages, myUserNo, myNickname, roomName, connectionStatus,
  isConnected, hasSession, send, renameRoom, announceClose,
} = useChatRoom(roomId);

// 상단 연필 → 방제목 변경 모달
const showRenameModal = ref(false);
const renameError = ref("");

const openRenameModal = () => {
  renameError.value = "";
  showRenameModal.value = true;
};

const closeRenameModal = () => {
  showRenameModal.value = false;
  renameError.value = "";
};

const handleRename = (title: string) => {
  if (!renameRoom(title)) {
    renameError.value = "방제목을 변경하지 못했습니다. 연결을 확인해주세요.";
    return;
  }
  closeRenameModal();
};

onMounted(() => {
  document.title = roomTitle.value;
});

// 방제목이 바뀌면(목록/다른 창에서 수정해도) 브라우저 탭 제목도 함께 갱신한다.
watch(roomTitle, (t) => {
  document.title = t;
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
    :my-user-no="myUserNo"
    :my-nickname="myNickname"
    :messages="messages"
    :connection-status="connectionStatus"
    :is-connected="isConnected"
    @send="handleSend"
    @close="handleClose"
  >
    <template #header-actions>
      <button
        class="rename-btn"
        title="방제목 변경"
        :disabled="!isConnected"
        @click="openRenameModal"
      >✏</button>
    </template>
  </ChatWindow>

  <!-- 상단 연필로 연 방제목 변경 모달 (로그인 전에는 열리지 않는다) -->
  <RenameRoomModal
    v-if="showRenameModal && hasSession"
    :current-title="roomName"
    :error-reason="renameError"
    @confirm="handleRename"
    @cancel="closeRenameModal"
  />

  <div v-if="!hasSession" class="no-session">
    <p>로그인 정보가 없습니다.<br />메인 창에서 먼저 입장해주세요.</p>
    <div class="btn-row">
      <button class="primary" @click="goHome">메인으로 이동</button>
      <button @click="handleClose">창 닫기</button>
    </div>
  </div>
</template>

<style scoped>
/* 상단 방제목 오른쪽의 연필 버튼 (ChatWindow 헤더 슬롯) */
.rename-btn {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  opacity: 0.9;
}
.rename-btn:hover { background: rgba(255, 255, 255, 0.2); opacity: 1; }
.rename-btn:disabled { opacity: 0.4; cursor: not-allowed; }
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

