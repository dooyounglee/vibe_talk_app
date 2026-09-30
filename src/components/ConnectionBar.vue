<script setup lang="ts">
defineProps<{
  connectionStatus: string;
  nickname: string;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "update:nickname", value: string): void;
  (e: "connect"): void;
  (e: "disconnect"): void;
  (e: "reconnect"): void;
}>();
</script>

<template>
  <div>
    <!-- 연결 상태 표시 -->
    <div class="status">{{ connectionStatus }}</div>

    <!-- 재연결 버튼 -->
    <div v-if="connectionStatus.includes('끊김')" class="reconnect-wrapper">
      <button @click="$emit('reconnect')" class="reconnect-button">재연결</button>
    </div>

    <!-- 상단: 닉네임 입력 -->
    <div class="input-section" v-if="!isConnected">
      <input
        :value="nickname"
        @input="$emit('update:nickname', ($event.target as HTMLInputElement).value)"
        placeholder="닉네임을 입력하세요"
        @keyup.enter="$emit('connect')"
      />
      <button @click="$emit('connect')" :disabled="isConnected || !nickname">연결</button>
      <button @click="$emit('disconnect')" :disabled="!isConnected">연결 해제</button>
    </div>
  </div>
</template>

<style scoped>
.input-section {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.input-section input {
  flex: 1;
  padding: 10px;
  font-size: 16px;
}

.input-section button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

.status {
  margin-bottom: 20px;
  font-weight: bold;
}

.reconnect-wrapper {
  margin-bottom: 10px;
}

.reconnect-button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
}
</style>
