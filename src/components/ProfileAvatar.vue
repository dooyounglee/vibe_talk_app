<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatAttachment } from "../types/chat";
import { attachmentUrl } from "../utils/attachment";

// 동그란 프로필 이미지. image가 없거나(=기본값) 불러오지 못하면 사람 실루엣을 보여준다.
// previewUrl: 모달에서 업로드 전 고른 파일 미리보기(blob URL) — 있으면 image보다 우선
// group: 단체 채팅방 기본 이미지(여러 사람 실루엣)로 그린다
const props = withDefaults(
  defineProps<{
    image?: ChatAttachment | null;
    previewUrl?: string | null;
    size?: number;
    group?: boolean;
  }>(),
  { image: null, previewUrl: null, size: 36, group: false },
);

const broken = ref(false);
const src = computed(() => props.previewUrl || (props.image ? attachmentUrl(props.image) : ""));
watch(src, () => {
  broken.value = false;
});
const boxStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }));
</script>

<template>
  <span class="avatar" :style="boxStyle">
    <img v-if="src && !broken" :src="src" alt="프로필 이미지" draggable="false" @error="broken = true" />
    <svg v-else-if="group" class="silhouette" viewBox="0 0 24 24" aria-label="기본 단체 채팅방 이미지" role="img">
      <circle class="back" cx="6.6" cy="9.6" r="2.9" />
      <path class="back" d="M0.8 20.5c0-3.6 2.6-6 5.8-6s5.8 2.4 5.8 6z" />
      <circle class="back" cx="17.4" cy="9.6" r="2.9" />
      <path class="back" d="M11.6 20.5c0-3.6 2.6-6 5.8-6s5.8 2.4 5.8 6z" />
      <circle cx="12" cy="10.2" r="3.6" />
      <path d="M4.9 22.5c0-4.3 3.2-7.1 7.1-7.1s7.1 2.8 7.1 7.1z" />
    </svg>
    <svg v-else class="silhouette" viewBox="0 0 24 24" aria-label="기본 프로필 이미지" role="img">
      <circle cx="12" cy="9" r="4.2" />
      <path d="M3.5 21.5c0-4.6 3.8-7.6 8.5-7.6s8.5 3 8.5 7.6z" />
    </svg>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background: #dfe3e8;
  border: 1px solid #d0d5db;
  box-sizing: border-box;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}
.silhouette {
  width: 100%;
  height: 100%;
  fill: #9aa3ad;
}
.silhouette .back {
  fill: #b9c0c8;
}
</style>
