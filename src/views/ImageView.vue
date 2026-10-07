<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ImageViewer from "../components/ImageViewer.vue";
import type { ChatAttachment } from "../types/chat";
import { isTauriRuntime } from "../chatBus";
import { downloadAttachment } from "../utils/attachment";
import { attachmentFromRoute } from "../utils/imageWindow";

// 이미지 창 (#/image/:fileId) — 채팅창에서 이미지를 누르면 이미지마다 이 창이 하나씩 뜬다
const route = useRoute();
const file = computed(() => attachmentFromRoute(route.params.fileId, route.query));
const downloadError = ref("");

watchEffect(() => {
  document.title = file.value?.name ?? "이미지";
});

const close = async () => {
  try {
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
      return;
    }
  } catch { /* 무시 */ }
  window.close();
};

const download = async (f: ChatAttachment) => {
  downloadError.value = "";
  try {
    await downloadAttachment(f);
  } catch {
    downloadError.value = `파일을 받지 못했습니다: ${f.name}`;
  }
};
</script>

<template>
  <ImageViewer v-if="file" :file="file" @close="close" @download="download" />
  <p v-else class="image-missing">이미지 정보를 찾을 수 없습니다.</p>
  <div v-if="downloadError" class="image-error" @click="downloadError = ''">{{ downloadError }}</div>
</template>

<style scoped>
.image-missing {
  margin: 0;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: sans-serif;
  color: #555;
}
.image-error {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 1001;
  padding: 8px 14px;
  border-radius: 8px;
  background: #f8d7da;
  color: #842029;
  font: 13px sans-serif;
  cursor: pointer;
}
</style>
