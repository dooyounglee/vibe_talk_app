<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import type { ChatAttachment } from "../types/chat";
import { uploadAttachment, validateAttachment } from "../utils/attachment";
import ProfileAvatar from "./ProfileAvatar.vue";

// 프로필 이미지 설정 모달 (메인 화면 헤더 ⋮ 메뉴 → '프로필이미지 설정')
//   현재 이미지 확인 / 새 이미지 선택(미리보기) 후 저장 / 기본 이미지로 초기화
// 단체 채팅방 이미지 설정(채팅방 상단 🖼)에도 재사용한다 (title / group)
// 업로드는 이 모달이 직접 하고(POST /upload), 서버 반영은 부모가 소켓으로 보낸다(apply).
// 부모가 넘겨주는 result(seq)가 바뀌면 성공 시 닫고, 실패 시 사유를 보여준다.
const props = withDefaults(
  defineProps<{
    currentImage: ChatAttachment | null;
    isConnected: boolean;
    result: { seq: number; ok: boolean; text: string } | null;
    title?: string;
    /** 기본 이미지를 여러 사람 실루엣(단체 채팅방)으로 그린다 */
    group?: boolean;
    /** 버튼 위 안내 문구 (없으면 표시하지 않음) */
    note?: string;
  }>(),
  { title: "프로필이미지 설정", group: false, note: "" },
);

const emit = defineEmits<{
  /** fileId = 새 이미지, null = 기본 이미지로 초기화. 보내지 못했으면 부모가 false 반환 */
  (e: "apply", fileId: string | null, done: (sent: boolean) => void): void;
  (e: "cancel"): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const pickedFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const error = ref("");
const busy = ref(false);
// 응답 대기 중인 요청의 기준 seq (이 값보다 큰 result가 오면 내 요청의 응답)
let waitingFromSeq: number | null = null;

const clearPreview = () => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
  pickedFile.value = null;
};
onUnmounted(clearPreview);

const openPicker = () => {
  error.value = "";
  fileInput.value?.click();
};

const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error.value = "이미지 파일만 등록할 수 있습니다.";
    return;
  }
  const invalid = validateAttachment(file);
  if (invalid) {
    error.value = invalid;
    return;
  }
  clearPreview();
  pickedFile.value = file;
  previewUrl.value = URL.createObjectURL(file);
  error.value = "";
};

const send = (fileId: string | null) => {
  waitingFromSeq = props.result?.seq ?? 0;
  emit("apply", fileId, (sent) => {
    if (sent) return;
    waitingFromSeq = null;
    busy.value = false;
    error.value = "요청을 보내지 못했습니다. 연결을 확인해주세요.";
  });
};

const save = async () => {
  if (!pickedFile.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const uploaded = await uploadAttachment(pickedFile.value);
    send(uploaded.id);
  } catch (e) {
    busy.value = false;
    error.value = e instanceof Error ? e.message : "이미지를 올리지 못했습니다.";
  }
};

const resetToDefault = () => {
  if (busy.value) return;
  clearPreview();
  busy.value = true;
  error.value = "";
  send(null);
};

watch(
  () => props.result,
  (r) => {
    if (!r || waitingFromSeq === null || r.seq <= waitingFromSeq) return;
    waitingFromSeq = null;
    busy.value = false;
    if (r.ok) {
      clearPreview();
      emit("cancel");
    } else {
      error.value = r.text;
    }
  },
);
</script>

<template>
  <div class="modal-backdrop" @click="emit('cancel')">
    <div class="modal-card" @click.stop>
      <h3>{{ title }}</h3>
      <div class="preview">
        <ProfileAvatar :image="currentImage" :preview-url="previewUrl" :size="140" :group="group" />
        <p class="caption">
          {{ previewUrl ? "새 이미지 미리보기 (저장을 눌러야 적용됩니다)" : currentImage ? "현재 이미지" : "기본 이미지" }}
        </p>
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onFileChange" />
      <div class="picker-row">
        <button class="small-btn" :disabled="busy" @click="openPicker">새 이미지 업로드</button>
        <button class="small-btn" :disabled="busy || !isConnected || (!currentImage && !previewUrl)" @click="resetToDefault">
          초기화
        </button>
      </div>
      <p v-if="note" class="note">{{ note }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="modal-actions">
        <button class="small-btn" @click="emit('cancel')">취소</button>
        <button class="small-btn primary" :disabled="busy || !pickedFile || !isConnected" @click="save">
          {{ busy ? "저장 중..." : "저장" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.modal-card {
  width: 300px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  font-family: sans-serif;
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.preview { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.caption { margin: 0; font-size: 12px; color: #666; text-align: center; }
.hidden-input { display: none; }
.picker-row { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.small-btn {
  padding: 6px 12px; font-size: 13px;
  border: 1px solid #ddd; border-radius: 6px;
  background: #fff; cursor: pointer;
}
.small-btn:disabled { color: #aaa; cursor: default; }
.small-btn.primary { background: #007bff; color: #fff; border-color: #007bff; }
.small-btn.primary:disabled { background: #8fbfff; border-color: #8fbfff; color: #fff; }
.note { color: #666; font-size: 12px; margin: 10px 0 0; text-align: center; }
.error { color: #d33; font-size: 13px; margin: 8px 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
