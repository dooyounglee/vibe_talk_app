<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ROOM_TITLE_INPUT_MAX_LENGTH } from "../types/chat";

// 방제목 수정 모달. 목록('내 채팅방' 더보기)과 채팅방 상단 연필에서 함께 쓴다.
const props = defineProps<{
  /** 수정 전 현재 제목 (미축약 원본) */
  currentTitle: string;
  /** 실패 사유 (서버 room_rename_failed) — 있을 때만 빨간 문구로 표시 */
  errorReason?: string;
}>();

const emit = defineEmits<{
  (e: "confirm", title: string): void;
  (e: "cancel"): void;
}>();

const draft = ref(props.currentTitle);
const error = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

// 저장 버튼 없이 Enter로 바로 수정할 수 있게 입력창에 자동 포커스/전체선택
watch(
  () => props.currentTitle,
  (v) => {
    draft.value = v;
    error.value = "";
    void nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  },
  { immediate: true },
);

// 제목은 사용자별 관리라 방의 다른 멤버에게는 보이지 않는다는 점을 안내한다.
const confirm = () => {
  const title = draft.value.trim();
  if (title === "") {
    error.value = "방제목을 입력하세요.";
    return;
  }
  error.value = "";
  emit("confirm", title);
};

const close = () => emit("cancel");
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal">
      <h3 class="modal-title">방제목 변경</h3>
      <input
        ref="inputRef"
        v-model="draft"
        class="title-input"
        type="text"
        :maxlength="ROOM_TITLE_INPUT_MAX_LENGTH"
        placeholder="새 방제목"
        @keyup.enter="confirm"
        @keyup.esc="close"
      />
      <p class="counter">{{ draft.length }} / {{ ROOM_TITLE_INPUT_MAX_LENGTH }}</p>
      <p class="modal-desc">변경한 제목은 나에게만 적용됩니다. 다른 참여자는 원래 제목을 봅니다.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="errorReason" class="error">{{ errorReason }}</p>
      <div class="modal-btns">
        <button class="cancel" @click="close">취소</button>
        <button class="primary" @click="confirm">저장</button>
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
  font-family: sans-serif;
}
.modal-title { margin: 0 0 12px; font-size: 17px; }
.title-input {
  width: 100%;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.title-input:focus { outline: none; border-color: #007bff; }
.counter { font-size: 11px; color: #999; margin: 4px 0 0; text-align: right; }
.modal-desc { font-size: 12px; color: #666; margin: 8px 0 0; }
.error { color: #d33; font-size: 13px; margin: 8px 0 0; }
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