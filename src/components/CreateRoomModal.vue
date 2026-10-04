<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { truncateRoomTitle } from "../types/chat";

const props = defineProps<{
  users: string[];
  initialSelected?: string[];
  myNickname?: string;
}>();

const emit = defineEmits<{
  (e: "confirm", payload: { members: string[] }): void;
  (e: "cancel"): void;
}>();

const selected = ref<Set<string>>(new Set(props.initialSelected ?? []));
const error = ref("");

watch(
  () => props.initialSelected,
  (v) => {
    selected.value = new Set(v ?? []);
  },
);

const toggle = (user: string) => {
  const next = new Set(selected.value);
  if (next.has(user)) next.delete(user);
  else next.add(user);
  selected.value = next;
  error.value = "";
};

// ─── 방 이름 자동 생성 ───
// 1:1방(나 + 선택 1명): 서로의 이름이 뜸(서버가 상대 닉네임을 display_name으로 저장)
// 3명 이상: 참여자 이름 전체를 오름차순으로 쉼표 연결 (arr.join(','))
// DB/서버로는 전체 이름을 그대로 보내고, 화면 미리보기만 20자까지 축약한다.
const memberList = computed<string[]>(() => Array.from(selected.value));
const participantNames = computed<string[]>(() => {
  const names = new Set<string>();
  const me = props.myNickname?.trim();
  if (me) names.add(me);
  for (const user of memberList.value) {
    if (user) names.add(user);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
});
const isOneToOne = computed<boolean>(() => memberList.value.length === 1);
// 서버로 보낼(그리고 rooms.name으로 저장될) 방 이름 — 미축약 전체값
const defaultName = computed<string>(() => participantNames.value.join(","));
// 화면 미리보기용 제목
const previewName = computed<string>(() =>
  isOneToOne.value ? "1:1 대화" : truncateRoomTitle(defaultName.value),
);
const previewHint = computed<string>(() => {
  if (memberList.value.length === 0) return "참여자를 선택하면 방 이름이 자동 생성됩니다.";
  if (isOneToOne.value) {
    return `나에게는 "${memberList.value[0]}", 상대에게는 내 이름이 방 이름으로 보입니다.`;
  }
  return `${participantNames.value.length}명 참여 (이름 오름차순) · 방 이름은 자동 생성됩니다.`;
});

const confirm = () => {
  if (selected.value.size < 1) {
    error.value = "사용자를 한 명 이상 선택하세요.";
    return;
  }
  error.value = "";
  // 방 이름은 서버가 멤버 기준으로 자동 생성한다(선택된 멤버만 전달).
  emit("confirm", { members: memberList.value });
};
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">방 만들기</h3>
      <div class="room-name-box">
        <span class="room-name-label">방 이름</span>
        <span class="room-name-value" :title="defaultName">{{ previewName }}</span>
      </div>
      <p class="modal-desc">{{ previewHint }}</p>
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
          :disabled="selected.size < 1"
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
/* 방 이름 입력란 제거 → 자동 생성된 이름만 읽기 전용으로 보여준다 */
.room-name-box {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #eee;
  border-radius: 8px;
  box-sizing: border-box;
  background: #f7f9fc;
}
.room-name-label { font-size: 12px; color: #888; flex-shrink: 0; }
.room-name-value {
  flex: 1;
  min-width: 0;
  font-weight: bold;
  color: #222;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
