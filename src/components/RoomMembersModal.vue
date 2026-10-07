<script setup lang="ts">
import { computed } from "vue";
import type { ChatUser } from "../types/chat";

// 채팅방 참여자 목록 모달. 채팅창 상단 '참여자' 버튼에서 연다.
const props = defineProps<{
  members: ChatUser[];
  myUserNo: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

// 나를 맨 위에, 나머지는 닉네임 순으로 보여준다.
const sortedMembers = computed<ChatUser[]>(() =>
  [...props.members].sort((a, b) => {
    if (a.user_no === props.myUserNo) return -1;
    if (b.user_no === props.myUserNo) return 1;
    return a.nickname.localeCompare(b.nickname, "ko");
  }),
);

const close = () => emit("close");
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal">
      <h3 class="modal-title">
        참여자 <span class="count">{{ members.length }}</span>
      </h3>
      <p v-if="members.length === 0" class="empty">참여자 정보를 불러오는 중입니다.</p>
      <ul v-else class="member-list">
        <li v-for="m in sortedMembers" :key="m.user_no" class="member-item">
          <span class="avatar">{{ m.nickname.charAt(0) }}</span>
          <span class="name">{{ m.nickname }}</span>
          <span v-if="m.user_no === myUserNo" class="me-badge">나</span>
        </li>
      </ul>
      <div class="modal-btns">
        <button class="primary" @click="close">닫기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
  box-sizing: border-box;
}
.modal {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  width: 320px;
  max-width: 100%;
  font-family: sans-serif;
  color: #000;
  font-weight: normal;
}
.modal-title { margin: 0 0 12px; font-size: 17px; }
.count { color: #007bff; font-size: 15px; margin-left: 4px; }
.empty { font-size: 13px; color: #888; margin: 8px 0; }
.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
}
.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 14px;
}
.member-item:last-child { border-bottom: none; }
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #e7f1ff;
  color: #007bff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}
.name { flex: 1; word-break: break-all; }
.me-badge {
  font-size: 11px;
  color: #fff;
  background: #007bff;
  border-radius: 8px;
  padding: 2px 6px;
}
.modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.modal-btns button {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #ddd;
  background: #fff;
  cursor: pointer;
}
.modal-btns button.primary { background: #007bff; border-color: #007bff; color: #fff; }
</style>
