<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ChatWindow from "../components/ChatWindow.vue";
import CreateRoomModal from "../components/CreateRoomModal.vue";
import RenameRoomModal from "../components/RenameRoomModal.vue";
import ProfileImageModal from "../components/ProfileImageModal.vue";
import { useChatRoom } from "../composables/useChatRoom";
import { currentRoomIdFromUrl, isTauriRuntime } from "../chatBus";
import { canEditRoomImage } from "../types/chat";

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
  messages, myUserNo, myNickname, roomName, ownerNo, connectionStatus,
  isConnected, hasSession, members, users, send, sendFiles, uploading, renameRoom, invite, announceClose,
  hasMore, loadingOlder, loadOlder,
  hasNewer, loadingNewer, loadNewer, loadLatest, searchState, search, jumpTo,
  memberCount, roomImage, roomImageResult, setRoomImage,
} = useChatRoom(roomId);

// 상단 🖼 → 단체방 이미지 설정 모달 (3명 이상 단체방만, 1:1은 상대 프로필 사진을 쓴다)
const canEditImage = computed(() => canEditRoomImage({ memberCount: memberCount.value }));
const showRoomImageModal = ref(false);
const handleApplyRoomImage = (fileId: string | null, done: (sent: boolean) => void) => {
  done(setRoomImage(fileId));
};
// 인원이 줄어 1:1이 되면 열려 있던 모달을 닫는다
watch(canEditImage, (ok) => {
  if (!ok) showRoomImageModal.value = false;
});

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

// 상단 '+' → 초대하기 모달 (방 만들기 모달의 invite 모드 재사용)
const showInviteModal = ref(false);
const inviteError = ref("");

// 초대 대상 제외 목록: 이미 방에 있는 멤버 + 본인
const inviteExcludeNos = computed<number[]>(() => [
  ...members.value.map((u) => u.user_no),
  ...(myUserNo.value !== null ? [myUserNo.value] : []),
]);

const openInviteModal = () => {
  inviteError.value = "";
  showInviteModal.value = true;
};

const closeInviteModal = () => {
  showInviteModal.value = false;
  inviteError.value = "";
};

// 확인 → 소켓이 있는 메인 창으로 bus 경유 전송(메인 창이 서버에 room_invite 보냄)
const handleInvite = (payload: { members: number[] }) => {
  if (!invite(payload.members)) {
    inviteError.value = "초대 요청을 보내지 못했습니다. 연결을 확인해주세요.";
    return;
  }
  closeInviteModal();
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

// 첨부파일 전송 (📎 / 끌어놓기 / Ctrl+V). 실패한 파일이 있으면 채팅창 아래에 문구를 보여준다.
const attachError = ref("");
const handleSendFiles = async (files: File[]) => {
  attachError.value = "";
  const errors = await sendFiles(files);
  if (errors.length > 0) attachError.value = errors.join(" / ");
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
    :members="members"
    :owner-no="ownerNo"
    :has-more="hasMore"
    :loading-older="loadingOlder"
    :has-newer="hasNewer"
    :loading-newer="loadingNewer"
    :search="searchState"
    :uploading="uploading"
    :attach-error="attachError"
    @send="handleSend"
    @send-files="handleSendFiles"
    @dismiss-attach-error="attachError = ''"
    @load-older="loadOlder"
    @load-newer="loadNewer"
    @load-latest="loadLatest"
    @search="search"
    @jump="jumpTo"
    @close="handleClose"
  >
    <template #header-actions>
      <button
        class="invite-btn"
        title="초대"
        :disabled="!isConnected"
        @click="openInviteModal"
      >+</button>
      <button
        v-if="canEditImage"
        class="image-btn"
        title="방 이미지 설정"
        :disabled="!isConnected"
        @click="showRoomImageModal = true"
      >🖼</button>
      <button
        class="rename-btn"
        title="방제목 변경"
        :disabled="!isConnected"
        @click="openRenameModal"
      >✏</button>
    </template>
  </ChatWindow>

  <!-- 상단 '+'로 연 초대 모달 (방 만들기 모달의 invite 모드 재사용) -->
  <CreateRoomModal
    v-if="showInviteModal && hasSession"
    mode="invite"
    :users="users"
    :exclude-nos="inviteExcludeNos"
    :my-nickname="myNickname"
    :my-user-no="myUserNo"
    :error-reason="inviteError"
    @confirm="handleInvite"
    @cancel="closeInviteModal"
  />

  <!-- 상단 연필로 연 방제목 변경 모달 (로그인 전에는 열리지 않는다) -->
  <RenameRoomModal
    v-if="showRenameModal && hasSession"
    :current-title="roomName"
    :error-reason="renameError"
    @confirm="handleRename"
    @cancel="closeRenameModal"
  />

  <!-- 상단 🖼로 연 단체방 이미지 설정 모달 (등록/변경/초기화, 방제목처럼 나에게만 적용) -->
  <ProfileImageModal
    v-if="showRoomImageModal && hasSession && canEditImage"
    title="방 이미지 설정"
    group
    note="변경한 이미지는 나에게만 적용됩니다. 다른 참여자는 원래 이미지를 봅니다."
    :current-image="roomImage"
    :is-connected="isConnected"
    :result="roomImageResult"
    @apply="handleApplyRoomImage"
    @cancel="showRoomImageModal = false"
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
.rename-btn,
.image-btn,
.invite-btn {
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
.rename-btn:hover,
.image-btn:hover,
.invite-btn:hover { background: rgba(255, 255, 255, 0.2); opacity: 1; }
.rename-btn:disabled,
.image-btn:disabled,
.invite-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.no-session {
  height: calc(100vh - var(--titlebar-h, 0px)); height: calc(100dvh - var(--titlebar-h, 0px));
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

