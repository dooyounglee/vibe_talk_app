<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  connectionStatus: string;
  isConnected: boolean;
}>();

const emit = defineEmits<{
  (e: "submit", nickname: string): void;
}>();

const nicknameInput = ref("");
const error = ref("");

const submit = () => {
  const trimmed = nicknameInput.value.trim();
  if (trimmed === "") {
    error.value = "닉네임을 입력하세요.";
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
      <p class="desc">사용할 닉네임을 입력하세요</p>
      <input
        v-model="nicknameInput"
        class="nickname-input"
        placeholder="닉네임 입력"
        maxlength="20"
        @keyup.enter="onEnter"
      />
      <button class="start-button" :disabled="!nicknameInput.trim()" @click="submit">
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
