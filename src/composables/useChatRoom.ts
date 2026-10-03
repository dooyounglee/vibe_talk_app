import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ComputedRef } from "vue";
import {
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentRoomIdFromUrl,
  isTauriRuntime,
  type ChatBus,
  type ChatBusHandler,
} from "../chatBus";
import type { ChatMessage } from "../types/chat";
import { NICKNAME_STORAGE_KEY } from "../constants";
import { useChatSocket } from "./useChatSocket";

const LINK_TIMEOUT_MS = 3500;

export function useChatRoom(roomId: { readonly value: number }) {
  const store = useChatSocket();
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
      bus?.post({ kind: "room-open", roomId: target });
    } catch { /* 무시 */ }
  };
  const announceClose = () => {
    const target = effectiveRoomId.value;
    if (!target || direct.value) return;
    try {
      bus?.post({ kind: "room-close", roomId: target });
    } catch { /* 무시 */ }
  };
  const handleBusMessage: ChatBusHandler = (msg) => {
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
      bus?.post({ kind: "room-send", roomId: target, text: trimmed, id: genSendId() });
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
    if (!direct.value) return busRoomName.value;
    const info = myInfo.value;
    if (!info) return "";
    // 사용자별 표시제목 우선 (1:1=상대닉네임), 없으면 rooms.name 폴백
    return info.displayName?.trim() ? info.displayName : (info.name ?? "");
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

  onMounted(() => {
    if (direct.value) {
      store.clearRoomUnread(effectiveRoomId.value);
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
            bus?.post({ kind: "room-read", roomId: effectiveRoomId.value });
          } catch {
            // 무시
          }
        }
      }
    },
  );

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
    announceOpen,
    announceClose,
  };
}
