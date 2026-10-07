// 사용자 탭 (일반 사용자 화면): 목록 / 검색 / 상태 필터 / 상세정보 / 1:1 채팅.
// 앱은 utme로 로그인한다. utaa(접속), utbb(접속·바쁨)는 Node WebSocket 클라이언트로 붙고, utcc는 접속하지 않는다.
import {
  closeExtraWindows,
  currentRoomId,
  loginAs,
  openTab,
  switchToMain,
  switchToWindowWhere,
} from "../helpers/app.js";
import { changedPassword, connectClient, createActiveUser, latestStatus, registerUser } from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "utme";
const A = "utaa";
const B = "utbb";
const C = "utcc";

const userItem = (nickname) => $(".user-list").$(`.user-item*=${nickname}`);
const userNames = () => $$(".user-list .user-item .name").map((el) => el.getText());

const FILL_COUNT = 25; // 목록이 창보다 길어지도록 추가로 만드는 사용자 수 (utfill01 ~ utfill25)

const search = () => $(".userlist-screen .search-input");

/** ⋮ 메뉴 실행. 목록 길이와 상관없이 쓰도록, 사용자처럼 먼저 검색해 대상을 맨 위로 올린다 */
const userMenu = async (nickname, action) => {
  await search().setValue(nickname);
  await userItem(nickname).$(".more-btn").click();
  await $(".ctx-menu").$(`button=${action}`).click();
};

describe("사용자 탭", () => {
  let a = null;
  let b = null;

  before(async () => {
    const admin = await connectClient("admin");
    const no = {};
    for (const id of [ME, A, B, C]) no[id] = await createActiveUser(admin, id);
    for (let i = 1; i <= FILL_COUNT; i++) await registerUser(admin, `utfill${String(i).padStart(2, "0")}`);
    admin.close();
    a = await connectClient(A);
    b = await connectClient(B);
    b.send({ type: "status_set", status: "busy" });
    await b.waitFor(() => latestStatus(b, no[B]) === "busy");

    await loginAs(ME, changedPassword(ME));
    await openTab("사용자");
    await userItem(A).waitForDisplayed({ timeout: 10_000 });
  });

  after(() => {
    a?.close();
    b?.close();
  });

  afterEach(async () => {
    await closeExtraWindows();
    if (await $(".modal-backdrop").isExisting()) await browser.keys("Escape");
    if (await $(".userlist-screen .search-clear").isExisting()) await $(".userlist-screen .search-clear").click();
  });

  it("다른 사용자와 상태가 보이고, admin과 나는 목록에 없다", async () => {
    const names = await userNames();
    expect(names).toEqual(expect.arrayContaining([A, B, C]));
    expect(names).not.toContain("admin");
    expect(names).not.toContain(ME);
    await expect(userItem(A).$(".presence")).toHaveElementClass("online");
    await expect(userItem(B).$(".presence")).toHaveAttribute("title", expect.stringContaining("바쁨"));
    await expect(userItem(C).$(".presence")).toHaveElementClass("offline");
  });

  it("닉네임으로 검색할 수 있다", async () => {
    const box = search();
    await box.setValue("utb");
    expect(await userNames()).toEqual([B]);

    await box.setValue("nobodyhere");
    await expect($(".userlist-screen .empty")).toHaveText('"nobodyhere" 검색 결과가 없습니다.');

    await $(".userlist-screen .search-clear").click();
    await expect(box).toHaveValue("");
    expect(await userNames()).toEqual(expect.arrayContaining([A, B, C]));
  });

  it("상태로 거를 수 있다", async () => {
    const filter = $("select.status-filter");
    await filter.selectByAttribute("value", "busy");
    expect(await userNames()).toEqual([B]);

    await filter.selectByAttribute("value", "offline");
    const offline = await userNames();
    expect(offline).toContain(C);
    expect(offline).not.toContain(A);
    expect(offline).not.toContain(B);

    await filter.selectByAttribute("value", "all");
    expect(await userNames()).toEqual(expect.arrayContaining([A, B, C]));
  });

  it("메뉴에서 상세정보를 볼 수 있다", async () => {
    await userMenu(A, "상세정보");
    await expect($(".modal-card h3")).toHaveText("상세정보");
    const dd = await $(".modal-card").$$(".detail-list dd");
    await expect(dd[0]).toHaveText(A);
    await $(".modal-card").$("button=닫기").click();
  });

  it("1:1 채팅하기로 방 창이 열리고, 다시 열면 같은 방을 쓴다", async () => {
    await userMenu(A, "1:1 채팅하기");
    await switchToWindowWhere((url) => url.includes("#/room/"), { what: "1:1 방 창" });
    const first = await currentRoomId();
    expect(first).toBeGreaterThan(0);
    await $(".chat-body").waitForDisplayed({ timeout: 10_000 });
    await expect(browser).toHaveTitle(expect.stringContaining(A));
    await $('.chat-footer input[placeholder="메시지를 입력하세요"]').setValue("dm-from-utme");
    await browser.keys("Enter");
    await a.waitFor((m) => m.type === "room_message" && m.roomId === first && m.text === "dm-from-utme");

    await closeExtraWindows();
    await switchToMain();
    await search().setValue(A);
    await userItem(A).doubleClick();
    await switchToWindowWhere((url) => url.includes("#/room/"), { what: "1:1 방 창" });
    expect(await currentRoomId()).toBe(first);
  });

  // 회귀 방지: 예전에는 사용자 ⋮ 메뉴가 세로 위치를 창 안으로 맞추지 않아(UserListView.vue menuStyle)
  // 목록 아래쪽 사용자의 메뉴가 창 밖에 열려 누를 수 없었다.
  it("목록 맨 아래 사용자의 메뉴도 창 안에 열린다", async () => {
    const last = $$(".user-list .user-item .more-btn").at(-1);
    await last.scrollIntoView({ block: "end" });
    await last.click();

    const menu = $(".userlist-screen .ctx-menu");
    await menu.waitForDisplayed({ timeout: 5_000 });
    const inside = await browser.execute((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }, await menu);
    expect(inside).toBe(true);
    await browser.keys("Escape");
    await $(".userlist-screen").click();
  });
});
