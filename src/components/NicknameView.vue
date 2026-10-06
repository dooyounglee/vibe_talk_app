<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  connectionStatus: string;
  isConnected: boolean;
  joinError: string;
}>();

const emit = defineEmits<{
  (e: "submit", loginId: string): void;
}>();

const loginInput = ref("");
const error = ref("");

watch(
  () => props.joinError,
  (msg) => {
    if (msg) error.value = msg;
  }
);

const LOGIN_ID_RE = /^[A-Za-z0-9]{1,20}$/;

const submit = () => {
  const trimmed = loginInput.value.trim();
  if (!LOGIN_ID_RE.test(trimmed)) {
    error.value = "아이디는 영문+숫자, 최대 20자입니다.";
    return;
  }
  error.value = "";
  emit("submit", trimmed);
};

const onEnter = () => {
  submit();
};
</script>

<template>
  <div class="nickname-screen">
    <div class="nickname-card">
      <h1 class="title">Vibe Talk</h1>
      <p class="desc">사용할 아이디를 입력하세요</p>
      <input
        v-model="loginInput"
        class="nickname-input"
        placeholder="아이디 입력 (영문+숫자)"
        maxlength="20"
        @keyup.enter="onEnter"
      />
      <button class="start-button" :disabled="!loginInput.trim()" @click="submit">
        입장하기
      </button>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="!isConnected && connectionStatus !== '연결되지 않음'" class="status">
        {{ connectionStatus }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.nickname-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  background: #f4f6f8;
  font-family: sans-serif;
}
.nickname-card {
  width: 300px;
  padding: 32px 24px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  text-align: center;
}
.title {
  margin: 0 0 8px;
  font-size: 24px;
}
.desc {
  margin: 0 0 16px;
  color: #666;
  font-size: 14px;
}
.nickname-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  margin-bottom: 12px;
}
.start-button {
  width: 100%;
  padding: 10px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  background: #007bff;
  color: #fff;
  cursor: pointer;
}
.start-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: #d33;
  font-size: 13px;
  margin-top: 8px;
}
.status {
  color: #666;
  font-size: 13px;
  margin-top: 8px;
}
</style>
