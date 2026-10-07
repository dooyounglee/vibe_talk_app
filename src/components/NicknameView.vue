<script setup lang="ts">
import { ref, watch } from "vue";
import { isAutoLogin, loadSavedLogin, saveLogin, setAutoLogin } from "../loginPrefs";

const props = defineProps<{
  connectionStatus: string;
  isConnected: boolean;
  joinError: string;
}>();

const emit = defineEmits<{
  (e: "submit", loginId: string, password: string): void;
}>();

// 저장된 아이디/비밀번호가 있으면 미리 채운다
const saved = loadSavedLogin();
const loginInput = ref(saved?.loginId ?? "");
const passwordInput = ref(saved?.password ?? "");
const savePassword = ref(saved != null);
const autoLogin = ref(saved != null && isAutoLogin());
const error = ref("");

// 자동로그인은 저장된 비밀번호가 있어야 하므로 두 체크박스를 연동한다
watch(autoLogin, (on) => {
  if (on) savePassword.value = true;
});
watch(savePassword, (on) => {
  if (!on) autoLogin.value = false;
});

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
  if (!passwordInput.value) {
    error.value = "비밀번호를 입력하세요.";
    return;
  }
  error.value = "";
  saveLogin(savePassword.value ? { loginId: trimmed, password: passwordInput.value } : null);
  setAutoLogin(autoLogin.value);
  emit("submit", trimmed, passwordInput.value);
};

const onEnter = () => {
  submit();
};
</script>

<template>
  <div class="nickname-screen">
    <div class="nickname-card">
      <h1 class="title">Vibe Talk</h1>
      <p class="desc">아이디와 비밀번호를 입력하세요</p>
      <input
        v-model="loginInput"
        class="nickname-input"
        placeholder="아이디 입력 (영문+숫자)"
        maxlength="20"
        autocomplete="username"
        @keyup.enter="onEnter"
      />
      <input
        v-model="passwordInput"
        type="password"
        class="nickname-input password-input"
        placeholder="비밀번호 입력"
        autocomplete="current-password"
        @keyup.enter="onEnter"
      />
      <div class="options">
        <label class="option">
          <input v-model="savePassword" type="checkbox" class="save-password" />
          비밀번호 저장
        </label>
        <label class="option">
          <input v-model="autoLogin" type="checkbox" class="auto-login" />
          자동로그인
        </label>
      </div>
      <button
        class="start-button"
        :disabled="!loginInput.trim() || !passwordInput"
        @click="submit"
      >
        로그인
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
  height: calc(100vh - var(--titlebar-h, 0px));
  height: calc(100dvh - var(--titlebar-h, 0px));
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
.options {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #444;
}
.option {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
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
