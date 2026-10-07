// 연결 끊김 / 재연결: 서버를 실제로 내렸다 올려서 앱이 상태를 보여주고 스스로 다시 붙는지 확인한다.
// 서버는 wdio 런처가 관리하므로 serverControl(런처 제어 포트)로 끄고 켠다. 다시 켜도 같은 임시 DB다.
// 앱은 cnme로 로그인하고, 상대 cnaa는 Node WebSocket 클라이언트다.
import { closeExtraWindows, loginAs, roomItem, switchToMain, switchToRoom } from "../helpers/app.js";
import {
  changedPassword,
  connectClient,
  createActiveUser,
  createRoom,
  serverControl,
} from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "cnme";
const A = "cnaa";

const reconnectBtn = () => $(".main-header").$("button=재연결");

describe("연결 끊김과 재연결", () => {
  let roomId = 0;

  before(async () => {
    const admin = await connectClient("admin");
    const meNo = await createActiveUser(admin, ME);
    await createActiveUser(admin, A);
    admin.close();
    const a = await connectClient(A);
    roomId = await createRoom(a, [meNo]);
    a.send({ type: "room_message", roomId, text: "before-outage" });
    await a.request({ type: "room_history", roomId }, (m) => m.type === "history_room" && m.roomId === roomId);
    a.close();

    await loginAs(ME, changedPassword(ME));
    await roomItem("before-outage").waitForDisplayed({ timeout: 10_000 });
  });

  afterEach(async () => {
    // 실패해도 다음 spec이 서버 없이 돌지 않게 항상 다시 켠다
    await serverControl.start();
    await closeExtraWindows();
  });

  it("서버가 내려가면 끊김과 재연결 버튼을 보여주고, 서버가 돌아오면 스스로 다시 붙는다", async () => {
    await serverControl.stop();

    await expect(reconnectBtn()).toBeDisplayed({ wait: 10_000 });
    await expect($(".main-header .status-select")).toBeDisplayed();
    // 끊긴 동안에는 방 만들기 메뉴를 쓸 수 없다
    await expect($(".room-screen .more-btn")).toBeDisabled();

    await serverControl.start();
    await expect(reconnectBtn()).not.toBeExisting({ wait: 15_000 });
    await expect($(".room-screen .more-btn")).toBeEnabled();

    // 다시 붙은 뒤에도 메시지를 주고받는다
    const a = await connectClient(A);
    try {
      a.send({ type: "room_message", roomId, text: "after-outage" });
      await expect(roomItem("after-outage")).toBeDisplayed({ wait: 10_000 });
    } finally {
      a.close();
    }
  });

  it("방 창은 끊긴 동안 연결 상태를 알리고 전송을 막았다가, 다시 붙으면 풀린다", async () => {
    await roomItem(A).doubleClick();
    await switchToRoom(roomId);

    await serverControl.stop();
    await expect($(".conn-banner")).toBeDisplayed({ wait: 10_000 });
    await expect($(".chat-footer .attach-btn")).toBeDisabled();

    await serverControl.start();
    await expect($(".conn-banner")).not.toBeExisting({ wait: 15_000 });
    await expect($(".chat-footer .attach-btn")).toBeEnabled();

    await $('.chat-footer input[placeholder="메시지를 입력하세요"]').setValue("sent-after-reconnect");
    await browser.keys("Enter");
    await expect($(".chat-body").$(".message-content*=sent-after-reconnect")).toBeDisplayed();
    await switchToMain();
  });
});
