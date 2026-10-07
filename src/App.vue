<script setup lang="ts">
import { computed, onMounted, onUnmounted, watchEffect } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RouterView, useRoute } from "vue-router";
import WindowTitleBar from "./components/WindowTitleBar.vue";
import { isTauriRuntime } from "./chatBus";
import { stopTaskbarFlash } from "./utils/taskbarFlash";

// Tauri 메인/채팅방 창은 OS 제목표시줄이 없으므로(decorations: false) 커스텀 바를 띄운다.
// 이미지 창은 OS 제목표시줄을 그대로 쓰고, 알림 카드 창은 바가 필요 없다.
const TITLEBAR_ROUTES = new Set(["home", "room"]);
const route = useRoute();
const showTitleBar = computed(
  () => isTauriRuntime() && TITLEBAR_ROUTES.has(String(route.name ?? "")),
);

// 각 화면은 높이를 calc(100vh - var(--titlebar-h, 0px)) 로 잡으므로 바가 있을 때만 값을 준다.
watchEffect(() => {
  document.documentElement.style.setProperty("--titlebar-h", showTitleBar.value ? "32px" : "0px");
});

// 창을 확인(focus)하는 순간 작업표시줄 주황색 깜빡임을 끈다 (메인/채팅방 창 공통)
let unlistenFocus: (() => void) | null = null;
let unmounted = false;
const onWindowFocus = () => void stopTaskbarFlash();
onMounted(() => {
  if (!isTauriRuntime()) return;
  window.addEventListener("focus", onWindowFocus);
  if (document.hasFocus()) onWindowFocus();
  void getCurrentWindow()
    .onFocusChanged((event) => {
      if (event.payload) onWindowFocus();
    })
    .then((unlisten) => {
      if (unmounted) unlisten();
      else unlistenFocus = unlisten;
    })
    .catch(() => undefined);
});
onUnmounted(() => {
  unmounted = true;
  window.removeEventListener("focus", onWindowFocus);
  unlistenFocus?.();
  unlistenFocus = null;
});
</script>

<template>
  <WindowTitleBar v-if="showTitleBar" />
  <RouterView />
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}
</style>



