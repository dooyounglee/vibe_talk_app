<script setup lang="ts">
import { ref, watch } from "vue";
import { isValidNewPassword } from "../composables/useChatSocket";

// 비밀번호 변경 모달 (메인 화면 헤더 ⋮ 메뉴 → '비번변경')
//   현재 비밀번호 확인 + 새 비밀번호(8~50자, 영문+숫자 조합) + 확인
// 서버 반영은 부모가 소켓으로 보낸다(apply). result(seq)가 바뀌면 성공 시 완료 안내, 실패 시 사유를 보여준다.
const props = defineProps<{
  isConnected: boolean;
  result: { seq: number; ok: boolean; kind: "change" | "reset"; text: string } | null;
}>();

const emit = defineEmits<{
  /** 보내지 못했으면 부모가 false 반환 */
  (e: "apply", currentPassword: string, newPassword: string, done: (sent: boolean) => void): void;
  (e: "close"): void;
}>();

const currentInput = ref("");
const newInput = ref("");
const confirmInput = ref("");
const error = ref("");
const busy = ref(false);
const done = ref(false);
// 응답 대기 중인 요청의 기준 seq (이 값보다 큰 result가 오면 내 요청의 응답)
let waitingFromSeq: number | null = null;

const submit = () => {
  if (busy.value) return;
  if (!currentInput.value) {
    error.value = "현재 비밀번호를 입력하세요.";
    return;
  }
  if (!isValidNewPassword(newInput.value)) {
    error.value = "새 비밀번호는 영문과 숫자를 포함해 8~50자로 입력하세요.";
    return;
  }
  if (newInput.value !== confirmInput.value) {
    error.value = "새 비밀번호와 확인이 일치하지 않습니다.";
    return;
  }
  if (newInput.value === currentInput.value) {
    error.value = "현재 비밀번호와 다른 비밀번호를 입력하세요.";
    return;
  }
  error.value = "";
  busy.value = true;
  waitingFromSeq = props.result?.seq ?? 0;
  emit("apply", currentInput.value, newInput.value, (sent) => {
    if (sent) return;
    waitingFromSeq = null;
    busy.value = false;
    error.value = "요청을 보내지 못했습니다. 연결을 확인해주세요.";
  });
};

watch(
  () => props.result,
  (r) => {
    if (!r || r.kind !== "change" || waitingFromSeq === null || r.seq <= waitingFromSeq) return;
    waitingFromSeq = null;
    busy.value = false;
    if (r.ok) {
      done.value = true;
    } else {
      error.value = r.text;
    }
  },
);
</script>

<template>
  <div class="modal-backdrop" @click="emit('close')">
    <div class="modal-card" @click.stop>
      <h3>비번변경</h3>
      <template v-if="!done">
        <label class="field-label">현재 비밀번호</label>
        <input
          v-model="currentInput"
          type="password"
          class="text-input current-password"
          autocomplete="current-password"
          maxlength="50"
          @keyup.enter="submit"
        />
        <label class="field-label">새 비밀번호 (영문+숫자, 8자 이상)</label>
        <input
          v-model="newInput"
          type="password"
          class="text-input new-password"
          autocomplete="new-password"
          maxlength="50"
          @keyup.enter="submit"
        />
        <label class="field-label">새 비밀번호 확인</label>
        <input
          v-model="confirmInput"
          type="password"
          class="text-input confirm-password"
          autocomplete="new-password"
          maxlength="50"
          @keyup.enter="submit"
        />
        <p v-if="error" class="error">{{ error }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="emit('close')">취소</button>
          <button class="small-btn primary" :disabled="busy || !isConnected" @click="submit">
            {{ busy ? "변경 중..." : "변경" }}
          </button>
        </div>
      </template>
      <template v-else>
        <p class="message">비밀번호가 변경되었습니다.</p>
        <div class="modal-actions">
          <button class="small-btn primary" @click="emit('close')">확인</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
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
  font-family: sans-serif;
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
.message { margin: 0; font-size: 14px; color: #333; }
.small-btn {
  padding: 6px 12px; font-size: 13px;
  border: 1px solid #ddd; border-radius: 6px;
  background: #fff; cursor: pointer;
}
.small-btn:disabled { color: #aaa; cursor: default; }
.small-btn.primary { background: #007bff; color: #fff; border-color: #007bff; }
.small-btn.primary:disabled { background: #8fbfff; border-color: #8fbfff; color: #fff; }
.error { color: #d33; font-size: 13px; margin: 8px 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
