import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import MessageInput from "../MessageInput.vue";
import MessageList from "../MessageList.vue";
import ConnectionBar from "../ConnectionBar.vue";
import RenameRoomModal from "../RenameRoomModal.vue";
import CloseConfirmModal from "../CloseConfirmModal.vue";
import UserSearchInput from "../UserSearchInput.vue";
import NicknameView from "../NicknameView.vue";
import ChatWindow from "../ChatWindow.vue";
import { AUTO_LOGIN_STORAGE_KEY, SAVED_LOGIN_STORAGE_KEY } from "../../constants";
import { ROOM_TITLE_INPUT_MAX_LENGTH, type ChatMessage, type ChatUser } from "../../types/chat";

/** 배열의 마지막 원소 (tsconfig lib이 ES2020이라 Array.prototype.at을 쓰지 않는다) */
const last = <T>(list: T[] | undefined): T | undefined => list?.[list.length - 1];

describe("MessageInput", () => {
  it("입력하면 update:modelValue, Enter와 버튼은 send를 보낸다", async () => {
    const wrapper = mount(MessageInput, { props: { modelValue: "안녕" } });
    const input = wrapper.get("input");
    await input.setValue("반가워");
    expect(last(wrapper.emitted("update:modelValue"))).toEqual(["반가워"]);
    await input.trigger("keyup.enter");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("send")).toHaveLength(2);
  });

  it("빈 값이면 전송 버튼이 비활성화된다", () => {
    const wrapper = mount(MessageInput, { props: { modelValue: "" } });
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });
});

describe("ChatWindow 이전 대화 더보기", () => {
  const ROW_PX = 30;
  const CLIENT_PX = 100;
  const msgs = (from: number, to: number, userNo = 11): ChatMessage[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      type: "room", user_no: userNo, nickname: "영희", text: `m${from + i}`, msgId: from + i,
    }));
  const baseProps = {
    peer: "#5 스터디", myUserNo: 10, myNickname: "철수",
    connectionStatus: "연결됨", isConnected: true,
  };
  /** jsdom 은 레이아웃이 없으므로 메시지 수 × 30px 로 스크롤 높이를 흉내낸다 */
  const fakeGeometry = (el: HTMLElement, count: () => number) => {
    let top = 0;
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => count() * ROW_PX });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => CLIENT_PX });
    Object.defineProperty(el, "scrollTop", {
      configurable: true, get: () => top, set: (v: number) => { top = v; },
    });
  };
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it("맨 위 근처로 스크롤하면 load-older, 앞에 붙으면 보던 위치를 유지한다", async () => {
    const wrapper = mount(ChatWindow, { props: { ...baseProps, messages: msgs(21, 30), hasMore: false } });
    const body = wrapper.get(".chat-body").element as HTMLElement;
    fakeGeometry(body, () => wrapper.props("messages").length);
    await wrapper.setProps({ hasMore: true });

    body.scrollTop = 10;
    await wrapper.get(".chat-body").trigger("scroll");
    expect(wrapper.emitted("load-older")).toHaveLength(1);
    // 응답 전 다시 스크롤해도 중복 요청하지 않는다
    await wrapper.setProps({ loadingOlder: true });
    expect(wrapper.text()).toContain("이전 대화를 불러오는 중");
    await wrapper.get(".chat-body").trigger("scroll");
    expect(wrapper.emitted("load-older")).toHaveLength(1);

    // 10건이 앞에 붙음: 높이 300 → 600, 위치 10 → 310 (같은 메시지를 계속 보고 있음)
    await wrapper.setProps({ messages: [...msgs(11, 20), ...msgs(21, 30)], loadingOlder: false, hasMore: false });
    await flush();
    expect(body.scrollTop).toBe(310);
    expect(wrapper.text()).toContain("대화의 시작입니다");

    // 위쪽을 읽는 중에 상대 메시지가 오면 끌어내리지 않는다
    await wrapper.setProps({ messages: [...msgs(11, 30), ...msgs(31, 31)] });
    await flush();
    expect(body.scrollTop).toBe(310);
    // 내가 보낸 메시지는 맨 아래로
    await wrapper.setProps({ messages: [...msgs(11, 31), ...msgs(32, 32, 10)] });
    await flush();
    expect(body.scrollTop).toBe(22 * ROW_PX);
  });

  it("이전 대화를 보는 중 상대 메시지가 오면 '새 메시지(n)', 누르면 맨 아래로 간다", async () => {
    const wrapper = mount(ChatWindow, { props: { ...baseProps, messages: msgs(1, 20) } });
    const body = wrapper.get(".chat-body").element as HTMLElement;
    fakeGeometry(body, () => wrapper.props("messages").length);
    await flush();
    expect(wrapper.find(".jump-btn").exists()).toBe(false);

    // 위로 올려 이전 대화를 보는 중 → '맨 아래로' 버튼
    body.scrollTop = 100;
    await wrapper.get(".chat-body").trigger("scroll");
    expect(wrapper.find(".to-bottom-btn").exists()).toBe(true);

    // 상대 메시지 2건(따로따로) + 1건 도착 → 위치 유지, 새 메시지(3)
    await wrapper.setProps({ messages: msgs(1, 21) });
    await wrapper.setProps({ messages: msgs(1, 23) });
    await flush();
    expect(body.scrollTop).toBe(100);
    expect(wrapper.get(".new-msg-btn").text()).toContain("새 메시지(3)");
    expect(wrapper.find(".to-bottom-btn").exists()).toBe(false);

    // 누르면 맨 아래로 내려가고 버튼이 사라진다
    await wrapper.get(".new-msg-btn").trigger("click");
    await flush();
    expect(body.scrollTop).toBe(23 * ROW_PX);
    expect(wrapper.find(".jump-btn").exists()).toBe(false);
  });

  it("'맨 아래로' 버튼은 가장 최근 메시지로 이동하고, 직접 바닥까지 내려도 사라진다", async () => {
    const wrapper = mount(ChatWindow, { props: { ...baseProps, messages: msgs(1, 20) } });
    const body = wrapper.get(".chat-body").element as HTMLElement;
    fakeGeometry(body, () => wrapper.props("messages").length);
    await flush();
    body.scrollTop = 0;
    await wrapper.get(".chat-body").trigger("scroll");
    await wrapper.get(".to-bottom-btn").trigger("click");
    await flush();
    expect(body.scrollTop).toBe(20 * ROW_PX);
    expect(wrapper.find(".jump-btn").exists()).toBe(false);

    // 다시 올라갔다가 손으로 바닥 근처까지 내리면 버튼이 사라진다
    body.scrollTop = 0;
    await wrapper.get(".chat-body").trigger("scroll");
    expect(wrapper.find(".to-bottom-btn").exists()).toBe(true);
    body.scrollTop = 20 * ROW_PX - CLIENT_PX;
    await wrapper.get(".chat-body").trigger("scroll");
    expect(wrapper.find(".jump-btn").exists()).toBe(false);
  });

  it("내용이 짧아 스크롤바가 없으면 열자마자 이전 대화를 요청한다", async () => {
    const wrapper = mount(ChatWindow, { props: { ...baseProps, messages: msgs(1, 2), hasMore: true } });
    await flush();
    expect(wrapper.emitted("load-older")).toHaveLength(1);
  });
});

describe("MessageList", () => {
  it("내 메시지와 상대 메시지를 구분하고 상대 닉네임만 표시한다", () => {
    const wrapper = mount(MessageList, {
      props: {
        nickname: "철수",
        messages: [
          { type: "room", user_no: 10, nickname: "철수", text: "내 말" },
          { type: "room", user_no: 11, nickname: "영희", text: "영희 말" },
        ],
      },
    });
    expect(wrapper.findAll(".message-self")).toHaveLength(1);
    const other = wrapper.get(".message-other");
    expect(other.text()).toContain("[영희]");
    expect(other.text()).toContain("영희 말");
    expect(wrapper.get(".message-self").find(".nickname").exists()).toBe(false);
  });
});

describe("ConnectionBar", () => {
  const props = { connectionStatus: "연결됨", nickname: "", isConnected: false };

  it("'끊김' 상태일 때만 재연결 버튼을 보여준다", async () => {
    const wrapper = mount(ConnectionBar, { props });
    expect(wrapper.find(".reconnect-button").exists()).toBe(false);
    await wrapper.setProps({ connectionStatus: "연결 끊김" });
    await wrapper.get(".reconnect-button").trigger("click");
    expect(wrapper.emitted("reconnect")).toHaveLength(1);
  });

  it("연결되면 입력 영역을 숨긴다", async () => {
    const wrapper = mount(ConnectionBar, { props: { ...props, nickname: "철수" } });
    expect(wrapper.find(".input-section").exists()).toBe(true);
    await wrapper.get(".input-section input").trigger("keyup.enter");
    expect(wrapper.emitted("connect")).toHaveLength(1);
    await wrapper.setProps({ isConnected: true });
    expect(wrapper.find(".input-section").exists()).toBe(false);
  });
});

describe("RenameRoomModal", () => {
  it("현재 제목으로 시작하고, 다듬은 제목으로 confirm한다", async () => {
    const wrapper = mount(RenameRoomModal, { props: { currentTitle: "개발팀" } });
    const input = wrapper.get<HTMLInputElement>("input");
    expect(input.element.value).toBe("개발팀");
    expect(input.attributes("maxlength")).toBe(String(ROOM_TITLE_INPUT_MAX_LENGTH));
    await input.setValue("  새 제목  ");
    expect(wrapper.get(".counter").text()).toBe(`8 / ${ROOM_TITLE_INPUT_MAX_LENGTH}`);
    await input.trigger("keyup.enter");
    expect(wrapper.emitted("confirm")).toEqual([["새 제목"]]);
  });

  it("빈 제목이면 오류를 보여주고 confirm하지 않는다", async () => {
    const wrapper = mount(RenameRoomModal, { props: { currentTitle: "개발팀" } });
    await wrapper.get("input").setValue("   ");
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("confirm")).toBeUndefined();
    expect(wrapper.get(".error").text()).toBe("방제목을 입력하세요.");
  });

  it("서버 실패 사유를 보여주고, 취소/Esc/배경 클릭은 cancel", async () => {
    const wrapper = mount(RenameRoomModal, {
      props: { currentTitle: "개발팀", errorReason: "권한이 없습니다" },
    });
    expect(wrapper.text()).toContain("권한이 없습니다");
    await wrapper.get("button.cancel").trigger("click");
    await wrapper.get("input").trigger("keyup.esc");
    await wrapper.get(".modal-backdrop").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(3);
  });
});

describe("CloseConfirmModal", () => {
  it("열린 채팅창 수를 보여주고 버튼/Esc에 맞게 emit한다", async () => {
    // unmount 후에는 wrapper.emitted() 기록이 사라지므로 리스너 prop으로 횟수를 센다
    const onCancel = vi.fn();
    const wrapper = mount(CloseConfirmModal, { props: { openRoomCount: 3, onCancel } });
    expect(wrapper.text()).toContain("채팅창 3개");
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    // unmount 후에는 Esc 리스너가 제거된다
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("UserSearchInput", () => {
  const users: ChatUser[] = [
    { user_no: 1, nickname: "Charlie" },
    { user_no: 2, nickname: "alice" },
    { user_no: 3, nickname: "Bob" },
  ];
  const lastResults = (wrapper: ReturnType<typeof mount>) =>
    (last(wrapper.emitted("update:results"))?.[0] as ChatUser[]).map((u) => u.nickname);

  it("처음에는 전체를 닉네임 순으로, excludeNos는 빼고 내보낸다", () => {
    const wrapper = mount(UserSearchInput, { props: { users, excludeNos: [3] } });
    expect(lastResults(wrapper)).toEqual(["alice", "Charlie"]);
  });

  it("대소문자 무시 부분 일치로 거른다", async () => {
    const wrapper = mount(UserSearchInput, { props: { users } });
    await wrapper.get("input").setValue("AL");
    expect(lastResults(wrapper)).toEqual(["alice"]);
  });

  it("Esc: 검색어가 있으면 지우기만 하고, 없으면 esc를 보낸다", async () => {
    const wrapper = mount(UserSearchInput, { props: { users } });
    const input = wrapper.get("input");
    await input.setValue("bob");
    await input.trigger("keyup.esc");
    expect(last(wrapper.emitted("update:keyword"))).toEqual([""]);
    expect(wrapper.emitted("esc")).toBeUndefined();
    await input.trigger("keyup.esc");
    expect(wrapper.emitted("esc")).toHaveLength(1);
  });
});

describe("NicknameView", () => {
  const props = { connectionStatus: "연결되지 않음", isConnected: false, joinError: "" };

  it("올바른 아이디면 다듬어서 submit한다", async () => {
    const wrapper = mount(NicknameView, { props });
    await wrapper.get("input").setValue("  chulsoo1 ");
    await wrapper.get(".password-input").setValue("pw1234");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("submit")).toEqual([["chulsoo1"]]);
    // 체크하지 않았으면 아무것도 저장하지 않는다
    expect(localStorage.getItem(SAVED_LOGIN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AUTO_LOGIN_STORAGE_KEY)).toBeNull();
  });

  it("비밀번호가 비어 있으면 버튼이 비활성화된다", async () => {
    const wrapper = mount(NicknameView, { props });
    await wrapper.get("input").setValue("chulsoo1");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });

  it("자동로그인을 켜면 비밀번호 저장도 켜지고, 로그인 시 둘 다 저장한다", async () => {
    const wrapper = mount(NicknameView, { props });
    await wrapper.get("input").setValue("chulsoo1");
    await wrapper.get(".password-input").setValue("pw1234");
    await wrapper.get(".auto-login").setValue(true);
    expect((wrapper.get(".save-password").element as HTMLInputElement).checked).toBe(true);
    await wrapper.get("button").trigger("click");
    expect(JSON.parse(localStorage.getItem(SAVED_LOGIN_STORAGE_KEY)!)).toEqual({
      loginId: "chulsoo1",
      password: "pw1234",
    });
    expect(localStorage.getItem(AUTO_LOGIN_STORAGE_KEY)).toBe("1");
  });

  it("비밀번호 저장을 끄면 자동로그인도 꺼진다", async () => {
    const wrapper = mount(NicknameView, { props });
    await wrapper.get(".auto-login").setValue(true);
    await wrapper.get(".save-password").setValue(false);
    expect((wrapper.get(".auto-login").element as HTMLInputElement).checked).toBe(false);
  });

  it("저장된 아이디/비밀번호와 체크 상태를 불러온다", () => {
    localStorage.setItem(SAVED_LOGIN_STORAGE_KEY, JSON.stringify({ loginId: "kim", password: "pw" }));
    localStorage.setItem(AUTO_LOGIN_STORAGE_KEY, "1");
    const wrapper = mount(NicknameView, { props });
    expect((wrapper.get(".nickname-input").element as HTMLInputElement).value).toBe("kim");
    expect((wrapper.get(".password-input").element as HTMLInputElement).value).toBe("pw");
    expect((wrapper.get(".save-password").element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.get(".auto-login").element as HTMLInputElement).checked).toBe(true);
  });

  it("영문+숫자가 아니면 오류를 보여준다", async () => {
    const wrapper = mount(NicknameView, { props });
    await wrapper.get("input").setValue("철수");
    await wrapper.get("input").trigger("keyup.enter");
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(wrapper.get(".error").text()).toContain("영문+숫자");
  });

  it("빈 입력이면 버튼이 비활성화된다", () => {
    const wrapper = mount(NicknameView, { props });
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });

  it("서버 join 오류와 연결 상태를 표시한다", async () => {
    const wrapper = mount(NicknameView, { props });
    expect(wrapper.find(".status").exists()).toBe(false);
    await wrapper.setProps({ joinError: "미등록 사용자", connectionStatus: "입장 거부됨" });
    expect(wrapper.get(".error").text()).toBe("미등록 사용자");
    expect(wrapper.get(".status").text()).toBe("입장 거부됨");
  });
});
