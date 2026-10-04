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
import type { ChatMessage } from "../types/chat";
import { roomDisplayName, truncateRoomTitle, ROOM_TITLE_INPUT_MAX_LENGTH } from "../types/chat";
import { NICKNAME_STORAGE_KEY } from "../constants";
import { useChatSocket } from "./useChatSocket";

const LINK_TIMEOUT_MS = 3500;

export function useChatRoom(roomId: { readonly value: number }) {
  const store = useChatSocket();
  const myMainId = currentMainIdFromUrl();
  const direct = computed(() => store.nickname.value.trim() !== "");
  const effectiveRoomId = computed(() => {
    if (Number.isInteger(roomId.value) && roomId.value > 0) return roomId.value;
    return currentRoomIdFromUrl() ?? 0;
  });
  const busMessages = ref<ChatMessage[]>([]);
  const busNickname = ref(localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "");
  const busMembers = ref<string[]>([]);
  const busRoomName = ref("");
  const busConnectionStatus = ref("메인 창에 연결 중...");
  const busIsConnected = ref(false);
  const linked = ref(false);
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
    nick: string, rname: string, msgs: ChatMessage[],
    mems: string[], status: string, connected: boolean,
  ) => {
    busNickname.value = nick;
    busRoomName.value = rname;
    busMessages.value = [...msgs];
    busMembers.value = [...mems];
    busConnectionStatus.value = status;
    busIsConnected.value = connected;
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
  const handleBusMessage: ChatBusHandler = (msg) => {
    if ("mainId" in msg && msg.mainId !== undefined && myMainId !== null && msg.mainId !== myMainId) return;
    if (msg.kind === "room-state") {
      if (msg.roomId !== effectiveRoomId.value) return;
      applyState(
        msg.myNickname, msg.roomName, msg.messages,
        msg.members, msg.connectionStatus, msg.isConnected,
      );
    } else if (msg.kind === "main-ready") {
      announceOpen();
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
  const members: ComputedRef<string[]> = computed(() =>
    direct.value
      ? (store.roomMembers.value[effectiveRoomId.value] ?? [])
      : busMembers.value,
  );
  const connectionStatus: ComputedRef<string> = computed(() =>
    direct.value ? store.connectionStatus.value : busConnectionStatus.value,
  );
  const isConnected: ComputedRef<boolean> = computed(() =>
    direct.value ? store.isConnected.value : busIsConnected.value,
  );
  const hasSession: ComputedRef<boolean> = computed(() =>
    direct.value
      ? store.nickname.value.trim() !== ""
      : linked.value || busNickname.value.trim() !== "",
  );

  const handleUnload = () => {
    announceClose();
  };

  // 같은 탭에서 라우트만 바뀌면 컴포넌트가 재사용되므로(언마운트 없음)
  // 방이 바뀔 때마다 다시 DB 최근 10건을 조회한다.
  watch(effectiveRoomId, (rid) => {
    if (!direct.value || !rid) return;
    store.clearRoomUnread(rid);
    store.requestRoomHistory(rid);
  });

  onMounted(() => {
    if (direct.value) {
      store.clearRoomUnread(effectiveRoomId.value);
      // 채팅창이 열릴 때마다 DB에서 최근 10건을 조회해 오도록 요청
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
        })
        .catch(() => undefined);
    }
    announceOpen();
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
        busConnectionStatus.value =
          "메인 창에 연결할 수 없습니다. 메인 창에서 입장한 뒤 다시 열어주세요.";
      }
    }, LINK_TIMEOUT_MS);
    window.addEventListener("beforeunload", handleUnload);
  });

  onUnmounted(() => {
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

  watch(
    () => messages.value.length,
    (len, prev) => {
      if (len > prev) {
        if (direct.value) {
          store.clearRoomUnread(effectiveRoomId.value);
        } else if (linked.value) {
          try {
            bus?.post({ kind: "room-read", roomId: effectiveRoomId.value, mainId: myMainId ?? undefined });
          } catch {
            // 무시
          }
        }
      }
    },
  );

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

  return {
    messages,
    myNickname,
    roomName: rname,
    members,
    connectionStatus,
    isConnected,
    hasSession,
    linked,
    effectiveRoomId,
    send,
    renameRoom,
    announceOpen,
    announceClose,
  };
}
