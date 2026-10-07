<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { ChatMessage, ChatUser } from "../types/chat";
import RoomMembersModal from "./RoomMembersModal.vue";

const props = withDefaults(
  defineProps<{
    peer: string;
    myUserNo: number | null;
    myNickname: string;
    messages: ChatMessage[];
    connectionStatus: string;
    isConnected: boolean;
    /** 현재 채팅방 참여자 (상단 '참여자' 버튼 모달에 표시) */
    members?: ChatUser[];
    /** 더 불러올 이전 대화가 있는지 (위로 스크롤 무한로딩) */
    hasMore?: boolean;
    /** 이전 대화를 불러오는 중인지 */
    loadingOlder?: boolean;
  }>(),
  { members: () => [], hasMore: false, loadingOlder: false },
);

const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "load-older"): void;
  (e: "close"): void;
}>();

const draft = ref("");
// 상단 '참여자' 버튼 → 참여자 목록 모달
const showMembersModal = ref(false);
const bodyRef = ref<HTMLDivElement | null>(null);
// 이전 대화를 보는 중(바닥에서 떨어져 있음)인지 → '맨 아래로' 버튼 표시
const awayFromBottom = ref(false);
// 바닥에서 떨어져 있는 동안 도착한 상대 메시지 수 → '새 메시지(n)' 버튼 표시
const newCount = ref(0);

const scrollToBottom = async () => {
  await nextTick();
  const el = bodyRef.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
  updateBottomState();
};

const send = () => {
  const text = draft.value.trim();
  if (text === "") return;
  emit("send", text);
  draft.value = "";
  void scrollToBottom();
};

// ─── 이전 대화 더보기 (카톡식 위로 무한스크롤) ───
// 맨 위 근처까지 스크롤하면 load-older 를 올리고, 이전 대화가 앞에 붙으면
// 늘어난 높이만큼 scrollTop 을 밀어 보고 있던 위치를 그대로 유지한다.
const LOAD_OLDER_THRESHOLD_PX = 60;
// 바닥에서 이 거리 안에 있을 때만 새 메시지 도착 시 자동으로 맨 아래로 내린다
// (이전 대화를 읽는 중에 새 메시지가 와도 화면이 튀지 않게)
const STICK_TO_BOTTOM_PX = 120;
let restoreFrom: { height: number; top: number } | null = null;

const requestOlder = () => {
  const el = bodyRef.value;
  if (!el || !props.hasMore || props.loadingOlder || restoreFrom) return;
  if (props.messages.length === 0) return;
  restoreFrom = { height: el.scrollHeight, top: el.scrollTop };
  emit("load-older");
};

const onScroll = () => {
  const el = bodyRef.value;
  if (el && el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) requestOlder();
  updateBottomState();
};

// 내용이 화면보다 짧아 스크롤바가 없으면 스크롤 이벤트가 안 생기므로 바로 더 불러온다
const fillIfNoScroll = async () => {
  await nextTick();
  const el = bodyRef.value;
  if (el && el.scrollHeight <= el.clientHeight) requestOlder();
};

const isNearBottom = () => {
  const el = bodyRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
};

// 바닥 근처로 돌아오면 버튼을 숨기고 새 메시지 수를 비운다
function updateBottomState() {
  const near = isNearBottom();
  awayFromBottom.value = !near;
  if (near) newCount.value = 0;
}

// '새 메시지(n)' / '맨 아래로' 버튼 → 가장 최근 메시지로 이동
const jumpToBottom = () => {
  void scrollToBottom();
};

const keyOf = (msg: ChatMessage | undefined) => msg?.msgId ?? msg;

onMounted(() => {
  void scrollToBottom().then(fillIfNoScroll);
});

watch(
  () => [keyOf(props.messages[0]), keyOf(props.messages[props.messages.length - 1]), props.messages.length] as const,
  async ([first, last, len], [prevFirst, prevLast, prevLen]) => {
    const el = bodyRef.value;
    // 이전 대화가 앞에 붙음 (끝은 그대로) → 보던 위치 유지
    if (restoreFrom && last === prevLast && first !== prevFirst) {
      const { height, top } = restoreFrom;
      restoreFrom = null;
      await nextTick();
      if (el) el.scrollTop = el.scrollHeight - height + top;
      void fillIfNoScroll();
      return;
    }
    if (last === prevLast && first === prevFirst) return;
    // 새 메시지 도착 → 바닥 근처이거나 내가 보낸 메시지면 맨 아래로
    // 목록 전체가 바뀜(방 열기/재조회) → 맨 아래로
    const lastMsg = props.messages[props.messages.length - 1];
    const replaced = first !== prevFirst;
    if (replaced) {
      restoreFrom = null;
      newCount.value = 0;
    }
    if (replaced || lastMsg?.user_no === props.myUserNo || isNearBottom()) {
      await scrollToBottom();
      if (replaced) void fillIfNoScroll();
    } else {
      // 이전 대화를 보는 중 → 끌어내리지 않고 뒤에 붙은 상대 메시지 수만 센다
      const added = Math.max(0, len - prevLen);
      newCount.value += props.messages
        .slice(len - added)
        .filter((m) => m.user_no !== props.myUserNo).length;
      awayFromBottom.value = true;
    }
  },
);

// 응답이 비었거나(이어 붙일 것 없음) 버려진 경우 위치 복원 대기를 푼다
watch(
  () => props.loadingOlder,
  (loading, wasLoading) => {
    if (wasLoading && !loading) {
      void nextTick(() => {
        restoreFrom = null;
      });
    }
  },
);
</script>

<template>
  <div class="chat-screen">
    <div class="chat-window">
      <div class="chat-header">
        <span class="peer">{{ peer }}님과의 1:1 채팅</span>
        <span class="header-actions">
          <!-- 채팅방 상단 연필 등, 창마다 다른 액션 슬롯 -->
          <button
            class="members-btn"
            title="참여자 목록"
            @click="showMembersModal = true"
          >👥 {{ members.length }}</button>
          <slot name="header-actions" />
          <button class="close-btn" @click="$emit('close')">✕</button>
        </span>
      </div>
      <div v-if="!isConnected" class="conn-banner">{{ connectionStatus }}</div>
      <div class="chat-body-wrap">
        <div ref="bodyRef" class="chat-body" @scroll.passive="onScroll">
          <p v-if="messages.length === 0" class="empty">
            아직 대화가 없습니다. 첫 메시지를 보내보세요.
          </p>
          <p v-else-if="loadingOlder" class="history-edge">이전 대화를 불러오는 중…</p>
          <p v-else-if="!hasMore" class="history-edge">대화의 시작입니다</p>
          <!-- 이전 대화가 앞에 붙어도 기존 행이 재사용되도록 서버 msgId 로 키를 잡는다 -->
          <div
            v-for="(msg, index) in messages"
            :key="msg.msgId ?? `local-${index}`"
            class="message-row"
            :class="msg.user_no === myUserNo ? 'row-self' : 'row-other'"
          >
            <!-- 카톡식 읽음 표시: 아직 안 읽은 사람이 있으면 숫자를 붙인다.
                 내 메시지(message-self)와 상대 메시지(message-other) 모두 붙는다.
                 발신자를 제외한 미열람 인원이며, blur 중이면 '나'도 세어진다.
                 (focus 하면 unread_clear → 읽음 커서가 앞서므로 자동으로 빠진다)
                 예) 3명 방에서 A 발신 → B 채팅창 blur, C 미열람
                     A/B 화면 '2'  →  B가 focus 하면 양쪽 '1' -->
            <span
              v-if="(msg.unreadCount ?? 0) > 0"
              class="unread-count"
              :title="`${msg.unreadCount}명이 아직 읽지 않았습니다`"
            >{{ msg.unreadCount }}</span>
            <div
              class="bubble"
              :class="msg.user_no === myUserNo ? 'message-self' : 'message-other'"
            >
              <div class="message-content">
                <span class="nickname" v-if="msg.user_no !== myUserNo">
                  [{{ msg.nickname }}]
                </span>
                {{ msg.text }}
              </div>
            </div>
          </div>
        </div>
        <!-- 이전 대화를 보는 중: 새 메시지가 오면 '새 메시지(n)', 아니면 '맨 아래로' 버튼 -->
        <button
          v-if="newCount > 0"
          class="jump-btn new-msg-btn"
          @click="jumpToBottom"
        >새 메시지({{ newCount }}) ↓</button>
        <button
          v-else-if="awayFromBottom"
          class="jump-btn to-bottom-btn"
          title="가장 최근 메시지로"
          aria-label="가장 최근 메시지로"
          @click="jumpToBottom"
        >↓</button>
      </div>
      <div class="chat-footer">
        <input
          v-model="draft"
          placeholder="메시지를 입력하세요"
          @keyup.enter="send"
        />
        <button :disabled="!draft.trim() || !isConnected" @click="send">전송</button>
      </div>
    </div>
  </div>

  <RoomMembersModal
    v-if="showMembersModal"
    :members="members"
    :my-user-no="myUserNo"
    @close="showMembersModal = false"
  />
</template>

<style scoped>
.chat-screen {
  height: 100vh;
  height: 100dvh;
  display: flex;
  background: #f4f6f8;
}
.chat-window {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
  font-family: sans-serif;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: #007bff;
  color: #fff;
  font-weight: bold;
}
.close-btn {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
/* 상단 참여자 버튼 (👥 인원수) */
.members-btn {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  opacity: 0.9;
}
.members-btn:hover { background: rgba(255, 255, 255, 0.2); opacity: 1; }
/* 헤더 우측 액션 영역 (슬롯 + 닫기 버튼) */
.header-actions { display: flex; align-items: center; gap: 8px; }
.conn-banner {
  padding: 6px 12px;
  font-size: 12px;
  color: #856404;
  background: #fff3cd;
  border-bottom: 1px solid #ffeeba;
}
/* 메시지 목록 + 그 위에 떠 있는 '새 메시지 / 맨 아래로' 버튼 */
.chat-body-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f4f6f8;
}
.empty {
  color: #888;
  font-size: 13px;
  text-align: center;
}
/* 목록 맨 위: 이전 대화 불러오는 중 / 대화의 시작 */
.history-edge {
  margin: 0;
  color: #999;
  font-size: 12px;
  text-align: center;
}
/* 한 줄(숫자 + 풍선)을 감싸는 행 — 내 줄은 오른쪽, 상대 줄은 왼쪽 */
.message-row {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  max-width: 75%;
}
.row-self { align-self: flex-end; flex-direction: row; }
.row-other { align-self: flex-start; }
/* 상대 메시지(message-other): 숫자를 풍선 오른쪽에 둔다 (카톡의 받은 메시지 표시) */
.row-other .unread-count { order: 2; }
/* 풍선 색상 — 내 메시지(초록) / 상대 메시지(흰색) */
.message-self {
  background: #d1e7dd;
  padding: 8px 12px;
  border-radius: 14px;
  color: #000;
}
.message-other {
  background: #fff;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid #eee;
  color: #000;
}
/* 숫자 뱃지: 작고 흐린 회색 (카톡의 '1' 느낌) */
.unread-count {
  color: #999;
  font-size: 11px;
  line-height: 1;
  padding-bottom: 3px;
  flex-shrink: 0;
  user-select: none;
}
.message-content {
  word-break: break-word;
  font-size: 14px;
}
.nickname {
  font-weight: bold;
  margin-right: 4px;
}
.jump-btn {
  position: absolute;
  bottom: 12px;
  border: none;
  cursor: pointer;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.jump-btn:hover { background: rgba(0, 0, 0, 0.75); }
/* 새 메시지(n): 가운데 알약 모양, 강조색 */
.new-msg-btn {
  left: 50%;
  transform: translateX(-50%);
  padding: 7px 14px;
  border-radius: 16px;
  font-size: 13px;
  background: #007bff;
  white-space: nowrap;
}
.new-msg-btn:hover { background: #0069d9; }
/* 맨 아래로: 오른쪽 아래 동그란 버튼 */
.to-bottom-btn {
  right: 14px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
}
.chat-footer {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #eee;
}
.chat-footer input {
  flex: 1;
  padding: 9px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.chat-footer button {
  padding: 9px 14px;
  font-size: 14px;
  border: none;
  border-radius: 8px;
  background: #007bff;
  color: #fff;
  cursor: pointer;
}
.chat-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

