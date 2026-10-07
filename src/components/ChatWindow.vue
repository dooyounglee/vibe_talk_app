<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ChatAttachment, ChatMessage, ChatUser, RoomSearchState } from "../types/chat";
import { formatFileSize, isImageAttachment } from "../types/chat";
import { splitHighlight } from "../utils/highlight";
import { attachmentUrl, downloadAttachment } from "../utils/attachment";
import { openImageWindow } from "../utils/imageWindow";
import MessageSearchBar from "./MessageSearchBar.vue";
import ProfileAvatar from "./ProfileAvatar.vue";
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
    /** 검색 결과로 점프해 과거 구간을 보는 중이라 아래로 더 불러올 대화가 있는지 */
    hasNewer?: boolean;
    /** 이후 대화를 불러오는 중인지 */
    loadingNewer?: boolean;
    /** 메시지 검색 상태 (서버 결과). null 이면 검색 중이 아님 */
    search?: RoomSearchState | null;
    /** 첨부파일을 올리는 중인지 */
    uploading?: boolean;
    /** 첨부파일 전송 실패 문구 (빈 문자열이면 표시하지 않음) */
    attachError?: string;
  }>(),
  {
    members: () => [], hasMore: false, loadingOlder: false,
    hasNewer: false, loadingNewer: false, search: null,
    uploading: false, attachError: "",
  },
);

const emit = defineEmits<{
  (e: "send", text: string): void;
  /** 첨부파일 전송 (📎 선택 / 끌어놓기 / Ctrl+V) */
  (e: "send-files", files: File[]): void;
  /** 첨부 실패 문구 닫기 */
  (e: "dismiss-attach-error"): void;
  (e: "load-older"): void;
  (e: "close"): void;
  /** 메시지 검색 (빈 문자열 = 검색 해제) */
  (e: "search", keyword: string): void;
  /** 화면에 없는 검색 결과로 점프 (그 메시지를 가운데 둔 페이지 요청) */
  (e: "jump", msgId: number): void;
  /** 점프 후 아래로 스크롤 끝 → 이후 대화 */
  (e: "load-newer"): void;
  /** 점프 상태에서 최신 대화로 복귀 */
  (e: "load-latest"): void;
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
  // 검색 점프로 과거 구간을 보는 중이면 최신 대화로 돌아가서 보낸 메시지를 보여준다
  if (props.hasNewer) emit("load-latest");
  else void scrollToBottom();
};

// ─── 첨부파일: 📎 버튼 / 채팅창에 끌어놓기 / 입력창에 Ctrl+V ───
const fileInputRef = ref<HTMLInputElement | null>(null);
// 끌어놓기 중 오버레이 표시 (자식 요소를 지날 때마다 enter/leave 가 생기므로 깊이로 센다)
const dragDepth = ref(0);
const dragActive = computed(() => dragDepth.value > 0);

const sendFiles = (files: File[]) => {
  if (files.length === 0 || !props.isConnected) return;
  emit("send-files", files);
  // 검색 점프로 과거 구간을 보는 중이면 최신 대화로 돌아가서 보낸 파일을 보여준다
  if (props.hasNewer) emit("load-latest");
  else void scrollToBottom();
};

const openFilePicker = () => {
  if (!props.isConnected) return;
  fileInputRef.value?.click();
};

const onFileInputChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  sendFiles(Array.from(input.files ?? []));
  // 같은 파일을 다시 골라도 change 가 생기도록 비운다
  input.value = "";
};

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

const onDragEnter = (e: DragEvent) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth.value += 1;
};
const onDragOver = (e: DragEvent) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = props.isConnected ? "copy" : "none";
};
const onDragLeave = (e: DragEvent) => {
  if (!hasFiles(e)) return;
  dragDepth.value = Math.max(0, dragDepth.value - 1);
};
const onDrop = (e: DragEvent) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth.value = 0;
  sendFiles(Array.from(e.dataTransfer?.files ?? []));
};

// 클립보드에 파일(캡처 이미지/탐색기에서 복사한 파일)이 있으면 첨부로 보낸다. 글자만 있으면 평소대로 붙여넣는다.
const onPaste = (e: ClipboardEvent) => {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length === 0) return;
  e.preventDefault();
  sendFiles(files);
};

// ─── 첨부 표시: 이미지 클릭 → 이미지마다 새 창(확대/축소), 다운로드 ───
const downloadError = ref("");

const openImage = async (file: ChatAttachment) => {
  downloadError.value = "";
  if (!(await openImageWindow(file))) {
    downloadError.value = "이미지 창을 열지 못했습니다. 팝업 차단을 확인해주세요.";
  }
};

const download = async (file: ChatAttachment) => {
  downloadError.value = "";
  try {
    await downloadAttachment(file);
  } catch {
    downloadError.value = `파일을 받지 못했습니다: ${file.name}`;
  }
};

// 바닥을 보고 있을 때 이미지가 늦게 로드되어 높이가 늘면 다시 맨 아래로 붙인다
const onImageLoad = () => {
  if (!awayFromBottom.value && !restoreFrom && pendingFocusId === null) void scrollToBottom();
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

// ─── 검색 점프 후 아래로 스크롤: 이후 대화를 뒤에 이어 붙인다 ───
// 이어 붙은 페이지 때문에 맨 아래로 끌려 내려가면 연쇄로 계속 불러오므로, 이 동안은 자동 스크롤하지 않는다.
let appendingNewer = false;
const requestNewer = () => {
  if (!props.hasNewer || props.loadingNewer || appendingNewer) return;
  if (props.messages.length === 0) return;
  appendingNewer = true;
  emit("load-newer");
};

const onScroll = () => {
  const el = bodyRef.value;
  if (el && el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) requestOlder();
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_OLDER_THRESHOLD_PX) requestNewer();
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
// 검색 점프로 과거 구간을 보는 중이면 최신 페이지를 다시 받아온다 (목록이 바뀌면 맨 아래로 내려간다)
const jumpToBottom = () => {
  if (props.hasNewer) emit("load-latest");
  else void scrollToBottom();
};

const keyOf = (msg: ChatMessage | undefined) => msg?.msgId ?? msg;

// ─── 카톡식 상대 메시지: 프로필 사진 + 닉네임 ───
// 같은 사람이 연달아 보낸 메시지는 첫 메시지에만 사진/닉네임을 붙이고 나머지는 들여쓰기만 한다.
const memberByNo = computed(() => new Map(props.members.map((m) => [m.user_no, m])));
const isMine = (msg: ChatMessage) => msg.user_no === props.myUserNo;
const startsGroup = (index: number) => {
  const msg = props.messages[index];
  const prev = props.messages[index - 1];
  return !prev || prev.user_no !== msg?.user_no;
};
// 닉네임은 현재 참여자 목록 기준(변경 반영), 방을 나간 사람은 메시지에 남은 닉네임으로
const senderName = (msg: ChatMessage) => memberByNo.value.get(msg.user_no)?.nickname || msg.nickname;
const senderImage = (msg: ChatMessage) => memberByNo.value.get(msg.user_no)?.profileImage ?? null;

// ─── 메시지 검색 (카톡식: 검색바 + ▲▼ 로 결과 순회) ───
const searchOpen = ref(false);
const searchKeyword = ref("");
// 지금 보고 있는 결과 위치 (search.ids 기준, 0 = 가장 최근 매치)
const activeIndex = ref(-1);
// 점프를 요청했고 그 메시지가 목록에 들어오면 스크롤할 대상
let pendingFocusId: number | null = null;

const searchIds = computed(() => props.search?.ids ?? []);
const activeMsgId = computed(() => searchIds.value[activeIndex.value] ?? null);
// 결과가 확정된 검색어만 본문에 하이라이트한다
const highlightKeyword = computed(() =>
  props.search && !props.search.loading ? props.search.keyword : "",
);

const rowOf = (msgId: number) =>
  bodyRef.value?.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`) ?? null;

// 결과 메시지로 이동: 화면에 있으면 바로 스크롤, 없으면 그 메시지를 가운데 둔 페이지를 요청한다
const focusMessage = async (msgId: number) => {
  await nextTick();
  const row = rowOf(msgId);
  if (row) {
    pendingFocusId = null;
    row.scrollIntoView({ block: "center" });
    updateBottomState();
    return;
  }
  pendingFocusId = msgId;
  emit("jump", msgId);
};

const moveTo = (index: number) => {
  const id = searchIds.value[index];
  if (id === undefined) return;
  activeIndex.value = index;
  void focusMessage(id);
};

// Enter: 새 검색어면 검색, 같은 검색어로 다시 누르면 이전(더 과거) 결과로
const onSearch = (keyword: string) => {
  const s = props.search;
  if (s && !s.loading && s.keyword === keyword) {
    if (activeIndex.value < s.ids.length - 1) moveTo(activeIndex.value + 1);
    return;
  }
  activeIndex.value = -1;
  emit("search", keyword);
};
const searchPrev = () => moveTo(activeIndex.value + 1);
const searchNext = () => moveTo(activeIndex.value - 1);

const toggleSearch = () => {
  if (searchOpen.value) closeSearch();
  else searchOpen.value = true;
};
// 검색 닫기: 하이라이트만 지우고 보고 있던 위치는 그대로 둔다
const closeSearch = () => {
  searchOpen.value = false;
  searchKeyword.value = "";
  activeIndex.value = -1;
  pendingFocusId = null;
  emit("search", "");
};

// 결과가 도착하면 가장 최근 매치로 이동한다
watch(
  () => props.search,
  (s, prev) => {
    if (!s) {
      activeIndex.value = -1;
      return;
    }
    if (s.loading) return;
    const arrived = !prev || prev.loading || prev.keyword !== s.keyword;
    if (!arrived) return;
    if (s.ids.length > 0) moveTo(0);
    else activeIndex.value = -1;
  },
);

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
    // 검색 결과 점프로 목록이 바뀜 → 맨 아래 대신 그 메시지로 스크롤
    if (pendingFocusId !== null && props.messages.some((m) => m.msgId === pendingFocusId)) {
      const target = pendingFocusId;
      pendingFocusId = null;
      restoreFrom = null;
      appendingNewer = false;
      newCount.value = 0;
      await nextTick();
      rowOf(target)?.scrollIntoView({ block: "center" });
      updateBottomState();
      return;
    }
    // 점프 후 아래로 이어 붙은 이후 대화 → 보던 위치 유지 (끌어내리지 않음)
    if (appendingNewer && first === prevFirst) {
      appendingNewer = false;
      return;
    }
    if (last === prevLast && first === prevFirst) return;
    // 새 메시지 도착 → 바닥 근처이거나 내가 보낸 메시지면 맨 아래로
    // 목록 전체가 바뀜(방 열기/재조회) → 맨 아래로
    const lastMsg = props.messages[props.messages.length - 1];
    const replaced = first !== prevFirst;
    if (replaced) {
      restoreFrom = null;
      appendingNewer = false;
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
watch(
  () => props.loadingNewer,
  (loading, wasLoading) => {
    if (wasLoading && !loading) {
      void nextTick(() => {
        appendingNewer = false;
      });
    }
  },
);
</script>

<template>
  <div class="chat-screen">
    <div
      class="chat-window"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="dragActive" class="drop-overlay">
        <span>{{ isConnected ? "여기에 놓으면 파일을 보냅니다" : "연결이 끊겨 파일을 보낼 수 없습니다" }}</span>
      </div>
      <div class="chat-header">
        <span class="peer">{{ peer }}님과의 1:1 채팅</span>
        <span class="header-actions">
          <button
            class="members-btn search-btn"
            :class="{ active: searchOpen }"
            title="대화 내용 검색"
            aria-label="대화 내용 검색"
            @click="toggleSearch"
          >🔍</button>
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
      <MessageSearchBar
        v-if="searchOpen"
        v-model:keyword="searchKeyword"
        :total="searchIds.length"
        :index="activeIndex"
        :loading="search?.loading === true"
        :searched="search !== null"
        :truncated="search?.truncated === true"
        @search="onSearch"
        @prev="searchPrev"
        @next="searchNext"
        @close="closeSearch"
      />
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
            :class="[
              isMine(msg) ? 'row-self' : 'row-other',
              {
                'row-continued': !startsGroup(index),
                'search-active': msg.msgId !== undefined && msg.msgId === activeMsgId,
              },
            ]"
            :data-msg-id="msg.msgId"
          >
            <!-- 상대 메시지: 왼쪽 프로필 사진 (연속 메시지는 같은 폭의 빈 자리로 정렬만 맞춘다) -->
            <template v-if="!isMine(msg)">
              <ProfileAvatar
                v-if="startsGroup(index)"
                class="sender-avatar"
                :image="senderImage(msg)"
                :size="38"
              />
              <span v-else class="sender-avatar-space" />
            </template>
            <div class="message-main">
              <div v-if="!isMine(msg) && startsGroup(index)" class="sender-name">{{ senderName(msg) }}</div>
              <div class="bubble-line">
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
                  <div v-if="msg.file" class="message-content attachment">
                    <!-- 이미지: 바로 보이고 클릭하면 새 창에서 확대/축소 -->
                    <div v-if="isImageAttachment(msg.file)" class="att-image-wrap">
                      <img
                        class="att-image"
                        :src="attachmentUrl(msg.file)"
                        :alt="msg.file.name"
                        :title="msg.file.name"
                        loading="lazy"
                        @click="openImage(msg.file)"
                        @load="onImageLoad"
                      />
                      <button
                        class="att-image-download"
                        title="다운로드"
                        aria-label="다운로드"
                        @click.stop="download(msg.file)"
                      >⬇</button>
                    </div>
                    <!-- 그 외 파일: 이름/크기 + 다운로드 -->
                    <button
                      v-else
                      class="att-file"
                      :title="`${msg.file.name} 다운로드`"
                      @click="download(msg.file)"
                    >
                      <span class="att-file-icon">📄</span>
                      <span class="att-file-info">
                        <span class="att-file-name">{{ msg.file.name }}</span>
                        <span class="att-file-size">{{ formatFileSize(msg.file.size) }} · 다운로드</span>
                      </span>
                    </button>
                  </div>
                  <div v-else class="message-content">
                    <!-- 검색어 하이라이트: v-html 없이 조각으로 나눠 <mark> 로 감싼다 -->
                    <template v-if="highlightKeyword">
                      <template
                        v-for="(seg, i) in splitHighlight(msg.text, highlightKeyword)"
                        :key="i"
                      ><mark v-if="seg.hit" class="search-hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
                    </template>
                    <template v-else>{{ msg.text }}</template>
                  </div>
                </div>
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
        <!-- 검색 점프로 과거 구간을 보는 중이면 바닥 근처여도 최신으로 돌아갈 수 있게 항상 보인다 -->
        <button
          v-else-if="awayFromBottom || hasNewer"
          class="jump-btn to-bottom-btn"
          title="가장 최근 메시지로"
          aria-label="가장 최근 메시지로"
          @click="jumpToBottom"
        >↓</button>
      </div>
      <div v-if="attachError || downloadError" class="attach-error">
        <span>{{ attachError || downloadError }}</span>
        <button
          aria-label="닫기"
          @click="attachError ? emit('dismiss-attach-error') : (downloadError = '')"
        >✕</button>
      </div>
      <div v-if="uploading" class="attach-status">파일을 보내는 중…</div>
      <div class="chat-footer">
        <button
          class="attach-btn"
          title="파일 첨부 (끌어놓기 / Ctrl+V 도 가능)"
          aria-label="파일 첨부"
          :disabled="!isConnected"
          @click="openFilePicker"
        >📎</button>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="file-input"
          @change="onFileInputChange"
        />
        <input
          v-model="draft"
          placeholder="메시지를 입력하세요"
          @keyup.enter="send"
          @paste="onPaste"
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
  position: relative;
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
/* 한 행 — 내 줄은 오른쪽, 상대 줄은 왼쪽(프로필 사진 + 닉네임 + 풍선) */
.message-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 75%;
}
.row-self { align-self: flex-end; }
.row-other { align-self: flex-start; }
/* 같은 사람의 연속 메시지는 간격을 좁힌다 (카톡처럼 한 묶음으로 보이게) */
.row-continued { margin-top: -4px; }
/* 상대 프로필 사진 / 연속 메시지의 빈 자리 (사진과 같은 폭) */
.row-other .sender-avatar { border-radius: 38%; }
.sender-avatar-space { width: 38px; flex-shrink: 0; }
.message-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.row-self .message-main { align-items: flex-end; }
.sender-name {
  margin: 1px 0 4px 2px;
  font-size: 12px;
  color: #555;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 숫자 + 풍선 한 줄 */
.bubble-line {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  max-width: 100%;
}
.bubble { min-width: 0; }
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
/* 검색 버튼: 검색바가 열려 있으면 눌린 상태로 */
.search-btn.active { background: rgba(255, 255, 255, 0.25); opacity: 1; }
/* 검색어 일치 부분 / 지금 보고 있는 검색 결과 */
.search-hit {
  background: #ffe066;
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}
.search-active .bubble {
  box-shadow: 0 0 0 2px #ffb800;
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
/* ─── 첨부파일 ─── */
.chat-footer .attach-btn {
  padding: 9px 10px;
  background: #f1f3f5;
  color: #333;
  font-size: 16px;
  line-height: 1;
}
.chat-footer .attach-btn:hover:not(:disabled) { background: #e2e6ea; }
.file-input { display: none; }
.attach-status,
.attach-error {
  padding: 6px 12px;
  font-size: 12px;
  border-top: 1px solid #eee;
}
.attach-status { color: #555; background: #f8f9fa; }
.attach-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #842029;
  background: #f8d7da;
}
.attach-error button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
/* 끌어놓기 중 채팅창 전체를 덮는 안내 */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 123, 255, 0.12);
  border: 3px dashed #007bff;
  pointer-events: none;
  font-size: 15px;
  font-weight: bold;
  color: #0056b3;
}
.drop-overlay span {
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
}
.att-image-wrap { position: relative; display: inline-block; }
.att-image {
  display: block;
  max-width: 240px;
  max-height: 240px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 8px;
  cursor: zoom-in;
  background: #e9ecef;
  object-fit: contain;
}
.att-image-download {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.att-image-wrap:hover .att-image-download,
.att-image-download:focus-visible { opacity: 1; }
.att-file {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 6px 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.att-file:hover { background: rgba(255, 255, 255, 0.95); }
.att-file-icon { font-size: 22px; flex-shrink: 0; }
.att-file-info { display: flex; flex-direction: column; min-width: 0; }
.att-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: bold;
}
.att-file-size { font-size: 11px; color: #666; }
</style>

