import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ComputedRef } from "vue";
import {
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentMainIdFromUrl,
  currentRoomIdFromUrl,
  isTauriRuntime,
  type ChatBus,
  type ChatBusHandler,
} from "../chatBus";
import type { ChatMessage, ChatUser, RoomSearchState } from "../types/chat";
import { roomDisplayName, truncateRoomTitle, ROOM_TITLE_INPUT_MAX_LENGTH } from "../types/chat";
import { useChatSocket } from "./useChatSocket";
import { useWindowFocus } from "./useWindowFocus";
import { MAX_ATTACHMENTS_PER_SEND, uploadAttachment } from "../utils/attachment";

const LINK_TIMEOUT_MS = 3500;

export function useChatRoom(roomId: { readonly value: number }) {
  const store = useChatSocket();
  const myMainId = currentMainIdFromUrl();
  const direct = computed(() => store.loginId.value.trim() !== "");
  const effectiveRoomId = computed(() => {
    if (Number.isInteger(roomId.value) && roomId.value > 0) return roomId.value;
    return currentRoomIdFromUrl() ?? 0;
  });
  const busMessages = ref<ChatMessage[]>([]);
  const busUserNo = ref<number | null>(null);
  const busNickname = ref("");
  const busMembers = ref<ChatUser[]>([]);
  const busUsers = ref<ChatUser[]>([]);
  const busRoomName = ref("");
  const busConnectionStatus = ref("메인 창에 연결 중...");
  const busIsConnected = ref(false);
  const busHasMore = ref(false);
  const busLoadingOlder = ref(false);
  const busHasNewer = ref(false);
  const busLoadingNewer = ref(false);
  const busSearch = ref<RoomSearchState | null>(null);
  const linked = ref(false);
  // 메인 창 연결 대기 중 (LINK_TIMEOUT_MS 안에 연결되지 않으면 false)
  const linkPending = ref(true);
  let bus: (ChatBus & { add: (b: ChatBus | null) => void }) | null = null;
  let busClosed = false;
  let linkTimer: ReturnType<typeof setTimeout> | null = null;
  let announceTimer: ReturnType<typeof setInterval> | null = null;
  const stopAnnounceTimer = () => {
    if (announceTimer) {
      clearInterval(announceTimer);
      announceTimer = null;
    }
  };
  const applyState = (
    userNo: number | null, nick: string, rname: string, msgs: ChatMessage[],
    mems: ChatUser[], status: string, connected: boolean, users: ChatUser[] = [],
    hasMore = false, loadingOlder = false,
    hasNewer = false, loadingNewer = false, search: RoomSearchState | null = null,
  ) => {
    busHasNewer.value = hasNewer;
    busLoadingNewer.value = loadingNewer;
    busSearch.value = search ? { ...search, ids: [...search.ids] } : null;
    busUserNo.value = userNo;
    busNickname.value = nick;
    busRoomName.value = rname;
    busMessages.value = [...msgs];
    busMembers.value = [...mems];
    busUsers.value = [...users];
    busConnectionStatus.value = status;
    busIsConnected.value = connected;
    busHasMore.value = hasMore;
    busLoadingOlder.value = loadingOlder;
    linked.value = true;
    stopAnnounceTimer();
    if (linkTimer) {
      clearTimeout(linkTimer);
      linkTimer = null;
    }
  };
  const announceOpen = () => {
    const target = effectiveRoomId.value;
    if (!target) return;
    if (direct.value) store.clearRoomUnread(target);
    try {
      bus?.post({ kind: "room-open", roomId: target, mainId: myMainId ?? undefined });
    } catch { /* 무시 */ }
  };
  const announceClose = () => {
    const target = effectiveRoomId.value;
    if (!target || direct.value) return;
    try {
      bus?.post({ kind: "room-close", roomId: target, mainId: myMainId ?? undefined });
    } catch { /* 무시 */ }
  };
  // ─── focus 상태 보고 (안읽은 건수 정책) ───
  // 이 창이 focus되어 있는 동안은 메인 채팅목록에 안읽은 건수를 잡지 않는다.
  // blur되면 다시 잡히고, 다시 focus하면 그 순간 0이 된다 (setRoomFocus가 처리).
  let lastFocus: boolean | null = null;
  const reportFocus = (focused: boolean) => {
    const target = effectiveRoomId.value;
    if (!target) return;
    lastFocus = focused;
    if (direct.value) {
      store.setRoomFocus(target, focused);
      return;
    }
    try {
      bus?.post({
        kind: "room-focus",
        roomId: target,
        focused,
        mainId: myMainId ?? undefined,
      });
    } catch { /* 무시 */ }
  };
  // 메인 창이 (재)시작되면 포커스 상태를 한 번 더 알린다.
  const announceFocus = () => {
    reportFocus(lastFocus === true);
  };
  useWindowFocus(reportFocus);

  const handleBusMessage: ChatBusHandler = (msg) => {
    if ("mainId" in msg && msg.mainId !== undefined && myMainId !== null && msg.mainId !== myMainId) return;
    if (msg.kind === "room-state") {
      if (msg.roomId !== effectiveRoomId.value) return;
      applyState(
        msg.myUserNo, msg.myNickname, msg.roomName, msg.messages,
        msg.members, msg.connectionStatus, msg.isConnected,
        Array.isArray(msg.users) ? msg.users : [],
        msg.hasMore === true, msg.loadingOlder === true,
        msg.hasNewer === true, msg.loadingNewer === true, msg.search ?? null,
      );
    } else if (msg.kind === "main-ready") {
      announceOpen();
      // "아직 보고 있는 중"도 함께 알려 배지가 되살아나지 않게 한다
      announceFocus();
    } else if (msg.kind === "main-closing") {
      linked.value = false;
      busIsConnected.value = false;
      busConnectionStatus.value = "메인 창이 종료되었습니다.";
    }
  };
  const genSendId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const send = (text: string): boolean => {
    const trimmed = text.trim();
    const target = effectiveRoomId.value;
    if (trimmed === "" || !target) return false;
    if (direct.value) return store.sendRoom(target, trimmed);
    if (!linked.value || !busIsConnected.value) return false;
    try {
      bus?.post({ kind: "room-send", roomId: target, text: trimmed, id: genSendId(), mainId: myMainId ?? undefined });
    } catch {
      return false;
    }
    return true;
  };

  // ─── 첨부파일 전송 ───
  // 업로드는 어느 창에서든 HTTP 로 직접 하고, 받은 fileId 만 소켓(같은 탭) 또는 메인 창(버스)으로 넘긴다.
  // 여러 개면 고른 순서대로 하나씩 올리고 보낸다. 실패한 파일의 문구를 모아 돌려준다.
  const uploadingCount = ref(0);
  const sendFileId = (fileId: string): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.sendRoomFile(target, fileId);
    if (!linked.value || !busIsConnected.value) return false;
    try {
      bus?.post({ kind: "room-send-file", roomId: target, fileId, id: genSendId(), mainId: myMainId ?? undefined });
    } catch {
      return false;
    }
    return true;
  };
  const sendFiles = async (files: File[]): Promise<string[]> => {
    const list = files.slice(0, MAX_ATTACHMENTS_PER_SEND);
    const errors: string[] = [];
    if (files.length > list.length) {
      errors.push(`한 번에 ${MAX_ATTACHMENTS_PER_SEND}개까지 보낼 수 있습니다.`);
    }
    uploadingCount.value += list.length;
    for (const file of list) {
      try {
        const uploaded = await uploadAttachment(file);
        if (!sendFileId(uploaded.id)) errors.push(`연결이 끊겨 보내지 못했습니다: ${uploaded.name}`);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `파일을 보내지 못했습니다: ${file.name}`);
      } finally {
        uploadingCount.value -= 1;
      }
    }
    return errors;
  };
  const uploading = computed(() => uploadingCount.value > 0);

  const myInfo = computed(() =>
    store.myRooms.value.find((r) => r.roomId === effectiveRoomId.value),
  );
  const messages: ComputedRef<ChatMessage[]> = computed(() =>
    direct.value
      ? (store.roomMessages.value[effectiveRoomId.value] ?? [])
      : busMessages.value,
  );
  const myNickname: ComputedRef<string> = computed(() =>
    direct.value ? store.nickname.value : busNickname.value,
  );
  const rname: ComputedRef<string> = computed(() => {
    if (!direct.value) return truncateRoomTitle(busRoomName.value);
    const info = myInfo.value;
    if (!info) return "";
    // 사용자별 표시제목 우선 (1:1=상대닉네임, 그룹=전체 참여자 이름 연결), 없으면 rooms.name 폴백.
    // 화면 표기는 20자까지 축약하되, 목록과 창 제목이 서로 어긋나지 않게 같은 함수를 쓴다.
    return roomDisplayName(info);
  });
  const myUserNo: ComputedRef<number | null> = computed(() =>
    direct.value ? store.myUserNo.value : busUserNo.value,
  );
  const members: ComputedRef<ChatUser[]> = computed(() =>
    direct.value
      ? (store.roomMembers.value[effectiveRoomId.value] ?? [])
      : busMembers.value,
  );
  // '초대하기' 모달에 넘길 사용자 목록 (메인 창이 내려주는 스냅샷 — 본인은 이미 제외됨)
  const users: ComputedRef<ChatUser[]> = computed(() =>
    direct.value ? store.userlist.value : busUsers.value,
  );
  const connectionStatus: ComputedRef<string> = computed(() =>
    direct.value ? store.connectionStatus.value : busConnectionStatus.value,
  );
  const isConnected: ComputedRef<boolean> = computed(() =>
    direct.value ? store.isConnected.value : busIsConnected.value,
  );
  const hasMore: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.roomHasMore.value[effectiveRoomId.value] === true
      : busHasMore.value,
  );
  const loadingOlder: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.roomLoadingOlder.value[effectiveRoomId.value] === true
      : busLoadingOlder.value,
  );
  const hasNewer: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.roomHasNewer.value[effectiveRoomId.value] === true
      : busHasNewer.value,
  );
  const loadingNewer: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.roomLoadingNewer.value[effectiveRoomId.value] === true
      : busLoadingNewer.value,
  );
  const searchState: ComputedRef<RoomSearchState | null> = computed(() =>
    direct.value
      ? (store.roomSearch.value[effectiveRoomId.value] ?? null)
      : busSearch.value,
  );
  const hasSession: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.loginId.value.trim() !== ""
      : linked.value || busNickname.value.trim() !== "" || linkPending.value,
  );

  const handleUnload = () => {
    announceClose();
  };

  // 같은 탭에서 라우트만 바뀌면 컴포넌트가 재사용되므로(언마운트 없음)
  // 방이 바뀔 때마다 다시 DB 최신 한 페이지를 조회한다.
  watch(effectiveRoomId, (rid, prev) => {
    if (!direct.value || !rid) return;
    if (prev) store.clearRoomSearch(prev);
    store.clearRoomUnread(rid);
    store.requestRoomHistory(rid);
  });

  onMounted(() => {
    if (direct.value) {
      store.clearRoomUnread(effectiveRoomId.value);
      // 채팅창이 열릴 때마다 DB에서 최신 한 페이지를 조회해 오도록 요청
      store.requestRoomHistory(effectiveRoomId.value);
      return;
    }
    bus = createChatBusHub();
    try {
      bus.add(createChatBus(handleBusMessage));
    } catch {
      // 무시 (BroadcastChannel 미지원 환경)
    }
    if (isTauriRuntime()) {
      void createTauriChatBus(handleBusMessage)
        .then((created) => {
          if (busClosed) {
            created.close();
            return;
          }
          bus?.add(created);
          announceOpen();
          announceFocus();
        })
        .catch(() => undefined);
    }
    announceOpen();
    // useWindowFocus의 첫 보고는 이 onMounted보다 먼저 실행되어 bus가 없을 때 버려진다.
    // 버스가 생긴 지금 현재 focus 상태를 다시 알려, 열자마자 보고 있는 방에 배지가 잡히지 않게 한다.
    announceFocus();
    stopAnnounceTimer();
    announceTimer = setInterval(() => {
      if (linked.value || busClosed) {
        stopAnnounceTimer();
        return;
      }
      announceOpen();
    }, 800);
    linkTimer = setTimeout(() => {
      if (!linked.value) {
        linkPending.value = false;
        busConnectionStatus.value =
          "메인 창에 연결할 수 없습니다. 메인 창에서 입장한 뒤 다시 열어주세요.";
      }
    }, LINK_TIMEOUT_MS);
    window.addEventListener("beforeunload", handleUnload);
  });

  onUnmounted(() => {
    // 같은 탭(direct)은 room-close 를 보내지 않으므로 검색 상태를 여기서 정리한다
    if (direct.value) store.clearRoomSearch(effectiveRoomId.value);
    announceClose();
    busClosed = true;
    stopAnnounceTimer();
    window.removeEventListener("beforeunload", handleUnload);
    if (linkTimer) {
      clearTimeout(linkTimer);
      linkTimer = null;
    }
    bus?.close();
    bus = null;
  });

  // NOTE: focus가 해제된 상태에서 메시지가 도착하면 안읽은 건수를 잡아야 하므로
  // "메시지가 보이면 무조건 읽음 처리"하는 로직은 두지 않는다.
  // 읽음 판정은 위 useWindowFocus가 만든 focus 상태로만 결정된다.

  // 방제목 수정. 이 창에 소켓이 있으면(같은 탭) 직접 보내고,
  // 새 창이면 소켓이 있는 메인 창에 버스로 요청만 넘긴다.
  const renameRoom = (title: string): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.renameRoom(target, title);
    if (!linked.value) return false;
    try {
      bus?.post({
        kind: "room-rename",
        roomId: target,
        title: title.trim().slice(0, ROOM_TITLE_INPUT_MAX_LENGTH),
        mainId: myMainId ?? undefined,
      });
      return true;
    } catch {
      return false;
    }
  };

  // 방 초대. 방제목 수정과 완전히 같은 경로를 쓴다:
  //   같은 탭(direct)이면 소켓이 바로 있으므로 직접 보내고,
  //   새 창이면 소켓이 있는 메인 창에 버스로 요청만 넘긴다.
  const invite = (memberNos: number[]): boolean => {
    const target = effectiveRoomId.value;
    const list = (Array.isArray(memberNos) ? memberNos : []).filter((n) =>
      Number.isInteger(Number(n)) && Number(n) > 0,
    );
    if (!target || list.length === 0) return false;
    if (direct.value) return store.sendRoomInvite(target, list);
    if (!linked.value) return false;
    try {
      bus?.post({
        kind: "room-invite",
        roomId: target,
        memberNos: list,
        mainId: myMainId ?? undefined,
      });
      return true;
    } catch {
      return false;
    }
  };

  // 이전 대화 더보기 (위로 스크롤 끝). 같은 탭이면 직접, 새 창이면 메인 창에 버스로 요청한다.
  // 새 창은 응답 스냅샷(room-state)이 올 때까지 중복 요청하지 않도록 먼저 loading 으로 표시한다.
  const loadOlder = (): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.requestOlderMessages(target);
    if (!linked.value || !busHasMore.value || busLoadingOlder.value) return false;
    try {
      bus?.post({ kind: "room-load-older", roomId: target, mainId: myMainId ?? undefined });
    } catch {
      return false;
    }
    busLoadingOlder.value = true;
    return true;
  };

  // 새 창이면 소켓이 있는 메인 창에 버스로 요청만 넘긴다 (응답은 room-state 스냅샷으로 온다)
  const postToMain = (msg: Parameters<ChatBus["post"]>[0]): boolean => {
    if (!linked.value) return false;
    try {
      bus?.post(msg);
      return true;
    } catch {
      return false;
    }
  };

  // 메시지 검색 (빈 검색어 = 검색 해제). 새 창은 응답 전까지 loading 으로 먼저 표시한다.
  const search = (keyword: string): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    const kw = keyword.trim();
    if (direct.value) return store.requestRoomSearch(target, kw);
    const ok = postToMain({ kind: "room-search", roomId: target, keyword: kw, mainId: myMainId ?? undefined });
    if (ok) busSearch.value = kw === "" ? null : { keyword: kw, ids: [], loading: true, truncated: false };
    return ok;
  };

  // 검색 결과 점프: 화면에 없는 메시지면 그 메시지를 가운데 둔 한 페이지로 목록을 바꾼다
  const jumpTo = (msgId: number): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.requestMessagesAround(target, msgId);
    return postToMain({ kind: "room-jump", roomId: target, msgId, mainId: myMainId ?? undefined });
  };

  // 점프 후 아래로 스크롤 끝에 닿았을 때 이후 대화
  const loadNewer = (): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.requestNewerMessages(target);
    if (!busHasNewer.value || busLoadingNewer.value) return false;
    const ok = postToMain({ kind: "room-load-newer", roomId: target, mainId: myMainId ?? undefined });
    if (ok) busLoadingNewer.value = true;
    return ok;
  };

  // 점프 상태에서 최신 대화로 복귀 ('맨 아래로' / 메시지 전송)
  const loadLatest = (): boolean => {
    const target = effectiveRoomId.value;
    if (!target) return false;
    if (direct.value) return store.requestRoomHistory(target);
    return postToMain({ kind: "room-load-latest", roomId: target, mainId: myMainId ?? undefined });
  };

  return {
    messages,
    hasMore,
    loadingOlder,
    loadOlder,
    hasNewer,
    loadingNewer,
    loadNewer,
    loadLatest,
    searchState,
    search,
    jumpTo,
    myUserNo,
    myNickname,
    roomName: rname,
    members,
    users,
    connectionStatus,
    isConnected,
    hasSession,
    linked,
    effectiveRoomId,
    send,
    sendFiles,
    uploading,
    renameRoom,
    invite,
    announceOpen,
    announceClose,
  };
}
