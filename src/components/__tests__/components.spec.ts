import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import MessageInput from "../MessageInput.vue";
import MessageList from "../MessageList.vue";
import ConnectionBar from "../ConnectionBar.vue";
import RenameRoomModal from "../RenameRoomModal.vue";
import CloseConfirmModal from "../CloseConfirmModal.vue";
import UserSearchInput from "../UserSearchInput.vue";
import NicknameView from "../NicknameView.vue";
import { AUTO_LOGIN_STORAGE_KEY, SAVED_LOGIN_STORAGE_KEY } from "../../constants";
import { ROOM_TITLE_INPUT_MAX_LENGTH, type ChatUser } from "../../types/chat";

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
