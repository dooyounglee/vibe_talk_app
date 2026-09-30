<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "send"): void;
}>();
</script>

<template>
  <div class="input-area">
    <input
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keyup.enter="$emit('send')"
      placeholder="메시지를 입력하세요"
    />
    <button @click="$emit('send')" :disabled="!modelValue">전송</button>
  </div>
</template>

<style scoped>
.input-area {
  display: flex;
  gap: 10px;
}

.input-area input {
  flex: 1;
  padding: 10px;
  font-size: 16px;
}

.input-area button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

.input-area button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
