<script setup lang="ts">
import { computed, ref } from "vue";
import { truncateRoomTitle } from "../types/chat";
import type { ChatUser } from "../types/chat";
import UserSearchInput from "./UserSearchInput.vue";

const props = withDefaults(
  defineProps<{
    users: ChatUser[];
    initialSelected?: number[];
    myNickname?: string;
    myUserNo?: number | null;
    /**
     * create = 방 만들기 (기본, 기존 동작 불변)
     * invite = 초대하기 (제목만 바꾸고 '방 이름' 표시와 안내문구를 숨긴다)
     */
    mode?: "create" | "invite";
    /** 초대 시 기존 멤버 제외 — UserSearchInput 검색/선택에서 빠진다 */
    excludeNos?: number[];
    /** 전송 실패 사유 — 있을 때만 빨간 문구로 표시 */
    errorReason?: string;
  }>(),
  { mode: "create" },
);

const emit = defineEmits<{
  (e: "confirm", payload: { members: number[] }): void;
  (e: "cancel"): void;
}>();

const selected = ref<Set<number>>(new Set(props.initialSelected ?? []));
const error = ref("");

const toggle = (userNo: number) => {
  const next = new Set(selected.value);
  if (next.has(userNo)) next.delete(userNo);
  else next.add(userNo);
  selected.value = next;
  error.value = "";
};

// ─── 사용자 검색 (UserSearchInput 공통컴포넌트) ───
// 검색창 UI/필터링은 컴포넌트가 담당하고, 여기에는 v-model 연결 상태만 남긴다.
// 검색 결과(filteredUsers)와 선택 상태(selected)는 서로 다른 상태다.
// 검색어를 바꿔도 selected는 그대로 유지되므로, 여러 번 검색해도 위 칩 목록에서
// 현재 체크된 사용자를 그대로 확인할 수 있다.
// (모달은 HomeView에서 v-if로 매번 새로 마운트되므로 keyword는 자동 초기화된다)
const keyword = ref(""); // v-model:keyword 부모 측 저장소 (값 변경은 컴포넌트가 수행)
const filteredUsers = ref<ChatUser[]>([]); // v-model:results 부모 측 저장소 (컴포넌트가 결과를 채운다)

// 칩의 [×]와 목록 체크박스는 같은 동작(토글)이다.
const removeChip = (userNo: number) => toggle(userNo);

// 선택한 사용자 한꺼번에 해제
const clearSelected = () => {
  selected.value = new Set();
  error.value = "";
};

// Esc: 검색어 정리는 컴포넌트 내부에서 처리하고, 여기로 올 때는 검색어가 이미 없다 → 모달 닫기
const onEsc = () => {
  emit("cancel");
};

// ─── 방 이름 자동 생성 ───
// 1:1방(나 + 선택 1명): 서로의 이름이 뜸(서버가 상대 닉네임을 display_name으로 저장)
// 3명 이상: 참여자 이름 전체를 오름차순으로 쉼표 연결 (arr.join(','))
// DB/서버로는 전체 이름을 그대로 보내고, 화면 미리보기만 20자까지 축약한다.
const memberList = computed<number[]>(() => Array.from(selected.value));
const participantNames = computed<string[]>(() => {
  const names = new Set<string>();
  const me = props.myNickname?.trim();
  if (me) names.add(me);
  for (const u of props.users) {
    if (memberList.value.includes(u.user_no)) names.add(u.nickname);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
});
const isOneToOne = computed<boolean>(() => memberList.value.length === 1);
// 서버로 보낼(그리고 rooms.name으로 저장될) 방 이름 — 미축약 전체값
const defaultName = computed<string>(() => participantNames.value.join(","));
// 화면 미리보기용 제목
const previewName = computed<string>(() =>
  isOneToOne.value ? "1:1 대화" : truncateRoomTitle(defaultName.value),
);
const previewHint = computed<string>(() => {
  if (memberList.value.length === 0) return "참여자를 선택하면 방 이름이 자동 생성됩니다.";
  if (isOneToOne.value) {
    const peer = props.users.find((u) => u.user_no === memberList.value[0]);
    return `나에게는 "${peer?.nickname ?? ""}", 상대에게는 내 이름이 방 이름으로 보입니다.`;
  }
  return `${participantNames.value.length}명 참여 (이름 오름차순) · 방 이름은 자동 생성됩니다.`;
});

const confirm = () => {
  if (selected.value.size < 1) {
    error.value = "사용자를 한 명 이상 선택하세요.";
    return;
  }
  error.value = "";
  // 방 이름은 서버가 멤버 기준으로 자동 생성한다(선택된 멤버만 전달).
  emit("confirm", { members: memberList.value });
};
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">{{ mode === "invite" ? "초대하기" : "방 만들기" }}</h3>
      <!-- 초대하기에서는 '방 이름' 표시와 안내문구를 보여주지 않는다 (요청 화면 = 이 둘을 뺀 화면) -->
      <template v-if="mode !== 'invite'">
        <div class="room-name-box">
          <span class="room-name-label">방 이름</span>
          <span class="room-name-value" :title="defaultName">{{ previewName }}</span>
        </div>
        <p class="modal-desc">{{ previewHint }}</p>
      </template>

      <!-- ① 선택한 사용자: 검색과 분리된 고정 영역 (검색어를 바꿔도 유지된다) -->
      <div class="selected-box">
        <div class="selected-head">
          <span class="selected-title">선택한 사용자 ({{ selected.size }}명)</span>
          <button
            v-if="selected.size > 0"
            class="clear-all-btn"
            @click="clearSelected"
          >
            전체 해제
          </button>
        </div>
        <p v-if="selected.size === 0" class="selected-empty">
          아래 목록에서 초대할 사용자를 선택하세요.
        </p>
        <div v-else class="chip-list">
          <span v-for="no in memberList" :key="no" class="chip">
            <span class="chip-avatar">{{ (props.users.find((u) => u.user_no === no)?.nickname ?? "").slice(0, 1) }}</span>
            <span class="chip-name" :title="props.users.find((u) => u.user_no === no)?.nickname ?? ''">{{ props.users.find((u) => u.user_no === no)?.nickname ?? no }}</span>
            <button
              class="chip-x"
              :title="(props.users.find((u) => u.user_no === no)?.nickname ?? '') + ' 선택 해제'"
              @click="removeChip(no)"
            >
              ×
            </button>
          </span>
        </div>
      </div>

      <!-- ② 검색: UserSearchInput이 결과(filteredUsers)를 채우고, 선택(selected)은 여기서 계속 관리한다 -->
      <UserSearchInput
        v-model:keyword="keyword"
        v-model:results="filteredUsers"
        :users="users"
        :exclude-nos="excludeNos"
        @esc="onEsc"
      />

      <p v-if="users.length === 0" class="empty">현재 초대 가능한 사용자가 없습니다.</p>
      <p v-else-if="filteredUsers.length === 0" class="empty">
        "{{ keyword }}" 검색 결과가 없습니다.
      </p>
      <ul v-else class="select-list">
        <li v-for="user in filteredUsers" :key="user.user_no" class="select-item">
          <label>
            <input
              type="checkbox"
              :checked="selected.has(user.user_no)"
              @change="toggle(user.user_no)"
            />
            <span class="avatar">{{ user.nickname.slice(0, 1) }}</span>
            <span class="name">{{ user.nickname }}</span>
          </label>
        </li>
      </ul>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="errorReason" class="error">{{ errorReason }}</p>
      <div class="modal-btns">
        <button class="cancel" @click="$emit('cancel')">취소</button>
        <button
          class="primary"
          :disabled="selected.size < 1"
          @click="confirm"
        >
          확인
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
  box-sizing: border-box;
}
.modal {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  width: 360px;
  max-width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  font-family: sans-serif;
}
.modal-title { margin: 0 0 12px; font-size: 17px; }
/* 방 이름 입력란 제거 → 자동 생성된 이름만 읽기 전용으로 보여준다 */
.room-name-box {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #eee;
  border-radius: 8px;
  box-sizing: border-box;
  background: #f7f9fc;
}
.room-name-label { font-size: 12px; color: #888; flex-shrink: 0; }
.room-name-value {
  flex: 1;
  min-width: 0;
  font-weight: bold;
  color: #222;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-desc { font-size: 13px; color: #555; margin: 10px 0 8px; }
.empty { font-size: 13px; color: #888; }

/* ─── 선택한 사용자(칩) 영역: 검색과 분리된 고정 영역 ─── */
.selected-box {
  padding: 9px 10px;
  border: 1px solid #eee;
  border-radius: 8px;
  box-sizing: border-box;
  background: #f7f9fc;
}
.selected-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.selected-title { font-size: 12px; color: #888; }
.clear-all-btn {
  padding: 2px 6px;
  font-size: 11px;
  color: #888;
  background: none;
  border: none;
  cursor: pointer;
}
.clear-all-btn:hover { color: #d33; text-decoration: underline; }
.selected-empty { font-size: 12px; color: #999; margin: 0; }
/* 선택 인원이 많아도 아래 검색 결과 목록을 밀지 않도록 칩 영역만 스크롤 */
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 84px;
  overflow-y: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 6px 3px 4px;
  background: #fff;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  font-size: 13px;
}
.chip-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #007bff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
}
.chip-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-x {
  border: none;
  background: none;
  color: #999;
  font-size: 15px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
}
.chip-x:hover { color: #d33; }

.select-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.select-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.select-item label:hover { background: #f2f7ff; }
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #007bff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 13px;
}
.name { flex: 1; word-break: break-all; }
.error { color: #d33; font-size: 13px; }
.modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.modal-btns button {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #ddd;
  background: #fff;
  cursor: pointer;
}
.modal-btns button.primary { background: #007bff; border-color: #007bff; color: #fff; }
.modal-btns button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
