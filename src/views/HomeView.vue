<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WebviewWindow as WebviewWindowInstance } from "@tauri-apps/api/webviewWindow";
import type { RoomInfo } from "../types/chat";
import { roomRawName } from "../types/chat";
import NicknameView from "../components/NicknameView.vue";
import UserListView from "../components/UserListView.vue";
import RoomListView from "../components/RoomListView.vue";
import CreateRoomModal from "../components/CreateRoomModal.vue";
import RenameRoomModal from "../components/RenameRoomModal.vue";
import { useChatSocket } from "../composables/useChatSocket";
import {
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentChatPeerFromUrl,
  currentRoomIdFromUrl,
  dedupeKeyFor,
  isTauriRuntime,
  type ChatBus,
  type ChatBusHandler,
} from "../chatBus";
import { MAIN_ID_STORAGE_KEY, NICKNAME_STORAGE_KEY } from "../constants";

// 이 메인 창이 유일한 WebSocket 소유자.
// 채팅창(별도 윈도우)은 소켓을 만들지 않고 이벤트 버스로 상태를 받아간다.
const {
  nickname,
  isConnected,
  connectionStatus,
  dmMessages,
  userlist,
  onlineUsers,
  usersDetail,
  joinError,
  userUpsertResult,
  isAdmin,
  myRooms,
  roomMessages,
  roomUnread,
  roomMembers,
  findOneToOneRoomId,
  oneToOnePeerOfRoom,
  connect,
  manualReconnect,
  disconnect,
  sendDm,
  requestDmHistory,
  requestRoomHistory,
  clearUnread,
  clearRoomUnread,
  setPeerFocus,
  setRoomFocus,
  forgetPeerFocus,
  forgetRoomFocus,
  createRoom,
  joinRoom,
  leaveRoom,
  refreshRooms,
  renameRoom,
  sendRoom,
  upsertUser,
} = useChatSocket();

const router = useRouter();

// 탭별 메인 창 ID (A탭/B탭 팝업 버스 섞임 방지용).
// sessionStorage라 탭마다 격리된다. 팝업 URL에 ?mainId= 로 심어 전달한다.
const getMainId = (): string => {
  try {
    let v = sessionStorage.getItem(MAIN_ID_STORAGE_KEY);
    if (!v) {
      v = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(MAIN_ID_STORAGE_KEY, v);
    }
    return v;
  } catch {
    return "main";
  }
};
const mainId = getMainId();
// Tauri 채팅 윈도우(#/chat/... 또는 #/room/...)에서는 메인 로직을 동작시키지 않는다.
// (이 윈도우는 소켓을 만들지 않고 메인 윈도우의 스냅샷만 받아 표시한다)
const isTauriChatWindow =
  currentChatPeerFromUrl() !== null || currentRoomIdFromUrl() !== null;

// 화면 상태: false = 1번 화면(닉네임 입력), true = 2번 화면(방 목록 + 사용자 목록)
const entered = ref(false);
// 메인 화면 탭: 'rooms' = 내 채팅방, 'users' = 사용자(DM용, DB 등록 전체/탈퇴 제외)
const mainTab = ref<"rooms" | "users">("rooms");
// 상대별 1:1 채팅창 (웹: window.open 팝업 핸들 / Tauri: WebviewWindow)
const chatWindows = ref(new Map<string, Window | null>());
const tauriChatWindows = new Map<string, WebviewWindowInstance>();
// 방별 채팅창 (웹: window.open 팝업 핸들 / Tauri: WebviewWindow)
const roomWindows = ref(new Map<number, Window | null>());
const tauriRoomWindows = new Map<number, WebviewWindowInstance>();
// 이벤트로 상태를 받아가는 채팅창 목록 (스냅샷 브로드캐스트 대상)
const openPeers = new Set<string>();
const openRooms = new Set<number>();
const seenBusMessages = new Set<string>();
let bus: (ChatBus & { add: (bus: ChatBus | null) => void }) | null = null;
let busClosed = false;

// 새 창 열기 실패 시 화면 상단에 보여줄 에러 메시지
const windowError = ref("");

const showWindowError = (msg: string) => {
  windowError.value = msg;
};

const clearWindowError = () => {
  windowError.value = "";
};

// 윈도우 라벨에 쓸 수 없는 문자를 제거 (상대별 1창 유지용)
const chatWindowLabel = (peer: string) =>
  `chat_${Array.from(peer)
    .map((ch) => (/[a-zA-Z0-9_]/.test(ch) ? ch : "_"))
    .join("")
    .slice(0, 40)}_${Array.from(peer).length}`;

// 웹 브라우저용: window.open 팝업으로 채팅창을 연다
const openBrowserChatWindow = (peer: string, focusExisting: boolean) => {
  // 같은 대화가 '내 채팅방' 탭에서 띄운 1:1 방창으로 이미 떠 있으면 새 창을 띄우지 않고 focus만 준다
  if (focusBrowserRoomWindowOfPeer(peer)) return;
  const existing = chatWindows.value.get(peer);
  if (existing && !existing.closed) {
    if (focusExisting) {
      existing.focus();
    }
    clearUnread(peer);
    // 이미 열려 있던 창을 다시 열 때는 chat-open 재알림이 없으므로 여기서 조회 요청
    // (새로 여는 창은 팝업의 chat-open 시점에 요청된다)
    requestDmHistory(peer);
    return;
  }
  // 더블클릭 제스처 안에서 동기로 열어야 팝업 차단을 피할 수 있다.
  // Tauri dev의 http://localhost:1420 에서도 동일 origin 팝업으로 동작한다.
  // ?mainId= 로 어느 메인 탭의 팝업인지 표시 (A/B 탭 버스 섞임 방지)
  const url = `${window.location.origin}${window.location.pathname}#/chat/${encodeURIComponent(peer)}?mainId=${encodeURIComponent(mainId)}`;
  const child = window.open(
    url,
    `vibe_talk_chat_${chatWindowLabel(peer)}`,
    "width=420,height=640,menubar=no,toolbar=no,location=no,status=no,resizable=yes",
  );
  if (child) {
    chatWindows.value.set(peer, child);
  } else {
    console.warn(
      "[vibe-talk] 팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도하세요:",
      peer,
    );
    // 팝업이 막히면 "사용자가 직접 더블클릭한 경우"에만 같은 탭 라우팅으로 대체한다.
    // (새 DM 수신 같은 자동 오픈까지 메인 화면을 빼앗지 않도록)
    // 소켓은 같은 JS 컨텍스트 싱글톤이라 끊기지 않는다.
    if (focusExisting) {
      routerPushChat(peer);
    }
  }
  clearUnread(peer);
};

const routerPushChat = (peer: string) => {
  try {
    void router.push({ name: "chat", params: { peer } });
  } catch {
    // 무시
  }
};

// Tauri용: WebviewWindow API로 OS 네이티브 자식 윈도우를 연다
// (정적/동적 어떤 경로로 얻은 클래스든 동일 시그니처라 그대로 받는다)
const openTauriChatWindowWith = async (
  Ctor: typeof WebviewWindow,
  peer: string,
  focusExisting: boolean,
) => {
  // 같은 대화가 '내 채팅방' 탭에서 띄운 1:1 방창으로 이미 떠 있으면 새 창을 띄우지 않고 focus만 준다
  if (await focusTauriRoomWindowOfPeer(Ctor, peer)) return;
  const label = chatWindowLabel(peer);
  const existing = await Ctor.getByLabel(label);
  if (existing) {
    await existing.show().catch(() => undefined);
    if (focusExisting) {
      await existing.setFocus().catch(() => undefined);
    }
    clearUnread(peer);
    // 이미 열려 있던 창을 다시 열 때는 chat-open 재알림이 없으므로 여기서 조회 요청
    requestDmHistory(peer);
    return;
  }
  // dev(http://localhost:1420)와 build(file://../dist) 모두에서 동작하도록
  // 현재 페이지 기준 상대 경로 + 해시 라우트를 사용한다.
  const child = new Ctor(label, {
    url: `#/chat/${encodeURIComponent(peer)}?mainId=${encodeURIComponent(mainId)}`,
    title: `${peer}님과의 1:1 채팅`,
    width: 420,
    height: 640,
    resizable: true,
    visible: true,
    focus: true,
    center: true,
  });
  tauriChatWindows.set(peer, child);
  // 최초 스냅샷: 윈도우가 뜬 뒤 chat-open을 보내오면 응답하지만,
  // 혹시 놓치더라도 여기서 한 번 밀어준다
  await child.once("tauri://created", () => {
    clearWindowError();
    setTimeout(() => {
      broadcastPeer(peer);
    }, 600);
  });
  await child.once("tauri://error", (e) => {
    const detail =
      typeof e === "object" && e !== null && "payload" in e
        ? JSON.stringify((e as { payload: unknown }).payload)
        : String(e);
    console.error("[vibe-talk] 채팅 윈도우 생성 실패:", peer, detail);
    showWindowError(`채팅 윈도우 생성 실패: ${detail}`);
  });
  clearUnread(peer);
};

// 번호방: 새 창 열기 (웹 팝업 / Tauri WebviewWindow)
const roomWindowLabel = (roomId: number) => `room_${roomId}`;

// ─── 이미 떠 있는 채팅창 재사용 (focus만 줌) ───
// '내 채팅방' 탭의 1:1 방창과 '사용자' 탭의 DM창은 같은 대화를 보여준다.
// 그래서 한쪽 탭에서 띄운 창을 다른 쪽 탭에서 열면 창이 중복으로 뜨므로,
// 열기 전에 반대쪽 창이 떠 있는지 확인해 focus만 주고 새 창은 만들지 않는다.
// (떠 있는 창은 메인 버스로 스냅샷을 계속 받고 읽음 신호도 스스로 보내므로
//  히스토리 재요청·읽음 처리 같은 추가 작업은 필요 없다)

// 웹: 이미 떠 있는 팝업에 focus만 준다 (안 떠 있으면 false → 새 창 생성으로 진행)
const focusBrowserChild = (child: Window | null | undefined): boolean => {
  if (!child || child.closed) return false;
  child.focus();
  return true;
};

// '사용자' 탭에서 peer 의 1:1을 열 때, 그 대话的 1:1 방창이 떠 있으면 focus만 준다
const focusBrowserRoomWindowOfPeer = (peer: string): boolean => {
  const roomId = findOneToOneRoomId(peer);
  if (roomId === null) return false;
  return focusBrowserChild(roomWindows.value.get(roomId));
};

// '내 채팅방' 탭에서 1:1 방을 열 때, 그 대화의 DM창이 떠 있으면 focus만 준다
const focusBrowserChatWindowOfRoom = (roomId: number): boolean => {
  const peer = oneToOnePeerOfRoom(roomId);
  if (!peer) return false;
  return focusBrowserChild(chatWindows.value.get(peer));
};

// Tauri: 라벨로 이미 떠 있는 OS 윈도우를 찾아 show + focus만 준다 (없으면 false)
const focusTauriWindowByLabel = async (
  Ctor: typeof WebviewWindow,
  label: string,
): Promise<boolean> => {
  try {
    const win = await Ctor.getByLabel(label);
    if (!win) return false;
    await win.show().catch(() => undefined);
    await win.setFocus().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

const focusTauriRoomWindowOfPeer = (
  Ctor: typeof WebviewWindow,
  peer: string,
): Promise<boolean> => {
  const roomId = findOneToOneRoomId(peer);
  if (roomId === null) return Promise.resolve(false);
  return focusTauriWindowByLabel(Ctor, roomWindowLabel(roomId));
};

const focusTauriChatWindowOfRoom = (
  Ctor: typeof WebviewWindow,
  roomId: number,
): Promise<boolean> => {
  const peer = oneToOnePeerOfRoom(roomId);
  if (!peer) return Promise.resolve(false);
  return focusTauriWindowByLabel(Ctor, chatWindowLabel(peer));
};

// reuseDmWindow: 같은 대화가 '사용자' 탭의 DM창으로 떠 있으면 그 창에 focus만 줄지.
// 방 만들기로 막 만들어진 새 방은 기존 1:1방과 다른 방이므로 false로 새 창을 연다.
const openBrowserRoomWindow = (roomId: number, focusExisting: boolean, reuseDmWindow: boolean) => {
  // 같은 대화가 '사용자' 탭에서 띄운 DM창으로 이미 떠 있으면 새 방창을 띄우지 않고 focus만 준다
  if (reuseDmWindow && focusBrowserChatWindowOfRoom(roomId)) return;
  const existing = roomWindows.value.get(roomId);
  if (existing && !existing.closed) {
    if (focusExisting) existing.focus();
    clearRoomUnread(roomId);
    // 이미 열려 있던 창을 다시 열 때는 room-open 재알림이 없으므로 여기서 조회 요청
    requestRoomHistory(roomId);
    return;
  }
  const url = `${window.location.origin}${window.location.pathname}#/room/${roomId}?mainId=${encodeURIComponent(mainId)}`;
  const child = window.open(
    url,
    `vibe_talk_room_${roomId}`,
    "width=420,height=640,menubar=no,toolbar=no,location=no,status=no,resizable=yes",
  );
  if (child) {
    roomWindows.value.set(roomId, child);
  } else if (focusExisting) {
    routerPushRoom(roomId);
  }
  clearRoomUnread(roomId);
};

const routerPushRoom = (roomId: number) => {
  try {
    void router.push({ name: "room", params: { roomId: String(roomId) } });
  } catch {
    // 무시
  }
};

const openTauriRoomWindowWith = async (
  Ctor: typeof WebviewWindow,
  roomId: number,
  focusExisting: boolean,
  reuseDmWindow: boolean,
) => {
  // 같은 대화가 '사용자' 탭에서 띄운 DM창으로 이미 떠 있으면 새 방창을 띄우지 않고 focus만 준다
  if (reuseDmWindow && (await focusTauriChatWindowOfRoom(Ctor, roomId))) return;
  const label = roomWindowLabel(roomId);
  const existing = await Ctor.getByLabel(label);
  if (existing) {
    await existing.show().catch(() => undefined);
    if (focusExisting) await existing.setFocus().catch(() => undefined);
    clearRoomUnread(roomId);
    // 이미 열려 있던 창을 다시 열 때는 room-open 재알림이 없으므로 여기서 조회 요청
    requestRoomHistory(roomId);
    return;
  }
  const child = new Ctor(label, {
    url: `#/room/${roomId}?mainId=${encodeURIComponent(mainId)}`,
    title: (() => {
      const info = myRooms.value.find((r) => r.roomId === roomId);
      const disp = info?.displayName?.trim() ? info.displayName : info?.name;
      return disp ? `#${roomId} ${disp}` : `채팅방 #${roomId}`;
    })(),
    width: 420,
    height: 640,
    resizable: true,
    visible: true,
    focus: true,
    center: true,
  });
  tauriRoomWindows.set(roomId, child);
  await child.once("tauri://created", () => {
    clearWindowError();
    setTimeout(() => {
      broadcastRoom(roomId);
    }, 600);
  });
  await child.once("tauri://error", (e) => {
    showWindowError(`채팅방 창 생성 실패: ${JSON.stringify(e)}`);
  });
  clearRoomUnread(roomId);
};

// reuseDmWindow: 같은 대화가 '사용자' 탭의 DM창으로 떠 있으면 그 창에 focus만 줄지.
// 방 만들기로 막 만들어진 새 방은 기존 1:1방과 다른 방이므로 false로 새 창을 연다.
const openRoomWindow = (roomId: number, focusExisting = false, reuseDmWindow = true) => {
  if (!roomId) return;
  clearWindowError();
  if (!isTauriRuntime()) {
    openBrowserRoomWindow(roomId, focusExisting, reuseDmWindow);
    return;
  }
  void openTauriRoomWindowWith(WebviewWindow, roomId, focusExisting, reuseDmWindow).catch(
    (e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e);
      showWindowError(`채팅방 창 열기 실패: ${detail}`);
      routerPushRoom(roomId);
    },
  );
};

const broadcastRoom = (roomId: number) => {
  if (!bus) return;
  const info = myRooms.value.find((r) => r.roomId === roomId);
  bus.post({
    kind: "room-state",
    roomId,
    roomName: (info?.displayName?.trim() ? info.displayName : info?.name) ?? "",
    myNickname: nickname.value,
    messages: [...(roomMessages.value[roomId] ?? [])],
    members: [...(roomMembers.value[roomId] ?? [])],
    connectionStatus: connectionStatus.value,
    isConnected: isConnected.value,
    mainId,
  });
};

const broadcastAllRooms = () => {
  openRooms.forEach((roomId) => broadcastRoom(roomId));
};

// 방제목이 바뀌면 이미 열려 있는 Tauri 방 창의 OS 제목도 함께 갱신한다.
// (웹에서는 방 창이 제목 제목을 그대로 쓰므로 별도 처리가 필요 없다)
const syncTauriRoomTitles = () => {
  if (!isTauriRuntime()) return;
  tauriRoomWindows.forEach((win, roomId) => {
    const info = myRooms.value.find((r) => r.roomId === roomId);
    const disp = info?.displayName?.trim() ? info.displayName : info?.name;
    const title = disp ? `#${roomId} ${disp}` : `채팅방 #${roomId}`;
    void win.setTitle(title).catch(() => undefined);
  });
};

// 더블클릭 시 새 윈도우 창으로 1:1 채팅방을 연다.
// 이미 열려 있으면 새로 열지 않고, 명시적 더블클릭일 때만 포커스를 준다.
const openChatWindow = (peer: string, focusExisting = false) => {
  if (!peer) return;
  clearWindowError();
  if (!isTauriRuntime()) {
    // 웹 브라우저: 사용자 제스처(더블클릭) 안에서 동기로 window.open 해야
    // 팝업 차단을 피할 수 있다. (Tauri API는 절대 건드리지 않는다)
    openBrowserChatWindow(peer, focusExisting);
    return;
  }
  // Tauri: OS 네이티브 자식 윈도우(WebviewWindow)로 연다.
  // (이 모듈은 실제 호출 시점에만 IPC를 쓰므로 정적 import여도 브라우저에서 안전하다)
  void openTauriChatWindowWith(WebviewWindow, peer, focusExisting).catch(
    (e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[vibe-talk] Tauri 채팅 윈도우 열기 실패:", detail);
      showWindowError(`채팅창 열기 실패(WebviewWindow): ${detail}`);
      // 마지막 대안: 같은 창에서 채팅방으로 라우팅 (소켓은 유지됨)
      routerPushChat(peer);
    },
  );
};

// 특정 상대 채팅창에 최신 스냅샷을 내려보낸다 (단일 소스: 메인 창 소켓 상태)
const broadcastPeer = (peer: string) => {
  if (!bus) return;
  bus.post({
    kind: "chat-state",
    peer,
    myNickname: nickname.value,
    messages: [...(dmMessages.value[peer] ?? [])],
    connectionStatus: connectionStatus.value,
    isConnected: isConnected.value,
    mainId,
  });
};

const broadcastAll = () => {
  openPeers.forEach((peer) => broadcastPeer(peer));
};

const handleOpenChat = (user: string) => {
  openChatWindow(user, true);
};

const handleNicknameSubmit = (value: string) => {
  const ok = connect(value);
  if (ok) {
    entered.value = true;
    // 새 창으로 열리는 1:1 채팅방이 닉네임을 읽어갈 수 있도록 저장
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname.value);
  }
};

// join 거부(join_failed) 시: 메인 화면으로 넘어가지 않고 닉네임 화면에 머물며 사유 표시
watch(joinError, (msg) => {
  if (msg) entered.value = false;
});

const closeAllChatWindows = () => {
  chatWindows.value.forEach((child) => {
    try {
      child?.close();
    } catch {
      // 무시
    }
  });
  chatWindows.value.clear();
  roomWindows.value.forEach((child) => {
    try {
      child?.close();
    } catch {
      // 무시
    }
  });
  roomWindows.value.clear();
  tauriChatWindows.forEach((child) => {
    try {
      void child.close().catch(() => undefined);
    } catch {
      // 무시
    }
  });
  tauriChatWindows.clear();
  tauriRoomWindows.forEach((child) => {
    try {
      void child.close().catch(() => undefined);
    } catch {
      // 무시
    }
  });
  tauriRoomWindows.clear();
  openPeers.clear();
  openRooms.clear();
  // Tauri 채팅 윈도우는 라벨로 직접 찾아 닫는다 (핸들 누락 대비)
  if (isTauriRuntime()) {
    void (async () => {
      try {
        const wins = await WebviewWindow.getAll();
        await Promise.all(
          wins
            .filter((w) => w.label.startsWith("chat_"))
            .map((w) => w.close().catch(() => undefined)),
        );
      } catch {
        // 무시
      }
    })();
  }
};

const handleLeave = () => {
  try {
    bus?.post({ kind: "main-closing" });
  } catch {
    // 무시
  }
  disconnect();
  localStorage.removeItem(NICKNAME_STORAGE_KEY);
  // 열려 있던 1:1 채팅창들을 함께 닫는다
  closeAllChatWindows();
  entered.value = false;
};

const handleMainUnload = () => {
  try {
    bus?.post({ kind: "main-closing", mainId });
  } catch {
    // 무시
  }
};

onMounted(() => {
  // Tauri 채팅 윈도우에서는 메인 로직(소켓/버스/자동입장)을 동작시키지 않는다
  if (isTauriChatWindow) return;
  const handleBusMessage: ChatBusHandler = (msg) => {
    // 다른 탭(다른 mainId)의 팝업 메시지는 무시 (A탭/B탭 버스 섞임 방지)
    if ("mainId" in msg && msg.mainId !== undefined && msg.mainId !== mainId) return;
    switch (msg.kind) {
      case "chat-open": {
        // 채팅창이 열릴 때마다 서버에 DB 최근 10건을 요청한다.
        // (이미 열려 있던 창의 재알림은 openPeers 추가 시점에 한해 1회만 요청)
        const firstOpen = !openPeers.has(msg.peer);
        openPeers.add(msg.peer);
        clearUnread(msg.peer);
        broadcastPeer(msg.peer);
        if (firstOpen) requestDmHistory(msg.peer);
        break;
      }
      case "chat-close":
        openPeers.delete(msg.peer);
        forgetPeerFocus(msg.peer);
        break;
      // 채팅창 focus/blur 보고 → "보고 있는 중"인 대화는 안읽은 건수를 잡지 않는다.
      case "chat-focus":
        setPeerFocus(msg.peer, msg.focused);
        break;
      case "chat-send": {
        // BroadcastChannel + tauri event 양쪽으로 같은 메시지가 올 수 있어 id로 중복 제거
        const key = dedupeKeyFor(msg);
        if (key) {
          if (seenBusMessages.has(key)) break;
          seenBusMessages.add(key);
          if (seenBusMessages.size > 200) {
            const oldest = seenBusMessages.values().next().value as string | undefined;
            if (oldest) seenBusMessages.delete(oldest);
          }
        }
        sendDm(msg.peer, msg.text);
        broadcastPeer(msg.peer);
        break;
      }
      case "room-open": {
        // 채팅창이 열릴 때마다 서버에 DB 최근 10건을 요청한다.
        const firstOpen = !openRooms.has(msg.roomId);
        openRooms.add(msg.roomId);
        clearRoomUnread(msg.roomId);
        broadcastRoom(msg.roomId);
        if (firstOpen) requestRoomHistory(msg.roomId);
        break;
      }
      case "room-close":
        openRooms.delete(msg.roomId);
        forgetRoomFocus(msg.roomId);
        break;
      case "room-focus":
        setRoomFocus(msg.roomId, msg.focused);
        break;
      case "room-rename":
        // 채팅방 창(팝업)에서 연필로 요청한 제목 수정.
        // 소켓은 메인 창에만 있으므로 여기서 서버로 넘기고,
        // 서버가 my_rooms를 내려주면 목록이 → 열린 방 창 순서로 자동 갱신된다.
        renameRoom(msg.roomId, msg.title);
        break;
      case "room-send": {
        const key = dedupeKeyFor(msg);
        if (key) {
          if (seenBusMessages.has(key)) break;
          seenBusMessages.add(key);
          if (seenBusMessages.size > 200) {
            const oldest = seenBusMessages.values().next().value as string | undefined;
            if (oldest) seenBusMessages.delete(oldest);
          }
        }
        sendRoom(msg.roomId, msg.text);
        broadcastRoom(msg.roomId);
        break;
      }
      default:
        break;
    }
  };
  // 버스 허브: BroadcastChannel + (Tauri면) tauri event를 동시에 붙인다.
  // 허브 post는 양쪽 채널에 모두 보내고, 수신 중복은 위 id로 제거한다.
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
        // 늦게 붙은 tauri 채널이 있어도 채팅창이 다시 알리도록 유도
        bus?.post({ kind: "main-ready", mainId });
      })
      .catch(() => undefined);
  }
  try {
    // 늦게 뜬 채팅창이 자신을 다시 알리도록 유도 (새로고침 복귀 대응)
    bus.post({ kind: "main-ready", mainId });
  } catch {
    // 무시 (BroadcastChannel 미지원 환경)
  }
  window.addEventListener("beforeunload", handleMainUnload);

  // 새로고침해도 저장된 닉네임으로 자동 입장
  // (동일 탭 라우팅 복귀 시 기존 소켓이 살아있으면 재사용)
  // 단, window.close() 실패로 홈으로 떨어진 팝업(채팅창)에서는 자동 접속하지 않는다.
  // 자동 접속하면 같은 닉네임의 두 번째 소켓이 생기기 때문이다.
  const isPopupWindow = window.opener != null && !window.opener.closed;
  if (!isPopupWindow) {
    const saved = localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (saved && saved.trim() !== "") {
      if (nickname.value === saved && isConnected.value) {
        entered.value = true;
      } else {
        const ok = connect(saved);
        if (ok) {
          entered.value = true;
        }
      }
    }
  }
});

onUnmounted(() => {
  window.removeEventListener("beforeunload", handleMainUnload);
  busClosed = true;
  bus?.close();
  bus = null;
});

// 방/DM/연결 상태가 바뀌면 열려 있는 채팅창들에 스냅샷 브로드캐스트
watch(
  [dmMessages, roomMessages, roomMembers, connectionStatus, isConnected, nickname, myRooms],
  () => {
    broadcastAll();
    broadcastAllRooms();
    syncTauriRoomTitles();
  },
  {
    deep: true,
  },
);

// 방 만들기 팝업(사용자 선택) 상태
// - showCreateModal: 팝업 표시 여부
// - createModalInitial: 팝업에 미리 체크해 둘 사용자 (사용자 우클릭/더보기 경유 시 1명)
const showCreateModal = ref(false);
const createModalInitial = ref<string[]>([]);
// 방 생성 요청 직후 서버의 room_created/my_rooms 반영을 기다리는 동안,
// 새로 생긴 방을 자동으로 열어주기 위한 대기 플래그
const pendingAutoOpen = ref(false);

const openCreateModal = (preselected: string[] = []) => {
  createModalInitial.value = preselected;
  showCreateModal.value = true;
};

const closeCreateModal = () => {
  showCreateModal.value = false;
  createModalInitial.value = [];
};

const handleConfirmCreateRoom = (payload: { members: string[] }) => {
  const ok = createRoom(payload.members);
  if (ok) {
    pendingAutoOpen.value = true;
    closeCreateModal();
    mainTab.value = "rooms";
  }
};

// 사용자 목록에서 "방 만들기" 선택 시: 해당 사용자를 미리 체크한 팝업을 연다
const handleCreateRoomWith = (user: string) => {
  openCreateModal([user]);
};

// ─── 방제목 변경 (사용자별 — 나에게만 적용) ───
// 채팅목록(더보기 메뉴)에서 여는 경우와, 열려 있는 채팅방 창에서 버스로 요청이 오는 경우가
// 같은 상태를 쓴다. 어느 쪽이든 소켓은 메인 창에 있으므로 메인 창이 서버로 보낸다.
// 서버 응답(my_rooms)으로 myRooms가 갱신 → 아래 watcher가 열린 채팅방 창 제목까지 같이 갱신한다.
const renameRoomId = ref<number | null>(null);
const renameTargetRoom = ref<RoomInfo | null>(null);

const openRenameModal = (roomId: number) => {
  const room = myRooms.value.find((r) => r.roomId === roomId);
  if (!room) return;
  renameTargetRoom.value = room;
  renameRoomId.value = roomId;
};

const closeRenameModal = () => {
  renameRoomId.value = null;
  renameTargetRoom.value = null;
};

const handleConfirmRename = (title: string) => {
  if (renameRoomId.value === null) return;
  renameRoom(renameRoomId.value, title);
  closeRenameModal();
};

// ─── 사용자 관리: 추가/수정 (admin 전용) ───
const handleUpsertUser = (payload: { nickname: string; isDeleted: boolean }) => {
  upsertUser(payload.nickname, payload.isDeleted);
};

// 새 1:1 DM이 와도 채팅창을 자동으로 띄우지 않는다.
// (안 읽은 건수는 '사용자' 탭의 배지로 표시되고, 사용자가 더블클릭/메뉴로 직접 연다)
// ── 번호방과 동일하게 목록에서만 알려주고 창은 띄우지 않는다.

// 내가 만든 방이 목록에 반영되면 자동으로 새 창을 연다
// (방 만들기 팝업에서 확인을 누른 직후 1회만 동작)
watch(
  myRooms,
  (rooms) => {
    if (!pendingAutoOpen.value) return;
    if (rooms.length === 0) return;
    // 가장 큰 방 번호 = 방금 생성된 방 (서버는 AUTOINCREMENT 발급)
    const latest = rooms.reduce((a, b) => (a.roomId > b.roomId ? a : b));
    pendingAutoOpen.value = false;
    // 방 만들기로 막 만든 새 방이므로, 같은 대화의 DM창이 떠 있어도 새 방창을 연다
    openRoomWindow(latest.roomId, true, false);
  },
  { deep: true },
);

// 새 방 메시지가 와도 채팅방 창을 자동으로 띄우지 않는다.
// (안 읽은 건수는 '내 채팅방' 목록의 배지로 표시되고, 사용자가 더블클릭/메뉴로 직접 연다)

</script>

<template>
  <!-- 1번 화면: 닉네임 입력 -->
  <NicknameView
    v-if="!entered"
    :connection-status="connectionStatus"
    :is-connected="isConnected"
    :join-error="joinError"
    @submit="handleNicknameSubmit"
  />

  <!-- 2번 화면: 내 채팅방 + 사용자 목록 (채팅은 별도 윈도우 창으로 열림) -->
  <div v-else class="main-screen">
    <div class="main-header">
      <div>
        <div class="me">내 닉네임: <strong>{{ nickname }}</strong></div>
        <div class="status">{{ connectionStatus }}</div>
      </div>
      <div class="header-buttons">
        <button
          v-if="connectionStatus.includes('끊김')"
          class="small-btn primary"
          @click="manualReconnect"
        >
          재연결
        </button>
        <button v-if="isConnected" class="small-btn" @click="handleLeave">
          나가기
        </button>
      </div>
    </div>
    <div class="tab-row">
      <button :class="{ active: mainTab === 'rooms' }" @click="mainTab = 'rooms'">
        내 채팅방 ({{ myRooms.length }})
      </button>
      <button :class="{ active: mainTab === 'users' }" @click="mainTab = 'users'">
        사용자 ({{ userlist.length }})
      </button>
    </div>
    <RoomListView
      v-if="mainTab === 'rooms'"
      :rooms="myRooms"
      :unread="roomUnread"
      :is-connected="isConnected"
      :my-nickname="nickname"
      @open-room="(id) => openRoomWindow(id, true)"
      @request-create="() => openCreateModal()"
      @join-room="(id) => joinRoom(id)"
      @leave-room="(id) => leaveRoom(id)"
      @rename-room="(id) => openRenameModal(id)"
      @refresh="() => refreshRooms()"
    />
    <UserListView
      v-else
      :my-nickname="nickname"
      :users="userlist"
      :online-users="onlineUsers"
      :connection-status="connectionStatus"
      :is-connected="isConnected"
      :is-admin="isAdmin()"
      :users-detail="usersDetail"
      :upsert-result="userUpsertResult"
      @open-chat="handleOpenChat"
      @create-room-with="handleCreateRoomWith"
      @reconnect="manualReconnect"
      @disconnect="handleLeave"
      @upsert-user="handleUpsertUser"
    />
    <!-- 방 만들기 팝업: 사용자 1명 이상 체크 후 확인 (방 이름은 자동 생성) -->
    <CreateRoomModal
      v-if="showCreateModal"
      :users="userlist"
      :initial-selected="createModalInitial"
      :my-nickname="nickname"
      @confirm="handleConfirmCreateRoom"
      @cancel="closeCreateModal"
    />

    <!-- 방제목 변경 팝업: 채팅목록 ⋮ 메뉴(또는 우클릭) → '방제목 변경' -->
    <RenameRoomModal
      v-if="renameRoomId !== null && renameTargetRoom"
      :current-title="roomRawName(renameTargetRoom)"
      @confirm="handleConfirmRename"
      @cancel="closeRenameModal"
    />
  </div>

  <!-- 새 창 열기 실패 시 원인 표시 (Tauri 권한 문제 등) -->
  <div v-if="windowError" class="window-error" @click="clearWindowError">
    {{ windowError }} (클릭하여 닫기)
  </div>
</template>

<style scoped>
.main-screen {
  height: 100vh;
  height: 100dvh;
  padding: 20px;
  font-family: sans-serif;
  background: #f4f6f8;
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.main-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-radius: 10px;
  padding: 12px 16px;
}
.me { font-size: 15px; }
.status { font-size: 12px; color: #666; margin-top: 4px; }
.header-buttons { display: flex; gap: 8px; }
.small-btn {
  padding: 6px 12px; font-size: 13px;
  border: 1px solid #ddd; border-radius: 6px;
  background: #fff; cursor: pointer;
}
.small-btn.primary { background: #007bff; color: #fff; border-color: #007bff; }
.tab-row { display: flex; gap: 8px; }
.tab-row button {
  flex: 1; padding: 10px; font-size: 14px;
  border: 1px solid #ddd; border-radius: 10px;
  background: #fff; cursor: pointer;
}
.tab-row button.active { background: #007bff; border-color: #007bff; color: #fff; font-weight: bold; }
.window-error {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: 10px 14px;
  background: #fdecea;
  color: #b3261e;
  border: 1px solid #f5c6cb;
  border-radius: 8px;
  font-size: 13px;
  font-family: sans-serif;
  cursor: pointer;
  z-index: 3000;
  word-break: break-all;
}
</style>
