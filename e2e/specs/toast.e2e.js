// 새 메시지 알림 카드 (Tauri 전용 #/toast 창): 표시·자동 숨김 / 눌러서 방 열기 / 닫기 / 보고 있는 방은 알리지 않음.
// 앱은 tsme로 로그인하고, 상대 tsaa는 Node WebSocket 클라이언트로 메시지를 보낸다.
import {
  closeExtraWindows,
  loginAs,
  roomItem,
  switchToMain,
  switchToRoom,
  switchToWindowWhere,
} from "../helpers/app.js";
import { changedPassword, connectClient, createActiveUser, createRoom } from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "tsme";
const A = "tsaa";
const SHOW_MS = 4000; // ToastView.vue: 카드가 떠 있는 시간

const switchToToast = () => switchToWindowWhere((url) => url.includes("#/toast"), { what: "알림 창" });
const card = () => $(".toast-card");

describe("새 메시지 알림", () => {
  let a = null;
  let roomId = 0;

  before(async () => {
    const admin = await connectClient("admin");
    const meNo = await createActiveUser(admin, ME);
    await createActiveUser(admin, A);
    admin.close();
    a = await connectClient(A);
    roomId = await createRoom(a, [meNo]);
    // 1:1 방은 메시지가 있어야 내 목록에 보인다
    a.send({ type: "room_message", roomId, text: "first" });

    await loginAs(ME, changedPassword(ME));
    await roomItem("first").waitForDisplayed({ timeout: 10_000 });
  });

  /** 알림 창 페이지가 다 떠서(ToastView 마운트) 알림을 받을 수 있을 때까지 기다린 뒤 메인 창으로 돌아온다 */
  const waitToastReady = async () => {
    await switchToToast();
    await $(".toast-frame").waitForExist({ timeout: 10_000 });
    await browser.pause(300); // onMounted의 listen() 등록이 끝날 시간
    await switchToMain();
  };

  after(() => {
    a?.close();
  });

  afterEach(async () => {
    await closeExtraWindows();
  });

  // 회귀 방지: 예전에는 알림 창 페이지가 toast-show 리스너를 등록하기 전에 알림을 보내 로그인 직후 알림이 사라졌다.
  // 지금은 showMessageToast가 알림 창의 toast-ready를 기다린 뒤 보낸다 (utils/toastWindow.ts).
  it("로그인 직후 바로 온 메시지도 알림 카드로 뜬다", async () => {
    a.send({ type: "room_message", roomId, text: "toast-early" });

    await switchToToast();
    await expect(card().$(".text")).toHaveText("toast-early");
    await switchToMain();
  });

  it("방 창이 닫혀 있을 때 메시지가 오면 방·보낸 사람·내용이 담긴 카드가 떴다가 사라진다", async () => {
    await waitToastReady();
    a.send({ type: "room_message", roomId, text: "toast-hello" });

    await switchToToast();
    await expect(card()).toHaveElementClass("shown");
    await expect(card().$(".room-name")).toHaveText(A);
    await expect(card().$(".sender")).toHaveText(A);
    await expect(card().$(".text")).toHaveText("toast-hello");

    await expect(card()).not.toHaveElementClass("shown", { wait: SHOW_MS + 4000 });
    await switchToMain();
  });

  it("카드를 누르면 그 방 창이 열린다", async () => {
    a.send({ type: "room_message", roomId, text: "toast-open" });

    await switchToToast();
    await expect(card().$(".text")).toHaveText("toast-open");
    await card().click();

    await switchToRoom(roomId);
    await expect($(".chat-body").$(".message-content*=toast-open")).toBeDisplayed();
  });

  it("닫기를 누르면 방을 열지 않고 카드만 내려간다", async () => {
    a.send({ type: "room_message", roomId, text: "toast-close" });

    await switchToToast();
    await expect(card().$(".text")).toHaveText("toast-close");
    await card().$(".close-btn").click();

    await expect(card()).not.toHaveElementClass("shown");
    const rooms = (await Promise.all(
      (await browser.getWindowHandles()).map(async (h) => {
        await browser.switchToWindow(h);
        return browser.getUrl();
      }),
    )).filter((url) => url.includes("#/room/"));
    expect(rooms).toEqual([]);
    await switchToMain();
  });

  it("보고 있는 방의 메시지는 알리지 않는다", async () => {
    await roomItem(A).doubleClick();
    await switchToRoom(roomId);

    a.send({ type: "room_message", roomId, text: "toast-silent" });
    await expect($(".chat-body").$(".message-content*=toast-silent")).toBeDisplayed();

    await switchToToast();
    await browser.pause(1500);
    await expect(card()).not.toHaveElementClass("shown");
    await expect(card().$(".text")).not.toHaveText("toast-silent");
  });
});
