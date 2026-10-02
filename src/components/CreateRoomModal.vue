<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  users: string[];
  initialSelected?: string[];
  initialName?: string;
}>();

const emit = defineEmits<{
  (e: "confirm", payload: { name: string; members: string[] }): void;
  (e: "cancel"): void;
}>();

const roomName = ref(props.initialName ?? "");
const selected = ref<Set<string>>(new Set(props.initialSelected ?? []));
const error = ref("");

watch(
  () => props.initialSelected,
  (v) => {
    selected.value = new Set(v ?? []);
  },
);

watch(
  () => props.initialName,
  (v) => {
    roomName.value = v ?? "";
  },
);

const toggle = (user: string) => {
  const next = new Set(selected.value);
  if (next.has(user)) next.delete(user);
  else next.add(user);
  selected.value = next;
};

const confirm = () => {
  const name = roomName.value.trim();
  if (!name) {
    error.value = "방 이름을 입력하세요.";
    return;
  }
  if (selected.value.size < 1) {
    error.value = "사용자를 한 명 이상 선택하세요.";
    return;
  }
  error.value = "";
  emit("confirm", { name: name.slice(0, 30), members: Array.from(selected.value) });
};
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">방 만들기</h3>
      <input
        v-model="roomName"
        class="room-name-input"
        placeholder="방 이름 (예: 스터디)"
        maxlength="30"
        @keyup.enter="confirm"
      />
      <p class="modal-desc">초대할 사용자를 한 명 이상 선택하세요. ({{ selected.size }}명 선택됨)</p>
      <p v-if="users.length === 0" class="empty">현재 초대 가능한 사용자가 없습니다.</p>
      <ul v-else class="select-list">
        <li v-for="user in users" :key="user" class="select-item">
          <label>
            <input
              type="checkbox"
              :checked="selected.has(user)"
              @change="toggle(user)"
            />
            <span class="avatar">{{ user.slice(0, 1) }}</span>
            <span class="name">{{ user }}</span>
          </label>
        </li>
      </ul>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-btns">
        <button class="cancel" @click="$emit('cancel')">취소</button>
        <button
          class="primary"
          :disabled="!roomName.trim() || selected.size < 1"
          @click="confirm"
        >
          확인
        </button>
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
  width: 360px;
  max-width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  font-family: sans-serif;
}
.modal-title { margin: 0 0 12px; font-size: 17px; }
.room-name-input {
  width: 100%;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.modal-desc { font-size: 13px; color: #555; margin: 10px 0 8px; }
.empty { font-size: 13px; color: #888; }
.select-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}
.select-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.select-item label:hover { background: #f2f7ff; }
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #007bff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 13px;
}
.name { flex: 1; word-break: break-all; }
.error { color: #d33; font-size: 13px; }
.modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.modal-btns button {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #ddd;
  background: #fff;
  cursor: pointer;
}
.modal-btns button.primary { background: #007bff; border-color: #007bff; color: #fff; }
.modal-btns button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
