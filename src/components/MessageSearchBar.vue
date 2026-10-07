<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** 전체 결과 수 */
    total?: number;
    /** 지금 보고 있는 결과 위치 (0 = 가장 최근 매치, -1 = 없음) */
    index?: number;
    /** 서버 응답을 기다리는 중 */
    loading?: boolean;
    /** 검색을 한 번이라도 했는지 (결과 없음 표시용) */
    searched?: boolean;
    /** 결과가 상한을 넘어 잘렸는지 */
    truncated?: boolean;
  }>(),
  { total: 0, index: -1, loading: false, searched: false, truncated: false },
);

/** 검색어 (v-model:keyword) */
const keyword = defineModel<string>("keyword", { default: "" });

const emit = defineEmits<{
  /** Enter: 검색 (같은 검색어로 다시 누르면 사용처가 이전 결과로 넘긴다) */
  (e: "search", keyword: string): void;
  /** ▲ 이전(더 과거) 결과 */
  (e: "prev"): void;
  /** ▼ 다음(더 최근) 결과 */
  (e: "next"): void;
  (e: "close"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

// 카운터: 검색 중… / 결과 없음 / 현재/전체 (상한 초과면 '+')
const counter = computed(() => {
  if (props.loading) return "검색 중…";
  if (!props.searched) return "";
  if (props.total === 0) return "결과 없음";
  return `${props.index + 1}/${props.total}${props.truncated ? "+" : ""}`;
});
const canPrev = computed(() => !props.loading && props.index >= 0 && props.index < props.total - 1);
const canNext = computed(() => !props.loading && props.index > 0);

const onEnter = (e: KeyboardEvent) => {
  // 한글 조합 중 Enter 는 조합 확정용이므로 무시한다
  if (e.isComposing) return;
  const kw = keyword.value.trim();
  if (kw) emit("search", kw);
};

// 열리자마자 검색창에 포커스
onMounted(() => inputRef.value?.focus());
</script>

<template>
  <div class="message-search">
    <span class="search-icon">🔍</span>
    <input
      ref="inputRef"
      v-model="keyword"
      class="search-input"
      type="text"
      maxlength="50"
      placeholder="대화 내용 검색"
      @keydown.enter="onEnter"
      @keyup.esc="emit('close')"
    />
    <span v-if="counter" class="search-counter">{{ counter }}</span>
    <button
      class="search-nav"
      title="이전 결과"
      aria-label="이전 결과"
      :disabled="!canPrev"
      @click="emit('prev')"
    >▲</button>
    <button
      class="search-nav"
      title="다음 결과"
      aria-label="다음 결과"
      :disabled="!canNext"
      @click="emit('next')"
    >▼</button>
    <button
      class="search-close"
      title="검색 닫기"
      aria-label="검색 닫기"
      @click="emit('close')"
    >×</button>
  </div>
</template>

<style scoped>
.message-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  background: #fff;
}
.search-icon { font-size: 13px; flex-shrink: 0; }
.search-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.search-input:focus { outline: none; border-color: #007bff; }
.search-counter {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  flex-shrink: 0;
}
.search-nav {
  border: 1px solid #ddd;
  background: #fff;
  color: #333;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.search-nav:hover:not(:disabled) { border-color: #007bff; color: #007bff; }
.search-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.search-close {
  border: none;
  background: none;
  color: #999;
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.search-close:hover { color: #d33; }
</style>
