<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  TOAST_OPEN_ROOM_EVENT,
  TOAST_SHOW_EVENT,
  type MessageToastPayload,
} from "../utils/toastWindow";

// 알림 카드 창 (#/toast). 메인 창이 toast-show 로 내용을 보내면
// 카드가 아래에서 올라왔다가 일정 시간 뒤 내려가고 창을 숨긴다.
// 카드를 누르면 메인 창에 해당 방을 열어 달라고 알린다.
const SHOW_MS = 4000;
const SLIDE_MS = 300;

const toast = ref<MessageToastPayload | null>(null);
const shown = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let windowHideTimer: ReturnType<typeof setTimeout> | null = null;
let hovering = false;
let unlisten: (() => void) | null = null;
let unmounted = false;

const clearTimers = () => {
  if (hideTimer) clearTimeout(hideTimer);
  if (windowHideTimer) clearTimeout(windowHideTimer);
  hideTimer = null;
  windowHideTimer = null;
};

const slideDown = () => {
  clearTimers();
  shown.value = false;
  // 내려가는 애니메이션이 끝난 뒤 창을 숨긴다 (그 사이 새 알림이 오면 취소됨)
  windowHideTimer = setTimeout(() => {
    windowHideTimer = null;
    void getCurrentWindow().hide().catch(() => undefined);
  }, SLIDE_MS);
};

const startHideTimer = () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!hovering) slideDown();
  }, SHOW_MS);
};

const onShow = (payload: MessageToastPayload) => {
  clearTimers();
  toast.value = payload;
  if (!shown.value) {
    // 카드가 아래(숨김 위치)에 그려진 다음 올라오도록 한 박자 늦춰 shown 을 켠다
    setTimeout(() => {
      shown.value = true;
    }, 30);
  }
  startHideTimer();
};

const onEnter = () => {
  hovering = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
};

const onLeave = () => {
  hovering = false;
  if (shown.value) startHideTimer();
};

const openRoom = () => {
  if (toast.value) {
    void emit(TOAST_OPEN_ROOM_EVENT, { roomId: toast.value.roomId }).catch(() => undefined);
  }
  slideDown();
};

onMounted(() => {
  // 투명 창이므로 페이지 배경도 투명하게 둔다
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  void listen<MessageToastPayload>(TOAST_SHOW_EVENT, (event) => onShow(event.payload))
    .then((fn) => {
      if (unmounted) fn();
      else unlisten = fn;
    })
    .catch(() => undefined);
});

onUnmounted(() => {
  unmounted = true;
  clearTimers();
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <div class="toast-frame">
    <div
      class="toast-card"
      :class="{ shown }"
      @click="openRoom"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <div class="room-name">{{ toast?.roomName }}</div>
      <div class="sender">{{ toast?.sender }}</div>
      <div class="text">{{ toast?.text }}</div>
      <button class="close-btn" title="닫기" @click.stop="slideDown">&#x2715;</button>
    </div>
  </div>
</template>

<style scoped>
.toast-frame {
  position: fixed;
  inset: 0;
  overflow: hidden;
  padding: 4px;
  font-family: sans-serif;
}
.toast-card {
  position: relative;
  height: 100%;
  padding: 10px 32px 10px 14px;
  background: #fff;
  border: 1px solid #d8dde3;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  transform: translateY(110%);
  transition: transform 0.3s ease;
}
.toast-card.shown {
  transform: translateY(0);
}
.toast-card:hover {
  background: #f7f9fb;
}
.room-name {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sender {
  margin-top: 2px;
  font-size: 14px;
  font-weight: bold;
  color: #222;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.text {
  margin-top: 4px;
  font-size: 13px;
  color: #444;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.close-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 11px;
  cursor: pointer;
  border-radius: 4px;
}
.close-btn:hover {
  background: #e9edf1;
  color: #333;
}
</style>
