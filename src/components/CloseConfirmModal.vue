<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

// 메인 창을 닫을 때 열려 있는 채팅창이 있으면 띄우는 안내 모달.
// '채팅창 닫고 종료'를 누르면 열려 있는 채팅창을 모두 닫고 메인 창도 닫는다.
const props = defineProps<{
  /** 열려 있는 채팅창 개수 (안내 문구에 쓰인다) */
  openRoomCount: number;
}>();

const emit = defineEmits<{
  /** 채팅창을 모두 닫고 메인 창 종료 */
  (e: "confirm"): void;
  /** 닫기 취소 — 메인 창을 그대로 둔다 */
  (e: "cancel"): void;
}>();

const close = () => emit("cancel");

// Esc로도 취소 (기존 모달과 동일하게 동작)
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") close();
};

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="modal-backdrop">
    <div class="modal">
      <h3 class="modal-title">채팅창이 열려 있습니다</h3>
      <p class="modal-desc">
        현재 채팅창 {{ props.openRoomCount }}개가 열려 있습니다.<br />
        메인 창을 닫으려면 열려 있는 채팅창을 먼저 닫아주세요.
      </p>
      <div class="modal-btns">
        <button class="cancel" @click="close">취소</button>
        <button class="primary" @click="emit('confirm')">채팅창 닫고 종료</button>
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
.modal-desc { font-size: 13px; color: #666; margin: 0; line-height: 1.6; }
.modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
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