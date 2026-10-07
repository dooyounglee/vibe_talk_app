import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket, installFakeWebSocket } from "../../test/fakeWebSocket";

// 상태가 모듈 전역 싱글턴이라 테스트마다 모듈을 새로 불러와 격리한다.
type Store = ReturnType<(typeof import("../useChatSocket"))["useChatSocket"]>;

const loadStore = async (): Promise<Store> => {
  vi.resetModules();
  const mod = await import("../useChatSocket");
  return mod.useChatSocket();
};

/** 로그인해서 open 상태 소켓까지 만들고 join_ok까지 받은 스토어 */
const connectedStore = async (userNo = 10, nick = "철수"): Promise<{ store: Store; ws: FakeWebSocket }> => {
  const store = await loadStore();
  store.connect("chulsoo");
  const ws = FakeWebSocket.last;
  ws.open();
  ws.receive({ type: "join_ok", user_no: userNo, nickname: nick, loginId: "chulsoo" });
  ws.sent = [];
  return { store, ws };
};

beforeEach(() => {
  installFakeWebSocket();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("LOGIN_ID_RE", () => {
  it("영문+숫자 1~20자만 허용한다", async () => {
    const { LOGIN_ID_RE } = await import("../useChatSocket");
    expect(LOGIN_ID_RE.test("abc123")).toBe(true);
    expect(LOGIN_ID_RE.test("a".repeat(20))).toBe(true);
    expect(LOGIN_ID_RE.test("a".repeat(21))).toBe(false);
    expect(LOGIN_ID_RE.test("")).toBe(false);
    expect(LOGIN_ID_RE.test("철수")).toBe(false);
    expect(LOGIN_ID_RE.test("a b")).toBe(false);
  });
});

describe("connect / join", () => {
  it("잘못된 아이디면 소켓을 만들지 않고 오류를 남긴다", async () => {
    const store = await loadStore();
    expect(store.connect("bad id!")).toBe(false);
    expect(store.joinError.value).toContain("영문+숫자");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("open되면 join을 보내고 연결 상태가 된다", async () => {
    const store = await loadStore();
    expect(store.connect("  chulsoo  ")).toBe(true);
    expect(store.connectionStatus.value).toBe("연결 중...");
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe("ws://localhost:8080");
    ws.open();
    expect(ws.sentJson()).toEqual([{ type: "join", loginId: "chulsoo" }]);
    expect(store.isConnected.value).toBe(true);
    expect(store.connectionStatus.value).toBe("연결됨");
  });

  it("join_ok로 내 정보가 채워진다", async () => {
    const { store } = await connectedStore(3, "영희");
    expect(store.myUserNo.value).toBe(3);
    expect(store.nickname.value).toBe("영희");
    expect(store.isAdmin()).toBe(false);
  });

  it("user_no 1이면 admin이다", async () => {
    const { store } = await connectedStore(1, "admin");
    expect(store.isAdmin()).toBe(true);
  });

  it("join_failed면 오류를 표시하고 연결을 닫는다", async () => {
    const store = await loadStore();
    store.connect("ghost");
    const ws = FakeWebSocket.last;
    ws.open();
    vi.useFakeTimers();
    ws.receive({ type: "join_failed", text: "미등록 사용자" });
    expect(store.joinError.value).toBe("미등록 사용자");
    expect(store.isConnected.value).toBe(false);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("잘못된 JSON이 와도 죽지 않는다", async () => {
    const { ws } = await connectedStore();
    expect(() => ws.receive("{not json")).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("재연결", () => {
  it("서버가 끊으면 3초 후 다시 연결하고 join을 보낸다", async () => {
    vi.useFakeTimers();
    const { store, ws } = await connectedStore();
    ws.drop();
    expect(store.isConnected.value).toBe(false);
    expect(store.connectionStatus.value).toContain("3초 후 재연결");
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const next = FakeWebSocket.last;
    next.open();
    expect(next.sentJson()).toEqual([{ type: "join", loginId: "chulsoo" }]);
    expect(store.connectionStatus.value).toBe("연결됨");
  });

  it("disconnect로 끊으면 재연결하지 않고 화면 상태를 비운다", async () => {
    vi.useFakeTimers();
    const { store, ws } = await connectedStore();
    ws.receive({ type: "my_rooms", rooms: [{ roomId: 1, name: "a", memberCount: 2 }] });
    store.disconnect();
    expect(store.connectionStatus.value).toBe("연결 끊김");
    expect(store.myRooms.value).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("manualReconnect는 즉시 새 소켓을 만든다", async () => {
    const { store } = await connectedStore();
    store.disconnect();
    store.manualReconnect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(store.connectionStatus.value).toBe("연결 중...");
  });
});

describe("수신 메시지 처리", () => {
  it("userlist: 나를 빼고 정리하며 상태는 접속자만 반영한다", async () => {
    const { store, ws } = await connectedStore(10);
    ws.receive({
      type: "userlist",
      users: [
        { user_no: 10, nickname: "철수" },
        { user_no: 11, nickname: "영희" },
        { user_no: 12, nickname: "민수" },
        { user_no: 0, nickname: "잘못된" },
        { user_no: 13, nickname: "" },
      ],
      onlineUsers: [10, 11],
      userStatuses: { "11": "busy", "12": "meeting", "99": "이상한값" },
    });
    expect(store.userlist.value).toEqual([
      { user_no: 11, nickname: "영희", profileImage: null },
      { user_no: 12, nickname: "민수", profileImage: null },
    ]);
    expect(store.onlineUsers.value).toEqual([11]);
    expect(store.statusEmojiOf(11)).toBe("🥵");
    // 상태값은 있지만 접속 중이 아니면 offline
    expect(store.statusTextOf(12)).toBe("오프라인(👻)");
    expect(store.statusTextOf(11)).toBe("바쁨(🥵)");
  });

  it("my_rooms: 표시제목과 미리보기를 정리하고 사라진 방의 데이터를 지운다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 9, messages: [{ user_no: 11, text: "옛날" }] });
    ws.receive({
      type: "my_rooms",
      rooms: [
        { roomId: 1, name: "철수,영희", displayName: "영희", memberCount: 2, lastMessage: "안녕", lastMessageAt: 100 },
        { roomId: 2, name: "개발팀", displayName: " ", memberCount: 4 },
        { name: "roomId 없음" },
      ],
    });
    expect(store.myRooms.value.map((r) => [r.roomId, r.displayName])).toEqual([
      [1, "영희"],
      [2, "개발팀"],
    ]);
    expect(store.myRooms.value[0].lastMessage).toBe("안녕");
    expect(store.myRooms.value[1].lastMessage).toBeNull();
    expect(store.roomMessages.value[9]).toBeUndefined();
  });

  it("history_room: 박스를 덮어쓰고 참여자 목록도 저장한다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({
      type: "history_room",
      roomId: 5,
      messages: [
        { user_no: 11, nickname: "영희", text: "1", msgId: 101, unreadCount: 1 },
        { user_no: 10, nickname: "철수", text: "2", id: 102 },
      ],
      memberProfiles: [
        { user_no: 10, nickname: "철수" },
        { user_no: 11, nickname: "영희" },
      ],
    });
    const box = store.roomMessages.value[5];
    expect(box.map((m) => [m.text, m.msgId, m.unreadCount])).toEqual([
      ["1", 101, 1],
      ["2", 102, 0],
    ]);
    expect(store.roomMembers.value[5]).toHaveLength(2);

    ws.receive({ type: "history_room", roomId: 5, messages: [] });
    expect(store.roomMessages.value[5]).toEqual([]);
  });

  it("room_message: 박스에 추가하고 목록 미리보기를 즉시 갱신한다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "my_rooms", rooms: [{ roomId: 1, name: "a", memberCount: 2 }] });
    ws.receive({ type: "room_message", roomId: 1, from: "영희", user_no: 11, text: "하이", timestamp: 500, msgId: 7, unreadCount: 1 });
    expect(store.roomMessages.value[1]).toEqual([
      { type: "room", user_no: 11, nickname: "영희", text: "하이", timestamp: 500, roomId: 1, msgId: 7, unreadCount: 1 },
    ]);
    expect(store.myRooms.value[0]).toMatchObject({ lastMessage: "하이", lastMessageAt: 500, lastMessageSender: "영희" });
    // 안읽은 건수는 room_message가 아니라 unread_bump로만 올라간다
    expect(store.roomUnread.value[1]).toBeUndefined();
  });

  it("system: 방 번호가 있을 때만 박스에 넣는다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "system", roomId: 3, text: "영희님이 들어왔습니다" });
    ws.receive({ type: "system", text: "전역 알림" });
    expect(store.roomMessages.value[3]).toHaveLength(1);
    expect(store.roomMessages.value[3][0]).toMatchObject({ type: "system", text: "영희님이 들어왔습니다" });
  });

  it("room_closed: 방과 관련 데이터를 모두 지운다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "my_rooms", rooms: [{ roomId: 1, name: "a", memberCount: 2 }, { roomId: 2, name: "b", memberCount: 3 }] });
    ws.receive({ type: "room_message", roomId: 1, text: "x" });
    ws.receive({ type: "unread_bump", scope: "room", target: "1" });
    ws.receive({ type: "room_closed", roomId: 1 });
    expect(store.myRooms.value.map((r) => r.roomId)).toEqual([2]);
    expect(store.roomMessages.value[1]).toBeUndefined();
    expect(store.roomUnread.value[1]).toBeUndefined();
  });

  it("room_rename_failed: 실패 사유를 남기고, 다시 renameRoom하면 지운다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "room_rename_failed", roomId: 4, reason: "too_long" });
    expect(store.roomRenameError.value).toEqual({ roomId: 4, reason: "too_long" });
    store.renameRoom(4, "새 제목");
    expect(store.roomRenameError.value).toBeNull();
  });

  it("dept_upsert_result: 응답마다 seq가 올라간다", async () => {
    const { store, ws } = await connectedStore(1);
    ws.receive({ type: "dept_upsert_result", ok: true });
    ws.receive({ type: "dept_upsert_result", ok: false });
    expect(store.deptUpsertResult.value).toEqual({ seq: 2, ok: false, text: "부서 저장에 실패했습니다" });
  });
});

describe("안읽은 건수", () => {
  it("unread_state는 유효한 값만 복원한다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "unread_state", unread: { room: { "1": 3, "2": 0, abc: 5, "4": 2.7 } } });
    expect(store.roomUnread.value).toEqual({ 1: 3, 4: 2 });
  });

  it("unread_bump는 +1, focus 중인 방은 올리지 않고 서버에 unread_clear를 보낸다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "unread_bump", scope: "room", target: "1" });
    ws.receive({ type: "unread_bump", scope: "room", target: "1" });
    expect(store.roomUnread.value[1]).toBe(2);

    store.setRoomFocus(1, true);
    expect(store.roomUnread.value[1]).toBe(0);
    ws.sent = [];
    ws.receive({ type: "unread_bump", scope: "room", target: "1" });
    expect(store.roomUnread.value[1]).toBe(0);
    expect(ws.sentJson()).toEqual([{ type: "unread_clear", scope: "room", target: "1" }]);

    store.setRoomFocus(1, false);
    ws.receive({ type: "unread_bump", scope: "room", target: "1" });
    expect(store.roomUnread.value[1]).toBe(1);
  });

  it("재접속 시 복원되는 값에서 focus 중인 방은 빠진다", async () => {
    const { store, ws } = await connectedStore();
    store.setRoomFocus(2, true);
    ws.receive({ type: "unread_state", unread: { room: { "1": 3, "2": 5 } } });
    expect(store.roomUnread.value).toEqual({ 1: 3 });
  });

  it("scope가 room이 아니면 무시한다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "unread_bump", scope: "dm", target: "1" });
    expect(store.roomUnread.value).toEqual({});
  });
});

describe("read_ack (메시지별 읽음 숫자)", () => {
  const seed = async () => {
    const ctx = await connectedStore(10);
    ctx.ws.receive({
      type: "history_room",
      roomId: 1,
      messages: [
        { user_no: 10, nickname: "철수", text: "내 메시지", msgId: 100, unreadCount: 2 },
        { user_no: 11, nickname: "영희", text: "영희 메시지", msgId: 101, unreadCount: 2 },
        { user_no: 12, nickname: "민수", text: "id 없음", unreadCount: 2 },
      ],
      memberProfiles: [
        { user_no: 10, nickname: "철수" },
        { user_no: 11, nickname: "영희" },
        { user_no: 12, nickname: "민수" },
      ],
    });
    return ctx;
  };

  it("커서로 발신자를 뺀 안 읽은 인원을 다시 계산한다", async () => {
    const { store, ws } = await seed();
    // 영희는 100까지, 민수는 101까지, 나는 0
    ws.receive({ type: "read_ack", scope: "room", target: "1", cursors: { "11": 100, "12": 101 } });
    const counts = store.roomMessages.value[1].map((m) => m.unreadCount);
    // 100(내 것): 영희·민수 모두 읽음 → 0
    // 101(영희 것): 나(0<101)만 안 읽음 → 1
    // id 없음: 계산할 수 없으니 기존 값 2 유지
    expect(counts).toEqual([0, 1, 2]);
  });

  it("참여자 목록을 모르면 기존 숫자를 그대로 둔다", async () => {
    const { store, ws } = await connectedStore(10);
    ws.receive({
      type: "history_room",
      roomId: 2,
      messages: [{ user_no: 10, text: "x", msgId: 5, unreadCount: 3 }],
    });
    ws.receive({ type: "read_ack", scope: "room", target: "2", cursors: { "11": 99 } });
    expect(store.roomMessages.value[2][0].unreadCount).toBe(3);
  });
});

describe("보내는 액션", () => {
  it("연결되지 않았으면 false를 돌려주고 아무것도 보내지 않는다", async () => {
    const store = await loadStore();
    expect(store.sendRoom(1, "hi")).toBe(false);
    expect(store.joinRoom(1)).toBe(false);
    expect(store.refreshRooms()).toBe(false);
  });

  it("sendRoom은 공백을 다듬고 빈 문자열은 막는다", async () => {
    const { store, ws } = await connectedStore();
    expect(store.sendRoom(1, "   ")).toBe(false);
    expect(store.sendRoom(1, "  안녕  ")).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_message", roomId: 1, text: "안녕" }]);
  });

  it("createRoom은 나를 빼고 중복을 없앤 user_no만 보낸다", async () => {
    const { store, ws } = await connectedStore(10);
    expect(store.createRoom([10])).toBe(false);
    expect(store.createRoom([11, 11, { user_no: 12, nickname: "민수" }, 10, -1])).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_create", memberNos: [11, 12] }]);
  });

  it("renameRoom은 최대 길이로 자르고 빈 제목은 막는다", async () => {
    const { store, ws } = await connectedStore();
    expect(store.renameRoom(1, "  ")).toBe(false);
    store.renameRoom(1, "가".repeat(40));
    expect(ws.sentJson()[0]).toEqual({ type: "room_rename", roomId: 1, title: "가".repeat(30) });
  });

  it("sendRoomInvite는 유효한 user_no만 중복 없이 보낸다", async () => {
    const { store, ws } = await connectedStore();
    expect(store.sendRoomInvite(0, [11])).toBe(false);
    expect(store.sendRoomInvite(1, [])).toBe(false);
    expect(store.sendRoomInvite(1, [11, 11, 0, 12])).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_invite", roomId: 1, memberNos: [11, 12] }]);
  });

  it("upsertUser는 admin만 보낼 수 있다", async () => {
    const { store, ws } = await connectedStore(10);
    expect(store.upsertUser("newbie", "신입", false)).toBe(false);
    expect(ws.sent).toHaveLength(0);
  });

  it("upsertUser: admin이면 입력을 검증하고 보낸다", async () => {
    const { store, ws } = await connectedStore(1, "admin");
    expect(store.upsertUser("bad id", "신입", false)).toBe(false);
    expect(store.userUpsertResult.value).not.toBe("");
    expect(store.upsertUser("newbie", "신입", false, "010", "홍길동", 3)).toBe(true);
    expect(ws.sentJson()).toEqual([
      { type: "user_upsert", loginId: "newbie", nickname: "신입", isDeleted: false, phone: "010", userName: "홍길동", deptNo: 3 },
    ]);
  });
});

describe("이전 대화 더보기 (msgId 커서)", () => {
  const page = (ids: number[]) => ids.map((id) => ({ user_no: 11, text: `m${id}`, msgId: id }));
  const textsOf = (store: Store, roomId: number) =>
    (store.roomMessages.value[roomId] ?? []).map((m) => m.text);

  it("history_room 의 hasMore 를 저장하고, 가장 오래된 msgId 를 커서로 요청한다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([31, 32, 33]), hasMore: true });
    expect(store.roomHasMore.value[5]).toBe(true);
    expect(store.requestOlderMessages(5)).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_history_older", roomId: 5, beforeId: 31 }]);
    expect(store.roomLoadingOlder.value[5]).toBe(true);
  });

  it("불러오는 중에는 중복 요청하지 않는다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([31, 32]), hasMore: true });
    expect(store.requestOlderMessages(5)).toBe(true);
    expect(store.requestOlderMessages(5)).toBe(false);
    expect(ws.sentJson()).toHaveLength(1);
  });

  it("hasMore 가 false 면 요청하지 않는다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([1, 2]), hasMore: false });
    expect(store.requestOlderMessages(5)).toBe(false);
    // hasMore 필드가 없는 구버전 응답도 더 없음으로 본다
    ws.receive({ type: "history_room", roomId: 6, messages: page([1, 2]) });
    expect(store.requestOlderMessages(6)).toBe(false);
    expect(ws.sentJson()).toEqual([]);
  });

  it("history_room_older 는 앞에 붙이고 중복 msgId 는 버린다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([31, 32]), hasMore: true });
    store.requestOlderMessages(5);
    ws.receive({ type: "history_room_older", roomId: 5, beforeId: 31, messages: page([29, 30, 31]), hasMore: false });
    expect(textsOf(store, 5)).toEqual(["m29", "m30", "m31", "m32"]);
    expect(store.roomHasMore.value[5]).toBe(false);
    expect(store.roomLoadingOlder.value[5]).toBe(false);
  });

  it("응답 대기 중 목록이 새로 덮어써졌으면 이어 붙이지 않는다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([31, 32]), hasMore: true });
    store.requestOlderMessages(5);
    ws.receive({ type: "history_room", roomId: 5, messages: page([40, 41]), hasMore: true });
    ws.receive({ type: "history_room_older", roomId: 5, beforeId: 31, messages: page([29, 30]), hasMore: true });
    expect(textsOf(store, 5)).toEqual(["m40", "m41"]);
    expect(store.roomLoadingOlder.value[5]).toBe(false);
  });

  it("연결이 끊기면 불러오는 중 표시를 푼다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([31]), hasMore: true });
    store.requestOlderMessages(5);
    vi.useFakeTimers();
    ws.close();
    expect(store.roomLoadingOlder.value[5]).toBeUndefined();
  });
});

describe("메시지 검색 / 검색 결과 점프", () => {
  const page = (ids: number[]) => ids.map((id) => ({ user_no: 11, text: `m${id}`, msgId: id }));
  const textsOf = (store: Store, roomId: number) =>
    (store.roomMessages.value[roomId] ?? []).map((m) => m.text);

  it("검색을 보내고 같은 검색어의 결과만 반영한다", async () => {
    const { store, ws } = await connectedStore();
    expect(store.requestRoomSearch(5, "  회의  ")).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_search", roomId: 5, keyword: "회의" }]);
    expect(store.roomSearch.value[5]).toEqual({ keyword: "회의", ids: [], loading: true, truncated: false });
    // 이전 검색어의 늦은 응답은 버린다
    ws.receive({ type: "room_search_result", roomId: 5, keyword: "회", ids: [1], truncated: false });
    expect(store.roomSearch.value[5].loading).toBe(true);
    ws.receive({ type: "room_search_result", roomId: 5, keyword: "회의", ids: [30, 12, 3], truncated: true });
    expect(store.roomSearch.value[5]).toEqual({ keyword: "회의", ids: [30, 12, 3], loading: false, truncated: true });
  });

  it("빈 검색어는 검색 해제이고, 해제 뒤 도착한 결과는 버린다", async () => {
    const { store, ws } = await connectedStore();
    store.requestRoomSearch(5, "회의");
    expect(store.requestRoomSearch(5, "  ")).toBe(true);
    expect(store.roomSearch.value[5]).toBeUndefined();
    ws.receive({ type: "room_search_result", roomId: 5, keyword: "회의", ids: [1] });
    expect(store.roomSearch.value[5]).toBeUndefined();
    expect(ws.sentJson()).toHaveLength(1);
  });

  it("점프하면 대상 주변 페이지로 덮어쓰고 이후 대화를 이어 붙인다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room", roomId: 5, messages: page([50, 51]), hasMore: true });
    expect(store.requestMessagesAround(5, 20)).toBe(true);
    expect(ws.sentJson()).toEqual([{ type: "room_history_around", roomId: 5, msgId: 20 }]);
    ws.receive({ type: "history_room_around", roomId: 5, msgId: 20, messages: page([19, 20, 21]), hasMore: true, hasNewer: true });
    expect(textsOf(store, 5)).toEqual(["m19", "m20", "m21"]);
    expect(store.roomHasNewer.value[5]).toBe(true);

    ws.sent = [];
    expect(store.requestNewerMessages(5)).toBe(true);
    expect(store.requestNewerMessages(5)).toBe(false); // 불러오는 중 중복 요청 없음
    expect(ws.sentJson()).toEqual([{ type: "room_history_newer", roomId: 5, afterId: 21 }]);
    ws.receive({ type: "history_room_newer", roomId: 5, afterId: 21, messages: page([21, 22, 23]), hasNewer: false });
    expect(textsOf(store, 5)).toEqual(["m19", "m20", "m21", "m22", "m23"]);
    expect(store.roomHasNewer.value[5]).toBe(false);
    expect(store.roomLoadingNewer.value[5]).toBe(false);
  });

  it("이후 대화 응답 대기 중 목록이 바뀌었으면 이어 붙이지 않는다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room_around", roomId: 5, msgId: 20, messages: page([20, 21]), hasNewer: true });
    store.requestNewerMessages(5);
    ws.receive({ type: "history_room", roomId: 5, messages: page([50, 51]), hasMore: true });
    ws.receive({ type: "history_room_newer", roomId: 5, afterId: 21, messages: page([22]), hasNewer: true });
    expect(textsOf(store, 5)).toEqual(["m50", "m51"]);
    expect(store.roomHasNewer.value[5]).toBe(false);
  });

  it("과거 구간을 보는 중에는 실시간 메시지를 붙이지 않고, 최신 페이지를 받으면 해제된다", async () => {
    const { store, ws } = await connectedStore();
    ws.receive({ type: "history_room_around", roomId: 5, msgId: 20, messages: page([20]), hasNewer: true });
    ws.receive({ type: "room_message", roomId: 5, from: "영희", from_no: 11, text: "새 글", msgId: 99 });
    expect(textsOf(store, 5)).toEqual(["m20"]);
    ws.receive({ type: "history_room", roomId: 5, messages: page([98, 99]), hasMore: true });
    expect(store.roomHasNewer.value[5]).toBe(false);
    ws.receive({ type: "room_message", roomId: 5, from: "영희", from_no: 11, text: "또 새 글", msgId: 100 });
    expect(textsOf(store, 5)).toEqual(["m98", "m99", "또 새 글"]);
  });
});

describe("requestOneToOneRoom", () => {
  it("room_opened를 받으면 방 번호로 resolve한다", async () => {
    const { store, ws } = await connectedStore();
    const pending = store.requestOneToOneRoom(11);
    expect(ws.sentJson()).toEqual([{ type: "dm_room_open", withUserNo: 11 }]);
    ws.receive({ type: "room_opened", withUserNo: 11, roomId: 42 });
    await expect(pending).resolves.toBe(42);
  });

  it("5초 동안 응답이 없으면 null", async () => {
    vi.useFakeTimers();
    const { store } = await connectedStore();
    const pending = store.requestOneToOneRoom(11);
    vi.advanceTimersByTime(5000);
    await expect(pending).resolves.toBeNull();
  });

  it("연결이 없거나 잘못된 번호면 바로 null", async () => {
    const store = await loadStore();
    await expect(store.requestOneToOneRoom(11)).resolves.toBeNull();
    const { store: s2 } = await connectedStore();
    await expect(s2.requestOneToOneRoom(0)).resolves.toBeNull();
  });
});

describe("1:1 방 찾기", () => {
  it("findOneToOneRoomId / oneToOnePeerOfRoom", async () => {
    const { store, ws } = await connectedStore(10, "철수");
    ws.receive({
      type: "my_rooms",
      rooms: [
        { roomId: 1, name: "철수,영희", displayName: "영희", memberCount: 2 },
        { roomId: 2, name: "팀", displayName: "영희,민수", memberCount: 3 },
      ],
    });
    expect(store.findOneToOneRoomId("영희")).toBe(1);
    expect(store.findOneToOneRoomId("민수")).toBeNull();
    expect(store.oneToOnePeerOfRoom(1)).toBe("영희");
    expect(store.oneToOnePeerOfRoom(2)).toBeNull();

    // 실제 멤버 목록이 있으면 그쪽을 우선한다
    ws.receive({ type: "room_members", roomId: 1, memberProfiles: [{ user_no: 10, nickname: "철수" }, { user_no: 11, nickname: "영희(개명)" }] });
    expect(store.oneToOnePeerOfRoom(1)).toBe("영희(개명)");
  });
});

describe("내 상태", () => {
  it("기본값은 접속(online)이고, 다시 접속하면 기본값으로 돌아간다", async () => {
    const { store } = await connectedStore();
    expect(store.myStatus.value).toBe("online");
    store.setMyStatus("away");
    store.connect("chulsoo");
    expect(store.myStatus.value).toBe("online");
  });

  it("setMyStatus는 브라우저에 저장하지 않고 서버에 status_set을 보낸다", async () => {
    const { store, ws } = await connectedStore();
    store.setMyStatus("meeting");
    expect(store.myStatus.value).toBe("meeting");
    expect(localStorage.length).toBe(0);
    expect(ws.sentJson()).toEqual([{ type: "status_set", status: "meeting" }]);
    // 본인 상태는 서버 방송값이 아니라 내 값을 쓴다
    expect(store.statusTextOf(10)).toBe("회의중(📝)");
  });
});
