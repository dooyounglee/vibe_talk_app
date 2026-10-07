<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { ChatAttachment } from "../types/chat";
import { formatFileSize } from "../types/chat";
import { attachmentUrl } from "../utils/attachment";

// 이미지 확대/축소 뷰어 (이미지 창 #/image/:fileId 의 본문 — 창 전체를 채운다)
//   휠 / +,- 버튼 / 키보드(+,-,0)로 확대·축소, 드래그로 이동, 더블클릭으로 원래 크기 ↔ 2배
const props = defineProps<{
  file: ChatAttachment;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "download", file: ChatAttachment): void;
}>();

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const STEP = 1.25;

const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
let dragStart: { x: number; y: number; ox: number; oy: number } | null = null;

const percent = computed(() => `${Math.round(scale.value * 100)}%`);
const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
  cursor: dragging.value ? "grabbing" : "grab",
  // 드래그 중에는 손을 바로 따라오도록 애니메이션을 끈다
  transition: dragging.value ? "none" : undefined,
}));

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
const setScale = (next: number) => {
  scale.value = clamp(next);
};
const zoomIn = () => setScale(scale.value * STEP);
const zoomOut = () => setScale(scale.value / STEP);
const reset = () => {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
};

const onWheel = (e: WheelEvent) => {
  if (e.deltaY < 0) zoomIn();
  else if (e.deltaY > 0) zoomOut();
};

const onDblClick = () => {
  if (scale.value === 1) setScale(2);
  else reset();
};

const onPointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return;
  dragging.value = true;
  dragStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};
const onPointerMove = (e: PointerEvent) => {
  if (!dragStart) return;
  offsetX.value = dragStart.ox + (e.clientX - dragStart.x);
  offsetY.value = dragStart.oy + (e.clientY - dragStart.y);
};
const onPointerUp = () => {
  dragging.value = false;
  dragStart = null;
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
  else if (e.key === "+" || e.key === "=") zoomIn();
  else if (e.key === "-") zoomOut();
  else if (e.key === "0") reset();
};

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="viewer-backdrop">
    <div class="viewer-toolbar">
      <span class="viewer-name" :title="props.file.name">
        {{ props.file.name }} <small>({{ formatFileSize(props.file.size) }})</small>
      </span>
      <span class="viewer-actions">
        <button title="축소 (-)" aria-label="축소" @click="zoomOut">－</button>
        <button class="percent" title="원래 크기 (0)" @click="reset">{{ percent }}</button>
        <button title="확대 (+)" aria-label="확대" @click="zoomIn">＋</button>
        <button title="다운로드" aria-label="다운로드" @click="emit('download', props.file)">⬇</button>
        <button title="닫기 (Esc)" aria-label="닫기" @click="emit('close')">✕</button>
      </span>
    </div>
    <div class="viewer-stage" @wheel.prevent="onWheel">
      <img
        class="viewer-image"
        :src="attachmentUrl(props.file)"
        :alt="props.file.name"
        :style="imageStyle"
        draggable="false"
        @dblclick="onDblClick"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      />
    </div>
  </div>
</template>

<style scoped>
.viewer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  font-family: sans-serif;
}
.viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.4);
}
.viewer-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.viewer-name small { opacity: 0.7; }
.viewer-actions { display: flex; gap: 4px; flex-shrink: 0; }
.viewer-actions button {
  min-width: 32px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.viewer-actions button:hover { background: rgba(255, 255, 255, 0.3); }
.viewer-actions .percent { min-width: 56px; font-size: 12px; }
.viewer-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.viewer-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  touch-action: none;
  transition: transform 0.08s ease-out;
}
</style>
