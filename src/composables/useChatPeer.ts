import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ComputedRef } from "vue";
import {
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentChatPeerFromUrl,
  currentMainIdFromUrl,
  isTauriRuntime,
  type ChatBus,
  type ChatBusHandler,
} from "../chatBus";
import type { ChatMessage } from "../types/chat";
import { NICKNAME_STORAGE_KEY } from "../constants";
import { useChatSocket } from "./useChatSocket";
import { useWindowFocus } from "./useWindowFocus";

/**
 * 1:1 채팅방(peer)용 상태 바인딩.
 *
 * - 같은 윈도우에 소켓 주인이 살아있으면(메인 탭에서 직접 라우팅한 경우)
 *   싱글톤 소켓에 직접 바인딩한다.
 * - 별도 새 창으로 열린 경우 WebSocket을 만들지 않는다.
 *   - 웹 브라우저: BroadcastChannel 이벤트로 메인 창과 주고받는다.
 *   - Tauri: tauri event 버스로 메인 윈도우와 주고받는다.
 */

const LINK_TIMEOUT_MS = 3500;

export function useChatPeer(peer: { readonly value: string }) {
  const store = useChatSocket();

  // 이 팝업이 속한 메인 탭 ID (?mainId=). A탭/B탭 버스 섞임 방지용.
  const myMainId = currentMainIdFromUrl();

  // Tauri 채팅 윈도우 판별: Tauri 런타임 + URL이 #/chat/... 인 경우.
  // 이 모드에서는 localStorage 세션이 없어도 스냅샷을 기다리며 표시한다.
  // (웹에서 #/chat/... URL을 직접 연 경우도 채팅 UI를 먼저 보여준다)
  const useTauriWindow = currentChatPeerFromUrl() !== null;

  const direct = computed(() => store.nickname.value.trim() !== "");

  // 실제 상대 ID: route param이 비어 있으면 URL 해시에서 직접 읽는다
  const effectivePeer = computed(
    () => peer.value || currentChatPeerFromUrl() || "",
  );

  // 버스 모드(새 창)용 로컬 상태 — 메인 창의 스냅샷으로 갱신된다
  const busMessages = ref<ChatMessage[]>([]);
  const busNickname = ref(localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "");
  const busConnectionStatus = ref("메인 창에 연결 중...");
  const busIsConnected = ref(false);
  const linked = ref(false);

  let bus: (ChatBus & { add: (bus: ChatBus | null) => void }) | null = null;
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
    myNicknameValue: string,
    msgs: ChatMessage[],
    status: string,
    connected: boolean,
  ) => {
    busNickname.value = myNicknameValue;
    busMessages.value = [...msgs];
    busConnectionStatus.value = status;
    busIsConnected.value = connected;
    linked.value = true;
    stopAnnounceTimer();
    if (linkTimer) {
      clearTimeout(linkTimer);
      linkTimer = null;
    }
  };

  const handleBusMessage: ChatBusHandler = (msg) => {
    // mainId가 있고 내 메인 탭과 다르면 무시 (A탭/B탭 버스 섞임 방지).
    // mainId 없는 구버전 메시지는 받아준다.
    if ("mainId" in msg && msg.mainId !== undefined && myMainId !== null && msg.mainId !== myMainId) return;
    if (msg.kind === "chat-state") {
      if (msg.peer !== effectivePeer.value) return;
      // 상대 메인 탭(A)의 chat-state가 내 팝업(B)에 와도 peer가 다르면 무시됨.
      applyState(msg.myNickname, msg.messages, msg.connectionStatus, msg.isConnected);
    } else if (msg.kind === "main-ready") {
      // 메인 창이 (재)시작됐을 때 다시 자신을 알린다
      announceOpen();
      // "아직 보고 있는 중"도 함께 알려 배지가 되살아나지 않게 한다
      announceFocus();
    } else if (msg.kind === "main-closing") {
      linked.value = false;
      busIsConnected.value = false;
      busConnectionStatus.value = "메인 창이 종료되었습니다.";
    }
  };

  const messages: ComputedRef<ChatMessage[]> = computed(() =>
    direct.value
      ? (store.dmMessages.value[effectivePeer.value] ?? [])
      : busMessages.value,
  );
  const myNickname: ComputedRef<string> = computed(() =>
    direct.value ? store.nickname.value : busNickname.value,
  );
  const connectionStatus: ComputedRef<string> = computed(() =>
    direct.value ? store.connectionStatus.value : busConnectionStatus.value,
  );
  const isConnected: ComputedRef<boolean> = computed(() =>
    direct.value ? store.isConnected.value : busIsConnected.value,
  );
  const hasSession: ComputedRef<boolean> = computed(() => {
    // Tauri 채팅 윈도우는 스냅샷 수신 전에도 빈 화면 대신 채팅 UI를 먼저 보여준다
    if (useTauriWindow) return true;
    return myNickname.value.trim() !== "";
  });

  const announceOpen = () => {
    const target = effectivePeer.value;
    if (!target) return;
    if (direct.value) {
      store.clearUnread(target);
    }
    try {
      bus?.post({ kind: "chat-open", peer: target, mainId: myMainId ?? undefined });
    } catch {
      // 무시
    }
  };

  const announceClose = () => {
    const target = effectivePeer.value;
    if (!target) return;
    if (direct.value) return;
    try {
      bus?.post({ kind: "chat-close", peer: target, mainId: myMainId ?? undefined });
    } catch {
      // 무시
    }
  };

  const genSendId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const send = (text: string): boolean => {
    const trimmed = text.trim();
    const target = effectivePeer.value;
    if (trimmed === "" || target === "") return false;
    if (direct.value) {
      return store.sendDm(target, trimmed);
    }
    if (!linked.value || !busIsConnected.value) return false;
    try {
      bus?.post({ kind: "chat-send", peer: target, text: trimmed, id: genSendId(), mainId: myMainId ?? undefined });
    } catch {
      return false;
    }
    return true;
  };

  const handleUnload = () => {
    announceClose();
  };

  // 같은 탭에서 라우트만 바뀌면 컴포넌트가 재사용되므로(언마운트 없음)
  // 상대가 바뀔 때마다 다시 DB 최근 10건을 조회한다.
  watch(effectivePeer, (peer) => {
    if (!direct.value || !peer) return;
    store.clearUnread(peer);
    store.requestDmHistory(peer);
  });

  // ─── focus 상태 보고 (안읽은 건수 정책) ───
  // 이 창이 focus되어 있는 동안은 메인 채팅목록에 안읽은 건수를 잡지 않는다.
  // blur되면 다시 잡히고, 다시 focus하면 그 순간 0이 된다 (setPeerFocus가 처리).
  let lastFocus: boolean | null = null;
  const reportFocus = (focused: boolean) => {
    const target = effectivePeer.value;
    if (!target) return;
    lastFocus = focused;
    if (direct.value) {
      store.setPeerFocus(target, focused);
      return;
    }
    try {
      bus?.post({
        kind: "chat-focus",
        peer: target,
        focused,
        mainId: myMainId ?? undefined,
      });
    } catch {
      // 무시
    }
  };

  // 메인 창이 (재)시작되면 포커스 상태를 한 번 더 알린다.
  // (chat-open과 별개로, "아직 보고 있는 중"임을 알려 배지가 되살아나지 않게 한다)
  const announceFocus = () => {
    reportFocus(lastFocus === true);
  };

  useWindowFocus(reportFocus);

  onMounted(() => {
    if (direct.value) {
      store.clearUnread(effectivePeer.value);
      // 채팅창이 열릴 때마다 DB에서 최근 10건을 조회해 오도록 요청
      store.requestDmHistory(effectivePeer.value);
      return;
    }
    // 버스 허브: BroadcastChannel + (Tauri면) tauri event를 동시에 붙인다.
    // post는 양쪽 채널에 모두 보내고, 수신 중복은 메인/채팅 양측에서 id로 제거한다.
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
          // tauri 채널이 늦게 붙었을 때를 대비해 자신을 다시 알린다
          announceOpen();
        })
        .catch(() => undefined);
    }
    announceOpen();
    // 메인 윈도우가 chat-open을 놓쳤을 때를 대비해 연결될 때까지 주기적으로 알린다
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

  // NOTE: focus가 해제된 상태에서 메시지가 도착하면 안읽은 건수를 잡아야 하므로
  // "메시지가 보이면 무조건 읽음 처리"하는 로직은 두지 않는다.
  // 읽음 판정은 위 useWindowFocus가 만든 focus 상태로만 결정된다.

  return {
    messages,
    myNickname,
    connectionStatus,
    isConnected,
    hasSession,
    linked,
    send,
    announceOpen,
    announceClose,
  };
}
