<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import WindowTitleBar from "./components/WindowTitleBar.vue";
import { isTauriRuntime } from "./chatBus";

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



