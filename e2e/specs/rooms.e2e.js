// 채팅방 관리: 방 만들기 / 검색 / 방제목 변경 / 초대 / 방 이미지 / 나가기.
// 앱은 일반 사용자 rme로 로그인하고, 다른 참여자(rma~rmd)는 Node WebSocket 클라이언트로 붙는다.
// 방 창은 실제 앱처럼 Tauri 새 창으로 열어서 window handle을 전환해 검증한다.
// 테스트는 위에서부터 같은 방을 이어서 쓴다 (만들기 → 이름 변경 → 초대 → … → 나가기).
import {
  closeExtraWindows,
  currentRoomId,
  fixture,
  loginAs,
  messageContent,
  roomItem,
  setFileInput,
  switchToMain,
  switchToRoom,
  switchToWindowWhere,
} from "../helpers/app.js";
import { changedPassword, connectClient, createActiveUser, createRoom } from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "rme";
const A = "rma";
const B = "rmb";
const C = "rmc";
const D = "rmd";
// 방 이름: 만들기 모달 미리보기는 나를 포함하지만, 만든 뒤 내 목록·창 제목에는 나를 뺀 참여자 이름이 보인다
const PREVIEW_NAME = `${A},${B},${ME}`;
const ROOM_NAME = `${A},${B}`;

/** 방 목록 항목의 ⋮ 메뉴에서 동작 실행 */
const roomMenu = async (text, action) => {
  const item = roomItem(text);
  await item.waitForDisplayed({ timeout: 10_000 });
  await item.$(".room-more").click();
  await $(".room-ctx").$(`button=${action}`).click();
};

/** 방 만들기/초대 모달에서 사용자 체크 */
// 부분 일치(*=)는 다른 spec 사용자(예: aunormal ⊃ rma)와 겹치므로 항목 전체 텍스트가 같은 것을 고른다
const pickUser = (nickname) => $(".modal").$(`.select-item=${nickname}`).$("input[type=checkbox]").click();

const openCreateModal = async () => {
  await $(".room-screen .more-btn").click();
  await $(".room-screen .ctx-menu").$("button=방 만들기").click();
  await expect($(".modal .modal-title")).toHaveText("방 만들기");
};

/** 방 창 헤더의 참여자 버튼 ("👥 3") */
const membersBtn = () => $(".chat-header .members-btn:not(.search-btn)");

/** client의 inbox에서 roomId 방 정보가 조건을 만족하는 my_rooms가 올 때까지 */
const waitMyRoom = (client, roomId, pred = () => true) =>
  client.waitFor((m) => m.type === "my_rooms" && m.rooms.some((r) => r.roomId === roomId && pred(r)));

describe("채팅방 관리", () => {
  const no = {};
  let a = null;
  let c = null;
  let roomId = 0;

  before(async () => {
    const admin = await connectClient("admin");
    for (const id of [ME, A, B, C, D]) no[id] = await createActiveUser(admin, id);
    admin.close();
    a = await connectClient(A);
    c = await connectClient(C);
    await loginAs(ME, changedPassword(ME));
  });

  afterEach(async () => {
    // 모달이 남아 있으면 닫고, 열린 방 창을 정리한다
    await closeExtraWindows();
    if (await $(".modal-backdrop").isExisting()) await browser.keys("Escape");
  });

  after(() => {
    a?.close();
    c?.close();
  });

  it("참여자를 고르면 방 이름 미리보기가 바뀌고, 선택 해제·전체 해제가 된다", async () => {
    await openCreateModal();
    await expect($(".modal .selected-empty")).toBeDisplayed();
    await expect($(".modal button.primary")).toBeDisabled();

    await pickUser(A);
    await expect($(".modal .room-name-value")).toHaveText("1:1 대화");

    await pickUser(B);
    await expect($(".modal .room-name-value")).toHaveText(PREVIEW_NAME);
    await expect($(".modal .selected-title")).toHaveText("선택한 사용자 (2명)");

    // 칩의 ×로 한 명 해제
    await $(".modal").$(`.chip*=${B}`).$(".chip-x").click();
    await expect($(".modal .selected-title")).toHaveText("선택한 사용자 (1명)");

    await $(".modal .clear-all-btn").click();
    await expect($(".modal .selected-empty")).toBeDisplayed();
    await expect($(".modal button.primary")).toBeDisabled();

    await $(".modal button.cancel").click();
    await expect($(".modal")).not.toBeExisting();
  });

  it("방을 만들면 새 방 창이 열리고 참여자가 모두 보인다", async () => {
    await openCreateModal();
    await pickUser(A);
    await pickUser(B);
    await $(".modal button.primary").click();

    await switchToWindowWhere((url) => url.includes("#/room/"), { what: "새 방 창" });
    roomId = await currentRoomId();
    expect(roomId).toBeGreaterThan(0);
    await $(".chat-body").waitForDisplayed({ timeout: 10_000 });
    await expect(membersBtn()).toHaveText("👥 3");
    await expect(browser).toHaveTitle(`#${roomId} ${ROOM_NAME}`);

    // 참여자 목록: 나 → 방장 → 나머지
    await membersBtn().click();
    await expect($$(".member-list .member-item")).toBeElementsArrayOfSize(3);
    await expect($$(".member-list .member-item")[0]).toHaveText(expect.stringContaining(ME));
    await $(".modal .modal-btns button.primary").click();

    // 다른 참여자에게도 방이 생긴다
    await waitMyRoom(a, roomId);

    await switchToMain();
    await expect(roomItem(ROOM_NAME)).toBeDisplayed();
  });

  it("방 목록을 이름·참여자로 검색할 수 있다", async () => {
    const search = $(".room-screen .search-input");
    await search.setValue(B);
    await expect(roomItem(ROOM_NAME)).toBeDisplayed();

    await search.setValue("nosuchroom");
    await expect($(".room-screen .empty")).toHaveText("'nosuchroom' 검색 결과가 없습니다.");
    await expect($$(".room-screen .room-item")).toBeElementsArrayOfSize(0);

    await $(".room-screen .search-clear").click();
    await expect(search).toHaveValue("");
    await expect(roomItem(ROOM_NAME)).toBeDisplayed();
  });

  it("목록 메뉴에서 방제목을 바꾸면 내 목록에만 반영된다", async () => {
    await roomMenu(ROOM_NAME, "방제목 변경");
    await expect($(".modal .modal-title")).toHaveText("방제목 변경");
    await $(".modal .title-input").setValue("우리팀");
    await $(".modal button.primary").click();

    await expect(roomItem("우리팀")).toBeDisplayed();
    // 다른 참여자의 방 이름은 그대로다
    const latest = [...a.inbox].reverse().find((m) => m.type === "my_rooms" && m.rooms.some((r) => r.roomId === roomId));
    expect(JSON.stringify(latest.rooms.find((r) => r.roomId === roomId))).not.toContain("우리팀");
  });

  it("방 창에서 방제목을 바꾸면 창 제목과 헤더가 바뀐다", async () => {
    await roomItem("우리팀").doubleClick();
    await switchToRoom(roomId);

    await $(".chat-header .rename-btn").click();
    await expect($(".modal .title-input")).toHaveValue("우리팀");
    await $(".modal .title-input").setValue("새이름팀");
    await $(".modal button.primary").click();

    await expect($(".chat-header .peer")).toHaveText(expect.stringContaining("새이름팀"));
    await browser.waitUntil(async () => (await browser.getTitle()).includes("새이름팀"), {
      timeout: 10_000,
      timeoutMsg: "창 제목이 바뀌지 않음",
    });
    await switchToMain();
    await expect(roomItem("새이름팀")).toBeDisplayed();
  });

  it("목록 메뉴에서 초대하면 초대받은 사람에게 방이 생기고 참여자 수가 늘어난다", async () => {
    await roomMenu("새이름팀", "초대");
    await expect($(".modal .modal-title")).toHaveText("초대하기");
    // 이미 참여 중인 사람은 목록에 없다
    await expect($(".modal").$(`.select-item=${A}`)).not.toBeExisting();
    await pickUser(C);
    await $(".modal button.primary").click();

    await waitMyRoom(c, roomId);
    await roomItem("새이름팀").doubleClick();
    await switchToRoom(roomId);
    await expect(membersBtn()).toHaveText("👥 4");
  });

  it("방 창에서 초대하면, 초대받은 사람은 초대 이후의 대화만 본다", async () => {
    a.send({ type: "room_message", roomId, text: "before-invite" });

    await roomItem("새이름팀").doubleClick();
    await switchToRoom(roomId);
    await messageContent("before-invite").waitForDisplayed({ timeout: 10_000 });

    await $(".chat-header .invite-btn").click();
    await expect($(".modal .modal-title")).toHaveText("초대하기");
    await pickUser(D);
    await $(".modal button.primary").click();
    await expect(membersBtn()).toHaveText("👥 5");

    a.send({ type: "room_message", roomId, text: "after-invite" });
    await messageContent("after-invite").waitForDisplayed({ timeout: 10_000 });

    const d = await connectClient(D);
    try {
      const hist = await d.request(
        { type: "room_history", roomId },
        (m) => m.type === "history_room" && m.roomId === roomId,
      );
      const texts = hist.messages.map((m) => m.text);
      expect(texts).toContain("after-invite");
      expect(texts).not.toContain("before-invite");
    } finally {
      d.close();
    }
  });

  it("방 이미지를 설정하면 내 목록에만 이미지가 보인다", async () => {
    await roomItem("새이름팀").doubleClick();
    await switchToRoom(roomId);

    await $(".chat-header .image-btn").click();
    await expect($(".modal-card h3")).toHaveText("방 이미지 설정");
    await setFileInput($(".modal-card input.hidden-input"), fixture("red16.png"));
    await expect($(".modal-card .caption")).toHaveText(expect.stringContaining("새 이미지 미리보기"));
    await $(".modal-card").$("button=저장").click();
    await $(".modal-card").waitForExist({ reverse: true, timeout: 10_000 });

    await switchToMain();
    await expect(roomItem("새이름팀").$(".avatar img")).toBeDisplayed();
    // 다른 참여자의 방 이미지는 그대로다 (나에게만 적용)
    const latest = [...a.inbox].reverse().find((m) => m.type === "my_rooms" && m.rooms.some((r) => r.roomId === roomId));
    expect(latest.rooms.find((r) => r.roomId === roomId).roomImage ?? null).toBeNull();
  });

  it("방을 나가면 내 목록에서 사라지고 남은 참여자에게 반영된다", async () => {
    await roomMenu("새이름팀", "나가기");

    await expect(roomItem("새이름팀")).not.toBeExisting();
    await a.waitFor(
      (m) => m.type === "room_members" && m.roomId === roomId && !m.members.includes(no[ME]),
    );
  });

  it("1:1 방은 메시지가 오기 전에는 목록에 보이지 않는다", async () => {
    const dmRoom = await createRoom(a, [no[ME]]);
    await browser.pause(500);
    await expect($(".room-screen").$(`.room-item*=${A}`)).not.toBeExisting();

    a.send({ type: "room_message", roomId: dmRoom, text: "dm-hello" });
    await expect(roomItem("dm-hello")).toBeDisplayed();
    await expect(roomItem("dm-hello").$(".room-name")).toHaveText(A);
  });
});
