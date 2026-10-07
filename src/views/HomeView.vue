<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WebviewWindow as WebviewWindowInstance } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";
import type { ChatUser, MyStatus, RoomInfo } from "../types/chat";
import { MY_STATUS_OPTIONS, myStatusText, roomRawName } from "../types/chat";
import NicknameView from "../components/NicknameView.vue";
import UserListView from "../components/UserListView.vue";
import SettingsView from "../components/SettingsView.vue";
import RoomListView from "../components/RoomListView.vue";
import CreateRoomModal from "../components/CreateRoomModal.vue";
import RenameRoomModal from "../components/RenameRoomModal.vue";
import CloseConfirmModal from "../components/CloseConfirmModal.vue";
import { useChatSocket } from "../composables/useChatSocket";
import {
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentRoomIdFromUrl,
  dedupeKeyFor,
  isTauriRuntime,
  type ChatBus,
  type ChatBusHandler,
} from "../chatBus";
import { LOGIN_ID_STORAGE_KEY, MAIN_ID_STORAGE_KEY } from "../constants";
import { isAutoLogin, setAutoLogin } from "../loginPrefs";

// 이 메인 창이 유일한 WebSocket 소유자.
// 채팅방 창(별도 윈도우)은 소켓을 만들지 않고 이벤트 버스로 상태를 받아간다.
// NOTE: 1:1 대화도 방 하나이므로 채팅창 종류는 '방 창' 하나뿐이다.
const {
  nickname,
  loginId,
  myUserNo,
  isConnected,
  connectionStatus,
  myStatus,
  setMyStatus,
  userlist,
  onlineUsers,
  userStatuses,
  usersDetail,
  depts,
  deptUpsertResult,
  upsertDept,
  joinError,
  userUpsertResult,
  userRenameResult,
  isAdmin,
  myRooms,
  roomMessages,
  roomUnread,
  roomMembers,
  findOneToOneRoomId,
  connect,
  manualReconnect,
  disconnect,
  requestOneToOneRoom,
  requestRoomHistory,
  clearRoomUnread,
  setRoomFocus,
  forgetRoomFocus,
  createRoom,
  joinRoom,
  leaveRoom,
  refreshRooms,
  renameRoom,
  sendRoomInvite,
  sendRoom,
  upsertUser,
  renameUser,
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
// Tauri 채팅 윈도우(#/room/...)에서는 메인 로직을 동작시키지 않는다.
// (이 윈도우는 소켓을 만들지 않고 메인 윈도우의 스냅샷만 받아 표시한다)
const isTauriChatWindow = currentRoomIdFromUrl() !== null;

// 화면 상태: false = 1번 화면(닉네임 입력), true = 2번 화면(방 목록 + 사용자 목록)
const entered = ref(false);
// 메인 화면 탭: 'rooms' = 내 채팅방, 'users' = 사용자(1:1 시작점, DB 등록 전체/탈퇴 제외)
const mainTab = ref<"rooms" | "users" | "settings">("rooms");
// 방별 채팅창 (웹: window.open 팝업 핸들 / Tauri: WebviewWindow)
// 1:1 대화도 이 방 창을 쓴다.
const roomWindows = ref(new Map<number, Window | null>());
const tauriRoomWindows = new Map<number, WebviewWindowInstance>();
// 이벤트로 상태를 받아가는 채팅창 목록 (스냅샷 브로드캐스트 대상)
const openRooms = new Set<number>();
const seenBusMessages = new Set<string>();
let bus: (ChatBus & { add: (bus: ChatBus | null) => void }) | null = null;
let busClosed = false;
// 메인 창 닫기 요청(Tauri onCloseRequested) 구독 해제 함수
let unlistenCloseRequested: (() => void) | null = null;

// 새 창 열기 실패 시 화면 상단에 보여줄 에러 메시지
const windowError = ref("");

const showWindowError = (msg: string) => {
  windowError.value = msg;
};

const clearWindowError = () => {
  windowError.value = "";
};

// ─── 메인 창 종료 확인 ───
// 열려 있는 채팅창이 있는 상태에서 메인 창을 닫으면, 채팅창을 먼저 닫아달라고 안내한다.
// Tauri: 창 X/Alt+F4 → onCloseRequested 로 막는다.
// 웹: 창을 닫기 직전(beforeunload)에 막는다(브라우저 기본 확인창 사용).
const showCloseConfirm = ref(false);
const openRoomCountForClose = ref(0);
// '채팅창 닫고 종료'로 확인받은 뒤에는 재차 닫기 요청이 와도 가로막지 않는다.
let allowMainClose = false;

// 번호방: 새 창 열기 (웹 팝업 / Tauri WebviewWindow)
// NOTE: 1:1 대화도 이 창을 쓴다(1:1 = 멤버 2명 방).
const roomWindowLabel = (roomId: number) => `room_${roomId}`;

const openBrowserRoomWindow = (roomId: number, focusExisting: boolean) => {
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
    // 팝업 차단 시 "사용자가 직접 누른 경우"에만 같은 탭 라우팅으로 대체한다.
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
) => {
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
// 방 창을 연다 (1:1 대화도 이 함수를 쓴다)
const openRoomWindow = (roomId: number, focusExisting = false) => {
  if (!roomId) return;
  clearWindowError();
  if (!isTauriRuntime()) {
    openBrowserRoomWindow(roomId, focusExisting);
    return;
  }
  void openTauriRoomWindowWith(WebviewWindow, roomId, focusExisting).catch(
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
    myUserNo: myUserNo.value,
    myNickname: nickname.value,
    messages: [...(roomMessages.value[roomId] ?? [])],
    members: [...(roomMembers.value[roomId] ?? [])],
    // 채팅창이 '초대하기' 모달을 띄울 때 쓰는 사용자 목록 스냅샷 (본인 제외)
    users: [...userlist.value],
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

// '사용자' 탭에서 상대를 눌러 1:1 창을 연다.
// 1:1도 방 하나이므로 같은 방식으로 처리한다:
//   이미 만들어진 방이 있으면 곧바로 열고, 없으면 서버에 방을 만들어 달라고 요청한다.
// (메시지 0개인 1:1방은 '내 채팅방' 목록에서 숨기므로 빈 방이 눈에 보이지 않는다)
const handleOpenChat = (user: ChatUser) => {
  if (!user || !Number.isInteger(user.user_no)) return;
  const existing = findOneToOneRoomId(user.nickname);
  if (existing !== null) {
    openRoomWindow(existing, true);
    return;
  }
  void requestOneToOneRoom(user.user_no)
    .then((roomId) => {
      if (roomId !== null) openRoomWindow(roomId, true);
    })
    .catch(() => {
      // 실패해도 창을 열지 않는다 (안 읽은 방이 생기지 않도록)
    });
};

const handleNicknameSubmit = (value: string) => {
  // value = 아이디(영문+숫자). connect()가 로컬 저장까지 처리한다.
  const ok = connect(value);
  if (ok) {
    entered.value = true;
  }
};

// join 거부(join_failed) 시: 메인 화면으로 넘어가지 않고 닉네임 화면에 머물며 사유 표시
// 자동로그인이 계속 거부되지 않도록 자동로그인도 끈다.
watch(joinError, (msg) => {
  if (!msg) return;
  entered.value = false;
  setAutoLogin(false);
});

// 로그아웃 시 열려 있던 채팅방 창들을 모두 닫는다
const closeAllRoomWindows = () => {
  roomWindows.value.forEach((child) => {
    try {
      child?.close();
    } catch {
      // 무시
    }
  });
  roomWindows.value.clear();
  tauriRoomWindows.forEach((child) => {
    try {
      void child.close().catch(() => undefined);
    } catch {
      // 무시
    }
  });
  tauriRoomWindows.clear();
  openRooms.clear();
  // Tauri 채팅 윈도우는 라벨로 직접 찾아 닫는다 (핸들 누락 대비)
  if (isTauriRuntime()) {
    void (async () => {
      try {
        const wins = await WebviewWindow.getAll();
        await Promise.all(
          wins
            .filter((w) => w.label.startsWith("room_"))
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
  localStorage.removeItem(LOGIN_ID_STORAGE_KEY);
  // 직접 로그아웃했으면 다음 실행 때 자동로그인하지 않는다 (저장된 아이디/비밀번호는 유지)
  setAutoLogin(false);
  // 열려 있던 채팅방 창들을 함께 닫는다
  closeAllRoomWindows();
  entered.value = false;
};

// ─── 메인 창 닫기 요청 ───
// 열려 있는 채팅창이 있으면 닫지 않고, 채팅창을 먼저 닫아달라고 안내한다.
// 웹에서는 창이 닫히기 직전(beforeunload)에만 확인할 수 있으므로 동기로 판단한다.

// 웹 팝업(window.open) 중 아직 닫히지 않은 채팅창 개수
const countOpenBrowserRoomWindows = (): number => {
  let aliveCount = 0;
  roomWindows.value.forEach((child) => {
    if (child && !child.closed) aliveCount += 1;
  });
  return aliveCount;
};

/**
 * 열려 있는 채팅창 개수를 센다.
 * - Tauri: room_ 라벨을 가진 실제 윈도우를 조회한다(이미 닫힌 창은 걸러진다).
 * - 웹: 팝업 핸들이 살아있는지로 판단한다.
 */
const countOpenRoomWindows = async (): Promise<number> => {
  if (!isTauriRuntime()) return countOpenBrowserRoomWindows();
  try {
    const wins = await WebviewWindow.getAll();
    const alive = wins.filter((w) => w.label.startsWith("room_"));
    if (alive.length > 0) return alive.length;
  } catch {
    // 조회 실패 시 아래 캐시 기준으로 판단한다
  }
  return tauriRoomWindows.size;
};

// Tauri: 창 X(또는 Alt+F4)를 눌렀을 때. 열린 채팅창이 있으면 닫기를 막는다.
const handleMainCloseRequested = async (event: CloseRequestedEvent) => {
  if (allowMainClose) return;
  const count = await countOpenRoomWindows();
  if (count === 0) return;
  event.preventDefault();
  openRoomCountForClose.value = count;
  showCloseConfirm.value = true;
};

const cancelMainClose = () => {
  showCloseConfirm.value = false;
};

// 모달에서 '채팅창 닫고 종료'를 누른 경우: 열린 채팅창을 모두 닫고 메인 창도 닫는다.
const confirmMainClose = async () => {
  showCloseConfirm.value = false;
  allowMainClose = true;
  closeAllRoomWindows();
  try {
    await getCurrentWindow().close();
  } catch {
    // 닫기에 실패하면 다음번에 다시 확인 절차를 탄다
    allowMainClose = false;
  }
};

const handleMainUnload = (event: BeforeUnloadEvent) => {
  // 웹에서는 Tauri의 onCloseRequested 가 없으므로 마지막Chance인 beforeunload 로 막는다.
  // (브라우저 기본 확인창이 뜬다)
  if (!isTauriRuntime() && !allowMainClose && countOpenBrowserRoomWindows() > 0) {
    event.preventDefault();
    event.returnValue = "메인 창을 닫으려면 열려 있는 채팅창을 먼저 닫아주세요.";
    return;
  }
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
      case "room-invite":
        // 채팅방 창(팝업)에서 '+'로 요청한 초대.
        // 소켓은 메인 창에만 있으므로 여기서 서버로 넘기고,
        // 서버가 my_rooms/history_room을 내려주면 대상자 화면이 갱신된다.
        sendRoomInvite(msg.roomId, msg.memberNos);
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
  if (isTauriRuntime()) {
    // 창 X/Alt+F4 로 닫으려는 요청을 받아, 열린 채팅창이 있으면 막는다.
    void getCurrentWindow()
      .onCloseRequested((event) => handleMainCloseRequested(event))
      .then((unlisten) => {
        // 언마운트가 먼저 끝났으면 방금 등록한 구독을 즉시 해제한다.
        if (busClosed) {
          try {
            unlisten();
          } catch {
            // 무시
          }
          return;
        }
        unlistenCloseRequested = unlisten;
      })
      .catch(() => undefined);
  }

  // 새로고침해도 저장된 닉네임으로 자동 입장
  // (동일 탭 라우팅 복귀 시 기존 소켓이 살아있으면 재사용)
  // 새로 접속하는 것은 로그인 화면에서 "자동로그인"을 켠 경우에만 한다.
  // 단, window.close() 실패로 홈으로 떨어진 팝업(채팅창)에서는 자동 접속하지 않는다.
  // 자동 접속하면 같은 닉네임의 두 번째 소켓이 생기기 때문이다.
  const isPopupWindow = window.opener != null && !window.opener.closed;
  if (!isPopupWindow) {
    const saved = localStorage.getItem(LOGIN_ID_STORAGE_KEY);
    if (saved && saved.trim() !== "") {
      if (loginId.value === saved && isConnected.value) {
        entered.value = true;
      } else if (isAutoLogin()) {
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
  try {
    unlistenCloseRequested?.();
  } catch {
    // 무시
  }
  unlistenCloseRequested = null;
  busClosed = true;
  bus?.close();
  bus = null;
});

// 방/연결 상태가 바뀌면 열려 있는 채팅방 창들에 스냅샷 브로드캐스트
watch(
  [roomMessages, roomMembers, connectionStatus, isConnected, nickname, myRooms],
  () => {
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
const createModalInitial = ref<number[]>([]);
// 방 생성 요청 직후 서버의 room_created/my_rooms 반영을 기다리는 동안,
// 새로 생긴 방을 자동으로 열어주기 위한 대기 플래그
const pendingAutoOpen = ref(false);

const openCreateModal = (preselected: number[] = []) => {
  createModalInitial.value = preselected;
  showCreateModal.value = true;
};

const closeCreateModal = () => {
  showCreateModal.value = false;
  createModalInitial.value = [];
};

const handleConfirmCreateRoom = (payload: { members: number[] }) => {
  const ok = createRoom(payload.members);
  if (ok) {
    pendingAutoOpen.value = true;
    closeCreateModal();
    mainTab.value = "rooms";
  }
};

// 사용자 목록에서 "방 만들기" 선택 시: 해당 사용자를 미리 체크한 팝업을 연다
const handleCreateRoomWith = (user: ChatUser) => {
  if (!Number.isInteger(user.user_no)) return;
  openCreateModal([user.user_no]);
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

// ─── 방 초대 (채팅목록 ⋮ 메뉴 → '초대') ───
// 채팅방 창의 '+'로 여는 경우와 같은 CreateRoomModal invite 모드를 쓴다.
// 소켓은 메인 창에만 있으므로 이쪽이 서버(room_invite)로 보낸다.
const inviteRoomId = ref<number | null>(null);
const inviteError = ref("");

const openInviteModal = (roomId: number) => {
  if (!myRooms.value.some((r) => r.roomId === roomId)) return;
  inviteError.value = "";
  inviteRoomId.value = roomId;
};

const closeInviteModal = () => {
  inviteRoomId.value = null;
  inviteError.value = "";
};

// 초대 시 검색/선택에서 제외할 사용자: 알고 있는 기존 멤버 + 본인
const inviteExcludeNos = computed<number[]>(() => {
  const roomId = inviteRoomId.value;
  if (roomId === null) return [];
  const known = roomMembers.value[roomId] ?? [];
  return [
    ...new Set([
      ...known.map((u) => u.user_no),
      ...(myUserNo.value !== null ? [myUserNo.value] : []),
    ]),
  ];
});

const handleConfirmInvite = (payload: { members: number[] }) => {
  if (inviteRoomId.value === null) return;
  if (!sendRoomInvite(inviteRoomId.value, payload.members)) {
    inviteError.value = "초대 요청을 보내지 못했습니다. 연결을 확인해주세요.";
    return;
  }
  closeInviteModal();
};

// ─── 사용자 관리: 추가/수정 (admin 전용) ───
const handleUpsertUser = (payload: {
  loginId: string;
  nickname: string;
  phone: string | null;
  userName: string | null;
  isDeleted: boolean;
  deptNo: number | null;
}) => {
  upsertUser(payload.loginId, payload.nickname, payload.isDeleted, payload.phone, payload.userName, payload.deptNo);
};

// ─── 헤더 더보기(⋮) 메뉴: 내 닉네임 변경 / 나가기 ───
const showHeaderMenu = ref(false);
const toggleHeaderMenu = () => {
  showHeaderMenu.value = !showHeaderMenu.value;
};
const closeHeaderMenu = () => {
  showHeaderMenu.value = false;
};
const handleMenuLeave = () => {
  closeHeaderMenu();
  handleLeave();
};

// ─── 내 닉네임 변경 (본인) ───
const showMyRenameModal = ref(false);
const myRenameInput = ref("");
const myRenameError = ref("");
const openMyRenameModal = () => {
  closeHeaderMenu();
  myRenameInput.value = nickname.value;
  myRenameError.value = "";
  showMyRenameModal.value = true;
};
const closeMyRenameModal = () => {
  showMyRenameModal.value = false;
  myRenameError.value = "";
};
const confirmMyRenameModal = () => {
  const nick = myRenameInput.value.trim().slice(0, 20);
  if (!nick) {
    myRenameError.value = "닉네임을 입력하세요.";
    return;
  }
  if (myUserNo.value == null) {
    myRenameError.value = "로그인이 필요합니다.";
    return;
  }
  myRenameError.value = "";
  renameUser(myUserNo.value, nick);
  showMyRenameModal.value = false;
};

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
    openRoomWindow(latest.roomId, true);
  },
  { deep: true },
);

// ─── '내 채팅방' 목록에 보여줄 방 ───
// 1:1 방은 '사용자' 탭에서 창만 열면 만들어진다. 메시지를 한 번도 안 보낸
// 1:1 방(메시지 0개)은 목록에 띄우지 않는다 → 빈 방이 사용자에게 보이지 않는다.
// 그룹방은 "방 만들기"로 일부러 만든 것이므로 메시지가 없어도 표시한다.
const visibleRooms = computed<RoomInfo[]>(() =>
  myRooms.value.filter((r) => {
    if (r.memberCount !== 2) return true;
    return r.lastMessage != null && String(r.lastMessage).trim() !== "";
  }),
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
        <!-- 내 상태: 닉네임 오른쪽(=나가기 버튼 왼쪽) 드롭다운.
             status_set으로 서버에 전파되어 다른 사용자에게도 표시된다. -->
        <label class="status-select-wrap" title="내 상태 (다른 사용자에게도 표시됩니다)">
          <span class="status-select-label">내 상태</span>
          <select
            class="status-select"
            :class="myStatus"
            :value="myStatus"
            @change="setMyStatus(($event.target as HTMLSelectElement).value as MyStatus)"
          >
            <option v-for="opt in MY_STATUS_OPTIONS" :key="opt.value" :value="opt.value">
              {{ myStatusText(opt.value) }}
            </option>
          </select>
        </label>
        <button
          v-if="connectionStatus.includes('끊김')"
          class="small-btn primary"
          @click="manualReconnect"
        >
          재연결
        </button>
        <!-- 더보기(⋮) 메뉴: 내 닉네임 변경 / 나가기 -->
        <div class="header-menu-wrap">
          <button class="more-btn" title="더보기" @click.stop="toggleHeaderMenu">⋮</button>
          <div v-if="showHeaderMenu" class="header-menu-backdrop" @click="closeHeaderMenu"></div>
          <div v-if="showHeaderMenu" class="header-menu" @click.stop>
            <button :disabled="!isConnected" @click="openMyRenameModal">내 닉네임 변경</button>
            <button v-if="isConnected" @click="handleMenuLeave">나가기</button>
          </div>
        </div>
      </div>
    </div>
    <div class="tab-row">
      <button :class="{ active: mainTab === 'rooms' }" @click="mainTab = 'rooms'">
        내 채팅방 ({{ visibleRooms.length }})
      </button>
      <button :class="{ active: mainTab === 'users' }" @click="mainTab = 'users'">
        사용자 ({{ userlist.length }})
      </button>
      <button v-if="isAdmin()" :class="{ active: mainTab === 'settings' }" @click="mainTab = 'settings'">
        설정
      </button>
    </div>
    <RoomListView
      v-if="mainTab === 'rooms'"
      :rooms="visibleRooms"
      :unread="roomUnread"
      :is-connected="isConnected"
      :my-nickname="nickname"
      @open-room="(id) => openRoomWindow(id, true)"
      @request-create="() => openCreateModal()"
      @join-room="(id) => joinRoom(id)"
      @leave-room="(id) => leaveRoom(id)"
      @rename-room="(id) => openRenameModal(id)"
      @invite-room="(id) => openInviteModal(id)"
      @refresh="() => refreshRooms()"
    />
    <SettingsView
      v-else-if="mainTab === 'settings' && isAdmin()"
      :depts="depts"
      :dept-upsert-result="deptUpsertResult"
      :is-connected="isConnected"
      @upsert-dept="upsertDept"
    />
    <UserListView
      v-else
      :my-user-no="myUserNo"
      :users="userlist"
      :online-users="onlineUsers"
      :user-statuses="userStatuses"
      :connection-status="connectionStatus"
      :is-connected="isConnected"
      :is-admin="isAdmin()"
      :users-detail="usersDetail"
      :depts="depts"
      :upsert-result="userUpsertResult"
      :rename-result="userRenameResult"
      @open-chat="handleOpenChat"
      @create-room-with="handleCreateRoomWith"
      @reconnect="manualReconnect"
      @disconnect="handleLeave"
      @upsert-user="handleUpsertUser"
    />
    <!-- 내 닉네임 변경 모달 (헤더 ⋮ 메뉴 → '내 닉네임 변경') -->
    <div v-if="showMyRenameModal" class="modal-backdrop" @click="closeMyRenameModal">
      <div class="modal-card" @click.stop>
        <h3>내 닉네임 변경</h3>
        <label class="field-label">닉네임</label>
        <input
          v-model="myRenameInput"
          class="text-input"
          placeholder="닉네임 입력"
          maxlength="20"
          @keyup.enter="confirmMyRenameModal"
        />
        <p v-if="myRenameError" class="error">{{ myRenameError }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="closeMyRenameModal">취소</button>
          <button class="small-btn primary" @click="confirmMyRenameModal">저장</button>
        </div>
      </div>
    </div>
    <p v-if="userRenameResult && mainTab !== 'users'" class="rename-result">{{ userRenameResult }}</p>
    <!-- 방 만들기 팝업: 사용자 1명 이상 체크 후 확인 (방 이름은 자동 생성) -->
    <CreateRoomModal
      v-if="showCreateModal"
      :users="userlist"
      :initial-selected="createModalInitial"
      :my-nickname="nickname"
      :my-user-no="myUserNo"
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

    <!-- 방 초대 팝업: 채팅목록 ⋮ 메뉴의 '초대' → 사용자 선택 후 확인 -->
    <CreateRoomModal
      v-if="inviteRoomId !== null"
      mode="invite"
      :users="userlist"
      :exclude-nos="inviteExcludeNos"
      :my-nickname="nickname"
      :my-user-no="myUserNo"
      :error-reason="inviteError"
      @confirm="handleConfirmInvite"
      @cancel="closeInviteModal"
    />
  </div>

  <!-- 메인 창을 닫으려는데 열려 있는 채팅창이 있을 때 뜨는 안내 -->
  <CloseConfirmModal
    v-if="showCloseConfirm"
    :open-room-count="openRoomCountForClose"
    @confirm="confirmMainClose"
    @cancel="cancelMainClose"
  />

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
.header-buttons { display: flex; gap: 8px; align-items: center; }
/* 내 상태 드롭다운: 라벨 + 상태별 색(select는 상태값을 class로 받아 색을 바꾼다) */
.status-select-wrap { display: flex; align-items: center; gap: 6px; }
.status-select-label { font-size: 12px; color: #666; white-space: nowrap; }
.status-select {
  padding: 6px 8px;
  font-size: 13px;
  font-family: sans-serif;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #333;
  cursor: pointer;
}
.status-select.online { color: #1a7f37; border-color: #b7dfc4; }
.status-select.offline { color: #888; border-color: #ddd; }
.status-select.meeting { color: #b3261e; border-color: #f0b8b4; }
.status-select.busy { color: #b25e00; border-color: #f2d0a8; }
.status-select.away { color: #7a5c00; border-color: #e6d79a; }
.small-btn {
  padding: 6px 12px; font-size: 13px;
  border: 1px solid #ddd; border-radius: 6px;
  background: #fff; cursor: pointer;
}
.small-btn.primary { background: #007bff; color: #fff; border-color: #007bff; }
/* 헤더 더보기(⋮) 메뉴 */
.header-menu-wrap { position: relative; }
.more-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #555;
}
.more-btn:hover { background: #f0f0f0; }
.header-menu-backdrop { position: fixed; inset: 0; z-index: 999; }
.header-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  display: flex;
  flex-direction: column;
  min-width: 160px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}
.header-menu button {
  padding: 10px 14px;
  font-size: 14px;
  border: none;
  background: #fff;
  cursor: pointer;
  text-align: left;
}
.header-menu button:hover:not(:disabled) { background: #f2f7ff; }
.header-menu button:disabled { color: #aaa; cursor: default; }
.header-menu button + button { border-top: 1px solid #eee; }
/* 내 닉네임 변경 모달 */
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
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.field-label { display: block; font-size: 13px; color: #555; margin: 8px 0 4px; }
.text-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.error { color: #d33; font-size: 13px; margin: 8px 0 0; }
.rename-result { color: #d33; font-size: 13px; margin: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
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
