<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

// OS 제목표시줄을 숨긴(decorations: false) 메인/채팅방 창의 커스텀 제목표시줄.
// 바를 끌면 창이 이동하고, _ 는 최소화, X 는 창 닫기 요청이다.
// (메인 창의 닫기 요청은 Rust가 가로채 트레이로 숨긴다 — src-tauri/src/lib.rs)
const title = ref(document.title);
let observer: MutationObserver | null = null;

onMounted(() => {
  // RoomView 등이 document.title 을 바꾸면 바의 제목도 따라 바꾼다.
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  observer = new MutationObserver(() => {
    title.value = document.title;
  });
  observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});

const minimize = () => {
  void getCurrentWindow().minimize().catch(() => undefined);
};

const close = () => {
  void getCurrentWindow().close().catch(() => undefined);
};
</script>

<template>
  <div class="titlebar" data-tauri-drag-region>
    <span class="title" data-tauri-drag-region>{{ title }}</span>
    <div class="controls">
      <button class="ctrl" title="최소화" @click="minimize">&#x2014;</button>
      <button class="ctrl close" title="닫기" @click="close">&#x2715;</button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-h, 32px);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #e9edf1;
  border-bottom: 1px solid #d8dde3;
  user-select: none;
  font-family: sans-serif;
}
.title {
  flex: 1;
  min-width: 0;
  padding-left: 12px;
  font-size: 12px;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.controls {
  display: flex;
  height: 100%;
}
.ctrl {
  width: 44px;
  height: 100%;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #444;
  cursor: pointer;
}
.ctrl:hover { background: #d6dbe1; }
.ctrl.close:hover { background: #e81123; color: #fff; }
</style>
