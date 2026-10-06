<script setup lang="ts">
import { ref, computed } from "vue";
import { MY_STATUS_EMOJI, MY_STATUS_OPTIONS, myStatusText } from "../types/chat";
import type { ChatUser, MyStatus } from "../types/chat";
import type { UserDetail } from "../composables/useChatSocket";
import UserSearchInput from "./UserSearchInput.vue";

const props = defineProps<{
  myUserNo: number | null;
  myNickname: string;
  users: ChatUser[];
  onlineUsers: number[];
  /** 서버가 방송한 사용자별 상태 (user_no → 상태) */
  userStatuses: Record<number, MyStatus>;
  connectionStatus: string;
  isConnected: boolean;
  isAdmin: boolean;
  usersDetail: UserDetail[];
  upsertResult: string;
  renameResult: string;
}>();

const emit = defineEmits<{
  (e: "open-chat", user: ChatUser): void;
  (e: "create-room-with", user: ChatUser): void;
  (e: "reconnect"): void;
  (e: "disconnect"): void;
  (e: "upsert-user", payload: { loginId: string; nickname: string; phone: string | null; userName: string | null; isDeleted: boolean }): void;
  (e: "rename-user", payload: { user_no: number; nickname: string }): void;
}>();

// admin에게 보여줄 목록: 탈퇴 포함 전체, 일반 사용자는 users 그대로
const displayUsers = computed(() => {
  if (props.isAdmin) return props.usersDetail;
  return props.users.map((u) => ({ user_no: u.user_no, loginId: "", nickname: u.nickname, isDeleted: false }));
});

// ─── 사용자 검색 (UserSearchInput 공통컴포넌트) ───
// 검색어가 있으면 컴포넌트가 돌려준 searchResults를, 없으면 전체 목록을 정렬해 보여준다.
const searchKeyword = ref("");
const searchResults = ref<ChatUser[]>([]);
type DisplayUser = (typeof displayUsers.value)[number];
const sortedUsers = computed<DisplayUser[]>(() => {
  // 컴포넌트는 displayUsers를 복제하지 않고 동일 객체를 걸러 돌려주므로
  // 탈퇴(isDeleted) 등 추가 필드도 그대로 살아 있다. (정적 타입만 ChatUser라 단언)
  const base: DisplayUser[] = searchKeyword.value
    ? (searchResults.value as DisplayUser[])
    : displayUsers.value;
  return [...base].sort((a, b) => a.nickname.localeCompare(b.nickname));
});

// ─── 사용자 상태 (이모티콘/상태문구) ───
// 서버가 방송한 userStatuses에서 상태를 읽는다. 맵에 없거나 접속 중이 아닌
// 사용자는 offline으로 취급한다(접속 해제 자동 반영). 목록에는 본인이 제외되므로 별도 처리 없다.
const statusOf = (userNo: number): MyStatus => {
  const raw: MyStatus | undefined = props.userStatuses[userNo];
  if (raw === undefined || !props.onlineUsers.includes(userNo)) return "offline";
  return MY_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : "offline";
};
const statusEmojiOf = (userNo: number): string => MY_STATUS_EMOJI[statusOf(userNo)];
const statusTextOf = (userNo: number): string => myStatusText(statusOf(userNo));

// 우클릭/더보기 메뉴 상태 (어느 사용자에 대한 메뉴인지)
const menuUser = ref<ChatUser | null>(null);
const menuPos = ref<{ x: number; y: number } | null>(null);

const openMenu = (user: ChatUser, x: number, y: number) => {
  menuUser.value = user;
  menuPos.value = { x, y };
};

const closeMenu = () => {
  menuUser.value = null;
  menuPos.value = null;
};

const onContextMenu = (e: MouseEvent, user: ChatUser) => {
  e.preventDefault();
  openMenu(user, e.clientX, e.clientY);
};

const onMoreClick = (e: MouseEvent, user: ChatUser) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(user, rect.left, rect.bottom + 4);
};

const menuStyle = () => {
  if (!menuPos.value) return {};
  const vw = typeof globalThis.window !== "undefined" ? globalThis.window.innerWidth : 1024;
  return {
    left: Math.min(menuPos.value.x, vw - 180) + "px",
    top: menuPos.value.y + "px",
    position: "fixed" as const,
  };
};

// ─── 사용자 추가/수정 모달 (admin 전용) ───
// 등록 화면 확장 대비: id, nickname, 전화번호, 이름, 탈퇴여부
const showUserModal = ref(false);
const editLoginId = ref("");
const editNickname = ref("");
const editPhone = ref("");
const editUserName = ref("");
const editIsDeleted = ref(false);
const editMode = ref<"add" | "edit">("add");
const modalError = ref("");
const LOGIN_ID_RE = /^[A-Za-z0-9]{1,20}$/;

const openAddModal = () => {
  editMode.value = "add";
  editLoginId.value = "";
  editNickname.value = "";
  editPhone.value = "";
  editUserName.value = "";
  editIsDeleted.value = false;
  modalError.value = "";
  showUserModal.value = true;
};

const openEditModal = (u: { user_no: number; loginId?: string; nickname: string; phone?: string | null; userName?: string | null; isDeleted: boolean }) => {
  editMode.value = "edit";
  editLoginId.value = u.loginId ?? "";
  editNickname.value = u.nickname;
  editPhone.value = u.phone ?? "";
  editUserName.value = u.userName ?? "";
  editIsDeleted.value = u.isDeleted;
  modalError.value = "";
  showUserModal.value = true;
  closeMenu();
};

const closeUserModal = () => {
  showUserModal.value = false;
  modalError.value = "";
};

const confirmUserModal = () => {
  const id = editLoginId.value.trim();
  const nick = editNickname.value.trim().slice(0, 20);
  if (!LOGIN_ID_RE.test(id)) {
    modalError.value = "아이디는 영문+숫자, 최대 20자입니다.";
    return;
  }
  if (!nick) {
    modalError.value = "닉네임을 입력하세요.";
    return;
  }
  modalError.value = "";
  const phone = editPhone.value.trim() ? editPhone.value.trim().slice(0, 30) : null;
  const userName = editUserName.value.trim() ? editUserName.value.trim().slice(0, 30) : null;
  emit("upsert-user", { loginId: id, nickname: nick, phone, userName, isDeleted: editIsDeleted.value });
  showUserModal.value = false;
};

// 내 닉네임 변경 (본인)
const showRenameModal = ref(false);
const renameInput = ref("");
const renameError = ref("");
const openRenameModal = () => {
  renameInput.value = props.myNickname;
  renameError.value = "";
  showRenameModal.value = true;
};
const confirmRenameModal = () => {
  const nick = renameInput.value.trim().slice(0, 20);
  if (!nick) {
    renameError.value = "닉네임을 입력하세요.";
    return;
  }
  if (props.myUserNo == null) {
    renameError.value = "로그인이 필요합니다.";
    return;
  }
  renameError.value = "";
  emit("rename-user", { user_no: props.myUserNo, nickname: nick });
  showRenameModal.value = false;
};
</script>

<template>
  <div class="userlist-screen" @click="closeMenu">
    <h2 class="list-title">사용자 목록 ({{ sortedUsers.length }}명)
      <span class="title-btns">
        <button class="small-btn" @click="openRenameModal">내 닉네임 변경</button>
        <button v-if="isAdmin" class="small-btn primary add-btn" @click="openAddModal">추가</button>
      </span>
    </h2>
    <!-- 사용자 검색: 결과만 이 컴포넌트가 맡고, 우클릭/관리자 동작은 목록이 계속 담당 -->
    <UserSearchInput
      v-model:keyword="searchKeyword"
      v-model:results="searchResults"
      :users="displayUsers"
    />
    <p v-if="upsertResult" class="error">{{ upsertResult }}</p>
    <p v-if="renameResult" class="error">{{ renameResult }}</p>
    <p v-if="!searchKeyword && sortedUsers.length === 0" class="empty">등록된 다른 사용자가 없습니다.</p>
    <p v-else-if="searchKeyword && sortedUsers.length === 0" class="empty">
      "{{ searchKeyword }}" 검색 결과가 없습니다.
    </p>
    <ul class="user-list">
      <li
        v-for="u in sortedUsers"
        :key="u.user_no"
        class="user-item"
        :class="{ withdrawn: u.isDeleted }"
        @dblclick="$emit('open-chat', { user_no: u.user_no, nickname: u.nickname })"
        @contextmenu="(e) => onContextMenu(e, { user_no: u.user_no, nickname: u.nickname })"
        :title="u.nickname + '님과 1:1 채팅 / 우클릭: 메뉴'"
      >
        <span class="avatar">{{ u.nickname.slice(0, 1) }}</span>
        <span class="name">{{ u.nickname }}</span>
        <span v-if="u.isDeleted" class="withdrawn-tag">탈퇴</span>
        <span
          class="presence"
          :class="onlineUsers.includes(u.user_no) ? 'online' : 'offline'"
          :title="statusTextOf(u.user_no)"
        >{{ statusEmojiOf(u.user_no) }}</span>
        <button
          v-if="isAdmin"
          class="edit-btn"
          title="수정"
          @click.stop="openEditModal(u)"
        >수정</button>
        <button
          class="more-btn"
          title="더보기"
          @click="(e) => onMoreClick(e, { user_no: u.user_no, nickname: u.nickname })"
        >⋮</button>
      </li>
    </ul>

    <!-- 우클릭 / 더보기 컨텍스트 메뉴 -->
    <div
      v-if="menuUser"
      class="ctx-menu"
      :style="menuStyle()"
      @click.stop
    >
      <button @click="$emit('open-chat', menuUser!); closeMenu();">1:1 채팅하기</button>
      <button @click="$emit('create-room-with', menuUser!); closeMenu();">방 만들기</button>
    </div>

    <!-- 사용자 추가/수정 모달 (admin 전용) -->
    <div v-if="showUserModal" class="modal-backdrop" @click="closeUserModal">
      <div class="modal-card" @click.stop>
        <h3>{{ editMode === 'add' ? '사용자 추가' : '사용자 수정' }}</h3>
        <label class="field-label">아이디 (영문+숫자, 불변)</label>
        <input
          v-model="editLoginId"
          class="text-input"
          placeholder="아이디 입력"
          maxlength="20"
          :disabled="editMode === 'edit'"
          @keyup.enter="confirmUserModal"
        />
        <label class="field-label">닉네임</label>
        <input
          v-model="editNickname"
          class="text-input"
          placeholder="닉네임 입력"
          maxlength="20"
          @keyup.enter="confirmUserModal"
        />
        <label class="field-label">전화번호</label>
        <input
          v-model="editPhone"
          class="text-input"
          placeholder="전화번호 입력"
          maxlength="30"
          @keyup.enter="confirmUserModal"
        />
        <label class="field-label">이름</label>
        <input
          v-model="editUserName"
          class="text-input"
          placeholder="이름 입력"
          maxlength="30"
          @keyup.enter="confirmUserModal"
        />
        <label class="check-row">
          <input type="checkbox" v-model="editIsDeleted" />
          탈퇴여부 (체크 = 탈퇴)
        </label>
        <p v-if="modalError" class="error">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="closeUserModal">취소</button>
          <button class="small-btn primary" @click="confirmUserModal">
            {{ editMode === 'add' ? '추가' : '저장' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 내 닉네임 변경 모달 (본인) -->
    <div v-if="showRenameModal" class="modal-backdrop" @click="showRenameModal = false">
      <div class="modal-card" @click.stop>
        <h3>내 닉네임 변경</h3>
        <label class="field-label">닉네임</label>
        <input
          v-model="renameInput"
          class="text-input"
          placeholder="닉네임 입력"
          maxlength="20"
          @keyup.enter="confirmRenameModal"
        />
        <p v-if="renameError" class="error">{{ renameError }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="showRenameModal = false">취소</button>
          <button class="small-btn primary" @click="confirmRenameModal">저장</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.userlist-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.add-btn { margin-left: 8px; }
.error { color: #d33; font-size: 13px; margin: 0 0 8px; }
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
/* 상태 이모티콘: 원래 초록/회색 동그라리를 이모티콘으로 대체한다.
   회색 톤 보정은 offline(접속 해제)에 grayscale 필터로 한다. */
.presence {
  width: auto;
  height: auto;
  background: none;
  border-radius: 0;
  font-size: 11px;
  line-height: 1;
  flex-shrink: 0;
}
.presence.offline { filter: grayscale(1); opacity: 0.7; }
.more-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #555;
}
.more-btn:hover { background: #f0f0f0; }
.ctx-menu {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}
.ctx-menu button {
  padding: 10px 14px;
  font-size: 14px;
  border: none;
  background: #fff;
  cursor: pointer;
  text-align: left;
}
.ctx-menu button:hover { background: #f2f7ff; }
.ctx-menu button + button { border-top: 1px solid #eee; }
.user-item.withdrawn { opacity: 0.75; }
.withdrawn-tag {
  font-size: 11px;
  color: #fff;
  background: #6c757d;
  border-radius: 4px;
  padding: 2px 6px;
}
.edit-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
}
.edit-btn:hover { background: #f0f0f0; }
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.modal-card {
  width: 300px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.field-label { display: block; font-size: 13px; color: #555; margin: 8px 0 4px; }
.text-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.text-input:disabled { background: #f1f3f5; color: #555; }
.check-row { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
