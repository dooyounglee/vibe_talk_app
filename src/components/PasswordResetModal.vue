<script setup lang="ts">
import { ref, watch } from "vue";

// 비밀번호 초기화 확인 모달
//   - 본인: 메인 화면 헤더 ⋮ 메뉴 → '비번초기화'
//   - admin: '사용자' 탭 [사용자 수정] 모달 → [초기화]
// 초기화 값 = 아이디 + 전화번호 뒤 4자리 (전화번호가 없으면 아이디만).
// 서버 반영은 부모가 소켓으로 보낸다(confirm). result(seq)가 바뀌면 완료/실패를 보여준다.
const props = defineProps<{
  /** 대상 아이디 (안내 문구용) */
  loginId: string;
  /** 본인 초기화 여부 (안내 문구용) */
  self: boolean;
  isConnected: boolean;
  result: { seq: number; ok: boolean; kind: "change" | "reset"; text: string } | null;
}>();

const emit = defineEmits<{
  /** 보내지 못했으면 부모가 false 반환 */
  (e: "confirm", done: (sent: boolean) => void): void;
  (e: "close"): void;
}>();

const error = ref("");
const busy = ref(false);
const done = ref(false);
let waitingFromSeq: number | null = null;

const submit = () => {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  waitingFromSeq = props.result?.seq ?? 0;
  emit("confirm", (sent) => {
    if (sent) return;
    waitingFromSeq = null;
    busy.value = false;
    error.value = "요청을 보내지 못했습니다. 연결을 확인해주세요.";
  });
};

watch(
  () => props.result,
  (r) => {
    if (!r || r.kind !== "reset" || waitingFromSeq === null || r.seq <= waitingFromSeq) return;
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
      <h3>비번초기화</h3>
      <template v-if="!done">
        <p class="message">
          {{ self ? "내" : `'${loginId}'의` }} 비밀번호를 <strong>아이디 + 전화번호 뒤 4자리</strong>로 초기화합니다.
        </p>
        <p class="hint">전화번호가 등록되지 않았으면 아이디가 비밀번호가 됩니다.</p>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="emit('close')">취소</button>
          <button class="small-btn primary" :disabled="busy || !isConnected" @click="submit">
            {{ busy ? "초기화 중..." : "초기화" }}
          </button>
        </div>
      </template>
      <template v-else>
        <p class="message">비밀번호가 초기화되었습니다.</p>
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
  z-index: 2100;
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
.message { margin: 0; font-size: 14px; color: #333; line-height: 1.5; }
.hint { margin: 8px 0 0; font-size: 12px; color: #777; }
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
