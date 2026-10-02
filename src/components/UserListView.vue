<script setup lang="ts">
import { ref, computed } from "vue";
import type { UserDetail } from "../composables/useChatSocket";

const props = defineProps<{
  myNickname: string;
  users: string[];
  onlineUsers: string[];
  unreadCounts: Record<string, number>;
  connectionStatus: string;
  isConnected: boolean;
  isAdmin: boolean;
  usersDetail: UserDetail[];
  upsertResult: string;
}>();

const emit = defineEmits<{
  (e: "open-chat", user: string): void;
  (e: "create-room-with", user: string): void;
  (e: "reconnect"): void;
  (e: "disconnect"): void;
  (e: "upsert-user", payload: { nickname: string; isDeleted: boolean }): void;
}>();

// admin에게 보여줄 목록: 탈퇴 포함 전체, 일반 사용자는 users 그대로
const displayUsers = computed(() => {
  if (props.isAdmin) return props.usersDetail;
  return props.users.map((nickname) => ({ nickname, isDeleted: false }));
});

// 우클릭/더보기 메뉴 상태 (어느 사용자에 대한 메뉴인지)
const menuUser = ref<string | null>(null);
const menuPos = ref<{ x: number; y: number } | null>(null);

const openMenu = (user: string, x: number, y: number) => {
  menuUser.value = user;
  menuPos.value = { x, y };
};

const closeMenu = () => {
  menuUser.value = null;
  menuPos.value = null;
};

const onContextMenu = (e: MouseEvent, user: string) => {
  e.preventDefault();
  openMenu(user, e.clientX, e.clientY);
};

const onMoreClick = (e: MouseEvent, user: string) => {
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
const showUserModal = ref(false);
const editNickname = ref("");
const editIsDeleted = ref(false);
const editMode = ref<"add" | "edit">("add");
const modalError = ref("");

const openAddModal = () => {
  editMode.value = "add";
  editNickname.value = "";
  editIsDeleted.value = false;
  modalError.value = "";
  showUserModal.value = true;
};

const openEditModal = (nickname: string, isDeleted: boolean) => {
  editMode.value = "edit";
  editNickname.value = nickname;
  editIsDeleted.value = isDeleted;
  modalError.value = "";
  showUserModal.value = true;
  closeMenu();
};

const closeUserModal = () => {
  showUserModal.value = false;
  modalError.value = "";
};

const confirmUserModal = () => {
  const trimmed = editNickname.value.trim().slice(0, 20);
  if (!trimmed) {
    modalError.value = "닉네임을 입력하세요.";
    return;
  }
  modalError.value = "";
  emit("upsert-user", { nickname: trimmed, isDeleted: editIsDeleted.value });
  showUserModal.value = false;
};
</script>

<template>
  <div class="userlist-screen" @click="closeMenu">
    <h2 class="list-title">사용자 목록 ({{ displayUsers.length }}명)
      <button v-if="isAdmin" class="small-btn primary add-btn" @click="openAddModal">추가</button>
    </h2>
    <p v-if="upsertResult" class="error">{{ upsertResult }}</p>
    <p v-if="displayUsers.length === 0" class="empty">등록된 다른 사용자가 없습니다.</p>
    <ul class="user-list">
      <li
        v-for="u in displayUsers"
        :key="u.nickname"
        class="user-item"
        :class="{ withdrawn: u.isDeleted }"
        @dblclick="$emit('open-chat', u.nickname)"
        @contextmenu="(e) => onContextMenu(e, u.nickname)"
        :title="u.nickname + '님과 1:1 채팅 / 우클릭: 메뉴'"
      >
        <span class="avatar">{{ u.nickname.slice(0, 1) }}</span>
        <span class="name">{{ u.nickname }}</span>
        <span v-if="u.isDeleted" class="withdrawn-tag">탈퇴</span>
        <span
          class="presence"
          :class="onlineUsers.includes(u.nickname) ? 'online' : 'offline'"
          :title="onlineUsers.includes(u.nickname) ? '접속중' : '오프라인'"
        ></span>
        <span v-if="(unreadCounts[u.nickname] ?? 0) > 0" class="badge">
          {{ unreadCounts[u.nickname] }}
        </span>
        <button
          v-if="isAdmin"
          class="edit-btn"
          title="수정"
          @click.stop="openEditModal(u.nickname, u.isDeleted)"
        >수정</button>
        <button
          class="more-btn"
          title="더보기"
          @click="(e) => onMoreClick(e, u.nickname)"
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
        <label class="field-label">닉네임</label>
        <input
          v-model="editNickname"
          class="text-input"
          placeholder="닉네임 입력"
          maxlength="20"
          :disabled="editMode === 'edit'"
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
.badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #dc3545;
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.presence {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.presence.online { background: #28a745; }
.presence.offline { background: #ccc; }
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
