<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ChatUser } from "../types/chat";

const props = defineProps<{
  users: ChatUser[];
  placeholder?: string;
  /** 초대 시 기존 멤버 제외용: 이 user_no들은 검색 결과에서 빠진다 */
  excludeNos?: number[];
}>();

/** 검색어 (v-model:keyword) — 입력값은 이 컴포넌트만 수정한다 */
const keyword = defineModel<string>("keyword", { default: "" });
/** 필터링 결과 (v-model:results) — 선택 상태는 사용처가 계속 관리한다 */
const results = defineModel<ChatUser[]>("results", { default: () => [] });

const emit = defineEmits<{
  (e: "esc"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

// 검색 결과: 대소문자 무시 부분 일치 + 닉네임 오름차순 (excludeNos는 제외)
const filtered = computed<ChatUser[]>(() => {
  const q = keyword.value.trim().toLowerCase();
  return props.users
    .filter(
      (u) =>
        !props.excludeNos?.includes(u.user_no) &&
        (!q || u.nickname.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.nickname.localeCompare(b.nickname));
});
// 마운트 시 초기 결과도 방출한다 (사용처가 빈 목록으로 시작하지 않도록)
watch(filtered, (v) => (results.value = v), { immediate: true });

// Esc: 검색어가 있으면 검색어만 지우고, 없을 때만 부모에게 알린다.
// (부모는 모달 닫기 등 원하는 동작을 알아서 처리한다)
const onEsc = () => {
  if (keyword.value) keyword.value = "";
  else emit("esc");
};

// 열리자마자 검색창에 포커스 (클릭하지 않고 바로 타이핑 가능)
onMounted(() => inputRef.value?.focus());
</script>

<template>
  <div class="search-row">
    <span class="search-icon">🔍</span>
    <input
      ref="inputRef"
      v-model="keyword"
      class="search-input"
      type="text"
      :placeholder="placeholder ?? '사용자 검색'"
      @keyup.esc="onEsc"
    />
    <button
      v-if="keyword"
      class="search-clear"
      title="검색어 지우기"
      @click="keyword = ''"
    >
      ×
    </button>
    <slot name="after" /><!-- 상태 드롭다운 등 외부 콘텐츠 위치 -->
  </div>
</template>

<style scoped>
.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 8px;
}
.search-icon { font-size: 13px; flex-shrink: 0; }
.search-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.search-input:focus { outline: none; border-color: #007bff; }
.search-clear {
  border: none;
  background: none;
  color: #999;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.search-clear:hover { color: #d33; }
</style>
