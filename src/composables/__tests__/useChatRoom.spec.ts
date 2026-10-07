import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { CHAT_BUS_NAME, type ChatBusMessage, type RoomStatePayload } from "../../chatBus";
import { FakeWebSocket, installFakeWebSocket } from "../../test/fakeWebSocket";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

// useChatRoom은 싱글턴 소켓 스토어를 쓰므로 테스트마다 둘 다 새로 불러온다.
type Room = ReturnType<(typeof import("../useChatRoom"))["useChatRoom"]>;
type Store = ReturnType<(typeof import("../useChatSocket"))["useChatSocket"]>;

let wrapper: VueWrapper | null = null;

const mountRoom = async (roomId: number, before?: (store: Store) => void) => {
  vi.resetModules();
  const { useChatRoom } = await import("../useChatRoom");
  const { useChatSocket } = await import("../useChatSocket");
  const store = useChatSocket();
  before?.(store);
  let room!: Room;
  wrapper = mount(
    defineComponent({
      setup() {
        room = useChatRoom(ref(roomId));
        return () => h("div");
      },
    }),
  );
  return { room, store };
};

/** 메인 창 역할을 하는 BroadcastChannel. 채팅창이 보낸 메시지를 모은다. */
const openMainChannel = () => {
  const channel = new BroadcastChannel(CHAT_BUS_NAME);
  const received: ChatBusMessage[] = [];
  channel.onmessage = (e) => received.push(e.data as ChatBusMessage);
  return { channel, received };
};

const roomState = (over: Partial<RoomStatePayload> = {}): ChatBusMessage => ({
  kind: "room-state",
  roomId: 3,
  roomName: "개발팀",
  myUserNo: 10,
  myNickname: "철수",
  messages: [{ type: "room", user_no: 11, nickname: "영희", text: "안녕" }],
  members: [{ user_no: 10, nickname: "철수" }, { user_no: 11, nickname: "영희" }],
  users: [{ user_no: 11, nickname: "영희" }],
  connectionStatus: "연결됨",
  isConnected: true,
  mainId: "main-1",
  ...over,
});

beforeEach(() => {
  installFakeWebSocket();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("useChatRoom — 새 창 (버스 모드)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#/room/3?mainId=main-1");
  });

  it("열리면 room-open을 메인 창에 알린다", async () => {
    const { channel, received } = openMainChannel();
    await mountRoom(3);
    await vi.waitFor(() =>
      expect(received).toContainEqual({ kind: "room-open", roomId: 3, mainId: "main-1" }),
    );
    channel.close();
  });

  it("main-ready를 받으면 room-open과 현재 focus 상태를 다시 알린다", async () => {
    const { channel, received } = openMainChannel();
    await mountRoom(3);
    channel.postMessage({ kind: "main-ready", mainId: "main-1" });
    await vi.waitFor(() =>
      expect(received).toContainEqual({ kind: "room-focus", roomId: 3, focused: true, mainId: "main-1" }),
    );
    channel.close();
  });

  // 회귀 방지: useWindowFocus의 첫 보고는 버스 생성보다 먼저 일어나므로,
  // 버스를 만든 뒤 focus 상태를 다시 보내지 않으면 메인 창이 이 창을 focus 아님으로 본다.
  it("열리자마자 focus 상태를 메인 창에 알린다", async () => {
    const { channel, received } = openMainChannel();
    await mountRoom(3);
    await vi.waitFor(
      () =>
        expect(received).toContainEqual({ kind: "room-focus", roomId: 3, focused: true, mainId: "main-1" }),
      { timeout: 500 },
    );
    channel.close();
  });

  it("focus 없이 열리면 focused: false를 알린다", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const { channel, received } = openMainChannel();
    await mountRoom(3);
    await vi.waitFor(() =>
      expect(received).toContainEqual({ kind: "room-focus", roomId: 3, focused: false, mainId: "main-1" }),
    );
    expect(received).not.toContainEqual(expect.objectContaining({ kind: "room-focus", focused: true }));
    channel.close();
  });

  it("room-state를 받으면 화면 상태를 채운다", async () => {
    const { channel } = openMainChannel();
    const { room } = await mountRoom(3);
    expect(room.linked.value).toBe(false);
    channel.postMessage(roomState());
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    expect(room.roomName.value).toBe("개발팀");
    expect(room.myNickname.value).toBe("철수");
    expect(room.messages.value).toHaveLength(1);
    expect(room.members.value).toHaveLength(2);
    expect(room.isConnected.value).toBe(true);
    channel.close();
  });

  it("다른 방 번호나 다른 메인 창의 상태는 무시한다", async () => {
    const { channel } = openMainChannel();
    const { room } = await mountRoom(3);
    channel.postMessage(roomState({ roomId: 99 }));
    channel.postMessage(roomState({ mainId: "다른-메인" } as Partial<RoomStatePayload>));
    // 마지막으로 정상 메시지를 보내 앞의 두 개가 처리된 뒤임을 보장한다
    channel.postMessage(roomState({ roomName: "정상" }));
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    expect(room.roomName.value).toBe("정상");
    channel.close();
  });

  it("연결 전에는 send가 실패하고, 연결 후에는 room-send를 보낸다", async () => {
    const { channel, received } = openMainChannel();
    const { room } = await mountRoom(3);
    expect(room.send("안녕")).toBe(false);
    channel.postMessage(roomState());
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    expect(room.send("   ")).toBe(false);
    expect(room.send("  안녕  ")).toBe(true);
    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({ kind: "room-send", roomId: 3, text: "안녕", mainId: "main-1" }),
      ),
    );
    channel.close();
  });

  it("renameRoom/invite는 메인 창에 요청을 넘긴다", async () => {
    const { channel, received } = openMainChannel();
    const { room } = await mountRoom(3);
    channel.postMessage(roomState());
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    expect(room.renameRoom(" 새 제목 ")).toBe(true);
    expect(room.invite([12, 0, -1])).toBe(true);
    expect(room.invite([])).toBe(false);
    await vi.waitFor(() => {
      expect(received).toContainEqual({ kind: "room-rename", roomId: 3, title: "새 제목", mainId: "main-1" });
      expect(received).toContainEqual({ kind: "room-invite", roomId: 3, memberNos: [12], mainId: "main-1" });
    });
    channel.close();
  });

  it("loadOlder는 메인 창에 room-load-older를 넘기고, 응답 전까지 중복 요청하지 않는다", async () => {
    const { channel, received } = openMainChannel();
    const { room } = await mountRoom(3);
    channel.postMessage(roomState({ hasMore: false }));
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    expect(room.loadOlder()).toBe(false);
    channel.postMessage(roomState({ hasMore: true }));
    await vi.waitFor(() => expect(room.hasMore.value).toBe(true));
    expect(room.loadOlder()).toBe(true);
    expect(room.loadingOlder.value).toBe(true);
    expect(room.loadOlder()).toBe(false);
    await vi.waitFor(() =>
      expect(received.filter((m) => m.kind === "room-load-older")).toEqual([
        { kind: "room-load-older", roomId: 3, mainId: "main-1" },
      ]),
    );
    // 메인 창이 응답을 반영한 스냅샷을 보내면 loading 이 풀린다
    channel.postMessage(roomState({ hasMore: false, loadingOlder: false }));
    await vi.waitFor(() => expect(room.loadingOlder.value).toBe(false));
    expect(room.hasMore.value).toBe(false);
    channel.close();
  });

  it("main-closing을 받으면 연결 끊김 상태가 된다", async () => {
    const { channel } = openMainChannel();
    const { room } = await mountRoom(3);
    channel.postMessage(roomState());
    await vi.waitFor(() => expect(room.linked.value).toBe(true));
    channel.postMessage({ kind: "main-closing", mainId: "main-1" });
    await vi.waitFor(() => expect(room.linked.value).toBe(false));
    expect(room.isConnected.value).toBe(false);
    expect(room.connectionStatus.value).toBe("메인 창이 종료되었습니다.");
    channel.close();
  });

  it("닫히면 room-close를 알린다", async () => {
    const { channel, received } = openMainChannel();
    await mountRoom(3);
    wrapper?.unmount();
    wrapper = null;
    await vi.waitFor(() =>
      expect(received).toContainEqual({ kind: "room-close", roomId: 3, mainId: "main-1" }),
    );
    channel.close();
  });
});

describe("useChatRoom — 같은 탭 (소켓 직접 사용)", () => {
  const login = (store: Store) => {
    store.connect("chulsoo");
    FakeWebSocket.last.open();
    FakeWebSocket.last.receive({ type: "join_ok", user_no: 10, nickname: "철수" });
  };

  it("열리면 읽음 처리와 최근 내역 요청을 소켓으로 보낸다", async () => {
    await mountRoom(5, login);
    const sent = FakeWebSocket.last.sentJson();
    expect(sent).toContainEqual({ type: "unread_clear", scope: "room", target: "5" });
    expect(sent).toContainEqual({ type: "room_history", roomId: 5 });
  });

  it("스토어 상태를 그대로 보여주고 send는 소켓으로 보낸다", async () => {
    const { room, store } = await mountRoom(5, login);
    const ws = FakeWebSocket.last;
    ws.receive({ type: "my_rooms", rooms: [{ roomId: 5, name: "a", displayName: "영희", memberCount: 2 }] });
    ws.receive({ type: "room_message", roomId: 5, from: "영희", user_no: 11, text: "하이" });
    expect(room.roomName.value).toBe("영희");
    expect(room.messages.value.map((m) => m.text)).toEqual(["하이"]);
    expect(room.myNickname.value).toBe("철수");
    expect(room.hasSession.value).toBe(true);

    ws.sent = [];
    expect(room.send("반가워")).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_message", roomId: 5, text: "반가워" }]);
    // focus 중인 방이므로 안읽은 건수가 올라가지 않는다
    ws.receive({ type: "unread_bump", scope: "room", target: "5" });
    expect(store.roomUnread.value[5] ?? 0).toBe(0);
  });
});
