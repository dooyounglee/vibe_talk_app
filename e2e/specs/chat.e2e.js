// 채팅: 메시지 송수신 / 읽음 숫자 / 안읽음 배지 / 파일·이미지 첨부 / 이미지 창 / 대화 검색 / 새 메시지 버튼.
// 앱은 chme로 로그인하고, 같은 방의 cha·chb는 Node WebSocket 클라이언트로 붙는다.
// 방은 실제 앱처럼 목록에서 더블클릭해 Tauri 새 창으로 연다.
import {
  closeExtraWindows,
  fixture,
  loginAs,
  messageContent,
  roomItem,
  setFileInput,
  switchToRoom,
  switchToWindowWhere,
} from "../helpers/app.js";
import { changedPassword, connectClient, createActiveUser, createRoom } from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "chme";
const A = "cha";
const B = "chb";
// 내 목록에 보이는 방 이름 (나를 뺀 참여자)
const ROOM_NAME = `${A},${B}`;
const FILL_COUNT = 40; // 스크롤이 생기도록 미리 채워 두는 메시지 수

const input = () => $('.chat-footer input[placeholder="메시지를 입력하세요"]');
const sendBtn = () => $(".chat-footer").$("button=전송");
const rowOf = (text) => $(".chat-body").$(`.message-row*=${text}`);

const sendFromApp = async (text) => {
  await input().setValue(text);
  await browser.keys("Enter");
  await messageContent(text).waitForDisplayed({ timeout: 10_000 });
};

/** client가 보낸 메시지가 서버에 저장될 때까지 (같은 소켓의 요청은 순서대로 처리된다) */
const flush = (client, roomId) =>
  client.request({ type: "room_history", roomId }, (m) => m.type === "history_room" && m.roomId === roomId);

describe("채팅", () => {
  let a = null;
  let b = null;
  let roomId = 0;

  before(async () => {
    const admin = await connectClient("admin");
    const no = {};
    for (const id of [ME, A, B]) no[id] = await createActiveUser(admin, id);
    admin.close();
    a = await connectClient(A);
    b = await connectClient(B);

    roomId = await createRoom(a, [no[ME], no[B]]);
    for (let i = 0; i < FILL_COUNT; i++) a.send({ type: "room_message", roomId, text: `fill-${i}` });
    a.send({ type: "room_message", roomId, text: "find-me one" });
    a.send({ type: "room_message", roomId, text: "find-me two" });
    await flush(a, roomId);

    await loginAs(ME, changedPassword(ME));
  });

  after(() => {
    a?.close();
    b?.close();
  });

  afterEach(async () => {
    await closeExtraWindows();
  });

  it("방 창이 닫혀 있을 때 온 메시지는 목록에 배지·미리보기로 보이고, 방을 열면 배지가 사라진다", async () => {
    const item = roomItem(ROOM_NAME);
    await item.waitForDisplayed({ timeout: 10_000 });
    const before = Number((await item.$(".badge").isExisting()) ? await item.$(".badge").getText() : 0);

    a.send({ type: "room_message", roomId, text: "badge-1" });
    a.send({ type: "room_message", roomId, text: "badge-2" });

    await expect(item.$(".badge")).toHaveText(String(before + 2));
    await expect(item.$(".room-preview")).toHaveText(expect.stringContaining("badge-2"));

    await item.doubleClick();
    await switchToRoom(roomId);
    await messageContent("badge-2").waitForDisplayed({ timeout: 10_000 });
    await closeExtraWindows();
    await expect(roomItem(ROOM_NAME).$(".badge")).not.toBeExisting();
  });

  describe("방 창에서", () => {
    beforeEach(async () => {
      await roomItem(ROOM_NAME).doubleClick();
      await switchToRoom(roomId);
    });

    it("입력이 비어 있으면 전송 버튼이 꺼져 있다", async () => {
      await expect(sendBtn()).toBeDisabled();
      await input().setValue("   ");
      await expect(sendBtn()).toBeDisabled();
      await input().setValue("x");
      await expect(sendBtn()).toBeEnabled();
    });

    it("내가 보낸 메시지는 내 말풍선으로 보이고 다른 참여자에게 전달된다", async () => {
      await input().setValue("hello-from-me");
      await sendBtn().click();

      await expect(rowOf("hello-from-me")).toHaveElementClass("row-self");
      await expect(input()).toHaveValue("");
      await a.waitFor((m) => m.type === "room_message" && m.roomId === roomId && m.text === "hello-from-me");
    });

    it("상대 메시지는 보낸 사람 이름과 함께 보이고, 이어진 메시지는 이름 없이 붙는다", async () => {
      a.send({ type: "room_message", roomId, text: "a-first" });
      a.send({ type: "room_message", roomId, text: "a-second" });
      await messageContent("a-second").waitForDisplayed({ timeout: 10_000 });

      await expect(rowOf("a-first")).toHaveElementClass("row-other");
      await expect(rowOf("a-first").$(".sender-name")).toHaveText(A);
      await expect(rowOf("a-second")).toHaveElementClass("row-continued");
      await expect(rowOf("a-second").$(".sender-name")).not.toBeExisting();
    });

    it("내 메시지의 안 읽은 사람 수가 상대가 읽을 때마다 줄어든다", async () => {
      await sendFromApp("read-check");
      const count = rowOf("read-check").$(".unread-count");
      await expect(count).toHaveText("2");

      a.send({ type: "unread_clear", scope: "room", target: roomId });
      await expect(count).toHaveText("1");

      b.send({ type: "unread_clear", scope: "room", target: roomId });
      await expect(count).not.toBeExisting();
    });

    it("파일을 첨부하면 파일 메시지로 보이고 다른 참여자에게 전달된다", async () => {
      await setFileInput($(".chat-footer .file-input"), fixture("notes.txt"));

      const file = $(".chat-body").$(".att-file*=notes.txt");
      await file.waitForDisplayed({ timeout: 10_000 });
      await expect(file.$(".att-file-size")).toHaveText(expect.stringContaining("다운로드"));
      const got = await a.waitFor((m) => m.type === "room_message" && m.roomId === roomId && m.file?.name === "notes.txt");
      expect(got.file.size).toBeGreaterThan(0);
    });

    it("이미지를 첨부하면 미리보기로 보이고, 누르면 이미지 창에서 확대·축소·닫기가 된다", async () => {
      const roomHandle = await browser.getWindowHandle();
      await setFileInput($(".chat-footer .file-input"), fixture("photo.png"));

      const img = $(".chat-body img.att-image[alt='photo.png']");
      await img.waitForDisplayed({ timeout: 10_000 });
      await img.click();

      const imageHandle = await switchToWindowWhere((url) => url.includes("#/image/"), { what: "이미지 창" });
      await $(".viewer-image").waitForDisplayed({ timeout: 10_000 });
      await expect($(".viewer-name")).toHaveText(expect.stringContaining("photo.png"));
      const percent = $(".viewer-actions button.percent");
      await expect(percent).toHaveText("100%");

      await $(".viewer-actions button[aria-label='확대']").click();
      await browser.waitUntil(async () => (await percent.getText()) !== "100%", {
        timeout: 5_000,
        timeoutMsg: "확대되지 않음",
      });
      await browser.keys("0");
      await expect(percent).toHaveText("100%");
      await browser.keys("-");
      await browser.waitUntil(async () => parseInt(await percent.getText(), 10) < 100, {
        timeout: 5_000,
        timeoutMsg: "축소되지 않음",
      });

      await browser.keys("Escape");
      await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(imageHandle), {
        timeout: 5_000,
        timeoutMsg: "Esc로 이미지 창이 닫히지 않음",
      });
      await browser.switchToWindow(roomHandle);
    });

    it("대화를 검색하면 최신 결과부터 보여주고 이전/다음으로 이동한다", async () => {
      await $(".chat-header .search-btn").click();
      const box = $(".message-search .search-input");
      await box.setValue("find-me");
      await browser.keys("Enter");

      const counter = $(".message-search .search-counter");
      await expect(counter).toHaveText("1/2");
      await expect($(".message-row.search-active")).toHaveText(expect.stringContaining("find-me two"));
      await expect($(".message-row.search-active mark.search-hit")).toHaveText("find-me");

      await $(".message-search button[title='이전 결과']").click();
      await expect(counter).toHaveText("2/2");
      await expect($(".message-row.search-active")).toHaveText(expect.stringContaining("find-me one"));

      await $(".message-search button[title='다음 결과']").click();
      await expect(counter).toHaveText("1/2");

      await box.setValue("nothing-matches-this");
      await browser.keys("Enter");
      await expect(counter).toHaveText("결과 없음");

      await $(".message-search .search-close").click();
      await expect($(".message-search")).not.toBeExisting();
      await expect($(".message-row.search-active")).not.toBeExisting();
    });

    it("위쪽을 보는 중에 새 메시지가 오면 '새 메시지' 버튼이 뜨고, 누르면 맨 아래로 간다", async () => {
      await browser.execute(() => {
        document.querySelector(".chat-body").scrollTop = 0;
      });
      await browser.pause(500);

      a.send({ type: "room_message", roomId, text: "while-reading" });
      const jump = $(".new-msg-btn");
      await expect(jump).toHaveText(expect.stringContaining("새 메시지(1)"));

      await jump.click();
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const body = document.querySelector(".chat-body");
            return body.scrollHeight - body.scrollTop - body.clientHeight <= 2;
          }),
        { timeout: 5_000, timeoutMsg: "맨 아래로 내려가지 않음" },
      );
      await expect(messageContent("while-reading")).toBeDisplayed();
      await expect($(".new-msg-btn")).not.toBeExisting();
    });
  });
});
